import { Router } from 'express';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router();
const clampPageSize = (value) => Math.min(100, Math.max(1, Number(value) || 6));
const pageMeta = (page, pageSize, total) => ({ page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) });

// Paginated inventory with free-form storage labels and container information.
router.get('/items', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = clampPageSize(req.query.page_size);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const offset = (page - 1) * pageSize;
  const values = [];
  const where = [];
  if (search) {
    values.push(`%${search}%`);
    where.push(`(i.name ILIKE $${values.length} OR COALESCE(i.sku,'') ILIKE $${values.length} OR COALESCE(i.storage_location,'') ILIKE $${values.length})`);
  }
  const predicate = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM items i ${predicate}`, values);
    values.push(pageSize, offset);
    const result = await pool.query(`
      SELECT i.*, l.name AS location_name, sc.name AS storage_container_name
      FROM items i
      LEFT JOIN locations l ON l.id = i.location_id
      LEFT JOIN storage_containers sc ON sc.id = i.storage_container_id
      ${predicate}
      ORDER BY i.name ASC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
    res.json({ items: result.rows, ...pageMeta(page, pageSize, count.rows[0].total) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'PHASE4_ITEMS_FAILED', message: 'Failed to fetch paginated inventory' } });
  }
});

router.get('/containers', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = clampPageSize(req.query.page_size);
  const offset = (page - 1) * pageSize;
  try {
    const count = await pool.query('SELECT COUNT(*)::int AS total FROM storage_containers');
    const result = await pool.query(`
      SELECT sc.*, COUNT(i.id)::int AS item_count
      FROM storage_containers sc
      LEFT JOIN items i ON i.storage_container_id = sc.id
      GROUP BY sc.id
      ORDER BY sc.name ASC
      LIMIT $1 OFFSET $2
    `, [pageSize, offset]);
    res.json({ containers: result.rows, ...pageMeta(page, pageSize, count.rows[0].total) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'PHASE4_CONTAINERS_FAILED', message: 'Failed to fetch storage containers' } });
  }
});

router.post('/containers', async (req, res) => {
  const { name, container_type = 'box', storage_location = null, capacity = null, notes = null } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { code: 'CONTAINER_NAME_REQUIRED', message: 'Container name is required' } });
  try {
    const result = await pool.query(`
      INSERT INTO storage_containers(name, container_type, storage_location, capacity, notes)
      VALUES($1,$2,$3,$4,$5) RETURNING *
    `, [name.trim(), container_type, storage_location?.trim() || null, capacity, notes]);
    await writeAuditLog({ req, action: 'CREATE', entityType: 'storage_container', entityId: result.rows[0].id, newValue: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'CONTAINER_CREATE_FAILED', message: 'Failed to create storage container' } });
  }
});

router.patch('/items/:id/storage', async (req, res) => {
  const { storage_location = null, storage_container_id = null } = req.body;
  try {
    const before = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    if (!before.rowCount) return res.status(404).json({ error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } });
    const result = await pool.query(`
      UPDATE items SET storage_location = $1, storage_container_id = $2 WHERE id = $3 RETURNING *
    `, [storage_location?.trim() || null, storage_container_id || null, req.params.id]);
    await writeAuditLog({ req, action: 'UPDATE_STORAGE', entityType: 'item', entityId: req.params.id, oldValue: { storage_location: before.rows[0].storage_location, storage_container_id: before.rows[0].storage_container_id }, newValue: { storage_location: result.rows[0].storage_location, storage_container_id: result.rows[0].storage_container_id } });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'ITEM_STORAGE_UPDATE_FAILED', message: 'Failed to update item storage' } });
  }
});

// Lightweight scientific intelligence: stock pressure, maintenance pressure, and storage coverage.
router.get('/intelligence', async (_req, res) => {
  try {
    const [inventory, maintenance, storage] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total_items, COUNT(*) FILTER (WHERE status='low_stock' OR current_quantity <= initial_quantity * 0.2)::int AS low_stock, COUNT(*) FILTER (WHERE current_quantity <= 0)::int AS depleted FROM items`),
      pool.query(`SELECT COUNT(*)::int AS due FROM maintenance_records WHERE status IN ('scheduled','in_progress') AND scheduled_date IS NOT NULL AND scheduled_date <= CURRENT_DATE + INTERVAL '14 days'`),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE storage_location IS NOT NULL AND btrim(storage_location) <> '')::int AS labeled, COUNT(*) FILTER (WHERE storage_container_id IS NOT NULL)::int AS contained FROM items`),
    ]);
    const i = inventory.rows[0], m = maintenance.rows[0], s = storage.rows[0];
    res.json({ inventory: i, maintenance: m, storage: s, signals: [
      ...(Number(i.depleted) > 0 ? [{ level: 'critical', message: `${i.depleted} item(s) are depleted` }] : []),
      ...(Number(i.low_stock) > 0 ? [{ level: 'warning', message: `${i.low_stock} item(s) are at or below the 20% stock threshold` }] : []),
      ...(Number(m.due) > 0 ? [{ level: 'attention', message: `${m.due} maintenance task(s) are due within 14 days` }] : []),
      ...(Number(s.total) > Number(s.labeled) ? [{ level: 'attention', message: `${Number(s.total) - Number(s.labeled)} item(s) have no free-form storage label` }] : []),
    ] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { code: 'INTELLIGENCE_FAILED', message: 'Failed to calculate scientific inventory signals' } });
  }
});

export default router;
