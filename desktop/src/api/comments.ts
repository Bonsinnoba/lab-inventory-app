import {localBackend} from './local-backend';
import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {apiFetch,getApiErrorMessage} from './http';
import type {ProjectComment} from './collaboration';
const pending=new Map<string,{id:string;key:string}>();
function session(){const s=captureAccountSession();if(!s)throw new Error('Sign in to use comments');return s;}
export async function listComments(projectId:string):Promise<ProjectComment[]>{
  const s=session();let result:ProjectComment[];
  if(localBackend.isAvailable()){
    result=await localBackend.invoke('list_local_comments',{projectId,expectedAccountId:s.accountId});
    if(!Array.isArray(result))throw new Error('Local comments unavailable; no server fallback');
  }else{const r=await apiFetch(`/collaboration/projects/${projectId}/comments`);if(!r.ok)throw new Error(await getApiErrorMessage(r));result=await r.json();}
  if(!isAccountSessionCurrent(s))throw new Error('Account changed while reading comments');return result;
}
export async function mutateComment(projectId:string,operation:'create'|'delete',body?:string,id?:string):Promise<ProjectComment>{
  const s=session();
  if(localBackend.isAvailable()){
    const result=await localBackend.invoke<ProjectComment>('mutate_local_comment',{projectId,operation,body:body??null,id:id??null,expectedAccountId:s.accountId});
    if(!result)throw new Error('Local comment write returned no result; no server fallback');
    if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving comment');return result;
  }
  const signature=JSON.stringify([s.accountId,projectId,operation,body,id]);let intent=pending.get(signature);
  if(!intent){intent={id:id??crypto.randomUUID(),key:crypto.randomUUID()};pending.set(signature,intent);}
  const r=await apiFetch(`/collaboration/projects/${projectId}/comments${operation==='delete'?`/${intent.id}`:''}`,{method:operation==='create'?'POST':'DELETE',headers:{'Content-Type':'application/json','Idempotency-Key':intent.key},body:JSON.stringify({id:intent.id,body})});
  if(!r.ok){if(r.status>=400&&r.status<500)pending.delete(signature);throw new Error(await getApiErrorMessage(r));}
  const result=await r.json();pending.delete(signature);if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving comment');return result;
}
