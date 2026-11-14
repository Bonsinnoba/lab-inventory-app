import {requireAccountManagementAuthority} from '../account-management-authority.js';
import {managementSnapshot,lockAdministrativeIntent,beginAdministrativeIntent,finishAdministrativeIntent} from '../administrative-intents.js';
import {applyAccountProfile} from '../account-profile.js';
import {randomUUID} from 'node:crypto';
import { Router } from 'express';
import { pool } from '../db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { writeAuditLog } from '../middleware/audit.js';
import { loginRateLimit } from '../middleware/security.js';
import { PERMISSIONS, getUserPermissions, rolePermissions, hasPermission } from '../middleware/permissions.js';
import { requirePermissionReplacementAuthority } from '../permission-replacement-authority.js';

const router = Router();
const ROLES = ['admin', 'researcher', 'technician', 'viewer', 'member'];

function issueToken(user) { return jwt.sign({ userId: user.id, credentialVersion: user.credential_version }, config.jwtSecret, { expiresIn: config.jwtExpiresIn }); }
function deny(message, code = 'PERMISSION_DENIED', permission = null) {
  const error = { code, message };
  if (permission) error.permission = permission;
  return { error };
}
function canManageTarget(actor, target) {
  return actor.role === 'admin' || target.role !== 'admin';
}
async function managedProfile(client,id){
 const snapshot=(await managementSnapshot(client,id))[0];if(!snapshot)return null;
 const {user,overrides}=snapshot,baseline=rolePermissions(user.role),effective=new Set(baseline),map=new Map(overrides.map(row=>[row.permission,row.effect]));
 if(user.role!=='admin')for(const row of overrides){if(row.effect==='grant')effective.add(row.permission);else effective.delete(row.permission);}
 return {user,permissions:PERMISSIONS.map(permission=>({permission,baseline:baseline.has(permission),effect:map.get(permission)||'inherited',effective:effective.has(permission)}))};
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
    const result = await client.query(`INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id, username, role, is_active, created_at, credential_version`, [username.trim(), passwordHash]);
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
    const result = await pool.query('SELECT id, username, password_hash, role, display_name, email, created_at, is_active, credential_version FROM users WHERE username = $1', [username.trim()]);
    if (!result.rowCount) { await writeAuditLog({ req, action: 'LOGIN_FAILED', entityType: 'auth', metadata: { username: String(username).trim(), reason: 'unknown_user' } }); return res.status(401).json({ error: 'Invalid credentials' }); }
    const user = result.rows[0]; const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) { await writeAuditLog({ req, action: 'LOGIN_FAILED', entityType: 'auth', entityId: user.id, metadata: { username: user.username, reason: 'invalid_password' } }); return res.status(401).json({ error: 'Invalid credentials' }); }
    if (!user.is_active) { await writeAuditLog({ req, action: 'LOGIN_FAILED', entityType: 'auth', entityId: user.id, metadata: { username: user.username, reason: 'account_disabled' } }); return res.status(403).json({ error: 'Account is disabled' }); }
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    const safeUser = { id: user.id, username: user.username, role: user.role, display_name:user.display_name,email:user.email,created_at: user.created_at, is_active: user.is_active };
    const token = issueToken(user); await writeAuditLog({ req, actorUserId: user.id, action: 'LOGIN', entityType: 'auth', entityId: user.id, metadata: { username: user.username } });
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
  const client=await pool.connect();try {
    await client.query('BEGIN');const before=(await client.query('SELECT display_name,email FROM users WHERE id=$1 FOR UPDATE',[req.user.userId])).rows[0];if(!before)throw Object.assign(Error('User not found'),{status:404});
    await applyAccountProfile(client,{change_id:randomUUID(),entity_type:'account_profile',entity_id:req.user.userId,operation:'update',payload:{profile:{display_name:displayName||null,email},expected_before:before},__credential_version:req.user.credentialVersion,__device_id:'legacy-online-profile'},req.user);
    const result=await client.query('SELECT id,username,role,display_name,email,created_at,is_active,last_login_at FROM users WHERE id=$1',[req.user.userId]);await client.query('COMMIT');res.json({user:result.rows[0]});
  }catch(err){await client.query('ROLLBACK').catch(()=>{});if(err.code==='23505')return res.status(409).json({error:'Email address already exists'});if(err.status)return res.status(err.status).json({error:{code:err.code,message:err.message}});console.error(err);res.status(500).json({error:'Failed to update profile'});}finally{client.release();}
});

