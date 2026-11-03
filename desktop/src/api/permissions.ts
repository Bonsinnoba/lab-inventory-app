import {administrativeJson} from './administrative-http';
import { invoke } from '@tauri-apps/api/tauri';
import {captureAccountSession,isAccountSessionCurrent} from './auth';

export type PermissionEffect = 'inherited' | 'grant' | 'deny';
export type PermissionEntry = { permission: string; baseline: boolean; effect: PermissionEffect; effective: boolean };
export type CurrentPermissionEntry = { permission: string; effective: boolean };

export async function getCurrentUserPermissions():Promise<{user:{id:string;username:string;role:string};permissions:CurrentPermissionEntry[]}>{
 const session=captureAccountSession();if(!session)throw new Error('Sign in to read permissions');
 const native=typeof window!=='undefined'&&!!(window as any).__TAURI_IPC__;
 if(native){
  // The auth refresh pipeline separately updates this authorized local snapshot.
  // A native read error must not become an HTTP request or guessed empty grants.
  const permissions=await invoke<string[]>('local_current_permissions');
  const user=await invoke<{id:string;username:string;role:string}>('local_current_user');
  if(!isAccountSessionCurrent(session)||user?.id!==session.accountId)throw new Error('Session changed during permission read');
  if(!Array.isArray(permissions)||permissions.some(value=>typeof value!=='string'))throw new Error('Local permission snapshot unavailable');
  return {user,permissions:permissions.map(permission=>({permission,effective:true}))};
 }
 return administrativeJson('/auth/me/permissions',undefined,'Failed to load current permissions');
}

export async function getUserPermissions(userId:string):Promise<{user:{id:string;username:string;role:string};permissions:PermissionEntry[]}>{
 const result=await administrativeJson<{user:{id:string;username:string;role:string};permissions:PermissionEntry[]}>(`/auth/users/${userId}/permissions`,undefined,'Failed to load permissions');
 if(result.user?.id!==userId||!Array.isArray(result.permissions))throw new Error('User permission profile was not confirmed');return result;
}
export async function updateUserPermissions(userId:string,overrides:Array<{permission:string;effect:'grant'|'deny'}>):Promise<{permissions:PermissionEntry[]}>{
 const result=await administrativeJson<{permissions:PermissionEntry[]}>(`/auth/users/${userId}/permissions`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({overrides})},'Failed to update permissions');
 if(!Array.isArray(result?.permissions))throw new Error('Permission update was not confirmed');return result;
}
