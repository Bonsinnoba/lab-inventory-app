import type {Resource} from './resources';
import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {apiFetch,getApiErrorMessage} from './http';

export type MetadataFields={name?:string;category?:string;description?:string;tags?:string[]};
const key='labos.resource-metadata.http-intents.v1';
type Retry={change:string;device:string};
// Browser retries use the same server transaction/receipt as desktop outbox
// events. Desktop never enters this path, including after a SQLite failure.
export async function writeResourceMetadataHttp(id:string,fields:MetadataFields,revision:string):Promise<Resource>{
 if(typeof window!=='undefined'&&(window as any).__TAURI_IPC__)throw Error('Desktop metadata must use SQLite and the outbox');
 const session=captureAccountSession();if(!session||session.token.startsWith('local:'))throw Error('Sign in online before editing resource details');
 if(!revision||!Number.isFinite(Date.parse(revision)))throw Error('Refresh and review resource details before saving');
 const normalized={...('name'in fields?{name:fields.name}:{}),...('category'in fields?{category:fields.category}:{}),...('description'in fields?{description:fields.description}:{}),...('tags'in fields?{tags:fields.tags}:{})};
 const signature=JSON.stringify([session.accountId,id,revision,normalized]);
 const read=():Record<string,Retry>=>{try{const rows=JSON.parse(sessionStorage.getItem(key)||'{}');if(!rows||Array.isArray(rows)||typeof rows!=='object')throw Error();return rows;}catch{throw Error('Resource retry storage unavailable; restore browser storage before saving');}};
 const rows=read();let retry=rows[signature];
 if(!retry){if(Object.keys(rows).length>=100)throw Error('Resolve earlier resource-detail requests before saving more');retry={change:crypto.randomUUID(),device:crypto.randomUUID()};rows[signature]=retry;sessionStorage.setItem(key,JSON.stringify(rows));}
 if(!isAccountSessionCurrent(session))throw Error('Account changed before saving resource details');
 const response=await apiFetch('/sync/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:retry.device,changes:[{change_id:retry.change,entity_type:'resource',entity_id:id,operation:'edit_metadata',payload:{id,metadata:{protocol:1,expected_updated_at:revision,fields:normalized,previous_change_id:null}}}]})});
 if(!isAccountSessionCurrent(session))throw Error('Account changed while saving resource details');
 if(!response.ok)throw Error(await getApiErrorMessage(response,'Resource details were not confirmed; retry to reconcile'));
 const body=await response.json();if(!isAccountSessionCurrent(session))throw Error('Account changed while reading resource confirmation');
 const result=body?.results?.length===1&&body.results[0]?.change_id===retry.change?body.results[0]:null;
 if(result?.status!=='synced'){
  // Definitive rejection leaves the draft editable. Uncertain failures retain
  // the original identity so retry cannot create a second successful write.
  if(result?.status==='rejected'){const latest=read();delete latest[signature];sessionStorage.setItem(key,JSON.stringify(latest));}
  throw Error(result?.error?.message||'Resource details were not confirmed; retry the same reviewed values');
 }
 const receipt=result.result;
 if(receipt?.acknowledged!==true||(receipt.id!==undefined&&receipt.id!==id))throw Error('Incomplete resource confirmation; retry to reconcile');
 // A receipt is not a live read grant and deliberately omits historical
 // metadata. Fetch the current authorized projection instead of broadening it.
 const refreshed=await apiFetch(`/resources/${encodeURIComponent(id)}`);
 if(!isAccountSessionCurrent(session))throw Error('Account changed while refreshing resource details');
 if(!refreshed.ok)throw Error('Details were saved, but their current view could not refresh. Reopen the resource or retry to reconcile.');
 const resource=await refreshed.json();
 if(!isAccountSessionCurrent(session))throw Error('Account changed while reading resource details');
 if(resource?.id!==id||!['file','folder','link'].includes(resource.kind))throw Error('Incomplete resource view; retry to reconcile');
 const latest=read();delete latest[signature];sessionStorage.setItem(key,JSON.stringify(latest));return resource;
}
