import {pool} from './db.js';
import {currentResourceActor} from './resource-sync-actor.js';
import {getUserPermissions} from './middleware/permissions.js';
import {validateResourceParent,requireResourceRead} from './middleware/resource-access.js';
import {writeAuditLog} from './middleware/audit.js';
import {youtubeMetadataEndpoint} from './resource-titles.js';
import {resourceLinkLockKey} from './resource-link-identity.js';

const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
export function browserLinkInput(body){
 if(typeof body?.url!=='string'||body.url.length>8192)fail(400,'INVALID_RESOURCE_URL','Supply an HTTP or HTTPS link');
 const url=body.url.trim().replace(/\/+$/,'');let parsed;
 try{parsed=new URL(url);}catch{fail(400,'INVALID_RESOURCE_URL','Supply a valid HTTP or HTTPS link');}
 if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)fail(400,'INVALID_RESOURCE_URL','Links must use HTTP or HTTPS without embedded credentials');
 if(body.name!=null&&(typeof body.name!=='string'||Array.from(body.name.trim()).length>200||/[\x00-\x1f\x7f]/.test(body.name)))fail(400,'INVALID_RESOURCE_NAME','Use a title of at most 200 characters without control characters');
 const parents=Object.fromEntries(['item_id','project_id','note_id','parent_resource_id'].map(key=>[key,body[key]||null]));
 if(Object.values(parents).filter(Boolean).length>1)fail(400,'INVALID_RESOURCE_PARENT','Choose one resource attachment');
 for(const id of Object.values(parents))if(id!=null&&(typeof id!=='string'||!/^([a-f0-9]{32}|[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(id)))fail(400,'INVALID_RESOURCE_PARENT','Attachment identity must be a UUID');
 const name=body.name?.trim()||url;
 return {url,name,name_source:body.name?.trim()?'user':'url_fallback',file_type:youtubeMetadataEndpoint(url)?'youtube':'other',parents};
}

// The browser is an explicitly online transport. No provider request belongs in
// this write transaction: bounded background enrichment handles fallback titles.
// A normalized link/context key also makes a lost-response retry nonduplicating.
export function browserResourceLink({metadata}){
 return async function create(req,res){
  let client,commitAttempted=false,created,status=201;
  try{
   const input=browserLinkInput(req.body);
   client=await pool.connect();await client.query('BEGIN');
   const user=await currentResourceActor(client,req.user);
   const permissions=await getUserPermissions(user.userId,user.role,{client,lock:true});
   if(!permissions.has('resources.view')||!permissions.has('resources.create'))fail(403,'PERMISSION_DENIED','Resource view and create permissions required');
   const p=input.parents;
   const parent=await validateResourceParent({itemId:p.item_id,projectId:p.project_id,noteId:p.note_id,parentResourceId:p.parent_resource_id,user});
   if(!parent.ok)fail(parent.status,parent.error?.code||'RESOURCE_PARENT_DENIED',parent.error?.message||'Resource destination unavailable');
   const key=resourceLinkLockKey({...p,url:input.url});
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
   const duplicate=(await client.query("SELECT * FROM resources WHERE kind='link' AND lower(btrim(url))=lower($1) AND item_id IS NOT DISTINCT FROM $2::uuid AND project_id IS NOT DISTINCT FROM $3::uuid AND note_id IS NOT DISTINCT FROM $4::uuid AND parent_resource_id IS NOT DISTINCT FROM $5::uuid ORDER BY (local_media_path IS NOT NULL) DESC,created_at ASC LIMIT 1",[input.url,...Object.values(p)])).rows[0];
   if(duplicate){
    // Deduplication is never a substitute for visibility authorization.
    const access=await requireResourceRead(duplicate.id,user);
    if(!access.ok)fail(access.status,access.error?.code||'RESOURCE_ACCESS_DENIED',access.error?.message||'Matching resource is unavailable');
    created=duplicate;status=200;
   }else{
    const detail=metadata(req.body);
    created=(await client.query("INSERT INTO resources(name,kind,file_type,url,item_id,project_id,note_id,parent_resource_id,category,description,tags,uploaded_by,name_source) VALUES($1,'link',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",[input.name,input.file_type,input.url,...Object.values(p),detail.category,detail.description,detail.tags,user.userId,input.name_source])).rows[0];
    await writeAuditLog({req,action:'CREATE',entityType:'resource',entityId:created.id,newValue:created,client,required:true});
   }
   commitAttempted=true;await client.query('COMMIT');
  }catch(error){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   return res.status(commitAttempted?503:error.status||500).json({error:{code:commitAttempted?'LINK_CONFIRMATION_UNCERTAIN':error.code||'LINK_CREATE_FAILED',message:commitAttempted?'Link confirmation was lost. Refresh Resources; retrying the same link and destination will not create a second record.':error.message||'Failed to save link'}});
  }finally{client?.release();}
  return res.status(status).json(created);
 };
}
