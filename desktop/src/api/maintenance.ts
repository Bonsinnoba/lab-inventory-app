import { localBackend } from './local-backend';
import { captureAccountSession, isAccountSessionCurrent } from './auth';
import { apiFetch, getApiErrorMessage } from './http';
import type { MaintenanceRecord } from './items';

// Browser retries retain the same intent until a response is decoded. Desktop
// retries are persisted by SQLite/outbox, not by this online-only map.
const uncertain = new Map<string,{changeId:string;id:string}>();
export async function listMaintenance(itemId?:string):Promise<MaintenanceRecord[]> {
  const session=captureAccountSession();
  if(!session)throw new Error('Sign in to read maintenance');
  if(localBackend.isAvailable())return localBackend.invoke('list_local_maintenance',{itemId:itemId??null,expectedAccountId:session.accountId});
  const response=await apiFetch(itemId?`/items/${itemId}/maintenance`:'/sync/maintenance/pull');
  if(!response.ok)throw new Error(await getApiErrorMessage(response));
  const body=await response.json();
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading maintenance');
  return itemId?body:body.records;
}
export async function mutateMaintenance(itemId:string,operation:'create'|'update'|'delete',record:Partial<MaintenanceRecord>,id?:string,expectedVersion?:number):Promise<MaintenanceRecord> {
  const session=captureAccountSession();
  if(!session)throw new Error('Sign in to change maintenance');
  if(operation!=='create'&&!Number.isSafeInteger(expectedVersion))throw new Error('Refresh the maintenance record before changing it');
  if(localBackend.isAvailable()) {
    const result=await localBackend.invoke<MaintenanceRecord>('mutate_local_maintenance',{itemId,id:id??null,operation,record,expectedVersion:expectedVersion??null,expectedAccountId:session.accountId});
    if(!result)throw new Error('Local maintenance write returned no result; server fallback was not attempted');
    return result;
  }
  const signature=JSON.stringify([session.accountId,itemId,id,operation,expectedVersion,record]);
  let intent=uncertain.get(signature);
  if(!intent){intent={changeId:crypto.randomUUID(),id:id??crypto.randomUUID()};uncertain.set(signature,intent);}
  const response=await apiFetch(`/items/${itemId}/maintenance${operation==='create'?'':`/${id}`}`,{
    method:operation==='create'?'POST':operation==='delete'?'DELETE':'PATCH',
    headers:{'Content-Type':'application/json','Idempotency-Key':intent.changeId},
    body:JSON.stringify({...record,id:intent.id,expected_version:expectedVersion}),
  });
  if(!response.ok) {
    // Definitive client rejections are new user decisions; uncertain transport
    // and server failures keep their key for a safe retry.
    if(response.status>=400&&response.status<500)uncertain.delete(signature);
    throw new Error(await getApiErrorMessage(response,'Unable to change maintenance'));
  }
  const result=await response.json();
  uncertain.delete(signature);
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while saving maintenance');
  return result;
}
