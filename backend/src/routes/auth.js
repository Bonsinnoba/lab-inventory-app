import { Router } from 'express';
import { pool } from '../db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { writeAuditLog } from '../middleware/audit.js';
import { loginRateLimit } from '../middleware/security.js';
import { PERMISSIONS, getUserPermissions, rolePermissions, hasPermission } from '../middleware/permissions.js';

const router = Router();
const ROLES = ['admin', 'researcher', 'technician', 'viewer', 'member'];

function issueToken(user) { return jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn }); }
function deny(message, code = 'PERMISSION_DENIED', permission = null) {
  const error = { code, message };
  if (permission) error.permission = permission;
  return { error };
}
function canManageTarget(actor, target) {
  return actor.role === 'admin' || target.role !== 'admin';
}

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password) return res.status(400).json({ error: 'username and password are required' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'password must be between 8 and 128 characters' });
  if (username.trim().length < 3 || username.trim().length > 64) return res.status(400).json({ error: 'username must be between 3 and 64 characters' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock($1)', [981234]);
    const countResult = await client.query('SELECT COUNT(*)::int AS count FROM users');
    if (countResult.rows[0].count !== 0) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Registration is closed. Ask a lab administrator to create your account.' }); }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await client.query(`INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id, username, role, is_active, created_at`, [username.trim(), passwordHash]);
    const user = result.rows[0];
    await writeAuditLog({ req, actorUserId: user.id, action: 'CREATE', entityType: 'user', entityId: user.id, newValue: user, client, required: true });
    await client.query('COMMIT'); const token = issueToken(user);
    res.status(201).json({ user, token });
  } catch (err) { try { await client.query('ROLLBACK'); } catch {} console.error(err); if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' }); res.status(500).json({ error: 'Registration failed' }); } finally { client.release(); }
});

router.post('/login', loginRateLimit(), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
  try {
    const result = await pool.query('SELECT id, username, password_hash, role, created_at, is_active FROM users WHERE username = $1', [username.trim()]);
    if (!result.rowCount) { await writeAuditLog({ req, action: 'LOGIN_FAILED', entityType: 'auth', metadata: { username: String(username).trim(), reason: 'unknown_user' } }); return res.status(401).json({ error: 'Invalid credentials' }); }
    const user = result.rows[0]; const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) { await writeAuditLog({ req, action: 'LOGIN_FAILED', entityType: 'auth', entityId: user.id, metadata: { username: user.username, reason: 'invalid_password' } }); return res.status(401).json({ error: 'Invalid credentials' }); }
    if (!user.is_active) { await writeAuditLog({ req, action: 'LOGIN_FAILED', entityType: 'auth', entityId: user.id, metadata: { username: user.username, reason: 'account_disabled' } }); return res.status(403).json({ error: 'Account is disabled' }); }
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    const safeUser = { id: user.id, username: user.username, role: user.role, created_at: user.created_at, is_active: user.is_active };
    const token = issueToken(safeUser); await writeAuditLog({ req, actorUserId: user.id, action: 'LOGIN', entityType: 'auth', entityId: user.id, metadata: { username: user.username } });
    res.json({ user: safeUser, token });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Login failed' }); }
});

