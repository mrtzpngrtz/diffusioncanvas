import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Strategy as LinkedInStrategy } from 'passport-linkedin-oauth2';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_FILE = path.join(__dirname, 'users.json');

// Initialize users file if it doesn't exist
async function initUsersFile() {
    try {
        await fs.access(USERS_FILE);
    } catch {
        await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
    }
}

// Load users from file
async function loadUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

// Save users to file
async function saveUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

// Find or create user
async function findOrCreateUser(profile, provider) {
    const users = await loadUsers();
    
    // Look for existing user
    let user = users.find(u => u.providerId === profile.id && u.provider === provider);
    
    if (!user) {
        // Create new user
        // First user is automatically admin
        const isFirstUser = users.length === 0;
        
        user = {
            id: Date.now().toString(),
            provider: provider,
            providerId: profile.id,
            email: profile.emails?.[0]?.value || '',
            displayName: profile.displayName || '',
            firstName: profile.name?.givenName || '',
            lastName: profile.name?.familyName || '',
            photo: profile.photos?.[0]?.value || '',
            isAdmin: isFirstUser,
            credits: 100,
            createdAt: new Date().toISOString()
        };
        
        users.push(user);
        await saveUsers(users);
        console.log('New user created:', user.email, isFirstUser ? '(Admin)' : '');
    } else {
        console.log('Existing user logged in:', user.email);
    }
    
    return user;
}

// Initialize users file
await initUsersFile();

// Passport serialization
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const users = await loadUsers();
        const user = users.find(u => u.id === id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

// Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const user = await findOrCreateUser(profile, 'google');
            done(null, user);
        } catch (error) {
            done(error, null);
        }
    }));
}

// Facebook OAuth Strategy
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(new FacebookStrategy({
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_CALLBACK_URL || 'http://localhost:3000/auth/facebook/callback',
        profileFields: ['id', 'emails', 'name', 'displayName', 'photos']
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const user = await findOrCreateUser(profile, 'facebook');
            done(null, user);
        } catch (error) {
            done(error, null);
        }
    }));
}

// LinkedIn OAuth Strategy
if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    passport.use(new LinkedInStrategy({
        clientID: process.env.LINKEDIN_CLIENT_ID,
        clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
        callbackURL: process.env.LINKEDIN_CALLBACK_URL || 'http://localhost:3000/auth/linkedin/callback',
        scope: ['r_emailaddress', 'r_liteprofile']
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const user = await findOrCreateUser(profile, 'linkedin');
            done(null, user);
        } catch (error) {
            done(error, null);
        }
    }));
}

export default passport;
