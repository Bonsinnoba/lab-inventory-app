import pg from 'pg';
import jwt from 'jsonwebtoken';
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
const baseUrl = (process.env.LABOS_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

if (!connectionConfig.connectionString && !connectionConfig.host) {
  console.error('DISPOSABLE SYNC RUNTIME TEST NOT RUN: DATABASE_URL or PGHOST/PGDATABASE/PGUSER configuration is required.');
  process.exit(2);
}
if (!process.env.JWT_SECRET) {
  console.error('DISPOSABLE SYNC RUNTIME TEST NOT RUN: JWT_SECRET is required.');
  process.exit(2);
}

const key = `labos-disposable-sync-${randomUUID()}`;
const resourceId = randomUUID();
const createChangeId = randomUUID();
const deleteChangeId = randomUUID();
const invalidChangeId = randomUUID();
const deviceId = `disposable-sync-${randomUUID()}`;
const resourceUrl = `https://example.invalid/${key}/`;
const normalizedUrl = resourceUrl.replace(/\/+$/, '');
const client = new Client(connectionConfig);

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

try {
  await client.connect();
  const admin = await client.query(
    'SELECT id,username,role FROM users WHERE is_active=true AND role=\'admin\' ORDER BY created_at LIMIT 1'
  );
  if (!admin.rowCount) {
    console.error('DISPOSABLE SYNC RUNTIME TEST NOT RUN: no active admin user exists in the disposable database.');
    process.exit(2);
  }

  const user = admin.rows[0];
  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  const createPayload = {
    resource: {
      id: resourceId,
      name: key,
      kind: 'link',
      file_type: 'other',
      url: resourceUrl,
      category: 'disposable-sync-test',
    },
  };
  const createChange = {
    change_id: createChangeId,
    entity_type: 'resource',
    entity_id: resourceId,
    operation: 'create',
    payload: createPayload,
  };

  const create = await request('/api/sync/push', {
    method: 'POST',
    token,
    body: JSON.stringify({ device_id: deviceId, changes: [createChange] }),
  });
  if (!create.response.ok || create.body.results?.[0]?.status !== 'synced') {
    throw new Error(`resource create push failed: HTTP ${create.response.status} ${JSON.stringify(create.body)}`);
  }
  if (create.body.results[0].result?.id !== resourceId) throw new Error('resource create push returned the wrong resource ID');

  const stored = await client.query('SELECT id,url,kind FROM resources WHERE id=$1', [resourceId]);
  if (stored.rowCount !== 1 || stored.rows[0].url !== normalizedUrl) {
    throw new Error('resource create push did not persist the canonical URL');
  }

  const replay = await request('/api/sync/push', {
    method: 'POST',
    token,
    body: JSON.stringify({ device_id: deviceId, changes: [createChange] }),
  });
  if (!replay.response.ok || replay.body.results?.[0]?.status !== 'synced' ||
      replay.body.results[0].result?.id !== resourceId) {
    throw new Error(`idempotent replay failed: HTTP ${replay.response.status} ${JSON.stringify(replay.body)}`);
  }

  const count = await client.query('SELECT count(*)::int AS count FROM resources WHERE id=$1', [resourceId]);
  if (count.rows[0].count !== 1) throw new Error(`idempotent replay created a duplicate resource: count=${count.rows[0].count}`);

  const mismatch = await request('/api/sync/push', {
    method: 'POST',
    token,
    body: JSON.stringify({
      device_id: deviceId,
      changes: [{
        ...createChange,
        payload: { resource: { ...createPayload.resource, name: `${key}-different` } },
      }],
    }),
  });
  if (mismatch.response.status !== 200 ||
      mismatch.body.results?.[0]?.status !== 'rejected' ||
      mismatch.body.results?.[0]?.error?.code !== 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
    throw new Error(`idempotency payload mismatch was not rejected: HTTP ${mismatch.response.status} ${JSON.stringify(mismatch.body)}`);
  }

  const pullBeforeDelete = await request('/api/sync/resources/pull', { token });
  if (!pullBeforeDelete.response.ok ||
      !pullBeforeDelete.body.resources?.some(row => row.id === resourceId)) {
    throw new Error(`resource pull did not return the pushed resource: HTTP ${pullBeforeDelete.response.status}`);
  }

  const invalidId = randomUUID();
  const invalid = await request('/api/sync/push', {
    method: 'POST',
    token,
    body: JSON.stringify({
      device_id: deviceId,
      changes: [{
        change_id: invalidChangeId,
        entity_type: 'resource',
        entity_id: invalidId,
        operation: 'create',
        payload: { resource: { id: invalidId, name: key, kind: 'unsupported' } },
      }],
    }),
  });
  if (invalid.response.status !== 200 ||
      invalid.body.results?.[0]?.status !== 'rejected' ||
      invalid.body.results?.[0]?.error?.code !== 'UNSUPPORTED_RESOURCE_CREATE') {
    throw new Error(`invalid resource was not rejected transactionally: HTTP ${invalid.response.status} ${JSON.stringify(invalid.body)}`);
  }
  const invalidStored = await client.query('SELECT 1 FROM resources WHERE id=$1', [invalidId]);
  if (invalidStored.rowCount !== 0) throw new Error('rejected resource mutation was persisted despite rollback');

  const deletion = await request('/api/sync/push', {
    method: 'POST',
    token,
    body: JSON.stringify({
      device_id: deviceId,
      changes: [{
        change_id: deleteChangeId,
        entity_type: 'resource',
        entity_id: resourceId,
        operation: 'delete',
        payload: { resource: { id: resourceId } },
      }],
    }),
  });
  if (!deletion.response.ok || deletion.body.results?.[0]?.status !== 'synced' ||
      deletion.body.results[0].result?.deleted !== true) {
    throw new Error(`resource delete push failed: HTTP ${deletion.response.status} ${JSON.stringify(deletion.body)}`);
  }

  const afterDelete = await client.query('SELECT 1 FROM resources WHERE id=$1', [resourceId]);
  if (afterDelete.rowCount !== 0) throw new Error('resource delete push left the resource row behind');

  const tombstone = await client.query(
    "SELECT entity_id,project_id,item_id,note_id FROM sync_tombstones WHERE entity_type='resource' AND entity_id=$1",
    [resourceId]
  );
  if (tombstone.rowCount !== 1) throw new Error('resource delete push did not create exactly one resource tombstone');

  const pullAfterDelete = await request('/api/sync/resources/pull', { token });
  if (!pullAfterDelete.response.ok ||
      !pullAfterDelete.body.deleted_resource_ids?.includes(resourceId)) {
    throw new Error(`resource pull did not return the deletion tombstone: HTTP ${pullAfterDelete.response.status} ${JSON.stringify(pullAfterDelete.body)}`);
  }

  console.log('PASS: disposable sync push creates and persists a resource');
  console.log('PASS: sync idempotency replay returns the original result without duplication');
  console.log('PASS: sync rejects idempotency payload mismatch');
  console.log('PASS: resource pull returns the pushed resource');
  console.log('PASS: rejected resource mutation rolls back without creating a row');
  console.log('PASS: resource deletion creates a PostgreSQL tombstone');
  console.log('PASS: resource pull returns the deletion tombstone');
} finally {
  await client.query("DELETE FROM sync_tombstones WHERE entity_type='resource' AND entity_id=$1", [resourceId]).catch(() => {});
  await client.query('DELETE FROM sync_idempotency WHERE change_id IN ($1,$2,$3)', [createChangeId, deleteChangeId, invalidChangeId]).catch(() => {});
  await client.query('DELETE FROM resources WHERE id=$1', [resourceId]).catch(() => {});
  await client.end().catch(() => {});
}
