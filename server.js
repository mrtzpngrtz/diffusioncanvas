import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { GoogleGenAI } from '@google/genai';
import OpenAI, { toFile } from 'openai';
import path from 'path';
import os from 'os';
import { promises as fsp } from 'fs';
import { fileURLToPath } from 'url';
import passport from './auth.js';
import bcrypt from 'bcryptjs';
import { setAuthCookie, getAuthUser, clearAuthCookie } from './jwt-auth.js';
import { storage } from './storage.js';

// Fail fast if required secrets are missing
if (!process.env.SESSION_SECRET) {
    console.error('FATAL: SESSION_SECRET environment variable is not set');
    process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
    console.error('FATAL: FRONTEND_URL environment variable is not set');
    process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Session configuration (still needed for OAuth flow)
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 5 * 60 * 1000 // 5 minutes (just for OAuth flow)
    }
}));

app.use(cookieParser());
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : 'http://localhost:3000',
    credentials: true
}));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(express.static(__dirname)); 

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Middleware to check if user is authenticated (JWT-based)
async function isAuthenticated(req, res, next) {
    const user = getAuthUser(req);
    if (!user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    // Refresh user data from storage to get latest credits
    const users = await storage.getUsers();
    const fullUser = users.find(u => u.id === user.id);
    req.user = fullUser || user;
    next();
}

// Middleware to check if user is admin
async function isAdmin(req, res, next) {
    const user = getAuthUser(req);
    if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = user;
    next();
}

// Auth Routes
// Google OAuth (only if credentials are configured)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    app.get('/auth/google',
        passport.authenticate('google', { scope: ['profile', 'email'] })
    );

    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/' }),
        (req, res) => {
            // Set JWT cookie for persistent authentication
            setAuthCookie(res, req.user);
            res.redirect('/');
        },
        (err, req, res, next) => {
            console.error('Google OAuth callback error:', err);
            res.redirect('/?error=auth_failed');
        }
    );
    console.log('Google OAuth enabled');
} else {
    console.warn('Google OAuth not configured - set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
}

// Facebook OAuth (only if credentials are configured)
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    app.get('/auth/facebook',
        passport.authenticate('facebook', { scope: ['email'] })
    );

    app.get('/auth/facebook/callback',
        passport.authenticate('facebook', { failureRedirect: '/' }),
        (req, res) => {
            res.redirect('/');
        },
        (err, req, res, next) => {
            console.error('Facebook OAuth callback error:', err);
            res.redirect('/?error=auth_failed');
        }
    );
    console.log('Facebook OAuth enabled');
} else {
    console.warn('Facebook OAuth not configured - set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in .env');
}

// LinkedIn OAuth (only if credentials are configured)
if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    app.get('/auth/linkedin',
        passport.authenticate('linkedin')
    );

    app.get('/auth/linkedin/callback',
        passport.authenticate('linkedin', { failureRedirect: '/' }),
        (req, res) => {
            res.redirect('/');
        },
        (err, req, res, next) => {
            console.error('LinkedIn OAuth callback error:', err);
            res.redirect('/?error=auth_failed');
        }
    );
    console.log('LinkedIn OAuth enabled');
} else {
    console.warn('LinkedIn OAuth not configured - set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env');
}

// Local Auth
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many login attempts, please try again later.' }
});

app.post('/auth/local/login', loginLimiter, (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) {
            return next(err);
        }
        if (!user) {
            return res.status(401).json({ message: info.message });
        }
        req.logIn(user, (err) => {
            if (err) {
                return next(err);
            }
            setAuthCookie(res, user);
            return res.json({ user });
        });
    })(req, res, next);
});

// Logout
app.get('/auth/logout', (req, res) => {
    // Clear JWT cookie
    clearAuthCookie(res);
    
    req.logout((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.redirect('/');
    });
});

// Get current user (always fetch fresh data from database)
app.get('/api/user', async (req, res) => {
    try {
        // Check JWT first, then session
        const jwtUser = getAuthUser(req);
        const sessionUser = req.isAuthenticated() ? req.user : null;
        const authUser = jwtUser || sessionUser;
        
        if (!authUser) {
            return res.json({ user: null });
        }
        
        // Fetch fresh user data from database to get current credits
        const users = await storage.getUsers();
        const freshUser = users.find(u => u.id === authUser.id);
        
        if (freshUser) {
            return res.json({ user: freshUser });
        }
        
        // User not found in database (deleted?)
        res.json({ user: null });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
});

// Get available OAuth providers
app.get('/api/auth/providers', (req, res) => {
    const providers = {
        google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        facebook: !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
        linkedin: !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)
    };
    res.json(providers);
});

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Admin API Routes
// (storage already imported at top of file)

