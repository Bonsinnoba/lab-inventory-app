import {captureAccountSession,getLocalAuthStatus,isAccountSessionCurrent} from '../api/auth';

/** Check native authority for both local and server-token desktop sessions.
 * Coalesce resume/timer bursts without launching replacement native reads when
 * an invoke is slow. A failed read is not evidence of revocation or expiry. */
export function createDesktopLeaseMonitor(onExpired:()=>void){
 let stopped=false,inFlight:Promise<void>|null=null,requested=false;
 const check=():Promise<void>=>{
  if(stopped)return Promise.resolve();
  if(inFlight){requested=true;return inFlight;}
  const session=captureAccountSession();
  if(!session)return Promise.resolve();
  const run=async()=>{
   try{
    const status=await getLocalAuthStatus();
    if(stopped||!isAccountSessionCurrent(session)||!status)return;
    const matchingAccount=status.user?.id===session.accountId;
    const matchingLocalToken=!session.token.startsWith('local:')||status.token===session.token;
    if(!status.authenticated||!matchingAccount||!matchingLocalToken){
     stopped=true;onExpired();
    }
   }catch{
    // Storage/IPC failure cannot safely be reclassified as an expired lease.
    // Data repositories continue to enforce native authority independently.
   }
  };
  inFlight=run().finally(()=>{
   inFlight=null;
   if(requested&&!stopped){requested=false;void check();}
  });
  return inFlight;
 };
 return{check,stop:()=>{stopped=true;requested=false;}};
}
