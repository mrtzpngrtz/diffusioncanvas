import { storage } from '../../storage.js';

// Helper to get user from session
async function getUserFromSession(req) {
    const sessionCookie = req.headers.cookie?.split(';')
        .find(c => c.trim().startsWith('session='));
    
    if (!sessionCookie) {
        return null;
    }

    try {
        const token = sessionCookie.split('=')[1];
        const sessionData = JSON.parse(Buffer.from(token, 'base64').toString());
        
        const users = await storage.getUsers();
        const user = users.find(u => u.id === sessionData.id);
        
        return user || null;
    } catch (error) {
        console.error('Session verification error:', error);
        return null;
    }
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Initialize storage if needed
        await storage.init().catch(err => console.error('Storage init warning:', err));
        
        const user = await getUserFromSession(req);
        
        if (!user) {
            return res.status(200).json({ user: null });
        }

        // Return user without password
        const { password, ...userWithoutPassword } = user;
        return res.status(200).json({ user: userWithoutPassword });

    } catch (error) {
        console.error('User fetch error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
