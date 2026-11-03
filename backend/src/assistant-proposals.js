import {getUserPermissions} from './middleware/permissions.js';
import {credentialVersionMatches} from './credential-version.js';
import {requireProjectWorkAuthority} from './project-work-authority.js';
import {writeAuditLog} from './middleware/audit.js';
import {catalogUuid} from './catalog-sync.js';
import {validateProposalGraph,proposalDigest} from './assistant-proposal-contract.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};

export async function proposalAuthority(client,user,graph,accept=false){
 let work;
 if(graph.target.mode==='existing')work=await requireProjectWorkAuthority(client,graph.target.project_id,user.userId);
 const actor=(await client.query('SELECT id,role,is_active,credential_version FROM users WHERE id=$1 FOR SHARE',[user.userId])).rows[0];
 if(!actor?.is_active||!credentialVersionMatches(user,actor))fail(401,'SESSION_REVOKED','Sign in again before working with proposals');
 const permissions=work?.permissions||await getUserPermissions(user.userId,actor.role,{client,lock:true});
 if(graph.target.mode==='new'&&!permissions.has('projects.create'))fail(403,'PROPOSAL_CREATE_REQUIRED','Project create permission required');
 if(accept&&(graph.tasks.length||graph.experiments.length)&&!permissions.has('projects.edit'))fail(403,'PROPOSAL_EDIT_REQUIRED','Project edit permission required for planned work');
 return {...user,role:actor.role};
}
export async function authorizeProposalChange(client,change,user){
 const id=catalogUuid(change.entity_id),row=(await client.query('SELECT * FROM assistant_proposals WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(row&&row.author_id!==user.userId)fail(404,'PROPOSAL_NOT_FOUND','Proposal not found');
 if(row)await proposalAuthority(client,user,validateProposalGraph(row.graph),change.operation==='accept');
 else if(change.operation!=='save'||change.payload?.expected_revision!==0)fail(409,'SYNC_DEPENDENCY_PENDING','Synchronize the proposal draft before this operation');
 if(change.operation==='save')await proposalAuthority(client,user,validateProposalGraph(change.payload?.graph));
 return row;
}
function publicRow(row){return {id:row.id,title:row.title,revision:row.revision,graph:row.graph,generation_id:row.generation_id,state:row.state,author_id:row.author_id,created_at:row.created_at,updated_at:row.updated_at};}
export async function applyProposalChange(client,change,user,applyEntity){
 const row=await authorizeProposalChange(client,change,user),id=catalogUuid(change.entity_id),payload=change.payload||{};
 if(!Number.isSafeInteger(payload.expected_revision)||payload.expected_revision<0)fail(400,'PROPOSAL_REVISION_REQUIRED','Review the saved proposal revision');
 if(row?.revision!==payload.expected_revision&&!(row===undefined&&payload.expected_revision===0))fail(409,'PROPOSAL_REVISION_CONFLICT','Proposal changed. Your saved work is retained; synchronize and review it.');
 if(row&&row.state!=='draft')fail(409,'PROPOSAL_ALREADY_FINAL','An accepted or deleted proposal cannot be reapplied or edited');
 if(change.operation==='save'){
  const graph=validateProposalGraph(payload.graph),title=typeof payload.title==='string'?payload.title.trim():'';
  if(!title||title.length>200)fail(400,'INVALID_PROPOSAL_TITLE','Proposal title is required (maximum 200 characters)');
  const generation=payload.generation_id==null?null:catalogUuid(payload.generation_id);
  if(row&&row.generation_id!==generation)fail(400,'PROPOSAL_ORIGIN_IMMUTABLE','Regeneration creates a separate proposal, not a new origin for this draft');
  let provenance={type:'manual'};
  if(generation){const source=(await client.query("SELECT target_project_id,provenance FROM assistant_proposal_generations WHERE id=$1 AND author_id=$2 AND state='ready'",[generation,user.userId])).rows[0];if(!source||(source.target_project_id||null)!==(graph.target.mode==='existing'?graph.target.project_id:null))fail(400,'PROPOSAL_GENERATION_INVALID','Generation provenance is unavailable for this account/target');provenance=source.provenance;}
  const result=row?await client.query('UPDATE assistant_proposals SET title=$2,graph=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',[id,title,graph]):await client.query('INSERT INTO assistant_proposals(id,author_id,revision,title,graph,generation_id) VALUES($1,$2,1,$3,$4,$5) RETURNING *',[id,user.userId,title,graph,generation]);
  return {...publicRow(result.rows[0]),graph_digest:proposalDigest(graph),provenance};
 }
 if(change.operation==='delete'){
  const result=(await client.query("UPDATE assistant_proposals SET state='deleted',revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[id])).rows[0];return {id,revision:result.revision,state:'deleted'};
 }
 if(change.operation!=='accept'||payload.confirmed!==true)fail(400,'PROPOSAL_CONFIRMATION_REQUIRED','Explicit human confirmation is required');
 const graph=validateProposalGraph(row.graph),digest=proposalDigest(graph);
 if(payload.graph_digest!==digest)fail(409,'PROPOSAL_REVIEW_CHANGED','The reviewed proposal does not match the saved draft');
 const actor=await proposalAuthority(client,user,graph,true),projectId=graph.target.project_id;
 if(graph.target.mode==='existing'){
  const project=(await client.query('SELECT lifecycle_revision,status FROM projects WHERE id=$1 FOR UPDATE',[projectId])).rows[0];
  if(project.lifecycle_revision!==graph.target.expected_lifecycle_revision||['completed','cancelled','archived'].includes(project.status))fail(409,'PROPOSAL_TARGET_CHANGED','Review a current open project before accepting this proposal');
 }
 const records=[...(graph.target.mode==='new'?[['project',{id:projectId,name:graph.target.name,description:graph.target.description,priority:graph.target.priority,status:'planning',visibility:'project',owner_id:user.userId}]]:[]),...graph.tasks.map(task=>['project_task',{...task,project_id:projectId,status:'todo',created_by:user.userId}]),...graph.experiments.map(experiment=>['project_experiment',{...experiment,project_id:projectId,status:'planned',observations:'',result:'',conclusion:'',performed_by:null}]),...graph.links.map(link=>['project_task_experiment',{...link,project_id:projectId,relationship:'related',created_by:user.userId}])];
 for(const [type,record] of records){
  const table={project:'projects',project_task:'project_tasks',project_experiment:'project_experiments',project_task_experiment:'project_task_experiments'}[type];
  if((await client.query(`SELECT 1 FROM ${table} WHERE id=$1`,[record.id])).rowCount)fail(409,'PROPOSAL_ID_COLLISION','A proposed identifier already exists; preserve the draft and create a separate proposal');
  const result=await applyEntity(client,{entity_type:type,entity_id:record.id,operation:'create',payload:{record}},actor);
  await writeAuditLog({req:{user:actor},actorUserId:user.userId,action:'assistant:accepted_create',entityType:type,entityId:record.id,newValue:result,metadata:{proposal_id:id,approval_change_id:change.change_id,project_id:projectId,human_confirmed:true},client,required:true});
 }
 const accepted=(await client.query("UPDATE assistant_proposals SET state='accepted',revision=revision+1,accepted_change_id=$2,updated_at=now() WHERE id=$1 RETURNING revision",[id,change.change_id])).rows[0];
 return {id,revision:accepted.revision,state:'accepted',project_id:projectId,graph_digest:digest,applied:{projects:graph.target.mode==='new'?1:0,tasks:graph.tasks.length,experiments:graph.experiments.length,links:graph.links.length}};
}
