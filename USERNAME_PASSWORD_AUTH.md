# Username/Password Authentication

This document explains the username/password authentication feature that has been added to Diffusion Canvas.

## Overview

In addition to OAuth providers (Google, Facebook, LinkedIn), users can now log in using a username and password. Admins can create user accounts with passwords directly from the admin panel.

## Features

### 1. Local Authentication
- Users can log in with username and password
- Passwords are securely hashed using bcryptjs (10 salt rounds)
- JWT-based session management for persistent authentication
- Works seamlessly alongside OAuth authentication

### 2. Login Interface
- **Two tabs on login screen:**
  - **OAuth Login:** For Google OAuth (existing functionality)
  - **Username & Password:** For local authentication
- Clean, modern form with proper validation
- Loading states and error messages
- Auto-complete support for better UX

### 3. Admin Panel User Management
- **Add User Button:** Admins can create new users with:
  - Username (required, must be unique)
  - Password (required, minimum 6 characters)
  - Admin checkbox (optional, to grant admin privileges)
  - Initial credits (default: 5)
- **Modal Interface:** Clean popup for user creation
- **User Display:** Shows all users with provider type (Google, Local, etc.)
- **Credit Management:** Adjust credits for any user
- **User Deletion:** Delete non-admin users (cannot delete self or other admins)

## Implementation Details

### Backend Components

#### 1. **auth.js** - Authentication Strategies
```javascript
// Added LocalStrategy for username/password authentication
passport.use(new LocalStrategy(...));

// Helper function to create local users
export async function createLocalUser(username, password, isAdmin);
```

#### 2. **server.js** - Local Auth Routes
```javascript
// POST /auth/local/login - Local login endpoint
// POST /api/admin/users - Create new local user (admin only)
```

#### 3. **api/auth/local.js** - Vercel API Handler
- Handles POST requests for local authentication
- Integrates with Passport.js
- Sets JWT cookies for session management

### Frontend Components

#### 1. **index.html** - Login UI
- Tab-based interface for OAuth vs Local login
- Local login form with username/password fields
- Error handling and loading states
- Fetches `/api/auth/local` for authentication

#### 2. **admin.html** - User Management
- "Add User" button opens modal
- Form validation (username required, password min 6 chars)
- Admin checkbox to grant admin privileges
- Success/error notifications
- Fetches `/api/admin/users` to create users

#### 3. **style.css** - Styling
- Tab styling for login interface
- Form styling with focus states
- Modal styling for user creation
- Responsive design considerations

### Security Features

1. **Password Hashing:** bcryptjs with 10 salt rounds
2. **Password Validation:** Minimum 6 characters
3. **Unique Usernames:** Prevents duplicate usernames
4. **Admin Protection:** Cannot delete admin users or self
5. **JWT Authentication:** Secure token-based sessions
6. **HTTPS in Production:** Secure cookie transmission

## Usage Guide

### For Admins

#### Creating a New User
1. Log in to the application
2. Navigate to Admin Panel (top right)
3. Click "+ Add User" button
4. Enter username (must be unique)
5. Enter password (minimum 6 characters)
6. Optionally check "Make this user an administrator"
7. Click "Create User"
8. User is created with 5 initial credits

#### Managing Users
- **Adjust Credits:** Use the number input in the Credits column
- **Delete Users:** Click "Delete" button (only for non-admin users)
- **View User Info:** See provider type (Local, Google, etc.)

### For Users

#### Logging In with Username/Password
1. Open the application
2. Click "Username & Password" tab
3. Enter your username
4. Enter your password
5. Click "Login"
6. You'll be redirected to the main application

#### Switching Between Auth Methods
- The login screen has two tabs
- Switch between OAuth and Local login at any time
- Both methods work seamlessly with the same application

## Deployment on Vercel

### Environment Variables
No additional environment variables needed for local auth.

Existing variables still required:
- `GOOGLE_API_KEY` - For image generation
- `GOOGLE_CLIENT_ID` - For OAuth (optional)
- `GOOGLE_CLIENT_SECRET` - For OAuth (optional)
- `SESSION_SECRET` - For session security
- `KV_REST_API_URL` - Vercel KV storage
- `KV_REST_API_TOKEN` - Vercel KV auth

### API Routes
The following Vercel serverless functions are available:
- `/api/auth/local` - Local authentication
- `/api/admin/users` - Create user (admin only)
- `/api/admin/users/:id` - Delete user (admin only)
- `/api/admin/users/:id/credits` - Update credits (admin only)

### Storage
User data is stored in Vercel KV (Redis) with the following structure:
```javascript
{
  id: "unique-id",
  provider: "local",
  username: "john_doe",
  password: "hashed-password",
  email: "",
  displayName: "john_doe",
  isAdmin: false,
  credits: 5,
  createdAt: "2025-10-14T12:00:00.000Z"
}
```

## Testing

### Local Testing
1. Start the development server: `npm run dev`
2. Open http://localhost:3000
3. Test OAuth login (if configured)
4. Test local login with username/password
5. Test admin panel user creation

### Admin Account Creation
**First User:** The first user to sign up (via any method) automatically becomes an admin.

**Additional Admins:** Existing admins can create new admin users by checking the "Make this user an administrator" checkbox when creating a user.

## Security Best Practices

1. **Use Strong Passwords:** Minimum 6 characters, recommend 12+
2. **HTTPS Only:** Always deploy with HTTPS enabled
3. **Session Security:** Set `SESSION_SECRET` to a strong random value
4. **Regular Updates:** Keep dependencies updated
5. **Monitor Logs:** Check for suspicious login attempts

## Troubleshooting

### Issue: "Invalid credentials" error
- **Solution:** Verify username and password are correct
- Check if user exists in admin panel
- Ensure password meets minimum requirements

### Issue: Cannot create user (username exists)
- **Solution:** Choose a different username
- Each username must be unique in the system

### Issue: Modal doesn't open
- **Solution:** Check browser console for errors
- Ensure JavaScript is enabled
- Try refreshing the page

### Issue: User not showing in admin panel
- **Solution:** Refresh the page
- Check if user was actually created (look for success message)
- Verify you have admin privileges

## Files Modified/Created

### Modified Files:
- `auth.js` - Added LocalStrategy and createLocalUser function
- `server.js` - Added local auth routes
- `index.html` - Added login tabs and local login form
- `style.css` - Added styling for tabs and forms
- `admin.html` - Added user creation modal and functionality
- `package.json` - Added bcryptjs and passport-local dependencies

### New Files:
- `api/auth/local.js` - Vercel API handler for local auth
- `USERNAME_PASSWORD_AUTH.md` - This documentation file

## Future Enhancements

Potential improvements for future versions:
1. Password reset functionality
2. Email verification
3. Two-factor authentication (2FA)
4. Password strength indicator
5. Account lockout after failed attempts
6. User self-registration option
7. Profile editing (change password)
8. Activity logging

## Support

For issues or questions:
1. Check this documentation
2. Review the code comments in `auth.js` and `server.js`
3. Check browser console for errors
4. Verify environment variables are set correctly

## License

Same as the main project (MIT).
