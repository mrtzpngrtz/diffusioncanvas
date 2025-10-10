import passport from '../../auth.js';

export default function handler(req, res) {
    // Only if Google OAuth is configured
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(503).json({ error: 'Google OAuth not configured' });
    }
    
    passport.authenticate('google', { 
        scope: ['profile', 'email'] 
    })(req, res);
}
