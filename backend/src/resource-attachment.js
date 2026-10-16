import { requireResourceEditor, validateResourceParent } from './middleware/resource-access.js';
import { predecessorRevision } from './resource-content-edit.js';

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
const fields = ['item_id', 'project_id', 'note_id'];
export function attachmentDestination(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k)))
    fail(400, 'INVALID_ATTACHMENT', 'Choose an item, project, note, or the unattached library');
  const destination = Object.fromEntries(fields.map(k => {
    const id = value[k];
    if (id == null) return [k, null];
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      fail(400, 'INVALID_ATTACHMENT', `Invalid ${k}`);
    return [k, id.toLowerCase()];
  }));
  if (Object.values(destination).filter(Boolean).length > 1)
    fail(400, 'INVALID_ATTACHMENT', 'Choose only one attachment destination');
  return destination;
}

export function checkAttachmentRevision(resource, expected) {
  if (typeof expected !== 'string' || !Number.isFinite(Date.parse(expected)))
    fail(400, 'ATTACHMENT_REVISION_REQUIRED', 'Refresh this resource before moving it');
  if (new Date(resource.updated_at).getTime() !== Date.parse(expected))
    fail(409, 'RESOURCE_ATTACHMENT_CONFLICT', 'The resource changed on the server. Review its current attachment before retrying.');
}

export function attachmentPredecessor(move,change,user){
  if(![1,2,3].includes(move.protocol))fail(400,'INVALID_ATTACHMENT_PROTOCOL','Unsupported resource attachment protocol');
  const previous=move.previous_change_id;
  if(previous==null)return null;
  if(![2,3].includes(move.protocol)||typeof previous!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(previous)||previous.toLowerCase()===String(change.change_id).toLowerCase()||!change.__device_id||!user.userId)
    fail(400,'INVALID_ATTACHMENT_DEPENDENCY','Invalid attachment predecessor');
  return previous.toLowerCase();
}
export async function attachmentExpectedRevision(client,move,change,user){
  return mutationExpectedRevision(client,move,change,user,['file','link']);
}
export async function mutationExpectedRevision(client,move,change,user,kinds){
  const previous=attachmentPredecessor(move,change,user);
  if(!previous)return move.expected_updated_at;
  const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[previous])).rows[0];
  if(move.protocol===3&&['attach','edit_metadata'].includes(prior?.operation)){
    if(prior.change_id!==previous||prior.user_id!==user.userId||prior.device_id!==change.__device_id||prior.entity_type!=='resource'||prior.entity_id!==change.entity_id||prior.response_json?.id!==change.entity_id||!kinds.includes(prior.response_json?.kind))
      fail(409,'RESOURCE_ATTACHMENT_CONFLICT','Attachment predecessor does not belong to this resource, author and device');
    const revision=prior.response_json.updated_at;
    if(typeof revision!=='string'||!Number.isFinite(Date.parse(revision)))fail(409,'RESOURCE_ATTACHMENT_CONFLICT','Earlier attachment confirmation is incomplete');
    return revision;
  }
  // Same author/device/resource file receipt only. Current source/destination
  // authorization and revision are still rechecked by moveResourceAttachment.
  return predecessorRevision(prior,change,user,change.entity_id);
}

// Caller owns the transaction and the idempotency receipt. No bytes are moved,
// copied or removed; this only changes the resource's direct attachment.
export async function moveResourceAttachment(client, resourceId, user, destinationValue, expectedRevision, requireRevision = true) {
  const destination = attachmentDestination(destinationValue);
  const resource = (await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE', [resourceId])).rows[0];
  if (!resource) fail(409, 'RESOURCE_NOT_FOUND', 'Resource no longer exists');
  const source = await requireResourceEditor(resourceId, user);
  if (!source.ok) fail(source.status, source.error.code, source.error.message);
  if (resource.parent_resource_id || resource.kind === 'folder')
    fail(409, 'RESOURCE_TREE_MOVE_REQUIRED', 'Folder trees and nested resources require folder management');
  if (requireRevision) checkAttachmentRevision(resource, expectedRevision);
  const target = await validateResourceParent({ itemId: destination.item_id, projectId: destination.project_id, noteId: destination.note_id, user });
  if (!target.ok) fail(target.status, target.error.code, target.error.message);
  const projectId = target.context?.projectId || null;
  if (resource.visibility === 'project' && !projectId)
    fail(409, 'RESOURCE_VISIBILITY_CONFLICT', 'A project-visible resource must remain attached to a project');
  // Do not break the project relationships already using this resource.
  if (projectId) {
    const references = await client.query(`SELECT project_id FROM project_blocks WHERE resource_id=$1
      UNION SELECT COALESCE(t.project_id,e.project_id) FROM project_work_attachments a
      LEFT JOIN project_tasks t ON t.id=a.task_id LEFT JOIN project_experiments e ON e.id=a.experiment_id
      WHERE a.resource_id=$1`, [resourceId]);
    if (references.rows.some(r => r.project_id && r.project_id !== projectId))
      fail(409, 'RESOURCE_PROJECT_MISMATCH', 'This resource is still referenced by another project. Review those references first.');
  }
  if (fields.every(k => (resource[k] || null) === destination[k])) return resource;
  return (await client.query(`UPDATE resources SET item_id=$1,project_id=$2,note_id=$3,updated_at=GREATEST(date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',updated_at)+interval '1 millisecond')
    WHERE id=$4 RETURNING *`, [destination.item_id, destination.project_id, destination.note_id, resourceId])).rows[0];
}
