import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// Search uses text matching so short/prefix queries work immediately instead of
// depending on a pre-built search_vector.
const TYPE_QUERIES = {
  projects: `SELECT id, name, status, budget, 1.0 AS rank FROM projects p WHERE (COALESCE(p.name,'') ILIKE '%' || $1 || '%' OR COALESCE(p.description,'') ILIKE '%' || $1 || '%') AND ($3 = 'admin' OR p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2)) ORDER BY CASE WHEN lower(p.name)=lower($1) THEN 3 WHEN lower(p.name) LIKE lower($1) || '%' THEN 2 ELSE 1 END DESC, p.name ASC LIMIT 30`,
  items: `SELECT i.id, i.name, i.type, i.status, i.current_quantity, i.unit, i.sku, i.storage_location, sc.name AS storage_container_name, sc.storage_location AS storage_container_location, 1.0 AS rank FROM items i LEFT JOIN storage_containers sc ON sc.id = i.storage_container_id WHERE (COALESCE(i.name,'') ILIKE '%' || $1 || '%' OR COALESCE(i.sku,'') ILIKE '%' || $1 || '%' OR COALESCE(i.storage_location,'') ILIKE '%' || $1 || '%' OR COALESCE(sc.name,'') ILIKE '%' || $1 || '%' OR COALESCE(sc.storage_location,'') ILIKE '%' || $1 || '%') ORDER BY CASE WHEN lower(i.name)=lower($1) THEN 3 WHEN lower(i.name) LIKE lower($1) || '%' THEN 2 ELSE 1 END DESC, i.name ASC LIMIT 30`,
  notes: `SELECT id, title, body, tags, updated_at, 1.0 AS rank FROM notes WHERE (COALESCE(title,'') ILIKE '%' || $1 || '%' OR COALESCE(body,'') ILIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM unnest(COALESCE(tags, ARRAY[]::text[])) tag WHERE tag ILIKE '%' || $1 || '%')) AND ($3 = 'admin' OR project_id IS NULL OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = notes.project_id AND pm.user_id = $2)) ORDER BY CASE WHEN lower(title)=lower($1) THEN 3 WHEN lower(title) LIKE lower($1) || '%' THEN 2 ELSE 1 END DESC, updated_at DESC LIMIT 30`,
  transactions: `SELECT id, type, amount, date, vendor, notes, item_id, project_id, 1.0 AS rank FROM transactions WHERE (COALESCE(vendor,'') ILIKE '%' || $1 || '%' OR COALESCE(notes,'') ILIKE '%' || $1 || '%' OR COALESCE(type,'') ILIKE '%' || $1 || '%') AND ($3 = 'admin' OR project_id IS NULL OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = transactions.project_id AND pm.user_id = $2)) ORDER BY date DESC LIMIT 30`,
  resources: `SELECT id, name, kind, file_type, original_filename, item_id, project_id, note_id, category, description, tags, updated_at, 1.0 AS rank FROM resources WHERE (COALESCE(name,'') ILIKE '%' || $1 || '%' OR COALESCE(original_filename,'') ILIKE '%' || $1 || '%' OR COALESCE(description,'') ILIKE '%' || $1 || '%' OR COALESCE(category,'') ILIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM unnest(COALESCE(tags, ARRAY[]::text[])) tag WHERE tag ILIKE '%' || $1 || '%')) AND ($3 = 'admin' OR project_id IS NULL OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = resources.project_id AND pm.user_id = $2)) ORDER BY CASE WHEN lower(name)=lower($1) THEN 3 WHEN lower(name) LIKE lower($1) || '%' THEN 2 ELSE 1 END DESC, updated_at DESC LIMIT 30`,
  users: `SELECT id, username, display_name, role, email, 1.0 AS rank FROM users WHERE username ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%' ORDER BY CASE WHEN lower(username)=lower($1) OR lower(display_name)=lower($1) THEN 3 WHEN lower(username) LIKE lower($1) || '%' OR lower(display_name) LIKE lower($1) || '%' THEN 2 ELSE 1 END DESC, username ASC LIMIT 30`,
  tasks: `SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority, p.name AS project_name, 1.0 AS rank FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE (COALESCE(t.title,'') ILIKE '%' || $1 || '%' OR COALESCE(t.description,'') ILIKE '%' || $1 || '%') AND ($3 = 'admin' OR p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = $2)) ORDER BY CASE WHEN lower(t.title)=lower($1) THEN 3 WHEN lower(t.title) LIKE lower($1) || '%' THEN 2 ELSE 1 END DESC, t.updated_at DESC LIMIT 30`,
  experiments: `SELECT e.id, e.project_id, e.title, e.status, e.hypothesis, e.procedure, p.name AS project_name, 1.0 AS rank FROM project_experiments e JOIN projects p ON p.id=e.project_id WHERE (COALESCE(e.title,'') ILIKE '%' || $1 || '%' OR COALESCE(e.hypothesis,'') ILIKE '%' || $1 || '%' OR COALESCE(e.procedure,'') ILIKE '%' || $1 || '%') AND ($3 = 'admin' OR p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = e.project_id AND pm.user_id = $2)) ORDER BY CASE WHEN lower(e.title)=lower($1) THEN 3 WHEN lower(e.title) LIKE lower($1) || '%' THEN 2 ELSE 1 END DESC, e.updated_at DESC LIMIT 30`,
  blocks: `SELECT b.id, b.project_id, b.title, b.block_type, b.text_content, p.name AS project_name, 1.0 AS rank FROM project_blocks b JOIN projects p ON p.id=b.project_id WHERE (COALESCE(b.title,'') ILIKE '%' || $1 || '%' OR COALESCE(b.text_content,'') ILIKE '%' || $1 || '%') AND ($3 = 'admin' OR p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = b.project_id AND pm.user_id = $2)) ORDER BY CASE WHEN lower(COALESCE(b.title,''))=lower($1) THEN 3 WHEN lower(COALESCE(b.title,'')) LIKE lower($1) || '%' THEN 2 ELSE 1 END DESC, b.created_at DESC LIMIT 30`,
};

