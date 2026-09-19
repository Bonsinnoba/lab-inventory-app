import { API_BASE } from '../lib/config';
import { invoke } from '@tauri-apps/api/tauri';

function isTauriRuntime(): boolean { return typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__; }
async function localInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T | null> { if (!isTauriRuntime()) return null; return invoke<T>(command, args); }

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

export async function getLocalAuthStatus(): Promise<LocalAuthStatus | null> {
  return localInvoke<LocalAuthStatus>('local_auth_status');
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const local = await localInvoke<AuthResponse>('local_login', { username, password });
  if (local !== null) return local;
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }
  return response.json();
}

export async function register(username: string, password: string, role?: 'admin' | 'member'): Promise<AuthResponse> {
  const local = await localInvoke<AuthResponse>('bootstrap_local_admin', { username, password });
  if (local !== null) return local;
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
  const local = await localInvoke<User | null>('local_current_user');
  if (local !== null) return { user: local };
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error('Failed to get current user');
  }
  return response.json();
}

export async function changePassword(current_password: string, new_password: string): Promise<void> {
  const local = await localInvoke<void>('local_change_password', { currentPassword: current_password, newPassword: new_password });
  if (local !== null) return;
  const response = await fetch(`${API_BASE}/auth/me/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
    body: JSON.stringify({ current_password, new_password }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
    throw new Error(message || 'Failed to update password');
  }
}

export async function updateProfile(display_name: string, email: string): Promise<User> {
  const local = await localInvoke<User>('local_update_profile', { displayName: display_name, email });
  if (local !== null) return local;
  const response = await fetch(`${API_BASE}/auth/me/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
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

export function getStoredUser(): User | null {
  const userStr = localStorage.getItem('auth_user');
  return userStr ? JSON.parse(userStr) : null;
}

export function removeStoredUser(): void {
  localStorage.removeItem('auth_user');
}
