import { kv } from '@vercel/kv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_FILE = path.join(__dirname, 'users.json');
const KV_USERS_KEY = 'diffusion_canvas_users';

// Check if Vercel KV environment variables are set
const hasVercelKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// Storage interface
export const storage = {
    async getUsers() {
        if (hasVercelKV) {
            // Use Vercel KV
            try {
                console.log('Attempting to get users from Vercel KV...');
                const users = await kv.get(KV_USERS_KEY);
                console.log(`Successfully got ${users ? users.length : 0} users from Vercel KV.`);
                return users || [];
            } catch (error) {
                console.error('Vercel KV get error:', error);
                return [];
            }
        } else {
            // Use local file as a fallback
            try {
                const data = await fs.readFile(USERS_FILE, 'utf-8');
                return JSON.parse(data);
            } catch {
                return [];
            }
        }
    },

    async setUsers(users) {
        if (hasVercelKV) {
            // Use Vercel KV
            try {
                console.log(`Attempting to set ${users.length} users to Vercel KV...`);
                await kv.set(KV_USERS_KEY, users);
                console.log('Successfully set users to Vercel KV.');
            } catch (error) {
                console.error('Vercel KV set error:', error);
                throw error;
            }
        } else {
            // Use local file as a fallback
            await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
        }
    },

    async init() {
        if (hasVercelKV) {
            console.log('✓ Using Vercel KV for persistent storage');
            try {
                await kv.get('_health_check');
                console.log('✓ Vercel KV connection verified');
            } catch (error) {
                console.error('⚠️  Warning: Vercel KV connection test failed:', error.message);
            }
        } else {
            console.log('✓ Using local file storage (users.json)');
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
