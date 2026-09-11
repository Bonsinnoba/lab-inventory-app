import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

const TYPE_QUERIES = {
  projects: `
    SELECT id, name, status, budget,
           ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS rank
    FROM projects p
    WHERE search_vector @@ plainto_tsquery('english', $1)
      AND ($3 = 'admin' OR p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2))
    ORDER BY rank DESC, name ASC
    LIMIT 30`,
  items: `
    SELECT id, name, type, status, current_quantity, unit, sku,
           ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS rank
    FROM items
    WHERE search_vector @@ plainto_tsquery('english', $1)
    ORDER BY rank DESC, name ASC
    LIMIT 30`,
  notes: `
    SELECT id, title, body, tags, updated_at,
           ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS rank
    FROM notes
    WHERE search_vector @@ plainto_tsquery('english', $1)
      AND ($3 = 'admin' OR project_id IS NULL OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = notes.project_id AND pm.user_id = $2))
    ORDER BY rank DESC, updated_at DESC
    LIMIT 30`,
  transactions: `
    SELECT id, type, amount, date, vendor, notes, item_id, project_id,
           ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS rank
    FROM transactions
    WHERE search_vector @@ plainto_tsquery('english', $1)
      AND ($3 = 'admin' OR project_id IS NULL OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = transactions.project_id AND pm.user_id = $2))
    ORDER BY rank DESC, date DESC
    LIMIT 30`,
  resources: `
    SELECT id, name, kind, file_type, original_filename, item_id, project_id, note_id,
           category, description, tags, updated_at,
           ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS rank
    FROM resources
    WHERE search_vector @@ plainto_tsquery('english', $1)
      AND ($3 = 'admin' OR project_id IS NULL OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = resources.project_id AND pm.user_id = $2))
    ORDER BY rank DESC, updated_at DESC
    LIMIT 30`,
  users: `
    SELECT id, username, display_name, role, email,
           1.0 AS rank
    FROM users
    WHERE username ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%'
    ORDER BY username ASC LIMIT 30`,
  tasks: `
    SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority, p.name AS project_name,
           1.0 AS rank
    FROM project_tasks t JOIN projects p ON p.id=t.project_id
    WHERE (t.title ILIKE '%' || $1 || '%' OR t.description ILIKE '%' || $1 || '%')
      AND ($3 = 'admin' OR p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = $2))
    ORDER BY t.updated_at DESC LIMIT 30`,
  experiments: `
    SELECT e.id, e.project_id, e.title, e.status, e.hypothesis, e.procedure, p.name AS project_name,
           1.0 AS rank
    FROM project_experiments e JOIN projects p ON p.id=e.project_id
    WHERE (e.title ILIKE '%' || $1 || '%' OR e.hypothesis ILIKE '%' || $1 || '%' OR e.procedure ILIKE '%' || $1 || '%')
      AND ($3 = 'admin' OR p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = e.project_id AND pm.user_id = $2))
    ORDER BY e.updated_at DESC LIMIT 30`,
  blocks: `
    SELECT b.id, b.project_id, b.title, b.block_type, b.text_content, p.name AS project_name,
           1.0 AS rank
    FROM project_blocks b JOIN projects p ON p.id=b.project_id
    WHERE (COALESCE(b.title,'') ILIKE '%' || $1 || '%' OR COALESCE(b.text_content,'') ILIKE '%' || $1 || '%')
      AND ($3 = 'admin' OR p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = b.project_id AND pm.user_id = $2))
    ORDER BY b.created_at DESC LIMIT 30`,
};

function normalizeTypes(type) {
  const requested = type
    ? (Array.isArray(type) ? type : String(type).split(','))
    : Object.keys(TYPE_QUERIES);
  return [...new Set(requested.filter((value) => Object.hasOwn(TYPE_QUERIES, value)))];
}

function decorate(type, row) {
  if (type === 'projects') {
    return { ...row, type: 'project', title: row.name, subtitle: row.status || 'No status' };
  }
  if (type === 'items') {
    return { ...row, type: 'item', title: row.name, subtitle: `${row.type || 'Item'} - ${row.status || 'unknown'}` };
  }
  if (type === 'notes') {
    return { ...row, type: 'note', title: row.title, subtitle: row.tags?.length ? row.tags.join(', ') : 'No tags' };
  }
  if (type === 'users') return { ...row, type: 'user', title: row.display_name || row.username, subtitle: `${row.role} · ${row.email || row.username}` };
  if (type === 'tasks') return { ...row, type: 'task', title: row.title, subtitle: `${row.project_name} · ${row.status}` };
  if (type === 'experiments') return { ...row, type: 'experiment', title: row.title, subtitle: `${row.project_name} · ${row.status}` };
  if (type === 'blocks') return { ...row, type: 'block', title: row.title || row.block_type, subtitle: `${row.project_name} · Canvas block` };
  if (type === 'transactions') {
    const dateStr = row.date ? String(row.date).split('T')[0] : '';
    return { ...row, type: 'transaction', title: `${row.type} - $${row.amount}`, subtitle: row.vendor || dateStr || 'Transaction' };
  }
  return {
    ...row,
    type: 'resource',
    title: row.name,
    subtitle: [row.category, row.kind, row.file_type].filter(Boolean).join(' - ') || 'Resource',
  };
}

// GET /api/search?q=query&type=items,notes,transactions,resources,projects
// Global full-text search. The response includes grouped results plus one
// relevance-sorted `all` collection for unified search UIs.
router.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.status(400).json({ error: 'query parameter "q" is required' });
  if (q.length > 200) return res.status(400).json({ error: 'search query is too long' });

  let types = normalizeTypes(req.query.type);
  // User directory data is administrative information. Keep it out of the
  // global search for ordinary accounts rather than relying on the UI to hide it.
  if (req.user.role !== 'admin') types = types.filter((type) => type !== 'users');
  if (types.length === 0) {
    return res.status(400).json({ error: 'at least one permitted search type is required' });
  }

  try {
    const rows = await Promise.all(types.map(async (type) => {
      const result = await pool.query(TYPE_QUERIES[type], [q, req.user.userId, req.user.role]);
      return [type, result.rows.map((row) => decorate(type, row))];
    }));

    const grouped = Object.fromEntries(rows);
    const all = rows
      .flatMap(([, values]) => values)
      .sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0))
      .slice(0, 100);

    const counts = Object.fromEntries(rows.map(([type, values]) => [type, values.length]));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ query: q, counts, total: all.length, all, ...grouped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
