import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { pool } from '../src/db.js';

const backendDir = path.resolve(process.cwd());
const storageDir = path.join(backendDir, 'storage');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(backendDir, 'labos-reset-backups');
const backupFile = path.join(backupDir, `labos-data-backup-${stamp}.json`);

async function clearStorage() {
  try {
    const entries = await fs.readdir(storageDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.gitkeep') continue;
      await fs.rm(path.join(storageDir, entry.name), { recursive: true, force: true });
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function getAppTables(client) {
  const result = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> 'schema_migrations'
    ORDER BY tablename
  `);
  return result.rows.map(r => r.tablename);
}

async function snapshot(client, tables) {
  const data = {};
  for (const table of tables) {
    const result = await client.query(`SELECT * FROM "${table.replaceAll('"', '""')}"`);
    data[table] = result.rows;
  }
  return data;
}

async function seed(client) {
  const passwords = {
    admin: 'LabOS-Admin-123!',
    member: 'LabOS-Member-123!',
    observer: 'LabOS-Observer-123!'
  };
  const hashes = {};
  for (const [key, password] of Object.entries(passwords)) hashes[key] = await bcrypt.hash(password, 12);

  const users = {};
  for (const [username, role, key] of [
    ['labadmin', 'admin', 'admin'],
    ['labmember', 'member', 'member'],
    ['labobserver', 'member', 'observer']
  ]) {
    const r = await client.query(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES ($1,$2,$3,TRUE)
      RETURNING id, username, role
    `, [username, hashes[key], role]);
    users[username] = r.rows[0];
  }

  const locations = {};
  for (const name of ['Main Lab', 'Electronics Bench', 'Storage Room']) {
    const r = await client.query('INSERT INTO locations (name) VALUES ($1) RETURNING id,name', [name]);
    locations[name] = r.rows[0];
  }
  const shelf = await client.query('INSERT INTO locations (name,parent_id) VALUES ($1,$2) RETURNING id,name', ['Shelf A', locations['Storage Room'].id]);
  locations['Shelf A'] = shelf.rows[0];

  const projects = {};
  const projectDefs = [
    ['Sensor Platform Prototype', 'active', 5000, 'Test project for Canvas CRUD and collaboration.', 'high'],
    ['Smart Lab Monitor', 'active', 8500, 'Generic engineering workspace for testing project data.', 'normal'],
    ['Completed Test Project', 'completed', 1200, 'Completed sample project for dashboard testing.', 'low']
  ];
  for (const [name,status,budget,description,priority] of projectDefs) {
    const r = await client.query(`INSERT INTO projects (name,status,budget,description,priority,owner_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [name,status,budget,description,priority,users.labadmin.id]);
    projects[name] = r.rows[0];
  }

  await client.query(`INSERT INTO project_members(project_id,user_id,member_role) VALUES
    ($1,$2,'lead'),($1,$3,'member'),($1,$4,'observer'),
    ($5,$2,'lead'),($5,$3,'member'),
    ($6,$2,'lead')`, [
      projects['Sensor Platform Prototype'].id, users.labadmin.id, users.labmember.id, users.labobserver.id,
      projects['Smart Lab Monitor'].id, users.labadmin.id, users.labmember.id,
      projects['Completed Test Project'].id, users.labadmin.id
    ]);

  const items = {};
  const itemDefs = [
    ['Arduino Uno R4', 'equipment', 'Microcontrollers', 'LAB-ARD-001', 12, 10, 'pcs', 32.00, 45.00, locations['Electronics Bench'].id],
    ['220Ω Resistor', 'component', 'Resistors', 'LAB-RES-220', 500, 420, 'pcs', 0.05, 0.08, locations['Shelf A'].id],
    ['Digital Multimeter', 'tool', 'Test Equipment', 'LAB-DMM-001', 6, 5, 'pcs', 48.00, 65.00, locations['Electronics Bench'].id],
    ['Jumper Wire Set', 'material', 'Prototyping', 'LAB-JMP-001', 20, 17, 'sets', 4.50, 7.00, locations['Shelf A'].id],
    ['12V Brushless Fan', 'component', 'Cooling', 'LAB-FAN-012', 15, 11, 'pcs', 8.00, 12.00, locations['Storage Room'].id]
  ];
  for (const d of itemDefs) {
    const r = await client.query(`INSERT INTO items(name,type,category,sku,initial_quantity,current_quantity,unit,unit_cost,replacement_cost,location_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, d);
    items[d[0]] = r.rows[0];
  }

  await client.query(`INSERT INTO project_items(project_id,item_id,allocated_quantity,notes,added_by) VALUES
    ($1,$2,2,'Prototype controllers',$3),
    ($1,$4,100,'Prototype resistors',$3),
    ($5,$6,1,'Bench measurement',$3),
    ($5,$7,3,'Prototype wiring',$3)`, [
      projects['Sensor Platform Prototype'].id, items['Arduino Uno R4'].id, users.labmember.id,
      items['220Ω Resistor'].id, projects['Smart Lab Monitor'].id,
      items['Digital Multimeter'].id, items['Jumper Wire Set'].id
    ]);

  await client.query(`INSERT INTO project_tasks(project_id,title,description,status,priority,assignee_id,created_by) VALUES
    ($1,'Validate Canvas block movement','Drag and verify persisted coordinates.','in_progress','high',$2,$3),
    ($1,'Test connector deletion','Create and delete connectors repeatedly.','todo','normal',$2,$3),
    ($4,'Assemble sensor prototype','Prepare the generic hardware test rig.','todo','normal',$2,$3),
    ($4,'Record baseline readings','Capture initial measurements.','done','normal',$2,$3)`, [
      projects['Sensor Platform Prototype'].id, users.labmember.id, users.labadmin.id,
      projects['Smart Lab Monitor'].id
    ]);

  await client.query(`INSERT INTO project_experiments(project_id,title,status,hypothesis,procedure,observations,result,conclusion,performed_by) VALUES
    ($1,'Canvas persistence test','running','Saved geometry should survive refresh.','Move, resize, refresh, and compare values.','Initial test data loaded.','','', $2),
    ($3,'Sensor baseline','planned','The generic sensor setup should produce repeatable readings.','Connect sensor and record five readings.','','','','',$2)`, [
      projects['Sensor Platform Prototype'].id, users.labmember.id,
      projects['Smart Lab Monitor'].id
    ]);

  const blocks = {};
  const blockDefs = [
    ['System Overview', 'The Sensor Platform Prototype uses this Canvas for testing block creation, editing, movement, resizing, saving, and deletion.', 80, 80, 360, 220],
    ['Hardware', 'Arduino Uno R4\nDigital multimeter\nJumper wire set\n220Ω resistors', 520, 100, 300, 240],
    ['Test Notes', 'Try dragging this block at different browser zoom levels.\nThen refresh and verify persistence.', 180, 390, 390, 220],
    ['Expected Result', 'Canvas operations should complete without permission, object-object, or database coordinate errors.', 650, 410, 360, 220]
  ];
  for (const [title,text,x,y,width,height] of blockDefs) {
    const r = await client.query(`INSERT INTO project_blocks(project_id,block_type,text_content,x,y,width,height) VALUES($1,'text',$2,$3,$4,$5,$6) RETURNING *`, [projects['Sensor Platform Prototype'].id,text,x,y,width,height]);
    blocks[title] = r.rows[0];
  }
  await client.query(`INSERT INTO project_connectors(project_id,source_block_id,target_block_id,label) VALUES
    ($1,$2,$3,'feeds'),($1,$3,$4,'documents'),($1,$4,$5,'verifies')`, [
      projects['Sensor Platform Prototype'].id,
      blocks['System Overview'].id, blocks['Hardware'].id, blocks['Test Notes'].id, blocks['Expected Result'].id
    ]);

  await client.query(`INSERT INTO notes(title,body,tags,project_id,author_id) VALUES
    ($1,$2,$3,$4,$5),($6,$7,$8,$9,$5)`, [
      'Canvas Test Checklist', 'Create, edit, save, drag, resize, connect, disconnect, delete, then refresh.', ['canvas','testing','crud'], projects['Sensor Platform Prototype'].id, users.labadmin.id,
      'Lab Setup Notes', 'Generic seed dataset for validating LabOS pages without production data.', ['setup','testing'], projects['Smart Lab Monitor'].id
    ]);

  const budget = await client.query(`INSERT INTO budget_periods(label,total_budget,start_date,end_date,notes) VALUES('Test FY 2026',15000,'2026-01-01','2026-12-31','Generic seeded budget period') RETURNING id`);
  const funding = await client.query(`INSERT INTO funding_sources(name,source_type,contact_info,notes) VALUES('Generic Test Grant','grant_body','test@example.invalid','Seed data only') RETURNING id`);
  await client.query(`INSERT INTO transactions(type,direction,amount,date,vendor,notes,project_id,logged_by,funding_source_id,budget_period_id) VALUES
    ('purchase','expense',320,'2026-08-10','Generic Electronics Supplier','Seed purchase', $1,$2,$3,$4),
    ('grant','income',2500,'2026-08-01','Generic Test Grant','Seed income', $1,$2,$3,$4)`, [projects['Sensor Platform Prototype'].id, users.labadmin.id, funding.rows[0].id, budget.rows[0].id]);

  await client.query(`INSERT INTO item_movements(item_id,movement_type,quantity,quantity_before,quantity_after,to_location_id,reason,performed_by) VALUES($1,'receive',10,0,10,$2,'Initial seed stock',$3)`, [items['Arduino Uno R4'].id, locations['Electronics Bench'].id, users.labadmin.id]);
  await client.query(`INSERT INTO maintenance_records(item_id,maintenance_type,status,scheduled_date,notes,performed_by) VALUES($1,'inspection','scheduled','2026-09-15','Generic scheduled inspection',$2)`, [items['Digital Multimeter'].id, users.labmember.id]);

  await client.query(`INSERT INTO resources(name,kind,file_type,url,category,description,tags,project_id,uploaded_by) VALUES
    ('LabOS Documentation','link','other','https://example.invalid/labos-docs','documentation','Placeholder resource for testing links.','{testing,documentation}',$1,$2)`, [projects['Sensor Platform Prototype'].id, users.labadmin.id]);

  await client.query(`INSERT INTO project_comments(project_id,author_id,body) VALUES($1,$2,'Generic seeded comment: Canvas CRUD should be tested from this project.')`, [projects['Sensor Platform Prototype'].id, users.labmember.id]);

  return { users, projects, items, blocks };
}

async function main() {
  console.log('LabOS test-data reset starting...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tables = await getAppTables(client);
    const snapshotData = await snapshot(client, tables);
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(backupFile, JSON.stringify({ created_at: new Date().toISOString(), tables: snapshotData }, null, 2), 'utf8');
    console.log(`Backup written: ${backupFile}`);

    if (tables.length) {
      const quoted = tables.map(t => `"${t.replaceAll('"', '""')}"`).join(', ');
      await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    }
    await clearStorage();
    const seeded = await seed(client);
    await client.query('COMMIT');

    console.log('\nRESET COMPLETE');
    console.log('All application data was cleared and replaced with generic test data.');
    console.log('\nTest accounts:');
    console.log('  labadmin    / LabOS-Admin-123!');
    console.log('  labmember   / LabOS-Member-123!');
    console.log('  labobserver / LabOS-Observer-123!');
    console.log('\nPrimary Canvas project: Sensor Platform Prototype');
    console.log(`Blocks: ${Object.keys(seeded.blocks).length}`);
    console.log('Connectors: 3');
    console.log(`Backup: ${backupFile}`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('\nRESET FAILED:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
