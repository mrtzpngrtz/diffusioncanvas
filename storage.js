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

const MAX_VERSIONS = 10;

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

function stateFile(boardId)    { return path.join(DATA_DIR, `state_${boardId}.json`); }
function versionsFile(boardId) { return path.join(DATA_DIR, `versions_${boardId}.json`); }

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
                'gemini-3.1-flash-image-preview': 4,
                'gemini-3-pro-image-preview': 6,
                'imagen-4.0-ultra-generate-001': 3,
                'imagen-4.0-fast-generate-001': 2
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
            list.unshift({ savedAt: new Date().toISOString(), state: snapshot });
            await r.set(`versions:${userId}:${boardId}`, JSON.stringify(list.slice(0, MAX_VERSIONS)));
            return;
        }
        const file = versionsFile(boardId);
        const list = await readJSON(file, []);
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
