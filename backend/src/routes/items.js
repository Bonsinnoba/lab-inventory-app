import { Router } from 'express';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// GET /api/items — list all items, with optional filters
// Query params: type, status, location_id, low_stock=true
router.get('/', async (req, res) => {
  const { type, status, location_id, low_stock } = req.query;
  const conditions = [];
  const values = [];

  if (type) {
    values.push(type);
    conditions.push(`i.type = $${values.length}`);
  }
  if (status) {
    values.push(status);
    conditions.push(`i.status = $${values.length}`);
  }
  if (location_id) {
    values.push(location_id);
    conditions.push(`i.location_id = $${values.length}`);
  }
  if (low_stock === 'true') {
    conditions.push(`(i.current_quantity <= (i.initial_quantity * 0.2) OR i.status = 'low_stock')`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT i.*
       FROM items i ${where}
       ORDER BY i.name ASC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch items' });
  }
});

// GET /api/items/:id — single item with its transaction and note history
router.get('/:id', async (req, res) => {
  try {
    const item = await pool.query(
      `SELECT i.*, u.username AS assigned_to_username FROM items i LEFT JOIN users u ON u.id = i.assigned_to WHERE i.id = $1`,
      [req.params.id]
    );
    if (item.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const transactions = await pool.query(
      'SELECT * FROM transactions WHERE item_id = $1 ORDER BY date DESC',
      [req.params.id]
    );
    const notes = await pool.query(
      'SELECT * FROM notes WHERE item_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({
      ...item.rows[0],
      transactions: transactions.rows,
      notes: notes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch item' });
  }
});

// POST /api/items — create a new item
router.post('/', async (req, res) => {
  const {
    name, type, category, sku,
    initial_quantity, current_quantity, unit, dimensions,
    status, condition_notes, unit_cost, replacement_cost,
    location_id, photo_url, supplier, supplier_id = null, part_number,
  } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'name and type are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO items (
        name, type, category, sku,
        initial_quantity, current_quantity, unit, dimensions,
        status, condition_notes, unit_cost, replacement_cost,
        location_id, photo_url, supplier, supplier_id, part_number
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [
        name, type, category ?? null, sku ?? null,
        initial_quantity ?? 0, current_quantity ?? initial_quantity ?? 0, unit ?? null, dimensions ?? null,
        status ?? 'available', condition_notes ?? null, unit_cost ?? null, replacement_cost ?? null,
        location_id ?? null, photo_url ?? null, supplier ?? null, supplier_id ?? null, part_number ?? null,
      ]
    );
    await writeAuditLog({ req, action: 'CREATE', entityType: 'item', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create item' });
  }
});

// PUT /api/items/:id — update an item (partial update)
router.put('/:id', async (req, res) => {
  const fields = [
    'name', 'type', 'category', 'sku',
    'initial_quantity', 'unit', 'dimensions',
    'status', 'condition_notes', 'last_checked_at', 'unit_cost', 'replacement_cost',
    'location_id', 'photo_url', 'next_maintenance_date', 'maintenance_interval_days',
    'manufacturer', 'model_number', 'serial_number', 'asset_tag', 'calibration_interval_days', 'next_calibration_date', 'assigned_to', 'supplier', 'supplier_id', 'part_number',
    'image_resource_id',
  ];

  const updates = [];
  const values = [];

  for (const field of fields) {
    if (field in req.body) {
      values.push(req.body[field]);
      updates.push(`${field} = $${values.length}`);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(req.params.id);

  try {
    // Fetch current values first so we can log exactly what changed --
    // history is only meaningful if it records real before/after values,
    // not just "something was updated."
    const before = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    if (before.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    const beforeRow = before.rows[0];

    const result = await pool.query(
      `UPDATE items SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    const afterRow = result.rows[0];

    // Log one history row per field that actually changed value --
    // skip fields sent in the request but equal to what was already there.
    // Date columns come back from node-pg as JS Date objects; format them
    // as plain YYYY-MM-DD rather than verbose Date.toString() output.
    const formatValue = (val) => {
      if (val === null || val === undefined) return null;
      if (val instanceof Date) return val.toISOString().split('T')[0];
      return String(val);
    };

    for (const field of fields) {
      if (!(field in req.body)) continue;
      const oldVal = formatValue(beforeRow[field]);
      const newVal = formatValue(afterRow[field]);
      if (oldVal !== newVal) {
        await pool.query(
          `INSERT INTO item_history (item_id, field_name, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4, $5)`,
          [req.params.id, field, oldVal, newVal, req.user?.userId || null]
        );
      }
    }

    await writeAuditLog({ req, action: 'UPDATE', entityType: 'item', entityId: req.params.id, oldValue: beforeRow, newValue: afterRow });
    res.json(afterRow);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update item' });
  }
});

// GET /api/items/:id/history — audit log of field changes for this item
router.get('/:id/history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM item_history WHERE item_id = $1 ORDER BY changed_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to fetch item history' });
  }
});

router.get('/:id/assignment-history', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.id, a.action, a.old_value, a.new_value, a.created_at, u.username AS actor_username,
             old_user.username AS old_assignee_username, new_user.username AS new_assignee_username
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      LEFT JOIN users old_user ON old_user.id = NULLIF(a.old_value->>'assigned_to', '')::uuid
      LEFT JOIN users new_user ON new_user.id = NULLIF(a.new_value->>'assigned_to', '')::uuid
      WHERE a.entity_type = 'item' AND a.entity_id = $1
        AND (a.old_value ? 'assigned_to' OR a.new_value ? 'assigned_to')
      ORDER BY a.created_at DESC`, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'ASSIGNMENT_HISTORY_FAILED', message: 'Failed to fetch assignment history' } });
  }
});

// GET /api/items/:id/movements — auditable stock/location movement history.
router.get('/:id/movements', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, p.name AS project_name,
             fl.name AS from_location_name, tl.name AS to_location_name,
             u.username AS performed_by_username
      FROM item_movements m
      LEFT JOIN projects p ON p.id = m.project_id
      LEFT JOIN locations fl ON fl.id = m.from_location_id
      LEFT JOIN locations tl ON tl.id = m.to_location_id
      LEFT JOIN users u ON u.id = m.performed_by
      WHERE m.item_id = $1
      ORDER BY m.created_at DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'MOVEMENTS_FETCH_FAILED', message: 'Failed to fetch item movements' } });
  }
});

