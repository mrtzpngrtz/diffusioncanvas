import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.SESSION_SECRET;
const JWT_EXPIRES_IN = '24h';

export function generateToken(user) {
    return jwt.sign(
        { 
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            isAdmin: user.isAdmin,
            credits: user.credits
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

export function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

export function setAuthCookie(res, user) {
    const token = generateToken(user);
    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
}

export function getAuthUser(req) {
    const token = req.cookies.auth_token;
    if (!token) return null;
    return verifyToken(token);
}

export function clearAuthCookie(res) {
    res.clearCookie('auth_token');
}

export function generateShareToken(boardId) {
    return jwt.sign(
        { boardId, isShareGuest: true },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

export function verifyShareToken(token) {
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        return payload?.isShareGuest ? payload : null;
    } catch {
        return null;
    }
}

