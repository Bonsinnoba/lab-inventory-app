import { API_BASE } from '../lib/config';
import { invoke } from '@tauri-apps/api/tauri';

function isTauriRuntime(): boolean { return typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__; }
async function localInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<NonNullable<T> | null> { if (!isTauriRuntime()) return null; return invoke<T>(command, args) as Promise<NonNullable<T>>; }

export type User = {
  id: string;
  central_user_id?: string | null;
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
  token?: string | null;
};

function localUser(user: User): User {
  if (!user.central_user_id) throw new Error('Cached account has no verified server identity');
  return { ...user, id: user.central_user_id };
}

export type ServerRequestContext = {
  token: string; accountId: string | null; generation: number; nativeSessionToken: string | null;
};

export async function captureServerRequest(token: string): Promise<ServerRequestContext> {
  const context: ServerRequestContext = { token, accountId: getStoredUser()?.id ?? null, generation: sessionGeneration, nativeSessionToken: null };
  if (isTauriRuntime() && context.accountId && getToken() === token && !token.startsWith('local:')) {
    context.nativeSessionToken = await localInvoke<string>('local_authorization_guard', { expectedAccountId: context.accountId });
  }
  return context;
}

export function isServerRequestCurrent(context: ServerRequestContext): boolean {
  return context.generation === sessionGeneration && getToken() === context.token && (getStoredUser()?.id ?? null) === context.accountId;
}

async function endServerSession(context: ServerRequestContext, revokeOffline: boolean): Promise<void> {
  if (!isServerRequestCurrent(context)) return;
  if (revokeOffline && context.nativeSessionToken && context.accountId) {
    const locked = await localInvoke<boolean>('invalidate_local_authorization', {
      expectedAccountId: context.accountId, expectedSessionToken: context.nativeSessionToken,
    });
    // A different native login won the race. Never lock or sign out that login.
    if (locked !== true) return;
  }
  if (!isServerRequestCurrent(context)) return;
  removeToken(); removeStoredUser();
  window.dispatchEvent(new Event('labos:auth-expired'));
}

export async function observeServerAuthResponse(response: Response, context: ServerRequestContext): Promise<void> {
  if (response.status !== 401 || !isServerRequestCurrent(context)) return;
  const body = await response.clone().json().catch(() => null);
  const revoked = body?.error?.code === 'SESSION_REVOKED' || body?.error?.code === 'ACCOUNT_DISABLED';
  await endServerSession(context, revoked);
}

export async function observeNativeAuthFailure(error: unknown, context: ServerRequestContext): Promise<void> {
  if (String(error).startsWith('AUTH_REVOKED:')) await endServerSession(context, false);
}

async function cachePermissions(user: User, context: ServerRequestContext): Promise<string[]> {
  if (!isServerRequestCurrent(context) || context.accountId !== user.id || !context.nativeSessionToken) {
    throw new Error('Session changed or native authorization is unavailable');
  }
  let permissions: string[] | null;
  try {
    permissions = await localInvoke<string[]>('cache_server_permissions', {
      centralUserId: user.id, serverToken: context.token, expectedSessionToken: context.nativeSessionToken,
    });
  } catch (error) {
    // Native refresh can observe a revocation after the renderer's earlier /me
    // succeeded. The native cache is already locked; expire only this UI session.
    await observeNativeAuthFailure(error, context);
    throw error;
  }
  if (!permissions || !isServerRequestCurrent(context)) throw new Error('Session changed during permission refresh');
  return permissions;
}

// Bound actual connection failures, including a paused (not just stopped) API.
async function authFetch(url: string, init: RequestInit = {}, observe = true): Promise<Response> {
  const bearer = new Headers(init.headers).get('Authorization')?.replace(/^Bearer /, '');
  const context = observe && bearer ? await captureServerRequest(bearer) : null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (context) await observeServerAuthResponse(response, context);
    return response;
  }
  finally { clearTimeout(timeout); }
}

async function fetchServerPermissions(token = getToken() || '', observe = true): Promise<string[]> {
  const response = await authFetch(`${API_BASE}/auth/me/permissions`, { headers: { Authorization: `Bearer ${token}` } }, observe);
  if (!response.ok) throw new Error('Unable to load your LabOS permissions');
  const body = await response.json();
  return Array.isArray(body?.permissions) ? body.permissions.filter((p: any) => p?.effective).map((p: any) => String(p.permission)) : [];
}

export async function getLocalAuthStatus(): Promise<LocalAuthStatus | null> {
  const status = await localInvoke<LocalAuthStatus>('local_auth_status');
  return status ? { ...status, user: status.user ? localUser(status.user) : null } : null;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  if (isTauriRuntime()) {
    try {
      // Native code owns server verification and the bounded outage fallback.
      // No caller-supplied role, grants, identity or origin can provision access.
      const result = await localInvoke<AuthResponse>('cache_server_user', { username, password });
      if (!result) throw new Error('Native authentication is unavailable');
      return { ...result, user: localUser(result.user) };
    } catch (error: any) {
      throw new Error(error?.message || String(error));
    }
  }
  const response = await authFetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || error?.error || 'Login failed');
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

