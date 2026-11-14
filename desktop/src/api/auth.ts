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
  profile_pending_sync?:boolean;
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
  server_token?: string | null;
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
  if (!revokeOffline && context.nativeSessionToken && context.accountId) {
    try{
      const status=await localInvoke<{protected_credentials_protocol?:number}>('local_database_status');
      if(status?.protected_credentials_protocol===1)await localInvoke<boolean>('forget_local_server_credential',{expectedAccountId:context.accountId,expectedSessionToken:context.nativeSessionToken});
    }catch{
      // Expire the UI session even if storage cleanup cannot be confirmed.
      // The invalid JWT cannot authenticate server operations on a retry.
      console.warn('Protected server credential cleanup could not be confirmed; sign in again to replace it.');
    }
    if(!isServerRequestCurrent(context))return;
  }
  if (revokeOffline && context.nativeSessionToken && context.accountId) {
    const locked = await localInvoke<boolean>('invalidate_local_authorization', {
      expectedAccountId: context.accountId, expectedSessionToken: context.nativeSessionToken,
    });
    // A different native login won the race. Never lock or sign out that login.
    if (locked !== true) return;
  }
  if (!isServerRequestCurrent(context)) return;
  // Identity metadata is not authority. Keep it while the mounted workspace is
  // locked so same-account reauthentication can retain its unsaved form state.
  // The missing token and native lease/revocation checks continue to deny I/O.
  removeToken();
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

export const DESKTOP_REAUTH_REQUIRED = 'Local access has expired or is no longer available. Sign in online again to refresh this device. Your saved work and pending changes are preserved.';

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
        // A valid server JWT is not a valid native lease. Permission refresh
        // deliberately cannot renew the password-authenticated offline lease.
        // Never restore a workspace whose SQLite reads will all be rejected.
        const local = await localInvoke<User | null>('local_current_user');
        if (!isServerRequestCurrent(context)) throw new Error('Session changed during account restoration');
        if (!local) throw new Error(DESKTOP_REAUTH_REQUIRED);
        if (localUser(local).id !== result.user.id) throw new Error('Cached session belongs to another account; sign in again');
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
    return { user: local.user, token: local.server_token || local.token };
  }
  if (!isTauriRuntime() || local?.bootstrapped === false) throw new Error('Sign in online to authorize this installation.');
  throw new Error(DESKTOP_REAUTH_REQUIRED);
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

const profileRetries=new Map<string,{id:string;device:string}>();let profileOwner='';
export async function updateProfile(display_name:string,email:string,expected?:{display_name:string|null;email:string|null}):Promise<User>{
 const session=captureAccountSession(),user=getStoredUser();if(!session||!user)throw Error('Sign in before changing your contact profile');if(!expected)throw Error('Reopen your profile to review its current values before saving');
 const profile={display_name:display_name.trim()||null,email:email.trim().toLowerCase()||null};
 if(isTauriRuntime()){
  const nativeSession=await localInvoke<string>('local_authorization_guard',{expectedAccountId:session.accountId});if(!nativeSession||!isAccountSessionCurrent(session))throw Error('Native profile session changed');
  const saved=await localInvoke<{profile:typeof profile;pending_sync:boolean}>('update_local_account_profile',{expectedAccountId:session.accountId,expectedSessionToken:nativeSession,profile,expectedBefore:expected});
  if(!isAccountSessionCurrent(session))throw Error('Account changed while saving your contact profile');if(!saved||saved.profile?.display_name!==profile.display_name||saved.profile?.email!==profile.email)throw Error('Local contact-profile save was not confirmed; no server fallback attempted');
  return{...user,display_name:saved.profile.display_name,email:saved.profile.email,profile_pending_sync:saved.pending_sync};
 }
 if(session.token.startsWith('local:'))throw Error('Reconnect to save your contact profile');
 if(profileOwner!==session.accountId){profileRetries.clear();profileOwner=session.accountId;}
 const payload={profile,expected_before:expected,previous_change_id:null};const signature=JSON.stringify([session.accountId,payload]);let retry=profileRetries.get(signature);
 if(!retry){if(profileRetries.size>=50)throw Error('Resolve earlier contact-profile requests before saving another version');retry={id:crypto.randomUUID(),device:crypto.randomUUID()};profileRetries.set(signature,retry);}
 const response=await authFetch(`${API_BASE}/sync/push`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.token}`},body:JSON.stringify({device_id:retry.device,changes:[{change_id:retry.id,entity_type:'account_profile',entity_id:session.accountId,operation:'update',payload}]})});
 if(!isAccountSessionCurrent(session))throw Error('Account changed while saving your contact profile');const body=await response.json();if(!response.ok)throw Error(body?.error?.message||'Contact-profile save unavailable');
 const result=Array.isArray(body?.results)&&body.results.length===1&&body.results[0]?.change_id===retry.id?body.results[0]:null;if(result?.status!=='synced')throw Error(result?.error?.message||'Contact-profile save not confirmed; retry the reviewed values');
 profileRetries.delete(signature);return{...user,...profile,profile_pending_sync:false};
}
export async function refreshAccountProfile():Promise<void>{
 if(!isTauriRuntime())return;const token=getToken();if(!token||token.startsWith('local:'))throw Error('Online contact-profile refresh unavailable');const context=await captureServerRequest(token);
 if(!context.accountId||!context.nativeSessionToken||!isServerRequestCurrent(context))throw Error('Native contact-profile session changed');
 let reply:{profile:{display_name:string|null;email:string|null};pending_sync:boolean}|null;
 try{reply=await localInvoke('refresh_native_account_profile',{expectedAccountId:context.accountId,expectedSessionToken:context.nativeSessionToken,serverToken:token});}catch(error){await observeNativeAuthFailure(error,context);throw error;}
 if(!isServerRequestCurrent(context))throw Error('Account changed during contact-profile refresh');if(!reply?.profile)throw Error('Contact-profile refresh was not confirmed');
 const current=getStoredUser();if(current&&(current.display_name!==reply.profile.display_name||current.email!==reply.profile.email||current.profile_pending_sync!==reply.pending_sync))setStoredUser({...current,display_name:reply.profile.display_name,email:reply.profile.email,profile_pending_sync:reply.pending_sync});
}

export async function logout(): Promise<void> {
  const local = await localInvoke<void>('local_logout');
  if (local !== null) return;
}

let sessionGeneration = 0;
let desktopToken:string|null=null;
export function setToken(token: string): void {
  if (getToken() !== token) sessionGeneration++;
  if(isTauriRuntime()){desktopToken=token;localStorage.removeItem('auth_token');}
  else localStorage.setItem('auth_token', token);
}

export function getToken(): string | null {
  if(isTauriRuntime()){localStorage.removeItem('auth_token');return desktopToken;}
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
  desktopToken=null;
  localStorage.removeItem('auth_token');
}

// Explicit user action: retain native offline authority and mounted drafts,
// while the existing same-account gate obtains a fresh server credential.
export function requestOnlineSignIn(session:AccountSession|null):boolean {
  if(!isAccountSessionCurrent(session)||!session.token.startsWith('local:'))return false;
  removeToken();
  window.dispatchEvent(new Event('labos:auth-expired'));
  return true;
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
