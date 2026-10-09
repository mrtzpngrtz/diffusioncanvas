import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiModeSessions, API_KEY_FIELDS, apiModeRouteAllowed, resolveProviderKey, createApiExample } from '../api-mode.js';

test('sessions accept only supported keys and never create account/admin privileges', () => {
    const sessions = new ApiModeSessions();
    const { token, session } = sessions.create({ googleApiKey: '  own-google  ', githubToken: 'ignored', isAdmin: true });
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.deepEqual(session.settings.apiKeys, { googleApiKey: 'own-google' });
    assert.equal(session.user.isAdmin, false);
    assert.equal(session.user.isApiMode, true);
    assert.equal(session.user.credits, undefined);
    assert.equal(sessions.get(token), session);
    assert.equal(sessions.get('not-a-session'), null);
    const second = sessions.create({ openaiApiKey: 'other' });
    assert.notEqual(second.token, token);
    assert.notEqual(second.session.user.id, session.user.id);
    assert.equal(second.session.settings.apiKeys.googleApiKey, undefined);
});

test('empty sessions open the canvas; malformed credentials are rejected', () => {
    const sessions = new ApiModeSessions();
    for (const input of [null, [], { googleApiKey: 123 }, { googleApiKey: 'key\nvalue' }, { googleApiKey: 'a'.repeat(513) }]) {
        assert.throws(() => sessions.create(input));
    }
    assert.equal(sessions.sessions.size, 0);
    assert.deepEqual(sessions.create().session.settings.apiKeys, {});
    assert.deepEqual(sessions.create({ githubToken: 'ignored' }).session.settings.apiKeys, {});
    for (const field of API_KEY_FIELDS) assert.ok(sessions.create({ [field]: 'test-key' }).token);
});

test('keys can be updated and removed without replacing the session or its jobs', () => {
    const sessions = new ApiModeSessions();
    const { token, session } = sessions.create();
    const id = session.user.id;
    assert.equal(sessions.update(token, { googleApiKey: 'new-key' }), session);
    assert.equal(session.user.id, id);
    assert.deepEqual(session.settings.apiKeys, { googleApiKey: 'new-key' });
    assert.throws(() => sessions.update(token, { googleApiKey: 12 }));
    assert.deepEqual(session.settings.apiKeys, { googleApiKey: 'new-key' });
    sessions.update(token, {});
    assert.deepEqual(session.settings.apiKeys, {});
    assert.equal(sessions.update('invalid', {}), null);
});

test('ending and expiring a session wipes keys and invokes job cleanup', () => {
    let now = 0;
    const ended = [];
    const sessions = new ApiModeSessions({ now: () => now, onEnd: id => ended.push(id) });
    const first = sessions.create({ bflApiKey: 'secret' });
    sessions.end(first.token);
    assert.equal(sessions.get(first.token), null);
    assert.deepEqual(first.session.settings.apiKeys, {});
    assert.deepEqual(ended, [first.session.user.id]);
    sessions.end(first.token);
    assert.equal(ended.length, 1);
    const idle = sessions.create({ replicateApiToken: 'secret' });
    now += 2 * 60 * 60 * 1000;
    sessions.prune();
    assert.equal(sessions.get(idle.token), null);
    assert.deepEqual(idle.session.settings.apiKeys, {});
    const hardLimit = sessions.create({ openaiApiKey: 'secret' });
    for (let hour = 0; hour < 23; hour++) {
        now += 60 * 60 * 1000;
        assert.ok(sessions.get(hardLimit.token));
    }
    now += 60 * 60 * 1000;
    assert.equal(sessions.get(hardLimit.token), null);
});

