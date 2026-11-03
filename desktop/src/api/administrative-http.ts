import {apiFetch,getApiErrorMessage} from './http';
import {getToken,captureServerRequest,isServerRequestCurrent} from './auth';

// Online-authoritative administration. Never queue credentials, infer a local
// grant, fall back to SQLite mutations, or reuse a reply after session change.
export async function administrativeJson<T>(path:string,init:RequestInit|undefined,fallback:string):Promise<T>{
 const token=getToken();if(!token||token.startsWith('local:'))throw new Error('Connect and sign in online to manage accounts and permissions');
 const context=await captureServerRequest(token);
 if(!context.accountId||!isServerRequestCurrent(context))throw new Error('Administrative session changed');
 const response=await apiFetch(path,init);
 if(!isServerRequestCurrent(context))throw new Error('Administrative session changed');
 if(!response.ok){const message=await getApiErrorMessage(response,fallback);if(!isServerRequestCurrent(context))throw new Error('Administrative session changed');throw new Error(message);}
 const result=response.status===204?undefined:await response.json();
 if(!isServerRequestCurrent(context))throw new Error('Administrative session changed');
 return result as T;
}
