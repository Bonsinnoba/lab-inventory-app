import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, ShieldCheck, Plus, History, ExternalLink, Wrench } from 'lucide-react';
import { apiFetch } from '../api/http';

interface ChatMessage { role: 'user' | 'model'; content: string; }
interface SourceRef { type: string; id: string; title: string; }
interface Conversation { id: string; title: string; created_at: string; updated_at: string; }
interface Props { fullPage?: boolean; }

const sourceLabel: Record<string,string> = { item:'Inventory', project:'Project', note:'Note', resource:'Resource', location:'Location', transaction:'Transaction' };

export default function AssistantChat({ fullPage = false }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<{enabled:boolean; model:string; can_modify_data:boolean} | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const loadConversations = async () => {
    try {
      const response = await apiFetch('/assistant/conversations');
      if (response.ok) setConversations(await response.json());
    } catch { /* non-critical */ }
  };

  useEffect(() => {
    apiFetch('/assistant/capabilities').then(async r => r.ok ? setCapabilities(await r.json()) : null).catch(() => null);
    loadConversations();
  }, []);

  const startNew = () => { if (isStreaming) return; setConversationId(null); setMessages([]); setSources([]); setError(null); setToolStatus(null); };

  const loadConversation = async (id: string) => {
    if (isStreaming) return;
    try {
      const response = await apiFetch(`/assistant/conversations/${id}`);
      if (!response.ok) throw new Error('Unable to load conversation');
      const data = await response.json();
      setConversationId(data.id);
      setMessages(data.messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })));
      setSources([]);
      setError(null);
      setShowHistory(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load conversation'); }
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setError(null); setSources([]); setToolStatus(null);
    setMessages(prev => [...prev, { role:'user', content:trimmed }, { role:'model', content:'' }]);
    setInput(''); setIsStreaming(true);
    try {
      const response = await apiFetch('/assistant/chat', { method:'POST', body:JSON.stringify({ message:trimmed, conversation_id:conversationId }) });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || 'Assistant request failed');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer='';
      while(true){
        const {done,value}=await reader.read(); if(done) break;
        buffer += decoder.decode(value,{stream:true});
        const events=buffer.split('\n\n'); buffer=events.pop()||'';
        for(const raw of events){
          const eventLine=raw.split('\n').find(l=>l.startsWith('event:'));
          const dataLine=raw.split('\n').find(l=>l.startsWith('data:'));
          if(!dataLine) continue;
          let data:any; try { data=JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
          const type=eventLine ? eventLine.slice(6).trim() : 'message';
          if(type==='tool_status') setToolStatus(data.tools?.length ? `Checking ${data.tools.join(', ').replaceAll('_',' ')}…` : 'Checking lab data…');
          else if(type==='sources') setSources(data.items || []);
          else if(type==='error') { setError(data.error || 'Assistant request failed'); setToolStatus(null); }
          else if(type==='done') { setConversationId(data.conversation_id || null); setToolStatus(null); loadConversations(); }
          else if(data.text) setMessages(prev => { const next=[...prev]; const last=next.length-1; next[last]={...next[last],content:next[last].content+data.text}; return next; });
        }
      }
    } catch(err){
      setError(err instanceof Error ? err.message : 'Assistant is unavailable right now');
      setMessages(prev => prev.map((m,i)=>i===prev.length-1 && m.role==='model' && !m.content ? {...m,content:'Unable to complete the request.'}:m));
    } finally { setIsStreaming(false); setToolStatus(null); }
  };

  const shellClass = fullPage ? 'flex flex-col h-full min-h-0 bg-surface border border-border rounded-md' : 'flex flex-col h-full';
  return (
    <div className={shellClass}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <div className="w-9 h-9 rounded-md bg-accent/10 text-accent flex items-center justify-center"><Bot size={19}/></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><strong className="text-sm">Lab Assistant</strong><span className="text-[10px] uppercase tracking-wider text-status-ok flex items-center gap-1"><ShieldCheck size={12}/> Read-only</span></div>
          <div className="text-xs text-text-secondary truncate">{capabilities?.enabled ? `Connected · ${capabilities.model}` : 'Database-aware assistant'}</div>
        </div>
        <button onClick={startNew} disabled={isStreaming} title="New conversation" className="p-2 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised disabled:opacity-40"><Plus size={17}/></button>
        {fullPage && <button onClick={()=>setShowHistory(v=>!v)} className="p-2 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised"><History size={17}/></button>}
      </div>

      {fullPage && showHistory && <div className="border-b border-border p-3 max-h-56 overflow-y-auto bg-surface-raised/30">
        <div className="flex items-center justify-between mb-2"><span className="text-xs font-medium">Conversations</span><button onClick={startNew} className="text-xs text-accent">New</button></div>
        <div className="space-y-1">{conversations.length===0 ? <div className="text-xs text-text-secondary py-2">No saved conversations.</div> : conversations.map(c=><button key={c.id} onClick={()=>loadConversation(c.id)} className={`w-full text-left px-2 py-2 rounded-sm text-xs hover:bg-surface-raised ${c.id===conversationId?'bg-accent/10 text-accent':'text-text-secondary'}`}>{c.title || 'Untitled conversation'}</button>)}</div>
      </div>}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length===0 && <div className="max-w-xl mx-auto text-center mt-10 px-4">
          <Bot size={38} className="mx-auto mb-3 text-accent"/>
          <h2 className="text-base font-semibold mb-2">Ask the lab anything</h2>
          <p className="text-sm text-text-secondary">I can search real inventory, projects, notes, resources, locations and financial summaries. I cannot change lab data.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-5 text-left">
            {['What equipment needs repair?','Show me the active projects','Find notes about ESP32','How much did we spend this month?'].map(q=><button key={q} onClick={()=>setInput(q)} className="p-3 border border-border rounded-sm text-xs text-text-secondary hover:text-text-primary hover:border-accent bg-surface-raised">{q}</button>)}
          </div>
        </div>}
        {messages.map((msg,i)=><div key={i} className="flex gap-2 items-start">
          <div className={`w-7 h-7 rounded-sm flex items-center justify-center flex-shrink-0 ${msg.role==='user'?'bg-accent/20 text-accent':'bg-surface-raised text-text-secondary'}`}>{msg.role==='user'?<User size={14}/>:<Bot size={14}/>}</div>
          <div className="flex-1 min-w-0 text-sm text-text-primary whitespace-pre-wrap break-words leading-relaxed">{msg.content || (isStreaming && i===messages.length-1 ? <span className="text-text-secondary">thinking…</span> : '')}</div>
        </div>)}
        {toolStatus && <div className="text-xs text-text-secondary flex items-center gap-2"><Wrench size={13}/>{toolStatus}</div>}
        {error && <div className="text-sm text-status-danger bg-status-danger/10 border border-status-danger/30 rounded-sm px-3 py-2">{error}</div>}
        {sources.length>0 && <div className="border border-border rounded-sm p-3 bg-surface-raised/40"><div className="text-xs font-medium mb-2">Sources consulted</div><div className="flex flex-wrap gap-2">{sources.map(s=><span key={`${s.type}:${s.id}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-border text-[11px] text-text-secondary"><span className="text-accent">{sourceLabel[s.type]||s.type}</span><span className="truncate max-w-44">{s.title}</span><ExternalLink size={10}/></span>)}</div></div>}
      </div>

      <div className="border-t border-border p-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}} placeholder="Ask the lab assistant…" rows={1} className="flex-1 resize-none bg-surface-raised border border-border rounded-sm px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent max-h-32"/>
          <button onClick={sendMessage} disabled={isStreaming||!input.trim()} className="p-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"><Send size={16}/></button>
        </div>
        <div className="text-[10px] text-text-secondary mt-2 flex items-center gap-1"><ShieldCheck size={11}/> v2.0 assistant is read-only; actions are never executed automatically.</div>
      </div>
    </div>
  );
}
