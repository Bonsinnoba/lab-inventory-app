import { API_BASE } from '../lib/config';
import { invoke } from '@tauri-apps/api/tauri';

function isTauriRuntime(): boolean { return typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__; }
async function localInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<NonNullable<T> | null> { if (!isTauriRuntime()) return null; return invoke<T>(command, args) as Promise<NonNullable<T>>; }

export type User = {
  id: string;
  username: string;
  role: 'admin' | 'researcher' | 'technician' | 'viewer' | 'member';
  display_name?: string | null;
  email?: string | null;
  is_active?: boolean;
  created_at: string;
};

export type AuthResponse = {
  user: User;
  token: string;
};

export type LocalAuthStatus = {
  bootstrapped: boolean;
  authenticated: boolean;
  user: User | null;
};

async function fetchServerPermissions(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/auth/me/permissions`, { headers: { Authorization: `Bearer ${getToken() || ''}` } });
  if (!response.ok) throw new Error('Unable to load your LabOS permissions');
  const body = await response.json();
  return Array.isArray(body?.permissions) ? body.permissions.filter((p: any) => p?.effective).map((p: any) => String(p.permission)) : [];
}

export async function getLocalAuthStatus(): Promise<LocalAuthStatus | null> {
  return localInvoke<LocalAuthStatus>('local_auth_status');
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const inTauri = isTauriRuntime();
  // In Tauri, navigator.onLine is not a reliable indicator for a LAN-only
  // LabOS server. Always try the central API first so a successful online
  // login refreshes the local password and permission cache; only fall back
  // to the cached account when the central request actually fails to connect.
  {
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (response.ok) {
        const result = await response.json() as AuthResponse;
        if (inTauri) {
          setToken(result.token);
          const permissions = await fetchServerPermissions();
          await localInvoke('cache_server_user', {
            centralUserId: result.user.id,
            username: result.user.username,
            password,
            role: result.user.role,
            displayName: result.user.display_name ?? null,
            email: result.user.email ?? null,
            permissions,
          });
        }
        return result;
      }
      const error = await response.json().catch(() => null);
      if (response.status >= 500 && inTauri) {
        removeToken();
        const local = await localInvoke<AuthResponse>('local_login', { username, password });
        if (local) return local;
      }
      throw new Error(error?.error?.message || error?.error || 'Login failed');
    } catch (error) {
      if (inTauri && (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError'))) {
        removeToken();
        const local = await localInvoke<AuthResponse>('local_login', { username, password });
        if (local) return local;
      }
      throw error;
    }
  }
  removeToken();
  const local = await localInvoke<AuthResponse>('local_login', { username, password });
  if (local) return local;
  throw new Error('Connect to LabOS to sign in on this installation.');
}

export async function register(username: string, password: string, role?: 'admin' | 'member'): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Registration failed');
  }
  return response.json();
}

export async function getCurrentUser(token: string): Promise<{ user: User }> {
  if (!token.startsWith('local:')) {
    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to get current user');
      const result = await response.json() as { user: User };
      if (isTauriRuntime()) {
        try {
          const permissions = await fetchServerPermissions();
          await localInvoke('cache_server_permissions', {
            centralUserId: result.user.id,
            role: result.user.role,
            permissions,
          });
        } catch {
          // Keep a valid authenticated session usable during a transient
          // permission-refresh failure; the existing local cache remains in place.
        }
      }
      return result;
    } catch (error) {
      // A central network outage must not discard a valid cached desktop
      // session. HTTP authentication failures remain authoritative and do
      // not fall back to the local cache.
      if (isTauriRuntime() && (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError'))) {
        const local = await localInvoke<User | null>('local_current_user');
        if (local !== null) return { user: local as User };
      }
      throw error;
    }
  }
  const local = await localInvoke<User | null>('local_current_user');
  if (local !== null) return { user: local as User };
  throw new Error('Local session is unavailable');
}

export async function changePassword(current_password: string, new_password: string): Promise<void> {
  const token = getToken();
  if (!token || token.startsWith('local:')) throw new Error('Reconnect to LabOS before changing your password.');
  const response = await fetch(`${API_BASE}/auth/me/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ current_password, new_password }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
    throw new Error(message || 'Failed to update password');
  }
}

export async function updateProfile(display_name: string, email: string): Promise<User> {
  const token = getToken();
  if (!token || token.startsWith('local:')) throw new Error('Reconnect to LabOS before updating your profile.');
  const response = await fetch(`${API_BASE}/auth/me/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ display_name, email }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
    throw new Error(message || 'Failed to update profile');
  }
  const result = await response.json();
  return result.user;
}

export async function logout(): Promise<void> {
  const local = await localInvoke<void>('local_logout');
  if (local !== null) return;
}

export function setToken(token: string): void {
  localStorage.setItem('auth_token', token);
}

export function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

export function removeToken(): void {
  localStorage.removeItem('auth_token');
}

export function setStoredUser(user: User): void {
  localStorage.setItem('auth_user', JSON.stringify(user));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('labos-user-updated'));
}

export async function getCurrentPermissions(): Promise<string[]> {
  if (isTauriRuntime()) {
    try {
      const permissions = await localInvoke<string[]>('local_current_permissions');
      if (permissions) return permissions;
    } catch {}
  }
  try {
    return await fetchServerPermissions();
  } catch {
    return [];
  }
}

export function getStoredUser(): User | null {
  const userStr = localStorage.getItem('auth_user');
  return userStr ? JSON.parse(userStr) : null;
}

export function removeStoredUser(): void {
  localStorage.removeItem('auth_user');
}
