import { Router } from 'express';
import { pool } from '../db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { writeAuditLog } from '../middleware/audit.js';
import { loginRateLimit } from '../middleware/security.js';

const router = Router();

function issueToken(user) {
  return jwt.sign(
    { userId: user.id },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

// Registration is intentionally limited: the first user may be created as
// the initial administrator, but after an account exists, new accounts must
// be created by an authenticated administrator through the admin endpoint.
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'password must be between 8 and 128 characters' });
  }
  if (username.trim().length < 3 || username.trim().length > 64) {
    return res.status(400).json({ error: 'username must be between 3 and 64 characters' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize bootstrap registration so two simultaneous requests cannot
    // both observe an empty users table and create multiple initial admins.
    await client.query('SELECT pg_advisory_xact_lock($1)', [981234]);
    const countResult = await client.query('SELECT COUNT(*)::int AS count FROM users');
    if (countResult.rows[0].count !== 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Registration is closed. Ask a lab administrator to create your account.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await client.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id, username, role, is_active, created_at`,
      [username.trim(), passwordHash]
    );
    await client.query('COMMIT');
    const user = result.rows[0];
    const token = issueToken(user);
    await writeAuditLog({ req, actorUserId: user.id, action: 'CREATE', entityType: 'user', entityId: user.id, newValue: user });

    res.status(201).json({ user, token });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
});

router.post('/login', loginRateLimit(), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

  try {
    const result = await pool.query(
      'SELECT id, username, password_hash, role, created_at, is_active FROM users WHERE username = $1',
      [username.trim()]
    );
    if (!result.rowCount) {
      await writeAuditLog({
        req,
        action: 'LOGIN_FAILED',
        entityType: 'auth',
        metadata: { username: String(username).trim(), reason: 'unknown_user' },
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      await writeAuditLog({
        req,
        action: 'LOGIN_FAILED',
        entityType: 'auth',
        entityId: user.id,
        metadata: { username: user.username, reason: 'invalid_password' },
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      await writeAuditLog({
        req,
        action: 'LOGIN_FAILED',
        entityType: 'auth',
        entityId: user.id,
        metadata: { username: user.username, reason: 'account_disabled' },
      });
      return res.status(403).json({ error: 'Account is disabled' });
    }
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    const safeUser = { id: user.id, username: user.username, role: user.role, created_at: user.created_at, is_active: user.is_active };
    const token = issueToken(safeUser);
    await writeAuditLog({
      req,
      actorUserId: user.id,
      action: 'LOGIN',
      entityType: 'auth',
      entityId: user.id,
      metadata: { username: user.username },
    });
    res.json({ user: safeUser, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, display_name, email, created_at, is_active, last_login_at FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get current user' });
  }
});

router.patch('/me/profile', authenticateToken, async (req, res) => {
  const displayName = req.body?.display_name == null ? null : String(req.body.display_name).trim();
  const email = req.body?.email == null || String(req.body.email).trim() === '' ? null : String(req.body.email).trim().toLowerCase();
  if (displayName && displayName.length > 120) return res.status(400).json({ error: 'display_name must be 120 characters or fewer' });
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return res.status(400).json({ error: 'email is invalid' });

  try {
    const result = await pool.query(
      `UPDATE users SET display_name = $1, email = $2
       WHERE id = $3
       RETURNING id, username, role, display_name, email, created_at, is_active, last_login_at`,
      [displayName || null, email, req.user.userId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'User not found' });
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'user_profile', entityId: req.user.userId, newValue: result.rows[0] });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Email address already exists' });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.patch('/me/password', authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password are required' });
  if (new_password.length < 8 || new_password.length > 128) return res.status(400).json({ error: 'new password must be between 8 and 128 characters' });
  if (current_password === new_password) return res.status(400).json({ error: 'new password must differ from the current password' });

  try {
    const current = await pool.query('SELECT id, password_hash FROM users WHERE id = $1 AND is_active = TRUE', [req.user.userId]);
    if (!current.rowCount || !(await bcrypt.compare(current_password, current.rows[0].password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const passwordHash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.user.userId]);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'user_password', entityId: req.user.userId });
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// Admin-only account management. This avoids exposing role selection during
// public registration while still supporting a real multi-user lab.
router.post('/users', authenticateToken, requireRole('admin'), async (req, res) => {
  const { username, password, role = 'member' } = req.body;
  if (!username?.trim() || !password) return res.status(400).json({ error: 'username and password are required' });
  if (!['admin', 'researcher', 'technician', 'viewer', 'member'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'password must be between 8 and 128 characters' });
  if (username.trim().length < 3 || username.trim().length > 64) return res.status(400).json({ error: 'username must be between 3 and 64 characters' });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, username, role, created_at`,
      [username.trim(), passwordHash, role]
    );
    await writeAuditLog({ req, action: 'CREATE', entityType: 'user', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.patch('/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const { role, is_active } = req.body;
  if (role !== undefined && !['admin', 'researcher', 'technician', 'viewer', 'member'].includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be boolean' });
  }
  if (req.params.id === req.user.userId && is_active === false) {
    return res.status(400).json({ error: 'You cannot disable your own account' });
  }

  try {
    const current = await pool.query('SELECT id, username, role, is_active FROM users WHERE id = $1', [req.params.id]);
    if (!current.rowCount) return res.status(404).json({ error: 'User not found' });
    const before = current.rows[0];
    const nextRole = role ?? before.role;
    const nextActive = is_active ?? before.is_active;

    if (before.role === 'admin' && nextRole !== 'admin') {
      const count = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE");
      if (count.rows[0].count <= 1) return res.status(400).json({ error: 'At least one active administrator is required' });
    }
    if (before.role === 'admin' && before.is_active && nextActive === false) {
      const count = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE");
      if (count.rows[0].count <= 1) return res.status(400).json({ error: 'At least one active administrator is required' });
    }

    const result = await pool.query(
      'UPDATE users SET role = $1, is_active = $2 WHERE id = $3 RETURNING id, username, role, is_active, last_login_at, created_at',
      [nextRole, nextActive, req.params.id]
    );
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'user', entityId: req.params.id, oldValue: before, newValue: result.rows[0] });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.post('/users/:id/password', authenticateToken, requireRole('admin'), async (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password) return res.status(400).json({ error: 'new_password is required' });
  if (new_password.length < 8 || new_password.length > 128) return res.status(400).json({ error: 'new password must be between 8 and 128 characters' });

  try {
    const target = await pool.query('SELECT id, username FROM users WHERE id = $1', [req.params.id]);
    if (!target.rowCount) return res.status(404).json({ error: 'User not found' });
    const passwordHash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.params.id]);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'user_password', entityId: req.params.id, metadata: { username: target.rows[0].username, reset_by_admin: true } });
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.get('/users', authenticateToken, requireRole('admin'), async (req, res) => {
  const result = await pool.query('SELECT id, username, role, is_active, last_login_at, created_at FROM users ORDER BY username');
  res.json(result.rows);
});

export default router;
