import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function freePort() {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function snapshot(dir) {
    const result = {};
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        const filename = path.join(dir, item.name);
        if (item.isDirectory()) result[item.name] = await snapshot(filename);
        else result[item.name] = await fs.readFile(filename, 'utf8');
    }
    return result;
}

test('live Express API mode: own provider keys, no persistence, isolated jobs, and account regression', { timeout: 60000 }, async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-api-mode-test-'));
    let child;
    let output = '';
    try {
        for (const name of ['package.json', 'server.js', 'auth.js', 'jwt-auth.js', 'storage.js', 'api-mode.js', 'index.html', 'modules', 'providers', 'workflows']) {
            await fs.cp(path.join(root, name), path.join(temp, name), { recursive: true });
        }
        await fs.symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
        await fs.mkdir(path.join(temp, 'data'));
        const password = await bcrypt.hash('test-password', 4);
        await fs.writeFile(path.join(temp, 'data', 'users.json'), JSON.stringify([{ id: 'account-user', email: 'test@example.test', password, provider: 'local', displayName: 'Account user', isAdmin: false, credits: 20 }]));
        await fs.writeFile(path.join(temp, 'data', 'settings.json'), JSON.stringify({ modelCosts: { 'gemini-3.1-flash-image': 4 } }));
        const port = await freePort();
        const providerLog = path.join(temp, 'provider.log');
        child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'tests', 'fixtures', 'providers.js')).href, path.join(temp, 'server.js')], {
            cwd: temp,
            env: { ...process.env, NODE_ENV: 'test', PORT: String(port), SESSION_SECRET: 'test-only-secret', REDIS_URL: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', FACEBOOK_APP_ID: '', LINKEDIN_CLIENT_ID: '', DC_PROVIDER_LOG: providerLog,
                GOOGLE_API_KEY: 'host-google', OPENAI_API_KEY: 'host-openai', BFL_API_KEY: 'host-bfl', OPENROUTER_API_KEY: 'host-openrouter', REPLICATE_API_TOKEN: 'host-replicate' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        const base = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 100; i++) {
            try { if ((await fetch(`${base}/api/user`)).ok) break; } catch {}
            if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        const call = (route, { token, cookie, body, method = 'GET' } = {}) => fetch(base + route, {
            method,
            headers: { ...(token ? { 'X-Api-Session': token } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        const login = await call('/auth/local/login', { method: 'POST', body: { email: 'test@example.test', password: 'test-password' } });
        assert.equal(login.status, 200, output);
        const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
        const before = await snapshot(path.join(temp, 'data'));
        assert.equal((await call('/api/api-mode', { method: 'POST', body: { apiKeys: {} } })).status, 400);
        const ownKeys = { googleApiKey: 'own-google', openaiApiKey: 'own-openai', bflApiKey: 'own-bfl', openrouterApiKey: 'own-openrouter', replicateApiToken: 'own-replicate' };
        const created = await call('/api/api-mode', { method: 'POST', cookie, body: { apiKeys: ownKeys } });
        assert.equal(created.status, 200);
        assert.equal(created.headers.get('set-cookie'), null);
        assert.equal(created.headers.get('cache-control'), 'no-store');
        const { token, user } = await created.json();
        assert.equal(user.isAdmin, false);
        assert.equal(user.isApiMode, true);
        assert.equal((await (await call('/api/user', { token, cookie })).json()).user.id, user.id);
        for (const route of ['/api/boards', '/api/images', '/api/admin/settings', '/api/feedback', '/api/user/delete', '/api/agent/tasks', '/api/share/access/123']) {
            for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await call(route, { token, cookie, method, body: method === 'POST' ? { state: 'private' } : undefined })).status, 403, route);
        }
        assert.equal((await call('/api/generate', { method: 'POST', body: { prompt: 'no auth' } })).status, 401);
        for (const model of ['gemini-3.1-flash-image', 'gpt-image-2-2026-04-21', 'flux-2-pro']) {
            const res = await call('/api/generate', { token, method: 'POST', body: { model, prompt: 'PRIVATE_TEST_PROMPT' } });
            assert.equal(res.status, 200, await res.clone().text());
            const data = await res.json();
            assert.ok(data.image.startsWith('data:image/'));
            assert.equal(data.creditsRemaining, undefined);
        }
        const chat = await call('/api/chat', { token, method: 'POST', body: { model: 'openai/gpt-4o-mini', messages: [{ role: 'user', text: 'Private chat' }] } });
        assert.equal(chat.status, 200);
        assert.equal((await chat.json()).text, 'Mock assistant reply');
        const second = await (await call('/api/api-mode', { method: 'POST', body: { apiKeys: { googleApiKey: 'second-google' } } })).json();
        for (const model of ['gpt-image-2-2026-04-21', 'flux-2-pro']) {
            const missing = await call('/api/generate', { token: second.token, cookie, method: 'POST', body: { model, prompt: 'Missing key' } });
            assert.equal(missing.status, 500);
        }
        assert.equal((await call('/api/chat', { token: second.token, method: 'POST', body: { model: 'openai/gpt-4o-mini', messages: [{ text: 'Missing key' }] } })).status, 500);
        for (const [route, body, resultField] of [
            ['/api/generate-video', { model: 'bytedance/seedance-2.0', prompt: 'Private video' }, 'video'],
            ['/api/generate-3d', { model: 'fishwowater/trellis2', image: 'data:image/png;base64,aW1hZ2U=' }, 'modelData']
        ]) {
            const submitted = await call(route, { token, method: 'POST', body });
            assert.equal(submitted.status, 202, await submitted.clone().text());
            const { jobId, cost } = await submitted.json();
            assert.equal(cost, 0);
            assert.equal((await call(`/api/video-jobs/${jobId}`, { token: second.token })).status, 404);
            let completed;
            for (let i = 0; i < 100; i++) {
                completed = await (await call(`/api/video-jobs/${jobId}`, { token })).json();
                if (['completed', 'failed'].includes(completed.status)) break;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            assert.equal(completed.status, 'completed', JSON.stringify(completed));
            assert.ok(completed[resultField]);
            assert.equal((await call(`/api/video-jobs/${jobId}`, { token })).status, 404);
        }
        assert.deepEqual(await snapshot(path.join(temp, 'data')), before, 'API mode changed persistent data');
        const providerCalls = (await fs.readFile(providerLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        for (const key of Object.values(ownKeys)) assert.ok(providerCalls.some(call => call.key.includes(key)), `Key not used: ${key}`);
        assert.ok(providerCalls.every(call => !call.key.includes('host-')));
        assert.ok(!output.includes('PRIVATE_TEST_PROMPT'));
        assert.ok(!output.includes('own-google'));
        assert.equal((await call('/api/api-mode', { token, method: 'DELETE' })).status, 204);
        assert.equal((await call('/api/user', { token, cookie })).status, 401, 'Ended session must not fall back to account cookie');
        const accountUser = await (await call('/api/user', { cookie })).json();
        assert.equal(accountUser.user.id, 'account-user');
        const accountImage = await call('/api/generate', { cookie, method: 'POST', body: { model: 'gemini-3.1-flash-image', prompt: 'Account generation' } });
        assert.equal(accountImage.status, 200, await accountImage.clone().text());
        const expectedCredits = 20 - JSON.parse(before['settings.json']).modelCosts['gemini-3.1-flash-image'];
        assert.equal((await accountImage.json()).creditsRemaining, expectedCredits);
        const after = await snapshot(path.join(temp, 'data'));
        assert.equal(JSON.parse(after['users.json'])[0].credits, expectedCredits);
        await call('/api/api-mode', { token: second.token, method: 'DELETE' });
    } finally {
        if (child && child.exitCode === null) {
            const exit = once(child, 'exit');
            child.kill();
            await exit;
        }
        await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});