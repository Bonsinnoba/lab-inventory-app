import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { readDailyPreferences, patchDailyPreferences } from '../daily-preferences.js';

const router = Router();

router.get('/daily-preferences',async(req,res,next)=>{
  try {res.setHeader('Cache-Control','no-store');res.json(await readDailyPreferences(pool,req.user.userId));}catch(error){next(error);}
});
router.patch('/daily-preferences',async(req,res,next)=>{
  try {res.json(await patchDailyPreferences(pool,req));}
  catch(error){if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});next(error);}
});

router.get('/export', requireRole('admin'), async (_req, res) => {
  try {
    const tables = [
      'users','projects','project_members','project_tasks','project_experiments','items','item_movements','maintenance_records',
      'notes','resources','project_bom_items','lab_findings','lab_results','knowledge_relationships','engineering_calculations',
      'engineering_tests','project_resource_requirements','suppliers','locations','transactions','notifications','user_daily_use_preferences'
    ];
    const snapshot = { exported_at: new Date().toISOString(), format: 'labos-json-v1', tables: {} };
    for (const table of tables) {
      const columns = table === 'users' ? 'id,username,role,is_active,created_at' : '*';
      const result = await pool.query(`SELECT ${columns} FROM ${table}`);
      snapshot.tables[table] = result.rows;
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
