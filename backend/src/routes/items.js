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
router.post('/:id/movements',hasPermission('inventory.adjust_stock'),inventoryHttpMutation('create',{movement:true}));
router.post('/bulk-status',hasPermission('inventory.edit'),inventoryHttpMutation('bulk_status'));
router.post('/bulk-delete',hasPermission('inventory.delete'),inventoryHttpMutation('bulk_delete'));
router.delete('/:id',hasPermission('inventory.delete'),inventoryHttpMutation('delete'));

export default router;
