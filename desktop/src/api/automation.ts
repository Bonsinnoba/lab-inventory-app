import {apiFetch,getApiErrorMessage} from './http';
import {localBackend} from './local-backend';
import {captureAccountSession,isAccountSessionCurrent,getToken} from './auth';
import {getItems} from './items';
import {getProjects,getProjectWorkspace} from './projects';
import {readLocalSections,readWithDeadline,assertReadAccount,type ReadAvailability} from './read-availability';
export interface AutomationDue {maintenance:any[];calibration:any[];tasks:any[];availability?:ReadAvailability;}
export interface AutomationRun {run_id:string;queued?:boolean;executed:boolean;created?:number;}
export interface AutomationState {pending:AutomationRun[];last_confirmation:AutomationRun|null;}
function session(){const s=captureAccountSession();if(!s)throw new Error('Sign in to use automation');return s;}
export async function getAutomationDue():Promise<AutomationDue>{
 const s=session();
 if(localBackend.isAvailable()){
  const {values,availability}=await readLocalSections({inventory:getItems,projects:getProjects},s);
  const workspaces=await Promise.all((values.projects??[]).map(async project=>{
   try{return {project,workspace:await readWithDeadline(()=>getProjectWorkspace(project.id))};}catch{return {project,workspace:null};}
  }));assertReadAccount(s);
  availability.sections.tasks=values.projects===null?'unavailable':workspaces.every(w=>w.workspace!==null)?'available':'partial';
  const now=new Date(),day=(offset:number)=>{const date=new Date(now);date.setDate(date.getDate()+offset);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
  const due=(value:unknown,offset:number)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}/.test(value)&&value.slice(0,10)<=day(offset);
  return {maintenance:(values.inventory??[]).filter(i=>due(i.next_maintenance_date,7)),calibration:(values.inventory??[]).filter(i=>due(i.next_calibration_date,30)),tasks:workspaces.flatMap(({project,workspace})=>(workspace?.tasks??[]).filter((t:any)=>!['done','cancelled'].includes(t.status)&&due(t.due_date,0)).map((t:any)=>({...t,project_name:project.name}))),availability};
 }
 const r=await apiFetch('/automation/due',{cache:'no-store'});if(!r.ok)throw new Error(await getApiErrorMessage(r));const result=await r.json();assertReadAccount(s);if(!result||!['maintenance','calibration','tasks'].every(key=>Array.isArray(result[key])))throw new Error('Automation due snapshot is incomplete');return result;
}
export async function getAutomationState():Promise<AutomationState>{
 const s=session();if(!localBackend.isAvailable())return {pending:[],last_confirmation:null};
 const value=await localBackend.invoke<AutomationState>('get_local_automation_state',{expectedAccountId:s.accountId});
 if(!value||!Array.isArray(value.pending))throw new Error('Local automation state unavailable');assertReadAccount(s);return value;
}
export async function runAutomation():Promise<AutomationRun>{
 const s=session();
 if(localBackend.isAvailable()){
  const value=await localBackend.invoke<AutomationRun>('queue_local_automation_run',{expectedAccountId:s.accountId});
  if(!value?.run_id||value.queued!==true||value.executed!==false)throw new Error('Local automation intention was not confirmed; no server fallback');
  assertReadAccount(s);return value;
 }
 if(getToken()?.startsWith('local:'))throw new Error('A server session is required');
 const storageKey=`labos:automation-run:${s.accountId}`;
 let key=sessionStorage.getItem(storageKey);if(!key){key=crypto.randomUUID();sessionStorage.setItem(storageKey,key);}
 const r=await apiFetch('/automation/run',{method:'POST',headers:{'Idempotency-Key':key}});
 if(!isAccountSessionCurrent(s))throw new Error('Account changed while running automation');
 if(!r.ok){if(r.status>=400&&r.status<500&&![408,429].includes(r.status))sessionStorage.removeItem(storageKey);throw new Error(await getApiErrorMessage(r));}
 const value=await r.json();if(value.run_id!==key||value.executed!==true||!Number.isSafeInteger(value.created)||value.created<0)throw new Error('Automation result was not confirmed');
 sessionStorage.removeItem(storageKey);return value;
}
