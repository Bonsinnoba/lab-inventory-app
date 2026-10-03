-- Add-only, repeatable seed for the existing LabOS PostgreSQL database.
-- All IDs are deterministic and all user-facing records are marked LABOS-SEED-20261003.
-- Run with psql -v ON_ERROR_STOP=1. Do not run against an unrelated database.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'balika' AND is_active) THEN
    RAISE EXCEPTION 'Active balika test account is required for this seed';
  END IF;
END $$;

INSERT INTO items
  (id, name, type, category, sku, initial_quantity, current_quantity, unit,
   status, unit_cost, supplier, storage_location, acquisition_method, acquisition_source,
   condition_notes)
SELECT
  md5('LABOS-SEED-20261003:item:' || n)::uuid,
  (ARRAY['Digital multimeter','Oscilloscope','Micropipette','Reagent bottle',
         'Soldering iron','Sensor module','Safety goggles','Calibration weight'])[((n-1)%8)+1]
    || ' [LABOS-SEED-20261003 #' || lpad(n::text, 3, '0') || ']',
  (ARRAY['tool','instrument','equipment','chemical','tool','component','consumable','equipment'])[((n-1)%8)+1],
  (ARRAY['Electronics','Measurement','Biology','Chemistry','Electronics','Prototyping','Safety','Measurement'])[((n-1)%8)+1],
  'LABOS-DEMO-20261003-' || lpad(n::text, 3, '0'),
  10 + (n%8)*5,
  CASE WHEN n%9 = 0 THEN 2 WHEN n%11 = 0 THEN 4 ELSE 10 + (n%8)*5 END,
  'each',
  CASE WHEN n%9 = 0 THEN 'low_stock'
       WHEN n%11 = 0 THEN 'needs_repair'
       WHEN n%7 = 0 THEN 'in_use'
       ELSE 'available' END,
  (n%8 + 1)*18.50,
  'LabOS demo supplier',
  'Demo shelf ' || ((n-1)%6 + 1),
  'purchased',
  'Synthetic test data',
  'Test record; safe to distinguish from laboratory-owned inventory.'
FROM generate_series(1,48) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO item_movements
  (id, item_id, movement_type, quantity, quantity_before, quantity_after,
   to_storage_location, reason, reference)
SELECT
  md5('LABOS-SEED-20261003:movement:' || n)::uuid,
  i.id, 'receive', i.current_quantity, 0, i.current_quantity,
  i.storage_location, 'Initial synthetic stock receipt',
  'LABOS-SEED-20261003'
FROM generate_series(1,48) AS n
JOIN items i ON i.id = md5('LABOS-SEED-20261003:item:' || n)::uuid
ON CONFLICT (id) DO NOTHING;

INSERT INTO maintenance_records
  (id, item_id, maintenance_type, status, scheduled_date, completed_date,
   performed_by, notes, cost)
SELECT
  md5('LABOS-SEED-20261003:maintenance:' || n)::uuid,
  md5('LABOS-SEED-20261003:item:' || n)::uuid,
  (ARRAY['inspection','calibration','cleaning','routine'])[((n-1)%4)+1],
  CASE WHEN n%4 = 0 THEN 'completed' WHEN n%5 = 0 THEN 'in_progress' ELSE 'scheduled' END,
  current_date + (n-8),
  CASE WHEN n%4 = 0 THEN current_date - 2 ELSE NULL END,
  (SELECT id FROM users WHERE username = 'balika'),
  'LABOS-SEED-20261003 maintenance test record',
  CASE WHEN n%4 = 0 THEN n*2.5 ELSE NULL END
FROM generate_series(1,16) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects
  (id, name, status, budget, description, priority, start_date, due_date,
   owner_id, review_status, visibility)
SELECT
  md5('LABOS-SEED-20261003:project:' || n)::uuid,
  (ARRAY['Sensor calibration','Water quality pilot','Microscopy workflow',
         'Field instrument build','Reagent tracking','Bench automation'])[n]
    || ' [LABOS-SEED-20261003]',
  (ARRAY['active','active','planning','on_hold','active','completed'])[n],
  1000 + n*750,
  'Synthetic project for offline-first, permissions, and synchronization testing.',
  (ARRAY['high','normal','normal','low','high','normal'])[n],
  current_date - n*10,
  current_date + n*15,
  (SELECT id FROM users WHERE username = 'balika'),
  'draft', 'lab'
FROM generate_series(1,6) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_members (project_id, user_id, member_role)
SELECT md5('LABOS-SEED-20261003:project:' || n)::uuid,
       (SELECT id FROM users WHERE username = 'balika'), 'lead'
FROM generate_series(1,6) AS n
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO project_members (project_id, user_id, member_role)
SELECT md5('LABOS-SEED-20261003:project:' || n)::uuid,
       (SELECT id FROM users WHERE username = 'testuser'),
       CASE WHEN n = 6 THEN 'observer' ELSE 'member' END
