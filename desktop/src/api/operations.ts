import { apiFetch, getApiErrorMessage } from './http';
import { localBackend } from './local-backend';

export interface OperationsOverview {
  summary: { total_items:number; equipment:number; tools:number; components:number; materials:number; low_stock:number; stock_value:number };
  low_stock:any[]; calibration_due:any[]; maintenance_due:any[]; equipment:any[]; missing_bom:any[]; requirements:any[];
}
export interface Supplier { id:string; name:string; contact_name?:string|null; email?:string|null; phone?:string|null; website?:string|null; notes:string; item_count:number; }
export interface ResourceRequirement { id:string; project_id:string; project_name:string; name:string; requirement_type:string; quantity:number; unit?:string|null; required_by?:string|null; status:string; preferred_item_id?:string|null; preferred_item_name?:string|null; preferred_quantity?:number|null; notes?:string; }

async function json<T>(path:string, init?:RequestInit):Promise<T>{const r=await apiFetch(path,init);if(!r.ok)throw new Error(await getApiErrorMessage(r));return r.status===204?undefined as T:r.json();}

async function localOverview():Promise<OperationsOverview>{
  const [items, requirements] = await Promise.all([
    localBackend.invoke<any[]>('get_local_inventory_items'),
    localBackend.invoke<any[]>('get_local_resource_requirements').catch(()=>[]),
  ]);
  const total=(items||[]).length;
  const low=(items||[]).filter(i=>Number(i.quantity??i.current_quantity??0)<=Number(i.reorder_level??i.minimum_quantity??0));
  return {summary:{total_items:total,equipment:(items||[]).filter(i=>i.category==='equipment').length,tools:(items||[]).filter(i=>i.category==='tool').length,components:(items||[]).filter(i=>i.category==='component').length,materials:(items||[]).filter(i=>i.category==='material').length,low_stock:low.length,stock_value:(items||[]).reduce((s,i)=>s+Number(i.quantity??i.current_quantity??0)*Number(i.unit_cost??0),0)},low_stock:low,calibration_due:[],maintenance_due:[],equipment:(items||[]).filter(i=>i.category==='equipment'),missing_bom:[],requirements:requirements||[]};
}
export const getOperationsOverview=()=>localBackend.isAvailable()?localOverview():json<OperationsOverview>('/operations/overview');
export const getSuppliers=()=>json<Supplier[]>('/operations/suppliers');
export const createSupplier=(body:Partial<Supplier>)=>json<Supplier>('/operations/suppliers',{method:'POST',body:JSON.stringify(body)});
export const updateSupplier=(id:string,body:Partial<Supplier>)=>json<Supplier>(`/operations/suppliers/${id}`,{method:'PATCH',body:JSON.stringify(body)});
export const deleteSupplier=(id:string)=>json<void>(`/operations/suppliers/${id}`,{method:'DELETE'});
export const getRequirements=(projectId?:string)=>json<ResourceRequirement[]>(`/operations/requirements${projectId?`?project_id=${encodeURIComponent(projectId)}`:''}`);
export const createRequirement=(body:Partial<ResourceRequirement>)=>json<ResourceRequirement>('/operations/requirements',{method:'POST',body:JSON.stringify(body)});
export const updateRequirement=(id:string,body:Partial<ResourceRequirement>)=>json<ResourceRequirement>(`/operations/requirements/${id}`,{method:'PATCH',body:JSON.stringify(body)});
export const deleteRequirement=(id:string)=>json<void>(`/operations/requirements/${id}`,{method:'DELETE'});
