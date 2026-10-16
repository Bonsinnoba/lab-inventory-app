import {invoke} from '@tauri-apps/api/tauri';
import {captureServerRequest,isServerRequestCurrent} from './auth';

export async function confirmResourceMutation(changeId:string,token:string,assertSession:()=>void):Promise<void>{
  assertSession();
  const status=await invoke<{resource_mutation_confirmation_protocol?:number}>('local_database_status');assertSession();
  if(status.resource_mutation_confirmation_protocol!==1)throw new Error('The updated desktop build is required to confirm resource mutations. Saved work remains pending.');
  const context=await captureServerRequest(token);assertSession();
  if(!context.nativeSessionToken||!isServerRequestCurrent(context))throw new Error('Resource mutation confirmation session changed');
  await invoke('confirm_local_resource_mutation',{expectedAccountId:context.accountId,expectedSessionToken:context.nativeSessionToken,serverToken:token,changeId});
  assertSession();if(!isServerRequestCurrent(context))throw new Error('Resource mutation confirmation session changed');
}

export async function confirmResourceChange(changeId:string,token:string,assertSession:()=>void):Promise<void>{
  assertSession();
  const status=await invoke<{resource_confirmation_protocol?:number}>('local_database_status');
  assertSession();
  if(status.resource_confirmation_protocol!==1)throw new Error('The updated desktop build is required to confirm file changes. Saved work remains pending.');
  const context=await captureServerRequest(token);assertSession();
  if(!context.nativeSessionToken||!isServerRequestCurrent(context))throw new Error('File confirmation session changed');
  await invoke('confirm_local_resource_changes',{expectedAccountId:context.accountId,expectedSessionToken:context.nativeSessionToken,serverToken:token,changeId});
  assertSession();
  if(!isServerRequestCurrent(context))throw new Error('File confirmation session changed');
}
