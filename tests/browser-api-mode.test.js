import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';
import bcrypt from 'bcryptjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function connectCDP(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    const exceptions = [];
    const requests = [];
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
        if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request);
        if (!message.id) return;
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    return { socket, send, evaluate, exceptions, requests };
}

test('real Chromium browser: API entry, canvas, transient preferences, download, logout and reload', { timeout: 120000 }, async t => {
    let executable;
    for (const candidate of [process.env.DC_TEST_BROWSER, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) {
        if (!candidate) continue;
        try { await fs.access(candidate); executable = candidate; break; } catch {}
    }
    if (!executable) return t.skip('No Chromium browser installed; set DC_TEST_BROWSER to enable the smoke test.');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-api-browser-'));
    let server;
    let browser;
    let cdp;
    let output = '';
    try {
        const appDir = path.join(temp, 'app');
        await fs.mkdir(appDir);
        for (const name of ['package.json', 'server.js', 'auth.js', 'jwt-auth.js', 'storage.js', 'api-mode.js', 'index.html', 'script.js', 'style.css', 'logo.svg', 'modules', 'nodes', 'providers', 'workflows']) {
            await fs.cp(path.join(root, name), path.join(appDir, name), { recursive: true });
        }
        await fs.symlink(path.join(root, 'node_modules'), path.join(appDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
        await fs.mkdir(path.join(appDir, 'data'));
        await fs.writeFile(path.join(appDir, 'data', 'users.json'), JSON.stringify([{
            id: 'example-admin', email: 'admin@example.test', password: await bcrypt.hash('test-password', 4),
            provider: 'local', displayName: 'Example admin', isAdmin: true, credits: 0
        }]));
        const port = await freePort();
        const debugPort = await freePort();
        server = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'tests', 'fixtures', 'providers.js')).href, path.join(appDir, 'server.js')], {
            cwd: appDir,
            env: { ...process.env, DC_DESKTOP: '', DC_DATA_DIR: '', PORT: String(port), NODE_ENV: 'test', SESSION_SECRET: 'browser-test-secret', REDIS_URL: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', DC_PROVIDER_LOG: path.join(temp, 'provider.log') },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        server.stdout.on('data', chunk => { output += chunk; });
        server.stderr.on('data', chunk => { output += chunk; });
        const base = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 400; i++) {
            try { if ((await fetch(`${base}/api/user`)).ok) break; } catch {}
            await sleep(50);
        }
        browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(temp, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
        let target;
        for (let i = 0; i < 100; i++) {
            try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target => target.type === 'page'); if (target) break; } catch {}
            await sleep(50);
        }
        assert.ok(target, 'Browser did not start');
        cdp = await connectCDP(target.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        await cdp.send('Network.enable');
        await cdp.send('Page.navigate', { url: base });
        let ready = false;
        for (let i = 0; i < 150; i++) {
            // ES-module imports include the existing external three.js CDN.
            ready = await cdp.evaluate('document.getElementById("apiModeForm") !== null && document.querySelector(".oauth-buttons").textContent.includes("No OAuth")');
            if (ready) break;
            await sleep(200);
        }
        assert.ok(ready, `App did not initialize: ${JSON.stringify(cdp.exceptions)} ${output}`);
        const websiteLink = await cdp.evaluate(`(() => {
            const link = document.querySelector('.top-bar-sub a');
            return { href: link.href, target: link.target, rel: link.rel, text: link.textContent,
                color: getComputedStyle(link).color, parentColor: getComputedStyle(link.parentElement).color };
        })()`);
        assert.equal(websiteLink.href, 'https://moritzpongratz.com/');
        assert.equal(websiteLink.target, '_blank');
        assert.ok(websiteLink.rel.includes('noopener') && websiteLink.rel.includes('noreferrer'));
        assert.equal(websiteLink.text, 'moritzpongratz.com');
        assert.equal(websiteLink.color, websiteLink.parentColor);
        await cdp.evaluate('document.fonts.ready.then(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))))');
        assert.equal(await cdp.evaluate('document.getElementById("apiModeTab").getAttribute("aria-selected")'), 'true');
        assert.equal(await cdp.evaluate('getComputedStyle(document.getElementById("loginModePanel")).display'), 'none');
        await cdp.evaluate('document.getElementById("apiModeTab").dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true}))');
        assert.equal(await cdp.evaluate('document.activeElement.id'), 'loginModeTab');
        assert.equal(await cdp.evaluate('getComputedStyle(document.getElementById("apiModePanel")).display'), 'none');
        await cdp.evaluate('document.getElementById("loginModeTab").dispatchEvent(new KeyboardEvent("keydown", {key:"Home", bubbles:true}))');
        assert.equal(await cdp.evaluate('document.activeElement.id'), 'apiModeTab');

        // Check real layout, not just hidden scrollbars: every visible control
        // and the footer must actually fit inside the card and the viewport.
        for (const [width, height] of [[713, 1026], [1366, 768], [900, 600], [375, 667], [320, 568], [844, 390]]) {
            await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
            for (const dark of [false, true]) {
                for (const mode of ['api', 'login']) {
                    await cdp.evaluate(`document.body.classList.toggle('dark-mode', ${dark}); document.getElementById('${mode === 'api' ? 'apiModeTab' : 'loginModeTab'}').click();`);
                    await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
                    const layout = await cdp.evaluate(`(() => {
                        const card = document.querySelector('.login-container');
                        const bounds = card.getBoundingClientRect();
                        const visible = [...card.querySelectorAll('button, input, .login-disclaimer')].filter(el => el.getClientRects().length);
                        return { fits: card.scrollHeight <= card.clientHeight + 1 && card.scrollWidth <= card.clientWidth + 1,
                            inViewport: bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth,
                            controlsFit: visible.every(el => { const r = el.getBoundingClientRect(); return r.top >= bounds.top && r.bottom <= bounds.bottom + 1; }),
                            overflow: getComputedStyle(card).overflowY, width: bounds.width, height: bounds.height,
                            children: [...card.children].map(el => ({id:el.id, cls:el.className, hidden:el.hidden, height:el.getBoundingClientRect().height, scroll:el.scrollHeight})) };
                    })()`);
                    assert.equal(layout.fits, true, `Clipped card at ${width}x${height} ${mode} dark=${dark}: ${JSON.stringify(layout)}`);
                    assert.equal(layout.inViewport, true, JSON.stringify(layout));
                    assert.equal(layout.controlsFit, true, JSON.stringify(layout));
                    assert.notEqual(layout.overflow, 'auto');
                    assert.notEqual(layout.overflow, 'scroll');
                    assert.ok(layout.width <= 480);
                }
            }
        }
        // Also cover configured OAuth and a login error (the taller state).
        await cdp.evaluate('document.querySelector(".oauth-buttons").innerHTML = \'<a href="/auth/google" class="oauth-btn google-btn">Continue with Google</a>\'; document.querySelector(".login-separator").hidden = false; document.getElementById("loginError").textContent = "Login failed. Please try again.";');
        for (const [width, height] of [[375, 667], [320, 568], [844, 390]]) {
            await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
            await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            const layout = await cdp.evaluate('(() => { const c = document.querySelector(".login-container"); return {scroll:c.scrollHeight, client:c.clientHeight, bottom:c.getBoundingClientRect().bottom, viewport:innerHeight}; })()');
            assert.ok(layout.scroll <= layout.client + 1 && layout.bottom <= layout.viewport, `OAuth/error layout at ${width}x${height}: ${JSON.stringify(layout)}`);
        }
        await cdp.evaluate('document.getElementById("loginError").textContent = ""; document.body.classList.remove("dark-mode"); document.getElementById("apiModeTab").click();');
        await cdp.send('Emulation.clearDeviceMetricsOverride');
        const preferences = await cdp.evaluate('JSON.stringify(Object.entries(localStorage))');
        const start = async () => {
            await cdp.evaluate('document.getElementById("apiModeTab").click(); document.getElementById("startApiModeBtn").click();');
            for (let i = 0; i < 100; i++) {
                if (await cdp.evaluate('document.body.classList.contains("api-mode")')) return;
                await sleep(50);
            }
            throw new Error(`API form did not start: ${await cdp.evaluate('document.getElementById("apiModeError").textContent')} ${JSON.stringify(cdp.exceptions)}`);
        };
        await start();
        assert.equal(await cdp.evaluate('document.getElementById("loginModal").querySelectorAll("input[name$=ApiKey]").length'), 0);
        assert.equal(await cdp.evaluate('document.getElementById("loginModal").classList.contains("hidden")'), true);
        assert.equal(await cdp.evaluate('document.getElementById("apiGoogleKey").value'), '');
        assert.equal(await cdp.evaluate('getComputedStyle(document.getElementById("saveBoardBtn")).display'), 'none');
        assert.notEqual(await cdp.evaluate('getComputedStyle(document.getElementById("downloadBoardBtn")).display'), 'none');
        await cdp.evaluate('document.getElementById("addPromptNode").click(); document.getElementById("themeToggle").click();');
        assert.equal(await cdp.evaluate('document.querySelectorAll(".prompt-node").length'), 1);
        await cdp.evaluate('document.getElementById("apiSettingsBtn").click(); document.getElementById("apiGoogleKey").value = "browser-google-key"; document.getElementById("apiModeForm").requestSubmit();');
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate('!document.getElementById("apiSettingsModal").classList.contains("active")')) break;
            await sleep(50);
        }
        assert.equal(await cdp.evaluate('document.querySelectorAll(".prompt-node").length'), 1, 'Setting keys must not clear the board');
        assert.equal(await cdp.evaluate('document.getElementById("apiGoogleKey").value'), '');
        await cdp.evaluate('const node = document.querySelector(".prompt-node"); node.querySelector("textarea").value = "Browser private prompt"; node.querySelector("textarea").dispatchEvent(new Event("input", { bubbles: true })); node.querySelector(".prompt-library-btn").click(); node.querySelector(".prompt-library-name").value = "Private library entry"; node.querySelector(".prompt-library-save-btn").click();');
        await cdp.evaluate('document.querySelector(".prompt-node .generate-btn").click()');
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate('document.querySelectorAll(".result-node").length > 0')) break;
            await sleep(50);
        }
        assert.equal(await cdp.evaluate('document.querySelectorAll(".result-node").length'), 1);
        assert.equal(await cdp.evaluate('JSON.stringify(Object.entries(localStorage))'), preferences);
        assert.equal(await cdp.evaluate('sessionStorage.getItem("diffusionCanvas_sessionBoardId")'), null);
        const downloads = path.join(temp, 'downloads');
        await fs.mkdir(downloads);
        await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
        await cdp.evaluate('document.getElementById("downloadBoardBtn").click()');
        const filename = path.join(downloads, 'temporary-api-canvas.dc.json');
        for (let i = 0; i < 100; i++) { try { await fs.access(filename); break; } catch {} await sleep(50); }
        const exported = await fs.readFile(filename, 'utf8');
        assert.ok(exported.includes('Browser private prompt'));
        assert.ok(exported.includes('data:image/png;base64,aW1hZ2U='));
        assert.ok(!exported.includes('browser-google-key'));
        const sessionToken = await cdp.evaluate('import("/modules/ApiSession.js").then(async session => (await (await session.apiFetch("/api/user")).json()).user.id)');
        assert.ok(sessionToken.startsWith('api-'));
        const generationRequest = cdp.requests.find(request => request.url === base + '/api/generate');
        const apiToken = Object.entries(generationRequest.headers).find(([name]) => name.toLowerCase() === 'x-api-session')?.[1];
        assert.ok(apiToken);
        assert.equal(await cdp.evaluate('document.cookie'), '');
        await cdp.evaluate('document.getElementById("logoutBtn").click()');
        await sleep(1000);
        assert.equal(await cdp.evaluate('document.body.classList.contains("api-mode")'), false);
        assert.equal(await cdp.evaluate('document.querySelectorAll(".node").length'), 0);
        assert.equal((await fetch(base + '/api/user', { headers: { 'X-Api-Session': apiToken } })).status, 401);

        // Publish through the real login-mode button, then restore the media in
        // a keyless temporary session. The video is recorded locally, no provider.
        await cdp.evaluate('document.getElementById("loginModeTab").click(); document.querySelector("#localLoginForm [name=email]").value = "admin@example.test"; document.querySelector("#localLoginForm [name=password]").value = "test-password"; document.getElementById("localLoginForm").requestSubmit();');
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate('document.getElementById("loginModal").classList.contains("hidden")')) break;
            await sleep(50);
        }
        assert.equal(await cdp.evaluate('document.getElementById("removeApiExampleBtn").hidden'), false);
        const demoImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
        const demoVideo = await cdp.evaluate(`new Promise(resolve => {
            const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
            const ctx = canvas.getContext('2d'); const stream = canvas.captureStream(10);
            const recorder = new MediaRecorder(stream, {mimeType:'video/webm'}); const chunks = [];
            recorder.ondataavailable = event => chunks.push(event.data);
            recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(new Blob(chunks, {type:'video/webm'})); };
            recorder.start(); ctx.fillStyle = 'red'; ctx.fillRect(0,0,64,64);
            setTimeout(() => recorder.stop(), 400);
        })`);
        assert.ok(demoVideo.startsWith('data:video/webm;base64,'));
        const demoBoardId = await cdp.evaluate(`(async () => {
            const response = await fetch('/api/images', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({data:${JSON.stringify(demoVideo)}})});
            const {id:videoRef} = await response.json();
            const state = {version:'1.0', zoom:1, panX:0, panY:0, nodeIdCounter:2, nodes:[
                {id:'node-0', type:'result', position:{x:50,y:50}, data:{imageData:${JSON.stringify(demoImage)}, prompt:'Example image'}},
                {id:'node-1', type:'videoresult', position:{x:500,y:50}, data:{videoRef, prompt:'Example video'}}
            ], connections:[]};
            const board = await (await fetch('/api/boards', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:'Browser media example', state})})).json();
            return board.id;
        })()`);
        assert.ok(demoBoardId);
        await cdp.evaluate('document.getElementById("openBoardsBtn").click()');
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate(`!!document.querySelector('.board-load-btn[data-id="${demoBoardId}"]')`)) break;
            await sleep(50);
        }
        await cdp.evaluate(`document.querySelector('.board-load-btn[data-id="${demoBoardId}"]').click()`);
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate('!document.getElementById("publishApiExampleBtn").hidden')) break;
            await sleep(50);
        }
        assert.equal(await cdp.evaluate('document.getElementById("publishApiExampleBtn").hidden'), false);
        // Explicit save must upload the inline image before publishing.
        await cdp.evaluate('document.getElementById("saveBoardBtn").click()');
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate('document.getElementById("status").textContent.includes("saved")')) break;
            await sleep(50);
        }
        assert.equal(await cdp.evaluate(`fetch('/api/boards/${demoBoardId}').then(r => r.json()).then(s => !!s.nodes[0].data.imageRef)`), true);
        await cdp.send('Page.reload');
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate('!!document.querySelector(".videoresult-node video") && !document.getElementById("publishApiExampleBtn").hidden && !document.getElementById("loadingOverlay").classList.contains("active")')) break;
            await sleep(50);
        }
        assert.equal(await cdp.evaluate('sessionStorage.getItem("diffusionCanvas_sessionBoardId")'), demoBoardId, 'Login-mode board restoration must survive authentication refresh');
        await cdp.evaluate('document.getElementById("publishApiExampleBtn").click()');
        assert.equal(await cdp.evaluate('document.getElementById("confirmDialog").classList.contains("active")'), true);
        await cdp.evaluate('document.getElementById("confirmOk").click()');
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate('document.getElementById("status").textContent.includes("is now the API example")')) break;
            await sleep(50);
        }
        assert.ok(await cdp.evaluate('document.getElementById("status").textContent.includes("is now the API example")'));
        const published = await fs.readFile(path.join(appDir, 'data', 'api-example.json'), 'utf8');
        await cdp.send('Page.navigate', { url: base + '/auth/logout' });
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate('!!document.querySelector(".oauth-buttons") && document.querySelector(".oauth-buttons").textContent.includes("No OAuth")')) break;
            await sleep(50);
        }
        await start();
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate('document.getElementById("topBarBoardName").textContent.includes("API example") && document.querySelector(".videoresult-node video")?.readyState > 0')) break;
            await sleep(50);
        }
        assert.equal(await cdp.evaluate('document.querySelector(".result-node img").getAttribute("src")'), demoImage);
        assert.equal(await cdp.evaluate('document.querySelector(".videoresult-node video").getAttribute("src")'), demoVideo);
        assert.ok(await cdp.evaluate('document.querySelector(".videoresult-node video").videoWidth > 0'), 'Example video metadata must decode');
        assert.equal(await cdp.evaluate('document.getElementById("publishApiExampleBtn").hidden'), true);
        assert.equal(await cdp.evaluate('document.getElementById("apiGoogleKey").value'), '');
        assert.equal(await cdp.evaluate('sessionStorage.getItem("diffusionCanvas_sessionBoardId")'), demoBoardId, 'API mode must not overwrite the existing login-mode preference');
        await cdp.evaluate('document.getElementById("addPromptNode").click()');
        assert.equal(await fs.readFile(path.join(appDir, 'data', 'api-example.json'), 'utf8'), published, 'Visitor edits must not change the example');
        await fs.rm(filename);
        await cdp.evaluate('document.getElementById("downloadBoardBtn").click()');
        for (let i = 0; i < 100; i++) { try { await fs.access(filename); break; } catch {} await sleep(50); }
        const exampleExport = JSON.parse(await fs.readFile(filename, 'utf8'));
        assert.equal(exampleExport.state.nodes[0].data.imageData, demoImage);
        assert.equal(exampleExport.state.nodes[1].data.videoData, demoVideo);
        await cdp.evaluate('import("/modules/ApiSession.js").then(session => session.apiFetch("/api/user"))');
        const secondRequest = cdp.requests.filter(request => request.url === base + '/api/user').at(-1);
        const secondToken = Object.entries(secondRequest.headers).find(([name]) => name.toLowerCase() === 'x-api-session')?.[1];
        assert.ok(secondToken);
        await cdp.send('Page.reload');
        await sleep(1000);
        assert.equal(await cdp.evaluate('document.body.classList.contains("api-mode")'), false);
        assert.equal(await cdp.evaluate('document.getElementById("apiGoogleKey").value'), '');
        assert.equal((await fetch(base + '/api/user', { headers: { 'X-Api-Session': secondToken } })).status, 401);
        assert.deepEqual(cdp.exceptions, []);
    } finally {
        cdp?.socket.close();
        for (const child of [browser, server]) {
            if (child && child.exitCode === null) {
                const exit = once(child, 'exit');
                child.kill();
                await exit;
            }
        }
        await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});