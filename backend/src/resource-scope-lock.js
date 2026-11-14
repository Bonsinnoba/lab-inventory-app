import {getResourceContext, requireResourceEditor, validateResourceParent} from './middleware/resource-access.js';

const fail = (status, code, message) => { throw Object.assign(Error(message), {status, code}); };
const scope = context => JSON.stringify(context.resources.map(row => [row.id, row.parent_resource_id, row.project_id, row.note_id, row.item_id, row.note_project_id, row.note_visibility, row.visibility]));

async function lockProjectsAndGrants(client, projects, entities, user) {
  const ids = [...new Set(projects.filter(Boolean))].sort();
  if (ids.length) {
    await client.query('SELECT id FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [ids]);
    await client.query('SELECT project_id FROM project_members WHERE project_id=ANY($1::uuid[]) AND user_id=$2 ORDER BY project_id FOR SHARE', [ids, user.userId]);
  }
  const guarded = [...new Set([...entities, ...ids].filter(Boolean))].sort();
  if (guarded.length) await client.query('SELECT entity_id FROM record_access_grants WHERE entity_id=ANY($1::uuid[]) AND user_id=$2 ORDER BY entity_type,entity_id FOR SHARE', [guarded, user.userId]);
}

// Scope locks are not an account/domain grant. Callers still validate the current
// actor and required domain permissions in their owning mutation transaction.
export async function lockResourceScope(client, id, user) {
  const before = await getResourceContext(id, client);
  if (!before) fail(404, 'RESOURCE_NOT_FOUND', 'Resource not found');
  if (before.invalid) fail(409, 'RESOURCE_CONTEXT_INVALID', 'Resource has conflicting ownership');
  const ids = before.resources.map(row => row.id).sort();
  await client.query('SELECT id FROM resources WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
  const notes = [...new Set(before.resources.map(row => row.note_id).filter(Boolean))].sort();
  if (notes.length) await client.query('SELECT id FROM notes WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [notes]);
  const context = await getResourceContext(id, client);
  if (!context || context.invalid || scope(context) !== scope(before)) fail(409, 'RESOURCE_SCOPE_CHANGED', 'The containing folder or note changed; refresh before retrying');
  await lockProjectsAndGrants(client, [context.projectId], [...ids, ...notes], user);
  return context;
}

export async function requireLockedResourceEditor(client, id, user) {
  await lockResourceScope(client, id, user);
  const access = await requireResourceEditor(id, user, client);
  if (!access.ok) fail(access.status, access.error.code, access.error.message);
  return access;
}

export async function requireLockedResourceDestination(client, destination, user) {
  const {item_id, project_id, note_id, parent_resource_id} = destination;
  if (parent_resource_id) await lockResourceScope(client, parent_resource_id, user);
  const note = note_id ? (await client.query('SELECT id,project_id FROM notes WHERE id=$1 FOR SHARE', [note_id])).rows[0] : null;
  if (item_id) await client.query('SELECT id FROM items WHERE id=$1 FOR SHARE', [item_id]);
  await lockProjectsAndGrants(client, [project_id, note?.project_id], [note_id], user);
  const access = await validateResourceParent({itemId:item_id, projectId:project_id, noteId:note_id, parentResourceId:parent_resource_id, user, client});
  if (!access.ok) fail(access.status, access.error.code, access.error.message);
  return access;
}
