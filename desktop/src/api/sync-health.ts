import {API_BASE} from '../lib/config';

// Advisory connectivity only: success never grants authority or acknowledges work.
// No bearer token, native session or document data is sent to this endpoint.
export async function isSyncServerReachable():Promise<boolean>{
 const controller=new AbortController();
 const timer=window.setTimeout(()=>controller.abort(),2000);
 try{const response=await fetch(`${API_BASE}/health`,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});return response.ok||response.status===429;}
 catch{return false;}
 finally{window.clearTimeout(timer);}
}
