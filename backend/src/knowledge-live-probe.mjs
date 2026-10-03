// Run only against the configured, already-running PostgreSQL-backed API.
// A uniquely named finding and its grant are removed in finally.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';

if (process.env.LABOS_LIVE_KNOWLEDGE_PROBE !== '1') {
  throw new Error('Set LABOS_LIVE_KNOWLEDGE_PROBE=1 to run against the configured database');
}

const marker = `LABOS-KNOWLEDGE-PROBE-${randomUUID()}`;
let findingId;
let noteId;
let resourceId;
let relationshipId;

async function request(userId, method, path, body) {
  const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '5m' });
  const response = await fetch(`http://127.0.0.1:4000/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

try {
  const users = await pool.query("SELECT id,username,role FROM users WHERE username IN ('balika','testuser') AND is_active=true");
  const admin = users.rows.find(row => row.username === 'balika' && row.role === 'admin');
  const member = users.rows.find(row => row.username === 'testuser' && row.role !== 'admin');
  assert.ok(admin, 'active balika administrator must exist');
  assert.ok(member, 'active non-administrator testuser must exist');

  const created = await request(admin.id, 'POST', '/knowledge/findings', { title: marker, body: marker });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  findingId = created.body.id;
  await pool.query("UPDATE lab_findings SET visibility='restricted' WHERE id=$1 AND title=$2", [findingId, marker]);

  const note = await request(admin.id, 'POST', '/notes', { title: marker, body: marker, tags: [marker], visibility: 'restricted' });
  assert.equal(note.status, 201, JSON.stringify(note.body));
  noteId = note.body.id;
  const resource = await request(admin.id, 'POST', '/resources/link', { url: `https://example.invalid/${marker}`, name: marker, tags: [marker] });
  assert.equal(resource.status, 201, JSON.stringify(resource.body));
  resourceId = resource.body.id;
  await pool.query("UPDATE resources SET visibility='restricted' WHERE id=$1 AND name=$2", [resourceId, marker]);
  const relationship = await request(admin.id, 'POST', '/knowledge/relationships', { source_type:'finding', source_id:findingId, target_type:'note', target_id:noteId, relationship:'supports' });
  assert.equal(relationship.status, 201, JSON.stringify(relationship.body));
  relationshipId = relationship.body.id;

  async function visibleToMember() {
    const [list, search, pull, overview, tags, relationships] = await Promise.all([
      request(member.id, 'GET', `/knowledge/findings?q=${encodeURIComponent(marker)}`),
      request(member.id, 'GET', `/knowledge/search?q=${encodeURIComponent(marker)}`),
      request(member.id, 'GET', '/knowledge/sync/pull'),
      request(member.id, 'GET', '/knowledge/overview'),
      request(member.id, 'GET', '/knowledge/tags'),
      request(member.id, 'GET', '/knowledge/relationships'),
    ]);
    for (const result of [list, search, pull, overview, tags, relationships]) assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(pull.body.visible_finding_ids.includes(findingId), pull.body.findings.some(row => row.id === findingId));
    assert.deepEqual(pull.body.visible_result_ids, pull.body.results.map(row => row.id));
    assert.deepEqual(pull.body.visible_relationship_ids, pull.body.relationships.map(row => row.id));
    const tag = tags.body.find(row => row.tag === marker);
    return [list.body.some(row => row.id === findingId), search.body.some(row => row.id === findingId), pull.body.findings.some(row => row.id === findingId),
      overview.body.recent_notes.some(row => row.id === noteId), overview.body.recent_resources.some(row => row.id === resourceId),
      Number(tag?.note_count || 0) > 0, Number(tag?.resource_count || 0) > 0,
      relationships.body.some(row => row.id === relationshipId), pull.body.relationships.some(row => row.id === relationshipId)];
  }

  assert.deepEqual(await visibleToMember(), Array(9).fill(false), 'restricted knowledge must be hidden');
  await pool.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('finding',$1,$2,'view',$3)", [findingId, member.id, admin.id]);
  await pool.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('note',$1,$2,'view',$3),('resource',$4,$2,'view',$3)", [noteId, member.id, admin.id, resourceId]);
  assert.deepEqual(await visibleToMember(), Array(9).fill(true), 'grants must expose knowledge on every read path');
  await pool.query("DELETE FROM record_access_grants WHERE user_id=$1 AND ((entity_type='finding' AND entity_id=$2) OR (entity_type='note' AND entity_id=$3) OR (entity_type='resource' AND entity_id=$4))", [member.id, findingId, noteId, resourceId]);
  assert.deepEqual(await visibleToMember(), Array(9).fill(false), 'revocation must hide knowledge again');
  console.log('knowledge live probe: restricted list/search/sync/overview/tags and grant/revocation passed');
} finally {
  if (relationshipId) await pool.query('DELETE FROM knowledge_relationships WHERE id=$1 AND source_id=$2 AND target_id=$3', [relationshipId, findingId, noteId]);
  if (resourceId) await pool.query("DELETE FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1", [resourceId]);
  if (resourceId) await pool.query('DELETE FROM resources WHERE id=$1 AND name=$2', [resourceId, marker]);
  if (noteId) await pool.query("DELETE FROM record_access_grants WHERE entity_type='note' AND entity_id=$1", [noteId]);
  if (noteId) await pool.query('DELETE FROM notes WHERE id=$1 AND title=$2', [noteId, marker]);
  if (findingId) await pool.query("DELETE FROM record_access_grants WHERE entity_type='finding' AND entity_id=$1", [findingId]);
  if (findingId) await pool.query('DELETE FROM lab_findings WHERE id=$1 AND title=$2', [findingId, marker]);
  await pool.end();
}
