import passport from '../../../auth.js';
import { setAuthCookie } from '../../../jwt-auth.js';

export default function handler(req, res) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(503).json({ error: 'Google OAuth not configured' });
    }
    
    passport.authenticate('google', { 
        failureRedirect: '/?error=auth_failed'
    }, (err, user) => {
        if (err || !user) {
            console.error('Google OAuth callback error:', err);
            return res.redirect('/?error=auth_failed');
        }
        
        // Set JWT cookie for persistent authentication
        setAuthCookie(res, user);
        res.redirect('/');
    })(req, res);
}
