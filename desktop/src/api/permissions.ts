import { apiFetch, getApiErrorMessage } from './http';
import { invoke } from '@tauri-apps/api/tauri';
import { getToken, captureServerRequest, isServerRequestCurrent, observeNativeAuthFailure } from './auth';

export type PermissionEffect = 'inherited' | 'grant' | 'deny';
export type PermissionEntry = { permission: string; baseline: boolean; effect: PermissionEffect; effective: boolean };
export type CurrentPermissionEntry = { permission: string; effective: boolean };

export async function getCurrentUserPermissions(): Promise<{ user: { id: string; username: string; role: string }; permissions: CurrentPermissionEntry[] }> {
  const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__;
  const token = getToken();
  const offlineLocalSession = isTauri && (!token || token.startsWith('local:') || (typeof navigator !== 'undefined' && !navigator.onLine));
  if (offlineLocalSession) {
    try {
      const permissions = await invoke<string[]>('local_current_permissions');
      const localUser = await invoke<{ id: string; username: string; role: string }>('local_current_user');
      return { user: localUser, permissions: permissions.map((permission) => ({ permission, effective: true })) };
    } catch {
      // Fall through to the central session while online.
    }
  }
  let response: Response;
  const context = token && !token.startsWith('local:') ? await captureServerRequest(token) : null;
  try {
    response = await apiFetch('/auth/me/permissions');
  } catch (error) {
    // A central network failure is the one case where a previously authorized
    // Tauri installation may continue offline. Do not use this fallback for
    // HTTP 401/403 responses; those are authoritative server decisions.
    if (isTauri && token && !token.startsWith('local:')) {
      try {
        const permissions = await invoke<string[]>('local_current_permissions');
        const localUser = await invoke<{ id: string; username: string; role: string }>('local_current_user');
        return { user: localUser, permissions: permissions.map((permission) => ({ permission, effective: true })) };
      } catch {
        // Preserve the original central-network error below.
      }
    }
    throw error;
  }
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to load current permissions'));
  const body = await response.json();
  if (isTauri) {
    const token = getToken();
    if (token && !token.startsWith('local:') && context?.nativeSessionToken && isServerRequestCurrent(context) && body?.user?.id === context.accountId) {
      try {
        await invoke('cache_server_permissions', {
          centralUserId: body?.user?.id,
          serverToken: context.token,
          expectedSessionToken: context.nativeSessionToken,
        });
      } catch (error) { await observeNativeAuthFailure(error, context); }
    }
  }
  if (context && !isServerRequestCurrent(context)) throw new Error('Session changed during permission refresh');
  return body;
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
