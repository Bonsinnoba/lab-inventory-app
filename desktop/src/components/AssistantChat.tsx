import { useState, useRef, useEffect, useMemo } from 'react';
import { Mic, Send, Bot, User, ShieldCheck, Plus, History, ExternalLink, Wrench, Settings2, Volume2, Square, StickyNote, Trash2, X, MoreVertical, ListOrdered, RotateCcw, ArrowDown, ChevronDown } from 'lucide-react';
import { apiFetch, getApiErrorMessage } from '../api/http';
import { getProjects, Project } from '../api/projects';
import { createNote } from '../api/notes';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';
import {FocusedSpeech} from '../lib/focusedSpeech';
import VoiceInputModal from './VoiceInputModal';
import AssistantProposalsModal from './AssistantProposalsModal';
import AssistantContextPopover from './AssistantContextPopover';
import {scopeLabels,contextFromPreferences,contextIssue,normalizeAssistantContext,sameAssistantContext,type AssistantContext as ContextState} from '../lib/assistantContext';
import {captureAccountSession,isAccountSessionCurrent,getStoredUser} from '../api/auth';
import {responsePrompts as collectResponsePrompts, canRestorePrompt, nearConversationEnd} from '../lib/assistantPresentation';

interface ChatMessage { role: 'user' | 'model'; content: string; }
interface SourceRef { type: string; id: string; title: string; }
interface Conversation { id: string; title: string; created_at: string; updated_at: string; }
interface Props { fullPage?: boolean; onClose?: () => void; }

const sourceLabel: Record<string,string> = { item:'Inventory', project:'Project', note:'Note', resource:'Resource', location:'Location', transaction:'Transaction', task:'Task', experiment:'Experiment', block:'Canvas' };
const customOptions = [
  ['get_project','Project summary'],['get_project_workspace','Workspace'],['list_notes','Notes'],['search_knowledge','Knowledge'],
  ['search_items','Inventory search'],['get_item','Inventory item details'],['get_transaction_summary','Financial summary'],['list_locations','Locations'],['get_location','Location details'],
  ['search_global','Global search'],['list_projects','Project list'],['get_project_financials','Project financials'],['list_recent_activity','Recent activity']
];

