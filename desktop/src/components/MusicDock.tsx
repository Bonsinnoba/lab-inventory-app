import { useEffect, useMemo, useRef, useState } from 'react';
import { ListMusic, Pause, Play, SkipBack, SkipForward, Trash2, Upload, Volume2, X, Minimize2, Maximize2, Shuffle, Repeat, Repeat1, Plus, Library, FolderPlus, ChevronUp, ChevronDown, Music2 } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

type Track = { id: string; name: string; blob: Blob; addedAt?: number };
type Playlist = { id: string; name: string; trackIds: string[]; createdAt: number };
type RepeatMode = 'off' | 'all' | 'one';

const DB = 'labos-local-media';
const VERSION = 2;
const TRACK_STORE = 'tracks';
const PLAYLIST_STORE = 'playlists';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(TRACK_STORE)) db.createObjectStore(TRACK_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PLAYLIST_STORE)) db.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const readStore = async <T,>(store: string): Promise<T[]> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result as T[]);
    r.onerror = () => reject(r.error);
  });
};
const writeStore = async (store: string, value: unknown) => {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).put(value);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
};
const removeStore = async (store: string, id: string) => {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
};
const fmt = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00';
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
};

interface Props { onClose: () => void; autoPause: boolean; }

export default function MusicDock({ onClose, autoPause }: Props) {
  const { showToast } = useToast();
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef<Map<string, string>>(new Map());
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [tab, setTab] = useState<'library' | 'queue' | 'playlists'>('library');
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(.65);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [search, setSearch] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [newPlaylist, setNewPlaylist] = useState('');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const resumeAfterPause = useRef(false);

  const current = tracks.find(t => t.id === currentId) || null;
  const visibleTracks = useMemo(() => tracks.filter(t => t.name.toLowerCase().includes(search.toLowerCase())), [tracks, search]);
  const queueTracks = queue.map(id => tracks.find(t => t.id === id)).filter(Boolean) as Track[];
  const selectedPlaylist = playlists.find(p => p.id === selectedPlaylistId) || null;
  const src = current ? (urls.current.get(current.id) || (urls.current.set(current.id, URL.createObjectURL(current.blob)), urls.current.get(current.id)!)) : '';

  const load = async () => {
    try {
      setError(false);
      const [ts, ps] = await Promise.all([readStore<Track>(TRACK_STORE), readStore<Playlist>(PLAYLIST_STORE)]);
      ts.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
      setTracks(ts); setPlaylists(ps);
      setCurrentId(id => id || ts[0]?.id || null);
    } catch {
      setError(true);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); return () => urls.current.forEach(URL.revokeObjectURL); }, []);

  useEffect(() => {
    const pause = () => {
      if (autoPause && audio.current && !audio.current.paused) { resumeAfterPause.current = true; audio.current.pause(); }
    };
    const resume = () => {
      if (resumeAfterPause.current && audio.current && current) { resumeAfterPause.current = false; audio.current.play().catch(() => undefined); }
    };
    window.addEventListener('labos:pause-music', pause);
    window.addEventListener('labos:resume-music', resume);
    return () => { window.removeEventListener('labos:pause-music', pause); window.removeEventListener('labos:resume-music', resume); };
  }, [autoPause, current]);

  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);
  useEffect(() => {
    if (!audio.current) return;
    audio.current.volume = volume;
    if (!src) { audio.current.removeAttribute('src'); audio.current.load(); return; }
    audio.current.src = src; audio.current.load(); setPosition(0); setDuration(0);
    if (playing) audio.current.play().catch(() => setPlaying(false));
  }, [src]);

  const playTrack = async (id: string) => {
    setCurrentId(id); setPlaying(true);
    setTimeout(() => audio.current?.play().catch(() => setPlaying(false)), 0);
  };
  const toggle = async () => {
    if (!audio.current || !current) return;
    if (audio.current.paused) { try { await audio.current.play(); } catch { showToast('Unable to play this track', 'error'); } }
    else audio.current.pause();
  };
  const advance = () => {
    if (!currentId) return;
    if (repeat === 'one') { if (audio.current) { audio.current.currentTime = 0; audio.current.play().catch(() => setPlaying(false)); } return; }
    if (queue.length) { const next = queue[0]; setQueue(q => q.slice(1)); setCurrentId(next); setPlaying(true); return; }
    if (!tracks.length) return setPlaying(false);
    const index = tracks.findIndex(t => t.id === currentId);
    const nextId = shuffle ? tracks[Math.floor(Math.random() * tracks.length)]?.id : tracks[index + 1]?.id || (repeat === 'all' ? tracks[0]?.id : undefined);
    if (nextId) { setCurrentId(nextId); setPlaying(true); } else setPlaying(false);
  };
  const previous = () => { const i = currentId ? tracks.findIndex(t => t.id === currentId) : -1; if (i > 0) playTrack(tracks[i - 1].id); };
  const addToQueue = (id: string) => setQueue(q => q.includes(id) ? q : [...q, id]);
  const moveQueue = (id: string, delta: number) => setQueue(q => { const i = q.indexOf(id), j = i + delta; if (i < 0 || j < 0 || j >= q.length) return q; const n = [...q]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const addFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try { for (const file of Array.from(e.target.files || [])) await writeStore(TRACK_STORE, { id: crypto.randomUUID(), name: file.name, blob: file, addedAt: Date.now() + Math.random() }); await load(); }
    catch { showToast('Unable to import audio', 'error'); }
    e.target.value = '';
  };
  const remove = async (id: string) => {
    try {
      if (id === currentId) audio.current?.pause();
      await removeStore(TRACK_STORE, id);
      const url = urls.current.get(id); if (url) { URL.revokeObjectURL(url); urls.current.delete(id); }
      setQueue(q => q.filter(x => x !== id));
      const next = playlists.map(p => ({ ...p, trackIds: p.trackIds.filter(x => x !== id) }));
      await Promise.all(next.map(p => writeStore(PLAYLIST_STORE, p))); setPlaylists(next);
      if (id === currentId) setCurrentId(null);
      await load();
    } catch { showToast('Unable to remove this track', 'error'); }
  };
  const createPlaylist = async () => {
    const name = newPlaylist.trim(); if (!name) return;
    const p = { id: crypto.randomUUID(), name, trackIds: [], createdAt: Date.now() };
    await writeStore(PLAYLIST_STORE, p); setPlaylists(ps => [...ps, p]); setSelectedPlaylistId(p.id); setNewPlaylist('');
  };
  const addToPlaylist = async (trackId: string, playlistId: string) => {
    const p = playlists.find(x => x.id === playlistId); if (!p || p.trackIds.includes(trackId)) return;
    const next = { ...p, trackIds: [...p.trackIds, trackId] }; await writeStore(PLAYLIST_STORE, next); setPlaylists(ps => ps.map(x => x.id === p.id ? next : x));
  };
  const deletePlaylist = async (id: string) => { await removeStore(PLAYLIST_STORE, id); setPlaylists(ps => ps.filter(p => p.id !== id)); if (selectedPlaylistId === id) setSelectedPlaylistId(null); };
  const removeFromPlaylist = async (trackId: string) => {
    if (!selectedPlaylist) return;
    const next = { ...selectedPlaylist, trackIds: selectedPlaylist.trackIds.filter(x => x !== trackId) }; await writeStore(PLAYLIST_STORE, next); setPlaylists(ps => ps.map(p => p.id === next.id ? next : p));
  };

  const art = (small = false) => <div className={`${small ? 'w-10 h-10' : 'w-full aspect-square'} shrink-0 rounded-xl border border-border bg-accent/10 text-accent flex items-center justify-center overflow-hidden`}><Music2 size={small ? 17 : 28} /></div>;
  const audioElement = <audio ref={audio} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={e => setPosition(e.currentTarget.currentTime)} onLoadedMetadata={e => setDuration(e.currentTarget.duration)} onEnded={advance} onError={() => setPlaying(false)} />;

  if (minimized) return <section className="h-full min-h-0 flex flex-col justify-end bg-surface" aria-label="Minimized music player">
    <div className="p-3 border-t border-border bg-surface-raised/40">
      <div className="flex items-center gap-2.5">
        {art(true)}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.16em] text-text-secondary">Music</div>
          <div className="text-xs font-semibold truncate">{current?.name || 'Nothing playing'}</div>
          <div className="text-[10px] text-text-secondary">{playing ? 'Playing locally' : 'Paused'}</div>
        </div>
        <button type="button" onClick={toggle} disabled={!current} className="w-9 h-9 rounded-full bg-accent text-bg flex items-center justify-center disabled:opacity-40" title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={15}/> : <Play size={15}/>}</button>
        <button type="button" onClick={() => setMinimized(false)} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface" title="Expand music player" aria-label="Expand music player"><Maximize2 size={15}/></button>
        <button type="button" onClick={onClose} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface" title="Close music player" aria-label="Close music player"><X size={15}/></button>
      </div>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-text-secondary"><span>{fmt(position)}</span><input aria-label="Track progress" className="flex-1 accent-current" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration || 0)} onChange={e => { const v = Number(e.target.value); setPosition(v); if (audio.current) audio.current.currentTime = v; }}/><span>{fmt(duration)}</span></div>
    </div>
    {audioElement}
  </section>;

  return <section className="h-full min-h-0 flex flex-col bg-surface" aria-label="Music player">
    <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
      <div className="flex items-center gap-3 min-w-0"><div className="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center"><Music2 size={18}/></div><div className="min-w-0"><div className="text-[10px] uppercase tracking-[0.18em] text-text-secondary">Media</div><div className="font-semibold truncate">Music Player</div><div className="text-[10px] text-text-secondary">{tracks.length} tracks · {playlists.length} playlists</div></div></div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setMinimized(true)} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/50" title="Minimize music player" aria-label="Minimize music player"><Minimize2 size={16}/></button>
        <button type="button" onClick={onClose} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/50" title="Close music player" aria-label="Close music player"><X size={17}/></button>
      </div>
    </header>

    <div className="shrink-0 p-3 border-b border-border bg-surface-raised/20">
      <div className="rounded-xl border border-border bg-surface-raised/40 p-3">
        <div className="flex gap-3">{art(true)}<div className="min-w-0 flex-1"><div className="text-[10px] uppercase tracking-[0.16em] text-text-secondary">Now playing</div><div className="text-sm font-semibold truncate mt-0.5">{current?.name || 'Nothing playing'}</div><div className="text-[10px] text-text-secondary mt-0.5">{playing ? 'Playing locally' : 'Paused'}</div></div></div>
        <div className="flex items-center gap-2 mt-3 text-[10px] text-text-secondary"><span>{fmt(position)}</span><input aria-label="Track progress" className="flex-1 accent-current" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration || 0)} onChange={e => { const v = Number(e.target.value); setPosition(v); if (audio.current) audio.current.currentTime = v; }}/><span>{fmt(duration)}</span></div>
        <div className="flex items-center justify-between mt-2"><button type="button" onClick={() => setShuffle(v => !v)} className={`p-2 rounded-lg hover:bg-surface ${shuffle ? 'text-accent' : 'text-text-secondary'}`} title="Shuffle" aria-pressed={shuffle}><Shuffle size={15}/></button><button type="button" onClick={previous} disabled={!current} className="p-2 rounded-lg hover:bg-surface disabled:opacity-40" title="Previous"><SkipBack size={17}/></button><button type="button" onClick={toggle} disabled={!current} className="w-10 h-10 rounded-full bg-accent text-bg flex items-center justify-center shadow-lg hover:scale-105 transition-transform disabled:opacity-40" title={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button><button type="button" onClick={advance} disabled={!current} className="p-2 rounded-lg hover:bg-surface disabled:opacity-40" title="Next"><SkipForward size={17}/></button><button type="button" onClick={() => setRepeat(r => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')} className={`p-2 rounded-lg hover:bg-surface ${repeat !== 'off' ? 'text-accent' : 'text-text-secondary'}`} title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`}>{repeat === 'one' ? <Repeat1 size={15}/> : <Repeat size={15}/>}</button></div>
        <div className="flex items-center gap-2 mt-2 text-text-secondary"><Volume2 size={14}/><input aria-label="Volume" className="flex-1 accent-current" type="range" min="0" max="1" step=".01" value={volume} onChange={e => setVolume(Number(e.target.value))}/></div>
      </div>
    </div>

    <div className="shrink-0 px-3 pt-2 flex items-center border-b border-border">
      {([['library','Library',Library],['queue',`Queue (${queue.length})`,ListMusic],['playlists','Playlists',FolderPlus] ] as const).map(([id,label,Icon]) => <button key={id} type="button" onClick={() => setTab(id)} className={`px-2.5 py-2 text-[11px] flex items-center gap-1 border-b-2 ${tab === id ? 'text-accent border-accent' : 'text-text-secondary border-transparent hover:text-text-primary'}`}><Icon size={13}/>{label}</button>)}
      <label className="ml-auto mb-1 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-accent text-bg text-[10px] font-medium cursor-pointer hover:opacity-90"><Upload size={13}/>Import<input type="file" accept="audio/*" multiple className="hidden" onChange={addFiles}/></label>
    </div>

    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3">
      {loading ? <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-14 rounded-lg border border-border bg-surface-raised/40 animate-pulse" />)}</div> : error ? <div className="h-full flex flex-col items-center justify-center text-center px-4"><div className="text-sm font-medium">Music library unavailable</div><div className="text-xs text-text-secondary mt-1">Local media storage could not be opened.</div><button type="button" onClick={load} className="mt-3 px-3 py-2 rounded-lg bg-accent text-bg text-xs">Try again</button></div> : tab === 'library' ? <>
        <div className="flex items-center gap-2 mb-3"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your library…" className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-surface-raised border border-border text-xs outline-none focus:ring-2 focus:ring-accent/30"/><span className="text-[10px] text-text-secondary whitespace-nowrap">{visibleTracks.length}</span></div>
        {visibleTracks.length ? <div className="space-y-2">{visibleTracks.map(t => <div key={t.id} className={`group flex items-center gap-2 p-2 rounded-xl border border-border hover:bg-surface-raised ${t.id === currentId ? 'bg-accent/5 ring-1 ring-accent/40' : ''}`}><button type="button" onClick={() => playTrack(t.id)} className="w-10 h-10 shrink-0 relative rounded-lg overflow-hidden">{art(true)}<span className="absolute inset-0 flex items-center justify-center bg-surface/70 opacity-0 group-hover:opacity-100">{t.id === currentId && playing ? <Pause size={15}/> : <Play size={15}/>}</span></button><button type="button" onClick={() => playTrack(t.id)} className="min-w-0 flex-1 text-left"><div className="text-xs font-medium truncate">{t.name}</div><div className="text-[10px] text-text-secondary">Local device</div></button><button type="button" onClick={() => addToQueue(t.id)} className="p-1.5 rounded-md hover:bg-surface" title="Add to queue"><Plus size={14}/></button>{selectedPlaylistId && <button type="button" onClick={() => addToPlaylist(t.id, selectedPlaylistId)} className="p-1.5 rounded-md hover:bg-surface" title="Add to selected playlist"><FolderPlus size={14}/></button>}<button type="button" onClick={() => remove(t.id)} className="p-1.5 rounded-md hover:bg-surface text-text-secondary" title="Remove from library"><Trash2 size={13}/></button></div>)}</div> : <div className="h-48 flex flex-col items-center justify-center text-center text-text-secondary"><Library size={28} className="mb-2 opacity-60"/><div className="text-xs font-medium">Your music library is empty</div><div className="text-[10px] mt-1">Import local audio to build it.</div></div>}
      </> : tab === 'queue' ? <>{queueTracks.length ? <div className="space-y-2">{queueTracks.map((t,i) => <div key={`${t.id}-${i}`} className="flex items-center gap-2 p-2 rounded-lg border border-border"><span className="w-5 text-[10px] text-text-secondary">{i+1}</span><button type="button" onClick={() => playTrack(t.id)} className="min-w-0 flex-1 text-left text-xs truncate">{t.name}</button><button type="button" onClick={() => moveQueue(t.id,-1)} className="p-1 hover:bg-surface" title="Move up"><ChevronUp size={14}/></button><button type="button" onClick={() => moveQueue(t.id,1)} className="p-1 hover:bg-surface" title="Move down"><ChevronDown size={14}/></button><button type="button" onClick={() => setQueue(q => q.filter((_,idx) => idx !== i))} className="p-1 hover:bg-surface" title="Remove"><X size={13}/></button></div>)}</div> : <div className="h-48 flex flex-col items-center justify-center text-center text-text-secondary"><ListMusic size={28} className="mb-2 opacity-60"/><div className="text-xs">Queue is empty</div><div className="text-[10px] mt-1">Add tracks from Library.</div></div>}</> : <div>
        <div className="flex gap-2 mb-3"><input value={newPlaylist} onChange={e => setNewPlaylist(e.target.value)} onKeyDown={e => e.key === 'Enter' && createPlaylist()} placeholder="New playlist" className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-surface-raised border border-border text-xs outline-none focus:ring-2 focus:ring-accent/30"/><button type="button" onClick={createPlaylist} className="p-2 rounded-lg bg-accent text-bg" title="Create playlist"><Plus size={15}/></button></div>
        {playlists.length ? <div className="space-y-2">{playlists.map(p => <div key={p.id} className={`flex items-center gap-2 rounded-lg border border-border p-2 ${p.id === selectedPlaylistId ? 'bg-accent/10 ring-1 ring-accent/30' : ''}`}><button type="button" onClick={() => setSelectedPlaylistId(p.id)} className="min-w-0 flex-1 text-left"><div className="text-xs truncate">{p.name}</div><div className="text-[10px] text-text-secondary">{p.trackIds.length} tracks</div></button><button type="button" onClick={() => deletePlaylist(p.id)} className="p-1.5 text-text-secondary hover:text-text-primary" title="Delete playlist"><Trash2 size={13}/></button></div>)}</div> : <div className="text-xs text-text-secondary py-4">No playlists yet.</div>}
        {selectedPlaylist && <div className="mt-4 pt-3 border-t border-border"><div className="text-xs font-semibold mb-2">{selectedPlaylist.name}</div>{selectedPlaylist.trackIds.length ? <div className="space-y-1.5">{selectedPlaylist.trackIds.map(id => tracks.find(t => t.id === id)).filter(Boolean).map(t => <div key={t!.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-raised/50"><button type="button" onClick={() => playTrack(t!.id)} className="min-w-0 flex-1 text-left text-xs truncate">{t!.name}</button><button type="button" onClick={() => removeFromPlaylist(t!.id)} className="p-1" title="Remove from playlist"><X size={13}/></button></div>)}</div> : <div className="text-[10px] text-text-secondary">Add tracks from Library using the playlist button.</div>}</div>}
      </div>}
    </div>
    <div className="shrink-0 border-t border-border px-3 py-2 text-[10px] text-text-secondary flex items-center gap-2"><span className="truncate flex-1">{current?.name || 'Nothing playing'}</span><span>Local only</span>{audioElement}</div>
  </section>;
}
