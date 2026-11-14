import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/api/shell';
import type { Resource } from '../api/resources';
import { captureAccountSession, isAccountSessionCurrent } from '../api/auth';
import { originalResourceSource, resourceCopyMessage } from '../lib/originalResourceSource';
import { isTauriRuntime } from '../lib/runtime';
import FocusedResourceMedia from './FocusedResourceMedia';
import focus from '../lib/audioFocus';

let focusSequence = 0;

// Choice stays local to this pane. A newly completed copy must not interrupt an
// explicitly selected online player; resource/session changes discard the choice.
export default function OriginalResourcePreview({ resource, localUrl, poster, aspect }: {
  resource: Resource; localUrl: string; poster?: string; aspect: string;
}) {
  const [session] = useState(captureAccountSession);
  const [focusId] = useState(() => `original-resource-${++focusSequence}`);
  const [active, setActive] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const source = originalResourceSource(resource.url);
  const current = !locked && isAccountSessionCurrent(session);
  useEffect(() => {
    if (!active || !online || !current) return;
    // Reserve video focus for the online viewing session. Preemption stops the
    // iframe entirely; do not let an uncontrollable embed compete with TTS/mic.
    const token = focus.acquire({ type: 'video', id: focusId, replaceEqual: true, onPreempt: () => setActive(false) });
    if (!focus.isOwner(token.id, token.generation)) setActive(false);
    return () => focus.release(token);
  }, [active, online, current, focusId]);
  useEffect(() => {
    const network = () => { setOnline(navigator.onLine); if (!navigator.onLine) setActive(false); };
    const check = () => { if (!isAccountSessionCurrent(session)) { setLocked(true); setActive(false); } };
    const expired = () => { setLocked(true); setActive(false); };
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    window.addEventListener('labos-user-updated', check);
    window.addEventListener('storage', check);
    window.addEventListener('labos:auth-expired', expired);
    return () => {
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
      window.removeEventListener('labos-user-updated', check);
      window.removeEventListener('storage', check);
      window.removeEventListener('labos:auth-expired', expired);
    };
  }, [session]);
  const openOriginal = async () => {
    if (!source || !online || !current || !isAccountSessionCurrent(session)) return;
    setActive(false);
    setError('');
    try {
      if (isTauriRuntime()) await open(source.url);
      else window.open(source.url, '_blank', 'noopener,noreferrer');
    } catch { if (isAccountSessionCurrent(session)) setError('Could not open the original site. Try again.'); }
  };
  if (!current) return <div role="status" className="p-6 text-sm text-slate-400">Sign in again to view this resource.</div>;
  if (localUrl && !active) return <div className="flex h-full items-center justify-center p-4"><FocusedResourceMedia kind="video" src={localUrl} poster={poster} aspect={aspect}/></div>;
  return <div className="flex h-full min-h-0 flex-col bg-slate-950 text-sm text-slate-300">
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 p-3">
      <span role="status" className="flex-1">{localUrl ? 'A verified local copy is now ready.' : resourceCopyMessage(resource)}</span>
      {active && <button className="rounded border border-slate-700 px-3 py-2" onClick={() => setActive(false)}>{localUrl ? 'Use local copy' : 'Stop online playback'}</button>}
      {source && <button disabled={!online} className="rounded border border-slate-700 px-3 py-2 disabled:opacity-40" onClick={() => void openOriginal()}>Open original site</button>}
    </div>
    {active && online && source?.embed ? <>
      <p className="px-3 py-2 text-xs text-slate-400">Online source: YouTube. If the player is blocked or requires sign-in, use Open original site.</p>
      <iframe title={resource.name || 'Original source video'} src={source.embed} referrerPolicy="strict-origin-when-cross-origin" className="min-h-[200px] w-full flex-1 border-0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen/>
    </> : <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p>{!online ? 'You are offline. Online playback needs an internet connection.' : source?.embed ? 'Watch from the original source while the local copy is unavailable.' : source ? 'This source does not support playback inside this viewer. Open the original site to watch.' : 'No supported HTTPS original link is available.'}</p>
      {source?.embed && <button disabled={!online} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40" onClick={() => { if (isAccountSessionCurrent(session) && navigator.onLine) setActive(true); }}>Play original online</button>}
      <p className="max-w-md text-xs text-slate-500">Online playback connects directly to the original provider. It does not stream through the LabOS server or make the file available offline.</p>
    </div>}
    {error && <p role="alert" className="p-3 text-red-300">{error}</p>}
  </div>;
}
