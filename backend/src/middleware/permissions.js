import { pool } from '../db.js';

export const PERMISSIONS = Object.freeze([
  'inventory.view', 'inventory.create', 'inventory.edit', 'inventory.delete', 'inventory.adjust_stock', 'inventory.import',
  'projects.view', 'projects.create', 'projects.edit', 'projects.delete', 'projects.manage_members', 'projects.manage_owner',
  'finance.view', 'finance.create_income', 'finance.create_expense', 'finance.edit', 'finance.delete', 'finance.import',
  'reports.view', 'reports.export',
  'users.view', 'users.create', 'users.edit', 'users.manage_permissions', 'users.manage_roles', 'users.reset_password',
  'engineering.view', 'engineering.create', 'engineering.edit', 'engineering.delete',
  'automation.view', 'automation.run',
  'notes.view', 'notes.create', 'notes.edit', 'notes.delete',
  'resources.view', 'resources.create', 'resources.edit', 'resources.delete',
]);

const ROLE_BASELINES = Object.freeze({
  admin: new Set(PERMISSIONS),
  researcher: new Set(['inventory.view', 'inventory.create', 'inventory.edit', 'inventory.adjust_stock', 'projects.view', 'projects.create', 'projects.edit', 'finance.view', 'finance.create_expense', 'reports.view', 'reports.export', 'engineering.view', 'engineering.create', 'engineering.edit', 'engineering.delete', 'automation.view', 'automation.run', 'notes.view', 'notes.create', 'notes.edit', 'notes.delete', 'resources.view', 'resources.create', 'resources.edit', 'resources.delete']),
  technician: new Set(['inventory.view', 'inventory.create', 'inventory.edit', 'inventory.adjust_stock', 'projects.view', 'finance.view', 'reports.view', 'engineering.view', 'engineering.create', 'engineering.edit', 'automation.view', 'notes.view', 'notes.create', 'notes.edit', 'resources.view', 'resources.create', 'resources.edit']),
  member: new Set(['inventory.view', 'projects.view', 'finance.view', 'reports.view', 'engineering.view', 'automation.view', 'notes.view', 'notes.create', 'notes.edit', 'resources.view', 'resources.create', 'resources.edit']),
  viewer: new Set(['inventory.view', 'projects.view', 'finance.view', 'reports.view', 'engineering.view', 'automation.view', 'notes.view', 'resources.view']),
});

export function rolePermissions(role) { return new Set(ROLE_BASELINES[role] || []); }

export async function getUserPermissions(userId, role) {
  const permissions = rolePermissions(role);
  const result = await pool.query('SELECT permission, effect FROM user_permission_overrides WHERE user_id = $1', [userId]);
  for (const row of result.rows) { if (row.effect === 'grant') permissions.add(row.permission); if (row.effect === 'deny') permissions.delete(row.permission); }
  return permissions;
}

export function hasPermission(permission) {
  return async (req, res, next) => {
    if (!req.user?.userId) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
    try {
      const user = await pool.query('SELECT role, is_active FROM users WHERE id = $1', [req.user.userId]);
      if (!user.rowCount || !user.rows[0].is_active) return res.status(403).json({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' } });
      const permissions = await getUserPermissions(req.user.userId, user.rows[0].role);
      if (!permissions.has(permission)) return res.status(403).json({ error: { code: 'PERMISSION_DENIED', message: `Permission required: ${permission}`, permission } });
      req.permissions = permissions; next();
    } catch (err) { next(err); }
  };
}

export { ROLE_BASELINES };
