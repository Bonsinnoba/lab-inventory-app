import { apiFetch, getApiErrorMessage } from './http';
import { invoke } from '@tauri-apps/api/tauri';

export type PermissionEffect = 'inherited' | 'grant' | 'deny';
export type PermissionEntry = { permission: string; baseline: boolean; effect: PermissionEffect; effective: boolean };
export type CurrentPermissionEntry = { permission: string; effective: boolean };

export async function getCurrentUserPermissions(): Promise<{ user: { id: string; username: string; role: string }; permissions: CurrentPermissionEntry[] }> {
  const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__;
  if (isTauri) {
    try {
      const permissions = await invoke<string[]>('local_current_permissions');
      const localUser = await invoke<{ id: string; username: string; role: string }>('local_current_user');
      return { user: localUser, permissions: permissions.map((permission) => ({ permission, effective: true })) };
    } catch {
      // Fall through to the central session while online.
    }
  }
  const response = await apiFetch('/auth/me/permissions');
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to load current permissions'));
  return response.json();
}

export async function getUserPermissions(userId: string): Promise<{ user: { id: string; username: string; role: string }; permissions: PermissionEntry[] }> {
  const response = await apiFetch(`/auth/users/${userId}/permissions`);
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to load permissions'));
  return response.json();
}

export async function updateUserPermissions(userId: string, overrides: Array<{ permission: string; effect: 'grant' | 'deny' }>): Promise<{ permissions: PermissionEntry[] }> {
  const response = await apiFetch(`/auth/users/${userId}/permissions`, { method: 'PUT', body: JSON.stringify({ overrides }) });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to update permissions'));
  return response.json();
}
