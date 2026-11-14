import {apiFetch,getApiErrorMessage} from './http';
import {getToken,captureServerRequest,isServerRequestCurrent} from './auth';
const retries=new Map<string,{id:string;created:number}>();let retryOwner='';
export function administrativeExpected(etag?:string):{expected_management_etag:string}{
 const token=getToken();if(!token||token.startsWith('local:'))throw Error('Connect and sign in online to manage accounts and permissions');
 if(typeof etag!=='string'||! /^[a-f0-9]{64}$/.test(etag))throw Error('Refresh this account before changing it; its reviewed version is unavailable');return{expected_management_etag:etag};
}

// Online-authoritative administration. Never queue credentials, infer a local
// grant, fall back to SQLite mutations, or reuse a reply after session change.
export async function administrativeJson<T>(path:string,init:RequestInit|undefined,fallback:string):Promise<T>{
 const token=getToken();if(!token||token.startsWith('local:'))throw new Error('Connect and sign in online to manage accounts and permissions');
 const context=await captureServerRequest(token);
 if(!context.accountId||!isServerRequestCurrent(context))throw new Error('Administrative session changed');
 let request=init;let signature:string|undefined;
 if(init?.method&&!['GET','HEAD'].includes(init.method.toUpperCase())){
  if(typeof init.body!=='string')throw Error('Administrative writes require an explicit JSON body');
  if(retryOwner!==context.accountId){retries.clear();retryOwner=context.accountId;}
  const now=Date.now();for(const [key,value] of retries)if(now-value.created>15*60*1000)retries.delete(key);
  const sorted=(v:any):any=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([context.accountId,path,init.method.toUpperCase(),sorted(JSON.parse(init.body))])));
  signature=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  if(!isServerRequestCurrent(context))throw Error('Administrative session changed');
  let retry=retries.get(signature);if(!retry){if(retries.size>=256)throw Error('Too many unresolved administrative requests; refresh before continuing');retry={id:crypto.randomUUID(),created:now};retries.set(signature,retry);}
  const headers=new Headers(init.headers);headers.set('Idempotency-Key',retry.id);request={...init,headers};
 }
 const response=await apiFetch(path,request);
 if(!isServerRequestCurrent(context))throw new Error('Administrative session changed');
 if(!response.ok){const message=await getApiErrorMessage(response,fallback);if(!isServerRequestCurrent(context))throw new Error('Administrative session changed');if(signature&&response.status>=400&&response.status<500&&![408,429].includes(response.status))retries.delete(signature);throw new Error(message);}
 const result=response.status===204?undefined:await response.json();
 if(!isServerRequestCurrent(context))throw new Error('Administrative session changed');
 if(signature)retries.delete(signature);
 return result as T;
}
