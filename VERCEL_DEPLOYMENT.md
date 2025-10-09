# Vercel Deployment Guide for Diffusion Canvas

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Vercel KV Database**: Free Redis-compatible storage (included with Vercel)
3. **Vercel CLI** (optional): Install with `npm i -g vercel`
4. **Environment Variables**: Prepare all your API keys and secrets

## Step 1: Prepare Environment Variables

You need to set these environment variables in Vercel:

### Required Variables:
- `GOOGLE_API_KEY` - Your Google AI API key
- `SESSION_SECRET` - Random secret string for sessions (generate with: `openssl rand -base64 32`)
- **Vercel KV** - Automatically configured when you create a KV database (see Step 1.5)

### OAuth Variables (at least one required):

**Google OAuth:**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL` - Set to: `https://your-app.vercel.app/auth/google/callback`

**Facebook OAuth:**
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`
- `FACEBOOK_CALLBACK_URL` - Set to: `https://your-app.vercel.app/auth/facebook/callback`

**LinkedIn OAuth:**
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_CALLBACK_URL` - Set to: `https://your-app.vercel.app/auth/linkedin/callback`

### Optional Variables:
- `NODE_ENV` - Set to: `production`
- `FRONTEND_URL` - Set to: `https://your-app.vercel.app`

## Step 1.5: Create Vercel KV Database

**IMPORTANT**: You must create a Vercel KV database for persistent user storage.

1. **Go to Vercel Dashboard**: [vercel.com/dashboard](https://vercel.com/dashboard)
2. **Navigate to Storage**: Click "Storage" tab
3. **Create KV Database**:
   - Click "Create Database"
   - Select "KV" (Redis)
   - Choose a name (e.g., "diffusion-canvas-users")
   - Select region closest to your users
   - Click "Create"
4. **Connect to Project**: 
   - Link the KV database to your project
   - This automatically adds the required environment variables

## Step 2: Deploy to Vercel

### Option A: Deploy via Vercel Dashboard (Recommended)

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Ready for Vercel deployment"
   git push origin main
   ```

2. **Import Project in Vercel**:
   - Go to [vercel.com/new](https://vercel.com/new)
   - Click "Import Project"
   - Select your GitHub repository
   - Vercel will auto-detect the configuration

3. **Add Environment Variables**:
   - In the "Environment Variables" section
   - Add all the variables listed above
   - Click "Deploy"

### Option B: Deploy via Vercel CLI

1. **Login to Vercel**:
   ```bash
   vercel login
   ```

2. **Deploy**:
   ```bash
   vercel
   ```

3. **Add Environment Variables**:
   ```bash
   # Add each variable
   vercel env add GOOGLE_API_KEY
   vercel env add SESSION_SECRET
   vercel env add GOOGLE_CLIENT_ID
   vercel env add GOOGLE_CLIENT_SECRET
   # ... etc
   ```

4. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

## Step 3: Update OAuth Callback URLs

After deployment, you'll get a URL like `https://your-app.vercel.app`

### Update Google OAuth Console:
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to your OAuth credentials
3. Add Authorized Redirect URI: `https://your-app.vercel.app/auth/google/callback`

### Update Facebook App:
1. Go to [Facebook Developers](https://developers.facebook.com)
2. Navigate to your app settings
3. Add Valid OAuth Redirect URI: `https://your-app.vercel.app/auth/facebook/callback`

### Update LinkedIn App:
1. Go to [LinkedIn Developers](https://www.linkedin.com/developers)
2. Navigate to your app settings
3. Add Authorized Redirect URL: `https://your-app.vercel.app/auth/linkedin/callback`

## Step 4: Test Your Deployment

1. Visit your Vercel URL
2. Test OAuth login with each provider
3. Verify image generation works
4. Check admin panel (first user becomes admin)

## Important Notes

### Persistent Storage with Vercel KV
- ✅ **User data persists** across deployments using Vercel KV (Redis)
- ✅ **Free tier included** - 256MB storage, 100K requests/month
- ✅ **Automatic scaling** - handles traffic spikes
- ℹ️ **Local development** - Uses `users.json` file (auto-switches in production)

### Session Management
- Sessions use in-memory storage (won't persist across deployments)
- For production, consider using a session store like Redis

### Optional Enhancements

1. **Add Session Store** (for multi-region):
   ```bash
   npm install connect-redis redis
   ```

2. **Add Error Logging**:
   ```bash
   npm install @vercel/analytics
   ```

3. **Upgrade KV Plan** (if needed):
   - Free: 256MB, 100K requests/month
   - Pro: Unlimited storage, 10M requests/month

## Troubleshooting

### OAuth Redirect Errors
- Ensure callback URLs match exactly (no trailing slashes)
- Check environment variables are set correctly
- Verify OAuth apps are configured in their respective consoles

### Session Issues
- Make sure `SESSION_SECRET` is set
- Check cookie settings if using custom domain

### API Errors
- Verify `GOOGLE_API_KEY` is valid
- Check API quotas and limits

## Quick Deploy Commands

```bash
# 1. Commit changes
git add .
git commit -m "Deploy to Vercel"
git push

# 2. Deploy with Vercel CLI
vercel --prod

# 3. Set environment variable example
vercel env add GOOGLE_API_KEY production
```

## Environment Variables Template

Copy this template to set up your environment:

```
GOOGLE_API_KEY=your_google_ai_api_key
SESSION_SECRET=your_random_secret_here
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=https://your-app.vercel.app/auth/google/callback
FACEBOOK_APP_ID=your_facebook_app_id
FACEBOOK_APP_SECRET=your_facebook_app_secret
FACEBOOK_CALLBACK_URL=https://your-app.vercel.app/auth/facebook/callback
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
LINKEDIN_CALLBACK_URL=https://your-app.vercel.app/auth/linkedin/callback
NODE_ENV=production
FRONTEND_URL=https://your-app.vercel.app
```

## Support

For issues, check:
- [Vercel Documentation](https://vercel.com/docs)
- [Node.js on Vercel](https://vercel.com/docs/runtimes#official-runtimes/node-js)
- Project logs in Vercel Dashboard
