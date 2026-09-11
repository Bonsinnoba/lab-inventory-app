import { pool } from '../db.js';
import { getProjectAccess } from './project-access.js';

/**
 * Resolve the authorization context of a resource.
 *
 * Resources may be directly attached to a project/item/note, or may be
 * children of a folder. Folder children inherit the effective context of
 * their ancestor. Items are intentionally global in the current schema;
 * notes become project-scoped when note.project_id is set. Resources with no
 * project/note context remain intentionally shared/unattached resources.
 */
export async function getResourceContext(resourceId) {
  const result = await pool.query(`
    WITH RECURSIVE resource_chain AS (
      SELECT r.*, 0 AS depth
      FROM resources r
      WHERE r.id = $1
      UNION ALL
      SELECT parent.*, child.depth + 1
      FROM resources parent
      JOIN resource_chain child ON child.parent_resource_id = parent.id
    )
    SELECT rc.id, rc.parent_resource_id, rc.project_id, rc.item_id, rc.note_id,
           rc.uploaded_by, rc.kind, rc.name, rc.depth,
           n.project_id AS note_project_id
    FROM resource_chain rc
    LEFT JOIN notes n ON n.id = rc.note_id
    ORDER BY rc.depth ASC`,
    [resourceId]
  );

  if (!result.rowCount) return null;

  const rows = result.rows;
  const projectIds = new Set();
  for (const row of rows) {
    if (row.project_id) projectIds.add(row.project_id);
    if (row.note_project_id) projectIds.add(row.note_project_id);
  }

  // A resource tree spanning multiple projects is invalid/ambiguous. Do not
  // silently grant access based on whichever ancestor happens to be visited.
  if (projectIds.size > 1) {
    return {
      resource: rows[0],
      projectId: null,
      invalid: true,
      reason: 'RESOURCE_PROJECT_CONTEXT_CONFLICT',
    };
  }

  return {
    resource: rows[0],
    projectId: projectIds.values().next().value || null,
    invalid: false,
  };
}

export async function getResourceAccess(resourceId, user) {
  const context = await getResourceContext(resourceId);
  if (!context) return { access: 'none', context: null };
  if (context.invalid) return { access: 'none', context };

  if (context.projectId) {
    const projectAccess = await getProjectAccess(context.projectId, user);
    return { access: projectAccess.access, memberRole: projectAccess.memberRole, context };
  }

  // Unattached/item-only/note-without-project resources are part of the
  // intentionally shared library. Any authenticated user may read them.
  if (user?.userId) return { access: 'shared', memberRole: null, context };
  return { access: 'none', memberRole: null, context };
}

export async function requireResourceRead(resourceId, user) {
  const result = await getResourceAccess(resourceId, user);
  if (result.context?.invalid) {
    return { ok: false, status: 409, error: { code: 'RESOURCE_CONTEXT_INVALID', message: 'Resource has conflicting project ownership' }, ...result };
  }
  if (result.access === 'none') {
    return { ok: false, status: 403, error: { code: 'RESOURCE_ACCESS_REQUIRED', message: 'You do not have access to this resource' }, ...result };
  }
  return { ok: true, ...result };
}

export async function requireResourceEditor(resourceId, user) {
  const result = await getResourceAccess(resourceId, user);
  if (result.context?.invalid) {
    return { ok: false, status: 409, error: { code: 'RESOURCE_CONTEXT_INVALID', message: 'Resource has conflicting project ownership' }, ...result };
  }
  if (result.access === 'edit' || result.access === 'admin') {
    return { ok: true, ...result };
  }
  if (result.access === 'shared') {
    // Keep the existing shared library available without making it writable
    // by every authenticated account. Admins and the original uploader may
    // manage an unattached/shared resource.
    const ownerId = result.context?.resource?.uploaded_by;
    if (user?.role === 'admin' || (ownerId && ownerId === user?.userId)) {
      return { ok: true, ...result };
    }
    return { ok: false, status: 403, error: { code: 'RESOURCE_EDIT_REQUIRED', message: 'You do not have permission to modify this shared resource' }, ...result };
  }
  if (result.access === 'view') {
    return { ok: false, status: 403, error: { code: 'RESOURCE_READ_ONLY', message: 'You have read-only access to this resource' }, ...result };
  }
  return { ok: false, status: 403, error: { code: 'RESOURCE_ACCESS_REQUIRED', message: 'You do not have access to this resource' }, ...result };
}

