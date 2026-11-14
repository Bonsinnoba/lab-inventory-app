import {invoke} from '@tauri-apps/api/tauri';
import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {isTauriRuntime} from '../lib/runtime';
export type RecoveryStatus={supported:boolean;configured:boolean;is_custodian:boolean;key_locked:boolean;format_version:number;working_data_encrypted:boolean;retention:string;busy:boolean;can_cancel?:boolean;cancel_supported?:boolean;retention_supported?:boolean};
export type RecoveryResult={cancelled:boolean;path?:string;verified?:{files:number;bytes:number;backup_id:string};activated?:boolean;sessions_cleared?:boolean;key_recovered?:boolean;working_key_available?:boolean;activation_ticket?:string};
async function call<T>(command:string,secret?:string,extra?:Record<string,unknown>):Promise<T>{
 if(!isTauriRuntime())throw Error('Recovery packages are managed in the Windows desktop app');
 const session=captureAccountSession();if(!session)throw Error('Sign in before managing recovery packages');
 const protocol=await invoke<{recovery_backup_protocol?:number;recovery_cancel_protocol?:number;recovery_retention_protocol?:number}>('local_database_status');
 if(!isAccountSessionCurrent(session))throw Error('Account changed while opening recovery controls');
 if(protocol.recovery_backup_protocol!==1)throw Error('Recovery packages require the updated desktop build');
 if(command==='cancel_local_recovery_operation'&&protocol.recovery_cancel_protocol!==1)throw Error('Cancellable recovery requires the updated desktop build');
 if(['list_local_recovery_backups','prune_local_recovery_backup'].includes(command)&&protocol.recovery_retention_protocol!==1)throw Error('Verified backup retention requires the updated desktop build');
 const token=await invoke<string>('local_authorization_guard',{expectedAccountId:session.accountId});
 if(!isAccountSessionCurrent(session))throw Error('Account changed before recovery operation');
 const result=await invoke<T>(command,{...extra,expectedAccountId:session.accountId,expectedSessionToken:token,...(secret===undefined?{}:{recoverySecret:secret})});
 if(!isAccountSessionCurrent(session))throw Error('Account changed during recovery operation; inspect the chosen destination before retrying');return result;
}
export const getRecoveryStatus=()=>call<RecoveryStatus>('get_local_recovery_status');
export const createRecoveryBackup=(secret:string)=>call<RecoveryResult>('create_local_recovery_backup',secret);
export const restoreRecoveryPackage=(secret:string)=>call<RecoveryResult>('restore_local_recovery_package',secret);
export const recoverRecoveryKey=(secret:string)=>call<RecoveryResult>('recover_local_recovery_key',secret);
export async function cancelRecoveryOperation():Promise<boolean>{const result=await call<boolean>('cancel_local_recovery_operation');if(typeof result!=='boolean')throw Error('Cancellation could not be confirmed');return result;}
export type StandaloneRecoveryStatus={protocol:number;supported:boolean;working_key_repair_supported?:boolean;busy:boolean;can_cancel:boolean};
export async function getWorkspaceStartupStatus():Promise<{ready:boolean;message?:string|null}>{if(!isTauriRuntime())return{ready:true};return invoke('local_startup_status');}
export async function getStandaloneRecoveryStatus():Promise<StandaloneRecoveryStatus>{if(!isTauriRuntime())throw Error('Recovery requires the desktop app');return invoke('standalone_recovery_status');}
export async function restoreStandaloneRecovery(secret:string):Promise<RecoveryResult>{
 const status=await getStandaloneRecoveryStatus();if(status.protocol!==1||!status.supported)throw Error('Standalone recovery requires the updated Windows desktop build');
 if(status.busy)throw Error('Another recovery operation is already running');
 return invoke('restore_standalone_recovery_package',{recoverySecret:secret});
}
export async function cancelStandaloneRecovery():Promise<boolean>{if(!isTauriRuntime())throw Error('Recovery requires the desktop app');const result=await invoke('cancel_standalone_recovery');if(typeof result!=='boolean')throw Error('Cancellation was not confirmed');return result;}
export async function activateStandaloneRecovery(ticket:string):Promise<void>{const status=await getStandaloneRecoveryStatus();if(status.protocol!==1||!status.supported)throw Error('Recovery activation requires the updated Windows desktop build');if(status.busy)throw Error('Another recovery operation is already running');if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ticket))throw Error('Verify and review the recovery copy again');await invoke('activate_recovered_workspace',{activationTicket:ticket});}
export type RecoveryBackup={id:string;path:string;size_bytes:number;pending_intents:number|null;state:'recorded'|'missing'|'retired'|'cleanup_pending';latest_recorded:boolean;pruning_requires_verification:boolean};
export const listRecoveryBackups=()=>call<RecoveryBackup[]>('list_local_recovery_backups');
export async function pruneRecoveryBackup(id:string):Promise<{retired:boolean;cleanup_pending:boolean}>{if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw Error('Select a registered backup');return call('prune_local_recovery_backup',undefined,{backupId:id});}

export async function repairCurrentWorkspaceKey(ticket:string):Promise<void>{const status=await getStandaloneRecoveryStatus();if(status.protocol!==1||!status.supported||!status.working_key_repair_supported)throw Error('Working-key repair requires the updated encryption-enabled desktop build');if(status.busy)throw Error('Another recovery operation is already running');if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ticket))throw Error('Verify and review the owner-held recovery copy again');await invoke('repair_current_workspace_key',{activationTicket:ticket});}
