# OAuth Authentication Setup Guide

This guide will help you set up OAuth authentication with Google, Facebook (Meta), and LinkedIn for your Diffusion Canvas application.

## Overview

The application now supports user authentication via:
- **Google OAuth 2.0**
- **Facebook (Meta) OAuth**
- **LinkedIn OAuth 2.0**

Users must sign in with one of these providers to access the application and use the image generation features.

## Prerequisites

- Node.js installed
- A Google Cloud account
- A Facebook Developer account
- A LinkedIn Developer account

## Environment Variables

Copy `.env.example` to `.env` and fill in your OAuth credentials:

```bash
cp .env.example .env
```

## 1. Google OAuth Setup

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API for your project

### Step 2: Create OAuth 2.0 Credentials

1. Navigate to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Configure the OAuth consent screen:
   - User Type: External
   - App name: Diffusion Canvas
   - Support email: Your email
   - Authorized domains: Add your domain (for local: leave empty)
4. Application type: **Web application**
5. Add authorized redirect URIs:
   - For local development: `http://localhost:3000/auth/google/callback`
   - For production: `https://yourdomain.com/auth/google/callback`
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

### Step 3: Add to .env

```env
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

## 2. Facebook (Meta) OAuth Setup

### Step 1: Create a Facebook App

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Click **My Apps** > **Create App**
3. Select **Consumer** as the app type
4. Fill in app details:
   - App Name: Diffusion Canvas
   - App Contact Email: Your email
5. Click **Create App**

### Step 2: Configure Facebook Login

1. In your app dashboard, click **Add Product**
2. Find **Facebook Login** and click **Set Up**
3. Choose **Web** as the platform
4. Enter your site URL (for local: `http://localhost:3000`)
5. Go to **Facebook Login** > **Settings**
6. Add Valid OAuth Redirect URIs:
   - For local: `http://localhost:3000/auth/facebook/callback`
   - For production: `https://yourdomain.com/auth/facebook/callback`
7. Save changes

### Step 3: Get App Credentials

1. Go to **Settings** > **Basic**
2. Copy your **App ID** and **App Secret**
3. For production, add your domain to **App Domains**

### Step 4: Add to .env

```env
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
FACEBOOK_CALLBACK_URL=http://localhost:3000/auth/facebook/callback
```

### Important Notes for Facebook

- For development, your app is in **Development Mode** - only you and testers can use it
- To make it public, you need to submit it for **App Review**
- You may need to add required permissions in the review process

## 3. LinkedIn OAuth Setup

### Step 1: Create a LinkedIn App

1. Go to [LinkedIn Developers](https://www.linkedin.com/developers/apps/)
2. Click **Create App**
3. Fill in the required information:
   - App name: Diffusion Canvas
   - LinkedIn Page: Your company page (or create one)
   - App logo: Upload a logo
   - Legal agreement: Accept terms
4. Click **Create app**

### Step 2: Configure OAuth Settings

1. In your app, go to the **Auth** tab
2. Add **Authorized redirect URLs**:
   - For local: `http://localhost:3000/auth/linkedin/callback`
   - For production: `https://yourdomain.com/auth/linkedin/callback`
3. Request access to the following scopes in the **Products** tab:
   - Sign In with LinkedIn (should be auto-approved)
   - This gives you access to: `r_liteprofile` and `r_emailaddress`

### Step 3: Get App Credentials

1. Go to the **Auth** tab
2. Copy your **Client ID** and **Client Secret**

### Step 4: Add to .env

```env
LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret
LINKEDIN_CALLBACK_URL=http://localhost:3000/auth/linkedin/callback
```

## 4. Complete .env Configuration

Your final `.env` file should look like this:

```env
# Google API Key for GenAI
GOOGLE_API_KEY=your-google-genai-api-key

# Session Secret (use a random string)
SESSION_SECRET=your-random-secret-key-change-in-production

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Facebook OAuth (Meta)
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
FACEBOOK_CALLBACK_URL=http://localhost:3000/auth/facebook/callback

# LinkedIn OAuth
LINKEDIN_CLIENT_ID=your-linkedin-client-id
LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret
LINKEDIN_CALLBACK_URL=http://localhost:3000/auth/linkedin/callback

# Frontend URL (for production)
FRONTEND_URL=http://localhost:3000

# Server Port
PORT=3000

# Environment
NODE_ENV=development
```

## 5. Running the Application

1. Install dependencies (if not already done):
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

4. You should see the login modal with three OAuth options
5. Click on any provider to authenticate
6. After successful authentication, you'll be redirected to the main application

## How It Works

### User Flow

1. User visits the application
2. Login modal is displayed with Google, Facebook, and LinkedIn buttons
3. User clicks on their preferred OAuth provider
4. User is redirected to the provider's login page
5. User authenticates and grants permissions
6. Provider redirects back to the application
7. User data is stored in `users.json` file
8. User session is created
9. User can now access the application features

### User Data Storage

User data is stored in a local `users.json` file with the following structure:

```json
[
  {
    "id": "1704123456789",
    "provider": "google",
    "providerId": "123456789",
    "email": "user@example.com",
    "displayName": "John Doe",
    "firstName": "John",
    "lastName": "Doe",
    "photo": "https://example.com/photo.jpg",
    "createdAt": "2024-01-01T12:00:00.000Z"
  }
]
```

### Session Management

- Sessions are stored in memory (not persisted across server restarts)
- Session duration: 24 hours
- Logout route: `/auth/logout`

## Production Deployment

For production deployment:

1. **Update callback URLs** in each OAuth provider to your production domain
2. **Set `NODE_ENV=production`** in your environment
3. **Generate a secure SESSION_SECRET**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Configure HTTPS** - OAuth providers require HTTPS in production
5. **Update FRONTEND_URL** to your production domain
6. **Consider using a database** instead of `users.json` for user storage (e.g., MongoDB, PostgreSQL)
7. **Use a session store** like Redis for production (currently using memory store)

### Security Recommendations

- Never commit your `.env` file to version control
- Use strong, unique secrets for `SESSION_SECRET`
- Keep OAuth credentials secure
- Regularly rotate secrets
- Implement rate limiting
- Add CSRF protection
- Enable secure cookies in production

## Troubleshooting

### "Redirect URI mismatch" error

- Verify that the callback URL in your `.env` matches exactly with what's configured in the OAuth provider
- Check for trailing slashes
- Ensure protocol (http/https) matches

### OAuth provider not working

- Verify that the provider's credentials are correctly set in `.env`
- Check that the OAuth app is not in development/restricted mode
- Ensure required scopes/permissions are granted

### Session not persisting

- Check that cookies are enabled in the browser
- Verify `SESSION_SECRET` is set in `.env`
- For production, ensure cookies are set with `secure: true` over HTTPS

### User database issues

- Check that the application has write permissions in the directory
- Verify `users.json` is not corrupted (should be valid JSON)
- The file will be created automatically on first user registration

## Support

For issues or questions:
- Check the main README.md
- Review error messages in the browser console and server logs
- Ensure all environment variables are correctly set
