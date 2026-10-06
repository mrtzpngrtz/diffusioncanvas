import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';

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
        const port = await freePort();
        const debugPort = await freePort();
        server = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'tests', 'fixtures', 'providers.js')).href, path.join(appDir, 'server.js')], {
            cwd: appDir,
            env: { ...process.env, PORT: String(port), NODE_ENV: 'test', SESSION_SECRET: 'browser-test-secret', REDIS_URL: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', DC_PROVIDER_LOG: path.join(temp, 'provider.log') },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        server.stdout.on('data', chunk => { output += chunk; });
        server.stderr.on('data', chunk => { output += chunk; });
        const base = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 100; i++) {
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
        const preferences = await cdp.evaluate('JSON.stringify(Object.entries(localStorage))');
        const start = async () => {
            await cdp.evaluate('document.querySelector(".api-mode-entry").open = true; document.getElementById("apiGoogleKey").value = "browser-google-key"; document.getElementById("apiModeForm").requestSubmit();');
            for (let i = 0; i < 100; i++) {
                if (await cdp.evaluate('document.body.classList.contains("api-mode")')) return;
                await sleep(50);
            }
            throw new Error(`API form did not start: ${await cdp.evaluate('document.getElementById("apiModeError").textContent')} ${JSON.stringify(cdp.exceptions)}`);
        };
        await start();
        assert.equal(await cdp.evaluate('document.getElementById("loginModal").classList.contains("hidden")'), true);
        assert.equal(await cdp.evaluate('document.getElementById("apiGoogleKey").value'), '');
        assert.equal(await cdp.evaluate('getComputedStyle(document.getElementById("saveBoardBtn")).display'), 'none');
        assert.notEqual(await cdp.evaluate('getComputedStyle(document.getElementById("downloadBoardBtn")).display'), 'none');
        await cdp.evaluate('document.getElementById("addPromptNode").click(); document.getElementById("themeToggle").click();');
        assert.equal(await cdp.evaluate('document.querySelectorAll(".prompt-node").length'), 1);
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
        await start();
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