import bcrypt from 'bcryptjs';
import { storage } from '../../storage.js';
import { setAuthCookie } from '../../jwt-auth.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Initialize storage
        await storage.init();

        // Get all users
        const users = await storage.getUsers();

        // Find user by username
        const user = users.find(u => u.username === username && u.provider === 'local');

        if (!user) {
            return res.status(401).json({ error: 'Incorrect username or password' });
        }

        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.status(401).json({ error: 'Incorrect username or password' });
        }

        console.log('✓ Local user logged in:', user.username);

        // Return user without password field
        const { password: _, ...userWithoutPassword } = user;

        // Set JWT cookie for persistent authentication
        setAuthCookie(res, userWithoutPassword);

        return res.json({
            success: true,
            user: userWithoutPassword,
            message: 'Login successful'
        });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Authentication error' });
    }
}
