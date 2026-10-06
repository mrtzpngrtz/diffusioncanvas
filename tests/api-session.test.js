import test from 'node:test';
import assert from 'node:assert/strict';

test('browser API session remains in memory, strips cookies, and never leaks to third parties', async () => {
    const requests = [];
    const listeners = new Map();
    const events = [];
    const persistent = new Map([['theme', 'dark']]);
    globalThis.window = {
        location: { href: 'http://localhost:3000/', origin: 'http://localhost:3000', reload() {} },
        addEventListener: (name, listener) => listeners.set(name, listener),
        dispatchEvent: event => events.push(event.type)
    };
    globalThis.localStorage = {
        getItem: key => persistent.get(key) || null,
        setItem: (key, value) => persistent.set(key, value)
    };
    const originalFetch = globalThis.fetch;
    let expire = false;
    globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        if (url === '/api/api-mode' && options.method === 'POST') return Response.json({ token: 'memory-token', user: { displayName: 'API mode' } });
        if (expire) return Response.json({ error: 'expired' }, { status: 401 });
        return Response.json({ ok: true });
    };
    try {
        const { startApiMode, endApiMode, isApiMode, apiFetch, getPreference, setPreference } = await import('../modules/ApiSession.js');
        assert.equal(getPreference('theme'), 'dark');
        await startApiMode({ googleApiKey: 'secret' });
        assert.equal(isApiMode(), true);
        assert.equal(requests[0].options.credentials, 'omit');
        assert.equal(getPreference('theme'), null);
        setPreference('theme', 'light');
        setPreference('promptLibrary', 'private-prompts');
        assert.equal(getPreference('promptLibrary'), 'private-prompts');
        assert.deepEqual([...persistent], [['theme', 'dark']]);
        await apiFetch('/api/generate', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
        const generation = requests.at(-1).options;
        assert.equal(generation.headers.get('X-Api-Session'), 'memory-token');
        assert.equal(generation.credentials, 'omit');
        assert.equal(generation.cache, 'no-store');
        await apiFetch('https://third-party.example/api/generate', { method: 'GET' });
        assert.equal(requests.at(-1).options.headers, undefined);
        await endApiMode();
        assert.equal(isApiMode(), false);
        assert.equal(requests.at(-1).options.headers['X-Api-Session'], 'memory-token');
        assert.equal(requests.at(-1).options.keepalive, true);
        await startApiMode({ openaiApiKey: 'second-secret' });
        assert.equal(getPreference('promptLibrary'), null);
        expire = true;
        await apiFetch('/api/user');
        assert.equal(isApiMode(), false);
        assert.ok(events.includes('api-mode-expired'));
        assert.ok(listeners.has('pagehide'));
    } finally {
        globalThis.fetch = originalFetch;
        delete globalThis.window;
        delete globalThis.localStorage;
    }
});