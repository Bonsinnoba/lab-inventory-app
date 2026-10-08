import { localBackend } from './local-backend';
import { captureAccountSession, isAccountSessionCurrent } from './auth';
import { apiFetch, getApiErrorMessage } from './http';

export type CatalogKind='supplier'|'storage_container';
export type CatalogRecord={id:string;name:string;sync_version:number;item_count:number};
const routes={supplier:'/operations/suppliers',storage_container:'/phase4/containers'};
const pending=new Map<string,{id:string;key:string}>();
function session(){const s=captureAccountSession();if(!s)throw new Error('Sign in to use catalogs');return s;}
export async function listCatalog<T extends CatalogRecord>(kind:CatalogKind):Promise<T[]>{
  const s=session();let records:T[];
  if(localBackend.isAvailable()){
    records=await localBackend.invoke<T[]>('list_local_catalog',{kind,expectedAccountId:s.accountId});
    if(!Array.isArray(records))throw new Error('Local catalog is unavailable; server fallback was not attempted');
  }else{
    const r=await apiFetch(`/sync/catalog/${kind}/pull`,{cache:'no-store'});
    if(!r.ok)throw new Error(await getApiErrorMessage(r));
    const body=await r.json();if(body.snapshot_complete!==true||!Array.isArray(body.records))throw new Error('Incomplete catalog snapshot');records=body.records;
  }
  if(!isAccountSessionCurrent(s))throw new Error('Account changed while reading catalog');return records;
}
export async function mutateCatalog<T>(kind:CatalogKind,operation:'create'|'update'|'delete',record:object={},id?:string,expectedVersion?:number):Promise<T>{
  const s=session();
  if(operation!=='create'&&(!Number.isSafeInteger(expectedVersion)||(expectedVersion??0)<1))throw new Error('Refresh the catalog record before changing it');
  if(localBackend.isAvailable()){
    const result=await localBackend.invoke<T>('mutate_local_catalog',{kind,operation,record,id:id??null,expectedVersion:expectedVersion??null,expectedAccountId:s.accountId});
    if(!result)throw new Error('Local catalog write returned no result; server fallback was not attempted');
    if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving catalog');return result;
  }
  const signature=JSON.stringify([s.accountId,kind,operation,id,expectedVersion,record]);
  let intent=pending.get(signature);if(!intent){intent={id:id??crypto.randomUUID(),key:crypto.randomUUID()};pending.set(signature,intent);}
  const r=await apiFetch(routes[kind]+(operation==='create'?'':`/${intent.id}`),{method:operation==='create'?'POST':operation==='delete'?'DELETE':'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':intent.key},body:JSON.stringify({...record,id:intent.id,expected_version:expectedVersion})});
  if(!r.ok){if(r.status>=400&&r.status<500)pending.delete(signature);throw new Error(await getApiErrorMessage(r,'Unable to save catalog'));}
  const result=await r.json();pending.delete(signature);
  if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving catalog');return result;
}
