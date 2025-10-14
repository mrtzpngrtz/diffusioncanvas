import { getAuthUser } from '../../jwt-auth.js';
import { storage } from '../../storage.js';
import { createLocalUser } from '../../auth.js';

export default async function handler(req, res) {
    // Check admin access
    const user = getAuthUser(req);
    if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    try {
        if (req.method === 'GET') {
            // Get all users
            const users = await storage.getUsers();
            res.json(users);
        } else if (req.method === 'POST') {
            // Create new local user
            const { username, password, isAdmin } = req.body;
            
            if (!username || !password) {
                return res.status(400).json({ error: 'Username and password are required' });
            }
            
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters long' });
            }
            
            const newUser = await createLocalUser(username, password, isAdmin || false);
            
            res.json({ 
                message: 'User created successfully', 
                user: newUser 
            });
        } else {
            res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (error) {
        console.error('Error in users handler:', error);
        res.status(400).json({ error: error.message || 'Failed to process request' });
    }
}
