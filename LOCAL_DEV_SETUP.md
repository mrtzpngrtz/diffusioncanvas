# Local Development Setup Guide

This guide explains how to run the application locally with authentication disabled for development purposes.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   The `.env` file has been created with `BYPASS_AUTH=true` enabled. This means:
   - No OAuth providers are required
   - Authentication is automatically bypassed
   - A default test user is created automatically

3. **Start the server:**
   ```bash
   npm start
   ```
   or for development with auto-reload:
   ```bash
   npm run dev
   ```

4. **Access the application:**
   - Main app: http://localhost:3000
   - Admin panel: http://localhost:3000/admin

## Default Test User

When `BYPASS_AUTH=true` is enabled, a default test user is automatically created:

- **ID:** test-user-local
- **Email:** test@local.dev
- **Display Name:** Test User (Local Dev)
- **Credits:** 1000
- **Admin:** Yes

This user is automatically logged in for all requests, so you can immediately start using the application.

## Local Database

The application uses a local file-based database (`users.json`) when running locally:
- Located at: `./users.json`
- Automatically created if it doesn't exist
- Stores user data including credits
- The test user is added on first access

## Important Notes

⚠️ **For Development Only:**
- `BYPASS_AUTH` should NEVER be enabled in production
- This mode is designed for local testing without OAuth setup
- All API calls will use the test user automatically

## Adding Google API Key (Optional)

To actually generate images, you need to add a Google GenAI API key:

1. Get an API key from: https://makersuite.google.com/app/apikey
2. Update the `.env` file:
   ```
   GOOGLE_API_KEY=your-actual-api-key-here
   ```

## Switching Back to OAuth

To re-enable OAuth authentication:

1. Set `BYPASS_AUTH=false` in `.env` (or remove the line)
2. Configure OAuth provider credentials in `.env`
3. Restart the server

## Troubleshooting

**Server won't start:**
- Check if port 3000 is already in use
- Verify `npm install` completed successfully

**Can't access the app:**
- Make sure the server is running (you should see "Server running on http://localhost:3000")
- Check the console for any error messages

**Database issues:**
- Delete `users.json` to reset the local database
- The file will be recreated automatically on next access
