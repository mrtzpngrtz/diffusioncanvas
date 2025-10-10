import { getAuthUser, clearAuthCookie } from '../../jwt-auth.js';
import { storage } from '../../storage.js';

export default async function handler(req, res) {
    // Only allow DELETE requests
    if (req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const user = getAuthUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const userId = user.id;
        const users = await storage.getUsers();
        
        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Remove user
        users.splice(userIndex, 1);
        await storage.setUsers(users);
        
        // Clear JWT cookie
        clearAuthCookie(res);
        
        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
}