FROM (VALUES (2),(4),(6)) AS projects(n)
WHERE EXISTS (SELECT 1 FROM users WHERE username = 'testuser' AND is_active)
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO project_tasks
  (id, project_id, title, description, status, priority, assignee_id,
   due_date, completed_at, created_by)
SELECT
  md5('LABOS-SEED-20261003:task:' || n)::uuid,
  md5('LABOS-SEED-20261003:project:' || (((n-1)%6)+1))::uuid,
  'Demo task ' || lpad(n::text, 2, '0') || ' [LABOS-SEED-20261003]',
  'Synthetic task for sorting, due-date, and sync testing.',
  CASE WHEN n%7 = 0 THEN 'done' WHEN n%5 = 0 THEN 'blocked'
       WHEN n%3 = 0 THEN 'in_progress' ELSE 'todo' END,
  (ARRAY['normal','high','low','normal','critical'])[((n-1)%5)+1],
  (SELECT id FROM users WHERE username = 'balika'),
  current_date + (n-10),
  CASE WHEN n%7 = 0 THEN now() - interval '1 day' ELSE NULL END,
  (SELECT id FROM users WHERE username = 'balika')
FROM generate_series(1,30) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_experiments
  (id, project_id, title, status, hypothesis, procedure, observations,
   result, conclusion, performed_by, started_at, completed_at)
SELECT
  md5('LABOS-SEED-20261003:experiment:' || n)::uuid,
  md5('LABOS-SEED-20261003:project:' || (((n-1)%6)+1))::uuid,
  'Demo experiment ' || lpad(n::text, 2, '0') || ' [LABOS-SEED-20261003]',
  (ARRAY['planned','running','completed'])[(((n-1)%3)+1)],
  'A repeatable calibration step reduces measurement drift.',
  'Record a baseline, repeat the measurement, and compare results.',
  CASE WHEN n%3 = 1 THEN '' ELSE 'Synthetic observation ' || n END,
  CASE WHEN n%3 = 0 THEN 'Synthetic run completed.' ELSE '' END,
  CASE WHEN n%3 = 0 THEN 'Test-only conclusion.' ELSE '' END,
  (SELECT id FROM users WHERE username = 'balika'),
  CASE WHEN n%3 <> 1 THEN now() - interval '2 days' ELSE NULL END,
  CASE WHEN n%3 = 0 THEN now() - interval '1 day' ELSE NULL END
FROM generate_series(1,12) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_resource_requirements
  (id, project_id, name, requirement_type, quantity, unit, required_by,
   preferred_item_id, notes, status, created_by)
SELECT
  md5('LABOS-SEED-20261003:requirement:' || n)::uuid,
  md5('LABOS-SEED-20261003:project:' || (((n-1)%6)+1))::uuid,
  'Demo requirement ' || lpad(n::text, 2, '0') || ' [LABOS-SEED-20261003]',
  (ARRAY['component','equipment','tool','material','consumable','resource'])[((n-1)%6)+1],
  1 + n%5, 'each', current_date + n*3,
  md5('LABOS-SEED-20261003:item:' || n)::uuid,
  'Synthetic requirement for local-write, retry, and delete testing.',
  (ARRAY['required','available','ordered'])[((n-1)%3)+1],
  (SELECT id FROM users WHERE username = 'balika')
FROM generate_series(1,18) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO notes
  (id, title, body, tags, project_id, author_id, visibility)
SELECT
  md5('LABOS-SEED-20261003:note:' || n)::uuid,
  'Demo lab note ' || lpad(n::text, 2, '0') || ' [LABOS-SEED-20261003]',
  'Synthetic observation for local save, refresh, duplicate, delete, and sync testing. Note ' || n || '.',
  ARRAY['labos-seed-20261003','demo'],
  CASE WHEN n <= 12 THEN md5('LABOS-SEED-20261003:project:' || (((n-1)%6)+1))::uuid ELSE NULL END,
  (SELECT id FROM users WHERE username = 'balika'),
  'lab'
FROM generate_series(1,18) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO resources
  (id, name, kind, file_type, url, category, description, tags,
   project_id, uploaded_by, visibility)
SELECT
  md5('LABOS-SEED-20261003:resource:' || n)::uuid,
  'Demo reference link ' || lpad(n::text, 2, '0') || ' [LABOS-SEED-20261003]',
  'link', 'other',
  'https://example.com/labos-seed-20261003/reference-' || n,
  'demo',
  'Placeholder link for resource listing and sync tests; not a downloadable video.',
  ARRAY['labos-seed-20261003','placeholder'],
  CASE WHEN n <= 6 THEN md5('LABOS-SEED-20261003:project:' || n)::uuid ELSE NULL END,
  (SELECT id FROM users WHERE username = 'balika'),
  'lab'
FROM generate_series(1,9) AS n
ON CONFLICT (id) DO NOTHING;

COMMIT;
