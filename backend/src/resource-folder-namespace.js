const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
export function folderName(name){
 if(typeof name!=='string'||!name.trim()||name!==name.trim()||Array.from(name).length>200||['.','..'].includes(name)||/[\\/:\x00-\x1f\x7f]/.test(name))fail(400,'INVALID_FOLDER_NAME','Folder name must be one path component of 1 to 200 characters');
 return name;
}
export function folderNamespace(record,{allowDisplayRename=false}={}){
 const name=folderName(record.name);
 const relative=record.relative_path??name;
 if(typeof relative!=='string'||Buffer.byteLength(relative)>1024||/[\\:\x00-\x1f\x7f]/.test(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..')||(!allowDisplayRename&&relative.split('/').at(-1)!==name)||record.relative_path!=null&&!record.parent_resource_id)fail(400,'INVALID_FOLDER_PATH','Invalid empty-folder path');
 const parents=['item_id','project_id','note_id','parent_resource_id'].map(key=>record[key]||null);
 if(parents.filter(Boolean).length>1)fail(400,'INVALID_RESOURCE_PARENT','Choose one folder attachment');
 return {relative,parents,key:JSON.stringify([...parents.map(id=>id?.replaceAll('-','').toLowerCase()??null),relative])};
}
// Serialize the whole containing namespace: a file at a and an entry at a/b
// have different leaf keys but must never both claim the same logical tree.
export async function requireResourceNamespace(client,record,exceptId=null){
 const parents=['item_id','project_id','note_id','parent_resource_id'].map(key=>record[key]||null);
 const relative=record.relative_path??record.original_filename??record.name;
 if(typeof relative!=='string'||!relative||Buffer.byteLength(relative)>1024||/[\\:\x00-\x1f\x7f]/.test(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'))fail(400,'INVALID_FOLDER_PATH','Invalid resource folder path');
 const key=JSON.stringify(parents.map(id=>id?.replaceAll('-','').toLowerCase()??null));
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['resource-folder:'+key]);
 const duplicate=await client.query("SELECT id FROM resources WHERE item_id IS NOT DISTINCT FROM $1::uuid AND project_id IS NOT DISTINCT FROM $2::uuid AND note_id IS NOT DISTINCT FROM $3::uuid AND parent_resource_id IS NOT DISTINCT FROM $4::uuid AND kind IN ('file','folder') AND ($4::uuid IS NOT NULL OR kind='folder') AND (lower(COALESCE(relative_path,original_filename,name))=lower($5) OR starts_with(lower(COALESCE(relative_path,original_filename,name)),lower($5)||'/') OR starts_with(lower($5),lower(COALESCE(relative_path,original_filename,name))||'/')) AND ($6::uuid IS NULL OR id<>$6::uuid) LIMIT 1",[...parents,relative,exceptId]);
 if(duplicate.rowCount)fail(409,'RESOURCE_FOLDER_PATH_EXISTS','A resource already occupies this folder path or one of its parents. Existing work is preserved.');
}
export async function requireFolderNamespace(client,record,exceptId=null){
 folderNamespace(record,{allowDisplayRename:exceptId!==null});
 await requireResourceNamespace(client,record,exceptId);
}
