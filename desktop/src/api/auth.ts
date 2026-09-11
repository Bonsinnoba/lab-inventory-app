import { API_BASE } from '../lib/config';

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

export async function login(username: string, password: string): Promise<AuthResponse> {
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
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error('Failed to get current user');
  }
  return response.json();
}

export async function changePassword(current_password: string, new_password: string): Promise<void> {
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
