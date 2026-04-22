import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR    = path.join(__dirname, 'data');
const USERS_FILE  = path.join(DATA_DIR, 'users.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BOARDS_FILE = path.join(DATA_DIR, 'boards.json');

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

export const storage = {
    async getUsers() {
        return readJSON(USERS_FILE, []);
    },

    async setUsers(users) {
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
        const saved = await readJSON(SETTINGS_FILE, {});
        return { ...defaults, ...saved, modelCosts: { ...defaults.modelCosts, ...(saved.modelCosts || {}) } };
    },

    async setSettings(settings) {
        await writeJSON(SETTINGS_FILE, settings);
    },

    async getBoards(userId) {
        const all = await readJSON(BOARDS_FILE, {});
        return all[userId] || [];
    },

    async setBoards(userId, boards) {
        const all = await readJSON(BOARDS_FILE, {});
        all[userId] = boards;
        await writeJSON(BOARDS_FILE, all);
    },

    async init() {
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
