import { storage } from '../storage.js';
import { getAuthUser } from '../jwt-auth.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Initialize storage
        await storage.init().catch(err => console.error('Storage init warning:', err));
        
        // Check JWT cookie for authentication
        const jwtUser = getAuthUser(req);
        
        if (!jwtUser) {
            return res.json({ user: null });
        }
        
        // Fetch fresh user data from database to get current credits
        const users = await storage.getUsers();
        const freshUser = users.find(u => u.id === jwtUser.id);
        
        if (freshUser) {
            return res.json({ user: freshUser });
        }
        
        // User not found in database (deleted?)
        return res.json({ user: null });
    } catch (error) {
        console.error('Error fetching user:', error);
        return res.status(500).json({ error: 'Failed to fetch user data' });
    }
}
