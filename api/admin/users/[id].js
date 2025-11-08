import { getAuthUser } from '../../../jwt-auth.js';
import { storage } from '../../../storage.js';

export default async function handler(req, res) {
    try {
        const user = getAuthUser(req);
        if (!user || !user.isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const userId = req.query.id;

        if (req.method === 'DELETE') {
            // Delete user
            if (userId === user.id) {
                return res.status(400).json({ error: 'Cannot delete your own account' });
            }
            
            const users = await storage.getUsers();
            const userIndex = users.findIndex(u => u.id === userId);
            
            if (userIndex === -1) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // Prevent deleting other admins
            if (users[userIndex].isAdmin) {
                return res.status(400).json({ error: 'Cannot delete admin users' });
            }
            
            users.splice(userIndex, 1);
            await storage.setUsers(users);
            
            return res.json({ message: 'User deleted successfully' });
        } else if (req.method === 'PATCH') {
            // Update credits
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
            
            return res.json({ message: 'Credits updated successfully', credits: credits });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Error in admin user operation:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
}
