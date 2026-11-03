import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Mic,Square,X} from 'lucide-react';
import {VoiceCapture,type VoiceState} from '../lib/voiceCapture';
import {getVoiceCapabilities,transcribeVoice,type VoiceCapabilities} from '../api/assistant-voice';
import {captureAccountSession,isAccountSessionCurrent} from '../api/auth';
import FocusedResourceMedia from './FocusedResourceMedia';

export default function VoiceInputModal({onClose,onInsert}:{onClose:()=>void;onInsert:(text:string)=>boolean|void}){
 const [capabilities,setCapabilities]=useState<VoiceCapabilities|null>(null),[error,setError]=useState<string|null>(null),[consent,setConsent]=useState(false),[state,setState]=useState<VoiceState>({phase:'idle'}),[text,setText]=useState(''),[preview,setPreview]=useState('');
 const close=useRef(onClose);close.current=onClose;
 const controller=useRef<VoiceCapture|null>(null),dialog=useRef<HTMLDivElement>(null),session=useRef(captureAccountSession());
 useEffect(()=>{let active=true;getVoiceCapabilities().then(value=>{if(active)setCapabilities(value);}).catch(error=>{if(active)setError(error.message);});return()=>{active=false;};},[]);
 useEffect(()=>{if(!capabilities)return;const value=new VoiceCapture(setState,capabilities.max_bytes);controller.current=value;return()=>{value.dispose();if(controller.current===value)controller.current=null;};},[capabilities]);
 useEffect(()=>{if(state.phase==='review')setText(state.text||'');},[state]);
 useEffect(()=>{if(!state.blob){setPreview('');return;}const url=URL.createObjectURL(state.blob);setPreview(url);return()=>URL.revokeObjectURL(url);},[state.blob]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();close.current();}
   if(event.key==='Tab'){
    const elements=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')||[]);const first=elements[0],last=elements[elements.length-1];
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
   }
  };
  document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};
 },[]);
 const busy=['requesting','recording','stopping','transcribing'].includes(state.phase);
 return createPortal(<div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 p-4"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="voice-input-title" className="w-full max-w-xl max-h-[90vh] overflow-auto rounded-xl border border-border bg-surface p-5 shadow-2xl outline-none">
  <div className="mb-4 flex items-center justify-between"><h2 id="voice-input-title" className="flex items-center gap-2 font-semibold"><Mic size={18}/>Voice input</h2><button type="button" aria-label="Cancel voice input" onClick={onClose} className="rounded p-2 hover:bg-surface-raised"><X size={18}/></button></div>
  {error&&<p role="alert" className="text-sm text-status-danger">{error}</p>}
  {!capabilities&&!error&&<p role="status" className="text-sm text-text-secondary">Checking server transcription…</p>}
  {capabilities&&<>
   <p className="text-sm leading-relaxed text-text-secondary">{capabilities.disclosure}</p>
   {!capabilities.enabled?<p className="mt-4 text-sm">Server transcription is not enabled with a configured model and processing/retention disclosure. Continue using text input.</p>:<>
    <label className="my-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/><span>I consent to this processing for this recording. Audio is uploaded only when I choose Transcribe recording.</span></label>
    <div role="status" aria-live="polite" className="my-3 text-sm text-text-secondary">{state.phase==='requesting'?'Waiting for microphone access…':state.phase==='recording'?'Recording. Automatically stops after 60 seconds.':state.phase==='stopping'?'Finishing recording…':state.phase==='transcribing'?'Transcribing. You will review the text before using it.':state.phase==='recorded'?(state.upload_attempted?'An upload was attempted; the provider may have received it. Retry only if you want to upload it again.':'Recording is on this device in memory; it has not been uploaded.'):state.phase==='review'?'Review and edit the transcript. Nothing has been sent to chat.':''}</div>
    {state.error&&<p role="alert" className="my-3 text-sm text-status-danger">{state.error}</p>}
    {preview&&<FocusedResourceMedia kind="audio" src={preview}/>}
    {state.phase==='review'&&<label className="mt-4 block text-sm">Transcript<textarea value={text} maxLength={8000} onChange={event=>setText(event.target.value)} rows={5} className="mt-2 block w-full rounded border border-border bg-bg p-3 text-text-primary"/></label>}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
     <button type="button" onClick={onClose} className="rounded border border-border px-3 py-2 text-sm">Cancel</button>
     {state.phase==='recording'?<button type="button" onClick={()=>controller.current?.stop()} className="flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm text-bg"><Square size={14}/>Stop recording</button>:<button type="button" disabled={!consent||busy} onClick={()=>void controller.current?.record()} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-40">{state.blob?'Record again':'Start recording'}</button>}
     {state.phase==='recorded'&&<button type="button" disabled={!consent} onClick={()=>void controller.current?.transcribe((blob,signal)=>transcribeVoice(blob,capabilities.disclosure_id,signal))} className="rounded bg-accent px-3 py-2 text-sm text-bg disabled:opacity-40">Transcribe recording</button>}
     {state.phase==='review'&&<button type="button" disabled={!text.trim()} onClick={()=>{if(isAccountSessionCurrent(session.current)){if(onInsert(text.trim())!==false)onClose();else setError('The target changed while recording. Your transcript is retained here; close and reopen voice input for the current target.');}else{controller.current?.cancel();setError('Your session changed. Close voice input and sign in again.');}}} className="rounded bg-accent px-3 py-2 text-sm text-bg disabled:opacity-40">Insert into prompt</button>}
    </div>
   </>}
  </>}
 </div></div>,document.body);
}
