import {confirmationDigest} from './resource-confirmation.js';
import {requireLockedResourceEditor, requireLockedResourceDestination} from './resource-scope-lock.js';
import {getResourceContext} from './middleware/resource-access.js';
import {requireResourceNamespace, folderName} from './resource-folder-namespace.js';
import {writeAuditLog} from './middleware/audit.js';
import {validateUploadRelativePath} from './resource-upload-staging.js';

const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const uuid=value=>{
 if(typeof value!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))fail(400,'INVALID_TREE_MOVE','Canonical resource identity required');
 return value.toLowerCase();
};
const parents=['item_id','project_id','note_id','parent_resource_id'];
const snapshotFields=['id','kind','name','relative_path','parent_resource_id','item_id','project_id','note_id','visibility','updated_at'];
function destinationValue(destination){
 if(!destination||typeof destination!=='object'||Array.isArray(destination)||Object.keys(destination).some(key=>!parents.includes(key)))fail(400,'INVALID_TREE_MOVE','Choose one resource destination');
 const target=Object.fromEntries(parents.map(key=>[key,destination[key]==null?null:uuid(destination[key])]));
 if(Object.values(target).filter(Boolean).length>1)fail(400,'INVALID_TREE_MOVE','Choose one resource destination');
 return target;
}
export function treeMoveSnapshot(rows){
 return rows.map(row=>Object.fromEntries(snapshotFields.map(key=>[key,key==='updated_at'?new Date(row[key]).toISOString():row[key]??(key==='visibility'?'lab':null)]))).sort((a,b)=>a.id.localeCompare(b.id));
}
export function treeMoveIntent(change){
 const payload=change.payload;
 if(!payload||Object.keys(payload).some(key=>!['id','tree_move'].includes(key))||uuid(payload.id)!==uuid(change.entity_id))fail(400,'INVALID_TREE_MOVE','Tree move identity mismatch');
 const move=payload.tree_move;
 if(!move||move.protocol!==1||Object.keys(move).some(key=>!['protocol','destination','members','source_context_sha256','destination_context_sha256'].includes(key)))fail(400,'INVALID_TREE_MOVE','Unsupported tree move protocol');
 for(const key of ['source_context_sha256','destination_context_sha256'])if(typeof move[key]!=='string'||!/^[a-f0-9]{64}$/.test(move[key]))fail(400,'INVALID_TREE_MOVE','Reviewed source and destination contexts required');
 const target=destinationValue(move.destination);
 if(!Array.isArray(move.members)||!move.members.length||move.members.length>500)fail(400,'INVALID_TREE_MOVE','Review between 1 and 500 tree members');
 const seen=new Set();
 for(const row of move.members){
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==snapshotFields.length||snapshotFields.some(key=>!Object.hasOwn(row,key)))fail(400,'INVALID_TREE_MOVE','Complete reviewed resource snapshots required');
  if(uuid(row.id)!==row.id||seen.has(row.id)||!['file','link','folder'].includes(row.kind)||typeof row.name!=='string'||!['lab','project','restricted'].includes(row.visibility)||typeof row.updated_at!=='string'||!Number.isFinite(Date.parse(row.updated_at)))fail(400,'INVALID_TREE_MOVE','Invalid or duplicate tree member');
  for(const key of parents)if(row[key]!==null&&uuid(row[key])!==row[key])fail(400,'INVALID_TREE_MOVE','Invalid reviewed parent');
  if(row.relative_path!==null&&typeof row.relative_path!=='string')fail(400,'INVALID_TREE_MOVE','Invalid reviewed path');
  seen.add(row.id);
 }
 if(!seen.has(payload.id))fail(400,'INVALID_TREE_MOVE','Reviewed tree is missing its root');
 return {destination:target,members:treeMoveSnapshot(move.members),sourceDigest:move.source_context_sha256,destinationDigest:move.destination_context_sha256};
}

