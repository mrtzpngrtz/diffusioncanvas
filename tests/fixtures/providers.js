// Used only by the isolated integration-test server. No live provider traffic.
import { appendFileSync } from 'node:fs';
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
    const request = input instanceof Request ? input : new Request(input, options);
    const url = new URL(request.url);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, options);
    const key = request.headers.get('x-goog-api-key') || request.headers.get('authorization') || request.headers.get('x-key') || '';
    appendFileSync(process.env.DC_PROVIDER_LOG, JSON.stringify({ url: request.url, key }) + '\n');
    if (url.hostname === 'generativelanguage.googleapis.com') {
        if (url.pathname.includes(':generateImages') || url.pathname.includes(':predict')) {
            return Response.json({ predictions: [{ bytesBase64Encoded: 'aW1hZ2U=', mimeType: 'image/png' }] });
        }
        return Response.json({ candidates: [{ content: { role: 'model', parts: [{ inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } }] } }] });
    }
    if (url.hostname === 'api.openai.com') return Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] });
    if (url.hostname === 'api.bfl.ai') {
        if (url.pathname.includes('get_result')) return Response.json({ status: 'Ready', result: { sample: 'https://test-output.example/image.png' } });
        return Response.json({ id: 'bfl-test', polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl-test' });
    }
    if (url.hostname === 'openrouter.ai') {
        if (url.pathname.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: 'Mock assistant reply' } }] });
        if (request.method === 'POST') return Response.json({ id: 'video-test' });
        return Response.json({ status: 'completed', unsigned_urls: ['https://test-output.example/video.mp4'] });
    }
    if (url.hostname === 'api.replicate.com') {
        if (request.method === 'POST') return Response.json({ status: 'succeeded', output: 'https://test-output.example/mesh.glb' });
        return Response.json({ latest_version: { id: 'test-version', openapi_schema: { components: { schemas: { Input: { properties: { image: { type: 'string' } } } } } } } });
    }
    if (url.hostname === 'test-output.example') return new Response('mock-media', { headers: { 'Content-Type': url.pathname.endsWith('.mp4') ? 'video/mp4' : 'image/png' } });
    throw new Error(`Unexpected provider request: ${request.url}`);
};
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => realTimeout(callback, ms === 1500 || ms === 5000 ? 1 : ms, ...args);