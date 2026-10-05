import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Bot, User, ShieldCheck, Plus, History, ExternalLink, Wrench, Settings2, Volume2, Square, StickyNote, Trash2, X, MoreVertical } from 'lucide-react';
import { apiFetch } from '../api/http';
import { getProjects, Project } from '../api/projects';
import { createNote } from '../api/notes';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';

interface ChatMessage { role: 'user' | 'model'; content: string; }
interface SourceRef { type: string; id: string; title: string; }
interface Conversation { id: string; title: string; created_at: string; updated_at: string; }
type Scope = 'none'|'project'|'project_workspace'|'project_lab_data'|'full_project'|'custom';
interface ContextState { scope: Scope; projectId: string|null; customTools: string[]; }
interface Props { fullPage?: boolean; onClose?: () => void; }

const sourceLabel: Record<string,string> = { item:'Inventory', project:'Project', note:'Note', resource:'Resource', location:'Location', transaction:'Transaction', task:'Task', experiment:'Experiment', block:'Canvas' };
const scopeLabels: Record<Scope,string> = { none:'None', project:'Project', project_workspace:'Project + Workspace', project_lab_data:'Project + Lab Data', full_project:'Full Project', custom:'Custom' };
const customOptions = [
  ['get_project','Project summary'],['get_project_workspace','Workspace'],['list_notes','Notes'],['search_knowledge','Knowledge'],
  ['search_items','Inventory search'],['get_item','Inventory item details'],['get_transaction_summary','Financial summary'],['list_locations','Locations'],['get_location','Location details'],
  ['search_global','Global search'],['list_projects','Project list'],['get_project_financials','Project financials'],['list_recent_activity','Recent activity']
];

