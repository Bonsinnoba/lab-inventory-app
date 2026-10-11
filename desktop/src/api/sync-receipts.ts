export type ReceiptChange = {change_id:string};
export type SyncResult = {change_id:string;status:'synced'|'failed'|'rejected';result?:unknown;error?:{code?:string;message?:string}};

// Process each submitted intent independently. Missing/duplicate receipts are
// retryable protocol failures, never permission to silently clear an outbox.
export async function processSyncReceipts<C extends ReceiptChange>(
  changes:C[], results:SyncResult[], handlers:{
    assertSession:()=>void;
    acknowledge:(change:C,result:SyncResult)=>Promise<void>;
    reject:(change:C,result:SyncResult)=>Promise<void>;
    fail:(change:C,message:string)=>Promise<void>;
  }
):Promise<{syncedCount:number;failedCount:number;retry:boolean}> {
  let syncedCount=0,failedCount=0,retry=false;
  for(const change of changes){
    handlers.assertSession();
    try{
      const matches=results.filter(result=>result?.change_id===change.change_id);
      if(matches.length!==1)throw new Error('Missing or duplicate sync acknowledgement; retrying the same change');
      const result=matches[0];
      if(result.status==='synced'){
        await handlers.acknowledge(change,result);
        handlers.assertSession();syncedCount++;
      }else if(result.status==='rejected'||result.error?.code==='SYNC_CONFLICT'){
        await handlers.reject(change,result);failedCount++;
      }else{
        throw new Error(result.error?.message||result.error?.code||'Unable to apply sync change');
      }
    }catch(error){
      // Session switches must abort, not write errors into another account.
      handlers.assertSession();failedCount++;retry=true;
      await handlers.fail(change,error instanceof Error?error.message:String(error));
    }
  }
  return {syncedCount,failedCount,retry};
}
