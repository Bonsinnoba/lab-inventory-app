import { invoke } from '@tauri-apps/api/tauri';
import { apiFetch, getApiErrorMessage } from './http';

function isTauriRuntime(): boolean { return typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__; }
async function localInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  return invoke<T>(command, args);
}

export interface ProjectFinancialSummary {
  project_id: string; name: string; budget: number | string | null; actual_expense: number; project_income: number; net_spend: number; allocated_inventory_value: number; budget_remaining: number | null; budget_used_percent: number | null;
}

export interface Project {
  id: string; name: string;
  status: 'planning' | 'active' | 'completed' | 'on_hold' | 'cancelled';
  budget?: string | number; total_spent?: string | number;
  description?: string; priority?: 'low'|'normal'|'high'|'critical';
  start_date?: string | null; due_date?: string | null; owner_id?: string | null;
  created_at: string; updated_at: string; transactions?: any[];
}
export interface ProjectMember { project_id:string; user_id:string; member_role:'lead'|'member'|'observer'; joined_at:string; username:string; role:string; }
export interface ProjectTask { id:string; project_id:string; title:string; description:string; status:'todo'|'in_progress'|'blocked'|'done'|'cancelled'; priority:'low'|'normal'|'high'|'critical'; assignee_id?:string|null; assignee_username?:string|null; due_date?:string|null; completed_at?:string|null; created_at:string; updated_at:string; }
export interface ProjectExperiment { id:string; project_id:string; title:string; status:'planned'|'running'|'completed'|'failed'|'cancelled'; hypothesis:string; procedure:string; observations:string; result:string; conclusion:string; performed_by?:string|null; performer_username?:string|null; started_at?:string|null; completed_at?:string|null; created_at:string; updated_at:string; }
export interface ProjectItem { project_id:string; item_id:string; allocated_quantity:string|number; notes:string; name:string; type:string; item_status:string; current_quantity:string|number; unit?:string|null; sku?:string|null; location_name?:string|null; }
export interface ProjectWorkspace { members:ProjectMember[]; tasks:ProjectTask[]; experiments:ProjectExperiment[]; items:ProjectItem[]; notes:any[]; resources:any[]; activity:any[]; requirements?:ResourceRequirement[]; permissions?:{access:'admin'|'edit'|'view'; member_role:string; can_edit:boolean}; }
export interface UserCandidate { id:string; username:string; role:string; }
export interface ResourceRequirement { id:string; project_id:string; project_name?:string; name:string; requirement_type:string; quantity:number|string; unit?:string|null; required_by?:string|null; status:string; preferred_item_id?:string|null; preferred_item_name?:string|null; preferred_quantity?:number|string|null; notes?:string; }
export interface ProjectBomItem { id:string; project_id:string; name:string; part_number?:string|null; required_quantity:number|string; unit?:string|null; preferred_item_id?:string|null; alternative_item_id?:string|null; notes:string; preferred_item_name?:string|null; preferred_item_quantity?:number|string|null; alternative_item_name?:string|null; alternative_item_quantity?:number|string|null; }

