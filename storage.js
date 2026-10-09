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
const USAGE_FILE    = path.join(DATA_DIR, 'usage.json');   // one entry per generation
const API_EXAMPLE_FILE = path.join(DATA_DIR, 'api-example.json');

const MAX_USAGE_ENTRIES = 50000;

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
    // An explicitly published, self-contained copy, never a live private board.
    async getApiExample() {
        if (useRedis()) {
            const r = await getRedis();
            const value = await r.get('api-example');
            return value ? JSON.parse(value) : null;
        }
        return readJSON(API_EXAMPLE_FILE, null);
    },

    async setApiExample(example) {
        await withUserLock('__api_example__', async () => {
            if (useRedis()) {
                const r = await getRedis();
                if (example) await r.set('api-example', JSON.stringify(example));
                else await r.del('api-example');
                return;
            }
            if (!example) {
                await fs.rm(API_EXAMPLE_FILE, { force: true });
                return;
            }
            const temp = `${API_EXAMPLE_FILE}.tmp`;
            await writeJSON(temp, example);
            await fs.rename(temp, API_EXAMPLE_FILE);
        });
    },

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
            },
            // Estimated provider cost in USD per generation, used for cost
            // tracking. Video entries are per second of output; everything else
            // is per run. Editable in the admin panel — see PRICE_NOTES in
            // admin.html for where each number comes from.
            modelPrices: {
                'gemini-3.1-flash-image': 0.101,
                'gemini-3-pro-image': 0.134,
                'gemini-2.5-flash-image': 0.039,
                'imagen-4.0-ultra-generate-001': 0.06,
                'imagen-4.0-fast-generate-001': 0.02,
                'gpt-image-2-2026-04-21': 0.053,
                'flux-2-max': 0.07,
                'flux-2-pro-preview': 0.03,
                'flux-2-pro': 0.03,
                'flux-2-flex': 0.05,
                'flux-2-klein-9b-preview': 0.015,
                'flux-2-klein-9b': 0.015,
                // per second of video
                'bytedance/seedance-2.0': 0.10,
                'bytedance/seedance-2.0-fast': 0.05,
                'bytedance/seedance-2.5': 0.10,
                'gemini-omni-1.1-flash': 0.10,
                // per run on Replicate
                'fishwowater/trellis2': 1.09,
                'tencent/hunyuan-3d-3.1': 0.40,
                'prunaai/hunyuan3d-2': 0.20,
                'firtoz/trellis': 0.10,
                'hyper3d/rodin': 0.50,
                // per chat message
                'anthropic/claude-sonnet-5': 0.011,
                'anthropic/claude-opus-5': 0.028,
                'google/gemini-3.7-flash': 0.004
            },
            apiKeys: {
                openrouterApiKey: '',
                anthropicApiKey: '',
                githubToken: ''
            },
            agentSettings: {
                model: 'sonnet'
            },
            chatSettings: {
                defaultModel: 'anthropic/claude-sonnet-5'
            }
        };
        let saved = {};
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get('settings');
            saved = val ? JSON.parse(val) : {};
        } else {
            saved = await readJSON(SETTINGS_FILE, {});
        }
        return {
            ...defaults,
            ...saved,
            modelCosts: { ...defaults.modelCosts, ...(saved.modelCosts || {}) },
            modelPrices: { ...defaults.modelPrices, ...(saved.modelPrices || {}) },
            apiKeys: { ...defaults.apiKeys, ...(saved.apiKeys || {}) },
            agentSettings: { ...defaults.agentSettings, ...(saved.agentSettings || {}) },
            chatSettings: { ...defaults.chatSettings, ...(saved.chatSettings || {}) }
        };
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
    // Find a board and its owner userId by boardId
    async findBoard(boardId) {
        if (useRedis()) {
            const r = await getRedis();
            const users = await this.getUsers();
            for (const u of users) {
                const val = await r.get(`boards:${u.id}`);
                const list = val ? JSON.parse(val) : [];
                const b = list.find(item => item.id === boardId);
                if (b) return { board: b, userId: u.id };
            }
            return null;
        }
        const all = await readJSON(BOARDS_FILE, {});
        for (const [userId, boards] of Object.entries(all)) {
            const b = boards.find(item => item.id === boardId);
            if (b) return { board: b, userId };
        }
        return null;
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

    // Blob ids are content hashes, so a re-upload carries identical bytes.
    // Writing it again would only reset the file's mtime — and that mtime is
    // the one honest record of when the image was made.
    async saveImage(id, dataUrl) {
        if (useRedis()) {
            const r = await getRedis();
            if (await r.exists(`image:${id}`)) return;
            await r.set(`image:${id}`, dataUrl);
            // Redis keys carry no timestamp of their own — keep one alongside
            await r.set(`image_ts:${id}`, String(Date.now()));
            return;
        }
        const dir = path.join(DATA_DIR, 'images');
        await fs.mkdir(dir, { recursive: true });
        // Store raw binary to avoid double-base64 waste
        const base64 = dataUrl.split(',')[1] || '';
        const mime   = (dataUrl.split(';')[0] || 'data:image/png').slice(5);
        const ext    = mime.split('/')[1] || 'png';
        const file   = path.join(dir, `${id}.${ext}`);
        try {
            await fs.access(file);
            return; // already stored — leave it, and its mtime, alone
        } catch {}
        await fs.writeFile(file, Buffer.from(base64, 'base64'));
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

    // ── Usage log ─────────────────────────────────────────────────────────────
    // One entry per successful generation. Append-only, capped, and written
    // under a lock because it is a read-modify-write of a single blob.

    async appendUsage(entry) {
        await withUserLock('__usage__', async () => {
            const list = await this.getUsage();
            list.push(entry);
            const trimmed = list.length > MAX_USAGE_ENTRIES
                ? list.slice(list.length - MAX_USAGE_ENTRIES)
                : list;
            if (useRedis()) {
                const r = await getRedis();
                await r.set('usage', JSON.stringify(trimmed));
                return;
            }
            await writeJSON(USAGE_FILE, trimmed);
        });
    },

    // All entries, oldest first; `since` is an epoch ms cutoff.
    async getUsage(since = 0) {
        let list;
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get('usage');
            list = val ? JSON.parse(val) : [];
        } else {
            list = await readJSON(USAGE_FILE, []);
        }
        return since ? list.filter(e => e.ts >= since) : list;
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

            // Timestamps written on first save (missing for blobs stored before that)
            for (let i = 0; i < out.length; i += 200) {
                const chunk = out.slice(i, i + 200);
                try {
                    const stamps = await r.mGet(chunk.map(img => `image_ts:${img.id}`));
                    chunk.forEach((img, n) => {
                        const ts = parseInt(stamps[n], 10);
                        if (ts) img.mtime = ts;
                    });
                } catch {}
            }
            out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
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
