import {pool} from './db.js';
import {requireResourceRead} from './middleware/resource-access.js';
const fail=message=>{throw Object.assign(Error(message),{status:409,code:'RESOURCE_FOLDER_MANIFEST_INVALID'});};
function location(value){if(typeof value!=='string')fail('Folder path is unavailable');const path=value.replace(/\\/g,'/').replace(/\/$/,'');if(!path||path.length>1024||path.split('/').some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f\x7f:]/.test(part)))fail('Folder contains an invalid path; existing files are preserved');return path;}
export function resourceFolderManifest(root,rows){
 if(root?.kind!=='folder')fail('Resource is not a folder');
 const children=new Map(),identities=new Set([root.id]);
 for(const row of rows){if(identities.has(row.id))fail('Folder contains duplicate identities');identities.add(row.id);const siblings=children.get(row.parent_resource_id)||[];siblings.push(row);children.set(row.parent_resource_id,siblings);}
 const files=[],seen=new Set([root.id]),paths=new Set();
 function walk(id,prefix,depth){
  const siblings=children.get(id)||[],actual=new Map(siblings.filter(row=>row.kind==='folder').map(row=>[location(row.relative_path||row.name).toLowerCase(),row.id]));
  for(const row of siblings){
   if(files.length>=10000||depth>=31)fail('Folder exceeds the supported listing size or nesting depth');
   if(seen.has(row.id))fail('Folder ancestry is cyclic');seen.add(row.id);
   if(!['file','folder','link'].includes(row.kind))fail('Folder contains an unsupported resource');
   const leaf=row.kind==='link'?`link-${row.id}`:row.relative_path||row.original_filename||row.name;
   const ancestors=location(leaf).toLowerCase().split('/');ancestors.pop();while(ancestors.length){if(actual.has(ancestors.join('/')))fail('Folder entries have ambiguous canonical parents');ancestors.pop();}
   const relative=location([prefix,leaf].filter(Boolean).join('/')),key=relative.toLowerCase();
   if(row.kind!=='link'){if(paths.has(key))fail('Folder contains conflicting paths');paths.add(key);}
   files.push({id:row.id,kind:row.kind,relative_path:relative,original_filename:row.original_filename||row.name,size_bytes:row.size_bytes??0,mime_type:row.mime_type||'application/octet-stream'});
   if(row.kind==='folder')walk(row.id,relative,depth+1);
  }
 }
 walk(root.id,'',0);
 if(files.length!==rows.length)fail('Folder snapshot has incomplete ancestry');
 const filePaths=new Set(files.filter(row=>row.kind==='file').map(row=>row.relative_path.toLowerCase()));
 for(const row of files){const parts=row.relative_path.toLowerCase().split('/');parts.pop();while(parts.length){if(filePaths.has(parts.join('/')))fail('A file conflicts with a folder path');parts.pop();}}
 return {folder:root.name,files:files.sort((a,b)=>a.relative_path.localeCompare(b.relative_path,undefined,{numeric:true}))};
}
export async function getResourceFolderManifest(req,res){
 try{
  const root=(await pool.query("SELECT * FROM resources WHERE id=$1 AND kind='folder'",[req.params.id])).rows[0];
  if(!root)return res.status(404).json({error:'Folder resource not found'});
  const access=await requireResourceRead(root.id,req.user);if(!access.ok)return res.status(access.status).json({error:access.error});
  const rows=(await pool.query(`WITH RECURSIVE descendants AS (
   SELECT r.*,1 AS depth,ARRAY[$1::uuid,r.id] AS visited FROM resources r WHERE parent_resource_id=$1
   UNION ALL SELECT r.*,d.depth+1,d.visited||r.id FROM resources r JOIN descendants d ON r.parent_resource_id=d.id WHERE d.depth<31 AND NOT r.id=ANY(d.visited)
  ) SELECT d.*,CASE WHEN depth=31 THEN EXISTS(SELECT 1 FROM resources c WHERE c.parent_resource_id=d.id) ELSE FALSE END AS truncated FROM descendants d LIMIT 10001`,[root.id])).rows;
  if(rows.length>10000||rows.some(row=>row.truncated))fail('Folder exceeds the supported listing size or nesting depth');
  const visible=[];for(const row of rows){const allowed=await requireResourceRead(row.id,req.user);if(allowed.ok)visible.push(row);else if(allowed.status!==403&&allowed.status!==404)fail('Folder ancestry requires review');}
  // A child must not be exposed through a missing/hidden canonical ancestor.
  const ids=new Set([root.id,...visible.map(row=>row.id)]);const complete=visible.filter(row=>ids.has(row.parent_resource_id));
  return res.json(resourceFolderManifest(root,complete));
 }catch(error){return res.status(error.status||500).json({error:{code:error.code||'FOLDER_MANIFEST_UNAVAILABLE',message:error.status?error.message:'Folder contents could not be loaded'}});}
}
