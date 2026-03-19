import { kv } from '@vercel/kv';
import { Redis } from '@upstash/redis';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
const BOARDS_FILE = path.join(__dirname, 'data', 'boards.json');
const KV_USERS_KEY = 'diffusion_canvas_users';
const KV_SETTINGS_KEY = 'diffusion_canvas_settings';
const boardsKey = (userId) => `diffusion_canvas_boards_${userId}`;

// Try Vercel KV first, then Upstash Redis, then local file
// Check for both standard and prefixed environment variable names
const kvUrl = process.env.KV_REST_API_URL || process.env.diffusioncanvas_KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.diffusioncanvas_KV_REST_API_TOKEN;
const hasVercelKV = !!(kvUrl && kvToken);

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.diffusioncanvas_REDIS_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const hasUpstashRedis = !!(upstashUrl && upstashToken);

const isVercel = hasVercelKV || hasUpstashRedis;

// Initialize Upstash Redis if available (prefer KV over Redis)
let redis = null;
if (hasVercelKV) {
    // Use Vercel KV/Upstash via REST API
    redis = new Redis({
        url: kvUrl,
        token: kvToken,
    }); 
} else if (hasUpstashRedis) {
    redis = new Redis({
        url: upstashUrl,
        token: upstashToken,
    });
}

