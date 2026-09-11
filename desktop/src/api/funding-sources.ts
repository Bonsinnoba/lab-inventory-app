import { apiFetch } from './http';

export interface FundingSource {
  id: string;
  name: string;
  source_type: 'donor' | 'investor' | 'grant_body' | 'institutional' | 'other';
  contact_info?: string;
  notes?: string;
  created_at: string;
  total_contributed?: number;
}

export async function getFundingSources(): Promise<FundingSource[]> {
  const response = await apiFetch(`/funding-sources`);
  if (!response.ok) throw new Error('Failed to fetch funding sources');
  return response.json();
}

export async function createFundingSource(source: Omit<FundingSource, 'id' | 'created_at' | 'total_contributed'>): Promise<FundingSource> {
  const response = await apiFetch(`/funding-sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source),
  });
  if (!response.ok) throw new Error('Failed to create funding source');
  return response.json();
}

export async function updateFundingSource(id: string, source: Partial<FundingSource>): Promise<FundingSource> {
  const response = await apiFetch(`/funding-sources/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source),
  });
  if (!response.ok) throw new Error('Failed to update funding source');
  return response.json();
}

export async function deleteFundingSource(id: string): Promise<void> {
  const response = await apiFetch(`/funding-sources/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete funding source');
}
