import { requireResourceEditor } from './middleware/resource-access.js';
import { checkAttachmentRevision } from './resource-attachment.js';

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
export function validatePdfCopy(source, record, descriptor) {
  if (descriptor?.protocol !== 1 || descriptor.source_id !== source.id || record.derived_from_resource_id !== source.id || record.id === source.id)
    fail(400, 'INVALID_EDITOR_COPY', 'Invalid editor copy identity');
  checkAttachmentRevision(source, descriptor.source_updated_at);
  if (source.kind !== 'file' || source.file_type !== 'pdf' || !String(source.original_filename || source.name).toLowerCase().endsWith('.pdf') || record.kind !== 'file' || record.file_type !== 'pdf' || record.mime_type !== 'application/pdf')
    fail(400, 'INVALID_EDITOR_COPY', 'Only PDF edit copies are supported');
  for (const field of ['item_id','project_id','note_id','parent_resource_id']) {
    if ((source[field] || null) !== (record[field] || null))
      fail(409, 'EDITOR_COPY_SCOPE_CHANGED', 'A copy must retain the source attachment');
  }
  if ((source.visibility || 'lab') !== (record.visibility || 'lab'))
    fail(409, 'EDITOR_COPY_SCOPE_CHANGED', 'A copy must retain the source visibility');
}

export async function authorizePdfCopy(client, record, descriptor, user) {
  if (typeof descriptor?.source_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(descriptor.source_id))
    fail(400, 'INVALID_EDITOR_COPY', 'Invalid source identity');
  const source = (await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[descriptor.source_id])).rows[0];
  if (!source) fail(409, 'EDITOR_COPY_SOURCE_MISSING', 'The source no longer exists; your local copy is preserved for review');
  const access = await requireResourceEditor(source.id,user);
  if (!access.ok) fail(access.status,access.error.code,access.error.message);
  validatePdfCopy(source,record,descriptor);
}
