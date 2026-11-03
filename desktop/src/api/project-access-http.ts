import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {apiFetch,getApiErrorMessage} from './http';
import {isLocalBackendAvailable} from './local-backend';

const storageKey='labos.project-access.http-intents.v1';
type Intent={key:string;body:Record<string,unknown>};
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
 return value;
}
function read():Record<string,Intent>{
 try{const value=JSON.parse(sessionStorage.getItem(storageKey)||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
 catch{throw Error('Access-change retry storage is unavailable. Restore storage before changing project access.');}
}

export async function readProjectAccessHttp<T>(path:string):Promise<T[]>{
 const session=captureAccountSession();if(!session)throw Error('Sign in to read project access');
 const response=await apiFetch(path,{cache:'no-store'});
 if(!response.ok)throw Error(await getApiErrorMessage(response,'Unable to read project access'));
 const rows=await response.json();
 if(!isAccountSessionCurrent(session))throw Error('Account changed while reading project access');
 if(!Array.isArray(rows))throw Error('Invalid project access response');
 return rows;
}

// These administrative actions are server-confirmed, including on desktop.
// Persist retry identity only; never modify local authority before confirmation.
export async function writeProjectAccessHttp<T>(path:string,method:string,body:Record<string,unknown>):Promise<T>{
 const session=captureAccountSession();if(!session)throw Error('Sign in to manage project access');
 if(session.token.startsWith('local:'))throw Error('Project access changes require an online sign-in and server confirmation');
 if(!Object.hasOwn(body,'expected_value')||body.expected_value===undefined)throw Error('Refresh project access and supply the value you reviewed');
 const {expected_value,...action}=body;
 const signature=JSON.stringify(canonical([session.accountId,path,method,action]));
 const intents=read();let intent=intents[signature];
 if(!intent){intent={key:crypto.randomUUID(),body:{...body}};intents[signature]=intent;sessionStorage.setItem(storageKey,JSON.stringify(intents));}
 if(!isAccountSessionCurrent(session))throw Error('Account changed before updating project access');
 const response=await apiFetch(path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':intent.key},body:JSON.stringify(intent.body)});
 const forget=()=>{const latest=read();delete latest[signature];sessionStorage.setItem(storageKey,JSON.stringify(latest));};
 if(!isAccountSessionCurrent(session))throw Error('Account changed while updating project access; the original account owns this request');
 if(!response.ok){
  if(response.status>=400&&response.status<500&&![408,429].includes(response.status))forget();
  throw Error(await getApiErrorMessage(response,'Project access update failed'));
 }
 const result=response.status===204?undefined:await response.json();
 const sameId=(left:unknown,right:unknown)=>typeof left==='string'&&typeof right==='string'&&left.replaceAll('-','').toLowerCase()===right.replaceAll('-','').toLowerCase();
 if(method==='DELETE'){
  if(response.status!==204)throw Error('Invalid access removal confirmation; retry to reconcile');
 }else if(path.endsWith('/members')){
  if(!result||!sameId(result.user_id,intent.body.user_id)||result.member_role!==intent.body.member_role)throw Error('Invalid membership confirmation; retry to reconcile');
 }else if(!result||!sameId(result.user_id,path.split('/').at(-1))||result.access_level!==intent.body.access_level)throw Error('Invalid access grant confirmation; retry to reconcile');
 if(!isAccountSessionCurrent(session))throw Error('Account changed while reading the project access confirmation');
 if(isLocalBackendAvailable()){
  try{await(await import('./sync')).refreshConfirmedProjectAccess(session);}
  catch(error){throw Error(`Server confirmed the access change; local project refresh is pending. Retry to reconcile. ${error instanceof Error?error.message:''}`);}
 }
 if(!isAccountSessionCurrent(session))throw Error('Account changed after updating project access');
 forget();return result as T;
}
