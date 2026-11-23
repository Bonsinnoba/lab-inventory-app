import {captureAccountSession,isAccountSessionCurrent,type AccountSession} from './auth';

export type ReadState='available'|'partial'|'unavailable';
export interface ReadAvailability {
  source:'local';
  readAt:string;
  // Read time is not a synchronization timestamp or proof of global completeness.
  sections:Record<string,ReadState>;
}
type Loaders=Record<string,()=>Promise<any>>;
export function readWithDeadline<T>(read:()=>Promise<T>,timeoutMs=5000):Promise<T>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Local section did not respond in time')),timeoutMs);
    // Consume late success/failure without using it in this view. Underlying
    // repositories retain their own account guards; reads are not mutations.
    Promise.resolve().then(read).then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)});
  });
}
export function assertReadAccount(session:AccountSession|null){
  if(!isAccountSessionCurrent(session))throw new Error('Account changed or signed out while loading this view');
}
/** One view budget and four pending native reads, even when timed-out invokes
 * cannot be cancelled. Unstarted/failed rows stay unknown, never empty records. */
export async function readLocalCollection<T,R>(items:T[],read:(item:T)=>Promise<R>,session=captureAccountSession(),timeoutMs=5000){
  assertReadAccount(session);
  const results=items.map(item=>({item,value:null as R|null}));
  const deadline=Date.now()+timeoutMs;let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{
    while(cursor<items.length&&Date.now()<deadline){
      assertReadAccount(session);const index=cursor++;
      try{results[index].value=await readWithDeadline(()=>read(items[index]),Math.max(1,deadline-Date.now()));}
      catch{/* Failed and unstarted local rows remain explicitly unavailable. */}
      assertReadAccount(session);
    }
  }));
  assertReadAccount(session);return results;
}
export async function readLocalSections<T extends Loaders>(loaders:T,session=captureAccountSession(),timeoutMs=5000){
  assertReadAccount(session);
  const entries=Object.entries(loaders);
  const results=await Promise.allSettled(entries.map(([,read])=>readWithDeadline(read,timeoutMs)));
  assertReadAccount(session);
  const values={} as {[K in keyof T]:Awaited<ReturnType<T[K]>>|null};
  const sections:Record<string,ReadState>={};
  entries.forEach(([key],index)=>{
    const result=results[index];
    const available=result.status==='fulfilled'&&result.value!=null;
    (values as any)[key]=available?(result as PromiseFulfilledResult<unknown>).value:null;
    sections[key]=available?'available':'unavailable';
  });
  return {values,availability:{source:'local',readAt:new Date().toISOString(),sections} as ReadAvailability};
}
export function sectionAvailable(availability:ReadAvailability|undefined,key:string){
  return !availability||availability.sections[key]==='available';
}
