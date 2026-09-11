import { apiFetch } from './http';

export interface Location {
  id: string;
  name: string;
  type?: string;
  parent_id?: string | null;
  item_count?: number;
  created_at: string;
}

export async function getLocations(): Promise<Location[]> {
  const response = await apiFetch(`/locations`);
  if (!response.ok) throw new Error('Failed to fetch locations');
  return response.json();
}

export async function getLocation(id: string): Promise<Location> {
  const response = await apiFetch(`/locations/${id}`);
  if (!response.ok) throw new Error('Failed to fetch location');
  return response.json();
}