function normalizeTypes(type) { const requested = type ? (Array.isArray(type) ? type : String(type).split(',')) : Object.keys(TYPE_QUERIES); return [...new Set(requested.filter((value) => Object.hasOwn(TYPE_QUERIES, value)))]; }
function decorate(type, row) {
  if (type === 'projects') return { ...row, type: 'project', title: row.name, subtitle: row.status || 'No status' };
  if (type === 'items') return { ...row, type: 'item', title: row.name, subtitle: `${row.type || 'Item'} - ${row.status || 'unknown'}`, storage_location: row.storage_location || null, storage_container_name: row.storage_container_name || null, storage_container_location: row.storage_container_location || null };
  if (type === 'notes') return { ...row, type: 'note', title: row.title, subtitle: row.tags?.length ? row.tags.join(', ') : 'No tags' };
  if (type === 'users') return { ...row, type: 'user', title: row.display_name || row.username, subtitle: `${row.role} · ${row.email || row.username}` };
  if (type === 'tasks') return { ...row, type: 'task', title: row.title, subtitle: `${row.project_name} · ${row.status}` };
  if (type === 'experiments') return { ...row, type: 'experiment', title: row.title, subtitle: `${row.project_name} · ${row.status}` };
  if (type === 'blocks') return { ...row, type: 'block', title: row.title || row.block_type, subtitle: `${row.project_name} · Canvas block` };
  if (type === 'transactions') { const dateStr = row.date ? String(row.date).split('T')[0] : ''; return { ...row, type: 'transaction', title: `${row.type} - $${row.amount}`, subtitle: row.vendor || dateStr || 'Transaction' }; }
  return { ...row, type: 'resource', title: row.name, subtitle: [row.category, row.kind, row.file_type].filter(Boolean).join(' - ') || 'Resource' };
}

router.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.status(400).json({ error: 'query parameter "q" is required' });
  if (q.length > 200) return res.status(400).json({ error: 'search query is too long' });
  let types = normalizeTypes(req.query.type);
  if (req.user.role !== 'admin') types = types.filter((type) => type !== 'users');
  if (types.length === 0) return res.status(400).json({ error: 'at least one permitted search type is required' });
  try {
    // Do not let one broken/legacy table query make the entire global search fail.
    // Successful categories still return immediately while the failing category is logged.
    const settled = await Promise.allSettled(types.map(async (type) => {
      const result = await pool.query(TYPE_QUERIES[type], [q, req.user.userId, req.user.role]);
      return [type, result.rows.map((row) => decorate(type, row))];
    }));
    const rows = [];
    for (let i = 0; i < settled.length; i += 1) {
      const result = settled[i];
      if (result.status === 'fulfilled') rows.push(result.value);
      else console.error(`Search query failed for type ${types[i]}:`, result.reason);
    }
    if (rows.length === 0) return res.status(503).json({ error: 'Search service unavailable. Check the database connection and migrations.' });
    const grouped = Object.fromEntries(rows); const all = rows.flatMap(([, values]) => values).sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0)).slice(0, 100); const counts = Object.fromEntries(rows.map(([type, values]) => [type, values.length]));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ query: q, counts, total: all.length, all, ...grouped });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Search failed' }); }
});
export default router;