// POST /api/items/:id/movements — change quantity through an auditable movement.
router.post('/:id/movements', async (req, res) => {
  const {
    movement_type, quantity, to_location_id = null, project_id = null,
    reason = null, reference = null,
  } = req.body;
  const allowed = new Set(['receive','checkout','return','consume','adjust','transfer','damage','loss','repair_out','repair_in']);
  const qty = Number(quantity);
  if (!allowed.has(movement_type)) return res.status(400).json({ error: { code: 'INVALID_MOVEMENT_TYPE', message: 'Invalid movement type' } });
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: { code: 'INVALID_QUANTITY', message: 'Quantity must be greater than zero' } });
  if (movement_type === 'transfer' && !to_location_id) return res.status(400).json({ error: { code: 'TRANSFER_LOCATION_REQUIRED', message: 'A destination location is required for transfers' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemResult = await client.query('SELECT * FROM items WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!itemResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
    }
    const item = itemResult.rows[0];
    const before = Number(item.current_quantity);
    const decreaseTypes = new Set(['checkout','consume','damage','loss','repair_out']);
    const after = decreaseTypes.has(movement_type) ? before - qty : movement_type === 'adjust' ? qty : movement_type === 'transfer' ? before : before + qty;
    if (after < 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: { code: 'INSUFFICIENT_STOCK', message: `Cannot remove ${qty}; only ${before} is available` } });
    }

    let fromLocationId = item.location_id;
    let finalLocationId = item.location_id;
    if (movement_type === 'transfer') {
      if (qty !== before) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'FULL_TRANSFER_REQUIRED', message: `Transfers move the full assigned stock in this version; quantity is ${before}` } });
      }
      if (String(to_location_id) === String(item.location_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { code: 'SAME_LOCATION', message: 'Destination location is already assigned to this item' } });
      }
      finalLocationId = to_location_id;
    }

    const nextStatus = movement_type === 'checkout' ? 'in_use'
      : movement_type === 'damage' ? 'damaged'
      : movement_type === 'repair_out' ? 'needs_repair'
      : (movement_type === 'receive' || movement_type === 'return' || movement_type === 'repair_in') && before === 0 ? 'available'
      : item.status;
    const updated = await client.query(
      `UPDATE items SET current_quantity = $1, location_id = $2, status = $3
       WHERE id = $4 RETURNING *`,
      [after, finalLocationId, nextStatus, req.params.id]
    );

    const movement = await client.query(`
      INSERT INTO item_movements
        (item_id, movement_type, quantity, quantity_before, quantity_after,
         from_location_id, to_location_id, project_id, reason, reference, performed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [req.params.id, movement_type, qty, before, after, fromLocationId, finalLocationId, project_id, reason, reference, req.user.userId]);

    await client.query('COMMIT');
    await writeAuditLog({ req, action: 'INVENTORY_MOVEMENT', entityType: 'item', entityId: req.params.id, oldValue: { current_quantity: before, location_id: fromLocationId }, newValue: { current_quantity: after, location_id: finalLocationId }, metadata: { movement_id: movement.rows[0].id, movement_type, quantity: qty } });
    const lowStockThreshold = Number(updated.rows[0].initial_quantity) * 0.2;
    const enteredLowStock = (after <= lowStockThreshold || updated.rows[0].status === 'low_stock')
      && !(before <= lowStockThreshold || item.status === 'low_stock');
    if (enteredLowStock) {
      const admins = await pool.query("SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE");
      for (const admin of admins.rows) {
        await pool.query(`INSERT INTO notifications(user_id,type,title,body,entity_type,entity_id,metadata)
          VALUES($1,'low_stock','Low stock alert',$2,'item',$3,$4)`, [
          admin.id,
          `${updated.rows[0].name} is now low stock (${after} ${updated.rows[0].unit || 'units'} remaining).`,
          req.params.id,
          JSON.stringify({ item_id: req.params.id, quantity: after, threshold: lowStockThreshold, movement_id: movement.rows[0].id }),
        ]);
      }
    }
    res.status(201).json({ item: updated.rows[0], movement: movement.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: { code: 'MOVEMENT_FAILED', message: 'Failed to record inventory movement' } });
  } finally {
    client.release();
  }
});

// GET /api/items/:id/maintenance — maintenance history.
router.get('/:id/maintenance', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, u.username AS performed_by_username
      FROM maintenance_records m
      LEFT JOIN users u ON u.id = m.performed_by
      WHERE m.item_id = $1
      ORDER BY COALESCE(m.scheduled_date, m.created_at::date) DESC, m.created_at DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'MAINTENANCE_FETCH_FAILED', message: 'Failed to fetch maintenance records' } });
  }
});

// POST /api/items/:id/maintenance — create a maintenance record.
router.post('/:id/maintenance', async (req, res) => {
  const { maintenance_type = 'routine', status = 'completed', scheduled_date = null, completed_date = null, notes = null, cost = null } = req.body;
  const types = new Set(['routine','repair','inspection','calibration','cleaning','other']);
  const statuses = new Set(['scheduled','in_progress','completed','cancelled']);
  if (!types.has(maintenance_type) || !statuses.has(status)) return res.status(400).json({ error: { code: 'INVALID_MAINTENANCE', message: 'Invalid maintenance type or status' } });
  try {
    const item = await pool.query('SELECT id FROM items WHERE id = $1', [req.params.id]);
    if (!item.rowCount) return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
    const result = await pool.query(`
      INSERT INTO maintenance_records
        (item_id, maintenance_type, status, scheduled_date, completed_date, performed_by, notes, cost)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [req.params.id, maintenance_type, status, scheduled_date, completed_date, req.user.userId, notes, cost]);
    if (maintenance_type === 'calibration' && status === 'completed' && completed_date) {
      await pool.query(`UPDATE items SET next_calibration_date = ($1::date + (calibration_interval_days * INTERVAL '1 day'))::date
        WHERE id = $2 AND calibration_interval_days IS NOT NULL`, [completed_date, req.params.id]);
    }
    await writeAuditLog({ req, action: 'CREATE', entityType: 'maintenance_record', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'MAINTENANCE_CREATE_FAILED', message: 'Failed to create maintenance record' } });
  }
});

