import {currentResourceActor} from './resource-sync-actor.js';
import {getUserPermissions} from './middleware/permissions.js';
import {canManageEntityGrants} from './middleware/visibility.js';
import {writeAuditLog} from './middleware/audit.js';

const fail = (status, code, message) => { throw Object.assign(Error(message), {status, code}); };
const identity = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) {
    fail(400, 'INVALID_NOTE_GRANT_ID', 'Invalid note or account identity');
  }
  return value.toLowerCase();
};

export async function authorizeNoteMutation(client, user, permission) {
  const current = await currentResourceActor(client, user);
  const permissions = await getUserPermissions(current.userId, current.role, {client, lock: true});
  if (!permissions.has(permission)) fail(403, 'PERMISSION_DENIED', `Permission required: ${permission}`);
  return current;
}

// Central sharing authority: never trust a role/context checked before BEGIN.
// The note lock also serializes visibility changes and simultaneous retries.
export async function changeNoteGrant(client, noteId, targetId, level, user, req = {}) {
  noteId = identity(noteId);
  targetId = identity(targetId);
  if (level !== null && !['view', 'edit'].includes(level)) fail(400, 'INVALID_ACCESS_LEVEL', 'Access must be view or edit');
  const current = await authorizeNoteMutation(client, user, 'notes.edit');
  const note = (await client.query('SELECT id,project_id,visibility FROM notes WHERE id=$1 FOR UPDATE', [noteId])).rows[0];
  if (!note) fail(404, 'NOTE_NOT_FOUND', 'Note not found');
  if (note.visibility !== 'restricted') fail(409, 'NOTE_NOT_RESTRICTED', 'Access grants apply only to restricted notes');
  if (note.project_id) {
    await client.query('SELECT id FROM projects WHERE id=$1 FOR SHARE', [note.project_id]);
    await client.query('SELECT project_id FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE', [note.project_id, current.userId]);
  }
  if (!await canManageEntityGrants({projectId: note.project_id, user: current, client})) {
    fail(403, 'NOTE_GRANT_MANAGER_REQUIRED', 'Only an administrator or project lead can manage access grants');
  }
  if (level !== null && !(await client.query('SELECT id FROM users WHERE id=$1 AND is_active=TRUE FOR SHARE', [targetId])).rowCount) {
    fail(400, 'GRANT_TARGET_INACTIVE', 'The target account must be active');
  }
  const old = (await client.query("SELECT entity_type,entity_id,user_id,access_level,created_at,created_by FROM record_access_grants WHERE entity_type='note' AND entity_id=$1 AND user_id=$2 FOR UPDATE", [noteId, targetId])).rows[0] || null;
  if (old?.access_level === level || (!old && level === null)) return old;
  const result = level === null
    ? (await client.query("DELETE FROM record_access_grants WHERE entity_type='note' AND entity_id=$1 AND user_id=$2 RETURNING user_id,access_level", [noteId, targetId])).rows[0]
    : (await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('note',$1,$2,$3,$4) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level=EXCLUDED.access_level,created_by=EXCLUDED.created_by RETURNING entity_type,entity_id,user_id,access_level,created_at,created_by", [noteId, targetId, level, current.userId])).rows[0];
  await client.query("UPDATE notes SET updated_at=GREATEST(date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',updated_at)+interval '1 millisecond') WHERE id=$1", [noteId]);
  await writeAuditLog({req, actorUserId: current.userId, action: level === null ? 'DELETE' : 'UPDATE', entityType: 'note_access_grant', entityId: noteId, oldValue: old, newValue: level === null ? null : result, metadata: {note_id: noteId, project_id: note.project_id, target_user_id: targetId}, client, required: true});
  return result;
}
