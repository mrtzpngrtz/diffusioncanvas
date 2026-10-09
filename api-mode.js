import { randomBytes } from 'node:crypto';

export const API_KEY_FIELDS = ['googleApiKey', 'openaiApiKey', 'bflApiKey', 'openrouterApiKey', 'replicateApiToken'];
const IDLE_TTL = 2 * 60 * 60 * 1000;
const MAX_TTL = 24 * 60 * 60 * 1000;

// Deliberately independent of storage, Redis, JWTs and browser cookies.
export class ApiModeSessions {
    constructor({ now = Date.now, onEnd = () => {} } = {}) {
        this.sessions = new Map();
        this.now = now;
        this.onEnd = onEnd;
    }

    validateKeys(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid API key settings.');
        const apiKeys = {};
        for (const field of API_KEY_FIELDS) {
            const value = input[field];
            if (value == null || value === '') continue;
            if (typeof value !== 'string' || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) {
                throw new Error('Invalid API key format.');
            }
            if (value.trim()) apiKeys[field] = value.trim();
        }
        return apiKeys;
    }

    create(input = {}) {
        const apiKeys = this.validateKeys(input);
        this.prune();
        if (this.sessions.size >= 1000) throw new Error('Too many active API sessions. Please try again later.');
        const token = randomBytes(32).toString('hex');
        const session = {
            user: { id: `api-${randomBytes(16).toString('hex')}`, displayName: 'API mode', isAdmin: false, isApiMode: true },
            settings: { apiMode: true, apiKeys, modelCosts: {}, modelPrices: {} },
            createdAt: this.now(), lastUsedAt: this.now()
        };
        this.sessions.set(token, session);
        return { token, session };
    }

    update(token, input) {
        const session = this.get(token);
        if (!session) return null;
        const keys = this.validateKeys(input);
        // Replace atomically. Blank fields remove keys; invalid input changes nothing.
        session.settings.apiKeys = keys;
        return session;
    }

    get(token) {
        const session = this.sessions.get(token);
        if (!session) return null;
        if (this.now() - session.lastUsedAt >= IDLE_TTL || this.now() - session.createdAt >= MAX_TTL) {
            this.end(token);
            return null;
        }
        session.lastUsedAt = this.now();
        return session;
    }

    end(token) {
        const session = this.sessions.get(token);
        if (!session) return;
        this.sessions.delete(token);
        for (const field of Object.keys(session.settings.apiKeys)) delete session.settings.apiKeys[field];
        this.onEnd(session.user.id);
    }

    prune() {
        for (const [token, session] of this.sessions) {
            if (this.now() - session.lastUsedAt >= IDLE_TTL || this.now() - session.createdAt >= MAX_TTL) this.end(token);
        }
    }
}

export function resolveProviderKey(settingsKey, envKey, settings, env = process.env) {
    // Never spend the host's credentials in an anonymous API session.
    return settings?.apiKeys?.[settingsKey] || (settings?.apiMode ? null : env[envKey]) || null;
}

export function apiModeRouteAllowed(method, pathname) {
    if (method === 'PUT') return pathname === '/api/api-mode';
    if (method === 'GET') return ['/api/user', '/api/config', '/api/workflows', '/api/api-example'].includes(pathname) || /^\/api\/video-jobs\/[^/]+$/.test(pathname);
    if (method === 'POST') return ['/api/generate', '/api/generate-video', '/api/generate-3d', '/api/chat'].includes(pathname);
    return method === 'DELETE' && pathname === '/api/api-mode';
}

// Resolve media before publishing. A missing blob must not replace a working
// example with a broken one; private blob routes remain blocked in API mode.
export async function createApiExample(name, state, getImage) {
    if (!state?.version || !Array.isArray(state.nodes) || !state.nodes.length) {
        throw new Error('Save a non-empty board before publishing it as the API example.');
    }
    const copy = structuredClone(state);
    const blobs = new Map();
    for (const node of copy.nodes) {
        const data = node.data;
        if (!data || typeof data !== 'object') throw new Error('Invalid board node.');
        for (const [refKey, dataKey] of [['imageRef', 'imageData'], ['videoRef', 'videoData'], ['modelRef', 'modelData']]) {
            const ref = data[refKey];
            if (!ref) continue;
            if (typeof ref !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(ref)) throw new Error('Invalid media reference.');
            if (!blobs.has(ref)) blobs.set(ref, await getImage(ref));
            const blob = blobs.get(ref);
            if (!blob) throw new Error('Board media is missing. Reload and save the board before publishing.');
            if (dataKey === 'modelData') {
                data[dataKey] = ['glb', 'fbx', 'stl'].includes(data.modelType || 'glb')
                    ? blob.buffer.toString('base64') : blob.buffer.toString('utf8');
            } else {
                data[dataKey] = `data:${blob.mimeType};base64,${blob.buffer.toString('base64')}`;
            }
            data[refKey] = null;
        }
    }
    return { name, publishedAt: new Date().toISOString(), state: copy };
}