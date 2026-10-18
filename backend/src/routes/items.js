import {inventoryHttpMutation} from '../inventory-http.js';
import { Router } from 'express';
import { pool } from '../db.js';
import { getUserPermissions } from '../middleware/permissions.js';
import { hasPermission } from '../middleware/permissions.js';
import maintenanceRouter from './maintenance.js';

const router = Router();
router.use('/:id/maintenance', maintenanceRouter);
router.get('/', async (req, res) => {
  const { type, status, location, location_id, low_stock } = req.query;
  const conditions = []; const values = [];
  if (type) { values.push(type); conditions.push(`i.type = $${values.length}`); }
  if (status) { values.push(status); conditions.push(`i.status = $${values.length}`); }
  if (location) { values.push(`%${String(location).trim()}%`); conditions.push(`i.storage_location ILIKE $${values.length}`); }
  if (location_id) { values.push(location_id); conditions.push(`i.location_id = $${values.length}`); }
  if (low_stock === 'true') conditions.push(`(i.current_quantity <= (i.initial_quantity * 0.2) OR i.status = 'low_stock')`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try { const result = await pool.query(`SELECT i.* FROM items i ${where} ORDER BY i.name ASC`, values); res.json(result.rows); }
  catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch items' }); }
});

router.get('/assignees/directory', hasPermission('inventory.view'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, display_name, email, role FROM users WHERE is_active = true ORDER BY username ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'DIRECTORY_FETCH_FAILED', message: 'Failed to fetch assignee directory' } });
  }
});

