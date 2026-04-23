import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from 'redis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR      = path.join(__dirname, 'data');
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BOARDS_FILE   = path.join(DATA_DIR, 'boards.json');

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

    async getBoards(userId) {
        if (useRedis()) {
            const r = await getRedis();
            const val = await r.get(`boards:${userId}`);
            return val ? JSON.parse(val) : [];
        }
        const all = await readJSON(BOARDS_FILE, {});
        return all[userId] || [];
    },

    async setBoards(userId, boards) {
        if (useRedis()) {
            const r = await getRedis();
            await r.set(`boards:${userId}`, JSON.stringify(boards));
            return;
        }
        const all = await readJSON(BOARDS_FILE, {});
        all[userId] = boards;
        await writeJSON(BOARDS_FILE, all);
    },

    async init() {
        if (useRedis()) {
            await getRedis();
            console.log('✓ Redis storage ready');
            return;
        }
        await fs.mkdir(DATA_DIR, { recursive: true });
        for (const [file, fallback] of [
            [USERS_FILE, []],
            [BOARDS_FILE, {}],
        ]) {
            try { await fs.access(file); }
            catch { await writeJSON(file, fallback); }
        }
        try { await fs.access(SETTINGS_FILE); }
        catch { await this.setSettings({}); }
        console.log('✓ Local file storage ready');
    }
};
