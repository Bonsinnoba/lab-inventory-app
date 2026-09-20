import pg from 'pg';
import { randomUUID } from 'node:crypto';

const { Client } = pg;
const connectionConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };

if (!connectionConfig.connectionString && !connectionConfig.host) {
  console.error('DISPOSABLE RESOURCE DEDUP TEST NOT RUN: DATABASE_URL or PGHOST/PGDATABASE/PGUSER configuration is required.');
  process.exit(2);
}

const key = `labos-disposable-dedup-${randomUUID()}`;
const resourceUrl = `https://example.invalid/${key}/`;
const normalizedUrl = resourceUrl.trim().replace(/\/+$/, '');
const lockKey = ['link', normalizedUrl.toLowerCase(), '', '', '', ''].join('|');
const clients = [new Client(connectionConfig), new Client(connectionConfig)];

async function lock(client) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lockKey]);
}
async function find(client) {
  return client.query("SELECT id FROM resources WHERE kind='link' AND lower(btrim(url))=lower($1) AND item_id IS NOT DISTINCT FROM $2 AND project_id IS NOT DISTINCT FROM $3 AND note_id IS NOT DISTINCT FROM $4 AND parent_resource_id IS NOT DISTINCT FROM $5 LIMIT 1", [normalizedUrl, null, null, null, null]);
}
async function cleanup() {
  const c = new Client(connectionConfig);
  await c.connect();
  try { await c.query("DELETE FROM resources WHERE kind='link' AND url=$1", [resourceUrl]); }
  finally { await c.end(); }
}

try {
  await Promise.all(clients.map(c => c.connect()));

  const indexCheck = await clients[0].query("SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_resources_link_unique'");
  if (indexCheck.rowCount !== 1) throw new Error('Expected idx_resources_link_unique to exist before running the disposable dedup test');

  // Verify the database constraint itself treats NULL parent columns as part
  // of the logical key. This catches a plain UNIQUE index, which would allow
  // duplicate item/project/note/folder scopes because NULLs compare distinct.
  await clients[0].query('BEGIN');
  await clients[0].query("INSERT INTO resources (name,kind,file_type,url) VALUES ($1,'link','other',$2)", [key, normalizedUrl]);
  let constraintRejected = false;
  try {
    await clients[0].query("INSERT INTO resources (name,kind,file_type,url) VALUES ($1,'link','other',$2)", [`${key}-duplicate`, normalizedUrl]);
  } catch (err) {
    constraintRejected = err?.code === '23505';
  }
  if (!constraintRejected) throw new Error('Database uniqueness constraint did not reject a logical duplicate with NULL parent columns');
  await clients[0].query('ROLLBACK');

  // Verify the advisory lock closes the check-then-insert race used by the API.
  await clients[0].query('BEGIN');
  await lock(clients[0]);
  const first = await find(clients[0]);
  if (first.rowCount) throw new Error('Random disposable URL unexpectedly already exists');
  await clients[0].query("INSERT INTO resources (name,kind,file_type,url) VALUES ($1,'link','other',$2)", [key, normalizedUrl]);

  await clients[1].query('BEGIN');
  const secondLock = lock(clients[1]);
  await new Promise(r => setTimeout(r, 100));
  await clients[0].query('COMMIT');
  await secondLock;
  const second = await find(clients[1]);
  if (second.rowCount !== 1) throw new Error(`Expected second transaction to observe exactly one committed logical link; found ${second.rowCount}`);
  await clients[1].query('ROLLBACK');

  console.log('PASS: database NULL-safe uniqueness constraint');
  console.log('PASS: disposable concurrent resource-link deduplication');
} finally {
  for (const c of clients) await c.end().catch(() => {});
  await cleanup().catch(err => console.error('WARNING: disposable cleanup failed:', err.message));
}
