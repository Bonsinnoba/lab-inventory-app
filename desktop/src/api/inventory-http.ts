import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {apiFetch,getApiErrorMessage} from './http';
import {isLocalBackendAvailable} from './local-backend';

export type InventoryBase={id:string;version:number};
type Intent={key:string;body:Record<string,unknown>};
const storageKey='labos.inventory.http-intents.v2';
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
function readIntents():Record<string,Intent>{
  try{const data=JSON.parse(sessionStorage.getItem(storageKey)||'{}');if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}
  catch{throw new Error('Browser retry storage is unavailable. Restore access before retrying.');}
}
function writeIntents(intents:Record<string,Intent>){sessionStorage.setItem(storageKey,JSON.stringify(intents));}
export async function writeInventoryHttp<T>(path:string,method:string,body:Record<string,unknown>,newRecord=false):Promise<T>{
  if(isLocalBackendAvailable())throw new Error('Desktop inventory must use SQLite and its outbox');
  const session=captureAccountSession();if(!session)throw new Error('Sign in to change inventory');
  // Persist before HTTP. The exact key/body survives an uncertain response and
  // a tab reload; this is retry identity, not an offline browser write queue.
  // A refresh after a lost ACK can expose a newer server version. Match the
  // unresolved semantic action, then replay its ORIGINAL persisted base/body;
  // otherwise another click could apply the same stock delta twice.
  const {expected_version,item_bases,...action}=body;
  if(path==='/excel/inventory/import'&&Array.isArray(action.rows)){
    action.rows=action.rows.map(row=>{if(row.operation!=='create')return row;const {id,...record}=row.record;return{...row,record};});
  }
  const signature=JSON.stringify(canonical([session.accountId,path,method,action]));
  const intents=readIntents();let intent=intents[signature];
  if(!intent){intent={key:crypto.randomUUID(),body:{...body,...(newRecord?{id:crypto.randomUUID()}:{})}};intents[signature]=intent;writeIntents(intents);}
  const response=await apiFetch(path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':intent.key},body:JSON.stringify(intent.body)});
  const forget=()=>{const latest=readIntents();delete latest[signature];writeIntents(latest);};
  if(!response.ok){
    if(response.status>=400&&response.status<500&&![408,429].includes(response.status))forget();
    throw new Error(await getApiErrorMessage(response,'Unable to change inventory'));
  }
  const result=response.status===204?undefined:await response.json();
  forget();
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while saving inventory; refresh before continuing');
  return result as T;
}
export function inventoryVersion(version:number|undefined):number {
  if(!Number.isSafeInteger(version)||(version??0)<1)throw new Error('Refresh inventory before changing it; a displayed record version is required');
  return version!;
}
export function inventoryBases(ids:string[],versions?:InventoryBase[]):InventoryBase[]{
  if(!versions||versions.length!==ids.length||new Set(ids).size!==ids.length)throw new Error('Refresh the selected inventory before changing it');
  return [...ids].sort().map(id=>{const matches=versions.filter(v=>v.id===id);if(matches.length!==1)throw new Error('Refresh the selected inventory before changing it');return{id,version:inventoryVersion(matches[0].version)};});
}
