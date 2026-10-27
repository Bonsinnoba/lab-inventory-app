import type { AccountSession } from './auth';

export type SyncRuntimeState = { status:'offline'|'syncing'|'idle'|'error'; lastSuccessAt:string|null; lastError:string|null; step?:string|null };
type Storage = Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
const delays=[5000,15000,30000,60000,120000,300000];
const empty=():SyncRuntimeState=>({status:'idle',lastSuccessAt:null,lastError:null});

// Operational status only: never grants authority and never migrates unowned v1
// status/error text into whichever account happens to sign in first.
export function createSyncRuntimeStore(options:{
  storage:()=>Storage|undefined;
  session:()=>AccountSession|null;
  isCurrent:(session:AccountSession|null)=>boolean;
  now?:()=>number;
}) {
  const now=options.now??Date.now;
  let owner:AccountSession|null=null,state=empty(),retryAt=0,streak=0;
  const listeners=new Set<(state:SyncRuntimeState)=>void>();
  const key=(accountId:string)=>`labos.sync.account.v2:${encodeURIComponent(accountId)}`;
  const emit=()=>listeners.forEach(listener=>listener({...state}));
  function refresh(){
    const next=options.session();
    if(owner?.accountId===next?.accountId&&owner?.token===next?.token&&owner?.generation===next?.generation)return;
    owner=next;state=empty();retryAt=0;streak=0;
    if(owner)try{
      const raw=options.storage()?.getItem(key(owner.accountId));
      const saved=raw?JSON.parse(raw):null;
      if(saved&&typeof saved==='object'){
        const error=typeof saved.lastError==='string'&&saved.lastError?saved.lastError:null;
        state={status:error?'error':'idle',lastError:error,lastSuccessAt:typeof saved.lastSuccessAt==='string'&&Number.isFinite(Date.parse(saved.lastSuccessAt))?saved.lastSuccessAt:null};
        streak=Number.isSafeInteger(saved.streak)&&saved.streak>=0?Math.min(saved.streak,delays.length):0;
        retryAt=typeof saved.retryAt==='number'&&Number.isFinite(saved.retryAt)?Math.min(Math.max(saved.retryAt,0),now()+delays[delays.length-1]):0;
      }
    }catch{/* Missing/corrupt/unavailable operational storage is not queue loss. */}
    emit();
  }
  function persist(){if(owner)try{options.storage()?.setItem(key(owner.accountId),JSON.stringify({lastSuccessAt:state.lastSuccessAt,lastError:state.lastError,retryAt,streak}));}catch{}}
  function accepts(session:AccountSession|null){refresh();return !!session&&options.isCurrent(session)&&owner?.accountId===session.accountId&&owner.generation===session.generation&&owner.token===session.token;}
  return {
    refresh,
    getState(){refresh();return {...state};},
    retryDue(){refresh();return retryAt<=now();},
    subscribe(listener:(state:SyncRuntimeState)=>void){refresh();listeners.add(listener);listener({...state});return()=>{listeners.delete(listener);};},
    publish(session:AccountSession|null,patch:Partial<SyncRuntimeState>){if(!accepts(session))return;state={...state,...patch};if(state.status!=='syncing')state.step=null;persist();emit();},
    scheduleRetry(session:AccountSession|null){if(!accepts(session))return;retryAt=now()+delays[Math.min(streak,delays.length-1)];streak=Math.min(streak+1,delays.length);persist();},
    clearRetry(session:AccountSession|null){if(!accepts(session))return;retryAt=0;streak=0;persist();},
  };
}
