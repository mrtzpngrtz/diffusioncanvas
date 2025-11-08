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
app.use(express.json({ limit: '50mb' }));
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
        // Check if user has enough credits
        if (!req.user.credits || req.user.credits < 1) {
            return res.status(403).json({ error: 'Insufficient credits. Please contact an administrator.' });
        }

        const { prompt, images } = req.body;
        let userAspectRatio = req.body.aspectRatio;

        if (!prompt) {
            return res.status(400).json({ error: 'No prompt provided' });
        }

        console.log('Generating image with prompt:', prompt);
        console.log('Number of input images:', images ? images.length : 0);

        let result = {
            text: null,
            image: null
        };

        // Choose generation method based on whether input images are provided
        if (images && images.length > 0) {
            // IMAGE-TO-IMAGE: Use Gemini 2.5 Flash (no aspect ratio control)
            console.log('Using Gemini 2.5 Flash for image-to-image generation');
            
            // Build the contents array
            let contents = [];
            contents.push({ text: `Based on these ${images.length} input image${images.length > 1 ? 's' : ''}, ${prompt}` });
            
            // Add all images to the contents
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

            // Generate using Gemini 2.5 Flash
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
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

        } else {
            // TEXT-TO-IMAGE: Use Imagen 4.0 with aspect ratio support
            console.log('Using Imagen 4.0 for text-to-image generation');
            
            // Define the set of valid aspect ratios for Imagen
            const SUPPORTED_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);
            const aspectRatio = SUPPORTED_ASPECT_RATIOS.has(userAspectRatio) ? userAspectRatio : '1:1';
            
            console.log('Requested aspect ratio:', userAspectRatio);
            console.log('Using aspect ratio:', aspectRatio);

            // Generate using Imagen 4.0
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
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
        }

        // Deduct one credit from user
        const users = await storage.getUsers();
        const userIndex = users.findIndex(u => u.id === req.user.id);
        
        if (userIndex !== -1) {
            users[userIndex].credits = (users[userIndex].credits || 0) - 1;
            await storage.setUsers(users);
            
            // Update session user object
            req.user.credits = users[userIndex].credits;
            
            // Add credits info to response
            result.creditsRemaining = users[userIndex].credits;
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

// Video generation endpoint (Veo 3.1)
app.post('/api/generate-video', isAuthenticated, async (req, res) => {
    try {
        // Check if user has enough credits (video generation costs more - 3 credits)
        const VIDEO_GENERATION_COST = 3;
        if (!req.user.credits || req.user.credits < VIDEO_GENERATION_COST) {
            return res.status(403).json({ 
                error: `Insufficient credits. Video generation requires ${VIDEO_GENERATION_COST} credits. You have ${req.user.credits || 0}.` 
            });
        }

        const { prompt, duration, aspectRatio, frames } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'No prompt provided' });
        }

        console.log('Generating video with Veo 3.1:', {
            prompt,
            duration: duration || 8,
            aspectRatio: aspectRatio || '16:9',
            frameCount: frames ? Object.keys(frames).filter(k => frames[k]).length : 0
        });

        // Build the request for Veo 3.1
        const requestConfig = {
            model: 'veo-3.1',
            prompt: prompt,
            config: {
                duration: duration || 8,
                aspectRatio: aspectRatio || '16:9'
            }
        };

        // Add frame guidance if provided
        if (frames) {
            const frameGuidance = {};
            
            // Process first frame
            if (frames.first) {
                let imageData = frames.first;
                if (imageData.includes('base64,')) {
                    imageData = imageData.split('base64,')[1];
                }
                frameGuidance.firstFrame = {
                    image: {
                        imageBytes: imageData
                    }
                };
            }
            
            // Process middle frame
            if (frames.middle) {
                let imageData = frames.middle;
                if (imageData.includes('base64,')) {
                    imageData = imageData.split('base64,')[1];
                }
                frameGuidance.middleFrame = {
                    image: {
                        imageBytes: imageData
                    }
                };
            }
            
            // Process last frame
            if (frames.last) {
                let imageData = frames.last;
                if (imageData.includes('base64,')) {
                    imageData = imageData.split('base64,')[1];
                }
                frameGuidance.lastFrame = {
                    image: {
                        imageBytes: imageData
                    }
                };
            }
            
            // Only add frameGuidance if at least one frame is provided
            if (Object.keys(frameGuidance).length > 0) {
                requestConfig.config.frameGuidance = frameGuidance;
            }
        }

        // Generate video using Veo 3.1
        console.log('Calling Veo 3.1 API...');
        
        // Get the model
        const model = ai.getGenerativeModel({ model: 'veo-3.1' });
        
        // Build parts for the request
        const parts = [
            { text: prompt }
        ];
        
        // Add frame guidance if provided
        if (requestConfig.config.frameGuidance) {
            if (requestConfig.config.frameGuidance.firstFrame) {
                parts.push({
                    inlineData: {
                        data: requestConfig.config.frameGuidance.firstFrame.image.imageBytes,
                        mimeType: 'image/jpeg'
                    }
                });
            }
            if (requestConfig.config.frameGuidance.middleFrame) {
                parts.push({
                    inlineData: {
                        data: requestConfig.config.frameGuidance.middleFrame.image.imageBytes,
                        mimeType: 'image/jpeg'
                    }
                });
            }
            if (requestConfig.config.frameGuidance.lastFrame) {
                parts.push({
                    inlineData: {
                        data: requestConfig.config.frameGuidance.lastFrame.image.imageBytes,
                        mimeType: 'image/jpeg'
                    }
                });
            }
        }
        
        // Generate content
        const result = await model.generateContent({
            contents: [{ role: 'user', parts }],
            generationConfig: {
                videoDuration: requestConfig.config.duration,
                aspectRatio: requestConfig.config.aspectRatio
            }
        });
        
        const response = await result.response;

        // Process response
        if (!response || !response.candidates || response.candidates.length === 0) {
            console.error('No video generated:', JSON.stringify(response, null, 2));
            return res.status(500).json({ 
                error: 'No video generated by the model.'
            });
        }

        // Get the video URL or bytes from the response
        const candidate = response.candidates[0];
        const videoData = candidate.content?.parts?.[0]?.videoData || candidate.content?.parts?.[0]?.inlineData;
        
        if (!videoData) {
            console.error('No video data in response:', JSON.stringify(response, null, 2));
            return res.status(500).json({ 
                error: 'No video data in API response.'
            });
        }
        
        // Deduct credits from user
        const users = await storage.getUsers();
        const userIndex = users.findIndex(u => u.id === req.user.id);
        
        if (userIndex !== -1) {
            users[userIndex].credits = (users[userIndex].credits || 0) - VIDEO_GENERATION_COST;
            await storage.setUsers(users);
            
            // Update session user object
            req.user.credits = users[userIndex].credits;
        }

        // Return video data
        res.json({
            video: videoData.videoUrl || videoData.videoBytes,
            creditsRemaining: users[userIndex].credits,
            duration: duration || 8,
            aspectRatio: aspectRatio || '16:9'
        });

    } catch (error) {
        console.error('Error generating video:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to generate video'
        });
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
