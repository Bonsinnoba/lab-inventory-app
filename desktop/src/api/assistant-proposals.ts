import {localBackend} from './local-backend';
import {apiFetch,getApiErrorMessage} from './http';
import {captureAccountSession,isAccountSessionCurrent,getToken,captureServerRequest,isServerRequestCurrent} from './auth';
import {validateProposalGraph,proposalDigest,type ProposalGraph} from './assistant-proposal-contract';
export {validateProposalGraph,proposalDigest};
export type {ProposalGraph};
export interface AssistantProposal{id:string;title:string;revision:number;graph:ProposalGraph;generation_id:string|null;provenance?:any;provenance_verified?:boolean;state:'draft'|'accept_pending'|'accepted'|'deleted';author_id:string;created_at?:string;updated_at?:string;graph_digest?:string;}
function session(){const s=captureAccountSession();if(!s)throw new Error('Sign in to use proposals');return s;}
function current(s:ReturnType<typeof session>){if(!isAccountSessionCurrent(s))throw new Error('Proposal account/session changed');}
async function remote(path:string,init?:RequestInit){const s=session();if(getToken()?.startsWith('local:'))throw new Error('Generation and browser synchronization need an online sign-in. Desktop drafts remain available offline.');const response=await apiFetch(path,init);current(s);if(!response.ok)throw new Error(await getApiErrorMessage(response,'Proposal request failed'));const value=await response.json();current(s);return value;}
export async function pullAssistantProposals(){
 const s=session(),rows:AssistantProposal[]=[];let after:string|null=null;
 for(let page=0;page<100;page++){
  const value=await remote('/assistant/proposals/pull'+(after?'?after='+encodeURIComponent(after):''));current(s);
  if(!Array.isArray(value.records)||typeof value.has_more!=='boolean')throw new Error('Incomplete proposal snapshot');
  rows.push(...value.records);if(!value.has_more)return rows;
  if(typeof value.next_cursor!=='string'||value.next_cursor===after)throw new Error('Invalid proposal cursor');after=value.next_cursor;
 }throw new Error('Proposal snapshot exceeds one synchronization pass; existing drafts were preserved');
}
export async function listAssistantProposals():Promise<{records:AssistantProposal[];hidden_count:number}>{
 const s=session();if(localBackend.isAvailable()){const value=await localBackend.invoke<{records:AssistantProposal[];hidden_count:number}>('list_local_assistant_proposals',{expectedAccountId:s.accountId});current(s);if(!value||!Array.isArray(value.records))throw new Error('Local proposal snapshot unavailable; no server fallback');return value;}
 return{records:await pullAssistantProposals(),hidden_count:0};
}
async function browserMutation(id:string,operation:string,payload:any){
 const s=session(),signature=JSON.stringify([id,operation,payload]),storage='labos:proposal-write:'+s.accountId;
 if(!getToken()||getToken()?.startsWith('local:'))throw new Error('Connect and sign in online for browser proposal writes');
 let pending=sessionStorage.getItem(storage);let intent:any=pending?JSON.parse(pending):null;
 if(intent&&intent.signature!==signature)throw new Error('An earlier proposal write has an uncertain outcome. Retry its original payload or check the saved server draft first.');
 if(!intent){intent={signature,change_id:crypto.randomUUID(),id,operation,payload};sessionStorage.setItem(storage,JSON.stringify(intent));}
 const response=await apiFetch('/sync/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:'assistant-proposals-browser:'+s.accountId,changes:[{change_id:intent.change_id,entity_type:'assistant_proposal',entity_id:id,operation,payload}]})});current(s);
 if(!response.ok)throw new Error(await getApiErrorMessage(response,'Proposal synchronization failed'));
 const value=await response.json();current(s);const result=value.results?.find((r:any)=>r.change_id===intent.change_id);
 if(result?.status!=='synced'){if(result?.status==='rejected')sessionStorage.removeItem(storage);throw new Error(result?.error?.message||'Proposal outcome is uncertain; retry the same intention');}
 const receipt=result.result;if(receipt?.id!==id||receipt.revision!==payload.expected_revision+1||!['draft','accepted','deleted'].includes(receipt.state))throw new Error('Proposal receipt was not confirmed');
 if(operation==='save'&&receipt.graph_digest!==await proposalDigest(payload.graph))throw new Error('Saved proposal graph was not confirmed');
 if(operation==='accept'){
  const graph=validateProposalGraph(payload.graph),expected={projects:graph.target.mode==='new'?1:0,tasks:graph.tasks.length,experiments:graph.experiments.length,links:graph.links.length};
  if(receipt.state!=='accepted'||receipt.graph_digest!==payload.graph_digest||receipt.project_id!==graph.target.project_id||Object.entries(expected).some(([key,count])=>receipt.applied?.[key]!==count))throw new Error('Complete accepted proposal graph was not confirmed');
 }
 current(s);sessionStorage.removeItem(storage);return receipt;
}
export async function retryPendingAssistantProposal(){
 const s=session();if(localBackend.isAvailable())throw new Error('Desktop proposal retries use the durable sync queue');
 const raw=sessionStorage.getItem('labos:proposal-write:'+s.accountId);if(!raw)throw new Error('No uncertain browser proposal write to retry');
 const intent=JSON.parse(raw);if(!intent.id||!['save','accept'].includes(intent.operation)||!intent.payload)throw new Error('Original proposal intention is unavailable; preserve this browser session for recovery');
 return browserMutation(intent.id,intent.operation,intent.payload);
}
export async function saveAssistantProposal(input:{id:string;title:string;graph:ProposalGraph;generation_id?:string|null;provenance?:any;expected_revision:number}):Promise<AssistantProposal>{
 const s=session(),graph=validateProposalGraph(input.graph),title=input.title.trim();if(!title||title.length>200)throw new Error('Proposal title is required (maximum 200 characters)');
 if(localBackend.isAvailable()){const row=await localBackend.invoke<AssistantProposal>('save_local_assistant_proposal',{expectedAccountId:s.accountId,proposalId:input.id,title,graph,generationId:input.generation_id??null,provenance:input.provenance??null,expectedRevision:input.expected_revision});current(s);if(!row?.id)throw new Error('Local proposal write was not confirmed; no server fallback');return row;}
 const result=await browserMutation(input.id,'save',{expected_revision:input.expected_revision,title,graph,generation_id:input.generation_id??null});current(s);return{id:input.id,title,graph,generation_id:input.generation_id??null,revision:result.revision,state:'draft',author_id:s.accountId!,provenance:result.provenance,provenance_verified:true,created_at:result.created_at,updated_at:result.updated_at};
}
export async function acceptAssistantProposal(row:AssistantProposal,confirmed:boolean):Promise<AssistantProposal>{
 if(!confirmed)throw new Error('Explicit human confirmation is required');const s=session(),graph=validateProposalGraph(row.graph),digest=await proposalDigest(graph);current(s);
 if(localBackend.isAvailable()){const result=await localBackend.invoke<AssistantProposal>('accept_local_assistant_proposal',{expectedAccountId:s.accountId,proposalId:row.id,expectedRevision:row.revision,graphDigest:digest,confirmed});current(s);if(!result?.id)throw new Error('Local approval was not confirmed; no server fallback');return result;}
 const result=await browserMutation(row.id,'accept',{expected_revision:row.revision,graph_digest:digest,graph,confirmed:true});current(s);return{...row,revision:result.revision,state:'accepted'};
}
const generationKey=(account:string)=>'labos:proposal-generation:'+account;
export async function generateAssistantProposal(prompt:string,targetProjectId:string|null,regenerate=false):Promise<any>{
 const s=session(),key=generationKey(s.accountId!),signature=JSON.stringify([prompt.trim(),targetProjectId]);let stored=sessionStorage.getItem(key),pending=stored?JSON.parse(stored):null;
 if(regenerate){sessionStorage.removeItem(key);pending=null;}
 if(pending&&pending.signature!==signature)throw new Error('Check or explicitly regenerate the previous generation before changing the request');
 if(!pending){pending={id:crypto.randomUUID(),signature};sessionStorage.setItem(key,JSON.stringify(pending));}
 const value=await remote('/assistant/proposals/generate',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':pending.id},body:JSON.stringify({prompt:prompt.trim(),target_project_id:targetProjectId})});current(s);
 if(value.id!==pending.id)throw new Error('Generation identity changed');return value;
}
export function acknowledgeSavedGeneration(){const s=session();sessionStorage.removeItem(generationKey(s.accountId!));}
export async function synchronizeAssistantProposals(){
 if(!localBackend.isAvailable())return true;const s=session(),token=getToken();if(!token||token.startsWith('local:'))return false;
 const context=await captureServerRequest(token),records=await pullAssistantProposals();current(s);if(!context.nativeSessionToken||!isServerRequestCurrent(context))throw new Error('Proposal pull session changed');
 await localBackend.invoke('apply_server_assistant_proposals',{expectedAccountId:s.accountId,expectedSessionToken:context.nativeSessionToken,records,snapshotComplete:true});current(s);return true;
}
