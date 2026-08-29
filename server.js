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

// Resolve the client's aspectRatio for one provider. 'original' (the default)
// maps to whichever supported ratio is closest to the source medium.
function resolveAspectRatio(requested, sourceWidth, sourceHeight, supported, fallback = '1:1') {
    if (requested === 'original') {
        return nearestSupportedRatio(sourceWidth, sourceHeight, supported, fallback);
    }
    return supported.includes(requested) ? requested : fallback;
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
            const GEMINI_ASPECT_RATIOS = ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'];
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
            const responseFormatImage = isGemini3
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
                    responseFormat: { image: responseFormatImage }
                }
            });
            console.log(`Gemini responded in ${Date.now() - t0}ms`);

            // Process response
            if (!response || !response.candidates || !response.candidates[0]) {
                console.error('Unexpected API response structure:', JSON.stringify(response, null, 2));
                return res.status(500).json({ 
                    error: 'Unexpected response from AI model.'
                });
            }

            const candidate = response.candidates[0];
            
            if (!candidate.content || !candidate.content.parts) {
                console.error('No content in response:', JSON.stringify(candidate, null, 2));
                return res.status(500).json({ 
                    error: 'No content returned from AI model.'
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
        const { name, state, preview } = req.body;
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

        const boards = await storage.getBoards(req.user.id);
        const existing = boards.findIndex(b => b.id === id);
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
        res.json({ id: board.id, name: board.name, createdAt: board.createdAt, updatedAt: board.updatedAt });
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
        const boards = await storage.getBoards(req.user.id);
        const idx = boards.findIndex(b => b.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'Board not found' });
        boards[idx].name = name.trim();
        boards[idx].updatedAt = new Date().toISOString();
        await storage.setBoards(req.user.id, boards);
        res.json({ id: boards[idx].id, name: boards[idx].name, updatedAt: boards[idx].updatedAt });
    } catch (error) {
        res.status(500).json({ error: 'Failed to rename board' });
    }
});

// DELETE /api/boards/:id — delete a board
app.delete('/api/boards/:id', isAuthenticated, async (req, res) => {
    try {
        const boards = await storage.getBoards(req.user.id);
        const filtered = boards.filter(b => b.id !== req.params.id);
        await storage.setBoards(req.user.id, filtered);
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
