import {administrativeJson} from './administrative-http';
export type AccountRole = 'admin' | 'researcher' | 'technician' | 'viewer' | 'member';

export interface ManagedUser {
  id: string;
  username: string;
  role: AccountRole;
  is_active: boolean;
  last_login_at?: string | null;
  created_at: string;
}

export async function getManagedUsers():Promise<ManagedUser[]>{
 const users=await administrativeJson<ManagedUser[]>('/auth/users',undefined,'Failed to load users');
 if(!Array.isArray(users))throw new Error('Managed user directory is incomplete');return users;
}
export async function createManagedUser(data:{username:string;password:string;role:AccountRole}):Promise<ManagedUser>{
 const result=await administrativeJson<{user:ManagedUser}>('/auth/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)},'Failed to create user');
 if(!result?.user?.id)throw new Error('User creation was not confirmed');return result.user;
}
export async function updateManagedUser(id:string,data:{role?:AccountRole;is_active?:boolean}):Promise<ManagedUser>{
 const result=await administrativeJson<{user:ManagedUser}>(`/auth/users/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)},'Failed to update user');
 if(result?.user?.id!==id)throw new Error('User update was not confirmed');return result.user;
}
export async function resetManagedUserPassword(id:string,new_password:string):Promise<void>{
 await administrativeJson(`/auth/users/${id}/password`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({new_password})},'Failed to reset password');
}