router.patch('/me/password', authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password are required' });
  if (new_password.length < 8 || new_password.length > 128) return res.status(400).json({ error: 'new password must be between 8 and 128 characters' });
  if (current_password === new_password) return res.status(400).json({ error: 'new password must differ from the current password' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT id, password_hash, credential_version FROM users WHERE id = $1 AND is_active = TRUE FOR UPDATE', [req.user.userId]);
    if (current.rowCount && current.rows[0].credential_version !== req.user.credentialVersion) {
      await client.query('ROLLBACK');
      return res.status(401).json(deny('Your credentials have changed. Sign in again.', 'SESSION_REVOKED'));
    }
    if (!current.rowCount || !(await bcrypt.compare(current_password, current.rows[0].password_hash))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const passwordHash = await bcrypt.hash(new_password, 12);
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.user.userId]);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'user_password', entityId: req.user.userId, client, required: true });
    await client.query('COMMIT');
    res.json({ message: 'Password updated successfully. Sign in again.', reauthentication_required: true });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(err);
    res.status(500).json({ error: 'Failed to update password' });
  } finally { client.release(); }
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
    await lockAdministrativeIntent(client,req);
    const authority=await requireAccountManagementAuthority(client,req.user,'users.create');
    if(role!=='member'&&!authority.permissions.has('users.manage_roles'))throw Object.assign(Error('Permission required: users.manage_roles'),{status:403,code:'PERMISSION_DENIED'});
    if(role==='admin'&&authority.actor.role!=='admin')throw Object.assign(Error('Only an administrator can create an administrator'),{status:403,code:'ADMIN_ROLE_REQUIRED'});
    const intent=await beginAdministrativeIntent(client,req,'create');if(intent?.replay){await client.query('COMMIT');return res.status(intent.status).json(intent.response);}
    const result = await client.query(`INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at`, [username.trim(), passwordHash, role]);
    await writeAuditLog({ req, action: 'CREATE', entityType: 'user', entityId: result.rows[0].id, newValue: result.rows[0], client, required: true });
    const response={user:(await managementSnapshot(client,result.rows[0].id))[0].user};
    await finishAdministrativeIntent(client,req,intent,'create',null,response,201);
    await client.query('COMMIT');
    res.status(201).json(response);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    if(err.status)return res.status(err.status).json({error:{code:err.code,message:err.message}});
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
    await lockAdministrativeIntent(client,req);
    // Serialize role/status changes, including the last-active-admin invariant.
    await client.query('SELECT pg_advisory_xact_lock($1)', [981235]);
    const authority=await requireAccountManagementAuthority(client,req.user,'users.edit',req.params.id);
    if(role!==undefined&&!authority.permissions.has('users.manage_roles'))throw Object.assign(Error('Permission required: users.manage_roles'),{status:403,code:'PERMISSION_DENIED'});
    if(authority.actor.id===authority.target.id&&is_active===false)throw Object.assign(Error('You cannot disable your own account'),{status:400,code:'SELF_DISABLE_DENIED'});
    const intent=await beginAdministrativeIntent(client,req,'update',req.params.id);if(intent?.replay){await client.query('COMMIT');return res.status(intent.status).json(intent.response);}
    const current = await client.query('SELECT id, username, role, is_active FROM users WHERE id = $1 FOR UPDATE', [req.params.id]); if (!current.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    const before = current.rows[0]; const nextRole = role ?? before.role; const nextActive = is_active ?? before.is_active;
    if (!canManageTarget(authority.actor, before)) { await client.query('ROLLBACK'); return res.status(403).json(deny('Only an administrator can manage an administrator account', 'ADMIN_TARGET_PROTECTED', 'users.edit')); }
    if (nextRole === 'admin' && authority.actor.role !== 'admin') { await client.query('ROLLBACK'); return res.status(403).json(deny('Only an administrator can assign the administrator role', 'ADMIN_ROLE_REQUIRED', 'users.manage_roles')); }
    if (before.role === 'admin' && nextRole !== 'admin') { const count = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE"); if (count.rows[0].count <= 1) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'At least one active administrator is required' }); } }
    if (before.role === 'admin' && before.is_active && nextActive === false) { const count = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE"); if (count.rows[0].count <= 1) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'At least one active administrator is required' }); } }
    const result = await client.query('UPDATE users SET role = $1, is_active = $2 WHERE id = $3 RETURNING id, username, role, is_active, last_login_at, created_at', [nextRole, nextActive, req.params.id]);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'user', entityId: req.params.id, oldValue: before, newValue: result.rows[0], client, required: true });
    const response={user:(await managementSnapshot(client,req.params.id))[0].user};
    await finishAdministrativeIntent(client,req,intent,'update',req.params.id,response);
    await client.query('COMMIT');
    res.json(response);
  } catch (err) { try { await client.query('ROLLBACK'); } catch {} if(err.status)return res.status(err.status).json({error:{code:err.code,message:err.message}});console.error(err); res.status(500).json({ error: 'Failed to update user' }); } finally { client.release(); }
});

