# Vercel Auth & Database Setup - COMPLETE

## ✅ What Was Created

The auth and database system for Vercel has been **fully re-enabled** with serverless functions in the `api/` directory:

### Auth Functions
- `api/auth/google.js` - Google OAuth initiation
- `api/auth/google/callback.js` - Google OAuth callback handler
- `api/auth/logout.js` - Logout functionality
- `api/auth/providers.js` - Check available OAuth providers

### User Functions
- `api/user.js` - Get current authenticated user
- `api/user/delete.js` - Delete own account

### Image Generation
- `api/generate.js` - Generate images with credit deduction

### Admin Functions
- `api/admin/users.js` - List all users (admin only)
- `api/admin/users/[id].js` - Delete user (admin only)
- `api/admin/users/[id]/credits.js` - Update user credits (admin only)

### Configuration
- `vercel.json` - Updated for serverless function routing

## 🚀 Deployment Instructions

### Step 1: Set Up Vercel KV Database

1. Go to your Vercel dashboard: https://vercel.com/dashboard
2. Click on **Storage** tab
3. Click **Create Database** → **KV**
4. Name it: `diffusion-canvas-users`
5. Select your region
6. Click **Create**
7. Click **Connect Project** and select your project
8. This automatically adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables

### Step 2: Configure Environment Variables

Go to your Vercel project → **Settings** → **Environment Variables** and add:

#### Required for All Environments
```
GOOGLE_API_KEY=your-google-genai-api-key
SESSION_SECRET=your-random-secret-key-change-this
NODE_ENV=production
```

#### Required for Google OAuth
```
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_CALLBACK_URL=https://your-app.vercel.app/auth/google/callback
```

**Important:** Replace `your-app.vercel.app` with your actual Vercel domain!

#### Optional OAuth Providers
```
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
FACEBOOK_CALLBACK_URL=https://your-app.vercel.app/auth/facebook/callback

LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret
LINKEDIN_CALLBACK_URL=https://your-app.vercel.app/auth/linkedin/callback
```

### Step 3: Update OAuth Provider Settings

#### Google Cloud Console
1. Go to https://console.cloud.google.com/apis/credentials
2. Select your OAuth 2.0 Client ID
3. Under **Authorized redirect URIs**, add:
   ```
   https://your-app.vercel.app/auth/google/callback
   ```
4. Click **Save**

#### Facebook (if using)
1. Go to https://developers.facebook.com/apps/
2. Select your app → Settings → Basic
3. Add your Vercel domain to **App Domains**
4. Go to **Facebook Login** → Settings
5. Add to **Valid OAuth Redirect URIs**:
   ```
   https://your-app.vercel.app/auth/facebook/callback
   ```

#### LinkedIn (if using)
1. Go to https://www.linkedin.com/developers/apps/
2. Select your app → Auth tab
3. Add to **Redirect URLs**:
   ```
   https://your-app.vercel.app/auth/linkedin/callback
   ```

### Step 4: Deploy to Vercel

#### Option A: Git Push (Recommended)
```bash
git add .
git commit -m "Add Vercel serverless auth functions"
git push origin main
```

Vercel will automatically deploy.

#### Option B: Vercel CLI
```bash
vercel --prod
```

### Step 5: Verify Deployment

1. Visit your Vercel app URL
2. Try signing in with Google
3. Check Vercel **Function Logs** for any errors:
   - Go to your deployment
   - Click **Functions** tab
   - View real-time logs

## 📁 File Structure

```
api/
├── auth/
│   ├── google.js              # Google OAuth init
│   ├── google/
│   │   └── callback.js        # OAuth callback
│   ├── logout.js              # Logout
│   └── providers.js           # Check providers
├── user.js                     # Get user
├── user/
│   └── delete.js              # Delete account
├── generate.js                 # Image generation
└── admin/
    ├── users.js               # List users
    └── users/
        ├── [id].js            # Delete user
        └── [id]/
            └── credits.js     # Update credits
```

## 🔧 How It Works

### Serverless Functions
- Each `.js` file in `api/` becomes a serverless endpoint
- `api/user.js` → `https://your-app.vercel.app/api/user`
- `api/auth/google.js` → `https://your-app.vercel.app/api/auth/google`

### Database Storage
- Uses Vercel KV (Redis) for persistent user storage
- Falls back to file storage for local development
- Handles credit system and user management

### Authentication Flow
1. User clicks "Sign in with Google"
2. Redirects to `api/auth/google`
3. Google authenticates user
4. Callback to `api/auth/google/callback`
5. JWT cookie set for persistent auth
6. User data stored in Vercel KV

## 🐛 Troubleshooting

### "Not authenticated" errors
- Check if KV database is connected
- Verify environment variables are set
- Check Function Logs for detailed errors

### OAuth callback errors
- Verify callback URLs match exactly
- Check OAuth provider settings
- Ensure CLIENT_ID and CLIENT_SECRET are correct

### Credits not updating
- Verify KV database connection
- Check Function Logs for storage errors
- Ensure user exists in database

### Function timeout
- Image generation can take time
- Vercel free tier has 10s timeout
- Pro tier has 60s timeout

## 📊 Monitoring

Check these in Vercel dashboard:
- **Functions** → View logs and errors
- **Analytics** → Monitor API usage
- **Storage** → Check KV database metrics

## 🔐 Security Notes

- JWT tokens expire after set duration
- Admin-only endpoints check `isAdmin` flag
- Credits are server-side enforced
- All passwords/secrets in environment variables

## ✨ Features Enabled

✅ Google OAuth authentication
✅ User credit system
✅ Admin panel for user management
✅ Persistent storage with Vercel KV
✅ Image generation with credit deduction
✅ Account deletion
✅ Multi-provider OAuth support

## 🆘 Support

If issues persist:
1. Check Vercel Function Logs
2. Verify all environment variables
3. Test OAuth flow manually
4. Check VERCEL_DEPLOYMENT.md for additional troubleshooting

---

**Version:** Beta 0.5  
**Last Updated:** October 2025  
**Status:** ✅ Ready for Deployment
