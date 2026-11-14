// Preserve the existing link equality contract while ensuring alternate UUID
// spellings cannot create different locks for the same PostgreSQL attachment.
export function resourceLinkLockKey(record){
 return ['link',String(record.url||'').trim().replace(/\/+$/,'').toLowerCase(),...['item_id','project_id','note_id','parent_resource_id'].map(key=>String(record[key]||'').replaceAll('-','').toLowerCase())].join('|');
}