router.post('/users/:id/password', authenticateToken, hasPermission('users.reset_password'), async (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password) return res.status(400).json({ error: 'new_password is required' });
  if (new_password.length < 8 || new_password.length > 128) return res.status(400).json({ error: 'new password must be between 8 and 128 characters' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockAdministrativeIntent(client,req);
    const authority=await requireAccountManagementAuthority(client,req.user,'users.reset_password',req.params.id);
    const intent=await beginAdministrativeIntent(client,req,'reset_password',req.params.id);if(intent?.replay){await client.query('COMMIT');return res.status(intent.status).json(intent.response);}
    const target = await client.query('SELECT id, username, role FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!target.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    if (!canManageTarget(authority.actor, target.rows[0])) {
      await client.query('ROLLBACK');
      return res.status(403).json(deny('Only an administrator can reset an administrator password', 'ADMIN_TARGET_PROTECTED', 'users.reset_password'));
    }
    const passwordHash = await bcrypt.hash(new_password, 12);
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.params.id]);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'user_password', entityId: req.params.id, metadata: { username: target.rows[0].username, reset_by_admin: authority.actor.role === 'admin' }, client, required: true });
    const response={message:'Password reset successfully. The account must sign in again.',reauthentication_required:true};
    await finishAdministrativeIntent(client,req,intent,'reset_password',req.params.id,response);
    await client.query('COMMIT');
    res.json(response);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    if(err.status)return res.status(err.status).json({error:{code:err.code,message:err.message}});
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
  } finally { client.release(); }
});

router.get('/users', authenticateToken, hasPermission('users.view'), async (req, res) => {
  try {res.setHeader('Cache-Control','no-store');res.json((await managementSnapshot(pool)).map(row=>row.user));}
  catch(err){console.error(err);res.status(500).json({error:'Failed to load users'});}
});

router.get('/users/:id/permissions', authenticateToken, hasPermission('users.manage_permissions'), async (req, res) => {
  try {const profile=await managedProfile(pool,req.params.id);if(!profile)return res.status(404).json({error:'User not found'});res.setHeader('Cache-Control','no-store');res.json(profile);}
  catch(err){console.error(err);res.status(err.code==='22P02'?400:500).json({error:'Failed to load user permissions'});}
});

router.put('/users/:id/permissions', authenticateToken, hasPermission('users.manage_permissions'), async (req, res) => {
  const target = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [req.params.id]);
  if (!target.rowCount) return res.status(404).json({ error: 'User not found' });
  if (!canManageTarget(req.user, target.rows[0])) return res.status(403).json(deny('Only an administrator can manage administrator permissions', 'ADMIN_TARGET_PROTECTED', 'users.manage_permissions'));
  if (target.rows[0].role === 'admin') return res.status(400).json(deny('Administrator permissions are defined by the administrator role and cannot be overridden', 'ADMIN_PERMISSION_OVERRIDES_UNSUPPORTED', 'users.manage_permissions'));
  if (!Array.isArray(req.body?.overrides)) return res.status(400).json(deny('overrides must be an explicit array; use [] to clear overrides', 'INVALID_PERMISSION_OVERRIDES'));
  const entries = req.body.overrides;
  const invalid = entries.find((entry) => !PERMISSIONS.includes(entry?.permission) || !['grant', 'deny'].includes(entry?.effect));
  if (invalid) return res.status(400).json({ error: 'Invalid permission override' });
  // Current actor authority and all changed overrides (including removals) are
  // checked under transaction locks, not against middleware's earlier snapshot.
  const deduped = new Map(entries.map((entry) => [entry.permission, entry.effect]));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockAdministrativeIntent(client,req);
    await requireAccountManagementAuthority(client,req.user,'users.manage_permissions',req.params.id);
    const intent=await beginAdministrativeIntent(client,req,'permissions',req.params.id);if(intent?.replay){await client.query('COMMIT');return res.status(intent.status).json(intent.response);}
    target.rows[0]=await requirePermissionReplacementAuthority(client,req.user.userId,req.params.id,entries);
    await client.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [req.params.id]);
    for (const [permission, effect] of deduped) await client.query('INSERT INTO user_permission_overrides (user_id, permission, effect, updated_by) VALUES ($1,$2,$3,$4)', [req.params.id, permission, effect, req.user.userId]);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'user_permissions', entityId: req.params.id, metadata: { overrides: [...deduped.entries()] }, client, required: true });
    const response=await managedProfile(client,req.params.id);
    await finishAdministrativeIntent(client,req,intent,'permissions',req.params.id,response);
    await client.query('COMMIT');
    res.json(response);
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(err.status||500).json(deny(err.status?err.message:'Failed to update permissions',err.code||'PERMISSION_UPDATE_FAILED')); } finally { client.release(); }
});

export default router;
