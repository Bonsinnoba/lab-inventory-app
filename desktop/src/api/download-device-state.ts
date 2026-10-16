import {localBackend} from './local-backend';
import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {isTauriRuntime} from '../lib/runtime';
import type {Resource} from './resources';

export type DownloadDeviceState={
  session:NonNullable<ReturnType<typeof captureAccountSession>>;
  resources:Record<string,Resource>;
  copies:Record<string,NonNullable<Resource['local_copy']>>;
  copiesChecked:boolean;
};

// Separate from the server queue: reading it never initiates a download, grants
// access, or infers PC availability from a server filename/completed job.
export async function readDownloadDeviceState():Promise<DownloadDeviceState>{
  if(!isTauriRuntime())throw new Error('PC file status requires the desktop app');
  const session=captureAccountSession();
  if(!session)throw new Error('Sign in to read PC file status');
  const check=()=>{if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading PC file status');};
  const rows=await localBackend.invoke<Resource[]>('list_local_resources');check();
  if(!Array.isArray(rows))throw new Error('Local resource metadata unavailable');
  let copies:DownloadDeviceState['copies']={},copiesChecked=false;
  try{
    const result=await localBackend.invoke<DownloadDeviceState['copies']>('local_resource_copy_status',{expectedAccountId:session.accountId});
    if(result&&typeof result==='object'&&!Array.isArray(result)){copies=result;copiesChecked=true;}
  }catch{/* Metadata/posters remain usable; failed status is unknown, not absent. */}
  check();
  return {session,resources:Object.fromEntries(rows.map(r=>[r.id,r])),copies,copiesChecked};
}

export function downloadDeviceLabel(state:DownloadDeviceState|undefined,resourceId:string):string{
  if(!state||!isAccountSessionCurrent(state.session))return 'PC file status unavailable';
  if(!state.resources[resourceId])return 'Resource not available in this local view';
  if(!state.copiesChecked)return 'PC file status unavailable';
  const copy=state.copies[resourceId];
  if(!copy)return 'Current resource not verified on this PC';
  switch(copy.state){
    case 'ready':return 'Current resource available on this PC';
    case 'needs_verification':return 'PC copy needs verification';
    case 'stale':return 'PC copy is for an older revision or server — refresh pending';
    case 'copying':return copy.error?'PC copy interrupted — retry pending':'Copying current resource to this PC';
    case 'incomplete':return 'PC copy incomplete — retry pending';
    default:return 'PC file status unavailable';
  }
}
