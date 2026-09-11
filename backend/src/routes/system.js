import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/daily-preferences', async (req, res) => {
  try {
    const result = await pool.query(`
      INSERT INTO user_daily_use_preferences (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO UPDATE SET user_id=EXCLUDED.user_id
      RETURNING notifications_enabled, auto_pause_music, music_volume, updated_at
    `, [req.user.userId]);
    res.setHeader('Cache-Control', 'no-store');
    res.json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to load daily-use preferences' }); }
});

router.patch('/daily-preferences', async (req, res) => {
  try {
    const current = await pool.query('SELECT notifications_enabled, auto_pause_music, music_volume FROM user_daily_use_preferences WHERE user_id=$1', [req.user.userId]);
    const base = current.rows[0] || { notifications_enabled: true, auto_pause_music: true, music_volume: 0.65 };
    const notifications_enabled = req.body.notifications_enabled === undefined ? base.notifications_enabled : Boolean(req.body.notifications_enabled);
    const auto_pause_music = req.body.auto_pause_music === undefined ? base.auto_pause_music : Boolean(req.body.auto_pause_music);
    const music_volume = req.body.music_volume === undefined ? Number(base.music_volume) : Number(req.body.music_volume);
    if (!Number.isFinite(music_volume) || music_volume < 0 || music_volume > 1) return res.status(400).json({ error: 'music_volume must be between 0 and 1' });
    const result = await pool.query(`
      INSERT INTO user_daily_use_preferences (user_id, notifications_enabled, auto_pause_music, music_volume)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (user_id) DO UPDATE SET notifications_enabled=EXCLUDED.notifications_enabled, auto_pause_music=EXCLUDED.auto_pause_music, music_volume=EXCLUDED.music_volume
      RETURNING notifications_enabled, auto_pause_music, music_volume, updated_at
    `, [req.user.userId, notifications_enabled, auto_pause_music, music_volume]);
    res.json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to save daily-use preferences' }); }
});

router.get('/export', requireRole('admin'), async (_req, res) => {
  try {
    const tables = [
      'users','projects','project_members','project_tasks','experiments','items','item_movements','maintenance_records',
      'notes','resources','project_bom_items','lab_findings','lab_results','knowledge_relationships','engineering_calculations',
      'engineering_tests','project_resource_requirements','suppliers','locations','transactions','notifications'
    ];
    const snapshot = { exported_at: new Date().toISOString(), format: 'labos-json-v1', tables: {} };
    for (const table of tables) {
      try { const result = await pool.query(`SELECT * FROM ${table}`); snapshot.tables[table] = result.rows; }
      catch { snapshot.tables[table] = []; }
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="labos-export-${new Date().toISOString().slice(0,10)}.json"`);
    res.json(snapshot);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to export LabOS data' }); }
});

router.get('/health-details', async (_req, res) => {
  const checks = { database: false, migrations: false, storage: false };
  try { await pool.query('SELECT 1'); checks.database = true; } catch {}
  try { await pool.query("SELECT to_regclass('public.schema_migrations') AS table_name"); checks.migrations = true; } catch {}
  try { const r = await pool.query("SELECT to_regclass('public.notifications') AS table_name"); checks.storage = Boolean(r.rows[0]?.table_name); } catch {}
  const healthy = Object.values(checks).every(Boolean);
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() });
});

export default router;
