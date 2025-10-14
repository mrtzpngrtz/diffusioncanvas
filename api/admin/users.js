import bcrypt from 'bcryptjs';
import { storage } from '../../storage.js';
import { getAuthUser } from '../../jwt-auth.js';

export default async function handler(req, res) {
    // Check authentication
    const authUser = getAuthUser(req);
    if (!authUser || !authUser.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { username, password, isAdmin } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }

        // Initialize storage
        await storage.init();

        const users = await storage.getUsers();

        // Check if username already exists
        const existingUser = users.find(u => u.username === username && u.provider === 'local');
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const user = {
            id: Date.now().toString(),
            provider: 'local',
            username: username,
            password: hashedPassword,
            email: '',
            displayName: username,
            firstName: '',
            lastName: '',
            photo: '',
            isAdmin: isAdmin || false,
            credits: 5,
            createdAt: new Date().toISOString()
        };

        users.push(user);
        await storage.setUsers(users);

        console.log('✓ New local user created:', username, isAdmin ? '(Admin)' : '');

        // Return user without password field
        const { password: _, ...userWithoutPassword } = user;

        return res.json({
            message: 'User created successfully',
            user: userWithoutPassword
        });
    } catch (error) {
        console.error('Error creating user:', error);
        return res.status(500).json({ error: error.message || 'Failed to create user' });
    }
}
