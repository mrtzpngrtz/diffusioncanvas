import { getAuthUser } from '../../jwt-auth.js';
import { storage } from '../../storage.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
    const user = getAuthUser(req);
    if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (req.method === 'GET') {
        try {
            const users = await storage.getUsers();
            res.json(users);
        } catch (error) {
            console.error('Error loading users:', error);
            res.status(500).json({ error: 'Failed to load users' });
        }
    } else if (req.method === 'POST') {
        try {
            const { email, password, isAdmin } = req.body;

            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password are required' });
            }

            const users = await storage.getUsers();

            // Check if user already exists
            if (users.some(u => u.email === email)) {
                return res.status(409).json({ error: 'User with this email already exists' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            const newUser = {
                id: uuidv4(),
                email: email,
                password: hashedPassword,
                displayName: email.split('@')[0],
                photo: null,
                provider: 'password',
                isAdmin: isAdmin || false,
                credits: 10, // Default credits for new users
                usedCredits: 0,
                createdAt: new Date().toISOString()
            };

            users.push(newUser);
            await storage.setUsers(users);

            res.status(201).json(newUser);
        } catch (error) {
            console.error('Error creating user:', error);
            res.status(500).json({ error: 'Failed to create user' });
        }
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
}
