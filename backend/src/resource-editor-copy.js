import { requireResourceEditor } from './middleware/resource-access.js';
import { checkAttachmentRevision } from './resource-attachment.js';
import { predecessorRevision } from './resource-content-edit.js';

function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }
export function validateEditorCopy(source, record, descriptor) {
  if (descriptor?.protocol !== 1 || descriptor.source_id !== source.id || record.derived_from_resource_id !== source.id || record.id === source.id)
    fail(400, 'INVALID_EDITOR_COPY', 'Invalid editor copy identity');
  checkAttachmentRevision(source, descriptor.source_updated_at);
  const format = descriptor.format ?? 'pdf'; // Existing PDF outbox events predate the format field.
  const type = format === 'docx' ? 'document' : 'pdf';
  const mime = format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
  if (!['pdf', 'docx'].includes(format) || source.kind !== 'file' || source.file_type !== type || !String(source.original_filename || source.name).toLowerCase().endsWith(`.${format}`) || record.kind !== 'file' || record.file_type !== type || record.mime_type !== mime)
    fail(400, 'INVALID_EDITOR_COPY', 'Unsupported editor copy format');
  if (format === 'docx' && (!String(record.original_filename || record.name).toLowerCase().endsWith('.docx') || !Number.isSafeInteger(record.size_bytes) || record.size_bytes <= 0 || record.size_bytes > 16 * 1024 * 1024))
    fail(400, 'INVALID_EDITOR_COPY', 'Invalid DOCX copy filename or size');
  for (const field of ['item_id','project_id','note_id','parent_resource_id']) {
    if ((source[field] || null) !== (record[field] || null))
      fail(409, 'EDITOR_COPY_SCOPE_CHANGED', 'A copy must retain the source attachment');
  }
  if ((source.visibility || 'lab') !== (record.visibility || 'lab'))
    fail(409, 'EDITOR_COPY_SCOPE_CHANGED', 'A copy must retain the source visibility');
}

// Resolve an offline source revision through its immutable receipt, never through
// a renderer-supplied replacement timestamp. Keep the original intent unchanged.
function validateCopyPredecessor(descriptor, change, user) {
  if (typeof descriptor.previous_change_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(descriptor.previous_change_id) || descriptor.previous_change_id.toLowerCase() === change?.change_id?.toLowerCase())
    fail(400, 'INVALID_EDITOR_COPY', 'Invalid source predecessor identity');
  if (!change?.__device_id || !user?.userId)
    fail(400, 'INVALID_EDITOR_COPY', 'Source predecessor requires an authenticated sync device');
  if (typeof descriptor.source_updated_at !== 'string' || !Number.isFinite(Date.parse(descriptor.source_updated_at)))
    fail(400, 'INVALID_EDITOR_COPY', 'Source revision required');
}

export function copyRevision(descriptor, prior, change, user) {
  if (descriptor.previous_change_id == null) return descriptor.source_updated_at;
  validateCopyPredecessor(descriptor, change, user);
  return predecessorRevision(prior, change, user, descriptor.source_id);
}

export async function authorizeEditorCopy(client, record, descriptor, user, change) {
  if (typeof descriptor?.source_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(descriptor.source_id))
    fail(400, 'INVALID_EDITOR_COPY', 'Invalid source identity');
  let prior;
  if (descriptor.previous_change_id != null) {
    // Validate before sending an identifier to PostgreSQL's UUID parser.
    validateCopyPredecessor(descriptor, change, user);
    prior = (await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1', [descriptor.previous_change_id])).rows[0];
  }
  const revision = copyRevision(descriptor, prior, change, user);
  const source = (await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[descriptor.source_id])).rows[0];
  if (!source) fail(409, 'EDITOR_COPY_SOURCE_MISSING', 'The source no longer exists; your local copy is preserved for review');
  const access = await requireResourceEditor(source.id,user);
  if (!access.ok) fail(access.status,access.error.code,access.error.message);
  validateEditorCopy(source,record,{...descriptor,source_updated_at:revision});
}

export const validatePdfCopy = validateEditorCopy;