router.get('/salvage/recoveries', hasPermission('inventory.view'), async (req, res) => {
  try {
    const { status, project_id } = req.query;
    const conds = []; const vals = [];
    if (status) { vals.push(status); conds.push(`s.quarantine_status = $${vals.length}`); }
    if (project_id) { vals.push(project_id); conds.push(`s.project_id = $${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const result = await pool.query(`
      SELECT s.*, 
             si.name AS source_item_name,
             p.name AS project_name,
             qb.username AS quarantined_by_username,
             ib.username AS inspected_by_username
      FROM item_salvage_recoveries s
      LEFT JOIN items si ON si.id = s.source_item_id
      LEFT JOIN projects p ON p.id = s.project_id
      LEFT JOIN users qb ON qb.id = s.quarantined_by
      LEFT JOIN users ib ON ib.id = s.inspected_by
      ${where}
      ORDER BY s.created_at DESC
    `, vals);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SALVAGE_FETCH_FAILED', message: 'Failed to fetch salvage recoveries' } });
  }
});

router.post('/salvage/recoveries', hasPermission('inventory.create'), async (req, res) => {
  const { source_item_id, project_id, recovery_type, recovered_item_name, source_quantity, recovered_quantity, unit, condition, valuation_notes, attestation_notes } = req.body;
  if (!recovery_type || !['unused_stock_return','equipment_return','component_recovery','disassembly_output','scrap'].includes(recovery_type)) {
    return res.status(400).json({ error: { code: 'INVALID_RECOVERY_TYPE', message: 'Invalid recovery type' } });
  }
  if (!recovered_item_name || !recovered_item_name.trim()) {
    return res.status(400).json({ error: { code: 'RECOVERED_NAME_REQUIRED', message: 'Recovered item name is required' } });
  }
  const sQty = Number(source_quantity), rQty = Number(recovered_quantity);
  if (!(sQty > 0) || !(rQty > 0)) {
    return res.status(400).json({ error: { code: 'INVALID_QUANTITY', message: 'Source and recovered quantities must be positive' } });
  }
  if (!source_item_id && (!attestation_notes || !attestation_notes.trim())) {
    return res.status(400).json({ error: { code: 'ATTESTATION_REQUIRED', message: 'Legacy or unknown provenance requires explicit attestation notes' } });
  }
  try {
    if (source_item_id) {
      const sourceExists = await pool.query('SELECT id FROM items WHERE id = $1', [source_item_id]);
      if (!sourceExists.rowCount) {
        return res.status(404).json({ error: { code: 'SOURCE_ITEM_NOT_FOUND', message: 'Source item does not exist; deleted items cannot be resurrected' } });
      }
    }
    const result = await pool.query(`
      INSERT INTO item_salvage_recoveries (
        source_item_id, project_id, recovery_type, recovered_item_name, source_quantity, recovered_quantity,
        unit, quarantine_status, condition, valuation_notes, attestation_notes, quarantined_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'quarantined',$8,$9,$10,$11) RETURNING *
    `, [source_item_id || null, project_id || null, recovery_type, recovered_item_name.trim(), sQty, rQty, unit || null, condition || 'uninspected', valuation_notes || null, attestation_notes || null, req.user.userId]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SALVAGE_CREATE_FAILED', message: 'Failed to record salvage recovery' } });
  }
});

router.post('/salvage/recoveries/:id/inspect', hasPermission('inventory.edit'), async (req, res) => {
  const { condition, reviewed_valuation, valuation_notes, approval } = req.body;
  if (!['approved','rejected'].includes(approval)) {
    return res.status(400).json({ error: { code: 'INVALID_APPROVAL', message: 'approval must be approved or rejected' } });
  }
  if (condition && !['uninspected','like_new','good','fair','damaged_repairable','scrap'].includes(condition)) {
    return res.status(400).json({ error: { code: 'INVALID_CONDITION', message: 'Invalid condition' } });
  }
  const valuation = reviewed_valuation != null ? Number(reviewed_valuation) : null;
  if (valuation != null && (isNaN(valuation) || valuation < 0)) {
    return res.status(400).json({ error: { code: 'INVALID_VALUATION', message: 'Reviewed valuation must be non-negative numeric' } });
  }
  try {
    const existing = await pool.query('SELECT * FROM item_salvage_recoveries WHERE id = $1', [req.params.id]);
    if (!existing.rowCount) return res.status(404).json({ error: { code: 'SALVAGE_NOT_FOUND', message: 'Salvage record not found' } });
    const recovery = existing.rows[0];
    if (recovery.quarantine_status === 'released') {
      return res.status(409).json({ error: { code: 'ALREADY_RELEASED', message: 'Released material cannot be re-inspected' } });
    }
    const newStatus = approval === 'approved' ? 'inspected_approved' : 'inspected_rejected';
    const result = await pool.query(`
      UPDATE item_salvage_recoveries
      SET quarantine_status = $1,
          condition = COALESCE($2, condition),
          reviewed_valuation = COALESCE($3, reviewed_valuation),
          valuation_notes = COALESCE($4, valuation_notes),
          inspected_by = $5,
          inspected_at = now(),
          updated_at = now()
      WHERE id = $6 RETURNING *
    `, [newStatus, condition || null, valuation, valuation_notes || null, req.user.userId, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'SALVAGE_INSPECT_FAILED', message: 'Failed to inspect salvage recovery' } });
  }
});

router.post('/salvage/recoveries/:id/release', hasPermission('inventory.adjust_stock'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM item_salvage_recoveries WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'SALVAGE_NOT_FOUND', message: 'Salvage record not found' } });
    }
    const recovery = existing.rows[0];
    if (recovery.quarantine_status !== 'inspected_approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: { code: 'QUARANTINE_NOT_APPROVED', message: 'Material must be inspected and approved before release from quarantine' } });
    }
    let recoveredItemId = recovery.recovered_item_id;
    if (recovery.recovery_type !== 'scrap') {
      if (recoveredItemId) {
        await client.query('UPDATE items SET current_quantity = current_quantity + $1, updated_at = now() WHERE id = $2', [recovery.recovered_quantity, recoveredItemId]);
      } else {
        const itemStatus = recovery.condition === 'damaged_repairable' ? 'needs_repair' : 'available';
        const newItem = await client.query(`
          INSERT INTO items (
            name, type, status, initial_quantity, current_quantity, unit, acquisition_method, acquisition_source, acquisition_notes, replacement_cost, unit_cost
          ) VALUES ($1, 'part', $2, $3, $3, $4, 'salvaged', 'Salvage recovery quarantine release', $5, $6, 0)
          RETURNING id
        `, [
          recovery.recovered_item_name,
          itemStatus,
          recovery.recovered_quantity,
          recovery.unit || null,
          `Released from salvage quarantine ${recovery.id}`,
          recovery.reviewed_valuation || null
        ]);
        recoveredItemId = newItem.rows[0].id;
      }
      await client.query(`
        INSERT INTO item_movements (
          item_id, movement_type, quantity, quantity_before, quantity_after, project_id, reason, performed_by
        ) VALUES ($1, 'receive', $2, 0, $2, $3, 'Quarantine salvage release', $4)
      `, [recoveredItemId, recovery.recovered_quantity, recovery.project_id || null, req.user.userId]);
    }

    const updated = await client.query(`
      UPDATE item_salvage_recoveries
      SET quarantine_status = 'released',
          recovered_item_id = $1,
          updated_at = now()
      WHERE id = $2 RETURNING *
    `, [recoveredItemId, req.params.id]);
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: { code: 'SALVAGE_RELEASE_FAILED', message: 'Failed to release salvage material' } });
  } finally {
    client.release();
  }
});

router.get('/custody/recipient/:recipientId', hasPermission('inventory.view'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, 
             i.name AS item_name,
             i.sku AS item_sku,
             i.type AS item_type,
             p.name AS project_name,
             iss.username AS issued_by_username
      FROM item_custody_records c
      JOIN items i ON i.id = c.item_id
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN users iss ON iss.id = c.issued_by
      WHERE c.recipient_id = $1 AND c.outstanding_quantity > 0
      ORDER BY c.issued_at DESC
    `, [req.params.recipientId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'CUSTODY_FETCH_FAILED', message: 'Failed to fetch recipient custody records' } });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await pool.query(`SELECT i.*, u.username AS assigned_to_username FROM items i LEFT JOIN users u ON u.id = i.assigned_to WHERE i.id = $1`, [req.params.id]);
    if (!item.rowCount) return res.status(404).json({ error: 'Item not found' });
    const permissions = await getUserPermissions(req.user.userId, req.user.role);
    const transactions = permissions.has('finance.view') ? await pool.query('SELECT * FROM transactions WHERE item_id = $1 ORDER BY date DESC', [req.params.id]) : { rows: [] };
    const notes = permissions.has('notes.view') ? await pool.query('SELECT * FROM notes WHERE item_id = $1 ORDER BY created_at DESC', [req.params.id]) : { rows: [] };
    res.json({ ...item.rows[0], transactions: transactions.rows, notes: notes.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch item' }); }
});

router.post('/',hasPermission('inventory.create'),inventoryHttpMutation('create'));
router.put('/:id',hasPermission('inventory.edit'),inventoryHttpMutation('update'));

router.get('/:id/history', async (req, res) => { try { const result = await pool.query('SELECT * FROM item_history WHERE item_id = $1 ORDER BY changed_at DESC', [req.params.id]); res.json(result.rows); } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch item history' }); } });
router.get('/:id/assignment-history', async (req, res) => { try { const result = await pool.query(`SELECT a.id,a.action,a.old_value,a.new_value,a.created_at,u.username AS actor_username,old_user.username AS old_assignee_username,new_user.username AS new_assignee_username FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN users old_user ON old_user.id=NULLIF(a.old_value->>'assigned_to','')::uuid LEFT JOIN users new_user ON new_user.id=NULLIF(a.new_value->>'assigned_to','')::uuid WHERE a.entity_type='item' AND a.entity_id=$1 AND (a.old_value ? 'assigned_to' OR a.new_value ? 'assigned_to') ORDER BY a.created_at DESC`, [req.params.id]); res.json(result.rows); } catch (err) { console.error(err); res.status(500).json({ error: { code: 'ASSIGNMENT_HISTORY_FAILED', message: 'Failed to fetch assignment history' } }); } });
router.get('/:id/movements', async (req, res) => { try { const result = await pool.query(`SELECT m.*,p.name AS project_name,u.username AS performed_by_username FROM item_movements m LEFT JOIN projects p ON p.id=m.project_id LEFT JOIN users u ON u.id=m.performed_by WHERE m.item_id=$1 ORDER BY m.created_at DESC`, [req.params.id]); res.json(result.rows); } catch (err) { console.error(err); res.status(500).json({ error: { code: 'MOVEMENTS_FETCH_FAILED', message: 'Failed to fetch item movements' } }); } });
router.get('/:id/custody', hasPermission('inventory.view'), async (req, res) => {
  try {
    const custody = await pool.query(`
      SELECT c.*, 
             rec.username AS recipient_username,
             rec.display_name AS recipient_display_name,
             iss.username AS issued_by_username,
             p.name AS project_name
      FROM item_custody_records c
      LEFT JOIN users rec ON rec.id = c.recipient_id
      LEFT JOIN users iss ON iss.id = c.issued_by
      LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.item_id = $1
      ORDER BY c.issued_at DESC
    `, [req.params.id]);
    const ids = custody.rows.map(r => r.id);
    let settlements = { rows: [] };
    if (ids.length) {
      settlements = await pool.query(`
        SELECT s.*, 
               u.username AS performed_by_username,
               tr.username AS transfer_recipient_username
        FROM item_custody_settlements s
        LEFT JOIN users u ON u.id = s.performed_by
        LEFT JOIN users tr ON tr.id = s.transfer_recipient_id
        WHERE s.custody_id = ANY($1::uuid[])
        ORDER BY s.settled_at DESC
      `, [ids]);
    }
    const settlementsByCustody = new Map();
    for (const s of settlements.rows) {
      if (!settlementsByCustody.has(s.custody_id)) settlementsByCustody.set(s.custody_id, []);
      settlementsByCustody.get(s.custody_id).push(s);
    }
    const records = custody.rows.map(c => ({
      ...c,
      settlements: settlementsByCustody.get(c.id) || []
    }));
    res.json(records);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'CUSTODY_FETCH_FAILED', message: 'Failed to fetch item custody records' } });
  }
});
router.post('/:id/movements',hasPermission('inventory.adjust_stock'),inventoryHttpMutation('create',{movement:true}));
router.post('/bulk-status',hasPermission('inventory.edit'),inventoryHttpMutation('bulk_status'));
router.post('/bulk-delete',hasPermission('inventory.delete'),inventoryHttpMutation('bulk_delete'));
router.delete('/:id',hasPermission('inventory.delete'),inventoryHttpMutation('delete'));

export default router;