export async function getProjects(): Promise<Project[]> { const local=await localInvoke<Project[]>('list_local_projects'); if(local!==null)return local; const r=await apiFetch('/projects'); if(!r.ok)throw await apiError(r,'Failed to fetch projects'); return r.json(); }
export async function getProjectFinancialSummary():Promise<ProjectFinancialSummary[]> {
  const local=await localInvoke<Project[]>('list_local_projects');
  if(local!==null){
    const { getTransactions } = await import('./transactions');
    const { getItems } = await import('./items');
    const [transactions, inventory] = await Promise.all([getTransactions(), getItems()]);
    return Promise.all(local.map(async (p) => {
      const projectTransactions = transactions.filter((t:any) => t.project_id === p.id);
      const actual_expense = projectTransactions.filter((t:any) => t.direction === 'expense').reduce((sum:number,t:any)=>sum+Number(t.amount||0),0);
      const project_income = projectTransactions.filter((t:any) => t.direction === 'income').reduce((sum:number,t:any)=>sum+Number(t.amount||0),0);
      const workspace = await getProjectWorkspace(p.id).catch(() => ({items:[]} as any));
      const costByItem = new Map((inventory||[]).map((item:any) => [item.id, Number(item.unit_cost||0)]));
      const allocated_inventory_value = (workspace.items||[]).reduce((sum:number,item:any)=>sum + Number(item.allocated_quantity||0) * (costByItem.get(item.item_id)||0), 0);
      const budget = p.budget==null ? null : Number(p.budget);
      const net_spend = actual_expense - project_income;
      return {
        project_id:p.id, name:p.name, budget:p.budget??null, actual_expense, project_income, net_spend,
        allocated_inventory_value, budget_remaining:budget==null?null:budget-net_spend,
        budget_used_percent:budget&&budget>0?(net_spend/budget)*100:0
      };
    }));
  }
  const r=await apiFetch('/projects/financial-summary'); if(!r.ok)throw await apiError(r,'Failed to fetch project financial summary'); return r.json();
}
export async function getProject(id:string):Promise<Project>{const local=await localInvoke<Project|null>('get_local_project',{projectId:id});if(local!==null){if(!local)throw new Error('Project not found');return local;}const r=await apiFetch(`/projects/${id}`);if(!r.ok)throw await apiError(r,'Failed to fetch project');return r.json();}
export async function createProject(project:Partial<Project>):Promise<Project>{const local=await localInvoke<Project>('create_local_project',{project});if(local!==null)return local;const r=await apiFetch('/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(project)});if(!r.ok)throw await apiError(r,'Failed to create project');return r.json();}
async function apiError(r: Response, fallback: string): Promise<Error> { const p=await r.json().catch(()=>null) as any; const m=typeof p?.error==='string'?p.error:typeof p?.message==='string'?p.message:typeof p?.error?.message==='string'?p.error.message:fallback; return new Error(m); }
export async function updateProject(id:string,project:Partial<Project>):Promise<Project>{const local=await localInvoke<Project>('update_local_project',{projectId:id,patch:project});if(local!==null)return local;const r=await apiFetch(`/projects/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(project)});if(!r.ok)throw await apiError(r,'Failed to update project');const data=await r.json();if(!data?.id)throw new Error('Project update returned no project record');return data;}
export async function deleteProject(id:string):Promise<void>{const local=await localInvoke<void>('delete_local_project',{projectId:id});if(local!==null)return;const r=await apiFetch(`/projects/${id}`,{method:'DELETE'});if(!r.ok)throw await apiError(r,'Failed to delete project');}
export async function getProjectWorkspace(id:string):Promise<ProjectWorkspace>{const local=await localInvoke<ProjectWorkspace>('list_local_project_workspace',{projectId:id});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/workspace`);if(!r.ok)throw await apiError(r,'Failed to fetch project workspace');return r.json();}
export async function getProjectMemberCandidates(id:string):Promise<UserCandidate[]>{const r=await apiFetch(`/projects/${id}/member-candidates`);if(!r.ok)throw await apiError(r,'Failed to fetch users');return r.json();}
export async function addProjectMember(id:string,user_id:string,member_role:string):Promise<ProjectMember>{const r=await apiFetch(`/projects/${id}/members`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id,member_role})});if(!r.ok)throw await apiError(r,'Failed to add member');const data=await r.json();if(!data?.user_id)throw new Error('Member update returned no membership record');return data;}
export async function removeProjectMember(id:string,userId:string):Promise<void>{const r=await apiFetch(`/projects/${id}/members/${userId}`,{method:'DELETE'});if(!r.ok)throw await apiError(r,'Failed to remove member');}
export async function createProjectTask(id:string,data:Partial<ProjectTask>):Promise<ProjectTask>{const local=await localInvoke<ProjectTask>('create_local_project_task',{projectId:id,record:data});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/tasks`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw await apiError(r,'Failed to create task');return r.json();}
export async function updateProjectTask(id:string,taskId:string,data:Partial<ProjectTask>):Promise<ProjectTask>{const local=await localInvoke<ProjectTask>('update_local_project_task',{projectId:id,recordId:taskId,patch:data});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/tasks/${taskId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw await apiError(r,'Failed to update task');return r.json();}
export async function deleteProjectTask(id:string,taskId:string):Promise<void>{const local=await localInvoke<void>('delete_local_project_task',{projectId:id,recordId:taskId});if(local!==null)return;const r=await apiFetch(`/projects/${id}/tasks/${taskId}`,{method:'DELETE'});if(!r.ok)throw await apiError(r,'Failed to delete task');}
export async function createProjectExperiment(id:string,data:Partial<ProjectExperiment>):Promise<ProjectExperiment>{const local=await localInvoke<ProjectExperiment>('create_local_project_experiment',{projectId:id,record:data});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/experiments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw await apiError(r,'Failed to create experiment');return r.json();}
export async function updateProjectExperiment(id:string,experimentId:string,data:Partial<ProjectExperiment>):Promise<ProjectExperiment>{const local=await localInvoke<ProjectExperiment>('update_local_project_experiment',{projectId:id,recordId:experimentId,patch:data});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/experiments/${experimentId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw await apiError(r,'Failed to update experiment');return r.json();}
export async function deleteProjectExperiment(id:string,experimentId:string):Promise<void>{const local=await localInvoke<void>('delete_local_project_experiment',{projectId:id,recordId:experimentId});if(local!==null)return;const r=await apiFetch(`/projects/${id}/experiments/${experimentId}`,{method:'DELETE'});if(!r.ok)throw await apiError(r,'Failed to delete experiment');}
export async function repeatProjectExperiment(id:string,experimentId:string):Promise<ProjectExperiment>{const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/repeat`,{method:'POST'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to repeat experiment'));return r.json();}
export async function getProjectExperimentHistory(id:string,experimentId:string):Promise<any[]>{const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/history`);if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch experiment history'));return r.json();}
export async function linkProjectItem(id:string,item_id:string,allocated_quantity:number,notes=''):Promise<ProjectItem>{const local=await localInvoke<ProjectItem>('link_local_project_item',{projectId:id,itemId:item_id,allocatedQuantity:allocated_quantity,notes});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/items`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_id,allocated_quantity,notes})});if(!r.ok)throw await apiError(r,'Failed to link inventory item');return r.json();}
export async function unlinkProjectItem(id:string,itemId:string):Promise<void>{const local=await localInvoke<void>('unlink_local_project_item',{projectId:id,itemId});if(local!==null)return;const r=await apiFetch(`/projects/${id}/items/${itemId}`,{method:'DELETE'});if(!r.ok)throw await apiError(r,'Failed to unlink inventory item');}
export async function getProjectRequirements(id?:string):Promise<ResourceRequirement[]> {
  const local=await localInvoke<ResourceRequirement[]>('get_local_resource_requirements',{projectId:id??null});
  if(local!==null)return local;
  const r=await apiFetch(`/operations/requirements${id?`?project_id=${encodeURIComponent(id)}`:''}`);
  if(!r.ok)throw await apiError(r,'Failed to fetch resource requirements'); return r.json();
}
export async function createProjectRequirement(id:string,data:Partial<ResourceRequirement>):Promise<ResourceRequirement>{
  const local=await localInvoke<ResourceRequirement>('create_local_resource_requirement',{projectId:id,record:data});
  if(local!==null)return local;
  const r=await apiFetch('/operations/requirements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,project_id:id})});
  if(!r.ok)throw await apiError(r,'Failed to create resource requirement'); return r.json();
}
export async function updateProjectRequirement(id:string,requirementId:string,data:Partial<ResourceRequirement>):Promise<ResourceRequirement>{
  const local=await localInvoke<ResourceRequirement>('update_local_resource_requirement',{projectId:id,recordId:requirementId,patch:data});
  if(local!==null)return local;
  const r=await apiFetch(`/operations/requirements/${requirementId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  if(!r.ok)throw await apiError(r,'Failed to update resource requirement'); return r.json();
}
export async function deleteProjectRequirement(id:string,requirementId:string):Promise<void>{
  const local=await localInvoke<void>('delete_local_resource_requirement',{projectId:id,recordId:requirementId});
  if(local!==null)return;
  const r=await apiFetch(`/operations/requirements/${requirementId}`,{method:'DELETE'});
  if(!r.ok)throw await apiError(r,'Failed to delete resource requirement');
}

export async function getProjectBom(id:string):Promise<ProjectBomItem[]>{const local=await localInvoke<ProjectBomItem[]>('get_local_project_bom',{projectId:id});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/bom`);if(!r.ok)throw await apiError(r,'Failed to fetch project BOM');return r.json();}
export async function createProjectBomItem(id:string,data:Partial<ProjectBomItem>):Promise<ProjectBomItem>{const local=await localInvoke<ProjectBomItem>('create_local_project_bom',{projectId:id,record:data});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/bom`,{method:'POST',body:JSON.stringify(data)});if(!r.ok)throw await apiError(r,'Failed to create BOM item');return r.json();}
export async function updateProjectBomItem(id:string,bomId:string,data:Partial<ProjectBomItem>):Promise<ProjectBomItem>{const local=await localInvoke<ProjectBomItem>('update_local_project_bom',{projectId:id,recordId:bomId,patch:data});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/bom/${bomId}`,{method:'PATCH',body:JSON.stringify(data)});if(!r.ok)throw await apiError(r,'Failed to update BOM item');return r.json();}
export async function deleteProjectBomItem(id:string,bomId:string):Promise<void>{const local=await localInvoke<void>('delete_local_project_bom',{projectId:id,recordId:bomId});if(local!==null)return;const r=await apiFetch(`/projects/${id}/bom/${bomId}`,{method:'DELETE'});if(!r.ok)throw await apiError(r,'Failed to delete BOM item');}

