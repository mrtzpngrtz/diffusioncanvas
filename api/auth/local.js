import passport from '../../auth.js';
import { setAuthCookie } from '../../jwt-auth.js';

export default function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    passport.authenticate('local', (err, user, info) => {
        if (err) {
            return res.status(500).json({ error: 'Authentication error' });
        }
        if (!user) {
            return res.status(401).json({ error: info?.message || 'Invalid credentials' });
        }
        
        req.login(user, (err) => {
            if (err) {
                return res.status(500).json({ error: 'Login failed' });
            }
            
            // Set JWT cookie for persistent authentication
            setAuthCookie(res, user);
            
            return res.json({ 
                success: true, 
                user: user,
                message: 'Login successful' 
            });
        });
    })(req, res);
}