test('API mode never falls back to host keys; account mode still does', () => {
    const env = { GOOGLE_API_KEY: 'host-key' };
    assert.equal(resolveProviderKey('googleApiKey', 'GOOGLE_API_KEY', { apiMode: true, apiKeys: {} }, env), null);
    assert.equal(resolveProviderKey('googleApiKey', 'GOOGLE_API_KEY', { apiMode: true, apiKeys: { googleApiKey: 'own-key' } }, env), 'own-key');
    assert.equal(resolveProviderKey('googleApiKey', 'GOOGLE_API_KEY', {}, env), 'host-key');
    assert.equal(resolveProviderKey('googleApiKey', 'GOOGLE_API_KEY', { apiKeys: { googleApiKey: 'admin-key' } }, env), 'admin-key');
});

test('only stateless generation, config and owned job routes are allowed', () => {
    assert.equal(apiModeRouteAllowed('GET', '/api/api-example'), true);
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal(apiModeRouteAllowed(method, '/api/api-example'), false);
    for (const path of ['/api/generate', '/api/generate-video', '/api/generate-3d', '/api/chat']) assert.equal(apiModeRouteAllowed('POST', path), true);
    assert.equal(apiModeRouteAllowed('GET', '/api/video-jobs/job-123'), true);
    assert.equal(apiModeRouteAllowed('DELETE', '/api/api-mode'), true);
    assert.equal(apiModeRouteAllowed('PUT', '/api/api-mode'), true);
    for (const path of ['/api/boards', '/api/images', '/api/admin/settings', '/api/feedback', '/api/user/delete', '/api/share/access/123', '/api/agent/tasks']) {
        for (const method of ['GET', 'POST', 'DELETE', 'PATCH']) assert.equal(apiModeRouteAllowed(method, path), false);
    }
});

test('published example embeds deduplicated image, video and model blobs without changing its source', async () => {
    const state = { version: '1.0', nodes: [
        { type: 'image', data: { imageRef: 'image-1' } },
        { type: 'result', data: { imageRef: 'image-1' } },
        { type: 'videoresult', data: { videoRef: 'video-1' } },
        { type: 'threed', data: { modelRef: 'model-1', modelType: 'glb' } },
        { type: 'threed', data: { modelRef: 'text-1', modelType: 'obj' } }
    ], connections: [{ from: 'a', to: 'b' }], areas: [{ title: 'Example' }] };
    const original = structuredClone(state);
    const calls = [];
    const example = await createApiExample('Demo', state, async id => {
        calls.push(id);
        return { buffer: Buffer.from(id), mimeType: id === 'video-1' ? 'video/mp4' : 'image/png' };
    });
    assert.deepEqual(state, original);
    assert.deepEqual(calls, ['image-1', 'video-1', 'model-1', 'text-1']);
    assert.equal(example.name, 'Demo');
    assert.ok(example.publishedAt);
    assert.equal(example.state.nodes[0].data.imageData, 'data:image/png;base64,' + Buffer.from('image-1').toString('base64'));
    assert.equal(example.state.nodes[2].data.videoData, 'data:video/mp4;base64,' + Buffer.from('video-1').toString('base64'));
    assert.equal(example.state.nodes[3].data.modelData, Buffer.from('model-1').toString('base64'));
    assert.equal(example.state.nodes[4].data.modelData, 'text-1');
    for (const node of example.state.nodes) assert.ok(!node.data.imageRef && !node.data.videoRef && !node.data.modelRef);
    assert.deepEqual(example.state.connections, state.connections);
    assert.deepEqual(example.state.areas, state.areas);
});

test('publication rejects empty boards, missing media and unsafe blob references', async () => {
    for (const state of [null, {}, { version: '1.0', nodes: [] }]) {
        await assert.rejects(createApiExample('Demo', state, async () => null), /non-empty/);
    }
    await assert.rejects(createApiExample('Demo', { version: '1.0', nodes: [{ data: { imageRef: 'missing' } }] }, async () => null), /media is missing/);
    await assert.rejects(createApiExample('Demo', { version: '1.0', nodes: [{ data: { imageRef: '../private' } }] }, async () => assert.fail('Unsafe reference reached storage')), /Invalid media reference/);
});