/** Validate a resource before attaching it to a canvas block. */
export async function validateCanvasResource(resourceId, projectId, user) {
  if (!resourceId) return { ok: true, context: null };
  const access = await requireResourceRead(resourceId, user);
  if (!access.ok) return access;
  if (access.context.projectId && access.context.projectId !== projectId) {
    return {
      ok: false,
      status: 409,
      error: { code: 'RESOURCE_PROJECT_MISMATCH', message: 'The resource belongs to a different project and cannot be attached to this canvas' },
      ...access,
    };
  }
  return access;
}

/** Validate a resource parent supplied by a create operation. */
export async function validateResourceParent({ itemId, projectId, noteId, parentResourceId, user, requireEdit = true }) {
  const supplied = [itemId, projectId, noteId, parentResourceId].filter(Boolean);
  if (supplied.length > 1) {
    return { ok: false, status: 400, error: { code: 'RESOURCE_PARENT_CONFLICT', message: 'A resource can have at most one parent/context' } };
  }

  if (projectId) {
    const access = await getProjectAccess(projectId, user);
    if (access.access === 'none') return { ok: false, status: 403, error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to this project' } };
    if (requireEdit && access.access === 'view') return { ok: false, status: 403, error: { code: 'PROJECT_READ_ONLY', message: 'You have read-only access to this project' } };
    return { ok: true, context: { projectId } };
  }

  if (noteId) {
    const note = await pool.query('SELECT id, project_id FROM notes WHERE id = $1', [noteId]);
    if (!note.rowCount) return { ok: false, status: 404, error: { code: 'NOTE_NOT_FOUND', message: 'Note not found' } };
    if (note.rows[0].project_id) {
      const access = await getProjectAccess(note.rows[0].project_id, user);
      if (access.access === 'none') return { ok: false, status: 403, error: { code: 'PROJECT_ACCESS_REQUIRED', message: 'You do not have access to the note project' } };
      if (requireEdit && access.access === 'view') return { ok: false, status: 403, error: { code: 'PROJECT_READ_ONLY', message: 'You have read-only access to the note project' } };
      return { ok: true, context: { projectId: note.rows[0].project_id } };
    }
    if (user?.userId) return { ok: true, context: { projectId: null } };
    return { ok: false, status: 403, error: { code: 'RESOURCE_ACCESS_REQUIRED', message: 'Authentication required' } };
  }

  if (itemId) {
    const item = await pool.query('SELECT id FROM items WHERE id = $1', [itemId]);
    if (!item.rowCount) return { ok: false, status: 404, error: { code: 'ITEM_NOT_FOUND', message: 'Item not found' } };
    if (user?.userId) return { ok: true, context: { projectId: null } };
    return { ok: false, status: 403, error: { code: 'RESOURCE_ACCESS_REQUIRED', message: 'Authentication required' } };
  }

  if (parentResourceId) {
    const parent = await getResourceAccess(parentResourceId, user);
    if (!parent.context) return { ok: false, status: 404, error: { code: 'RESOURCE_PARENT_NOT_FOUND', message: 'Parent resource not found' } };
    if (parent.context.invalid) return { ok: false, status: 409, error: { code: 'RESOURCE_CONTEXT_INVALID', message: 'Parent resource has conflicting project ownership' } };
    if (parent.context.resource.kind !== 'folder') return { ok: false, status: 400, error: { code: 'RESOURCE_PARENT_NOT_FOLDER', message: 'Parent resource must be a folder' } };
    const edit = requireEdit ? await requireResourceEditor(parentResourceId, user) : await requireResourceRead(parentResourceId, user);
    if (!edit.ok) return edit;
    return { ok: true, context: { projectId: parent.context.projectId } };
  }

  if (user?.userId) return { ok: true, context: { projectId: null } };
  return { ok: false, status: 403, error: { code: 'RESOURCE_ACCESS_REQUIRED', message: 'Authentication required' } };
}
