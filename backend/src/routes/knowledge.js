import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

const projectVisibility = (alias) => `(${alias}.project_id IS NULL OR $2 = 'admin' OR ${alias}.project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$1 OR pm.user_id=$1))`;

router.get('/overview', async (req, res) => {
  try {
    const visibilityNotes = projectVisibility('n');
    const visibilityResources = projectVisibility('r');
    const [notes, resources, categories, recentNotes, recentResources] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM notes n WHERE ${visibilityNotes}`, [req.user.userId, req.user.role]),
      pool.query(`SELECT COUNT(*)::int AS count FROM resources r WHERE ${visibilityResources}`, [req.user.userId, req.user.role]),
      pool.query(`SELECT r.category, COUNT(*)::int AS count FROM resources r WHERE ${visibilityResources} GROUP BY r.category ORDER BY count DESC, r.category`, [req.user.userId, req.user.role]),
      pool.query(`SELECT n.id, n.title, n.tags, n.updated_at, n.author_id FROM notes n WHERE ${visibilityNotes} ORDER BY n.updated_at DESC LIMIT 8`, [req.user.userId, req.user.role]),
      pool.query(`SELECT r.id, r.name, r.kind, r.file_type, r.category, r.tags, r.updated_at FROM resources r WHERE r.parent_resource_id IS NULL AND ${visibilityResources} ORDER BY r.updated_at DESC LIMIT 8`, [req.user.userId, req.user.role]),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      counts: { notes: notes.rows[0].count, resources: resources.rows[0].count },
      categories: categories.rows,
      recent_notes: recentNotes.rows,
      recent_resources: recentResources.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load knowledge overview' });
  }
});

router.get('/tags', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT tag, SUM(note_count)::int AS note_count, SUM(resource_count)::int AS resource_count
      FROM (
        SELECT unnest(n.tags) AS tag, 1 AS note_count, 0 AS resource_count FROM notes n WHERE ${projectVisibility('n')}
        UNION ALL
        SELECT unnest(r.tags) AS tag, 0 AS note_count, 1 AS resource_count FROM resources r WHERE ${projectVisibility('r')}
      ) x GROUP BY tag ORDER BY tag
    `, [req.user.userId, req.user.role]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load knowledge tags' });
  }
});

export default router;
