import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
        const data = JSON.parse(event.data);
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        clearTimeout(request.timer);
        if (data.error) request.reject(new Error(JSON.stringify(data.error)));
        else request.resolve(data.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    return { socket, send, evaluate };
}

test('real Electron: opens board without keys, edits temporary APIs, keeps boards and clears keys on reload', { timeout: 120000 }, async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-electron-test-'));
    let electron;
    let cdp;
    let output = '';
    try {
        const profile = path.join(temp, 'profile');
        await fs.mkdir(profile);
        const listener = net.createServer();
        listener.listen(0, '127.0.0.1');
        await once(listener, 'listening');
        const debugPort = listener.address().port;
        await new Promise(resolve => listener.close(resolve));
        const executable = process.env.DC_TEST_ELECTRON || path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
        const env = { ...process.env, DC_DESKTOP_USER_DATA: profile, REDIS_URL: '', PORT: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', DC_PROVIDER_LOG: path.join(temp, 'providers.log'), GOOGLE_API_KEY: 'host-key', NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'tests', 'fixtures', 'providers.js')).href}` };
        delete env.ELECTRON_RUN_AS_NODE;
        const args = [...(process.env.DC_TEST_ELECTRON ? [] : [path.join(root, 'desktop', 'main.js')]), `--remote-debugging-port=${debugPort}`];
        electron = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
        electron.stdout.on('data', chunk => { output += chunk; });
        electron.stderr.on('data', chunk => { output += chunk; });
        let target;
        for (let i = 0; i < 200; i++) {
            try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.startsWith('http://127.0.0.1:')); } catch {}
            if (target) break;
            if (electron.exitCode !== null) throw new Error(output);
            await sleep(100);
        }
        assert.ok(target, `Electron did not open: ${output}`);
        cdp = await connect(target.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        for (let i = 0; i < 150; i++) {
            if (await cdp.evaluate('document.body.classList.contains("desktop-mode") && document.getElementById("loginModal").classList.contains("hidden")')) break;
            await sleep(200);
        }
        assert.equal(await cdp.evaluate('document.getElementById("loginModal").classList.contains("hidden")'), true, output);
        assert.equal(await cdp.evaluate('document.getElementById("apiSettingsBtn").hidden'), false);
        assert.equal(await cdp.evaluate('import("/modules/ApiSession.js").then(s => JSON.stringify(s.getApiKeys()))'), '{}');
        const before = await cdp.evaluate('JSON.stringify(Object.entries(localStorage))');
        await cdp.evaluate('document.getElementById("addPromptNode").click(); document.getElementById("apiSettingsBtn").click(); document.getElementById("apiGoogleKey").value="electron-secret"; document.getElementById("apiModeForm").requestSubmit();');
        for (let i = 0; i < 100; i++) {
            if (await cdp.evaluate('!document.getElementById("apiSettingsModal").classList.contains("active")')) break;
            await sleep(50);
        }
        assert.equal(await cdp.evaluate('document.querySelectorAll(".prompt-node").length'), 1);
        assert.equal(await cdp.evaluate('import("/modules/ApiSession.js").then(s => s.getApiKeys().googleApiKey)'), 'electron-secret');
        assert.equal(await cdp.evaluate('JSON.stringify(Object.entries(localStorage))'), before);
        const persistedKeyAttempt = await cdp.evaluate('fetch("/api/admin/settings", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKeys:{googleApiKey:"must-not-persist"}})}).then(r=>r.status)');
        assert.equal(persistedKeyAttempt, 200);
        assert.equal(await cdp.evaluate('fetch("/api/admin/settings").then(r=>r.json()).then(s=>JSON.stringify(s.apiKeys))'), '{}');
        const board = await cdp.evaluate('import("/modules/ApiSession.js").then(async s => { const r = await s.apiFetch("/api/boards", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"Electron board",state:{nodes:[],connections:[]}})}); return {status:r.status,data:await r.json()}; })');
        assert.equal(board.status, 200, JSON.stringify(board));
        // Packaged Electron disables NODE_OPTIONS preloads. Never send fake keys
        // to real providers: generation is exercised only with the dev mock.
        if (!process.env.DC_TEST_ELECTRON) {
            const generation = await cdp.evaluate('import("/modules/ApiSession.js").then(async s => { const r = await s.apiFetch("/api/generate", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"gemini-3.1-flash-image",prompt:"Desktop test"})}); return {status:r.status,data:await r.json()}; })');
            assert.equal(generation.status, 200, JSON.stringify(generation));
            const log = await fs.readFile(path.join(temp, 'providers.log'), 'utf8');
            assert.ok(log.includes('electron-secret'));
            assert.ok(!log.includes('host-key'));
        }
        await cdp.send('Page.reload');
        await sleep(1500);
        assert.equal(await cdp.evaluate('import("/modules/ApiSession.js").then(s => JSON.stringify(s.getApiKeys()))'), '{}');
        const missing = await cdp.evaluate('import("/modules/ApiSession.js").then(async s => (await s.apiFetch("/api/generate", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"gemini-3.1-flash-image",prompt:"No keys"})})).status)');
        assert.equal(missing, 500);
        for (const file of await fs.readdir(path.join(profile, 'data'), { recursive: true })) {
            const filename = path.join(profile, 'data', file);
            if ((await fs.stat(filename)).isFile()) assert.ok(!(await fs.readFile(filename, 'utf8')).includes('electron-secret'), filename);
            if ((await fs.stat(filename)).isFile()) assert.ok(!(await fs.readFile(filename, 'utf8')).includes('must-not-persist'), filename);
        }
        assert.ok(!output.includes('electron-secret'));
        await cdp.send('Runtime.evaluate', { expression: 'window.close()' });
    } finally {
        cdp?.socket.close();
        if (electron && electron.exitCode === null) {
            await Promise.race([once(electron, 'exit'), sleep(3000)]);
            if (electron.exitCode === null) { const exited = once(electron, 'exit'); electron.kill(); await exited; }
        }
        await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
});