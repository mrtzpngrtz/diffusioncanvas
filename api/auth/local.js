import bcrypt from 'bcryptjs';
import { storage } from '../../storage.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Get all users
        const users = await storage.getUsers();

        // Find user by username (case-insensitive)
        const user = users.find(u => 
            u.provider === 'local' && 
            u.username && 
            u.username.toLowerCase() === username.toLowerCase()
        );

        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Create session token (simple JWT-like approach)
        const token = Buffer.from(JSON.stringify({
            id: user.id,
            username: user.username,
            timestamp: Date.now()
        })).toString('base64');

        // Set session cookie
        res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);

        // Return user data (without password)
        const { password: _, ...userWithoutPassword } = user;
        return res.status(200).json({ 
            success: true, 
            user: userWithoutPassword 
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