export async function getTaskExperiments(id:string,taskId:string):Promise<any[]>{const local=await localInvoke<any[]>('get_local_project_task_experiments',{projectId:id,taskId});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/tasks/${taskId}/experiments`);if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch task experiments'));return r.json();}
export async function linkTaskExperiment(id:string,taskId:string,experiment_id:string,relationship='related'):Promise<any>{const local=await localInvoke<any>('create_local_project_task_experiment',{projectId:id,taskId,record:{experiment_id,relationship}});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/tasks/${taskId}/experiments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({experiment_id,relationship})});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to link experiment'));return r.json();}
export async function unlinkTaskExperiment(id:string,taskId:string,experimentId:string):Promise<void>{const local=await localInvoke<any[]>('get_local_project_task_experiments',{projectId:id,taskId});if(local!==null){const link=local.find((x:any)=>x.experiment_id===experimentId);if(!link)throw new Error('Task experiment link not found');await localInvoke<void>('delete_local_project_task_experiment',{projectId:id,linkId:link.id});return;}const r=await apiFetch(`/projects/${id}/tasks/${taskId}/experiments/${experimentId}`,{method:'DELETE'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to unlink experiment'));}
export async function getExperimentMeasurements(id:string,experimentId:string):Promise<any[]>{const local=await localInvoke<any[]>('get_local_project_experiments',{projectId:id});if(local!==null){const e=local.find((x:any)=>x.id===experimentId);if(e)return e.measurements||[];}const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/measurements`);if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch measurements'));return r.json();}
export async function createExperimentMeasurement(id:string,experimentId:string,data:any):Promise<any>{const local=await localInvoke<any>('create_local_project_experiment_measurement',{projectId:id,experimentId,record:data});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/measurements`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to create measurement'));return r.json();}
export async function deleteExperimentMeasurement(id:string,experimentId:string,measurementId:string):Promise<void>{const local=await localInvoke<void>('delete_local_project_experiment_measurement',{projectId:id,experimentId,recordId:measurementId});if(local!==null)return;const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/measurements/${measurementId}`,{method:'DELETE'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to delete measurement'));}
export async function getExperimentObservations(id:string,experimentId:string):Promise<any[]>{const local=await localInvoke<any[]>('get_local_project_experiments',{projectId:id});if(local!==null){const e=local.find((x:any)=>x.id===experimentId);if(e)return e.observations||[];}const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/observations`);if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch observations'));return r.json();}
export async function createExperimentObservation(id:string,experimentId:string,data:any):Promise<any>{const local=await localInvoke<any>('create_local_project_experiment_observation',{projectId:id,experimentId,record:data});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/observations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to create observation'));return r.json();}
export async function deleteExperimentObservation(id:string,experimentId:string,observationId:string):Promise<void>{const local=await localInvoke<void>('delete_local_project_experiment_observation',{projectId:id,experimentId,recordId:observationId});if(local!==null)return;const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/observations/${observationId}`,{method:'DELETE'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to delete observation'));}
export async function getExperimentRevisions(id:string,experimentId:string):Promise<any[]>{const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/revisions`);if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch revisions'));return r.json();}

export async function getTaskAttachments(id:string,taskId:string):Promise<any[]>{const local=await localInvoke<any[]>('get_local_project_attachments',{projectId:id,workId:taskId,workType:'task'});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/tasks/${taskId}/attachments`);if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch task attachments'));return r.json();}
export async function attachTaskResource(id:string,taskId:string,resource_id:string):Promise<any>{const local=await localInvoke<any>('create_local_project_attachment',{projectId:id,workId:taskId,workType:'task',resourceId:resource_id});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/tasks/${taskId}/attachments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource_id})});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to attach resource'));return r.json();}
export async function removeTaskAttachment(id:string,taskId:string,attachmentId:string):Promise<void>{const local=await localInvoke<any>('delete_local_project_attachment',{projectId:id,attachmentId});if(local!==null)return;const r=await apiFetch(`/projects/${id}/tasks/${taskId}/attachments/${attachmentId}`,{method:'DELETE'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to remove attachment'));}
export async function getExperimentAttachments(id:string,experimentId:string):Promise<any[]>{const local=await localInvoke<any[]>('get_local_project_attachments',{projectId:id,workId:experimentId,workType:'experiment'});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/attachments`);if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch experiment attachments'));return r.json();}
export async function attachExperimentResource(id:string,experimentId:string,resource_id:string):Promise<any>{const local=await localInvoke<any>('create_local_project_attachment',{projectId:id,workId:experimentId,workType:'experiment',resourceId:resource_id});if(local!==null)return local;const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/attachments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource_id})});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to attach resource'));return r.json();}
export async function removeExperimentAttachment(id:string,experimentId:string,attachmentId:string):Promise<void>{const local=await localInvoke<any>('delete_local_project_attachment',{projectId:id,attachmentId});if(local!==null)return;const r=await apiFetch(`/projects/${id}/experiments/${experimentId}/attachments/${attachmentId}`,{method:'DELETE'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to remove attachment'));}

export interface ProjectReviewEvent {id:string;decision:'submit'|'request_changes'|'approve';note:string|null;created_at:string;actor:string;}
export interface ProjectReview {project:Pick<Project,'id'|'status'|'priority'|'start_date'|'due_date'> & {review_status:'draft'|'submitted'|'changes_requested'|'approved'};events:ProjectReviewEvent[];}
export async function getProjectReview(projectId:string):Promise<ProjectReview>{
 const r=await apiFetch(`/projects/${projectId}/review`);
 if(!r.ok)throw new Error(await getApiErrorMessage(r,'Unable to load project review'));
 return r.json();
}
export async function decideProjectReview(projectId:string,decision:'submit'|'request_changes'|'approve',note:string):Promise<Project>{
 const r=await apiFetch(`/projects/${projectId}/review`,{method:'POST',body:JSON.stringify({decision,note})});
 if(!r.ok)throw new Error(await getApiErrorMessage(r,'Unable to submit project review'));
 return r.json();
}

export interface ProjectReservation {id:string;project_id:string;item_id:string;item_name:string;quantity:number|string;original_quantity?:number|string;fulfilled_quantity?:number|string;needed_from:string;needed_until:string|null;status:'pending_review'|'confirmed'|'rejected'|'released'|'proposed'|'fulfilled';note:string|null;review_note:string|null;project_priority:string;project_start_date:string|null;project_due_date:string|null;created_at:string;}
export async function getProjectReservations(projectId:string):Promise<ProjectReservation[]>{
 const r=await apiFetch(`/projects/${projectId}/reservations`);
 if(!r.ok)throw new Error(await getApiErrorMessage(r,'Unable to load reservations'));
 return r.json();
}
export async function requestProjectReservation(projectId:string,input:{item_id:string;quantity:number;needed_from:string;needed_until?:string;note?:string}):Promise<ProjectReservation>{
 const r=await apiFetch(`/projects/${projectId}/reservations`,{method:'POST',body:JSON.stringify(input)});
 if(!r.ok)throw new Error(await getApiErrorMessage(r,'Unable to request reservation'));
 return r.json();
}
export async function decideProjectReservation(projectId:string,reservationId:string,decision:'confirm'|'reject'|'release',review_note:string):Promise<ProjectReservation>{
 const r=await apiFetch(`/projects/${projectId}/reservations/${reservationId}/decision`,{method:'POST',body:JSON.stringify({decision,review_note})});
 if(!r.ok)throw new Error(await getApiErrorMessage(r,'Unable to decide reservation'));
 return r.json();
}

export interface ReservationReviewQueueItem extends ProjectReservation {project_name:string;project_status:string;item_type:string;current_quantity:number|string;overlapping_confirmed:number|string;}
export async function getReservationReviewQueue():Promise<ReservationReviewQueueItem[]>{
 const r=await apiFetch('/projects/reservations/review-queue');
 if(!r.ok)throw new Error(await getApiErrorMessage(r,'Unable to load reservation review queue'));
 return r.json();
}

export async function fulfillProjectReservation(projectId:string,reservationId:string,quantity:number):Promise<{reservation:ProjectReservation;movement:{id:string;quantity:number|string};already_fulfilled?:boolean}>{
 const r=await apiFetch(`/projects/${projectId}/reservations/${reservationId}/fulfill`,{method:'POST'});
 if(!r.ok)throw new Error(await getApiErrorMessage(r,'Unable to fulfill reservation'));
 return r.json();
}