function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/); const out: JSX.Element[] = []; let i=0;
  while(i<lines.length){ const line=lines[i];
    if(!line.trim()){i++;continue;}
    if(/^```/.test(line)){ const code=[]; i++; while(i<lines.length&&!/^```/.test(lines[i])){code.push(lines[i]);i++;} i++; out.push(<pre key={out.length} className="my-2 p-3 overflow-x-auto bg-bg border border-border rounded-sm text-xs font-mono whitespace-pre">{code.join('\n')}</pre>); continue; }
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
  const assistantMenuRef=useRef<HTMLDivElement>(null);
  const [context,setContext]=useState<ContextState>({scope:'none',projectId:null,customTools:[]}); const [isOnline,setIsOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine); const scrollRef=useRef<HTMLDivElement>(null); const composerInputRef=useRef<HTMLTextAreaElement>(null);
  const {data:projects=[]}=useQuery<Project[]>({queryKey:['assistant-projects'],queryFn:getProjects,enabled:showContext&&context.scope!=='none',staleTime:30000});

  const loadConversations=async()=>{try{const r=await apiFetch('/assistant/conversations');if(r.ok)setConversations(await r.json());}catch{}};
  useEffect(()=>{ apiFetch('/assistant/capabilities').then(async r=>r.ok&&setCapabilities(await r.json())).catch(()=>null); apiFetch('/assistant/preferences').then(async r=>{if(r.ok){const p=await r.json();setContext({scope:p.context_scope||'none',projectId:p.context_project_id||null,customTools:Array.isArray(p.context_tools)?p.context_tools:[]});}}).catch(()=>null); loadConversations(); },[]);
  useEffect(()=>{if(!showAssistantMenu)return;const onPointerDown=(event:PointerEvent)=>{if(!assistantMenuRef.current?.contains(event.target as Node))setShowAssistantMenu(false);};const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setShowAssistantMenu(false);}};document.addEventListener('pointerdown',onPointerDown);window.addEventListener('keydown',onKeyDown);return()=>{document.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('keydown',onKeyDown);};},[showAssistantMenu]);
  useEffect(()=>{if(!showContext&&!showHistory)return;const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setShowContext(false);setShowHistory(false);}};window.addEventListener('keydown',onKeyDown);return()=>window.removeEventListener('keydown',onKeyDown);},[showContext,showHistory]);
  useEffect(()=>{const on=()=>setIsOnline(true),off=()=>setIsOnline(false);window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off)}},[]);
  useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:'smooth'});},[messages,toolStatus]);
  useEffect(()=>{const textarea=composerInputRef.current;if(!textarea)return;const maxHeight=162;textarea.style.height='auto';const contentHeight=textarea.scrollHeight;textarea.style.height=`${Math.max(54,Math.min(contentHeight,maxHeight))}px`;textarea.style.overflowY=contentHeight>maxHeight?'auto':'hidden';},[input]);

  const saveContext=async(next:ContextState)=>{setContext(next);try{const r=await apiFetch('/assistant/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({context_scope:next.scope,context_project_id:next.projectId,context_tools:next.customTools})});if(!r.ok){const b=await r.json().catch(()=>({}));throw new Error(b.error||'Failed to save context');}showToast(`Assistant context: ${scopeLabels[next.scope]}`);}catch(e){showToast(e instanceof Error?e.message:'Failed to save context','error');}};
  const startNew=()=>{if(isStreaming)return;setConversationId(null);setMessages([]);setSources([]);setError(null);setToolStatus(null);};
  const deleteConversation=async(id:string)=>{if(!window.confirm('Delete this conversation?'))return;try{const r=await apiFetch(`/assistant/conversations/${id}`,{method:'DELETE'});if(!r.ok)throw new Error('Unable to delete conversation');setConversations(v=>v.filter(c=>c.id!==id));if(conversationId===id)startNew();}catch(e){setError(e instanceof Error?e.message:'Unable to delete conversation');}};
  const loadConversation=async(id:string)=>{if(isStreaming)return;try{const r=await apiFetch(`/assistant/conversations/${id}`);if(!r.ok)throw new Error('Unable to load conversation');const d=await r.json();setConversationId(d.id);setMessages(d.messages.map((m:ChatMessage)=>({role:m.role,content:m.content})));setSources([]);setError(null);setShowHistory(false);}catch(e){setError(e instanceof Error?e.message:'Unable to load conversation');}};

  const sendMessage=async()=>{const trimmed=input.trim();if(!trimmed||isStreaming)return;if(!isOnline){setError('The Lab Assistant needs a connection to the central backend. Local notes and lab data remain available offline.');return;}if(context.scope!=='none'&&['project','project_workspace','project_lab_data','full_project'].includes(context.scope)&&!context.projectId){setError('Select a project for this context scope.');setShowContext(true);return;}
    setError(null);setSources([]);setToolStatus(null);setMessages(v=>[...v,{role:'user',content:trimmed},{role:'model',content:''}]);setInput('');setIsStreaming(true);
    try{const r=await apiFetch('/assistant/chat',{method:'POST',body:JSON.stringify({message:trimmed,conversation_id:conversationId,context_scope:context.scope,context_project_id:context.projectId,context_tools:context.customTools})});if(!r.ok||!r.body){const b=await r.json().catch(()=>({}));throw new Error(b?.error?.message||b?.error||'Assistant request failed');}
      const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const events=buffer.split('\n\n');buffer=events.pop()||'';for(const raw of events){const eventLine=raw.split('\n').find(l=>l.startsWith('event:'));const dataLine=raw.split('\n').find(l=>l.startsWith('data:'));if(!dataLine)continue;let data:any;try{data=JSON.parse(dataLine.slice(5).trim())}catch{continue}const type=eventLine?eventLine.slice(6).trim():'message';if(type==='tool_status')setToolStatus(data.tools?.length?`Checking ${data.tools.join(', ').replaceAll('_',' ')}…`:'Checking lab data…');else if(type==='sources')setSources(data.items||[]);else if(type==='error')setError(data.error||'Assistant request failed');else if(type==='done'){setConversationId(data.conversation_id||null);loadConversations();}else if(data.text)setMessages(v=>{const n=[...v],last=n.length-1;n[last]={...n[last],content:n[last].content+data.text};return n;});}}
    }catch(e){setError(e instanceof Error?e.message:'Assistant is unavailable right now');setMessages(v=>v.map((m,i)=>i===v.length-1&&m.role==='model'&&!m.content?{...m,content:'Unable to complete the request.'}:m));}finally{setIsStreaming(false);setToolStatus(null);}
  };

  const readAloud=(text:string,index:number)=>{if(speakingIndex===index){window.speechSynthesis.cancel();window.dispatchEvent(new CustomEvent('labos:resume-music'));setSpeakingIndex(null);return;}window.speechSynthesis.cancel();window.dispatchEvent(new CustomEvent('labos:pause-music',{detail:{reason:'tts'}}));const u=new SpeechSynthesisUtterance(text);u.onend=()=>{window.dispatchEvent(new CustomEvent('labos:resume-music',{detail:{reason:'tts'}}));setSpeakingIndex(null)};u.onerror=()=>{window.dispatchEvent(new CustomEvent('labos:resume-music',{detail:{reason:'tts'}}));setSpeakingIndex(null)};setSpeakingIndex(index);window.speechSynthesis.speak(u);};
  const exportToNotes=async(text:string)=>{try{await createNote({title:`Assistant response — ${new Date().toLocaleString()}`,body:text,tags:['assistant']});showToast('Response exported to Notes');}catch(e){showToast(e instanceof Error?e.message:'Failed to export response','error');}};
  const allowedCustom=useMemo(()=>capabilities?.tools||customOptions.map(x=>x[0]),[capabilities]);
  const responsePrompts=useMemo(()=>{
    let question='';
    return messages.flatMap((message,index)=>{
      if(message.role==='user'){question=message.content;return [];}
      if(!question)return [];
      const prompt={index,question};
      question='';
      return [prompt];
    });
  },[messages]);
  const toggleCustom=(name:string)=>saveContext({...context,customTools:context.customTools.includes(name)?context.customTools.filter(x=>x!==name):[...context.customTools,name]});
  const shellClass=fullPage?'flex flex-col h-full min-h-0 bg-surface border border-border rounded-md':'flex flex-col h-full';

  return <div className={`${shellClass} relative`}>
    <div className="assistant-header relative z-30 flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0 min-h-[56px]">
      <div className="assistant-header-avatar w-8 h-8 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0"><Bot size={17}/></div><div className="assistant-header-copy min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-sm">Lab Assistant</strong><span className="assistant-header-status text-[10px] uppercase tracking-wider text-status-ok flex items-center gap-1" aria-label="Read-only"><ShieldCheck size={12}/><span className="assistant-header-status-label">Read-only</span></span></div><div className="assistant-header-meta text-xs text-text-secondary truncate mt-0.5">{capabilities?.enabled?`Connected · ${capabilities.model}`:'Database-aware assistant'} · Context: {scopeLabels[context.scope]}</div></div>
      <div ref={assistantMenuRef} className="assistant-header-menu relative shrink-0">
        <button type="button" onClick={()=>setShowAssistantMenu(value=>!value)} aria-expanded={showAssistantMenu} aria-haspopup="menu" title="Assistant options" aria-label="Assistant options" className={`w-9 h-9 flex items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${showAssistantMenu||showContext||showHistory?'border-accent/40 bg-accent/10 text-accent':'border-border bg-surface-raised text-text-secondary hover:text-text-primary hover:bg-surface'}`}><MoreVertical size={18}/></button>
        {showAssistantMenu&&<div role="menu" aria-label="Assistant options" className="absolute right-0 top-full mt-2 z-50 w-52 rounded-md border border-border bg-surface p-1.5 shadow-xl">
          <button type="button" role="menuitem" onClick={()=>{setShowContext(value=>!value);setShowHistory(false);setShowAssistantMenu(false);}} aria-expanded={showContext} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-text-secondary hover:bg-surface-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><Settings2 size={15}/><span className="flex-1">Context controls</span>{showContext&&<span className="text-accent">Open</span>}</button>
          <button type="button" role="menuitem" onClick={()=>{startNew();setShowContext(false);setShowHistory(false);setShowAssistantMenu(false);}} disabled={isStreaming} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-text-secondary hover:bg-surface-raised hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><Plus size={15}/><span>New conversation</span></button>
          <button type="button" role="menuitem" onClick={()=>{setShowHistory(value=>!value);setShowContext(false);setShowAssistantMenu(false);}} aria-expanded={showHistory} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-text-secondary hover:bg-surface-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><History size={15}/><span className="flex-1">Conversation history</span>{showHistory&&<span className="text-accent">Open</span>}</button>
        </div>}
      </div>
      {onClose&&<button type="button" onClick={onClose} title="Close Lab Assistant" aria-label="Close Lab Assistant" className="assistant-header-close w-9 h-9 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><X size={17}/></button>}
    </div>
    {(showContext||showHistory)&&<div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/45 p-3" onMouseDown={event=>{if(event.target===event.currentTarget){setShowContext(false);setShowHistory(false);}}}>
      <section role="dialog" aria-modal="true" aria-label={showContext?'Assistant context':'Conversation history'} className="flex w-full max-w-sm max-h-[min(78%,520px)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0"><h2 className="text-sm font-semibold">{showContext?'Assistant context':'Conversation history'}</h2><p className="mt-0.5 text-[11px] text-text-secondary">{showContext?'Only authorized read-only data is exposed.':'Choose a saved conversation to continue.'}</p></div>
          <button type="button" onClick={()=>{setShowContext(false);setShowHistory(false);}} aria-label="Close dialog" title="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><X size={16}/></button>
        </header>
        {showContext?<div className="space-y-3 overflow-y-auto p-4">
          <label className="ui-label">Context scope
            <select value={context.scope} onChange={e=>saveContext({...context,scope:e.target.value as Scope,projectId:e.target.value==='none'?null:context.projectId})} className="ui-select">{(Object.keys(scopeLabels) as Scope[]).map(s=><option key={s} value={s}>{scopeLabels[s]}</option>)}</select>
          </label>
          {context.scope!=='none'&&context.scope!=='custom'&&<label className="ui-label">Project
            <select value={context.projectId||''} onChange={e=>saveContext({...context,projectId:e.target.value||null})} className="ui-select"><option value="">Select project…</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>}
          {context.scope==='custom'&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-1">{customOptions.filter(([n])=>allowedCustom.includes(n)).map(([name,label])=><label key={name} className="flex items-center gap-2 text-[11px] p-1.5 rounded hover:bg-surface-raised"><input type="checkbox" checked={context.customTools.includes(name)} onChange={()=>toggleCustom(name)}/>{label}</label>)}</div>}
        </div>:<div className="min-h-0 space-y-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium">Conversations</span><button type="button" disabled={isStreaming} onClick={()=>{startNew();setShowHistory(false);}} className="text-xs text-accent disabled:opacity-40">New</button></div>
          {conversations.length===0?<div className="py-3 text-xs text-text-secondary">No saved conversations.</div>:conversations.map(c=><div key={c.id} className="flex gap-1">
            <button type="button" onClick={()=>loadConversation(c.id)} className={`flex-1 min-w-0 text-left px-2 py-2 rounded-sm text-xs hover:bg-surface-raised ${c.id===conversationId?'bg-accent/10 text-accent':'text-text-secondary'}`}><span className="block truncate">{c.title||'Untitled conversation'}</span><span className="mt-1 block text-[10px] text-text-tertiary" title={new Date(c.updated_at||c.created_at).toLocaleString()}>{formatConversationTime(c.updated_at||c.created_at)}</span></button>
            <button type="button" onClick={()=>deleteConversation(c.id)} title="Delete conversation" aria-label={`Delete ${c.title||'conversation'}`} className="p-2 text-text-secondary hover:text-status-danger"><Trash2 size={13}/></button>
          </div>)}
        </div>}
      </section>
    </div>}
    <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
      <div className="assistant-transcript flex items-start gap-1 p-4">
        {responsePrompts.length>0&&<nav aria-label="Assistant responses" className="assistant-response-nav sticky top-3 z-20 shrink-0">
          <ol className="space-y-1.5 py-1">
            {responsePrompts.map(({index,question})=><li key={index} className="assistant-response-marker-wrap group relative flex h-5 items-center">
              <button type="button" onClick={()=>scrollRef.current?.querySelector(`[data-response-index="${index}"]`)?.scrollIntoView({behavior:'smooth',block:'start'})} aria-label={`Go to response: ${question}`} className="assistant-response-marker" />
              <span role="tooltip" className="assistant-response-preview">{question}</span>
            </li>)}
          </ol>
        </nav>}
        <div className="min-w-0 flex-1 space-y-4">
          {messages.length===0&&<div className="max-w-xl mx-auto text-center mt-8 px-4"><Bot size={38} className="mx-auto mb-3 text-accent"/><h2 className="text-base font-semibold mb-2">Ask the lab anything</h2><p className="text-sm text-text-secondary">Context is currently <b>{scopeLabels[context.scope]}</b>. Turn it on only when you want the assistant to consult LabOS data.</p><div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-5 text-left">{['Summarize this project','What experiments are active?','Find notes about ESP32','What should I inspect next?'].map(q=><button key={q} onClick={()=>setInput(q)} className="p-3 border border-border rounded-sm text-xs text-text-secondary hover:text-text-primary hover:border-accent bg-surface-raised">{q}</button>)}</div></div>}
          {messages.map((msg,i)=><div key={i} data-response-index={msg.role==='model'?i:undefined} className={`flex gap-2 items-start ${msg.role==='model'?'scroll-mt-3':''}`}><div className={`w-7 h-7 rounded-sm flex items-center justify-center flex-shrink-0 ${msg.role==='user'?'bg-accent/20 text-accent':'bg-surface-raised text-text-secondary'}`}>{msg.role==='user'?<User size={14}/>:<Bot size={14}/>}</div><div className="flex-1 min-w-0 text-sm text-text-primary break-words">{msg.role==='model'&&msg.content?<Markdown text={msg.content}/>:msg.content||(isStreaming&&i===messages.length-1?<span className="text-text-secondary">thinking…</span>:'')}{msg.role==='model'&&msg.content&&<div className="flex gap-1 mt-2"><button onClick={()=>readAloud(msg.content,i)} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] border border-border rounded-sm text-text-secondary hover:text-text-primary">{speakingIndex===i?<Square size={11}/>:<Volume2 size={11}/>} Read aloud</button><button onClick={()=>exportToNotes(msg.content)} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] border border-border rounded-sm text-text-secondary hover:text-text-primary"><StickyNote size={11}/> Export to Notes</button></div>}</div></div>)}
          {toolStatus&&<div className="text-xs text-text-secondary flex items-center gap-2"><Wrench size={13}/>{toolStatus}</div>}{error&&<div className="text-sm text-status-danger bg-status-danger/10 border border-status-danger/30 rounded-sm px-3 py-2">{error}</div>}
          {sources.length>0&&<div className="border border-border rounded-sm p-3 bg-surface-raised/40"><div className="text-xs font-medium mb-2">Sources consulted</div><div className="flex flex-wrap gap-2">{sources.map(s=><span key={`${s.type}:${s.id}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-border text-[11px] text-text-secondary"><span className="text-accent">{sourceLabel[s.type]||s.type}</span><span className="truncate max-w-44">{s.title}</span><ExternalLink size={10}/></span>)}</div></div>}
        </div>
      </div>
    </div>
    <div className="assistant-composer relative z-30 flex-shrink-0 p-3">{!isOnline&&<div className="mb-2 text-[11px] text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-sm px-3 py-2">Assistant is offline. Reconnect to use AI chat; your local LabOS data is still available.</div>}<div className="rounded-xl border border-border bg-surface-raised transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"><textarea ref={composerInputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}}} placeholder="Ask the lab assistant…" rows={2} className="block w-full min-h-[54px] max-h-[162px] resize-none overflow-y-hidden bg-transparent px-3 pt-3 pb-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"/><div className="flex items-center justify-between gap-2 px-2 pb-2"><div className="flex min-w-0 items-center gap-1 text-[10px] text-text-secondary" title="Read-only · scoped context · no automatic data changes"><ShieldCheck size={12} className="shrink-0"/><span className="truncate">Read-only · scoped context</span></div><button type="button" onClick={sendMessage} disabled={isStreaming||!input.trim()||!isOnline} aria-label="Send message" title="Send message" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-bg disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><Send size={15}/></button></div></div></div>
  </div>;
}
