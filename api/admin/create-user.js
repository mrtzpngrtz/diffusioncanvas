import bcrypt from 'bcryptjs';
import { storage } from '../../storage.js';

// Helper to verify admin from session
async function verifyAdmin(req) {
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
        
        if (user && user.isAdmin) {
            return user;
        }
    } catch (error) {
        console.error('Admin verification error:', error);
    }
    
    return null;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Verify admin access
        const admin = await verifyAdmin(req);
        if (!admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { username, password, email, displayName, isAdmin, credits } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Validate username format
        if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
            return res.status(400).json({ 
                error: 'Username must be 3-20 characters, alphanumeric with _ or -' 
            });
        }

        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({ 
                error: 'Password must be at least 6 characters' 
            });
        }

        // Get all users
        const users = await storage.getUsers();

        // Check if username already exists
        const existingUser = users.find(u => 
            u.provider === 'local' && 
            u.username && 
            u.username.toLowerCase() === username.toLowerCase()
        );

        if (existingUser) {
            return res.status(409).json({ error: 'Username already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const newUser = {
            id: Date.now().toString(),
            provider: 'local',
            username: username,
            password: hashedPassword,
            email: email || '',
            displayName: displayName || username,
            firstName: '',
            lastName: '',
            photo: '',
            isAdmin: isAdmin === true,
            credits: typeof credits === 'number' ? credits : 5,
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        await storage.setUsers(users);

        // Return user without password
        const { password: _, ...userWithoutPassword } = newUser;
        
        return res.status(201).json({ 
            success: true, 
            user: userWithoutPassword 
        });

    } catch (error) {
        console.error('Create user error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
