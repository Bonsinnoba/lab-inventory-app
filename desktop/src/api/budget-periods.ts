import { apiFetch } from './http';

export interface BudgetPeriod {
  id: string;
  label: string;
  total_budget: number;
  start_date?: string;
  end_date?: string;
  notes?: string;
  created_at: string;
}

export async function getBudgetPeriods(): Promise<BudgetPeriod[]> {
  const response = await apiFetch(`/budget-periods`);
  if (!response.ok) throw new Error('Failed to fetch budget periods');
  return response.json();
}

export async function getCurrentBudgetPeriod(): Promise<BudgetPeriod | null> {
  const response = await apiFetch(`/budget-periods/current`);
  if (!response.ok) throw new Error('Failed to fetch current budget period');
  return response.json();
}

export async function createBudgetPeriod(period: Omit<BudgetPeriod, 'id' | 'created_at'>): Promise<BudgetPeriod> {
  const response = await apiFetch(`/budget-periods`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(period),
  });
  if (!response.ok) throw new Error('Failed to create budget period');
  return response.json();
}

export async function updateBudgetPeriod(id: string, period: Partial<BudgetPeriod>): Promise<BudgetPeriod> {
  const response = await apiFetch(`/budget-periods/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(period),
  });
  if (!response.ok) throw new Error('Failed to update budget period');
  return response.json();
}

export async function deleteBudgetPeriod(id: string): Promise<void> {
  const response = await apiFetch(`/budget-periods/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete budget period');
}
