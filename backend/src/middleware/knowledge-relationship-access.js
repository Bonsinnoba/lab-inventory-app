import { pool } from '../db.js';
import { getResourceAccess } from './resource-access.js';
import { getProjectAccess } from './project-access.js';
import { canReadEntity } from './visibility.js';

const ENDPOINT_TABLES = Object.freeze({
  finding: 'lab_findings', result: 'lab_results', calculation: 'engineering_calculations',
  note: 'notes', experiment: 'project_experiments', task: 'project_tasks',
});
const VISIBILITY_TYPES = Object.freeze({
  finding: 'finding', result: 'result', calculation: 'engineering_calculation', note: 'note',
});

export async function canReadRelationshipEndpoint(type, id, user, db = pool) {
  if (!id) return false;
  if (type === 'resource') {
    const access = await getResourceAccess(id, user);
    return access.access !== 'none' && !access.context?.invalid;
  }
  if (!Object.hasOwn(ENDPOINT_TABLES, type)) return false;
  const table = ENDPOINT_TABLES[type];
  const hasVisibility = Object.hasOwn(VISIBILITY_TYPES, type);
  const record = await db.query(
    `SELECT id,project_id${hasVisibility ? ',visibility' : ''} FROM ${table} WHERE id=$1`, [id],
  );
  if (!record.rowCount) return false;
  const row = record.rows[0];
  if (row.project_id && (await getProjectAccess(row.project_id, user)).access === 'none') return false;
  if (!hasVisibility) return true;
  return canReadEntity({
    entityType: VISIBILITY_TYPES[type], entityId: id,
    visibility: row.visibility, projectId: row.project_id, user,
  });
}

export async function canReadKnowledgeRelationship(row, user, db = pool) {
  if (row.project_id && (await getProjectAccess(row.project_id, user)).access === 'none') return false;
  return (await canReadRelationshipEndpoint(row.source_type, row.source_id, user, db)) &&
    (await canReadRelationshipEndpoint(row.target_type, row.target_id, user, db));
}
