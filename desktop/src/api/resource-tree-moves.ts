import {invoke} from '@tauri-apps/api/tauri';
import {captureAccountSession,isAccountSessionCurrent,getToken} from './auth';
import {isTauriRuntime} from '../lib/runtime';
import type {Resource} from './resources';

export type TreeDestination={item_id?:string|null;project_id?:string|null;note_id?:string|null;parent_resource_id?:string|null};
type Ticket={review_id:string;resource_id:string;member_count:number};
async function prepare(id:string,destination:TreeDestination){
 if(!isTauriRuntime())throw Error('Reviewed offline resource moves require the updated desktop app');
 const owner=captureAccountSession();if(!owner||!isAccountSessionCurrent(owner))throw Error('Sign in before reviewing a folder move');
 const status=await invoke<{resource_tree_move_protocol?:number}>('local_database_status');
 if(!isAccountSessionCurrent(owner))throw Error('Account changed during folder review');
 if(status.resource_tree_move_protocol!==2)throw Error('Update the desktop before moving resources into folders; saved work is unchanged');
 const nativeSession=await invoke<string>('local_authorization_guard',{expectedAccountId:owner.accountId});
 if(!isAccountSessionCurrent(owner))throw Error('Account changed during folder review');
 const ticket=await invoke<Ticket>('prepare_local_resource_tree_move',{expectedAccountId:owner.accountId,expectedSessionToken:nativeSession,resourceId:id,destination,serverToken:getToken()});
 if(!isAccountSessionCurrent(owner))throw Error('Account changed during folder review');
 if(!ticket||ticket.resource_id!==id||!ticket.review_id||!Number.isInteger(ticket.member_count)||ticket.member_count<1||ticket.member_count>500)throw Error('Invalid native folder review; no move was saved');
 return {owner,nativeSession,ticket};
}
export async function prepareResourceTreeMove(id:string,destination:TreeDestination):Promise<number>{return(await prepare(id,destination)).ticket.member_count;}
export async function moveResourceTree(id:string,destination:TreeDestination):Promise<Resource>{
 const {owner,nativeSession,ticket}=await prepare(id,destination);
 if(!isAccountSessionCurrent(owner))throw Error('Account changed before moving folder');
 const resource=await invoke<Resource>('move_local_resource_tree',{expectedAccountId:owner.accountId,expectedSessionToken:nativeSession,reviewId:ticket.review_id});
 if(!isAccountSessionCurrent(owner))throw Error('Account changed while saving folder move');
 return resource;
}