router.patch('/:id/maintenance/:maintenanceId', async (req, res) => {
  const allowed = ['maintenance_type', 'status', 'scheduled_date', 'completed_date', 'notes', 'cost'];
  const types = new Set(['routine','repair','inspection','calibration','cleaning','other']);
  const statuses = new Set(['scheduled','in_progress','completed','cancelled']);
  const updates = [];
  const values = [];
  for (const field of allowed) if (field in req.body) { values.push(req.body[field] === '' ? null : req.body[field]); updates.push(`${field} = $${values.length}`); }
  if (!updates.length) return res.status(400).json({ error: { code: 'NO_FIELDS', message: 'No valid fields to update' } });
  if ('maintenance_type' in req.body && !types.has(req.body.maintenance_type)) return res.status(400).json({ error: { code: 'INVALID_MAINTENANCE', message: 'Invalid maintenance type' } });
  if ('status' in req.body && !statuses.has(req.body.status)) return res.status(400).json({ error: { code: 'INVALID_MAINTENANCE', message: 'Invalid maintenance status' } });
  values.push(req.params.maintenanceId, req.params.id);
  try {
    const result = await pool.query(`UPDATE maintenance_records SET ${updates.join(', ')} WHERE id=$${values.length - 1} AND item_id=$${values.length} RETURNING *`, values);
    if (!result.rowCount) return res.status(404).json({ error: { code: 'MAINTENANCE_NOT_FOUND', message: 'Maintenance record not found' } });
    if (result.rows[0].maintenance_type === 'calibration' && result.rows[0].status === 'completed' && result.rows[0].completed_date) {
      await pool.query(`UPDATE items SET next_calibration_date = ($1::date + (calibration_interval_days * INTERVAL '1 day'))::date
        WHERE id = $2 AND calibration_interval_days IS NOT NULL`, [result.rows[0].completed_date, req.params.id]);
    }
    await writeAuditLog({ req, action: 'UPDATE', entityType: 'maintenance_record', entityId: req.params.maintenanceId, newValue: result.rows[0] });
    res.json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: { code: 'MAINTENANCE_UPDATE_FAILED', message: 'Failed to update maintenance record' } }); }
});

