# Vercel Deployment Guide

## Current Issue

The OAuth callback is returning a 500 error on Vercel. This has been fixed in the latest code with improved error handling and storage detection.

## Required Steps to Fix

### 1. Deploy Latest Code Changes

The following fixes have been implemented:
- ✅ Fixed storage.js to only use Vercel KV when credentials exist
- ✅ Added error handling to OAuth callbacks
- ✅ Improved error logging in authentication flow

Deploy these changes to Vercel:

```bash
git add .
git commit -m "Fix OAuth callback errors and storage detection"
git push origin main
```

Vercel will automatically redeploy.

### 2. Configure Environment Variables on Vercel

Go to your Vercel project dashboard → Settings → Environment Variables and ensure ALL of the following are set:

#### Required for All Environments:
```
GOOGLE_API_KEY=your-google-genai-api-key
SESSION_SECRET=your-random-secret-key
NODE_ENV=production
```

#### Required OAuth Credentials:
```
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=https://your-app.vercel.app/auth/google/callback
```

**IMPORTANT:** The `GOOGLE_CALLBACK_URL` must match your Vercel domain!

#### Optional OAuth Providers:
```
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
FACEBOOK_CALLBACK_URL=https://your-app.vercel.app/auth/facebook/callback

LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret
LINKEDIN_CALLBACK_URL=https://your-app.vercel.app/auth/linkedin/callback
```

#### For Persistent Storage (Recommended):
```
KV_REST_API_URL=your-vercel-kv-rest-api-url
KV_REST_API_TOKEN=your-vercel-kv-rest-api-token
```

### 3. Set Up Vercel KV (For Persistent User Storage)

Without Vercel KV, user data will reset on each deployment.

1. Go to your Vercel dashboard
2. Select your project
3. Go to Storage tab
4. Click "Create Database"
5. Select "KV"
6. Click "Create"
7. Connect it to your project

This automatically adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` to your environment variables.

### 4. Update OAuth Provider Callback URLs

You must update the authorized redirect URIs in your OAuth provider console:

#### Google Cloud Console:
1. Go to https://console.cloud.google.com/apis/credentials
2. Select your OAuth 2.0 Client ID
3. Under "Authorized redirect URIs", add:
   ```
   https://your-app.vercel.app/auth/google/callback
   ```
4. Save changes

#### Facebook Developer Console (if using):
1. Go to https://developers.facebook.com/apps/
2. Select your app
3. Go to Settings → Basic
4. Under "App Domains", add your Vercel domain
5. Go to Facebook Login → Settings
6. Under "Valid OAuth Redirect URIs", add:
   ```
   https://your-app.vercel.app/auth/facebook/callback
   ```

#### LinkedIn Developer Console (if using):
1. Go to https://www.linkedin.com/developers/apps/
2. Select your app
3. Go to Auth tab
4. Under "Redirect URLs", add:
   ```
   https://your-app.vercel.app/auth/linkedin/callback
   ```

### 5. Verify Deployment

After deploying and configuring:

1. Visit your Vercel app URL
2. Try to sign in with Google
3. Check Vercel logs for any errors:
   - Go to your project dashboard
   - Click "Deployments"
   - Click on the latest deployment
   - View "Function Logs"

### 6. Troubleshooting

#### If you still see 500 errors:

1. **Check Vercel Function Logs**:
   - Look for detailed error messages
   - Check if storage initialization failed
   - Verify OAuth strategy errors

2. **Verify Environment Variables**:
   - All required variables are set
   - No typos in variable names
   - Callback URLs match exactly

3. **Check OAuth Provider Settings**:
   - Redirect URIs are correct
   - App is not in sandbox/test mode (for Facebook)
   - Credentials are for the correct environment

4. **Storage Issues**:
   - If KV is not set up, the app will fall back to file storage
   - File storage on Vercel is ephemeral (resets on deployment)
   - For production, you MUST use Vercel KV

#### Common Issues:

- **"Missing required environment variables KV_REST_API_URL"**: Fixed in latest code, but deploy the changes
- **OAuth redirect_uri_mismatch**: Update your OAuth provider's authorized redirect URIs
- **Session errors**: Make sure SESSION_SECRET is set on Vercel
- **Users disappear after deployment**: You need to set up Vercel KV for persistent storage

### 7. Monitoring

After deployment, monitor:
- Function execution logs
- Error rates in Vercel dashboard
- User authentication success rate

## Quick Checklist

- [ ] Latest code deployed to Vercel
- [ ] All environment variables configured on Vercel
- [ ] OAuth callback URLs updated in provider consoles
- [ ] Vercel KV database created and connected
- [ ] Test authentication flow
- [ ] Check Vercel function logs for errors

## Support

If issues persist after following this guide, check the Vercel function logs for specific error messages and share them for further debugging.
