import { getAuthUser } from '../../../../jwt-auth.js';
import { storage } from '../../../../storage.js';

export default async function handler(req, res) {
    // Only allow PATCH requests
    if (req.method !== 'PATCH') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const user = getAuthUser(req);
        if (!user || !user.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const userId = req.query.id;
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
}
