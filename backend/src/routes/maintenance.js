import { Router } from 'express';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router({ mergeParams: true });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const types = new Set(['routine', 'repair', 'inspection', 'calibration', 'cleaning', 'other']);
const statuses = new Set(['scheduled', 'in_progress', 'completed', 'cancelled']);
const fields = ['maintenance_type', 'status', 'scheduled_date', 'completed_date', 'notes', 'cost'];

function error(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function dateOrNull(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

function validatedFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'A maintenance record is required' };
  const result = {};
  for (const field of fields) {
    if (!Object.hasOwn(body, field)) continue;
    const value = body[field];
    if (field === 'maintenance_type') {
      if (!types.has(value)) return { error: 'Invalid maintenance type' };
    } else if (field === 'status') {
      if (!statuses.has(value)) return { error: 'Invalid maintenance status' };
    } else if (field === 'scheduled_date' || field === 'completed_date') {
      const date = dateOrNull(value);
      if (date === undefined) return { error: `Invalid ${field}` };
      result[field] = date;
      continue;
    } else if (field === 'notes') {
      if (value !== null && (typeof value !== 'string' || value.length > 10000)) return { error: 'Invalid maintenance notes' };
    } else if (field === 'cost') {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return { error: 'Cost must be a nonnegative number' };
    }
    result[field] = value;
  }
  return { fields: result };
}

function validateIds(req, res, next) {
  if (!uuid.test(req.params.id)) return error(res, 400, 'INVALID_ITEM_ID', 'Invalid item ID');
  if (req.params.maintenanceId && !uuid.test(req.params.maintenanceId)) return error(res, 400, 'INVALID_MAINTENANCE_ID', 'Invalid maintenance record ID');
  next();
}

router.use(validateIds);

router.get('/', async (req, res, next) => {
  try {
    const item = await pool.query('SELECT 1 FROM items WHERE id=$1', [req.params.id]);
    if (!item.rowCount) return error(res, 404, 'ITEM_NOT_FOUND', 'Item not found');
    const result = await pool.query(`SELECT m.*,u.username AS performed_by_username
      FROM maintenance_records m LEFT JOIN users u ON u.id=m.performed_by
      WHERE m.item_id=$1 ORDER BY m.scheduled_date DESC NULLS LAST,m.created_at DESC`, [req.params.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  const validated = validatedFields(req.body);
  if (validated.error) return error(res, 400, 'INVALID_MAINTENANCE', validated.error);
  const record = validated.fields;
  try {
    const item = await pool.query('SELECT 1 FROM items WHERE id=$1', [req.params.id]);
    if (!item.rowCount) return error(res, 404, 'ITEM_NOT_FOUND', 'Item not found');
    const result = await pool.query(`INSERT INTO maintenance_records
      (item_id,maintenance_type,status,scheduled_date,completed_date,notes,cost,performed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [
      req.params.id, record.maintenance_type ?? 'routine', record.status ?? 'scheduled',
      record.scheduled_date ?? null, record.completed_date ?? null, record.notes ?? null,
      record.cost ?? null, record.status === 'completed' ? req.user.userId : null,
    ]);
    await writeAuditLog({ req, action: 'CREATE', entityType: 'maintenance_record', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:maintenanceId', async (req, res, next) => {
  const validated = validatedFields(req.body);
  if (validated.error) return error(res, 400, 'INVALID_MAINTENANCE', validated.error);
  const patch = validated.fields;
  const keys = Object.keys(patch);
  if (!keys.length) return error(res, 400, 'NO_MAINTENANCE_FIELDS', 'No valid fields to update');
  try {
    const before = await pool.query('SELECT * FROM maintenance_records WHERE id=$1 AND item_id=$2', [req.params.maintenanceId, req.params.id]);
    if (!before.rowCount) return error(res, 404, 'MAINTENANCE_NOT_FOUND', 'Maintenance record not found');
    const values = keys.map(key => patch[key]);
    const assignments = keys.map((key, index) => `${key}=$${index + 1}`);
    if (patch.status === 'completed' && !before.rows[0].performed_by) {
      values.push(req.user.userId);
      assignments.push(`performed_by=$${values.length}`);
    }
    values.push(req.params.maintenanceId, req.params.id);
    const result = await pool.query(`UPDATE maintenance_records SET ${assignments.join(',')}
      WHERE id=$${values.length - 1} AND item_id=$${values.length} RETURNING *`, values);
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'maintenance_record', entityId: req.params.maintenanceId, oldValue: before.rows[0], newValue: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:maintenanceId', async (req, res, next) => {
  try {
    const deleted = await pool.query('DELETE FROM maintenance_records WHERE id=$1 AND item_id=$2 RETURNING *', [req.params.maintenanceId, req.params.id]);
    if (!deleted.rowCount) return error(res, 404, 'MAINTENANCE_NOT_FOUND', 'Maintenance record not found');
    await writeAuditLog({ req, action: 'DELETE', entityType: 'maintenance_record', entityId: req.params.maintenanceId, oldValue: deleted.rows[0] });
    res.json({ deleted: true, id: req.params.maintenanceId });
  } catch (err) { next(err); }
});

export default router;
