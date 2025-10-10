# Reversing Local Development Setup

## Overview
This document explains what was changed to enable local development without authentication and Vertex AI database, and how to reverse these changes to restore production functionality.

---

## Changes Made for Local Development

### 1. Environment Variable (.env)
**Change Made:**
```env
BYPASS_AUTH=true
```

**To Reverse:**
- Remove or comment out the `BYPASS_AUTH=true` line
- OR set it to `BYPASS_AUTH=false`

**File:** `.env`

---

### 2. Server Authentication Logic (server.js)
**Change Made:**
Added bypass authentication logic in the `/api/user` endpoint:

```javascript
// Check for bypass mode (local development)
if (process.env.BYPASS_AUTH === 'true') {
    // Load local user from users.json
    const users = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
    const localUser = users.users[0]; // Get first user
    
    return res.json({
        user: {
            id: localUser.id,
            email: localUser.email,
            displayName: localUser.displayName,
            photo: localUser.photo,
            credits: localUser.credits,
            isAdmin: localUser.isAdmin
        }
    });
}
```

**To Reverse:**
1. Open `server.js`
2. Find the `/api/user` endpoint (around line 100-130)
3. Remove the entire `if (process.env.BYPASS_AUTH === 'true')` block
4. Keep only the original OAuth-based authentication logic

**Location:** `server.js` - `/api/user` endpoint

---

### 3. Local User Database (users.json)
**Change Made:**
Created a new file `users.json` with local test user:

```json
{
  "users": [
    {
      "id": "local-dev-user",
      "email": "test@local.dev",
      "displayName": "Test User (Local Dev)",
      "photo": "https://via.placeholder.com/150",
      "provider": "local",
      "credits": 983,
      "isAdmin": true,
      "createdAt": "2025-10-10T17:01:00.000Z"
    }
  ]
}
```

**To Reverse:**
- Delete the `users.json` file from the project root
- The application will no longer use local user data

**File:** `users.json` (entire file should be deleted)

---

### 4. Generate Endpoint Credits Check (server.js)
**Change Made:**
Modified credit deduction logic to work with local JSON file:

```javascript
// In bypass mode, update local users.json
if (process.env.BYPASS_AUTH === 'true') {
    const users = JSON.parse(fs.readFileSync('./users.json', 'utf8'));
    const user = users.users.find(u => u.id === userId);
    if (user) {
        user.credits = Math.max(0, user.credits - 1);
        fs.writeFileSync('./users.json', JSON.stringify(users, null, 2));
    }
}
```

**To Reverse:**
1. Open `server.js`
2. Find the `/api/generate` endpoint
3. Remove the `if (process.env.BYPASS_AUTH === 'true')` block that handles local user credits
4. Keep only the original Vertex AI database logic for credit management

**Location:** `server.js` - `/api/generate` endpoint (credit deduction section)

---

## Step-by-Step Reversal Process

### Complete Restoration to Production Mode

1. **Update Environment Variables**
   ```bash
   # Edit .env file
   # Remove or comment out BYPASS_AUTH
   # BYPASS_AUTH=true  <- Remove this line
   ```

2. **Clean Up Server.js**
   - Remove all `if (process.env.BYPASS_AUTH === 'true')` blocks
   - Remove the `fs` import if it was only added for local development
   - Keep only OAuth-based authentication logic

3. **Delete Local Files**
   ```bash
   rm users.json
   # Optional: Keep documentation for future reference
   # rm LOCAL_DEV_SETUP.md
   # rm REVERSE_LOCAL_SETUP.md
   ```

4. **Verify Vertex AI Configuration**
   - Ensure `.env` has all required Vertex AI credentials:
     - `GOOGLE_CLOUD_PROJECT_ID`
     - `GOOGLE_CLOUD_LOCATION`
     - OAuth credentials

5. **Restart Server**
   ```bash
   npm start
   ```

6. **Test Production Mode**
   - Verify OAuth login works
   - Verify Vertex AI database connection
   - Test credit system with real database

---

## Quick Reference: Files Modified

### Files to Edit:
1. `.env` - Remove `BYPASS_AUTH=true`
2. `server.js` - Remove bypass authentication blocks

### Files to Delete:
1. `users.json` - Local user database

### Files to Keep (Documentation):
1. `LOCAL_DEV_SETUP.md` - Setup instructions
2. `REVERSE_LOCAL_SETUP.md` - This file
3. `VERCEL_AUTH_SETUP.md` - OAuth setup guide

---

## Production Requirements Checklist

Before deploying to production, ensure:

- [ ] `BYPASS_AUTH` is removed or set to `false` in `.env`
- [ ] All bypass authentication code removed from `server.js`
- [ ] `users.json` deleted from project root
- [ ] OAuth credentials configured in `.env`
- [ ] Vertex AI database configured
- [ ] Server restarts successfully without errors
- [ ] OAuth login flow tested and working
- [ ] Credit system connected to real database
- [ ] Admin panel accessible only to admin users

---

## Notes

### Why This Setup Was Created
- Enable local development without OAuth configuration
- Test application features without external dependencies
- Develop UI/UX without worrying about authentication
- Quick iteration during development

### Production vs Development
- **Development (Bypass Mode):** Uses local JSON file, auto-authenticated
- **Production:** Uses OAuth + Vertex AI database, requires user login

### Security Reminder
- **NEVER** deploy with `BYPASS_AUTH=true` to production
- Local `users.json` is for development only
- Always use proper authentication in production environments

---

## Support

If you encounter issues reversing the setup:
1. Check that all environment variables are properly configured
2. Verify OAuth credentials are valid
3. Ensure Vertex AI database is accessible
4. Review server logs for specific error messages

For OAuth setup: See `VERCEL_AUTH_SETUP.md`
For local development: See `LOCAL_DEV_SETUP.md`