router.get('/me', authenticateToken, async (req, res) => {
  try { const result = await pool.query('SELECT id, username, role, display_name, email, created_at, is_active, last_login_at FROM users WHERE id = $1', [req.user.userId]); if (!result.rowCount) return res.status(404).json({ error: 'User not found' }); res.json({ user: result.rows[0] }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Failed to get current user' }); }
});

router.get('/me/permissions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, is_active FROM users WHERE id = $1', [req.user.userId]);
    if (!result.rowCount || !result.rows[0].is_active) return res.status(403).json({ error: 'Account is disabled' });
    const user = result.rows[0];
    const effective = await getUserPermissions(user.id, user.role);
    res.json({ user: { id: user.id, username: user.username, role: user.role }, permissions: PERMISSIONS.map((permission) => ({ permission, effective: effective.has(permission) })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load current permissions' }); }
});

router.patch('/me/profile', authenticateToken, async (req, res) => {
  const displayName = req.body?.display_name == null ? null : String(req.body.display_name).trim();
  const email = req.body?.email == null || String(req.body.email).trim() === '' ? null : String(req.body.email).trim().toLowerCase();
  if (displayName && displayName.length > 120) return res.status(400).json({ error: 'display_name must be 120 characters or fewer' });
  if (email && (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email))) return res.status(400).json({ error: 'email is invalid' });
  try { const result = await pool.query(`UPDATE users SET display_name = $1, email = $2 WHERE id = $3 RETURNING id, username, role, display_name, email, created_at, is_active, last_login_at`, [displayName || null, email, req.user.userId]); if (!result.rowCount) return res.status(404).json({ error: 'User not found' }); await writeAuditLog({ req, action: 'UPDATE', entityType: 'user_profile', entityId: req.user.userId, newValue: result.rows[0] }); res.json({ user: result.rows[0] }); }
  catch (err) { console.error(err); if (err.code === '23505') return res.status(409).json({ error: 'Email address already exists' }); res.status(500).json({ error: 'Failed to update profile' }); }
});

router.patch('/me/password', authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password are required' });
  if (new_password.length < 8 || new_password.length > 128) return res.status(400).json({ error: 'new password must be between 8 and 128 characters' });
  if (current_password === new_password) return res.status(400).json({ error: 'new password must differ from the current password' });
  try { const current = await pool.query('SELECT id, password_hash FROM users WHERE id = $1 AND is_active = TRUE', [req.user.userId]); if (!current.rowCount || !(await bcrypt.compare(current_password, current.rows[0].password_hash))) return res.status(400).json({ error: 'Current password is incorrect' }); const passwordHash = await bcrypt.hash(new_password, 12); await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.user.userId]); await writeAuditLog({ req, action: 'UPDATE', entityType: 'user_password', entityId: req.user.userId }); res.json({ message: 'Password updated successfully' }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Failed to update password' }); }
});

router.post('/users', authenticateToken, hasPermission('users.create'), async (req, res) => {
  const { username, password, role = 'member' } = req.body;
  if (!username?.trim() || !password) return res.status(400).json({ error: 'username and password are required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid role' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'password must be between 8 and 128 characters' });
  if (username.trim().length < 3 || username.trim().length > 64) return res.status(400).json({ error: 'username must be between 3 and 64 characters' });
  const actorPermissions = req.permissions || await getUserPermissions(req.user.userId, req.user.role);
  if (role !== 'member' && !actorPermissions.has('users.manage_roles')) return res.status(403).json(deny('Permission required: users.manage_roles', 'PERMISSION_DENIED', 'users.manage_roles'));
  if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json(deny('Only an administrator can create an administrator account', 'ADMIN_ROLE_REQUIRED', 'users.manage_roles'));
  const client = await pool.connect();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query('BEGIN');
    const result = await client.query(`INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at`, [username.trim(), passwordHash, role]);
    await writeAuditLog({ req, action: 'CREATE', entityType: 'user', entityId: result.rows[0].id, newValue: result.rows[0], client, required: true });
    await client.query('COMMIT');
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Failed to create user' });
  } finally { client.release(); }
});

router.patch('/users/:id', authenticateToken, hasPermission('users.edit'), async (req, res) => {
  const { role, is_active } = req.body;
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'invalid role' });
  if (is_active !== undefined && typeof is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be boolean' });
  if (req.params.id === req.user.userId && is_active === false) return res.status(400).json({ error: 'You cannot disable your own account' });
  const actorPermissions = req.permissions || await getUserPermissions(req.user.userId, req.user.role);
  if (role !== undefined && !actorPermissions.has('users.manage_roles')) return res.status(403).json({ error: { code: 'PERMISSION_DENIED', message: 'Permission required: users.manage_roles', permission: 'users.manage_roles' } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize role/status changes, including the last-active-admin invariant.
    await client.query('SELECT pg_advisory_xact_lock($1)', [981235]);
    const current = await client.query('SELECT id, username, role, is_active FROM users WHERE id = $1 FOR UPDATE', [req.params.id]); if (!current.rowCount) return res.status(404).json({ error: 'User not found' });
    const before = current.rows[0]; const nextRole = role ?? before.role; const nextActive = is_active ?? before.is_active;
    if (!canManageTarget(req.user, before)) return res.status(403).json(deny('Only an administrator can manage an administrator account', 'ADMIN_TARGET_PROTECTED', 'users.edit'));
    if (nextRole === 'admin' && req.user.role !== 'admin') return res.status(403).json(deny('Only an administrator can assign the administrator role', 'ADMIN_ROLE_REQUIRED', 'users.manage_roles'));
    if (before.role === 'admin' && nextRole !== 'admin') { const count = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE"); if (count.rows[0].count <= 1) return res.status(400).json({ error: 'At least one active administrator is required' }); }
    if (before.role === 'admin' && before.is_active && nextActive === false) { const count = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE"); if (count.rows[0].count <= 1) return res.status(400).json({ error: 'At least one active administrator is required' }); }
    const result = await client.query('UPDATE users SET role = $1, is_active = $2 WHERE id = $3 RETURNING id, username, role, is_active, last_login_at, created_at', [nextRole, nextActive, req.params.id]);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'user', entityId: req.params.id, oldValue: before, newValue: result.rows[0], client, required: true });
    await client.query('COMMIT');
    res.json({ user: result.rows[0] });
  } catch (err) { try { await client.query('ROLLBACK'); } catch {} console.error(err); res.status(500).json({ error: 'Failed to update user' }); } finally { client.release(); }
});

