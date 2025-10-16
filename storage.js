import { kv } from '@vercel/kv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_FILE = path.join(__dirname, 'users.json');
const KV_USERS_KEY = 'diffusion_canvas_users';

// Vercel provides this environment variable
const IS_VERCEL = !!process.env.VERCEL;

// Storage interface
export const storage = {
    async getUsers() {
        if (IS_VERCEL) {
            // On Vercel, always use KV
            try {
                const users = await kv.get(KV_USERS_KEY);
                return users || [];
            } catch (error) {
                console.error('Vercel KV get error:', error);
                // Throw a more specific error if KV is not configured
                if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
                    throw new Error('Vercel KV is not configured. Please connect a KV database to your project.');
                }
                return [];
            }
        } else {
            // Use local file for local development
            try {
                const data = await fs.readFile(USERS_FILE, 'utf-8');
                return JSON.parse(data);
            } catch {
                return [];
            }
        }
    },

    async setUsers(users) {
        if (IS_VERCEL) {
            // On Vercel, always use KV
            try {
                await kv.set(KV_USERS_KEY, users);
            } catch (error) {
                console.error('Vercel KV set error:', error);
                // Throw a more specific error if KV is not configured
                if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
                    throw new Error('Vercel KV is not configured. Please connect a KV database to your project.');
                }
                throw error;
            }
        } else {
            // Use local file for local development
            await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
        }
    },

    async init() {
        if (IS_VERCEL) {
            console.log('✓ Running on Vercel, using Vercel KV for persistent storage');
            if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
                console.error('❌ ERROR: Vercel KV environment variables are not set!');
                console.error('❌ Please connect a Vercel KV database to your project in the Vercel dashboard.');
            } else {
                 try {
                    await kv.get('_health_check');
                    console.log('✓ Vercel KV connection verified');
                } catch (error) {
                    console.error('⚠️  Warning: Vercel KV connection test failed:', error.message);
                }
            }
        } else {
            console.log('✓ Running locally, using local file storage (users.json)');
            // Create file if it doesn't exist
            try {
                await fs.access(USERS_FILE);
            } catch {
                try {
                    await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
                } catch (error) {
                    console.error('File storage initialization error:', error);
                }
            }
        }
    }
};
