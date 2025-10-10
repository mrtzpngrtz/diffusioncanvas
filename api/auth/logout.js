import { clearAuthCookie } from '../../jwt-auth.js';

export default function handler(req, res) {
    // Clear JWT cookie
    clearAuthCookie(res);
    
    // Clear session if it exists
    if (req.session && req.session.destroy) {
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destroy error:', err);
            }
            res.redirect('/');
        });
    } else {
        res.redirect('/');
    }
}