export async function getCurrentUser(token: string): Promise<{ user: User; token?: string }> {
  if (!token.startsWith('local:')) {
    try {
      const context = await captureServerRequest(token);
      const response = await authFetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status >= 500) throw new TypeError('LabOS authentication is temporarily unavailable');
      if (!response.ok) throw new Error('Failed to get current user');
      const result = await response.json() as { user: User };
      if (isTauriRuntime()) {
        try {
          await cachePermissions(result.user, context);
        } catch {
          // Keep a valid authenticated session usable during a transient
          // permission-refresh failure; the existing local cache remains in place.
        }
      }
      if (!isServerRequestCurrent(context)) throw new Error('Session changed during account restoration');
      return result;
    } catch (error) {
      // A central network outage must not discard a valid cached desktop
      // session. HTTP authentication failures remain authoritative and do
      // not fall back to the local cache.
      if (isTauriRuntime() && (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError'))) {
        const local = await localInvoke<User | null>('local_current_user');
        if (local !== null) {
          const user = localUser(local);
          const expected = getStoredUser();
          if (expected && user.id !== (expected.central_user_id || expected.id)) {
            throw new Error('Cached session belongs to another account; sign in again');
          }
          return { user };
        }
      }
      throw error;
    }
  }
  const local = await getLocalAuthStatus();
  if (local?.authenticated && local.user && local.token?.startsWith('local:')) {
    return { user: local.user, token: local.token };
  }
  throw new Error('Local session is unavailable');
}

export async function changePassword(current_password: string, new_password: string): Promise<void> {
  const token = getToken();
  if (!token || token.startsWith('local:')) throw new Error('Reconnect to LabOS before changing your password.');
  const context = await captureServerRequest(token);
  const response = await authFetch(`${API_BASE}/auth/me/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ current_password, new_password }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
    throw new Error(message || 'Failed to update password');
  }
  await endServerSession(context, true);
}

export async function updateProfile(display_name: string, email: string): Promise<User> {
  const token = getToken();
  if (!token || token.startsWith('local:')) throw new Error('Reconnect to LabOS before updating your profile.');
  const response = await authFetch(`${API_BASE}/auth/me/profile`, {
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

let sessionGeneration = 0;
export function setToken(token: string): void {
  if (getToken() !== token) sessionGeneration++;
  localStorage.setItem('auth_token', token);
}

export function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

export type AccountSession = { accountId: string; token: string; generation: number };
export function captureAccountSession(): AccountSession | null {
  const accountId = getStoredUser()?.id;
  const token = getToken();
  return accountId && token ? { accountId, token, generation: sessionGeneration } : null;
}
export function isAccountSessionCurrent(session: AccountSession | null): session is AccountSession {
  return !!session && session.generation === sessionGeneration && getToken() === session.token && getStoredUser()?.id === session.accountId;
}

export function removeToken(): void {
  sessionGeneration++;
  localStorage.removeItem('auth_token');
}

export function setStoredUser(user: User): void {
  if (getStoredUser()?.id !== user.id) sessionGeneration++;
  localStorage.setItem('auth_user', JSON.stringify(user));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('labos-user-updated'));
}

export async function getCurrentPermissions(): Promise<string[]> {
  const user = getStoredUser();
  const token = getToken();
  const onlineSession = Boolean(token && !token.startsWith('local:'));
  if (isTauriRuntime()) {
    let localPermissions: string[] | null = null;
    let localError: unknown = null;
    try {
      localPermissions = await localInvoke<string[]>('local_current_permissions');
    } catch (error) {
      localError = error;
    }
    // Older cached admin sessions can contain a partial permission set. Refresh
    // from the authoritative server rather than treating missing entries as denial.
    const staleAdminCache = user?.role === 'admin' &&
      localPermissions !== null && !localPermissions.includes('finance.view_sensitive');
    if (localPermissions !== null && !staleAdminCache) return localPermissions;
    if (!onlineSession) {
      if (staleAdminCache) throw new Error('Cached administrator permissions are incomplete. Reconnect and sign in online to refresh access.');
      throw new Error('Cached desktop permissions unavailable: ' + String(localError ?? 'No local session'));
    }
    try {
      const context = await captureServerRequest(token!);
      if (user?.id) {
        return await cachePermissions(user, context);
      }
      throw new Error('No active account');
    } catch (serverError) {
      throw new Error('Unable to refresh desktop permissions: ' + String(serverError) +
        (localError ? '; local error: ' + String(localError) : ''));
    }
  }
  return fetchServerPermissions();
}

export function getStoredUser(): User | null {
  const userStr = localStorage.getItem('auth_user');
  return userStr ? JSON.parse(userStr) : null;
}

export function removeStoredUser(): void {
  sessionGeneration++;
  localStorage.removeItem('auth_user');
}
