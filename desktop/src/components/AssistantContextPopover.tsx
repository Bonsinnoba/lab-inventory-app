import {useEffect,useId,useRef,useState,type RefObject} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Settings2,X,Check} from 'lucide-react';
import {getProjects} from '../api/projects';
import {scopeLabels,scopeDescriptions,requiresProject,contextIssue,normalizeAssistantContext,sameAssistantContext,type AssistantContext,type AssistantScope} from '../lib/assistantContext';

interface Props {value:AssistantContext;triggerRef:RefObject<HTMLButtonElement>;tools:string[];customOptions:string[][];streaming:boolean;onApply:(next:AssistantContext)=>Promise<void>;onClose:()=>void}
export default function AssistantContextPopover({value,triggerRef,tools,customOptions,streaming,onApply,onClose}:Props){
 const [draft,setDraft]=useState<AssistantContext>(()=>({...value,customTools:[...value.customTools]})),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const panel=useRef<HTMLElement>(null),busy=useRef(false),active=useRef(true),close=useRef(onClose);close.current=onClose;
 const radioName=useId();
 const projects=useQuery({queryKey:['assistant-projects'],queryFn:getProjects,enabled:draft.scope!=='none',staleTime:30000});
 const candidate=normalizeAssistantContext({...draft,customTools:draft.customTools.filter(name=>tools.includes(name))});
 const unavailableProject=requiresProject(candidate.scope)&&!!candidate.projectId&&projects.isSuccess&&!projects.data.some(p=>p.id===candidate.projectId);
 const issue=contextIssue(candidate)||(requiresProject(candidate.scope)&&projects.isError?'Projects could not be loaded. Retry below.':unavailableProject?'Choose an available project.':requiresProject(candidate.scope)&&projects.isPending?'Loading available projects…':null);
 const changed=!sameAssistantContext(candidate,value);
 useEffect(()=>{active.current=true;const frame=requestAnimationFrame(()=>panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus({preventScroll:true}));
  const pointer=(event:PointerEvent)=>{if(!busy.current&&!panel.current?.contains(event.target as Node)&&!triggerRef.current?.contains(event.target as Node))close.current();};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy.current){close.current();requestAnimationFrame(()=>triggerRef.current?.focus());}}};
  document.addEventListener('pointerdown',pointer);window.addEventListener('keydown',key);return()=>{active.current=false;cancelAnimationFrame(frame);document.removeEventListener('pointerdown',pointer);window.removeEventListener('keydown',key);};
 },[triggerRef]);
 async function apply(){if(issue||!changed||streaming||busy.current)return;busy.current=true;setSaving(true);setError('');try{await onApply(candidate);}catch(error){if(active.current)setError(error instanceof Error?error.message:'Context could not be confirmed. Try again.');}finally{busy.current=false;if(active.current)setSaving(false);}}
 return <section ref={panel} role="dialog" aria-modal="false" aria-label="Assistant context" className="assistant-context-popover">
  <header className="assistant-popover-header"><span className="assistant-popover-icon"><Settings2 size={16}/></span><div><h2>Assistant context</h2><p>Choose what the assistant can read.</p></div><button type="button" className="assistant-icon-button" disabled={saving} aria-label="Close context selector" onClick={()=>{onClose();triggerRef.current?.focus();}}><X size={16}/></button></header>
  <div className="assistant-popover-body"><fieldset disabled={saving}>
   <legend className="assistant-field-label">Context scope</legend><div className="assistant-scope-grid" role="radiogroup" aria-label="Context scope">{(Object.keys(scopeLabels) as AssistantScope[]).map(scope=><label key={scope} className={`assistant-scope-option ${draft.scope===scope?'is-selected':''}`}><input className="sr-only" type="radio" name={radioName} aria-label={scopeLabels[scope]} checked={draft.scope===scope} onChange={()=>{setError('');setDraft(current=>({...current,scope,projectId:scope==='none'?null:current.projectId}));}}/><span>{scopeLabels[scope]}</span>{draft.scope===scope&&<Check size={12}/>}</label>)}</div>
   <p className="assistant-context-description">{scopeDescriptions[draft.scope]}</p>
   {draft.scope!=='none'&&<label className="assistant-field-label">{draft.scope==='custom'?'Project (optional)':'Project'}<select aria-label="Context project" className="assistant-context-input" value={draft.projectId||''} disabled={projects.isPending||(projects.isError&&requiresProject(draft.scope))} onChange={event=>{setError('');setDraft(current=>({...current,projectId:event.target.value||null}));}}><option value="">{projects.isPending?'Loading projects…':draft.scope==='custom'?'No fixed project':'Choose a project…'}</option>{(projects.data||[]).map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
   {draft.scope!=='none'&&projects.isError&&<button type="button" className="assistant-text-button" onClick={()=>void projects.refetch()}>Retry loading projects</button>}
   {draft.scope==='custom'&&<fieldset className="assistant-context-sources"><legend className="assistant-field-label">Data sources</legend>{customOptions.filter(([name])=>tools.includes(name)).map(([name,label])=><label key={name}><input type="checkbox" checked={draft.customTools.includes(name)} onChange={()=>{setError('');setDraft(current=>({...current,customTools:current.customTools.includes(name)?current.customTools.filter(n=>n!==name):[...current.customTools,name]}));}}/>{label}</label>)}{!tools.length&&<p className="assistant-context-description">Available sources could not be read. Reconnect and reopen the selector.</p>}</fieldset>}
  </fieldset>
  <p role="status" className="assistant-context-hint">{issue||'Only authorized data is shared. Changes apply when you confirm below.'}</p>{error&&<p role="alert" className="assistant-context-error">{error}</p>}
  </div>
  <footer className="assistant-popover-footer"><span>{streaming?'Wait for the current reply.':'Your active context stays unchanged until applied.'}</span><div><button type="button" className="assistant-secondary-button" disabled={saving} onClick={()=>{onClose();triggerRef.current?.focus();}}>Cancel</button><button type="button" className="assistant-apply-button" disabled={!!issue||!changed||saving||streaming} onClick={()=>void apply()}>{saving?'Applying…':'Apply context'}</button></div></footer>
 </section>;
}
