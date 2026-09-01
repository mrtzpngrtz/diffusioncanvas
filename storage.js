import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from 'redis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR      = path.join(__dirname, 'data');
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BOARDS_FILE   = path.join(DATA_DIR, 'boards.json');  // metadata only — no state

const MAX_VERSIONS = 40;

// ── File helpers ─────────────────────────────────────────────────────────────

async function readJSON(file, fallback) {
    try {
        const data = await fs.readFile(file, 'utf-8');
        return JSON.parse(data);
    } catch {
        return fallback;
    }
}

async function writeJSON(file, data) {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// An autosave every 30s would otherwise rotate real history out of the ring
// within minutes, even while nothing on the canvas changes.
function sameSnapshot(entry, snapshot) {
    if (!entry) return false;
    try { return JSON.stringify(entry.state) === JSON.stringify(snapshot); }
    catch { return false; }
}

function stateFile(boardId)    { return path.join(DATA_DIR, `state_${boardId}.json`); }
function versionsFile(boardId) { return path.join(DATA_DIR, `versions_${boardId}.json`); }

// ── Per-user write lock ───────────────────────────────────────────────────────
// The board list is stored as one blob per user, so every write is a
// read-modify-write of the whole list. Two overlapping requests (two tabs both
// autosaving) would otherwise drop one another's changes: serialise them.

const userLocks = new Map();

async function withUserLock(userId, fn) {
    const previous = userLocks.get(userId) || Promise.resolve();
    let release;
    const current = previous.then(() => new Promise(r => { release = r; }));
    userLocks.set(userId, current);
    await previous.catch(() => {});
    try {
        return await fn();
    } finally {
        release();
        // let the map shrink again once this user goes quiet
        if (userLocks.get(userId) === current) userLocks.delete(userId);
    }
}

// ── Redis client (lazy) ───────────────────────────────────────────────────────

let redis = null;

async function getRedis() {
    if (redis) return redis;
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', (err) => console.error('Redis error:', err));
    await redis.connect();
    return redis;
}

const useRedis = () => !!process.env.REDIS_URL;

// ── Storage API ───────────────────────────────────────────────────────────────

export const storage = {
    async getUsers() {
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get('users');
            return val ? JSON.parse(val) : [];
        }
        return readJSON(USERS_FILE, []);
    },

    async setUsers(users) {
        if (useRedis()) {
            const r = await getRedis();
            await r.set('users', JSON.stringify(users));
            return;
        }
        await writeJSON(USERS_FILE, users);
    },

    async getSettings() {
        const defaults = {
            modelCosts: {
                'gemini-3.1-flash-image': 4,
                'gemini-3-pro-image': 6,
                'gemini-2.5-flash-image': 2,
                'imagen-4.0-ultra-generate-001': 3,
                'imagen-4.0-fast-generate-001': 2,
                'gpt-image-2-2026-04-21': 3,
                'flux-2-max': 6,
                'flux-2-pro-preview': 5,
                'flux-2-pro': 5,
                'flux-2-flex': 4,
                'flux-2-klein-9b-preview': 3,
                'flux-2-klein-9b': 3,
                // Video models (per generation)
                'bytedance/seedance-2.0': 8,
                'bytedance/seedance-2.0-fast': 4,
                'bytedance/seedance-2.5': 8,
                'gemini-omni-1.1-flash': 6,
                // Image → 3D (Replicate)
                'fishwowater/trellis2': 6,
                'tencent/hunyuan-3d-3.1': 8,
                'prunaai/hunyuan3d-2': 3,
                'firtoz/trellis': 3,
                'hyper3d/rodin': 10,
                // LLM chat (per message)
                'anthropic/claude-sonnet-5': 1,
                'anthropic/claude-opus-5': 2,
                'google/gemini-3.7-flash': 1
            }
        };
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get('settings');
            const saved = val ? JSON.parse(val) : {};
            return { ...defaults, ...saved, modelCosts: { ...defaults.modelCosts, ...(saved.modelCosts || {}) } };
        }
        const saved = await readJSON(SETTINGS_FILE, {});
        return { ...defaults, ...saved, modelCosts: { ...defaults.modelCosts, ...(saved.modelCosts || {}) } };
    },

    async setSettings(settings) {
        if (useRedis()) {
            const r = await getRedis();
            await r.set('settings', JSON.stringify(settings));
            return;
        }
        await writeJSON(SETTINGS_FILE, settings);
    },

    // Run a read-modify-write of one user's boards without another request
    // interleaving. Everything that reads boards and then writes them back
    // belongs inside this.
    withUserLock,

    // Returns board metadata only (no state) — fast, small file
    async getBoards(userId) {
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get(`boards:${userId}`);
            return val ? JSON.parse(val) : [];
        }
        const all = await readJSON(BOARDS_FILE, {});
        return (all[userId] || []).map(({ state, ...meta }) => meta); // strip state if still embedded
    },

    // Saves metadata to boards.json; state to separate per-board file
    async setBoards(userId, boards) {
        const meta = [];
        for (const board of boards) {
            const { state, ...rest } = board;
            meta.push(rest);
            if (state !== undefined) {
                if (useRedis()) {
                    const r = await getRedis();
                    await r.set(`state:${board.id}`, JSON.stringify(state));
                } else {
                    await writeJSON(stateFile(board.id), state);
                }
            }
        }

        if (useRedis()) {
            const r = await getRedis();
            await r.set(`boards:${userId}`, JSON.stringify(meta));
            return;
        }
        const all = await readJSON(BOARDS_FILE, {});
        all[userId] = meta;
        await writeJSON(BOARDS_FILE, all);
    },

    // Read full state for a single board — per-board file, never touches boards.json
    async getBoardState(boardId) {
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get(`state:${boardId}`);
            return val ? JSON.parse(val) : null;
        }
        return readJSON(stateFile(boardId), null);
    },

    async getVersions(userId, boardId) {
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get(`versions:${userId}:${boardId}`);
            const list = val ? JSON.parse(val) : [];
            return list.map(({ savedAt }) => ({ savedAt }));
        }
        const list = await readJSON(versionsFile(boardId), []);
        return list.map(({ savedAt }) => ({ savedAt }));
    },

    async pushVersion(userId, boardId, snapshot) {
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get(`versions:${userId}:${boardId}`);
            const list = val ? JSON.parse(val) : [];
            if (sameSnapshot(list[0], snapshot)) return;
            list.unshift({ savedAt: new Date().toISOString(), state: snapshot });
            await r.set(`versions:${userId}:${boardId}`, JSON.stringify(list.slice(0, MAX_VERSIONS)));
            return;
        }
        const file = versionsFile(boardId);
        const list = await readJSON(file, []);
        if (sameSnapshot(list[0], snapshot)) return;
        list.unshift({ savedAt: new Date().toISOString(), state: snapshot });
        await writeJSON(file, list.slice(0, MAX_VERSIONS));
    },

    async getVersionState(userId, boardId, index) {
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get(`versions:${userId}:${boardId}`);
            const list = val ? JSON.parse(val) : [];
            return list[index]?.state || null;
        }
        const list = await readJSON(versionsFile(boardId), []);
        return list[index]?.state || null;
    },

    // ── Image blob storage (keeps board state lean) ───────────────────────────

    async saveImage(id, dataUrl) {
        if (useRedis()) {
            const r = await getRedis();
            await r.set(`image:${id}`, dataUrl);
            return;
        }
        const dir = path.join(DATA_DIR, 'images');
        await fs.mkdir(dir, { recursive: true });
        // Store raw binary to avoid double-base64 waste
        const base64 = dataUrl.split(',')[1] || '';
        const mime   = (dataUrl.split(';')[0] || 'data:image/png').slice(5);
        const ext    = mime.split('/')[1] || 'png';
        await fs.writeFile(path.join(dir, `${id}.${ext}`), Buffer.from(base64, 'base64'));
        await fs.writeFile(path.join(dir, `${id}.mime`), mime, 'utf-8');
    },

    async getImage(id) {
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get(`image:${id}`);
            if (!val) return null;
            const mime = (val.split(';')[0] || 'data:image/png').slice(5);
            const base64 = val.split(',')[1] || '';
            return { buffer: Buffer.from(base64, 'base64'), mimeType: mime };
        }
        const dir = path.join(DATA_DIR, 'images');
        try {
            const files = await fs.readdir(dir);
            const imgFile = files.find(f => f.startsWith(id + '.') && !f.endsWith('.mime'));
            if (!imgFile) return null;
            const mime = await fs.readFile(path.join(dir, `${id}.mime`), 'utf-8').catch(() => 'image/png');
            const buffer = await fs.readFile(path.join(dir, imgFile));
            return { buffer, mimeType: mime };
        } catch { return null; }
    },

    // Every stored image blob, newest first. Blobs are content-addressed and not
    // owned by a user, so this is admin-only territory.
    async listImages(limit = 5000) {
        if (useRedis()) {
            const r = await getRedis();
            const out = [];
            // node-redis v5 yields a batch of keys per step, v4 a single key
            for await (const step of r.scanIterator({ MATCH: 'image:*', COUNT: 200 })) {
                for (const key of Array.isArray(step) ? step : [step]) {
                    const name = String(key);
                    // data-URL length, so ~4/3 of the real image bytes
                    let bytes = 0;
                    try { bytes = await r.strLen(name); } catch {}
                    out.push({ id: name.slice('image:'.length), bytes, mtime: null, ext: null });
                }
                if (out.length >= limit) break;
            }
            return out;
        }

        const dir = path.join(DATA_DIR, 'images');
        let files;
        try { files = await fs.readdir(dir); }
        catch { return []; }

        const out = [];
        for (const file of files) {
            if (file.endsWith('.mime')) continue;
            const dot = file.lastIndexOf('.');
            if (dot < 0) continue;
            try {
                const stat = await fs.stat(path.join(dir, file));
                out.push({
                    id: file.slice(0, dot),
                    ext: file.slice(dot + 1),
                    bytes: stat.size,
                    mtime: stat.mtimeMs
                });
            } catch {}
        }
        out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
        return out.slice(0, limit);
    },

    async init() {
        await fs.mkdir(DATA_DIR, { recursive: true });
        if (useRedis()) {
            await getRedis();
            console.log('✓ Redis storage ready');
            return;
        }
        for (const [file, fallback] of [
            [USERS_FILE, []],
            [BOARDS_FILE, {}],
        ]) {
            try { await fs.access(file); }
            catch { await writeJSON(file, fallback); }
        }
        try { await fs.access(SETTINGS_FILE); }
        catch { await this.setSettings({}); }

        // One-time migration: extract state from old boards.json and versions.json
        await this._migrate();
        console.log('✓ Local file storage ready');
    },

    async _migrate() {
        // Migrate boards.json: move embedded state to per-board files
        const all = await readJSON(BOARDS_FILE, {});
        let boardsDirty = false;
        for (const boards of Object.values(all)) {
            for (const board of boards) {
                if (board.state) {
                    const sf = stateFile(board.id);
                    try { await fs.access(sf); }
                    catch { await writeJSON(sf, board.state); }
                    delete board.state;
                    boardsDirty = true;
                }
            }
        }
        if (boardsDirty) await writeJSON(BOARDS_FILE, all);

        // Migrate versions.json: move per-key version lists to per-board files
        const VERSIONS_FILE = path.join(DATA_DIR, 'versions.json');
        const oldVersions = await readJSON(VERSIONS_FILE, {});
        for (const [key, list] of Object.entries(oldVersions)) {
            const boardId = key.split('::')[1];
            if (!boardId) continue;
            const vf = versionsFile(boardId);
            try { await fs.access(vf); }
            catch { await writeJSON(vf, list); }
        }
    }
};