// Storage interface
export const storage = {
    async getUsers() {
        if (redis) {
            // Use Upstash Redis
            try {
                const users = await redis.get(KV_USERS_KEY);
                return users || [];
            } catch (error) {
                console.error('Redis get error:', error);
                return [];
            }
        } else if (hasVercelKV) {
            // Use Vercel KV
            try {
                const users = await kv.get(KV_USERS_KEY);
                return users || [];
            } catch (error) {
                console.error('KV get error:', error);
                return [];
            }
        } else {
            // Use local file
            try {
                const data = await fs.readFile(USERS_FILE, 'utf-8');
                return JSON.parse(data);
            } catch {
                return [];
            }
        }
    },

    async setUsers(users) {
        if (redis) {
            // Use Upstash Redis
            try {
                await redis.set(KV_USERS_KEY, JSON.stringify(users));
            } catch (error) {
                console.error('Redis set error:', error);
                throw error;
            }
        } else if (hasVercelKV) {
            // Use Vercel KV
            try {
                await kv.set(KV_USERS_KEY, users);
            } catch (error) {
                console.error('KV set error:', error);
                throw error;
            }
        } else {
            // Use local file
            await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
        }
    },

    async getSettings() {
        const defaultSettings = {
            modelCosts: {
                'imagen-4.0-generate-001': 1,
                'gemini-2.5-flash-image': 1,
                'gemini-3-pro-image-preview': 2,
                'veo-3.0-fast-generate-001': 5
            }
        };

        let settings = null;

        if (redis) {
            try {
                settings = await redis.get(KV_SETTINGS_KEY);
            } catch (error) {
                console.error('Redis get settings error:', error);
            }
        } else if (hasVercelKV) {
            try {
                settings = await kv.get(KV_SETTINGS_KEY);
            } catch (error) {
                console.error('KV get settings error:', error);
            }
        } else {
            try {
                const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
                settings = JSON.parse(data);
            } catch {
                // File doesn't exist
            }
        }

        // Merge with defaults to ensure all keys exist
        return { ...defaultSettings, ...settings, modelCosts: { ...defaultSettings.modelCosts, ...(settings?.modelCosts || {}) } };
    },

    async setSettings(settings) {
        if (redis) {
            try {
                await redis.set(KV_SETTINGS_KEY, JSON.stringify(settings));
            } catch (error) {
                console.error('Redis set settings error:', error);
                throw error;
            }
        } else if (hasVercelKV) {
            try {
                await kv.set(KV_SETTINGS_KEY, settings);
            } catch (error) {
                console.error('KV set settings error:', error);
                throw error;
            }
        } else {
            await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        }
    },

    async getBoards(userId) {
        if (redis) {
            try {
                const data = await redis.get(boardsKey(userId));
                if (!data) return [];
                return typeof data === 'string' ? JSON.parse(data) : data;
            } catch (error) {
                console.error('Redis getBoards error:', error);
                return [];
            }
        } else if (hasVercelKV) {
            try {
                const data = await kv.get(boardsKey(userId));
                return data || [];
            } catch (error) {
                console.error('KV getBoards error:', error);
                return [];
            }
        } else {
            try {
                const data = await fs.readFile(BOARDS_FILE, 'utf-8');
                const all = JSON.parse(data);
                return all[userId] || [];
            } catch {
                return [];
            }
        }
    },

    async setBoards(userId, boards) {
        if (redis) {
            try {
                await redis.set(boardsKey(userId), JSON.stringify(boards));
            } catch (error) {
                console.error('Redis setBoards error:', error);
                throw error;
            }
        } else if (hasVercelKV) {
            try {
                await kv.set(boardsKey(userId), boards);
            } catch (error) {
                console.error('KV setBoards error:', error);
                throw error;
            }
        } else {
            let all = {};
            try {
                const data = await fs.readFile(BOARDS_FILE, 'utf-8');
                all = JSON.parse(data);
            } catch { /* file doesn't exist yet */ }
            all[userId] = boards;
            await fs.writeFile(BOARDS_FILE, JSON.stringify(all, null, 2));
        }
    },

    async init() {
        if (redis) {
            console.log('✓ Using Upstash Redis for persistent storage');
            // Verify Redis is accessible
            try {
                await redis.ping();
                console.log('✓ Upstash Redis connection verified');
            } catch (error) {
                console.error('⚠️  Warning: Upstash Redis connection test failed:', error.message);
            }
        } else if (hasVercelKV) {
            console.log('✓ Using Vercel KV for persistent storage');
            // Verify KV is accessible
            try {
                await kv.get('_health_check');
                console.log('✓ Vercel KV connection verified');
            } catch (error) {
                console.error('⚠️  Warning: Vercel KV connection test failed:', error.message);
            }
        } else {
            console.log('✓ Using local file storage (users.json)');
            // Create file if it doesn't exist (only works in writable environments)
            try {
                await fs.access(USERS_FILE);
            } catch {
                try {
                    await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
                } catch (error) {
                    if (error.code === 'EROFS') {
                        console.error('❌ WARNING: File system is read-only!');
                        console.error('❌ Deploying to Vercel without Vercel KV configured.');
                        console.error('❌ Please set up Vercel KV for persistent storage:');
                        console.error('   1. Go to your Vercel dashboard');
                        console.error('   2. Select Storage → Create Database → KV');
                        console.error('   3. Connect it to your project');
                        console.error('⚠️  Continuing without storage - authentication will fail!');
                        // Don't throw - let the app start so users can see the error page
                        return;
                    }
                    console.error('File storage initialization error:', error);
                }
            }

            // Initialize boards file
            try {
                await fs.access(BOARDS_FILE);
            } catch {
                try {
                    await fs.writeFile(BOARDS_FILE, JSON.stringify({}, null, 2));
                } catch (error) {
                    if (error.code !== 'EROFS') {
                        console.error('Boards file initialization error:', error);
                    }
                }
            }

            // Initialize settings file
            try {
                await fs.access(SETTINGS_FILE);
            } catch {
                try {
                    await this.setSettings({
                        modelCosts: {
                            'imagen-4.0-generate-001': 1,
                            'gemini-2.5-flash-image': 1,
                            'gemini-3-pro-image-preview': 2,
                            'veo-3.0-fast-generate-001': 5
                        }
                    });
                } catch (error) {
                    // Ignore errors if read-only fs (warnings already shown)
                }
            }
        }
    }
};
