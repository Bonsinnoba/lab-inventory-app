import { apiFetch } from './http';
import { invoke } from '@tauri-apps/api/tauri';
const isTauri=()=>typeof window!=='undefined'&&Boolean((window as any).__TAURI_IPC__);

export interface Transaction {
  id: string;
  type: 'purchase' | 'repair' | 'replacement' | 'project_expense' | 'other' | 'donation' | 'investment' | 'grant' | 'lab_allocation' | 'other_income';
  direction: 'income' | 'expense';
  amount: number;
  date: string;
  vendor?: string;
  notes?: string;
  item_id?: string;
  project_id?: string;
  budget_period_id?: string;
  logged_by?: string;
  funding_source_id?: string;
  budget_period_label?: string | null;
  // Present on results from the list endpoint (GET /api/transactions),
  // joined server-side for display -- not stored on the transaction itself.
  item_name?: string | null;
  project_name?: string | null;
  funding_source_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionSummary {
  totals: {
    income: number;
    expense: number;
    net: number;
  };
  by_category: {
    expense: Array<{ type: string; total: number }>;
    income: Array<{ type: string; total: number }>;
  };
  by_month: Array<{ month: string; direction: string; type: string; total: number }>;
  budget?: {
    period_id: string;
    label: string;
    total_budget: number;
    spent: number;
    remaining: number;
  };
}

export async function getTransactions(filters?: any): Promise<Transaction[]> { if(isTauri()&&!filters){try{return await invoke<Transaction[]>('get_local_transactions')}catch{}} const params=new URLSearchParams(); if(filters)Object.entries(filters).forEach(([k,v])=>v&&params.append(k,String(v))); const response=await apiFetch(`/transactions?${params}`); if(!response.ok)throw new Error('Failed to fetch transactions'); return response.json(); }

export async function getTransactionSummary(filters?: {
  from?: string;
  to?: string;
  budget_period_id?: string;
}): Promise<TransactionSummary> {
  const params = new URLSearchParams();
  if (filters?.from) params.append('from', filters.from);
  if (filters?.to) params.append('to', filters.to);
  if (filters?.budget_period_id) params.append('budget_period_id', filters.budget_period_id);
  
  if (isTauri()) {
    try {
      const transactions = await getTransactions(filters);
      const income = transactions.filter((t) => t.direction === 'income');
      const expense = transactions.filter((t) => t.direction === 'expense');
      const group = (rows: Transaction[]) => {
        const totals = new Map<string, number>();
        for (const row of rows) totals.set(row.type, (totals.get(row.type) || 0) + Number(row.amount || 0));
        return Array.from(totals, ([type, total]) => ({ type, total }));
      };
      const monthly = new Map<string, { month: string; direction: string; type: string; total: number }>();
      for (const row of transactions) {
        const month = String(row.date || row.created_at).slice(0, 7);
        const key = `${month}|${row.direction}|${row.type}`;
        const current = monthly.get(key);
        if (current) current.total += Number(row.amount || 0);
        else monthly.set(key, { month, direction: row.direction, type: row.type, total: Number(row.amount || 0) });
      }
      const summary: TransactionSummary = {
        totals: {
          income: income.reduce((sum, row) => sum + Number(row.amount || 0), 0),
          expense: expense.reduce((sum, row) => sum + Number(row.amount || 0), 0),
          net: income.reduce((sum, row) => sum + Number(row.amount || 0), 0) - expense.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        },
        by_category: { expense: group(expense), income: group(income) },
        by_month: Array.from(monthly.values()).sort((a, b) => a.month.localeCompare(b.month) || a.direction.localeCompare(b.direction) || a.type.localeCompare(b.type)),
      };
      if (filters?.budget_period_id) {
        const periods = await invoke<any[]>('get_local_budget_periods');
        const period = periods.find((item) => item.id === filters.budget_period_id);
        if (period) {
          const spent = expense.filter((row) => row.budget_period_id === period.id).reduce((sum, row) => sum + Number(row.amount || 0), 0);
          const total_budget = Number(period.total_budget || 0);
          summary.budget = { period_id: period.id, label: period.label, total_budget, spent, remaining: total_budget - spent };
        }
      }
      return summary;
    } catch {}
  }
  const response = await apiFetch(`/transactions/summary?${params}`);
  if (!response.ok) throw new Error('Failed to fetch transaction summary');
  return response.json();
}

export async function createTransaction(transaction: Omit<Transaction,'id'|'created_at'|'updated_at'>): Promise<Transaction> { if(isTauri())try{return await invoke<Transaction>('create_local_transaction',{transaction})}catch{} const response=await apiFetch('/transactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(transaction)});if(!response.ok)throw new Error('Failed to create transaction');return response.json(); }

export async function updateTransaction(id:string,transaction:Partial<Transaction>):Promise<Transaction>{if(isTauri())try{return await invoke<Transaction>('update_local_transaction',{id,transaction})}catch{} const response=await apiFetch(`/transactions/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(transaction)});if(!response.ok)throw new Error('Failed to update transaction');return response.json();}

export async function deleteTransaction(id:string):Promise<void>{if(isTauri())try{await invoke('delete_local_transaction',{id});return}catch{} const response=await apiFetch(`/transactions/${id}`,{method:'DELETE'});if(!response.ok)throw new Error('Failed to delete transaction');}
