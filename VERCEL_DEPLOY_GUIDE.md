# Vercel Deployment Guide for Username/Password Auth

## Quick Deployment Steps

### 1. Commit Your Changes
```bash
git add .
git commit -m "Add username/password authentication"
git push origin main
```

### 2. Deploy to Vercel
Vercel will automatically detect the changes and redeploy. If you need to manually deploy:

```bash
vercel --prod
```

### 3. Verify Deployment
After deployment, check:
- ✅ `/api/auth/local` endpoint is accessible
- ✅ `/api/admin/users` endpoint is accessible
- ✅ Login page shows both OAuth and Username/Password tabs
- ✅ Admin panel shows "+ Add User" button

## Important Changes in vercel.json

The `vercel.json` has been updated to use the modern `rewrites` configuration:

```json
{
  "version": 2,
  "rewrites": [
    {
      "source": "/auth/(.*)",
      "destination": "/server.js"
    },
    {
      "source": "/admin",
      "destination": "/admin.html"
    },
    {
      "source": "/((?!api).*)",
      "destination": "/server.js"
    }
  ]
}
```

**What this does:**
- Routes `/auth/*` to server.js (for OAuth callbacks)
- Routes `/admin` to admin.html (admin panel)
- Routes everything EXCEPT `/api/*` to server.js
- **Allows `/api/*` to be handled by Vercel's automatic serverless functions**

## Vercel API Routes

After deployment, these endpoints will be available:

### Authentication
- `POST /api/auth/local` - Local username/password login
- `GET /api/auth/google` - Google OAuth (if configured)
- `GET /api/auth/logout` - Logout
- `GET /api/auth/providers` - List enabled providers

### User Management (Admin Only)
- `GET /api/admin/users` - List all users
- `POST /api/admin/users` - Create new user with password
- `DELETE /api/admin/users/:id` - Delete user
- `PATCH /api/admin/users/:id/credits` - Update user credits

### User Info
- `GET /api/user` - Get current user info
- `DELETE /api/user/delete` - Delete own account

## Testing After Deployment

### 1. Create First Admin User
If this is a fresh deployment:
1. Visit your site: `https://your-site.vercel.app`
2. Log in with Google OAuth
3. First user automatically becomes admin

### 2. Create a Test User
1. Go to Admin Panel (top right)
2. Click "+ Add User"
3. Create a test user:
   - Username: `testuser`
   - Password: `test123456`
   - Leave admin unchecked
4. Click "Create User"

### 3. Test Local Login
1. Log out
2. Click "Username & Password" tab
3. Enter:
   - Username: `testuser`
   - Password: `test123456`
4. Click "Login"
5. Should successfully log in!

## Troubleshooting

### Still Getting 404 on /api/auth/local

**Solution 1: Clear Vercel Cache**
```bash
vercel --prod --force
```

**Solution 2: Check Vercel Dashboard**
1. Go to Vercel Dashboard
2. Select your project
3. Go to "Functions" tab
4. Verify that `api/auth/local` appears in the list

**Solution 3: Check File Structure**
Ensure your file structure looks like this:
```
diffusioncanvas/
├── api/
│   ├── auth/
│   │   ├── local.js          ← Must exist!
│   │   ├── google.js
│   │   └── logout.js
│   ├── admin/
│   │   └── users.js           ← Must exist!
│   └── user.js
├── auth.js
├── server.js
├── index.html
├── admin.html
├── vercel.json                ← Must be updated!
└── package.json
```

### "Module not found" Errors

Make sure all dependencies are in `package.json`:
```json
{
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "passport-local": "^1.0.0",
    ...
  }
}
```

Then redeploy:
```bash
git add package.json package-lock.json
git commit -m "Update dependencies"
git push
```

### Check Vercel Logs

1. Go to Vercel Dashboard
2. Select your project
3. Click "Deployments"
4. Click on the latest deployment
5. Click "View Function Logs"
6. Look for any errors in the logs

## Environment Variables

No new environment variables are needed for local auth!

Existing variables should already be set:
- ✅ `GOOGLE_API_KEY`
- ✅ `GOOGLE_CLIENT_ID` (optional, for OAuth)
- ✅ `GOOGLE_CLIENT_SECRET` (optional, for OAuth)
- ✅ `SESSION_SECRET`
- ✅ `KV_REST_API_URL`
- ✅ `KV_REST_API_TOKEN`

## Verification Checklist

After deployment, verify:

- [ ] Site loads: `https://your-site.vercel.app`
- [ ] Login page shows two tabs
- [ ] Can switch between OAuth and Username/Password tabs
- [ ] Can log in with Google OAuth (if configured)
- [ ] Admin panel is accessible after login
- [ ] "+ Add User" button appears in admin panel
- [ ] Can create a new user with password
- [ ] Can log out
- [ ] Can log in with username/password
- [ ] User appears in admin panel
- [ ] Can update user credits
- [ ] Can delete non-admin users

## Success!

Once all checks pass, your username/password authentication is fully deployed and working on Vercel! 🎉

## Support

If you encounter issues:
1. Check the Vercel function logs
2. Verify the file structure matches the example above
3. Ensure `vercel.json` is correctly configured
4. Clear browser cache and try again
5. Try `vercel --prod --force` to force a clean deployment
