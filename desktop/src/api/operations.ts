import { apiFetch, getApiErrorMessage } from './http';
import { localBackend } from './local-backend';
import { getItems } from './items';
import { getProjects, getProjectBom, getProjectRequirements, createProjectRequirement, updateProjectRequirement, deleteProjectRequirement } from './projects';

export interface OperationsOverview {
  summary: { total_items:number; equipment:number; tools:number; components:number; materials:number; low_stock:number; stock_value:number };
  low_stock:any[]; calibration_due:any[]; maintenance_due:any[]; equipment:any[]; missing_bom:any[]; requirements:any[];
}
export interface Supplier { id:string; name:string; contact_name?:string|null; email?:string|null; phone?:string|null; website?:string|null; notes:string; item_count:number; }
export interface ResourceRequirement { id:string; project_id:string; project_name:string; name:string; requirement_type:string; quantity:number; unit?:string|null; required_by?:string|null; status:string; preferred_item_id?:string|null; preferred_item_name?:string|null; preferred_quantity?:number|null; notes?:string; }

async function json<T>(path:string, init?:RequestInit):Promise<T>{const r=await apiFetch(path,init);if(!r.ok)throw new Error(await getApiErrorMessage(r));return r.status===204?undefined as T:r.json();}

async function localOverview():Promise<OperationsOverview>{
  // Use the workstation's existing local-first project and inventory APIs.
  // Do not turn failed reads into empty arrays: an empty result means no shortages.
  const [items, projects, requirements] = await Promise.all([getItems(), getProjects(), getProjectRequirements()]);
  const bomByProject = await Promise.all(projects.map(async project => ({
    project, lines: await getProjectBom(project.id),
  })));
  const quantities = new Map(items.map(item => [item.id, Number(item.current_quantity || 0)]));
  const missing_bom = bomByProject.flatMap(({project,lines}) => lines.filter(line => {
    const required = Number(line.required_quantity);
    return !(line.preferred_item_id && (quantities.get(line.preferred_item_id) ?? 0) >= required)
      && !(line.alternative_item_id && (quantities.get(line.alternative_item_id) ?? 0) >= required);
  }).map(line => ({...line, project_name:project.name, availability:'missing'})));
  const low_stock = items.filter(item => item.status === 'low_stock' || Number(item.current_quantity) <= Number(item.initial_quantity || 0) * 0.2);
  const now = new Date();
  const due = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const calibration_due = items.filter(item => item.next_calibration_date && new Date(item.next_calibration_date) <= due);
  const equipment = items.filter(item => ['equipment','instrument','tool'].includes(item.type));
  const enrichedRequirements = requirements.filter(row => !['fulfilled','cancelled'].includes(row.status)).map(row => {
    const match = items.find(item => item.id === row.preferred_item_id);
    return {...row, preferred_item_name:match?.name ?? row.preferred_item_name ?? null,
      preferred_quantity:match?.current_quantity ?? null};
  });
  return {
    summary: {
      total_items:items.length,
      equipment:items.filter(item => item.type === 'equipment').length,
      tools:items.filter(item => item.type === 'tool').length,
      components:items.filter(item => ['component','spare_part'].includes(item.type)).length,
      materials:items.filter(item => item.type === 'material').length,
      low_stock:low_stock.length,
      stock_value:items.reduce((sum,item) => sum + Number(item.current_quantity || 0) * Number(item.unit_cost || 0),0),
    },
    low_stock, calibration_due, maintenance_due:[], equipment, missing_bom, requirements:enrichedRequirements,
  };
}
export const getOperationsOverview=()=>localBackend.isAvailable()?localOverview():json<OperationsOverview>('/operations/overview');
export const getSuppliers=()=>json<Supplier[]>('/operations/suppliers');
export const createSupplier=(body:Partial<Supplier>)=>json<Supplier>('/operations/suppliers',{method:'POST',body:JSON.stringify(body)});
export const updateSupplier=(id:string,body:Partial<Supplier>)=>json<Supplier>(`/operations/suppliers/${id}`,{method:'PATCH',body:JSON.stringify(body)});
export const deleteSupplier=(id:string)=>json<void>(`/operations/suppliers/${id}`,{method:'DELETE'});
export const getRequirements=(projectId?:string)=>localBackend.isAvailable()?getProjectRequirements(projectId):json<ResourceRequirement[]>(`/operations/requirements${projectId?`?project_id=${encodeURIComponent(projectId)}`:''}`);
export const createRequirement=(body:Partial<ResourceRequirement>)=>body.project_id?createProjectRequirement(body.project_id,body):json<ResourceRequirement>('/operations/requirements',{method:'POST',body:JSON.stringify(body)});
export const updateRequirement=(id:string,body:Partial<ResourceRequirement>)=>body.project_id?updateProjectRequirement(body.project_id,id,body):json<ResourceRequirement>(`/operations/requirements/${id}`,{method:'PATCH',body:JSON.stringify(body)});
export const deleteRequirement=(id:string,body?:{project_id?:string})=>body?.project_id?deleteProjectRequirement(body.project_id,id):json<void>(`/operations/requirements/${id}`,{method:'DELETE'});
