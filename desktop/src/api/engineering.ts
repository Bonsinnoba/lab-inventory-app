import { apiFetch } from './http';
import { localBackend } from './local-backend';

async function parse(r:Response,f:string){if(!r.ok){const x=await r.json().catch(()=>null);throw new Error(x?.error?.message||x?.error||f)}return r.status===204?undefined:r.json()}
export const getEngineeringFormulas=async()=>{
  if(localBackend.isAvailable()) return localBackend.invoke<any[]>('get_local_engineering_formulas');
  return parse(await apiFetch('/engineering/formulas'),'Failed to load formulas');
};
export const calculateEngineering=async(formula:string,inputs:any)=>{
  if(localBackend.isAvailable()) return localBackend.invoke<any>('calculate_local_engineering',{formula,inputs});
  return parse(await apiFetch('/engineering/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({formula,inputs})}),'Calculation failed');
};
export const getCalculations=async()=>{
  if(localBackend.isAvailable()) return localBackend.invoke<any[]>('get_local_engineering_calculations');
  return parse(await apiFetch('/engineering/calculations'),'Failed to load calculations');
};
export const saveCalculation=async(data:any)=>{
  if(localBackend.isAvailable()) return localBackend.invoke<any>('create_local_engineering_calculation',{record:data});
  return parse(await apiFetch('/engineering/calculations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to save calculation');
};
export const deleteCalculation=async(id:string)=>{
  if(localBackend.isAvailable()) return localBackend.invoke<void>('delete_local_engineering_calculation',{id});
  return parse(await apiFetch(`/engineering/calculations/${id}`,{method:'DELETE'}),'Failed to delete calculation');
};
export const getEngineeringTests=async()=>{
  if(localBackend.isAvailable()) return localBackend.invoke<any[]>('get_local_engineering_tests');
  return parse(await apiFetch('/engineering/tests'),'Failed to load engineering tests');
};
export const createEngineeringTest=async(data:any)=>{
  if(localBackend.isAvailable()) return localBackend.invoke<any>('create_local_engineering_test',{record:data});
  return parse(await apiFetch('/engineering/tests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to create test');
};
export const updateEngineeringTest=async(id:string,data:any)=>{
  if(localBackend.isAvailable()) return localBackend.invoke<any>('update_local_engineering_test',{id,patch:data});
  return parse(await apiFetch(`/engineering/tests/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to update test');
};
export const deleteEngineeringTest=async(id:string)=>{
  if(localBackend.isAvailable()) return localBackend.invoke<void>('delete_local_engineering_test',{id});
  return parse(await apiFetch(`/engineering/tests/${id}`,{method:'DELETE'}),'Failed to delete test');
};
export const compareCalculations=async(ids:string[])=>{
  if(localBackend.isAvailable()){
    const rows=await localBackend.invoke<any[]>('get_local_engineering_calculations');
    const wanted=new Set(ids); return rows.filter(row=>wanted.has(String(row.id))).sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')));
  }
  return parse(await apiFetch(`/engineering/compare?ids=${encodeURIComponent(ids.join(','))}`),'Failed to compare calculations');
};
