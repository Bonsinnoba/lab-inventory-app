import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db.js';

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

  // Media/PDF elements cannot set Authorization headers. Resource download
  // URLs use a short-lived, resource-scoped JWT and are accepted only on the
  // download endpoint.
  if (!token && req.path.endsWith('/download') && typeof req.query.access_token === 'string') {
    token = req.query.access_token;
  }

  if (!token) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (decoded.purpose === 'resource-download' && !req.path.endsWith('/download')) {
      return res.status(401).json({ error: { code: 'INVALID_TOKEN_PURPOSE', message: 'Invalid token purpose' } });
    }

    // The database is authoritative for current role/active status. This
    // means disabling a user or changing their role takes effect immediately,
    // even if an old JWT has not expired yet.
    const result = await pool.query(
      'SELECT id, username, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (!result.rowCount || !result.rows[0].is_active) {
      return res.status(401).json({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled or no longer exists' } });
    }

    const user = result.rows[0];
    req.user = {
      userId: user.id,
      username: user.username,
      role: user.role,
      ...(decoded.purpose ? { purpose: decoded.purpose } : {}),
      ...(decoded.resourceId ? { resourceId: decoded.resourceId } : {}),
    };
    next();
  } catch (err) {
    console.error('Authentication error:', err.message);
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    next();
  };
}