router.delete('/:id/maintenance/:maintenanceId', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM maintenance_records WHERE id=$1 AND item_id=$2 RETURNING *', [req.params.maintenanceId, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: { code: 'MAINTENANCE_NOT_FOUND', message: 'Maintenance record not found' } });
    await writeAuditLog({ req, action: 'DELETE', entityType: 'maintenance_record', entityId: req.params.maintenanceId, oldValue: result.rows[0] });
    res.status(204).send();
  } catch (err) { console.error(err); res.status(500).json({ error: { code: 'MAINTENANCE_DELETE_FAILED', message: 'Failed to delete maintenance record' } }); }
});

// GET /api/items/by-sku/:sku — exact-match lookup, for barcode scanning.
// Most physical barcode scanners are keyboard-wedge devices: they just
// "type" the scanned code (plus Enter) into whatever input has focus, no
// camera/driver integration needed on this end -- an input field wired
// to this endpoint is what actually makes scanning work in practice.
router.get('/by-sku/:sku', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items WHERE sku = $1', [req.params.sku]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `No item found with SKU "${req.params.sku}"` });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to look up item by SKU' });
  }
});

// DELETE /api/items/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM items WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    await writeAuditLog({ req, action: 'DELETE', entityType: 'item', entityId: req.params.id, oldValue: result.rows[0] });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete item' });
  }
});

// POST /api/items/bulk-status — update status for multiple items at once.
// Uses POST (not PATCH/DELETE) deliberately: a bare "/bulk-status" path
// under a different HTTP method than DELETE /:id can't collide with it,
// but reusing DELETE for a bulk operation on a non-:id path has bitten
// this app before (see blocks.js/connectors.js route-mounting history).
router.post('/bulk-status', async (req, res) => {
  const { ids, status } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE items SET status = $1 WHERE id = ANY($2::uuid[]) RETURNING id`,
      [status, ids]
    );
    res.json({ updated: result.rows.length, ids: result.rows.map(r => r.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to bulk-update items' });
  }
});

// POST /api/items/bulk-delete — delete multiple items at once.
router.post('/bulk-delete', requireRole('admin'), async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM items WHERE id = ANY($1::uuid[]) RETURNING id`,
      [ids]
    );
    res.json({ deleted: result.rows.length, ids: result.rows.map(r => r.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to bulk-delete items' });
  }
});

export default router;
