import type {AccountSession} from './auth';

// One active automatic attempt, plus one explicit recovery request. Timer ticks
// do not attach duplicate invalidations to a long-running synchronization.
export function createAutomaticSync(options:{
 session:()=>AccountSession|null;
 isCurrent:(session:AccountSession|null)=>boolean;
 reachable:()=>Promise<boolean>;
 sync:(force:boolean)=>Promise<boolean>;
 unavailable:(session:AccountSession)=>void;
 completed:()=>void;
}){
 let active:Promise<void>|null=null,stopped=false,forced=false,reachable:boolean|null=null,owner:AccountSession|null=null;
 function same(a:AccountSession|null,b:AccountSession|null){return a?.accountId===b?.accountId&&a?.token===b?.token&&a?.generation===b?.generation;}
 function tick(force=false):Promise<void>{
  if(stopped)return Promise.resolve();
  if(active){if(force)forced=true;return active;}
  const session=options.session();if(!session)return Promise.resolve();
  if(!same(owner,session)){owner=session;reachable=null;}
  active=Promise.resolve().then(async()=>{
   const available=await options.reachable();if(stopped||!options.isCurrent(session))return;
   if(!available){reachable=false;options.unavailable(session);return;}
   const recovered=reachable===false;reachable=true;
   const ran=await options.sync(force||recovered);
   if(!stopped&&options.isCurrent(session)&&ran)options.completed();
  }).catch(()=>{/* The sync worker reports failures without losing the timer. */})
    .finally(()=>{active=null;if(forced&&!stopped){forced=false;void tick(true);}});
  return active;
 }
 return{tick,stop(){stopped=true;forced=false;}};
}