router.post('/users/:id/password', authenticateToken, hasPermission('users.reset_password'), async (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password) return res.status(400).json({ error: 'new_password is required' });
  if (new_password.length < 8 || new_password.length > 128) return res.status(400).json({ error: 'new password must be between 8 and 128 characters' });
  try { const target = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [req.params.id]); if (!target.rowCount) return res.status(404).json({ error: 'User not found' }); if (!canManageTarget(req.user, target.rows[0])) return res.status(403).json(deny('Only an administrator can reset an administrator password', 'ADMIN_TARGET_PROTECTED', 'users.reset_password')); const passwordHash = await bcrypt.hash(new_password, 12); await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.params.id]); await writeAuditLog({ req, action: 'UPDATE', entityType: 'user_password', entityId: req.params.id, metadata: { username: target.rows[0].username, reset_by_admin: req.user.role === 'admin' } }); res.json({ message: 'Password reset successfully' }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Failed to reset password' }); }
});

router.get('/users', authenticateToken, hasPermission('users.view'), async (req, res) => { const result = await pool.query('SELECT id, username, role, is_active, last_login_at, created_at FROM users ORDER BY username'); res.json(result.rows); });

router.get('/users/:id/permissions', authenticateToken, hasPermission('users.manage_permissions'), async (req, res) => {
  const target = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [req.params.id]);
  if (!target.rowCount) return res.status(404).json({ error: 'User not found' });
  const user = target.rows[0];
  const effective = await getUserPermissions(user.id, user.role);
  const overrides = await pool.query('SELECT permission, effect FROM user_permission_overrides WHERE user_id = $1 ORDER BY permission', [user.id]);
  const overrideMap = new Map(overrides.rows.map((row) => [row.permission, row.effect]));
  res.json({ user, permissions: PERMISSIONS.map((permission) => ({ permission, baseline: rolePermissions(user.role).has(permission), effect: overrideMap.get(permission) || 'inherited', effective: effective.has(permission) })) });
});

router.put('/users/:id/permissions', authenticateToken, hasPermission('users.manage_permissions'), async (req, res) => {
  const target = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [req.params.id]);
  if (!target.rowCount) return res.status(404).json({ error: 'User not found' });
  if (!canManageTarget(req.user, target.rows[0])) return res.status(403).json(deny('Only an administrator can manage administrator permissions', 'ADMIN_TARGET_PROTECTED', 'users.manage_permissions'));
  if (target.rows[0].role === 'admin') return res.status(400).json(deny('Administrator permissions are defined by the administrator role and cannot be overridden', 'ADMIN_PERMISSION_OVERRIDES_UNSUPPORTED', 'users.manage_permissions'));
  const entries = Array.isArray(req.body?.overrides) ? req.body.overrides : [];
  const invalid = entries.find((entry) => !PERMISSIONS.includes(entry?.permission) || !['grant', 'deny'].includes(entry?.effect));
  if (invalid) return res.status(400).json({ error: 'Invalid permission override' });
  const actorPermissions = req.permissions || await getUserPermissions(req.user.userId, req.user.role);
  if (req.user.role !== 'admin') {
    const escalation = entries.find((entry) => !actorPermissions.has(entry.permission));
    if (escalation) return res.status(403).json({ error: { code: 'PERMISSION_ESCALATION_BLOCKED', message: `You cannot manage permission: ${escalation.permission}`, permission: escalation.permission } });
  }
  const deduped = new Map(entries.map((entry) => [entry.permission, entry.effect]));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [req.params.id]);
    for (const [permission, effect] of deduped) await client.query('INSERT INTO user_permission_overrides (user_id, permission, effect, updated_by) VALUES ($1,$2,$3,$4)', [req.params.id, permission, effect, req.user.userId]);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'user_permissions', entityId: req.params.id, metadata: { overrides: [...deduped.entries()] }, client, required: true });
    await client.query('COMMIT');
    const effective = await getUserPermissions(req.params.id, target.rows[0].role);
    res.json({ user: target.rows[0], permissions: PERMISSIONS.map((permission) => ({ permission, baseline: rolePermissions(target.rows[0].role).has(permission), effect: deduped.get(permission) || 'inherited', effective: effective.has(permission) })) });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ error: 'Failed to update permissions' }); } finally { client.release(); }
});

export default router;
