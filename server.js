import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import passport from './auth.js';
import bcrypt from 'bcryptjs';
import { setAuthCookie, getAuthUser, clearAuthCookie } from './jwt-auth.js';
import { storage } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Session configuration (still needed for OAuth flow)
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
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
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
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
app.post('/auth/local/login', (req, res, next) => {
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

// Protect the generate endpoint with authentication
app.post('/api/generate', isAuthenticated, async (req, res) => {
    try {
        const { prompt, images, model } = req.body;
        
        // Determine cost based on model
        const settings = await storage.getSettings();
        const selectedModel = model || (images && images.length > 0 ? 'gemini-3.1-flash-image-preview' : 'imagen-4.0-fast-generate-001');
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

        if (selectedModel === 'imagen-4.0-ultra-generate-001' || selectedModel === 'imagen-4.0-fast-generate-001') {
            // TEXT-TO-IMAGE: Use Imagen with aspect ratio support
            console.log(`Using ${selectedModel} for text-to-image generation`);
            
            // Define the set of valid aspect ratios for Imagen
            const SUPPORTED_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);
            const aspectRatio = SUPPORTED_ASPECT_RATIOS.has(userAspectRatio) ? userAspectRatio : '1:1';
            
            console.log('Requested aspect ratio:', userAspectRatio);
            console.log('Using aspect ratio:', aspectRatio);

            // Generate using Imagen
            const response = await ai.models.generateImages({
                model: selectedModel,
                prompt: prompt,
                config: {
                    numberOfImages: 1,
                    aspectRatio: aspectRatio
                }
            });

            // Process response - Imagen returns generatedImages array
            if (!response || !response.generatedImages || response.generatedImages.length === 0) {
                console.error('No images generated:', JSON.stringify(response, null, 2));
                return res.status(500).json({ 
                    error: 'No images generated by the model.'
                });
            }

            // Get the first generated image
            const generatedImage = response.generatedImages[0];
            const imageBytes = generatedImage.image.imageBytes;
            result.image = `data:image/png;base64,${imageBytes}`;
            console.log('Generated image (base64 length):', imageBytes.length);

        } else {
            // GEMINI MODELS: Use generateContent (supports multimodal)
            // This handles 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview', etc.
            console.log(`Using ${selectedModel} for generation`);
            
            // Build the contents array
            let contents = [];
            contents.push({ text: ` ${prompt}` });
            
            // Add all images to the contents if present
            if (images && images.length > 0) {
                images.forEach((image, index) => {
                    let imageData = image;
                    if (imageData.includes('base64,')) {
                        imageData = imageData.split('base64,')[1];
                    }
                    
                    contents.push({
                        inlineData: {
                            mimeType: 'image/png',
                            data: imageData
                        }
                    });
                });
            }

            // Generate using Gemini model
            const response = await ai.models.generateContent({
                model: selectedModel,
                contents: contents
            });

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
                    result.image = `data:image/png;base64,${imageData}`;
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
        res.status(500).json({ 
            error: error.message || 'Failed to generate content'
        });
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
        res.json(board.state);
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
        const { state, name, createdAt, updatedAt } = board;
        const filename = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.dc.json`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json({ name, createdAt, updatedAt, state });
    } catch (error) {
        res.status(500).json({ error: 'Failed to export board' });
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