function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/); const out: JSX.Element[] = []; let i=0;
  while(i<lines.length){ const line=lines[i];
    if(!line.trim()){i++;continue;}
    if(/^```/.test(line)){ const code=[]; i++; while(i<lines.length&&!/^```/.test(lines[i])){code.push(lines[i]);i++;} i++; out.push(<pre key={out.length} className="assistant-code my-2 p-3 overflow-x-auto bg-bg border border-border text-xs font-mono whitespace-pre">{code.join('\n')}</pre>); continue; }
    if(/^#{1,3}\s/.test(line)){ const level=(line.match(/^#+/)||['#'])[0].length; const C=level===1?'h3':level===2?'h4':'h5'; out.push(<C key={out.length} className="font-semibold mt-3 mb-1">{line.replace(/^#{1,3}\s/,'')}</C>); i++; continue; }
    if(/^[-*]\s/.test(line)){ const items=[]; while(i<lines.length&&/^[-*]\s/.test(lines[i])){items.push(lines[i].replace(/^[-*]\s/,''));i++;} out.push(<ul key={out.length} className="list-disc pl-5 my-2 space-y-1">{items.map((x,j)=><li key={j}>{inline(x)}</li>)}</ul>); continue; }
    if(/^\d+\.\s/.test(line)){ const items=[]; while(i<lines.length&&/^\d+\.\s/.test(lines[i])){items.push(lines[i].replace(/^\d+\.\s/,''));i++;} out.push(<ol key={out.length} className="list-decimal pl-5 my-2 space-y-1">{items.map((x,j)=><li key={j}>{inline(x)}</li>)}</ol>); continue; }
    out.push(<p key={out.length} className="my-1">{inline(line)}</p>); i++;
  } return <div className="leading-relaxed">{out}</div>;
}
function inline(s:string){ const parts=s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g); return <>{parts.map((p,i)=>p.startsWith('`')?<code key={i} className="px-1 py-0.5 bg-surface-raised rounded text-xs font-mono">{p.slice(1,-1)}</code>:p.startsWith('**')?<strong key={i}>{p.slice(2,-2)}</strong>:p)}</>; }
function formatConversationTime(value:string){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';const minutes=Math.floor(Math.max(0,Date.now()-date.getTime())/60000);if(minutes<1)return 'just now';if(minutes<60)return `${minutes}m ago`;const hours=Math.floor(minutes/60);if(hours<24)return `${hours}h ago`;const days=Math.floor(hours/24);return days<7?`${days}d ago`:date.toLocaleDateString();}

export default function AssistantChat({ fullPage = false, onClose }: Props) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]); const [input,setInput]=useState(''); const [isStreaming,setIsStreaming]=useState(false);
  const [conversationId,setConversationId]=useState<string|null>(null); const [conversations,setConversations]=useState<Conversation[]>([]); const [sources,setSources]=useState<SourceRef[]>([]);
  const [toolStatus,setToolStatus]=useState<string|null>(null); const [capabilities,setCapabilities]=useState<any>(null); const [showHistory,setShowHistory]=useState(false); const [showContext,setShowContext]=useState(false); const [showAssistantMenu,setShowAssistantMenu]=useState(false); const [error,setError]=useState<string|null>(null); const [speakingIndex,setSpeakingIndex]=useState<number|null>(null);
  const [showJumpMenu,setShowJumpMenu]=useState(false);
  const followLatestRef=useRef(true);
  const [followLatest,setFollowLatest]=useState(true);
  const [showVoice,setShowVoice]=useState(false);
  const [showProposals,setShowProposals]=useState(false);
  const shellRef=useRef<HTMLDivElement>(null),composerRef=useRef<HTMLDivElement>(null),contextButtonRef=useRef<HTMLButtonElement>(null),historyRef=useRef<HTMLElement>(null),optionsButtonRef=useRef<HTMLButtonElement>(null);
  const mounted=useRef(true),contextSaveLock=useRef(false);
  const [contextReady,setContextReady]=useState(false),[contextSaving,setContextSaving]=useState(false),[contextAnnouncement,setContextAnnouncement]=useState(''),[capabilityStatus,setCapabilityStatus]=useState<'loading'|'ready'|'unavailable'>('loading');
  const assistantMenuRef=useRef<HTMLDivElement>(null);
  const jumpMenuRef=useRef<HTMLDivElement>(null);
  const jumpButtonRef=useRef<HTMLButtonElement>(null);
  const [context,setContext]=useState<ContextState>({scope:'none',projectId:null,customTools:[]}); const [isOnline,setIsOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine); const scrollRef=useRef<HTMLDivElement>(null); const composerInputRef=useRef<HTMLTextAreaElement>(null);
  const {data:projects=[]}=useQuery<Project[]>({queryKey:['assistant-projects'],queryFn:getProjects,enabled:!!context.projectId&&context.scope!=='none',staleTime:30000});

  // Audio focus state for TTS
  const speech = useRef<FocusedSpeech|null>(null);

  const loadConversations=async()=>{try{const r=await apiFetch('/assistant/conversations');if(r.ok)setConversations(await r.json());}catch{}};
  useEffect(()=>{mounted.current=true;const owner=captureAccountSession();
    void apiFetch('/assistant/capabilities').then(async r=>{if(!r.ok)throw Error('Capabilities unavailable');const data=await r.json();if(mounted.current&&isAccountSessionCurrent(owner)){setCapabilities(data);setCapabilityStatus('ready');}}).catch(()=>{if(mounted.current)setCapabilityStatus('unavailable');});
    void apiFetch('/assistant/preferences').then(async r=>{if(r.ok){const p=await r.json();if(mounted.current&&isAccountSessionCurrent(owner))setContext(contextFromPreferences(p));}}).catch(()=>null).finally(()=>{if(mounted.current)setContextReady(true);});
    void loadConversations();return()=>{mounted.current=false;};
  },[]);
  useEffect(()=>{const shell=shellRef.current,composer=composerRef.current;if(!shell||!composer)return;const measure=()=>shell.style.setProperty('--assistant-popover-height',`${Math.max(140,shell.clientHeight-composer.offsetHeight-72)}px`);measure();const observer=new ResizeObserver(measure);observer.observe(shell);observer.observe(composer);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(!showAssistantMenu)return;const onPointerDown=(event:PointerEvent)=>{if(!assistantMenuRef.current?.contains(event.target as Node))setShowAssistantMenu(false);};const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setShowAssistantMenu(false);}};document.addEventListener('pointerdown',onPointerDown);window.addEventListener('keydown',onKeyDown);return()=>{document.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('keydown',onKeyDown);};},[showAssistantMenu]);
  useEffect(()=>{if(!showJumpMenu)return;const onPointerDown=(event:PointerEvent)=>{if(!jumpMenuRef.current?.contains(event.target as Node))setShowJumpMenu(false);};const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setShowJumpMenu(false);jumpButtonRef.current?.focus();}};document.addEventListener('pointerdown',onPointerDown);window.addEventListener('keydown',onKeyDown);return()=>{document.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('keydown',onKeyDown);};},[showJumpMenu]);
  useEffect(()=>{if(!showJumpMenu)return;const frame=requestAnimationFrame(()=>jumpMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());return()=>cancelAnimationFrame(frame);},[showJumpMenu]);
  useEffect(()=>{if(!showHistory)return;const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setShowHistory(false);optionsButtonRef.current?.focus();}};const outside=(event:PointerEvent)=>{if(!historyRef.current?.contains(event.target as Node)&&!optionsButtonRef.current?.contains(event.target as Node))setShowHistory(false);};document.addEventListener('pointerdown',outside);window.addEventListener('keydown',onKeyDown);return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',onKeyDown);};},[showHistory]);
  useEffect(()=>{const on=()=>setIsOnline(true),off=()=>setIsOnline(false);window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off)}},[]);

  useEffect(()=>{
    const controller=new FocusedSpeech(speaking=>{if(!speaking)setSpeakingIndex(null);});
    speech.current=controller;
    return()=>{controller.dispose();if(speech.current===controller)speech.current=null;};
  },[]);
  useEffect(()=>{if(!followLatestRef.current)return;const frame=requestAnimationFrame(()=>{if(followLatestRef.current)scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:'auto'});});return()=>cancelAnimationFrame(frame);},[messages,toolStatus]);
  useEffect(()=>{const textarea=composerInputRef.current;if(!textarea)return;const maxHeight=162;textarea.style.height='auto';const contentHeight=textarea.scrollHeight;textarea.style.height=`${Math.max(54,Math.min(contentHeight,maxHeight))}px`;textarea.style.overflowY=contentHeight>maxHeight?'auto':'hidden';},[input]);

  const openContext=()=>{if(!contextReady||contextSaveLock.current)return;setShowContext(true);setShowHistory(false);setShowAssistantMenu(false);setShowJumpMenu(false);};
  const saveContext=async(next:ContextState)=>{if(contextSaveLock.current)throw Error('A context update is already pending.');const candidate=normalizeAssistantContext(next);if(contextIssue(candidate))throw Error(contextIssue(candidate)!);const owner=captureAccountSession();contextSaveLock.current=true;setContextSaving(true);
    try{const r=await apiFetch('/assistant/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_scope:candidate.scope,context_project_id:candidate.projectId,context_tools:candidate.customTools})});if(!r.ok)throw Error(await getApiErrorMessage(r,'Context could not be confirmed. Try again.'));const confirmed=contextFromPreferences(await r.json());if(!mounted.current||!isAccountSessionCurrent(owner))throw Error('Session changed while saving context.');if(!sameAssistantContext(candidate,confirmed))throw Error('Context confirmation changed. Reopen the selector and try again.');const restoreFocus=shellRef.current?.querySelector('.assistant-context-popover')?.contains(document.activeElement);setContext(confirmed);setError(null);setContextAnnouncement(`Active context: ${scopeLabels[confirmed.scope]}`);setShowContext(false);if(restoreFocus)requestAnimationFrame(()=>contextButtonRef.current?.focus());
    }finally{contextSaveLock.current=false;if(mounted.current)setContextSaving(false);}
  };
  const startNew=()=>{if(isStreaming)return;followLatestRef.current=true;setFollowLatest(true);setConversationId(null);setMessages([]);setSources([]);setError(null);setToolStatus(null);};
  const deleteConversation=async(id:string)=>{if(!window.confirm('Delete this conversation?'))return;try{const r=await apiFetch(`/assistant/conversations/${id}`,{method:'DELETE'});if(!r.ok)throw new Error('Unable to delete conversation');setConversations(v=>v.filter(c=>c.id!==id));if(conversationId===id)startNew();}catch(e){setError(e instanceof Error?e.message:'Unable to delete conversation');}};
  const loadConversation=async(id:string)=>{if(isStreaming)return;try{const r=await apiFetch(`/assistant/conversations/${id}`);if(!r.ok)throw new Error('Unable to load conversation');const d=await r.json();followLatestRef.current=true;setFollowLatest(true);setConversationId(d.id);setMessages(d.messages.map((m:ChatMessage)=>({role:m.role,content:m.content})));setSources([]);setError(null);setShowHistory(false);}catch(e){setError(e instanceof Error?e.message:'Unable to load conversation');}};

  const sendMessage=async()=>{const trimmed=input.trim();if(!trimmed||isStreaming||showContext||contextSaveLock.current)return;if(!isOnline){setError('The Lab Assistant needs a connection to the central backend. Local notes and lab data remain available offline.');return;}if(context.scope!=='none'&&['project','project_workspace','project_lab_data','full_project'].includes(context.scope)&&!context.projectId){openContext();return;}
    followLatestRef.current=true;setFollowLatest(true);setError(null);setSources([]);setToolStatus(null);setMessages(v=>[...v,{role:'user',content:trimmed},{role:'model',content:''}]);setInput('');setIsStreaming(true);
    try{const r=await apiFetch('/assistant/chat',{method:'POST',body:JSON.stringify({message:trimmed,conversation_id:conversationId,context_scope:context.scope,context_project_id:context.projectId,context_tools:context.customTools})});if(!r.ok||!r.body){const b=await r.json().catch(()=>({}));throw new Error(b?.error?.message||b?.error||'Assistant request failed');}
      const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const events=buffer.split('\n\n');buffer=events.pop()||'';for(const raw of events){const eventLine=raw.split('\n').find(l=>l.startsWith('event:'));const dataLine=raw.split('\n').find(l=>l.startsWith('data:'));if(!dataLine)continue;let data:any;try{data=JSON.parse(dataLine.slice(5).trim())}catch{continue}const type=eventLine?eventLine.slice(6).trim():'message';if(type==='tool_status')setToolStatus(data.tools?.length?`Checking ${data.tools.join(', ').replaceAll('_',' ')}…`:'Checking lab data…');else if(type==='sources')setSources(data.items||[]);else if(type==='error')setError(data.error||'Assistant request failed');else if(type==='done'){setConversationId(data.conversation_id||null);loadConversations();}else if(data.text)setMessages(v=>{const n=[...v],last=n.length-1;n[last]={...n[last],content:n[last].content+data.text};return n;});}}
    }catch(e){setError(e instanceof Error?e.message:'Assistant is unavailable right now');setMessages(v=>v.map((m,i)=>i===v.length-1&&m.role==='model'&&!m.content?{...m,content:'Unable to complete the request.'}:m));}finally{setIsStreaming(false);setToolStatus(null);}
  };

  const readAloud=(text:string,index:number)=>{
    if(speakingIndex===index){speech.current?.stop();return;}
    speech.current?.speak(text);setSpeakingIndex(index);
  };
  const exportToNotes=async(text:string)=>{try{await createNote({title:`Assistant response — ${new Date().toLocaleString()}`,body:text,tags:['assistant']});showToast('Response exported to Notes');}catch(e){showToast(e instanceof Error?e.message:'Failed to export response','error');}};
  const allowedCustom=useMemo(()=>Array.isArray(capabilities?.tools)?capabilities.tools:[],[capabilities]);
  const responsePrompts=useMemo(()=>collectResponsePrompts(messages),[messages]);
  const promptByResponse=useMemo(()=>new Map(responsePrompts.map(prompt=>[prompt.index,prompt.question])),[responsePrompts]);
  const restorePrompt=(prompt:string)=>{
    if(isStreaming||!canRestorePrompt(input,prompt))return;
    setInput(prompt);composerInputRef.current?.focus();
    showToast('Prompt restored. Review it and the context, then send when ready.');
  };
  const jumpToResponse=(index:number)=>{followLatestRef.current=false;setFollowLatest(false);setShowJumpMenu(false);scrollRef.current?.querySelector(`[data-response-index="${index}"]`)?.scrollIntoView({behavior:'auto',block:'start'});jumpButtonRef.current?.focus();};
  const handleJumpMenuKeyDown=(event:React.KeyboardEvent<HTMLDivElement>)=>{const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));if(!items.length)return;const current=items.indexOf(document.activeElement as HTMLButtonElement);let next:number|undefined;if(event.key==='ArrowDown')next=(current+1)%items.length;else if(event.key==='ArrowUp')next=current<=0?items.length-1:current-1;else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;if(next!==undefined){event.preventDefault();items[next].focus();}};
  const shellClass=fullPage?'flex flex-col h-full min-h-0 bg-surface border border-border rounded-md':'flex flex-col h-full';

  return <div ref={shellRef} className={`${shellClass} assistant-shell relative`}>
    <span className="sr-only" role="status" aria-live="polite">{contextAnnouncement}</span>
    <div className="assistant-header relative z-30 flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0 min-h-[56px]">
      <div className="assistant-header-avatar w-8 h-8 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0"><Bot size={17}/></div><div className="assistant-header-copy min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-sm">Lab Assistant</strong><span className="assistant-header-status text-[10px] uppercase tracking-wider text-status-ok flex items-center gap-1" aria-label="Human review required"><ShieldCheck size={12}/><span className="assistant-header-status-label">Review first</span></span></div><div className="assistant-header-meta text-xs text-text-secondary truncate mt-0.5">{capabilities?.enabled?`${capabilities.profile==='local'?'Server-local':'Cloud'} · ${capabilities.model}`:capabilityStatus==='loading'?'Checking AI availability…':capabilityStatus==='ready'?'AI setup needed in Settings':'Server connection unavailable'}</div></div>
      <div className="flex items-center gap-0.5 shrink-0">
        <div ref={assistantMenuRef} className="assistant-header-menu relative">
          <button ref={optionsButtonRef} type="button" disabled={contextSaving} onClick={()=>{setShowContext(false);setShowAssistantMenu(value=>!value);}} aria-expanded={showAssistantMenu} aria-haspopup="menu" title="Assistant options" aria-label="Assistant options" className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors text-text-secondary hover:text-text-primary hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${showAssistantMenu||showHistory?'bg-accent/10 text-accent':''}`}><MoreVertical size={18}/></button>
          {showAssistantMenu&&<div role="menu" aria-label="Assistant options" className="absolute right-0 top-full mt-2 z-50 w-52 rounded-md border border-border bg-surface p-1.5 shadow-xl">
            <button type="button" role="menuitem" onClick={()=>{setShowProposals(true);setShowAssistantMenu(false);}} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-text-secondary hover:bg-surface-raised"><Plus size={15}/><span>Planning drafts</span></button>
            <button type="button" role="menuitem" onClick={()=>{startNew();setShowContext(false);setShowHistory(false);setShowAssistantMenu(false);}} disabled={isStreaming} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-text-secondary hover:bg-surface-raised hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><Plus size={15}/><span>New conversation</span></button>
            <button type="button" role="menuitem" onClick={()=>{setShowHistory(value=>!value);setShowContext(false);setShowAssistantMenu(false);}} aria-expanded={showHistory} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-text-secondary hover:bg-surface-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><History size={15}/><span className="flex-1">Conversation history</span>{showHistory&&<span className="text-accent">Open</span>}</button>
          </div>}
        </div>
        {onClose&&<button type="button" onClick={onClose} title="Close Lab Assistant" aria-label="Close Lab Assistant" className="assistant-header-close w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><X size={17}/></button>}
      </div>
    </div>
    {showHistory&&<section ref={historyRef} role="dialog" aria-modal="false" aria-label="Conversation history" className="assistant-history-panel">
      <header className="assistant-popover-header"><span className="assistant-popover-icon"><History size={16}/></span><div><h2>Conversation history</h2><p>Pick up where you left off.</p></div><button type="button" className="assistant-icon-button" aria-label="Close conversation history" onClick={()=>{setShowHistory(false);optionsButtonRef.current?.focus();}}><X size={16}/></button></header>
      <div className="assistant-popover-body"><button type="button" disabled={isStreaming} onClick={()=>{startNew();setShowHistory(false);}} className="assistant-secondary-button mb-3"><Plus size={13}/>New conversation</button>
        {conversations.length===0?<p className="assistant-context-description">No saved conversations yet.</p>:conversations.map(c=><div key={c.id} className="assistant-history-row"><button type="button" disabled={isStreaming} onClick={()=>loadConversation(c.id)} className={`assistant-history-item ${c.id===conversationId?'is-active':''}`}><span>{c.title||'Untitled conversation'}</span><small>{formatConversationTime(c.updated_at||c.created_at)}</small></button><button type="button" disabled={isStreaming} onClick={()=>deleteConversation(c.id)} title="Delete conversation" aria-label={`Delete ${c.title||'conversation'}`} className="assistant-icon-button"><Trash2 size={13}/></button></div>)}
      </div>
    </section>}
    <div ref={scrollRef} onScroll={event=>{const node=event.currentTarget;const next=nearConversationEnd(node.scrollTop,node.scrollHeight,node.clientHeight);followLatestRef.current=next;setFollowLatest(next);}} className="flex-1 overflow-y-auto min-h-0">
      <div className="assistant-transcript p-4 space-y-5">
        {messages.length===0&&<div className="assistant-empty"><Bot size={38} className="mx-auto mb-3 text-accent"/><h2 className="text-base font-semibold mb-2">Ask the lab anything</h2><p className="text-sm text-text-secondary">{context.scope==='none'?'Ask a general question, or choose context below to work with lab data.':<>{scopeLabels[context.scope]} context is active{context.projectId?` for ${projects.find(p=>p.id===context.projectId)?.name||'your selected project'}`:''}. Only data you may access is shared.</>}</p>{capabilityStatus==='ready'&&!capabilities?.enabled&&<p className="assistant-setup-hint">{getStoredUser()?.role==='admin'?<a href="#/settings">Configure a provider in Settings → AI & Models</a>:'Ask a lab administrator to configure an AI provider.'}</p>}<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-5 text-left">{['Summarize this project','What experiments are active?','Find notes about ESP32','What should I inspect next?'].map(q=><button key={q} onClick={()=>setInput(q)} className="assistant-suggestion">{q}</button>)}</div></div>}
        {messages.map((msg,i)=><div key={i} data-response-index={msg.role==='model'?i:undefined} className={`assistant-message flex gap-2 items-start ${msg.role==='model'?'scroll-mt-3':''}`}><div className={`w-7 h-7 rounded-sm flex items-center justify-center flex-shrink-0 ${msg.role==='user'?'bg-accent/20 text-accent':'bg-surface-raised text-text-secondary'}`}>{msg.role==='user'?<User size={14}/>:<Bot size={14}/>}</div><div className="flex-1 min-w-0 text-sm text-text-primary break-words">{msg.role==='model'&&msg.content?<Markdown text={msg.content}/>:msg.content||(isStreaming&&i===messages.length-1?<span className="text-text-secondary">thinking…</span>:'')}{msg.role==='model'&&msg.content&&<div className="flex flex-wrap gap-1 mt-2"><button onClick={()=>readAloud(msg.content,i)} className="assistant-response-action">{speakingIndex===i?<Square size={11}/>:<Volume2 size={11}/>} Read aloud</button><button onClick={()=>exportToNotes(msg.content)} className="assistant-response-action"><StickyNote size={11}/> Export to Notes</button>{promptByResponse.has(i)&&<button type="button" disabled={isStreaming||!canRestorePrompt(input,promptByResponse.get(i)!)} onClick={()=>restorePrompt(promptByResponse.get(i)!)} title={isStreaming?'Wait for the current response to finish':!canRestorePrompt(input,promptByResponse.get(i)!)?'Send or clear your current draft first':'Restore this prompt to the composer for review; nothing is sent automatically'} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={11}/>Edit and retry</button>}</div>}</div></div>)}
        {toolStatus&&<div className="text-xs text-text-secondary flex items-center gap-2"><Wrench size={13}/>{toolStatus}</div>}{error&&<div className="assistant-inline-error" role="alert">{error}</div>}
        {sources.length>0&&<div className="assistant-sources"><div className="text-xs font-medium mb-2">Sources consulted</div><div className="flex flex-wrap gap-2">{sources.map(s=><span key={`${s.type}:${s.id}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-border text-[11px] text-text-secondary"><span className="text-accent">{sourceLabel[s.type]||s.type}</span><span className="truncate max-w-44">{s.title}</span><ExternalLink size={10}/></span>)}</div></div>}
      </div>
    </div>
    <div ref={composerRef} className="assistant-composer relative z-30 flex-shrink-0 p-3">
      {showContext&&<AssistantContextPopover value={context} triggerRef={contextButtonRef} tools={allowedCustom} customOptions={customOptions} streaming={isStreaming} onApply={saveContext} onClose={()=>setShowContext(false)}/>}
      {!followLatest&&messages.length>0&&<div className="mb-2 flex justify-end"><button type="button" onClick={()=>{followLatestRef.current=true;setFollowLatest(true);scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-accent"><ArrowDown size={13}/>Latest messages</button></div>}
      {!isOnline&&<div className="mb-2 text-[11px] text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-sm px-3 py-2">Assistant is offline. Reconnect to use AI chat; your local LabOS data is still available.</div>}
      <div className="assistant-compose-box">
        <textarea ref={composerInputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}}} placeholder="Ask the lab assistant…" rows={2} className="block w-full min-h-[54px] max-h-[162px] resize-none overflow-y-hidden bg-transparent px-3 pt-3 pb-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"/>
        <div className="assistant-composer-tools flex flex-wrap items-center justify-between gap-2 px-2.5 pb-2">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
            <button
              type="button"
              ref={contextButtonRef}
              onClick={()=>showContext?setShowContext(false):openContext()}
              disabled={!contextReady||contextSaving}
              aria-expanded={showContext}
              aria-haspopup="dialog"
              aria-label={`Assistant context scope: ${scopeLabels[context.scope]}`}
              title="Change assistant context scope"
              className="assistant-context-trigger"
            >
              <Settings2 size={12} className="text-accent shrink-0"/>
              <span className="truncate max-w-[120px] font-mono text-[10px] uppercase tracking-wider">{context.scope==='none'?'Context off':scopeLabels[context.scope]}</span><ChevronDown size={11} className="shrink-0"/>
            </button>
            <span
              className="inline-flex items-center gap-1 text-[10px] text-status-ok font-medium px-1.5 py-0.5 rounded bg-status-ok/10 shrink-0"
              title="Chat tools read authorized data. Planning drafts require explicit human approval; context scope never grants write authority."
            >
              <ShieldCheck size={11} className="shrink-0"/>
              <button type="button" aria-label="Planning drafts: review and approve" onClick={()=>setShowProposals(true)}>Drafts</button>
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {responsePrompts.length>0&&(
              <div ref={jumpMenuRef} className="relative">
                <button
                  ref={jumpButtonRef}
                  type="button"
                  onClick={()=>setShowJumpMenu(v=>!v)}
                  aria-expanded={showJumpMenu}
                  aria-haspopup="menu"
                  aria-label="Navigate conversation responses"
                  title="Jump to response in this conversation"
                  className={`flex h-8 items-center gap-1 px-2.5 rounded-md border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${showJumpMenu?'border-accent bg-accent/10 text-accent font-medium':'border-border bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-raised'}`}
                >
                  <ListOrdered size={14} className="shrink-0"/>
                  <span className="font-mono text-[11px]">{responsePrompts.length}</span>
                </button>
                {showJumpMenu&&(
                  <div role="menu" aria-label="Conversation jump menu" onKeyDown={handleJumpMenuKeyDown} className="assistant-jump-menu absolute bottom-full right-0 mb-2 z-50 w-64 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-2xl space-y-0.5">
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary border-b border-border mb-1">Responses ({responsePrompts.length})</div>
                    {responsePrompts.map(({index,question},qIdx)=>(
                      <button
                        key={index}
                        type="button"
                        role="menuitem"
                        onClick={()=>jumpToResponse(index)}
                        className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 transition-colors"
                      >
                        <span className="font-mono text-[10px] text-accent shrink-0 mt-0.5">#{qIdx+1}</span>
                        <span className="flex-1 truncate" title={question}>{question}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button type="button" onClick={()=>setShowVoice(true)} disabled={isStreaming||!isOnline} aria-label="Voice input" title="Record and review voice input" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised disabled:opacity-40"><Mic size={16}/></button>
            <button type="button" onClick={sendMessage} disabled={isStreaming||contextSaving||showContext||!input.trim()||!isOnline} aria-label="Send message" title="Send message" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-bg disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><Send size={15}/></button>
          </div>
        </div>
      </div>
    </div>
    {showProposals&&<AssistantProposalsModal onClose={()=>setShowProposals(false)}/>}
    {showVoice&&<VoiceInputModal onClose={()=>setShowVoice(false)} onInsert={text=>setInput(current=>current?`${current} ${text}`:text)}/>}
  </div>;
}
