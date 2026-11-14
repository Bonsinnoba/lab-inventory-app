import {administrativeJson,administrativeExpected} from './administrative-http';
import {invoke} from '@tauri-apps/api/tauri';
import {captureAccountSession,isAccountSessionCurrent,getToken,captureServerRequest,isServerRequestCurrent,observeNativeAuthFailure} from './auth';
const native=()=>typeof window!=='undefined'&&Boolean((window as any).__TAURI_IPC__);
export type AccountRole = 'admin' | 'researcher' | 'technician' | 'viewer' | 'member';

export interface ManagedUser {
  id: string;
  username: string;
  role: AccountRole;
  is_active: boolean;
  last_login_at?: string | null;
  created_at: string;
  management_etag?:string;
}

export async function getManagedUsers():Promise<ManagedUser[]>{
 if(native()){
  const session=captureAccountSession();if(!session)throw Error('Sign in to read the cached user directory');
  const rows=await invoke<ManagedUser[]>('get_local_managed_users',{expectedAccountId:session.accountId});
  if(!isAccountSessionCurrent(session))throw Error('Administrative session changed');
  if(!Array.isArray(rows))throw Error('Managed user directory is incomplete');return rows;
 }
 const users=await administrativeJson<ManagedUser[]>('/auth/users',undefined,'Failed to load users');
 if(!Array.isArray(users))throw new Error('Managed user directory is incomplete');return users;
}
export async function refreshManagedUsers():Promise<void>{
 if(!native())return;
 const session=captureAccountSession();if(!session)throw Error('Sign in to refresh the user directory');
 const token=getToken();if(!token||token.startsWith('local:'))throw Error('Connect and sign in online to refresh the directory');const context=await captureServerRequest(token);
 if(!context.nativeSessionToken||!isServerRequestCurrent(context))throw Error('Native administrative session changed');
 try{await invoke('refresh_native_managed_users',{expectedAccountId:session.accountId,expectedSessionToken:context.nativeSessionToken,serverToken:token});}catch(error){await observeNativeAuthFailure(error,context);throw error;}
 if(!isAccountSessionCurrent(session))throw Error('Administrative session changed');
}
export async function createManagedUser(data:{username:string;password:string;role:AccountRole}):Promise<ManagedUser>{
 const result=await administrativeJson<{user:ManagedUser}>('/auth/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)},'Failed to create user');
 if(!result?.user?.id)throw new Error('User creation was not confirmed');return result.user;
}
export async function updateManagedUser(id:string,data:{role?:AccountRole;is_active?:boolean},etag?:string):Promise<ManagedUser>{
 const result=await administrativeJson<{user:ManagedUser}>(`/auth/users/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,...administrativeExpected(etag)})},'Failed to update user');
 if(result?.user?.id!==id)throw new Error('User update was not confirmed');return result.user;
}
export async function resetManagedUserPassword(id:string,new_password:string,etag?:string):Promise<void>{
 await administrativeJson(`/auth/users/${id}/password`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({new_password,...administrativeExpected(etag)})},'Failed to reset password');
}
