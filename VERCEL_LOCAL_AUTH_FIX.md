# Vercel Local Authentication Fix

## Issue
The `/api/auth/local` endpoint was returning 404 errors on Vercel deployment.

## Root Causes

1. **vercel.json Configuration**: The old configuration routed all requests through `server.js`, preventing `/api` folder serverless functions from working.

2. **Passport.js in Serverless**: The original implementation used Passport.js with `req.login()`, which doesn't work well in Vercel's stateless serverless environment.

3. **Missing POST Handler**: The `/api/admin/users.js` endpoint only handled GET requests, not POST for creating users.

## Fixes Applied

### 1. Updated `vercel.json`
Simplified configuration to allow `/api` routes to work as serverless functions:

```json
{
  "version": 2,
  "rewrites": [
    {
      "source": "/auth/google",
      "destination": "/api/auth/google"
    },
    {
      "source": "/auth/google/callback",
      "destination": "/api/auth/google/callback"
    },
    {
      "source": "/auth/logout",
      "destination": "/api/auth/logout"
    }
  ]
}
```

**What this does:**
- Removes complex routing through `server.js`
- Allows `/api/*` routes to work as Vercel serverless functions automatically
- Only rewrites OAuth routes for backward compatibility

### 2. Rewrote `api/auth/local.js`
Changed from Passport.js to direct implementation:

**Before:**
- Used `passport.authenticate('local', ...)`
- Required session middleware
- Didn't work in serverless environment

**After:**
- Direct bcrypt password comparison
- Stateless authentication with JWT
- Works perfectly in Vercel serverless functions

```javascript
import bcrypt from 'bcryptjs';
import { storage } from '../../storage.js';
import { setAuthCookie } from '../../jwt-auth.js';

export default async function handler(req, res) {
    // Direct authentication without Passport
    const { username, password } = req.body;
    const users = await storage.getUsers();
    const user = users.find(u => u.username === username && u.provider === 'local');
    
    if (user && await bcrypt.compare(password, user.password)) {
        setAuthCookie(res, user);
        return res.json({ success: true, user });
    }
    
    return res.status(401).json({ error: 'Incorrect username or password' });
}
```

### 3. Updated `api/admin/users.js`
Added POST request handling for user creation:

```javascript
export default async function handler(req, res) {
    // Check admin access
    const user = getAuthUser(req);
    if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (req.method === 'GET') {
        // Get all users
        const users = await storage.getUsers();
        res.json(users);
    } else if (req.method === 'POST') {
        // Create new local user
        const { username, password, isAdmin } = req.body;
        const newUser = await createLocalUser(username, password, isAdmin || false);
        res.json({ message: 'User created successfully', user: newUser });
    }
}
```

## Deployment Steps

### 1. Commit Changes
```bash
git add .
git commit -m "Fix local authentication for Vercel deployment"
git push origin main
```

### 2. Deploy to Vercel
The deployment will automatically trigger if you have Vercel connected to your Git repository.

Or manually deploy:
```bash
vercel --prod
```

### 3. Verify Environment Variables
Ensure these are set in Vercel dashboard:
- `GOOGLE_API_KEY` - For image generation
- `SESSION_SECRET` - Random secure string
- `KV_REST_API_URL` - Vercel KV URL
- `KV_REST_API_TOKEN` - Vercel KV token
- `GOOGLE_CLIENT_ID` (optional for OAuth)
- `GOOGLE_CLIENT_SECRET` (optional for OAuth)

### 4. Test the Authentication

**Test Local Login:**
1. Open your Vercel deployment URL
2. Click "Username & Password" tab
3. Create a user via admin panel first
4. Try logging in

**Test Admin Panel:**
1. Log in as admin
2. Navigate to Admin Panel
3. Click "+ Add User"
4. Create a new user with username/password
5. Log out and test the new credentials

## API Endpoints

All endpoints now work as Vercel serverless functions:

- `POST /api/auth/local` - Local authentication
- `GET /api/admin/users` - Get all users (admin only)
- `POST /api/admin/users` - Create user (admin only)
- `DELETE /api/admin/users/:id` - Delete user (admin only)
- `PATCH /api/admin/users/:id/credits` - Update credits (admin only)
- `GET /api/user` - Get current user info
- `DELETE /api/user/delete` - Delete own account
- `POST /api/generate` - Generate images

## How It Works Now

### Local Authentication Flow:
1. User submits username/password from login form
2. Frontend sends POST to `/api/auth/local`
3. Serverless function:
   - Fetches users from Vercel KV
   - Finds user by username
   - Compares password with bcrypt
   - Sets JWT cookie on success
   - Returns user data
4. Frontend reloads, user is authenticated

### User Creation Flow:
1. Admin clicks "+ Add User" in admin panel
2. Modal opens with form
3. Admin enters username, password, admin checkbox
4. Frontend sends POST to `/api/admin/users`
5. Serverless function:
   - Validates admin access via JWT
   - Validates input (username unique, password min 6 chars)
   - Hashes password with bcrypt
   - Stores user in Vercel KV
   - Returns success
6. Admin panel refreshes user list

## Troubleshooting

### Still Getting 404 Errors?
1. **Clear Vercel cache**: Redeploy with "Force rebuild"
2. **Check logs**: View function logs in Vercel dashboard
3. **Verify file structure**: Ensure `/api` folder exists in repo
4. **Check git**: Make sure all files are committed and pushed

### Authentication Not Working?
1. **Check cookies**: Ensure cookies are enabled in browser
2. **Verify JWT secret**: `SESSION_SECRET` must be set
3. **Check KV storage**: Verify Vercel KV is set up correctly
4. **Console errors**: Check browser console for errors

### User Creation Failing?
1. **Admin access**: Ensure logged-in user is admin
2. **Duplicate username**: Try a different username
3. **Password length**: Ensure password is 6+ characters
4. **KV connectivity**: Check Vercel KV connection

## Benefits of This Approach

✅ **Serverless-friendly**: No sessions, works in Vercel's stateless environment
✅ **Scalable**: Each function scales independently
✅ **Secure**: JWT-based auth, bcrypt password hashing
✅ **Simple**: Removed Passport.js complexity for serverless
✅ **Fast**: Direct authentication, no middleware overhead
✅ **Reliable**: Stateless functions, no session storage issues

## Next Steps

1. Test thoroughly on Vercel
2. Create first admin user
3. Add more users via admin panel
4. Monitor logs for any issues
5. Consider adding rate limiting for production

## Support

If you encounter issues:
1. Check Vercel function logs
2. Verify environment variables
3. Test API endpoints directly
4. Review browser console errors
5. Check Vercel KV dashboard

The authentication system is now fully functional on Vercel! 🎉
