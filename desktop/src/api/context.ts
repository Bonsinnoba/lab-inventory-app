import {apiFetch} from './http';
export interface ProjectContext {
 schema_version:number; scope:{type:'project';id:string};generated_at:string;freshness:string;access:string;
 project:{id:string;name:string;status:string;description?:string};
 sections:{experiments:Array<{id:string;title:string;status:string}>;tasks:Array<{id:string;title:string;status:string}>;inventory:Array<{item_id:string;name:string;current_quantity:string|number;unit:string}>;reservations:Array<{id:string;item_name:string;quantity:string|number;status:string}>;notes:Array<{id:string;title:string}>;resources:Array<{id:string;name:string}>};
 provenance:{authority:string;source:string;truncated:Record<string,boolean>};
}
export async function getProjectContext(id:string):Promise<ProjectContext>{
 const response=await apiFetch(`/context/projects/${encodeURIComponent(id)}`);
 if(!response.ok)throw new Error(response.status===404?'Project context unavailable or access denied':'Unable to retrieve central project context');
 return response.json();
}
