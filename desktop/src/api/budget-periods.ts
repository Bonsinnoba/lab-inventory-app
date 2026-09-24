import { apiFetch } from './http';
import { invoke } from '@tauri-apps/api/tauri';
const isTauri=()=>typeof window!=='undefined'&&Boolean((window as any).__TAURI_IPC__);

export interface BudgetPeriod {
  id: string;
  label: string;
  total_budget: number;
  start_date?: string;
  end_date?: string;
  notes?: string;
  created_at: string;
}

export async function getBudgetPeriods(): Promise<BudgetPeriod[]> { if(isTauri())try{return await invoke<BudgetPeriod[]>('get_local_budget_periods')}catch{} const response=await apiFetch('/budget-periods');if(!response.ok)throw new Error('Failed to fetch');return response.json(); }

export async function getCurrentBudgetPeriod(): Promise<BudgetPeriod | null> {
  if (isTauri()) {
    try {
      const periods = await invoke<BudgetPeriod[]>('get_local_budget_periods');
      const today = new Date().toISOString().slice(0, 10);
      const current = periods
        .filter((period) => {
          const start = period.start_date ? String(period.start_date).slice(0, 10) : '';
          const end = period.end_date ? String(period.end_date).slice(0, 10) : '';
          return (!start || start <= today) && (!end || end >= today);
        })
        .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))[0];
      return current || null;
    } catch {}
  }
  const response = await apiFetch(`/budget-periods/current`);
  if (!response.ok) throw new Error('Failed to fetch current budget period');
  return response.json();
}

export async function createBudgetPeriod(value:any):Promise<BudgetPeriod>{if(isTauri()){return await invoke<BudgetPeriod>('create_local_budget_period',{period:value})} const response=await apiFetch('/budget-periods',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!response.ok)throw new Error('Failed to create');return response.json();}

export async function updateBudgetPeriod(id:string,value:any):Promise<BudgetPeriod>{if(isTauri()){return await invoke<BudgetPeriod>('update_local_budget_period',{id,period:value})} const response=await apiFetch(`/budget-periods/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!response.ok)throw new Error('Failed to update');return response.json();}

export async function deleteBudgetPeriod(id:string):Promise<void>{if(isTauri()){await invoke('delete_local_budget_period',{id});return} const response=await apiFetch(`/budget-periods/${id}`,{method:'DELETE'});if(!response.ok)throw new Error('Failed to delete');}
