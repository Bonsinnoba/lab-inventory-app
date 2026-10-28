import {apiFetch} from './http';
import {isTauriRuntime} from '../lib/runtime';
import {captureAccountSession} from './auth';
import {readLocalSections,readWithDeadline,assertReadAccount,type ReadAvailability} from './read-availability';
import {getProject,getProjectWorkspace,getProjectReservations} from './projects';
import {getItems} from './items';
import {getNotes} from './notes';
import {getResources} from './resources';
export interface ProjectContext {
 availability?:ReadAvailability;
 schema_version:number; scope:{type:'project';id:string};generated_at:string;freshness:string;access:string;
 project:{id:string;name:string;status:string;description?:string};
 sections:{experiments:Array<{id:string;title:string;status:string}>;tasks:Array<{id:string;title:string;status:string}>;inventory:Array<{item_id:string;name:string;current_quantity:string|number;unit:string}>;reservations:Array<{id:string;item_name:string;quantity:string|number;status:string}>;notes:Array<{id:string;title:string}>;resources:Array<{id:string;name:string}>};
 provenance:{authority:string;source:string;truncated:Record<string,boolean>};
}
export async function getProjectContext(id:string):Promise<ProjectContext>{
 if(isTauriRuntime())return getLocalProjectContext(id);
 const response=await apiFetch(`/context/projects/${encodeURIComponent(id)}`);
 if(!response.ok)throw new Error(response.status===404?'Project context unavailable or access denied':'Unable to retrieve central project context');
 return response.json();
}

async function getLocalProjectContext(id:string):Promise<ProjectContext>{
 const session=captureAccountSession();
 assertReadAccount(session);
 // Project access is mandatory; a failed root read never falls back to HTTP.
 const project=await readWithDeadline(()=>getProject(id));
 assertReadAccount(session);
 if(!project||project.id!==id)throw new Error('Project context unavailable or access denied');
 const {values,availability}=await readLocalSections({
  workspace:()=>getProjectWorkspace(id),inventory:getItems,
  reservations:()=>getProjectReservations(id),notes:()=>getNotes({project_id:id}),resources:()=>getResources({project_id:id}),
 },session);
 const collection=(key:string,value:unknown):any[]=>{
  if(!Array.isArray(value)){availability.sections[key]='unavailable';return [];}
  availability.sections[key]='available';return value;
 };
 const tasks=collection('tasks',values.workspace?.tasks);
 const experiments=collection('experiments',values.workspace?.experiments);
 const linked=collection('inventory',values.workspace?.items);
 const inventoryAvailable=Array.isArray(values.inventory)&&availability.sections.inventory==='available';
 const inventory=inventoryAvailable?linked.flatMap(link=>{
  const item=values.inventory!.find(item=>item.id===link.item_id);
  return item?[{item_id:item.id,name:item.name,current_quantity:item.current_quantity,unit:item.unit||''}]:[];
 }):[];
 if(!inventoryAvailable)availability.sections.inventory='unavailable';
 else if(inventory.length!==linked.length)availability.sections.inventory='partial';
 const reservations=collection('reservations',values.reservations);
 const notes=collection('notes',values.notes);
 const resources=collection('resources',values.resources);
 delete availability.sections.workspace;
 assertReadAccount(session);
 return {schema_version:1,scope:{type:'project',id},generated_at:availability.readAt,
  freshness:'local_read_not_server_confirmation',access:values.workspace?.permissions?.access||'view',
  project:{id:project.id,name:project.name,status:project.status,description:project.description||undefined},
  sections:{tasks,experiments,inventory,reservations,notes,resources},availability,
  provenance:{authority:'cached_account_permissions',source:'local_repositories',truncated:{}},
 };
}
