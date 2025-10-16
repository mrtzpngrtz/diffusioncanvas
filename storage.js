import { kv } from '@vercel/kv';
import { Redis } from '@upstash/redis';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_FILE = path.join(__dirname, 'users.json');
const KV_USERS_KEY = 'diffusion_canvas_users';

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
                const usersJson = await redis.get(KV_USERS_KEY);
                // Data from redis/KV is a JSON string and needs to be parsed
                return usersJson ? JSON.parse(usersJson) : [];
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
        }
    }
};
