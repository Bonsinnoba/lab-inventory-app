import {invoke} from '@tauri-apps/api/tauri';
import {captureServerRequest,isServerRequestCurrent} from './auth';

export async function refreshResourceAuthority(token:string,assertSession:()=>void):Promise<void>{
  assertSession();
  const status=await invoke<{resource_authority_protocol?:number}>('local_database_status');
  assertSession();
  // A development renderer may reload before the new native binary is deployed.
  // Old binaries retain their existing restrictions; no renderer grant fallback.
  if(status.resource_authority_protocol!==1)return;
  const context=await captureServerRequest(token);
  assertSession();
  if(!context.nativeSessionToken||!isServerRequestCurrent(context))throw new Error('Native resource authorization session unavailable');
  await invoke('refresh_local_resource_authority',{expectedAccountId:context.accountId,expectedSessionToken:context.nativeSessionToken,serverToken:token});
  assertSession();
  if(!isServerRequestCurrent(context))throw new Error('Resource authorization session changed');
}