// Get settings (admin only)
app.get('/api/admin/settings', isAdmin, async (req, res) => {
    try {
        const settings = await storage.getSettings();
        res.json(settings);
    } catch (error) {
        console.error('Error loading settings:', error);
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

// Update settings (admin only)
app.post('/api/admin/settings', isAdmin, async (req, res) => {
    try {
        await storage.setSettings(req.body);
        res.json({ message: 'Settings updated successfully' });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Get all users (admin only)
app.get('/api/admin/users', isAdmin, async (req, res) => {
    try {
        const users = await storage.getUsers();
        res.json(users);
    } catch (error) {
        console.error('Error loading users:', error);
        res.status(500).json({ error: 'Failed to load users' });
    }
});

// Add user (admin only)
app.post('/api/admin/users', isAdmin, async (req, res) => {
    try {
        const { email, password, isAdmin: makeAdmin } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const users = await storage.getUsers();

        // Check if user already exists
        if (users.some(u => u.email === email)) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const isFirstUser = users.length === 0;

        const newUser = {
            id: Date.now().toString(),
            provider: 'local',
            email: email,
            password: hashedPassword,
            displayName: email,
            photo: null,
            isAdmin: makeAdmin || isFirstUser,
            credits: 5,
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        await storage.setUsers(users);

        res.status(201).json({ message: 'User created successfully', user: newUser });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Prevent admin from deleting themselves
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        
        const users = await storage.getUsers();
        
        // Find and remove user
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Prevent deleting other admins
        if (users[userIndex].isAdmin) {
            return res.status(400).json({ error: 'Cannot delete admin users' });
        }
        
        users.splice(userIndex, 1);
        
        await storage.setUsers(users);
        
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Initialize Google GenAI client with explicit API key
const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Aspect ratio helpers ────────────────────────────────────────────────────

// The client sends aspectRatio 'original' plus the true pixel size of the source
// medium (sourceWidth/sourceHeight). Providers only accept a fixed list of
// ratios, so pick the closest supported one to avoid distorting the image.
function nearestSupportedRatio(sourceWidth, sourceHeight, supported, fallback = '1:1') {
    if (!sourceWidth || !sourceHeight) return fallback;
    const target = sourceWidth / sourceHeight;
    let best = fallback;
    let bestDelta = Infinity;
    for (const ratio of supported) {
        const [w, h] = ratio.split(':').map(Number);
        if (!(w > 0 && h > 0)) continue;
        // Compare in log space so 2× too wide and 2× too tall are penalised equally.
        const delta = Math.abs(Math.log((w / h) / target));
        if (delta < bestDelta) { bestDelta = delta; best = ratio; }
    }
    return best;
}

// Gemini can answer 200 OK with no image: a filter fired, or generation stopped
// early. Turn the reason code into something the canvas can actually show.
const EMPTY_RESPONSE_REASONS = {
    SAFETY: 'Blocked by the safety filter (prompt or input image).',
    IMAGE_SAFETY: 'The generated image was blocked by the safety filter.',
    PROHIBITED_CONTENT: 'Blocked as prohibited content.',
    BLOCKLIST: 'The prompt contains a blocked term.',
    SPII: 'Blocked for containing sensitive personal information.',
    RECITATION: 'Blocked to avoid reciting protected content.',
    MAX_TOKENS: 'The model ran out of output budget before returning an image.',
    OTHER: 'The model stopped without returning an image.'
};

function describeEmptyResponse(finishReason, blockReason) {
    const detail = EMPTY_RESPONSE_REASONS[blockReason] || EMPTY_RESPONSE_REASONS[finishReason];
    const code = blockReason || finishReason || 'UNKNOWN';
    return detail
        ? `${detail} (${code}) Try rephrasing the prompt or using a different input image.`
        : `The model returned no content (${code}). Try again or rephrase the prompt.`;
}

// Resolve the client's aspectRatio for one provider. 'original' (the default)
// maps to whichever supported ratio is closest to the source medium.
function resolveAspectRatio(requested, sourceWidth, sourceHeight, supported, fallback = '1:1') {
    if (requested === 'original') {
        return nearestSupportedRatio(sourceWidth, sourceHeight, supported, fallback);
    }
    if (supported.includes(requested)) return requested;
    // Asked for a ratio this provider does not offer (e.g. 4:5 on Gemini) —
    // snap to the closest one it does rather than dropping to the fallback.
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(requested || '');
    if (m) return nearestSupportedRatio(Number(m[1]), Number(m[2]), supported, fallback);
    return fallback;
}

// ── FLUX.2 (Black Forest Labs) generation ───────────────────────────────────
const BFL_BASE_URL = 'https://api.bfl.ai/v1';
const BFL_MODELS = new Set([
    'flux-2-pro-preview',
    'flux-2-pro',            // fixed reproducibility snapshot
    'flux-2-flex',
    'flux-2-klein-9b-preview',
    'flux-2-klein-9b',       // fixed reproducibility snapshot
    'flux-2-max'
]);

// Map an aspect ratio + resolution to pixel dimensions. FLUX requires each side
// to be a multiple of 32 and >= 64; we keep the total area near a per-resolution
// budget while preserving the requested aspect ratio.
function bflDimensions(aspectRatio, resolution, sourceWidth, sourceHeight) {
    let ar;
    if (aspectRatio === 'original' && sourceWidth > 0 && sourceHeight > 0) {
        // FLUX accepts arbitrary dimensions, so keep the exact source ratio.
        ar = sourceWidth / sourceHeight;
    } else {
        const [w, h] = (aspectRatio || '1:1').split(':').map(Number);
        ar = (w > 0 && h > 0) ? w / h : 1;
    }
    const pixelBudget = {
        standard: 1024 * 1024,   // ~1 MP
        hd:       1536 * 1536,   // ~2.3 MP
        '4k':     2048 * 2048    // ~4 MP (FLUX.2 upper bound)
    };
    const target = pixelBudget[resolution] || pixelBudget.hd;
    const snap = (v) => Math.max(64, Math.min(4096, Math.round(v / 32) * 32));
    return {
        width: snap(Math.sqrt(target * ar)),
        height: snap(Math.sqrt(target / ar))
    };
}

// Submit a generation to BFL, poll until the result is ready, and return the
// image as a base64 data URL (the API's `sample` URL is signed and expires ~10 min).
async function generateWithBFL(model, prompt, images, aspectRatio, resolution, outputFormat, opts = {}) {
    const apiKey = process.env.BFL_API_KEY;
    if (!apiKey) throw new Error('FLUX models are not configured on this server (BFL_API_KEY is missing).');

    const fmtMap = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' };
    const { width, height } = bflDimensions(aspectRatio, resolution, opts.sourceWidth, opts.sourceHeight);

    const body = {
        prompt,
        width,
        height,
        output_format: fmtMap[outputFormat] || 'jpeg'
    };

    // steps / guidance are only accepted by FLUX.2 [flex]; other models reject them.
    if (model === 'flux-2-flex') {
        if (opts.steps != null) body.steps = Math.min(50, Math.max(1, Math.round(Number(opts.steps))));
        if (opts.guidance != null) body.guidance = Math.min(10, Math.max(1.5, Number(opts.guidance)));
    }

    // Attach up to 8 input images for editing (raw base64, no data URI prefix):
    // input_image, input_image_2, … input_image_8.
    if (images && images.length > 0) {
        images.slice(0, 8).forEach((img, i) => {
            const raw = img.includes('base64,') ? img.split('base64,')[1] : img;
            body[i === 0 ? 'input_image' : `input_image_${i + 1}`] = raw;
        });
    }

    // Submit the generation request → { id, polling_url }
    const submitRes = await fetch(`${BFL_BASE_URL}/${model}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'accept': 'application/json', 'x-key': apiKey },
        body: JSON.stringify(body)
    });
    if (!submitRes.ok) {
        const errText = await submitRes.text().catch(() => '');
        throw new Error(`FLUX request failed (${submitRes.status}): ${errText.slice(0, 300)}`);
    }
    const submit = await submitRes.json();
    const pollingUrl = submit.polling_url || `${BFL_BASE_URL}/get_result?id=${submit.id}`;

    // Poll until Ready (or a terminal/moderated/error state).
    const deadline = Date.now() + 120000; // 2 min hard cap
    let sampleUrl = null;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500));
        const pollRes = await fetch(pollingUrl, { headers: { 'accept': 'application/json', 'x-key': apiKey } });
        if (!pollRes.ok) continue;
        const poll = await pollRes.json();
        switch (poll.status) {
            case 'Ready':
                sampleUrl = poll.result?.sample;
                break;
            case 'Error':
            case 'Failed':
                throw new Error(`FLUX generation failed: ${JSON.stringify(poll.details || poll.result || poll.status)}`);
            case 'Content Moderated':
            case 'Request Moderated':
                throw new Error('FLUX request was moderated (content policy).');
            case 'Task not found':
                throw new Error('FLUX task not found.');
            // 'Pending' and any other transient status → keep polling
        }
        if (sampleUrl) break;
    }
    if (!sampleUrl) throw new Error('FLUX generation timed out. Please try again.');

    // Download the signed sample URL and inline it as a base64 data URL.
    const imgRes = await fetch(sampleUrl);
    if (!imgRes.ok) throw new Error('Failed to download the generated FLUX image.');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await imgRes.arrayBuffer());
    return `data:${mimeType};base64,${buf.toString('base64')}`;
}

// ── VIDEO GENERATION ────────────────────────────────────────────────────────
// Seedance via OpenRouter (/api/v1/videos, async submit → poll → download);
// Gemini Omni Flash via Google's Interactions API. Both take minutes, so the
// client gets a job id back immediately and polls /api/video-jobs/:id —
// a single long request would be cut off by the reverse proxy.
const OPENROUTER_VIDEO_MODELS = new Set([
    'bytedance/seedance-2.0',
    'bytedance/seedance-2.0-fast',
    'bytedance/seedance-2.5'
]);
const OMNI_VIDEO_MODELS = new Set(['gemini-omni-1.1-flash']);
const videoJobs = new Map(); // jobId → { userId, status, video, error, createdAt, model, cost }

function pruneVideoJobs() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, job] of videoJobs) if (job.createdAt < cutoff) videoJobs.delete(id);
}

async function generateVideoOpenRouter(model, prompt, opts) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('Video models are not configured on this server (OPENROUTER_API_KEY is missing).');
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    const body = { model, prompt };
    if (opts.duration)     body.duration = Number(opts.duration);
    if (opts.resolution)   body.resolution = opts.resolution;
    if (opts.aspectRatio)  body.aspect_ratio = opts.aspectRatio;
    if (opts.audio != null) body.generate_audio = !!opts.audio;
    const frames = [];
    if (opts.firstFrame) frames.push({ type: 'image_url', image_url: { url: opts.firstFrame }, frame_type: 'first_frame' });
    if (opts.lastFrame)  frames.push({ type: 'image_url', image_url: { url: opts.lastFrame },  frame_type: 'last_frame' });
    if (frames.length) body.frame_images = frames;

    const submitRes = await fetch('https://openrouter.ai/api/v1/videos', {
        method: 'POST', headers, body: JSON.stringify(body)
    });
    if (!submitRes.ok) {
        const errText = await submitRes.text().catch(() => '');
        throw new Error(`OpenRouter video request failed (${submitRes.status}): ${errText.slice(0, 300)}`);
    }
    const submit = await submitRes.json();
    const pollingUrl = submit.polling_url || `https://openrouter.ai/api/v1/videos/${submit.id}`;

    const deadline = Date.now() + 15 * 60 * 1000;
    let job = null;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000));
        const pollRes = await fetch(pollingUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!pollRes.ok) continue;
        job = await pollRes.json();
        if (job.status === 'completed') break;
        if (['failed', 'cancelled', 'expired'].includes(job.status)) {
            const detail = typeof job.error === 'string' ? job.error : JSON.stringify(job.error || '');
            throw new Error(`Video generation ${job.status}: ${detail.slice(0, 300)}`);
        }
    }
    if (!job || job.status !== 'completed') throw new Error('Video generation timed out. Please try again.');

    const url = job.unsigned_urls?.[0] || `https://openrouter.ai/api/v1/videos/${submit.id}/content?index=0`;
    const vidRes = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    if (!vidRes.ok) throw new Error('Failed to download the generated video.');
    const mime = (vidRes.headers.get('content-type') || 'video/mp4').split(';')[0];
    const buf = Buffer.from(await vidRes.arrayBuffer());
    return `data:${mime};base64,${buf.toString('base64')}`;
}

async function generateVideoOmni(model, prompt, opts) {
    if (!ai.interactions?.create) {
        throw new Error('Gemini Omni needs @google/genai ≥ 2.x (Interactions API) — run npm install on the server.');
    }
    const toImagePart = (dataUrl) => {
        const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
        return { type: 'image', data: m ? m[2] : dataUrl, mime_type: m ? m[1] : 'image/jpeg' };
    };
    const input = [];
    if (opts.firstFrame) input.push(toImagePart(opts.firstFrame));
    if (opts.lastFrame)  input.push(toImagePart(opts.lastFrame));
    input.push({ type: 'text', text: prompt });

    const interaction = await ai.interactions.create({
        model,
        input: input.length === 1 ? prompt : input,
        response_format: {
            type: 'video',
            aspect_ratio: opts.aspectRatio || '16:9',
            resolution: opts.resolution || '720p'
        },
        generationConfig: { videoConfig: { task: opts.firstFrame ? 'image_to_video' : 'text_to_video' } }
    });

    const out = interaction.output_video;
    if (out?.data) return `data:${out.mime_type || 'video/mp4'};base64,${out.data}`;

    if (out?.uri) {
        // URI delivery (large outputs): wait until the file is ACTIVE, then download
        const m = out.uri.match(/files\/([A-Za-z0-9_-]+)/);
        const name = m ? `files/${m[1]}` : out.uri;
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
            const f = await ai.files.get({ name });
            const state = f.state?.name || f.state;
            if (state === 'ACTIVE') break;
            if (state === 'FAILED') throw new Error('Gemini Omni video generation failed.');
            await new Promise(r => setTimeout(r, 5000));
        }
        const tmp = path.join(os.tmpdir(), `omni-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
        await ai.files.download({ file: out, downloadPath: tmp });
        const buf = await fsp.readFile(tmp);
        await fsp.unlink(tmp).catch(() => {});
        return `data:video/mp4;base64,${buf.toString('base64')}`;
    }
    throw new Error('Gemini Omni returned no video.');
}

// Submit a video job — responds 202 with a job id, generation continues in the background
app.post('/api/generate-video', isAuthenticated, async (req, res) => {
    try {
        const { prompt, model, resolution, aspectRatio, duration, audio, firstFrame, lastFrame } = req.body;
        if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'No prompt provided' });
        if (!OPENROUTER_VIDEO_MODELS.has(model) && !OMNI_VIDEO_MODELS.has(model)) {
            return res.status(400).json({ error: `Unknown video model: ${model}` });
        }

        const settings = await storage.getSettings();
        const cost = settings.modelCosts[model] || 8;
        if (!req.user.credits || req.user.credits < cost) {
            return res.status(403).json({ error: `Insufficient credits. This model requires ${cost} credits.` });
        }

        pruneVideoJobs();
        const jobId = `${req.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const job = { userId: req.user.id, status: 'pending', video: null, error: null, createdAt: Date.now(), model, cost };
        videoJobs.set(jobId, job);
        console.log(`Video job ${jobId}: ${model}, ${resolution} ${aspectRatio} ${duration ?? 'auto'}s, frames=${(firstFrame ? 1 : 0) + (lastFrame ? 1 : 0)}`);
        res.status(202).json({ jobId, cost });

        (async () => {
            const t0 = Date.now();
            try {
                job.status = 'in_progress';
                const opts = { resolution, aspectRatio, duration, audio, firstFrame, lastFrame };
                const video = OPENROUTER_VIDEO_MODELS.has(model)
                    ? await generateVideoOpenRouter(model, prompt, opts)
                    : await generateVideoOmni(model, prompt, opts);

                // Charge only on success
                const users = await storage.getUsers();
                const idx = users.findIndex(u => u.id === job.userId);
                if (idx !== -1) {
                    users[idx].credits = (users[idx].credits || 0) - cost;
                    users[idx].usedCredits = (users[idx].usedCredits || 0) + cost;
                    await storage.setUsers(users);
                    job.creditsRemaining = users[idx].credits;
                }
                job.result = { video };
                job.status = 'completed';
                console.log(`Video job ${jobId} completed in ${Math.round((Date.now() - t0) / 1000)}s`);
            } catch (err) {
                console.error(`Video job ${jobId} failed:`, err);
                job.status = 'failed';
                job.error = err?.error?.message || err?.message || 'Video generation failed.';
            }
        })();
    } catch (error) {
        console.error('Error submitting video job:', error);
        res.status(500).json({ error: error?.message || 'Failed to start video generation.' });
    }
});

// ── IMAGE → 3D (Replicate) ──────────────────────────────────────────────────
// Each model exposes a different input schema, so we fetch it at runtime and
// only set the fields that exist. Output is normalised to a GLB data URL.
const REPLICATE_3D_MODELS = new Set([
    'fishwowater/trellis2',
    'tencent/hunyuan-3d-3.1',
    'prunaai/hunyuan3d-2',
    'firtoz/trellis',
    'hyper3d/rodin'
]);
const replicateModelCache = new Map(); // slug → { version, props, fetchedAt }

async function replicateModelMeta(slug, token) {
    const cached = replicateModelCache.get(slug);
    if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) return cached;
    const res = await fetch(`https://api.replicate.com/v1/models/${slug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Replicate model lookup failed (${res.status}) for ${slug}`);
    const meta = await res.json();
    const props = meta.latest_version?.openapi_schema?.components?.schemas?.Input?.properties || {};
    const entry = { version: meta.latest_version?.id || null, props, fetchedAt: Date.now() };
    replicateModelCache.set(slug, entry);
    return entry;
}

// Map our generic settings onto whatever the model's schema actually has
function buildReplicate3DInput(props, opts) {
    const has = (k) => Object.prototype.hasOwnProperty.call(props, k);
    const enumOf = (k) => props[k]?.enum || props[k]?.allOf?.[0]?.enum || null;
    const input = {};

    // Image — first matching field; array-typed fields get a one-element array
    const imageKey = ['image', 'images', 'input_image', 'image_url', 'input_images', 'input_image_urls', 'front_image', 'image_path']
        .find(has)
        // fallback: first uri-typed or image-named field
        || Object.keys(props).find(k => props[k].format === 'uri' || props[k].items?.format === 'uri')
        || Object.keys(props).find(k => /image/i.test(k));
    if (!imageKey) throw new Error('This model exposes no image input field.');
    input[imageKey] = props[imageKey].type === 'array' ? [opts.image] : opts.image;

    // Optional text hint
    if (opts.prompt) {
        const pk = ['prompt', 'text', 'caption'].find(has);
        if (pk) input[pk] = opts.prompt;
    }

    if (opts.seed != null && has('seed')) input.seed = Number(opts.seed);

    const high = opts.quality === 'high';
    // Texture resolution
    for (const k of ['texture_size', 'texture_resolution', 'texture_res']) {
        if (has(k)) { input[k] = high ? 2048 : 1024; break; }
    }
    // Mesh density / simplification
    if (has('mesh_simplify')) input.mesh_simplify = high ? 0.9 : 0.95;
    for (const k of ['face_count', 'num_faces', 'target_face_num', 'max_facenum', 'face_limit', 'max_faces']) {
        if (has(k)) {
            const max = props[k].maximum ?? 1500000, min = props[k].minimum ?? 10000;
            input[k] = Math.min(max, Math.max(min, high ? 300000 : 100000));
            break;
        }
    }
    // Quality tiers (e.g. Rodin)
    for (const k of ['quality', 'tier']) {
        const en = enumOf(k);
        if (has(k) && en) {
            input[k] = high ? (en.find(v => /^high$/i.test(v)) || en[0]) : (en.find(v => /^(medium|standard)$/i.test(v)) || en[en.length - 1]);
            break;
        }
    }
    // Always want a GLB back
    for (const k of ['geometry_file_format', 'output_format', 'file_format', 'mesh_format']) {
        const en = enumOf(k);
        if (has(k) && (!en || en.includes('glb'))) { input[k] = 'glb'; break; }
    }
    // PBR / textures on, preview videos off (saves minutes)
    for (const k of ['generate_pbr', 'pbr', 'enable_pbr', 'with_texture', 'generate_texture']) {
        if (has(k) && props[k].type === 'boolean') { input[k] = true; break; }
    }
    if (has('material')) { const en = enumOf('material'); if (en) input.material = en.find(v => /pbr/i.test(v)) || en[0]; }
    if (has('generate_model')) input.generate_model = true;
    for (const k of ['generate_color', 'generate_normal', 'render_video', 'generate_video', 'save_video']) {
        if (has(k) && props[k].type === 'boolean') input[k] = false;
    }
    return input;
}

// Find the mesh URL in whatever shape the model returns
function pickModelUrl(output) {
    const urls = [];
    const walk = (v) => {
        if (!v) return;
        if (typeof v === 'string') { if (/^https?:\/\//.test(v)) urls.push(v); return; }
        if (Array.isArray(v)) return v.forEach(walk);
        if (typeof v === 'object') {
            // prefer obviously-named mesh fields
            for (const k of ['model_file', 'glb', 'mesh', 'model', 'output', 'geometry']) {
                if (typeof v[k] === 'string') urls.unshift(v[k]);
            }
            Object.values(v).forEach(walk);
        }
    };
    walk(output);
    const byExt = urls.find(u => /\.glb(\?|$)/i.test(u));
    return byExt || urls.find(u => !/\.(mp4|webm|png|jpg|jpeg|gif|ply)(\?|$)/i.test(u)) || urls[0] || null;
}

async function generate3DReplicate(model, opts) {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error('Image → 3D is not configured on this server (REPLICATE_API_TOKEN is missing).');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const meta = await replicateModelMeta(model, token);
    const input = buildReplicate3DInput(meta.props, opts);

    // Official models accept the models/… endpoint; community models need a version id
    let createRes = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
        method: 'POST', headers, body: JSON.stringify({ input })
    });
    if (!createRes.ok && meta.version) {
        createRes = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST', headers, body: JSON.stringify({ version: meta.version, input })
        });
    }
    if (!createRes.ok) {
        const t = await createRes.text().catch(() => '');
        throw new Error(`Replicate request failed (${createRes.status}): ${t.slice(0, 300)}`);
    }
    let pred = await createRes.json();
    const pollUrl = pred.urls?.get || `https://api.replicate.com/v1/predictions/${pred.id}`;

    const deadline = Date.now() + 20 * 60 * 1000;
    while (!['succeeded', 'failed', 'canceled'].includes(pred.status) && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000));
        const pr = await fetch(pollUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (pr.ok) pred = await pr.json();
    }
    if (pred.status !== 'succeeded') {
        throw new Error(pred.status === 'failed' ? `3D generation failed: ${String(pred.error || '').slice(0, 300)}` : `3D generation ${pred.status || 'timed out'}.`);
    }

    const url = pickModelUrl(pred.output);
    if (!url) throw new Error('Replicate returned no mesh file.');
    const fileRes = await fetch(url);
    if (!fileRes.ok) throw new Error('Failed to download the generated mesh.');
    const buf = Buffer.from(await fileRes.arrayBuffer());
    const ext = (url.match(/\.(glb|gltf|obj|fbx|stl)(\?|$)/i)?.[1] || 'glb').toLowerCase();
    return {
        modelType: ext,
        modelName: `${model.split('/')[1]}.${ext}`,
        modelData: ext === 'gltf' || ext === 'obj' ? buf.toString('utf-8') : buf.toString('base64')
    };
}

app.post('/api/generate-3d', isAuthenticated, async (req, res) => {
    try {
        const { model, image, prompt, quality, seed } = req.body;
        if (!image || !image.startsWith('data:image/')) return res.status(400).json({ error: 'No source image provided' });
        if (!REPLICATE_3D_MODELS.has(model)) return res.status(400).json({ error: `Unknown 3D model: ${model}` });

        const settings = await storage.getSettings();
        const cost = settings.modelCosts[model] || 6;
        if (!req.user.credits || req.user.credits < cost) {
            return res.status(403).json({ error: `Insufficient credits. This model requires ${cost} credits.` });
        }

        pruneVideoJobs();
        const jobId = `${req.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const job = { userId: req.user.id, status: 'pending', result: null, error: null, createdAt: Date.now(), model, cost };
        videoJobs.set(jobId, job);
        console.log(`3D job ${jobId}: ${model}, quality=${quality}, seed=${seed ?? 'random'}`);
        res.status(202).json({ jobId, cost });

        (async () => {
            const t0 = Date.now();
            try {
                job.status = 'in_progress';
                const result = await generate3DReplicate(model, { image, prompt, quality, seed });
                const users = await storage.getUsers();
                const idx = users.findIndex(u => u.id === job.userId);
                if (idx !== -1) {
                    users[idx].credits = (users[idx].credits || 0) - cost;
                    users[idx].usedCredits = (users[idx].usedCredits || 0) + cost;
                    await storage.setUsers(users);
                    job.creditsRemaining = users[idx].credits;
                }
                job.result = result;
                job.status = 'completed';
                console.log(`3D job ${jobId} completed in ${Math.round((Date.now() - t0) / 1000)}s (${result.modelType}, ${Math.round(result.modelData.length / 1024)} KB)`);
            } catch (err) {
                console.error(`3D job ${jobId} failed:`, err);
                job.status = 'failed';
                job.error = err?.error?.message || err?.message || '3D generation failed.';
            }
        })();
    } catch (error) {
        console.error('Error submitting 3D job:', error);
        res.status(500).json({ error: error?.message || 'Failed to start 3D generation.' });
    }
});

// ── LLM CHAT (OpenRouter chat completions, text out) ────────────────────────
const CHAT_MODELS = new Set(['anthropic/claude-sonnet-5', 'anthropic/claude-opus-5', 'google/gemini-3.7-flash']);

app.post('/api/chat', isAuthenticated, async (req, res) => {
    try {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'The assistant is not configured on this server (OPENROUTER_API_KEY is missing).' });

        const { model, messages, system } = req.body;
        if (!CHAT_MODELS.has(model)) return res.status(400).json({ error: `Unknown chat model: ${model}` });
        if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'No messages' });

        const settings = await storage.getSettings();
        const cost = settings.modelCosts[model] || 1;
        if (!req.user.credits || req.user.credits < cost) {
            return res.status(403).json({ error: `Insufficient credits. This model requires ${cost} credits.` });
        }

        // messages: [{ role, text, images?: [dataUrl] }] → OpenRouter format
        const orMessages = [];
        if (system) orMessages.push({ role: 'system', content: system });
        for (const m of messages.slice(-20)) {
            const role = m.role === 'assistant' ? 'assistant' : 'user';
            const text = String(m.text || '').slice(0, 20000);
            if (role === 'user' && Array.isArray(m.images) && m.images.length) {
                orMessages.push({
                    role,
                    content: [
                        { type: 'text', text },
                        ...m.images.slice(0, 4).map(url => ({ type: 'image_url', image_url: { url } }))
                    ]
                });
            } else {
                orMessages.push({ role, content: text });
            }
        }

        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: orMessages, max_tokens: 1500 })
        });
        if (!r.ok) {
            const t = await r.text().catch(() => '');
            throw new Error(`Chat request failed (${r.status}): ${t.slice(0, 300)}`);
        }
        const data = await r.json();
        const content = data.choices?.[0]?.message?.content;
        const text = typeof content === 'string'
            ? content
            : Array.isArray(content) ? content.map(p => p.text || '').join('') : '';
        if (!text.trim()) throw new Error('The model returned no text.');

        const users = await storage.getUsers();
        const idx = users.findIndex(u => u.id === req.user.id);
        let creditsRemaining;
        if (idx !== -1) {
            users[idx].credits = (users[idx].credits || 0) - cost;
            users[idx].usedCredits = (users[idx].usedCredits || 0) + cost;
            await storage.setUsers(users);
            creditsRemaining = users[idx].credits;
        }
        res.json({ text: text.trim(), creditsRemaining });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: error?.message || 'Chat failed.' });
    }
});

// Poll a background job (video or 3D) — the result is handed over once, then the job is dropped
app.get('/api/video-jobs/:id', isAuthenticated, (req, res) => {
    const job = videoJobs.get(req.params.id);
    if (!job || job.userId !== req.user.id) return res.status(404).json({ error: 'Job not found' });
    const payload = { status: job.status, error: job.error, creditsRemaining: job.creditsRemaining };
    if (job.status === 'completed') { Object.assign(payload, job.result || {}); videoJobs.delete(req.params.id); }
    if (job.status === 'failed') videoJobs.delete(req.params.id);
    res.json(payload);
});

// Protect the generate endpoint with authentication
app.post('/api/generate', isAuthenticated, async (req, res) => {
    try {
        const { prompt, images, model, resolution, outputFormat, steps, guidance, sourceWidth, sourceHeight } = req.body;
        
        // Determine cost based on model
        const settings = await storage.getSettings();
        const selectedModel = model || (images && images.length > 0 ? 'gemini-3.1-flash-image' : 'imagen-4.0-fast-generate-001');
        const cost = settings.modelCosts[selectedModel] || 1;

        // Check if user has enough credits
        if (!req.user.credits || req.user.credits < cost) {
            return res.status(403).json({ error: `Insufficient credits. This model requires ${cost} credits.` });
        }
        
        let userAspectRatio = req.body.aspectRatio;

        if (!prompt) {
            return res.status(400).json({ error: 'No prompt provided' });
        }

        console.log('Generating image with prompt:', prompt);
        console.log('Number of input images:', images ? images.length : 0);
        
        console.log('Using model:', selectedModel, 'Cost:', cost);

        let result = {
            text: null,
            image: null
        };

        // Resolve output MIME type from outputFormat param
        const fmtToMime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
        const outputMime = fmtToMime[outputFormat] || 'image/jpeg';

        if (BFL_MODELS.has(selectedModel)) {
            // FLUX.2 (Black Forest Labs): async submit → poll → download
            console.log(`Using ${selectedModel} (FLUX.2 / BFL) for generation`);
            result.image = await generateWithBFL(
                selectedModel, prompt, images, userAspectRatio, resolution, outputFormat,
                { steps, guidance, sourceWidth, sourceHeight }
            );
            console.log('FLUX.2 image received');

        } else if (selectedModel === 'gpt-image-2-2026-04-21') {
            // GPT Image 2: text-to-image or image editing
            // Resolution maps to size: standard→1024, hd→1536, 4k→1792 (max supported)
            const resolutionSizeMap = {
                standard: { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536' },
                hd:       { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536' },
                '4k':     { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536' }
            };
            const sizeMap = resolutionSizeMap[resolution] || resolutionSizeMap.hd;
            // GPT Image 2 only offers square / landscape / portrait
            const gptRatio = resolveAspectRatio(userAspectRatio, sourceWidth, sourceHeight, ['1:1', '16:9', '9:16']);
            const size = sizeMap[gptRatio] || '1024x1024';
            console.log('Requested aspect ratio:', userAspectRatio, '→ using:', gptRatio, `(${size})`);

            let responseData;
            if (images && images.length > 0) {
                const src = images[0];
                const mimeMatch = src.match(/^data:([^;]+);base64,/);
                const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                const ext = mimeType.split('/')[1] || 'jpg';
                const rawB64 = src.includes('base64,') ? src.split('base64,')[1] : src;
                const imageFile = await toFile(Buffer.from(rawB64, 'base64'), `image.${ext}`, { type: mimeType });
                const response = await openai.images.edit({
                    model: selectedModel,
                    image: imageFile,
                    prompt,
                    n: 1,
                    size
                });
                responseData = response.data[0];
            } else {
                const response = await openai.images.generate({
                    model: selectedModel,
                    prompt,
                    n: 1,
                    size
                });
                responseData = response.data[0];
            }

            if (responseData.b64_json) {
                result.image = `data:image/png;base64,${responseData.b64_json}`;
            } else {
                const imgRes = await fetch(responseData.url);
                const mimeType = imgRes.headers.get('content-type') || 'image/png';
                const buf = Buffer.from(await imgRes.arrayBuffer());
                result.image = `data:${mimeType};base64,${buf.toString('base64')}`;
            }
            console.log('GPT Image 2 response received');

        } else if (selectedModel === 'imagen-4.0-ultra-generate-001' || selectedModel === 'imagen-4.0-fast-generate-001') {
            // TEXT-TO-IMAGE: Use Imagen with aspect ratio support
            console.log(`Using ${selectedModel} for text-to-image generation`);
            
            // Define the set of valid aspect ratios for Imagen
            const SUPPORTED_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
            const aspectRatio = resolveAspectRatio(userAspectRatio, sourceWidth, sourceHeight, SUPPORTED_ASPECT_RATIOS);

            console.log('Requested aspect ratio:', userAspectRatio);
            console.log('Using aspect ratio:', aspectRatio);

            // Resolution → enhancedGeneration hint (ultra model only)
            const imagenConfig = {
                numberOfImages: 1,
                aspectRatio,
                outputMimeType: outputMime
            };
            if (resolution === '4k' && selectedModel === 'imagen-4.0-ultra-generate-001') {
                imagenConfig.enhancedGeneration = true;
            }

            // Generate using Imagen
            const response = await ai.models.generateImages({
                model: selectedModel,
                prompt,
                config: imagenConfig
            });

            // Process response - Imagen returns generatedImages array
            if (!response || !response.generatedImages || response.generatedImages.length === 0) {
                console.error('No images generated:', JSON.stringify(response, null, 2));
                return res.status(500).json({ error: 'No images generated by the model.' });
            }

            const generatedImage = response.generatedImages[0];
            const imageBytes = generatedImage.image.imageBytes;
            result.image = `data:${outputMime};base64,${imageBytes}`;
            console.log('Generated image (base64 length):', imageBytes.length);

        } else {
            // GEMINI MODELS: Use generateContent (supports multimodal)
            console.log(`Using ${selectedModel} for generation`);

            // Map resolution → imageSize (Gemini 3 models support 1K/2K/4K natively)
            const resolutionToImageSize = { standard: '1K', hd: '2K', '4k': '4K' };
            const imageSizeParam = resolutionToImageSize[resolution] || '2K';

            // Valid aspect ratios for Gemini image models
            const GEMINI_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'];
            const geminiAspectRatio = resolveAspectRatio(userAspectRatio, sourceWidth, sourceHeight, GEMINI_ASPECT_RATIOS);
            console.log('Requested aspect ratio:', userAspectRatio, '→ using:', geminiAspectRatio);

            // Build the contents array
            let contents = [];
            contents.push({ text: ` ${prompt}` });

            // Add all images to the contents if present
            if (images && images.length > 0) {
                images.forEach((image) => {
                    const mimeMatch = image.match(/^data:([^;]+);base64,/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                    const imageData = image.includes('base64,') ? image.split('base64,')[1] : image;
                    contents.push({
                        inlineData: { mimeType, data: imageData }
                    });
                });
            }

            // Gemini 3 models support imageSize; Gemini 2.5 only supports aspectRatio
            const isGemini3 = selectedModel.startsWith('gemini-3');
            const geminiImageConfig = isGemini3
                ? { aspectRatio: geminiAspectRatio, imageSize: imageSizeParam }
                : { aspectRatio: geminiAspectRatio };

            // Generate using Gemini model
            console.log(`Calling Gemini ${selectedModel} with ${contents.length - 1} image(s), aspectRatio=${geminiAspectRatio}, imageSize=${imageSizeParam}`);
            const t0 = Date.now();
            const response = await ai.models.generateContent({
                model: selectedModel,
                contents,
                config: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: geminiImageConfig
                }
            });
            console.log(`Gemini responded in ${Date.now() - t0}ms`);

            // Process response
            if (!response || !response.candidates || !response.candidates[0]) {
                const blockReason = response?.promptFeedback?.blockReason || null;
                console.error(
                    'No candidates in response. blockReason:', blockReason || 'none',
                    '\nresponse:', JSON.stringify(response, null, 2)
                );
                return res.status(500).json({
                    error: describeEmptyResponse(null, blockReason),
                    blockReason
                });
            }

            const candidate = response.candidates[0];

            if (!candidate.content || !candidate.content.parts) {
                const finishReason = candidate.finishReason || 'UNKNOWN';
                const blockReason = response.promptFeedback?.blockReason || null;
                console.error(
                    'No content in response. finishReason:', finishReason,
                    'blockReason:', blockReason || 'none',
                    '\ncandidate:', JSON.stringify(candidate, null, 2),
                    '\npromptFeedback:', JSON.stringify(response.promptFeedback || null)
                );
                return res.status(500).json({
                    error: describeEmptyResponse(finishReason, blockReason),
                    finishReason,
                    blockReason
                });
            }

            for (const part of candidate.content.parts) {
                if (part.text) {
                    result.text = part.text;
                } else if (part.inlineData) {
                    const imageData = part.inlineData.data;
                    const mime = part.inlineData.mimeType || 'image/png';
                    result.image = `data:${mime};base64,${imageData}`;
                    console.log('Generated image (base64 length):', imageData.length);
                }
            }
        }

        // Deduct credits from user
        const users = await storage.getUsers();
        const userIndex = users.findIndex(u => u.id === req.user.id);

        if (userIndex !== -1) {
            users[userIndex].credits = (users[userIndex].credits || 0) - cost;
            users[userIndex].usedCredits = (users[userIndex].usedCredits || 0) + cost;
            await storage.setUsers(users);

            // Update session user object
            req.user.credits = users[userIndex].credits;

            // Add credits info to response
            result.creditsRemaining = users[userIndex].credits;
            result.usedCredits = users[userIndex].usedCredits;
        }

        res.json(result);
    } catch (error) {
        console.error('Error generating content:', error);
        const message = error?.error?.message || error?.message || 'Failed to generate image. Please try again.';
        res.status(500).json({ error: message });
    }
});

// Delete own account (authenticated user)
app.delete('/api/user/delete', isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const users = await storage.getUsers();
        
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Remove user
        users.splice(userIndex, 1);
        
        await storage.setUsers(users);
        
        // Clear JWT cookie
        clearAuthCookie(res);
        
        // Logout the user from session
        req.logout((err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to logout after deletion' });
            }
            res.json({ message: 'Account deleted successfully' });
        });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

// ── IMAGE BLOB API ────────────────────────────────────────────────────────────

// POST /api/images — upload image blob, returns {id}
app.post('/api/images', isAuthenticated, async (req, res) => {
    try {
        const { data } = req.body; // base64 data URL
        if (!data || !data.startsWith('data:')) return res.status(400).json({ error: 'Invalid image data' });
        const { createHash } = await import('crypto');
        const id = createHash('sha256').update(data).digest('hex').slice(0, 24);
        await storage.saveImage(id, data);
        res.json({ id });
    } catch (e) {
        console.error('Image save error:', e);
        res.status(500).json({ error: 'Failed to save image' });
    }
});

// GET /api/images/:id — serve image binary
app.get('/api/images/:id', isAuthenticated, async (req, res) => {
    try {
        const img = await storage.getImage(req.params.id);
        if (!img) return res.status(404).send();
        res.setHeader('Content-Type', img.mimeType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(img.buffer);
    } catch (e) {
        res.status(500).send();
    }
});

// ── BOARDS API ─────────────────────────────────────────────────────────────

// GET /api/boards — list board metadata for current user (no state payload)
app.get('/api/boards', isAuthenticated, async (req, res) => {
    try {
        const boards = await storage.getBoards(req.user.id);
        const meta = boards
            .map(b => {
                const { state, ...m } = b;
                m.size = JSON.stringify(b).length; // bytes including state
                m.nodeCount = state?.nodes?.length || 0;
                return m;
            })
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        res.json(meta);
    } catch (error) {
        console.error('Error listing boards:', error);
        res.status(500).json({ error: 'Failed to list boards' });
    }
});

// POST /api/boards — create or update a board
app.post('/api/boards', isAuthenticated, async (req, res) => {
    try {
        const { name, state, preview, baseUpdatedAt, force } = req.body;
        let { id } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Board name is required' });
        }
        if (!state || !state.nodes) {
            return res.status(400).json({ error: 'Invalid canvas state' });
        }

        if (!id) {
            id = `${req.user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        }

        const result = await storage.withUserLock(req.user.id, async () => {
            const boards = await storage.getBoards(req.user.id);
            const existing = boards.findIndex(b => b.id === id);

            // Optimistic locking: the client sends the updatedAt it last saw. A
            // newer stamp on disk means someone else (another tab) has saved in
            // the meantime — refuse rather than overwrite their work.
            if (existing >= 0 && baseUpdatedAt && !force && boards[existing].updatedAt !== baseUpdatedAt) {
                return {
                    status: 409,
                    body: {
                        error: 'This board was saved somewhere else in the meantime.',
                        conflict: true,
                        updatedAt: boards[existing].updatedAt,
                        name: boards[existing].name
                    }
                };
            }

            const now = new Date().toISOString();
            const createdAt = existing >= 0 ? boards[existing].createdAt : now;
            const board = { id, name: name.trim(), createdAt, updatedAt: now, preview: preview || null, state };

            if (existing >= 0) {
                storage.getBoardState(id).then(oldState => {
                    if (oldState) storage.pushVersion(req.user.id, id, oldState)
                        .catch(e => console.warn('pushVersion failed (non-fatal):', e.message));
                }).catch(() => {});
                boards[existing] = board;
            } else {
                boards.push(board);
            }

            await storage.setBoards(req.user.id, boards);
            return {
                status: 200,
                body: { id: board.id, name: board.name, createdAt: board.createdAt, updatedAt: board.updatedAt }
            };
        });

        res.status(result.status).json(result.body);
    } catch (error) {
        console.error('Error saving board:', error);
        res.status(500).json({ error: 'Failed to save board' });
    }
});

// GET /api/boards/:id — load full canvas state for one board
app.get('/api/boards/:id', isAuthenticated, async (req, res) => {
    try {
        const boards = await storage.getBoards(req.user.id);
        const board = boards.find(b => b.id === req.params.id);
        if (!board) return res.status(404).json({ error: 'Board not found' });
        const state = await storage.getBoardState(req.params.id);
        if (!state) return res.status(404).json({ error: 'Board state not found' });
        res.json(state);
    } catch (error) {
        console.error('Error loading board:', error);
        res.status(500).json({ error: 'Failed to load board' });
    }
});

// GET /api/boards/:id/export — download full board (state + meta) as JSON
app.get('/api/boards/:id/export', isAuthenticated, async (req, res) => {
    try {
        const boards = await storage.getBoards(req.user.id);
        const board = boards.find(b => b.id === req.params.id);
        if (!board) return res.status(404).json({ error: 'Board not found' });
        const state = await storage.getBoardState(req.params.id);
        const { name, createdAt, updatedAt } = board;
        const filename = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.dc.json`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json({ name, createdAt, updatedAt, state });
    } catch (error) {
        res.status(500).json({ error: 'Failed to export board' });
    }
});

// GET /api/boards/:id/versions — list version timestamps (no state payloads)
app.get('/api/boards/:id/versions', isAuthenticated, async (req, res) => {
    try {
        const versions = await storage.getVersions(req.user.id, req.params.id);
        res.json(versions);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load versions' });
    }
});

// GET /api/boards/:id/versions/:idx — restore a specific version state
app.get('/api/boards/:id/versions/:idx', isAuthenticated, async (req, res) => {
    try {
        const idx = parseInt(req.params.idx, 10);
        if (isNaN(idx) || idx < 0) return res.status(400).json({ error: 'Invalid version index' });
        const state = await storage.getVersionState(req.user.id, req.params.id, idx);
        if (!state) return res.status(404).json({ error: 'Version not found' });
        res.json(state);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load version' });
    }
});

// PATCH /api/boards/:id — rename a board
app.patch('/api/boards/:id', isAuthenticated, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
        const renamed = await storage.withUserLock(req.user.id, async () => {
            const boards = await storage.getBoards(req.user.id);
            const idx = boards.findIndex(b => b.id === req.params.id);
            if (idx === -1) return null;
            boards[idx].name = name.trim();
            boards[idx].updatedAt = new Date().toISOString();
            await storage.setBoards(req.user.id, boards);
            return { id: boards[idx].id, name: boards[idx].name, updatedAt: boards[idx].updatedAt };
        });
        if (!renamed) return res.status(404).json({ error: 'Board not found' });
        res.json(renamed);
    } catch (error) {
        res.status(500).json({ error: 'Failed to rename board' });
    }
});

// DELETE /api/boards/:id — delete a board
app.delete('/api/boards/:id', isAuthenticated, async (req, res) => {
    try {
        await storage.withUserLock(req.user.id, async () => {
            const boards = await storage.getBoards(req.user.id);
            const filtered = boards.filter(b => b.id !== req.params.id);
            await storage.setBoards(req.user.id, filtered);
        });
        res.json({ message: 'Board deleted' });
    } catch (error) {
        console.error('Error deleting board:', error);
        res.status(500).json({ error: 'Failed to delete board' });
    }
});

// GET /api/admin/storage — per-user board storage stats (admin only)
app.get('/api/admin/storage', isAdmin, async (req, res) => {
    try {
        const users = await storage.getUsers();
        let totalBytes = 0;
        const result = [];

        for (const user of users) {
            const boards = await storage.getBoards(user.id);
            let userBytes = 0;
            const boardStats = boards.map(b => {
                const bytes = JSON.stringify(b).length;
                userBytes += bytes;
                return {
                    id: b.id,
                    name: b.name,
                    nodeCount: b.state?.nodes?.length || 0,
                    bytes,
                    updatedAt: b.updatedAt
                };
            });
            totalBytes += userBytes;
            result.push({
                id: user.id,
                displayName: user.displayName || user.email,
                email: user.email,
                photo: user.photo,
                totalBytes: userBytes,
                boards: boardStats.sort((a, b) => b.bytes - a.bytes)
            });
        }

        result.sort((a, b) => b.totalBytes - a.totalBytes);
        res.json({ totalBytes, users: result });
    } catch (error) {
        console.error('Error loading storage stats:', error);
        res.status(500).json({ error: 'Failed to load storage stats' });
    }
});

// Blobs carry no metadata of their own — in Redis mode not even a timestamp.
// Boards and their versions do, so walk them once and remember, per blob, the
// earliest state it appeared in: that is when the image was made, and which
// board it belonged to. Cached, because it reads every board state.
const IMAGE_INDEX_TTL = 5 * 60 * 1000;
const VERSIONS_PER_BOARD = 20;
let imageIndexCache = { at: 0, map: null };

function collectRefs(state, into, ts, boardName) {
    if (!ts || !state || !Array.isArray(state.nodes)) return;
    for (const node of state.nodes) {
        const data = node?.data || {};
        for (const ref of [data.imageRef, data.videoRef, data.modelRef]) {
            if (!ref) continue;
            const prev = into.get(ref);
            if (!prev || ts < prev.ts) into.set(ref, { ts, boardName });
        }
    }
}

async function getImageIndex() {
    if (imageIndexCache.map && Date.now() - imageIndexCache.at < IMAGE_INDEX_TTL) {
        return imageIndexCache.map;
    }

    const map = new Map();
    const users = await storage.getUsers();
    for (const user of users) {
        const boards = await storage.getBoards(user.id);
        for (const board of boards) {
            const name = board.name || board.id;
            collectRefs(await storage.getBoardState(board.id), map, Date.parse(board.updatedAt), name);

            // Older states hold images the current one no longer references —
            // exactly the ones an overwrite lost. Bounded so this stays cheap.
            const versions = await storage.getVersions(user.id, board.id);
            for (let i = 0; i < Math.min(versions.length, VERSIONS_PER_BOARD); i++) {
                const state = await storage.getVersionState(user.id, board.id, i);
                collectRefs(state, map, Date.parse(versions[i].savedAt), name);
            }
        }
    }

    imageIndexCache = { at: Date.now(), map };
    return map;
}

// GET /api/admin/images — every stored image blob, newest first.
// Blobs survive a board being overwritten, so this is also the recovery path
// for images whose board state is gone.
app.get('/api/admin/images', isAdmin, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const all = await storage.listImages();
        const totalBytes = all.reduce((sum, img) => sum + (img.bytes || 0), 0);

        const index = await getImageIndex();
        for (const img of all) {
            const hit = index.get(img.id);
            img.board = hit ? hit.boardName : null;
            // Take the earliest evidence there is. A blob's mtime can be younger
            // than the image (an older store rewrote the file on every re-upload),
            // and a board's updatedAt only says when it was last saved — whichever
            // is older is the closer guess at when the image was made.
            const stamps = [img.mtime, hit?.ts].filter(Boolean);
            img.date = stamps.length ? Math.min(...stamps) : null;
        }
        all.sort((a, b) => (b.date || 0) - (a.date || 0));

        res.json({
            total: all.length,
            totalBytes,
            offset,
            images: all.slice(offset, offset + limit)
        });
    } catch (error) {
        console.error('Error listing images:', error);
        res.status(500).json({ error: 'Failed to list images' });
    }
});

// Update user credits (admin only)
app.patch('/api/admin/users/:id/credits', isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { credits } = req.body;
        
        if (typeof credits !== 'number' || credits < 0) {
            return res.status(400).json({ error: 'Invalid credits value' });
        }
        
        const users = await storage.getUsers();
        
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        users[userIndex].credits = credits;
        
        await storage.setUsers(users);
        
        res.json({ message: 'Credits updated successfully', credits: credits });
    } catch (error) {
        console.error('Error updating credits:', error);
        res.status(500).json({ error: 'Failed to update credits' });
    }
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Make sure GOOGLE_API_KEY environment variable is set');
    
    if (!process.env.GOOGLE_API_KEY) {
        console.warn('WARNING: GOOGLE_API_KEY not set!');
        console.warn('Set it with: export GOOGLE_API_KEY="your-api-key"');
    }
    
    // Initialize storage
    await storage.init();
});
