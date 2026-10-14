// Receipts confirm an owned intent; they are not a replacement for an
// authorized pull. Never return the historical record wholesale on replay.
const jobFields = ['id','resource_id','deleted','control_version','status','quality',
  'scheduled_for','priority','progress','bytes_downloaded','total_bytes','attempts',
  'max_attempts','cancel_requested','stop_requested_status','started_at',
  'completed_at','created_at','updated_at','control_outcome'];
const settingsFields = ['enabled','mode','window_start','window_end',
  'concurrent_downloads','default_quality','max_retries','sync_version','updated_at'];
const pick = (value, fields) => Object.fromEntries(fields
  .filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));

// The push route checks current permissions and, for download jobs, current
// resource edit access BEFORE both fresh application and idempotent replay.
export function syncResponseProjection(entityType, value, permissions) {
  const receipt = { acknowledged: true };
  if (!value || typeof value !== 'object') return receipt;
  if (entityType === 'resource' && value.kind === 'file' && (permissions.has('resources.create') || permissions.has('resources.edit'))) {
    return { ...receipt, ...pick(value, ['id','updated_at']) };
  }
  if (permissions.has('resources.edit')) {
    if (entityType === 'resource_download_job') return { ...receipt, ...pick(value, jobFields) };
    if (entityType === 'media_download_settings') return { ...receipt, ...pick(value, settingsFields) };
  }
  return receipt;
}