// Review fingerprints detect context changes; they are never permission grants.
// Callers must authorize the complete source and target before exposing these.
export async function treeMoveContextDigest(client,{resourceId=null,destination={}}){
 const context=resourceId?await getResourceContext(resourceId,client):destination.parent_resource_id?await getResourceContext(destination.parent_resource_id,client):null;
 if(context?.invalid)fail(409,'RESOURCE_CONTEXT_INVALID','Invalid containing resource context');
 const resourceIds=context?.resources.map(row=>row.id)||[];
 const notes=[...new Set([destination.note_id,...(context?.resources.map(row=>row.note_id)||[])].filter(Boolean))].sort();
 const resourceRows=resourceIds.length?(await client.query('SELECT id,kind,name,parent_resource_id,item_id,project_id,note_id,visibility,updated_at FROM resources WHERE id=ANY($1::uuid[]) ORDER BY id',[resourceIds])).rows:[];
 const noteRows=notes.length?(await client.query('SELECT id,project_id,visibility,updated_at FROM notes WHERE id=ANY($1::uuid[]) ORDER BY id',[notes])).rows:[];
 const projects=[...new Set([destination.project_id,context?.projectId,...noteRows.map(row=>row.project_id)].filter(Boolean))].sort();
 const projectRows=projects.length?(await client.query('SELECT id,owner_id,visibility,updated_at FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id',[projects])).rows:[];
 const item=destination.item_id?(await client.query('SELECT id,updated_at FROM items WHERE id=$1',[destination.item_id])).rows:[];
 // pg returns Date instances; canonical digest must include their ISO values,
 // rather than treating them as objects with no enumerable properties.
 return confirmationDigest(JSON.parse(JSON.stringify({resources:resourceRows,notes:noteRows,projects:projectRows,items:item})));
}

export async function reviewResourceTreeMove(client,resourceId,destination,user){
 const id=uuid(resourceId),target=destinationValue(destination);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['resource-tree-topology']);
 const before=await subtree(client,id),ids=before.map(row=>row.id).sort();
 if(ids.includes(target.parent_resource_id))fail(409,'RESOURCE_TREE_CYCLE','A resource cannot move inside itself or its descendants');
 await client.query('SELECT id FROM resources WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
 const rows=await subtree(client,id);
 if(confirmationDigest(treeMoveSnapshot(rows))!==confirmationDigest(treeMoveSnapshot(before)))fail(409,'RESOURCE_TREE_CHANGED','Tree changed while preparing review; try again');
 for(const row of rows)await requireLockedResourceEditor(client,row.id,user);
 await requireLockedResourceDestination(client,target,user);
 return {protocol:1,resource_id:id,destination:target,members:treeMoveSnapshot(rows),source_context_sha256:await treeMoveContextDigest(client,{resourceId:id}),destination_context_sha256:await treeMoveContextDigest(client,{destination:target})};
}

async function subtree(client,id){
 const result=await client.query(`WITH RECURSIVE tree AS (
  SELECT r.*,0 AS tree_depth,ARRAY[r.id] AS visited FROM resources r WHERE r.id=$1
  UNION ALL SELECT child.*,parent.tree_depth+1,parent.visited||child.id FROM resources child
  JOIN tree parent ON child.parent_resource_id=parent.id
  WHERE parent.tree_depth<32 AND NOT child.id=ANY(parent.visited)
 ) SELECT * FROM tree ORDER BY id LIMIT 501`,[id]);
 if(!result.rowCount)fail(409,'RESOURCE_NOT_FOUND','Resource no longer exists; saved work is preserved');
 if(result.rowCount>500||result.rows.some(row=>row.tree_depth>=32))fail(409,'RESOURCE_TREE_LIMIT','Tree is too large or deep for one atomic move');
 return result.rows;
}

