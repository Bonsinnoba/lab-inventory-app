import { Router } from 'express';
import { pool } from '../db.js';
import { getProjectAccess } from '../middleware/project-access.js';
import { hasPermission } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';

const router = Router();

async function canAccessProject(projectId, user, requireEdit = false) {
  if (!projectId) return { ok: true };
  const access = await getProjectAccess(projectId, user);
  if (access.access === 'none') return { ok: false, status: 403, error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to this project' } };
  if (requireEdit && access.access === 'view') return { ok: false, status: 403, error: { code: 'PROJECT_READ_ONLY', message: 'You have read-only access to this project' } };
  return { ok: true, access: access.access };
}

router.get('/', hasPermission('notes.view'), async (req, res) => {
  const { item_id, project_id, tag, search } = req.query; const conditions = []; const values = [];
  if (item_id) { values.push(item_id); conditions.push(`n.item_id = $${values.length}`); }
  if (project_id) { values.push(project_id); conditions.push(`n.project_id = $${values.length}`); }
  if (tag) { values.push(tag); conditions.push(`$${values.length} = ANY(n.tags)`); }
  if (search) { values.push(search); conditions.push(`n.search_vector @@ plainto_tsquery('english', $${values.length})`); }
  const idIndex = values.length + 1; values.push(req.user.userId); const roleIndex = values.length + 1; values.push(req.user.role);
  conditions.push(`(n.project_id IS NULL OR $${roleIndex} = 'admin' OR n.project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$${idIndex} OR pm.user_id=$${idIndex}))`);
  try { const result = await pool.query(`SELECT n.* FROM notes n WHERE ${conditions.join(' AND ')} ORDER BY n.updated_at DESC`, values); res.json(result.rows); }
  catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch notes' }); }
});

router.get('/tags/all', hasPermission('notes.view'), async (req, res) => {
  try { const result = await pool.query(`SELECT DISTINCT unnest(n.tags) AS tag FROM notes n WHERE n.tags IS NOT NULL AND array_length(n.tags, 1) > 0 AND (n.project_id IS NULL OR $2 = 'admin' OR n.project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$1 OR pm.user_id=$1)) ORDER BY tag ASC`, [req.user.userId, req.user.role]); res.json(result.rows.map(row => row.tag)); }
  catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch tags' }); }
});

router.get('/:id', hasPermission('notes.view'), async (req, res) => {
  try { const result = await pool.query(`SELECT n.* FROM notes n WHERE n.id = $1 AND (n.project_id IS NULL OR $3 = 'admin' OR n.project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$2 OR pm.user_id=$2))`, [req.params.id, req.user.userId, req.user.role]); if (!result.rowCount) return res.status(404).json({ error: 'Note not found' }); res.json(result.rows[0]); }
  catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to fetch note' }); }
});

router.post('/', hasPermission('notes.create'), async (req, res) => {
  const { title, body, tags, item_id, project_id } = req.body; if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  const access = await canAccessProject(project_id, req.user, true); if (!access.ok) return res.status(access.status).json({ error: access.error }); const tagsValue = Array.isArray(tags) ? tags : [];
  try { const result = await pool.query(`INSERT INTO notes (title, body, tags, item_id, project_id, author_id) VALUES ($1, COALESCE($2, ''), $3, $4, $5, $6) RETURNING *`, [title.trim(), body ?? null, tagsValue, item_id ?? null, project_id ?? null, req.user.userId]); await writeAuditLog({ req, action: 'CREATE', entityType: 'note', entityId: result.rows[0].id, newValue: result.rows[0] }); res.status(201).json(result.rows[0]); }
  catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to create note' }); }
});

router.put('/:id', hasPermission('notes.edit'), async (req, res) => {
  const fields = ['title', 'body', 'tags', 'item_id', 'project_id']; const updates = []; const values = [];
  for (const field of fields) { if (field in req.body) { if (field === 'title' && !String(req.body[field] ?? '').trim()) return res.status(400).json({ error: 'title cannot be empty' }); if (field === 'tags' && !Array.isArray(req.body[field])) return res.status(400).json({ error: 'tags must be an array' }); values.push(field === 'title' ? String(req.body[field]).trim() : req.body[field]); updates.push(`${field} = $${values.length}`); } }
  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' }); const client = await pool.connect();
  try { await client.query('BEGIN'); const current = await client.query('SELECT * FROM notes WHERE id=$1 FOR UPDATE', [req.params.id]); if (!current.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Note not found' }); }
    const existingAccess = await canAccessProject(current.rows[0].project_id, req.user, true); if (!existingAccess.ok) { await client.query('ROLLBACK'); return res.status(existingAccess.status).json({ error: existingAccess.error }); }
    const destinationProject = Object.prototype.hasOwnProperty.call(req.body, 'project_id') ? req.body.project_id : current.rows[0].project_id; const destinationAccess = await canAccessProject(destinationProject, req.user, true); if (!destinationAccess.ok) { await client.query('ROLLBACK'); return res.status(destinationAccess.status).json({ error: destinationAccess.error }); }
    await client.query('INSERT INTO note_revisions (note_id, title, body, tags, edited_by) VALUES ($1,$2,$3,$4,$5)', [req.params.id, current.rows[0].title, current.rows[0].body, current.rows[0].tags || [], req.user.userId]); values.push(req.params.id);
    const result = await client.query(`UPDATE notes SET ${updates.join(', ')}, updated_at=now() WHERE id=$${values.length} RETURNING *`, values); await client.query('COMMIT'); await writeAuditLog({ req, action: 'UPDATE', entityType: 'note', entityId: req.params.id, oldValue: current.rows[0], newValue: result.rows[0] }); res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); console.error(err); res.status(500).json({ error: err.message || 'Failed to update note' }); } finally { client.release(); }
});

router.get('/:id/revisions', hasPermission('notes.view'), async (req, res) => {
  try { const note = await pool.query('SELECT project_id FROM notes WHERE id=$1', [req.params.id]); if (!note.rowCount) return res.status(404).json({ error: 'Note not found' }); const access = await canAccessProject(note.rows[0].project_id, req.user, false); if (!access.ok) return res.status(access.status).json({ error: access.error }); const result = await pool.query(`SELECT r.id, r.title, r.body, r.tags, r.edited_by, r.created_at, u.username AS editor FROM note_revisions r LEFT JOIN users u ON u.id = r.edited_by WHERE r.note_id=$1 ORDER BY r.created_at DESC`, [req.params.id]); res.json(result.rows); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch note revisions' }); }
});

router.post('/:id/revisions/:revisionId/restore', hasPermission('notes.edit'), async (req, res) => {
  const client = await pool.connect(); try { await client.query('BEGIN'); const current = await client.query('SELECT * FROM notes WHERE id=$1 FOR UPDATE', [req.params.id]); if (!current.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Note not found' }); }
    const access = await canAccessProject(current.rows[0].project_id, req.user, true); if (!access.ok) { await client.query('ROLLBACK'); return res.status(access.status).json({ error: access.error }); }
    const revision = await client.query('SELECT title, body, tags FROM note_revisions WHERE id=$1 AND note_id=$2', [req.params.revisionId, req.params.id]); if (!revision.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Revision not found' }); }
    await client.query('INSERT INTO note_revisions(note_id,title,body,tags,edited_by) VALUES($1,$2,$3,$4,$5)', [req.params.id, current.rows[0].title, current.rows[0].body, current.rows[0].tags || [], req.user.userId]); const result = await client.query('UPDATE notes SET title=$1, body=$2, tags=$3, updated_at=now() WHERE id=$4 RETURNING *', [revision.rows[0].title, revision.rows[0].body, revision.rows[0].tags || [], req.params.id]); await client.query('COMMIT'); await writeAuditLog({ req, action: 'UPDATE', entityType: 'note', entityId: req.params.id, newValue: result.rows[0], metadata: { restored_revision_id: req.params.revisionId } }); res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); console.error(err); res.status(500).json({ error: 'Failed to restore note revision' }); } finally { client.release(); }
});

router.delete('/:id', hasPermission('notes.delete'), async (req, res) => {
  try { const current = await pool.query('SELECT * FROM notes WHERE id=$1', [req.params.id]); if (!current.rowCount) return res.status(404).json({ error: 'Note not found' }); const access = await canAccessProject(current.rows[0].project_id, req.user, true); if (!access.ok) return res.status(access.status).json({ error: access.error }); const result = await pool.query('DELETE FROM notes WHERE id=$1 RETURNING id', [req.params.id]); await pool.query("INSERT INTO sync_tombstones(entity_type,entity_id) VALUES('note',$1) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now()", [req.params.id]); await writeAuditLog({ req, action: 'DELETE', entityType: 'note', entityId: req.params.id, oldValue: current.rows[0] }); res.status(204).send(); }
  catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to delete note' }); }
});

export default router;
