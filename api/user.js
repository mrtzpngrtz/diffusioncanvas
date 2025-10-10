import { getAuthUser } from '../jwt-auth.js';
import { storage } from '../storage.js';

export default async function handler(req, res) {
    try {
        // Check if bypass auth is enabled
        if (process.env.BYPASS_AUTH === 'true') {
            const users = await storage.getUsers();
            let testUser = users.find(u => u.id === 'test-user-local');
            
            if (!testUser) {
                // Create default test user
                testUser = {
                    id: 'test-user-local',
                    email: 'test@local.dev',
                    displayName: 'Test User (Local Dev)',
                    provider: 'bypass',
                    credits: 1000,
                    isAdmin: true,
                    createdAt: new Date().toISOString()
                };
                users.push(testUser);
                await storage.setUsers(users);
            }
            
            return res.json({ user: testUser });
        }
        
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
