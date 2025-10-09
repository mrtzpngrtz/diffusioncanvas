import { kv } from '@vercel/kv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_FILE = path.join(__dirname, 'users.json');
const KV_USERS_KEY = 'diffusion_canvas_users';

// Detect environment - only use Vercel KV if credentials are available
const isVercel = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// Storage interface
export const storage = {
    async getUsers() {
        if (isVercel) {
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
        if (isVercel) {
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

    async init() {
        if (isVercel) {
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
        }
    }
};
