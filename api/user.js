import { getAuthUser } from '../jwt-auth.js';
import { storage } from '../storage.js';

export default async function handler(req, res) {
    try {
        // Check JWT authentication
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
        res.json({ user: null });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
}
