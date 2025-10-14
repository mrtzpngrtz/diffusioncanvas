import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Strategy as LinkedInStrategy } from 'passport-linkedin-oauth2';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import { storage } from './storage.js';

// Find or create user
async function findOrCreateUser(profile, provider) {
    try {
        const users = await storage.getUsers();
        
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
                credits: 5,
                createdAt: new Date().toISOString()
            };
            
            users.push(user);
            await storage.setUsers(users);
            console.log('✓ New user created:', user.email, isFirstUser ? '(Admin)' : '');
        } else {
            console.log('✓ Existing user logged in:', user.email);
        }
        
        return user;
    } catch (error) {
        console.error('❌ Error in findOrCreateUser:', error);
        throw error;
    }
}

// Initialize storage (with error handling for serverless)
try {
    await storage.init();
} catch (error) {
    console.error('Storage initialization warning:', error.message);
    console.log('Application will attempt to continue, but storage may not work correctly.');
}

// Passport serialization
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const users = await storage.getUsers();
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

// Local Authentication Strategy (username/password)
passport.use(new LocalStrategy(
    {
        usernameField: 'username',
        passwordField: 'password'
    },
    async (username, password, done) => {
        try {
            const users = await storage.getUsers();
            
            // Find user by username
            const user = users.find(u => u.username === username && u.provider === 'local');
            
            if (!user) {
                return done(null, false, { message: 'Incorrect username or password' });
            }
            
            // Check password
            const isValidPassword = await bcrypt.compare(password, user.password);
            
            if (!isValidPassword) {
                return done(null, false, { message: 'Incorrect username or password' });
            }
            
            console.log('✓ Local user logged in:', user.username);
            
            // Return user without password field
            const { password: _, ...userWithoutPassword } = user;
            return done(null, userWithoutPassword);
        } catch (error) {
            return done(error);
        }
    }
));

// Helper function to create local user
export async function createLocalUser(username, password, isAdmin = false) {
    try {
        const users = await storage.getUsers();
        
        // Check if username already exists
        const existingUser = users.find(u => u.username === username && u.provider === 'local');
        if (existingUser) {
            throw new Error('Username already exists');
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
            isAdmin: isAdmin,
            credits: 5,
            createdAt: new Date().toISOString()
        };
        
        users.push(user);
        await storage.setUsers(users);
        
        console.log('✓ New local user created:', username, isAdmin ? '(Admin)' : '');
        
        // Return user without password field
        const { password: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
    } catch (error) {
        console.error('❌ Error creating local user:', error);
        throw error;
    }
}

export default passport;
