import { apiFetch, getApiErrorMessage } from './http';

export type AccountRole = 'admin' | 'researcher' | 'technician' | 'viewer' | 'member';

export interface ManagedUser {
  id: string;
  username: string;
  role: AccountRole;
  is_active: boolean;
  last_login_at?: string | null;
  created_at: string;
}

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (!response.ok) throw new Error(await getApiErrorMessage(response, fallback));
}

export async function getManagedUsers(): Promise<ManagedUser[]> {
  const response = await apiFetch('/auth/users');
  await ensureOk(response, 'Failed to load users');
  return response.json();
}

export async function createManagedUser(data: { username: string; password: string; role: AccountRole }): Promise<ManagedUser> {
  const response = await apiFetch('/auth/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  await ensureOk(response, 'Failed to create user');
  const result = await response.json();
  return result.user;
}

export async function updateManagedUser(id: string, data: { role?: AccountRole; is_active?: boolean }): Promise<ManagedUser> {
  const response = await apiFetch(`/auth/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  await ensureOk(response, 'Failed to update user');
  const result = await response.json();
  return result.user;
}

export async function resetManagedUserPassword(id: string, new_password: string): Promise<void> {
  const response = await apiFetch(`/auth/users/${id}/password`, {
    method: 'POST',
    body: JSON.stringify({ new_password }),
  });
  await ensureOk(response, 'Failed to reset password');
}
