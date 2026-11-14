import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {apiFetch,getApiErrorMessage} from './http';

const storageKey='labos.project-work.http-intents.v1';
const fields={task:['title','description','status','priority','assignee_id','due_date','requirement_id'],experiment:['title','status','hypothesis','procedure','observations','result','conclusion','performed_by','requirement_id'],measurement:['name','value_numeric','value_text','unit','uncertainty','observed_at','recorded_by','notes'],observation:['kind','content','observed_at','recorded_by'],bom:['name','part_number','required_quantity','unit','preferred_item_id','alternative_item_id','notes','requirement_id'],block:['block_type','text_content','resource_id','title','x','y','width','height'],connector:['source_block_id','target_block_id','label'],requirement:['name','requirement_type','quantity','unit','required_by','preferred_item_id','notes','status']};
export function reviewedProjectWork(kind:keyof typeof fields,row:unknown):Record<string,unknown>{
 if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Refresh and review the work record before changing it');
 return Object.fromEntries(fields[kind].map(f=>[f,(row as Record<string,unknown>)[f]??null]));
}
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
 return value;
}
type Intent={key:string;body:Record<string,unknown>};
function read():Record<string,Intent>{
 try{const data=JSON.parse(sessionStorage.getItem(storageKey)||'{}');if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}
 catch{throw Error('Work retry storage is unavailable. Restore storage before changing project work');}
}
export async function writeProjectWorkHttp<T>(path:string,method:string,body:Record<string,unknown>):Promise<T>{
 if(typeof window!=='undefined'&&(window as any).__TAURI_IPC__)throw Error('Desktop project work must use local storage and the outbox');
 const session=captureAccountSession();if(!session||session.token.startsWith('local:'))throw Error('Browser work changes require an online sign-in');
 // The reviewed base is retained in uncertain retries, even after a refresh.
 const {expected,expected_relationship,expected_resource_id,...action}=body;
 const signature=JSON.stringify(canonical([session.accountId,path,method,action]));
 const intents=read();let intent=intents[signature];
 if(!intent){intent={key:crypto.randomUUID(),body:{...body}};intents[signature]=intent;sessionStorage.setItem(storageKey,JSON.stringify(intents));}
 if(!isAccountSessionCurrent(session))throw Error('Account changed before updating project work');
 const response=await apiFetch(path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':intent.key},body:JSON.stringify(intent.body)});
 const forget=()=>{const latest=read();delete latest[signature];sessionStorage.setItem(storageKey,JSON.stringify(latest));};
 if(!isAccountSessionCurrent(session))throw Error('Account changed while updating project work; the original account owns the request');
 if(!response.ok){if(response.status>=400&&response.status<500&&![408,429].includes(response.status))forget();throw Error(await getApiErrorMessage(response,'Project work update failed'));}
 const result=response.status===204?undefined:await response.json();
 if(method==='DELETE'?response.status!==204:!result||typeof result.id!=='string')throw Error('Invalid work confirmation; retry to reconcile');
 const normalizedId=(value:unknown)=>typeof value==='string'&&/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value)?value.replaceAll('-','').toLowerCase():null;
 const sameId=(a:unknown,b:unknown)=>normalizedId(a)!==null&&normalizedId(a)===normalizedId(b);
 if(method!=='DELETE'){
  if(!normalizedId(result.id))throw Error('Invalid work confirmation identity; retry to reconcile');
  const parts=path.split('/');
  if(!sameId(result.project_id,path.startsWith('/projects/')?parts[2]:intent.body.project_id))throw Error('Work confirmation belongs to another project; retry to reconcile');
  if((path.includes('/measurements')||path.includes('/observations'))&&!sameId(result.experiment_id,parts[4]))throw Error('Work confirmation belongs to another experiment; retry to reconcile');
  if(path.endsWith('/items')&&!sameId(result.item_id,intent.body.item_id))throw Error('Item-link confirmation has a different inventory item; retry to reconcile');
  if(method==='POST'&&path.endsWith('/connectors')&&(!sameId(result.source_block_id,intent.body.source_block_id)||!sameId(result.target_block_id,intent.body.target_block_id)))throw Error('Connector confirmation has different endpoints; retry to reconcile');
  if(method==='POST'&&path.endsWith('/blocks')){
   if(result.block_type!==intent.body.block_type)throw Error('Canvas confirmation has a different block type; retry to reconcile');
   if(intent.body.resource_id!=null&&!sameId(result.resource_id,intent.body.resource_id))throw Error('Canvas confirmation has a different resource; retry to reconcile');
  }
  if(['PATCH','PUT'].includes(method)&&!sameId(result.id,parts.at(-1)))throw Error('Work confirmation belongs to another record; retry to reconcile');
  if(path.includes('/tasks/')&&path.endsWith('/experiments')&&(!sameId(result.task_id,parts[4])||!sameId(result.experiment_id,intent.body.experiment_id)))throw Error('Link confirmation has different endpoints; retry to reconcile');
  if(path.endsWith('/attachments')&&(!sameId(result.resource_id,intent.body.resource_id)||!sameId(result[path.includes('/tasks/')?'task_id':'experiment_id'],parts[4])||result[path.includes('/tasks/')?'experiment_id':'task_id']!=null))throw Error('Attachment confirmation has different endpoints; retry to reconcile');
 }
 if(!isAccountSessionCurrent(session))throw Error('Account changed while reading the work confirmation');
 forget();return result as T;
}
