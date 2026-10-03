import { pool } from '../db.js';

export const VISIBILITY_LEVELS = Object.freeze(['lab', 'project', 'restricted']);
const ENTITY_TYPES = new Set(['project', 'note', 'resource', 'finding', 'result', 'engineering_calculation', 'engineering_test']);

export function normalizeVisibility(value, fallback = 'lab') {
  return VISIBILITY_LEVELS.includes(value) ? value : fallback;
}

export function isVisibility(value) {
  return VISIBILITY_LEVELS.includes(value);
}

/**
 * SQL predicate for list/search surfaces. `entityType` is intentionally a
 * fixed source-code value, never a client-supplied string.
 */
export function visibilityReadSql({ alias, entityType, userIdParameter, roleParameter, projectIdExpression = null }) {
  if (!ENTITY_TYPES.has(entityType)) throw new Error(`Unsupported visibility entity type: ${entityType}`);
  const projectId = projectIdExpression || `${alias}.project_id`;
  return `(
    COALESCE(${alias}.visibility, 'lab') = 'lab'
    OR ${roleParameter} = 'admin'
    OR (
      COALESCE(${alias}.visibility, 'lab') = 'project'
      AND ${projectId} IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM projects visibility_project
        LEFT JOIN project_members visibility_member
          ON visibility_member.project_id = visibility_project.id
          AND visibility_member.user_id = ${userIdParameter}
        WHERE visibility_project.id = ${projectId}
          AND (visibility_project.owner_id = ${userIdParameter} OR visibility_member.user_id = ${userIdParameter})
      )
    )
    OR (
      COALESCE(${alias}.visibility, 'lab') = 'restricted'
      AND EXISTS (
        SELECT 1 FROM record_access_grants visibility_grant
        WHERE visibility_grant.entity_type = '${entityType}'
          AND visibility_grant.entity_id = ${alias}.id
          AND visibility_grant.user_id = ${userIdParameter}
      )
    )
  )`;
}

async function hasProjectMembership(projectId, user) {
  if (!projectId || !user?.userId) return false;
  if (user.role === 'admin') return true;
  const result = await pool.query(
    `SELECT 1
     FROM projects p
     LEFT JOIN project_members pm
       ON pm.project_id = p.id AND pm.user_id = $2
     WHERE p.id = $1 AND (p.owner_id = $2 OR pm.user_id = $2)`,
    [projectId, user.userId],
  );
  return result.rowCount > 0;
}

async function grantFor(entityType, entityId, userId) {
  if (!entityType || !entityId || !userId) return null;
  const result = await pool.query(
    `SELECT access_level
     FROM record_access_grants
     WHERE entity_type = $1 AND entity_id = $2 AND user_id = $3`,
    [entityType, entityId, userId],
  );
  return result.rows[0]?.access_level || null;
}

/**
 * Shared visibility rule for all read surfaces. The caller remains
 * responsible for verifying the domain-specific permission before calling
 * this helper; visibility never grants a domain capability by itself.
 */
export async function canReadEntity({ entityType, entityId, visibility, projectId = null, user }) {
  if (!user?.userId) return false;
  if (user.role === 'admin') return true;

  switch (normalizeVisibility(visibility)) {
    case 'lab':
      return true;
    case 'project':
      return hasProjectMembership(projectId, user);
    case 'restricted':
      return Boolean(await grantFor(entityType, entityId, user.userId));
    default:
      return false;
  }
}

export async function canEditRestrictedEntity({ entityType, entityId, user }) {
  if (!user?.userId) return false;
  if (user.role === 'admin') return true;
  return (await grantFor(entityType, entityId, user.userId)) === 'edit';
}

/** Project owners and leads may manage grants for project-owned records. */
export async function canManageEntityGrants({ projectId = null, user }) {
  if (!user?.userId) return false;
  if (user.role === 'admin') return true;
  if (!projectId) return false;
  const result = await pool.query(
    `SELECT 1
     FROM projects p
     LEFT JOIN project_members pm
       ON pm.project_id = p.id AND pm.user_id = $2
     WHERE p.id = $1
       AND (p.owner_id = $2 OR pm.member_role = 'lead')`,
    [projectId, user.userId],
  );
  return result.rowCount > 0;
}