async function referenceProjects(client,ids){
 const blocks=await client.query('SELECT project_id FROM project_blocks WHERE resource_id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[ids]);
 const attachments=await client.query('SELECT id,task_id,experiment_id FROM project_work_attachments WHERE resource_id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[ids]);
 const tasks=attachments.rows.map(row=>row.task_id).filter(Boolean),experiments=attachments.rows.map(row=>row.experiment_id).filter(Boolean);
 const taskRows=tasks.length?(await client.query('SELECT id,project_id FROM project_tasks WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[tasks])).rows:[];
 const experimentRows=experiments.length?(await client.query('SELECT id,project_id FROM project_experiments WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[experiments])).rows:[];
 return [...blocks.rows,...taskRows,...experimentRows].map(row=>row.project_id).filter(Boolean);
}

// The sync router owns current-account/domain authorization, BEGIN and the exact
// immutable receipt. This operation changes only the root attachment/path: every
// descendant retains its UUID, parent pointer, content and metadata revision.
export async function applyResourceTreeMove(client,change,user){
 const {destination,members,sourceDigest,destinationDigest}=treeMoveIntent(change),id=uuid(change.entity_id);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['resource-tree-topology']);
 const before=await subtree(client,id),ids=before.map(row=>row.id).sort();
 if(destination.parent_resource_id&&ids.includes(destination.parent_resource_id))fail(409,'RESOURCE_TREE_CYCLE','A resource cannot move inside itself or its descendants');
 await client.query('SELECT id FROM resources WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
 const locked=await subtree(client,id);
 if(confirmationDigest(treeMoveSnapshot(locked))!==confirmationDigest(members)||confirmationDigest(treeMoveSnapshot(before))!==confirmationDigest(members))fail(409,'RESOURCE_TREE_CHANGED','The reviewed tree changed or is incomplete; review it again. Saved work is preserved.');
 const root=locked.find(row=>row.id===id);
 if(root.kind!=='folder'&&locked.length!==1)fail(409,'RESOURCE_CONTEXT_INVALID','Only folders can contain resources');
 for(const row of locked){
  await requireLockedResourceEditor(client,row.id,user);
  if(row.relative_path!=null)validateUploadRelativePath(row.relative_path);
  if(row.kind==='folder')folderName(row.name);
 }
 const target=await requireLockedResourceDestination(client,destination,user);
 if(sourceDigest!==await treeMoveContextDigest(client,{resourceId:id})||destinationDigest!==await treeMoveContextDigest(client,{destination}))fail(409,'RESOURCE_TREE_CONTEXT_CHANGED','Source or destination context changed; review the move again. Saved work is preserved.');
 const projectId=target.context?.projectId||null;
 if(locked.some(row=>row.visibility==='project')&&!projectId)fail(409,'RESOURCE_VISIBILITY_CONFLICT','Project-visible descendants must remain in project context');
 const destinationContext=destination.parent_resource_id?await getResourceContext(destination.parent_resource_id,client):null;
 if((destinationContext?.resources.length||0)+Math.max(...locked.map(row=>row.tree_depth))+1>32)fail(409,'RESOURCE_DEPTH_EXCEEDED','The destination would exceed the supported folder depth');
 if((await referenceProjects(client,ids)).some(project=>project!==projectId))fail(409,'RESOURCE_PROJECT_MISMATCH','A tree member is still referenced by another project; review those references first');
 const leaf=root.kind==='folder'?folderName(root.name):(root.relative_path||root.original_filename||root.name).split('/').at(-1);
 const moved={...root,...destination,relative_path:destination.parent_resource_id&&root.kind!=='link'?leaf:null};
 if(root.kind!=='link')await requireResourceNamespace(client,moved,id);
 if(parents.every(key=>(root[key]||null)===destination[key])&&(root.relative_path||null)===moved.relative_path)return root;
 const updated=(await client.query("UPDATE resources SET item_id=$1,project_id=$2,note_id=$3,parent_resource_id=$4,relative_path=$5,updated_at=GREATEST(date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',updated_at)+interval '1 millisecond') WHERE id=$6 RETURNING *",[...parents.map(key=>destination[key]),moved.relative_path,id])).rows[0];
 await writeAuditLog({req:{user},actorUserId:user.userId,action:'sync:move_tree',entityType:'resource',entityId:id,deviceId:change.__device_id,client,required:true,oldValue:treeMoveSnapshot([root])[0],newValue:treeMoveSnapshot([updated])[0],metadata:{member_count:locked.length,reviewed_tree_sha256:confirmationDigest(members)}});
 return updated;
}
