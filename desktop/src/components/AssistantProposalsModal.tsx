import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {X,Plus,RefreshCw,Sparkles,Save,Check} from 'lucide-react';
import {getProjects} from '../api/projects';
import {listAssistantProposals,saveAssistantProposal,acceptAssistantProposal,generateAssistantProposal,acknowledgeSavedGeneration,retryPendingAssistantProposal,validateProposalGraph,type AssistantProposal,type ProposalGraph} from '../api/assistant-proposals';
import {localBackend} from '../api/local-backend';
import {captureAccountSession,isAccountSessionCurrent} from '../api/auth';

export default function AssistantProposalsModal({onClose}:{onClose:()=>void}){
 const qc=useQueryClient(),session=useRef(captureAccountSession()),close=useRef(onClose);
 const drafts=useQuery({queryKey:['assistant-proposals'],queryFn:listAssistantProposals}),projects=useQuery({queryKey:['assistant-proposal-targets'],queryFn:getProjects});
 const [selected,setSelected]=useState<AssistantProposal|null>(null),[title,setTitle]=useState(''),[body,setBody]=useState(''),[prompt,setPrompt]=useState(''),[target,setTarget]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const ref=useRef<HTMLDivElement>(null);
 const load=(row:AssistantProposal)=>{setSelected(row);setTitle(row.title);setBody(JSON.stringify(row.graph,null,2));setConfirmed(false);setError(null);};
 const dirty=!!selected&&(title!==selected.title||body!==JSON.stringify(selected.graph,null,2)||selected.revision===0);
 const [closeRequested,setCloseRequested]=useState(false);
 const requestClose=()=>{if(busy){setNotice('Wait for this operation to finish before closing.');return;}if(dirty){setCloseRequested(true);return;}onClose();};close.current=requestClose;
 const current=()=>{if(!isAccountSessionCurrent(session.current))throw new Error('Proposal account changed. Close this window and sign in again.');};
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.focus();const key=(event:KeyboardEvent)=>{
  if(event.key==='Escape'){event.preventDefault();close.current();}
  if(event.key==='Tab'){const nodes=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')||[]);if(event.shiftKey&&(document.activeElement===nodes[0]||document.activeElement===ref.current)){event.preventDefault();nodes.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0]?.focus();}}
 };document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[]);
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError(null);setNotice(null);try{current();await work();current();}catch(error){if(isAccountSessionCurrent(session.current))setError(error instanceof Error?error.message:'Proposal operation failed');}finally{if(isAccountSessionCurrent(session.current))setBusy(false);}};
 const newManual=()=>{
  const id=crypto.randomUUID(),project=(projects.data||[]).find(p=>p.id===target);
  const graph:ProposalGraph={schema_version:1,target:project?{mode:'existing',project_id:project.id,expected_lifecycle_revision:(project as any).lifecycle_revision}:{mode:'new',project_id:crypto.randomUUID(),name:'New project plan',description:'',priority:'normal'},tasks:[{id:crypto.randomUUID(),title:'First task',description:'',priority:'normal',due_date:null}],experiments:[],links:[]};
  load({id,title:project?'Proposed project work':'New project plan',graph,generation_id:null,revision:0,state:'draft',author_id:session.current?.accountId||''});
 };
 const save=()=>run(async()=>{if(!selected)return;const graph=validateProposalGraph(JSON.parse(body));const row=await saveAssistantProposal({id:selected.id,title,graph,generation_id:selected.generation_id,provenance:selected.provenance,expected_revision:selected.revision});current();load(row);qc.invalidateQueries({queryKey:['assistant-proposals']});setNotice('Draft saved. Lab records have not been created.');});
 const generate=(regenerate:boolean)=>run(async()=>{
  const value=await generateAssistantProposal(prompt,target||null,regenerate);current();
  if(value.state!=='ready'){setNotice(value.state==='pending'?'Generation is pending or its outcome is uncertain. Check again; generating another uses a new identity.':'This generation failed. You can explicitly generate another or create a manual draft.');return;}
  // Publish the generated material in the editor before persistence. If SQLite
  // fails, Save retries these same stable IDs; there is no server-write fallback.
  const source=value.result;load({...source,revision:0,state:'draft',author_id:session.current?.accountId||''});
  const row=await saveAssistantProposal({...source,expected_revision:0});current();acknowledgeSavedGeneration();load(row);qc.invalidateQueries({queryKey:['assistant-proposals']});setNotice('Generated draft saved for review. No project, task or experiment has been created.');
 });
 const accept=()=>run(async()=>{if(!selected)return;const result=await acceptAssistantProposal(selected,confirmed);current();load(result);for(const key of ['assistant-proposals','projects','project-workspace','experience'])qc.invalidateQueries({queryKey:[key]});setNotice(result.state==='accepted'?'The reviewed planning graph was accepted by the server.':'Approval and the complete provisional graph are saved on this PC, pending server confirmation.');});
 return createPortal(<div className="fixed inset-0 z-[155] flex items-center justify-center bg-black/70 p-3"><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="proposal-title" className="flex h-[88vh] w-[94vw] max-w-6xl min-h-0 flex-col rounded-xl border border-border bg-surface shadow-2xl outline-none">
  <div className="flex items-center justify-between border-b border-border px-5 py-3"><div><h2 id="proposal-title" className="font-semibold">Planning drafts</h2><p className="text-xs text-text-secondary">Draft and review first. Acceptance creates planning records only.</p></div><button type="button" aria-label="Close planning drafts" onClick={requestClose} className="rounded p-2 hover:bg-surface-raised"><X size={18}/></button></div>
  <div className="flex min-h-0 flex-1 flex-col md:flex-row">
   <aside className="w-full shrink-0 overflow-auto border-b border-border p-3 md:w-64 md:border-b-0 md:border-r">
    <div className="mb-3 flex items-center justify-between"><span className="text-sm font-medium">Saved drafts</span><button disabled={busy} aria-label="Refresh saved drafts" onClick={()=>void drafts.refetch()} className="rounded p-1.5 hover:bg-surface-raised"><RefreshCw size={14}/></button></div>
    {drafts.isLoading&&<p className="text-xs">Reading saved drafts…</p>}{drafts.error&&<p role="alert" className="text-xs text-status-danger">{drafts.error.message}</p>}
    {!!drafts.data?.hidden_count&&<p className="mb-3 text-xs text-text-secondary">Some drafts are retained but unavailable with your current project access.</p>}
    {(drafts.data?.records||[]).map(row=><button type="button" key={row.id} disabled={busy||dirty} onClick={()=>load(row)} className={`mb-1 w-full rounded-lg border p-3 text-left text-sm disabled:opacity-50 ${selected?.id===row.id?'border-accent bg-accent/10':'border-transparent hover:bg-surface-raised'}`}><span className="block truncate font-medium">{row.title}</span><span className="text-xs text-text-secondary">Revision {row.revision} · {row.state==='accept_pending'?'approval pending':row.state}</span></button>)}
    {!drafts.isLoading&&!drafts.error&&!drafts.data?.records.length&&<p className="text-xs text-text-secondary">No accessible saved drafts.</p>}
   </aside>
   <div className="min-w-0 flex-1 overflow-auto p-4 space-y-4">
    {closeRequested&&<div role="alert" className="rounded-lg border border-border p-3 text-sm space-y-2"><p>Your editor has unsaved changes. Save the draft before closing, or explicitly discard those edits.</p><div className="flex gap-3"><button type="button" onClick={()=>setCloseRequested(false)} className="rounded border border-border p-2">Keep editing</button><button type="button" disabled={busy} onClick={onClose} className="rounded border border-border p-2">Discard unsaved edits and close</button></div></div>}
    {!localBackend.isAvailable()&&<button type="button" disabled={busy||dirty} onClick={()=>void run(async()=>{await retryPendingAssistantProposal();current();await drafts.refetch();setNotice('The original browser intention was confirmed. Select its saved draft to review current state.');})} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">Retry original uncertain browser write</button>}
    {(error||notice)&&<p role={error?'alert':'status'} className={`rounded-lg border border-border p-3 text-sm ${error?'text-status-danger':'text-text-secondary'}`}>{error||notice}</p>}
    <div className="rounded-lg border border-border p-3 space-y-3">
     <label className="block text-xs text-text-secondary">Target<select disabled={busy||dirty} value={target} onChange={event=>setTarget(event.target.value)} className="mt-1 w-full rounded border border-border bg-bg p-2 text-sm"><option value="">New project in Planning</option>{(projects.data||[]).filter(p=>!['completed','cancelled','archived'].includes(p.status)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
     <textarea aria-label="Describe a planning draft" value={prompt} disabled={busy||dirty} onChange={event=>setPrompt(event.target.value)} maxLength={4000} rows={2} placeholder="Describe the project, tasks and experiments you want to plan…" className="w-full rounded border border-border bg-bg p-2 text-sm"/>
     <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||dirty} onClick={newManual} className="flex items-center gap-1 rounded border border-border px-3 py-2 text-xs disabled:opacity-40"><Plus size={13}/>Manual draft</button><button type="button" disabled={busy||dirty||!prompt.trim()} onClick={()=>void generate(false)} className="flex items-center gap-1 rounded border border-border px-3 py-2 text-xs disabled:opacity-40"><Sparkles size={13}/>Generate / check same request</button><button type="button" disabled={busy||dirty||!prompt.trim()} onClick={()=>void generate(true)} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">Explicitly generate another</button></div>
    </div>
    {selected&&<>
     <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary"><span>{selected.generation_id?'Generated suggestion; human review required':'Manually authored draft'} · {selected.graph.target.mode==='new'?'New project, project-member visibility':'Existing project'} · {selected.graph.tasks.length} tasks · {selected.graph.experiments.length} experiments · {selected.graph.links.length} links</span>{selected.provenance?.model&&<span>Model: {selected.provenance.model}{selected.provenance_verified?'':' · provenance pending sync'}</span>}</div>
     <label className="block text-xs">Draft title<input value={title} disabled={busy||selected.state!=='draft'} maxLength={200} onChange={event=>{setTitle(event.target.value);setConfirmed(false);}} className="mt-1 w-full rounded border border-border bg-bg p-2 text-sm"/></label>
     <label className="block text-xs">Editable plan JSON<textarea value={body} disabled={busy||selected.state!=='draft'} onChange={event=>{setBody(event.target.value);setConfirmed(false);}} spellCheck={false} rows={14} className="mt-1 w-full rounded border border-border bg-bg p-3 font-mono text-xs"/></label>
     <p className="text-xs text-text-secondary">Only planning text, priorities, dates and bundle links are supported. New tasks start Todo and experiments Planned. This cannot issue stock, spend money, grant access, activate a project or fabricate results.</p>
     {selected.state==='draft'&&<div className="space-y-3"><div className="flex gap-2"><button type="button" disabled={busy||!dirty} onClick={()=>void save()} className="flex items-center gap-1 rounded bg-accent px-3 py-2 text-sm text-bg disabled:opacity-40"><Save size={14}/>Save draft</button>{dirty&&selected.revision>0&&<button type="button" disabled={busy} onClick={()=>load(selected)} className="rounded border border-border px-3 py-2 text-sm">Discard unsaved editor changes</button>}</div><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy||dirty} onChange={event=>setConfirmed(event.target.checked)}/><span>I reviewed this saved revision and authorize creation of this complete planning graph.</span></label><button type="button" disabled={busy||dirty||!confirmed} onClick={()=>void accept()} className="flex items-center gap-1 rounded bg-accent px-3 py-2 text-sm text-bg disabled:opacity-40"><Check size={14}/>Accept reviewed plan</button></div>}
     {selected.state==='accept_pending'&&<p className="text-sm text-text-secondary">The complete provisional graph is saved locally. Further edits to that project wait for confirmation. If sync reports a conflict, preserve the draft and use the sync recovery workflow to reconcile server state; retrying must not create another bundle.</p>}
    </>}
   </div>
  </div>
 </div></div>,document.body);
}
