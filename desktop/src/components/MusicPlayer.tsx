import { useEffect, useMemo, useRef, useState } from 'react';
import { ListMusic, Pause, Play, SkipBack, SkipForward, Trash2, Upload, Volume2, X, Minimize2, Shuffle, Repeat, Repeat1, Plus, Library, FolderPlus, ChevronUp, ChevronDown } from 'lucide-react';
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

async function allTracks(): Promise<Track[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(TRACK_STORE).objectStore(TRACK_STORE).getAll();
    r.onsuccess = () => resolve((r.result as Track[]).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)));
    r.onerror = () => reject(r.error);
  });
}
async function putTrack(t: Track) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const r = db.transaction(TRACK_STORE, 'readwrite').objectStore(TRACK_STORE).put(t);
    r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
  });
}
async function deleteTrack(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const r = db.transaction(TRACK_STORE, 'readwrite').objectStore(TRACK_STORE).delete(id);
    r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
  });
}
async function allPlaylists(): Promise<Playlist[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(PLAYLIST_STORE).objectStore(PLAYLIST_STORE).getAll();
    r.onsuccess = () => resolve(r.result as Playlist[]); r.onerror = () => reject(r.error);
  });
}
async function putPlaylist(p: Playlist) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const r = db.transaction(PLAYLIST_STORE, 'readwrite').objectStore(PLAYLIST_STORE).put(p);
    r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
  });
}
async function deletePlaylist(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const r = db.transaction(PLAYLIST_STORE, 'readwrite').objectStore(PLAYLIST_STORE).delete(id);
    r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
  });
}

interface Props { open: boolean; onClose: () => void; minimized: boolean; onMinimize: () => void; onRestore: () => void; autoPause: boolean; }

const fmt = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function MusicPlayer({ open, onClose, minimized, onMinimize, onRestore, autoPause }: Props) {
  const { showToast } = useToast();
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef<Map<string, string>>(new Map());
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
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
  const [minimizedHover, setMinimizedHover] = useState(false);
  const [minimizedPos, setMinimizedPos] = useState(() => ({
    left: Math.max(16, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 92),
    top: Math.max(16, (typeof window !== 'undefined' ? window.innerHeight : 800) - 92),
  }));
  const minimizedDrag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const minimizedMoved = useRef(false);
  const resumeAfterPause = useRef(false);
  const minimizedHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minimizedWidgetRef = useRef<HTMLDivElement | null>(null);

  const current = tracks.find(t => t.id === currentId) || null;
  const src = current ? (urls.current.get(current.id) || (urls.current.set(current.id, URL.createObjectURL(current.blob)), urls.current.get(current.id)!)) : '';
  const visibleTracks = useMemo(() => tracks.filter(t => t.name.toLowerCase().includes(search.toLowerCase())), [tracks, search]);
  const selectedPlaylist = playlists.find(p => p.id === selectedPlaylistId) || null;
  const queueTracks = queue.map(id => tracks.find(t => t.id === id)).filter(Boolean) as Track[];

  const load = async () => {
    try {
      const [ts, ps] = await Promise.all([allTracks(), allPlaylists()]);
      setTracks(ts); setPlaylists(ps);
      if (!currentId && ts[0]) setCurrentId(ts[0].id);
    } catch {
      showToast('Local media storage is unavailable', 'error');
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => () => {
    urls.current.forEach(URL.revokeObjectURL);
    if (minimizedHoverTimer.current) clearTimeout(minimizedHoverTimer.current);
  }, []);

  useEffect(() => {
    if (!minimized || !minimizedHover) return;
    const keepOpenWhileUsingWidget = (e: PointerEvent) => {
      const widget = minimizedWidgetRef.current;
      if (widget && widget.contains(e.target as Node)) {
        if (minimizedHoverTimer.current) {
          clearTimeout(minimizedHoverTimer.current);
          minimizedHoverTimer.current = null;
        }
      }
    };
    window.addEventListener('pointermove', keepOpenWhileUsingWidget);
    return () => window.removeEventListener('pointermove', keepOpenWhileUsingWidget);
  }, [minimized, minimizedHover]);

  useEffect(() => {
    const pause = () => {
      if (autoPause && audio.current && !audio.current.paused) {
        resumeAfterPause.current = true;
        audio.current.pause();
      }
    };
    const resume = () => {
      if (resumeAfterPause.current && audio.current && current) {
        resumeAfterPause.current = false;
        audio.current.play().catch(() => undefined);
      }
    };
    window.addEventListener('labos:pause-music', pause);
    window.addEventListener('labos:resume-music', resume);
    return () => {
      window.removeEventListener('labos:pause-music', pause);
      window.removeEventListener('labos:resume-music', resume);
    };
  }, [autoPause, current]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!audio.current) return;
    audio.current.volume = volume;
    if (!src) {
      audio.current.removeAttribute('src');
      audio.current.load();
      return;
    }
    const wasPlaying = !audio.current.paused;
    if (audio.current.src !== src) {
      audio.current.src = src;
      audio.current.load();
      setPosition(0);
      setDuration(0);
      if (playing || wasPlaying) {
        audio.current.play().catch(() => setPlaying(false));
      }
    }
  }, [src]);

  const playTrack = async (id: string) => {
    setCurrentId(id);
    setPlaying(true);
    requestAnimationFrame(async () => {
      try {
        if (id === currentId && audio.current) {
          await audio.current.play();
        }
      } catch {
        setPlaying(false);
        showToast('Unable to play this track', 'error');
      }
    });
  };

  const addToQueue = (id: string) => setQueue(q => q.includes(id) ? q : [...q, id]);
  const removeFromQueue = (id: string) => setQueue(q => q.filter(x => x !== id));
  const moveQueue = (id: string, delta: number) => setQueue(q => {
    const i = q.indexOf(id); const j = i + delta;
    if (i < 0 || j < 0 || j >= q.length) return q;
    const n = [...q]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  const advance = () => {
    if (!currentId) return;
    if (repeat === 'one') {
      if (audio.current) {
        audio.current.currentTime = 0;
        audio.current.play().catch(() => setPlaying(false));
      }
      return;
    }
    if (queue.length) {
      const next = queue[0];
      setQueue(q => q.slice(1));
      setCurrentId(next);
      setPlaying(true);
      return;
    }
    if (!tracks.length) { setPlaying(false); return; }
    let nextId: string | undefined;
    if (shuffle) nextId = tracks[Math.floor(Math.random() * tracks.length)]?.id;
    else {
      const i = tracks.findIndex(t => t.id === currentId);
      nextId = tracks[i + 1]?.id;
      if (!nextId && repeat === 'all') nextId = tracks[0]?.id;
    }
    if (nextId) { setCurrentId(nextId); setPlaying(true); } else setPlaying(false);
  };

  const toggle = async () => {
    if (!audio.current || !current) return;
    if (!audio.current.paused) {
      audio.current.pause();
    } else {
      try {
        await audio.current.play();
      } catch {
        showToast('Unable to play this track', 'error');
      }
    }
  };

  const addFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files || [])) {
      await putTrack({ id: crypto.randomUUID(), name: file.name, blob: file, addedAt: Date.now() + Math.random() });
    }
    await load();
    e.target.value = '';
  };

  const remove = async (id: string) => {
    if (currentId === id && audio.current) audio.current.pause();
    await deleteTrack(id);
    const url = urls.current.get(id);
    if (url) { URL.revokeObjectURL(url); urls.current.delete(id); }
    setQueue(q => q.filter(x => x !== id));
    const nextPlaylists = playlists.map(p => ({ ...p, trackIds: p.trackIds.filter(x => x !== id) }));
    await Promise.all(nextPlaylists.map(putPlaylist));
    setPlaylists(nextPlaylists);
    await load();
    if (currentId === id) {
      const next = tracks.find(t => t.id !== id)?.id || null;
      setCurrentId(next);
      setPlaying(false);
    }
  };

  const createPlaylist = async () => {
    const name = newPlaylist.trim(); if (!name) return;
    const p = { id: crypto.randomUUID(), name, trackIds: [], createdAt: Date.now() };
    await putPlaylist(p);
    setPlaylists(ps => [...ps, p]);
    setSelectedPlaylistId(p.id);
    setNewPlaylist('');
  };

  const addToPlaylist = async (trackId: string, playlistId: string) => {
    const p = playlists.find(x => x.id === playlistId);
    if (!p || p.trackIds.includes(trackId)) return;
    const next = { ...p, trackIds: [...p.trackIds, trackId] };
    await putPlaylist(next);
    setPlaylists(ps => ps.map(x => x.id === p.id ? next : x));
  };

  const deletePl = async (id: string) => {
    await deletePlaylist(id);
    setPlaylists(ps => ps.filter(p => p.id !== id));
    if (selectedPlaylistId === id) setSelectedPlaylistId(null);
  };

  const startDrag = (e: React.PointerEvent) => {
    const el = e.currentTarget.parentElement as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    el.style.transform = 'none';
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const el = e.currentTarget.parentElement as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - r.width - 8, drag.current.left + e.clientX - drag.current.x));
    const top = Math.max(8, Math.min(window.innerHeight - r.height - 8, drag.current.top + e.clientY - drag.current.y));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  };

  const endDrag = () => { drag.current = null; };

  const startMinimizedDrag = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    minimizedMoved.current = false;
    minimizedDrag.current = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const moveMinimizedDrag = (e: React.PointerEvent) => {
    if (!minimizedDrag.current) return;
    if (Math.abs(e.clientX - minimizedDrag.current.x) > 4 || Math.abs(e.clientY - minimizedDrag.current.y) > 4) minimizedMoved.current = true;
    const size = 56;
    const left = Math.max(8, Math.min(window.innerWidth - size - 8, minimizedDrag.current.left + e.clientX - minimizedDrag.current.x));
    const top = Math.max(8, Math.min(window.innerHeight - size - 8, minimizedDrag.current.top + e.clientY - minimizedDrag.current.y));
    setMinimizedPos({ left, top });
  };

  const endMinimizedDrag = () => { minimizedDrag.current = null; };

  const restoreFromMinimized = () => {
    if (!minimizedMoved.current) onRestore();
    minimizedMoved.current = false;
  };

  useEffect(() => {
    const clamp = () => setMinimizedPos(p => ({
      left: Math.max(8, Math.min(window.innerWidth - 56 - 8, p.left)),
      top: Math.max(8, Math.min(window.innerHeight - 56 - 8, p.top)),
    }));
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  if (!open) return null;

  const albumArt = (large = false) => (
    <div className={`relative ${large ? 'w-48 h-48 sm:w-52 sm:h-52' : 'w-11 h-11'} shrink-0 rounded-2xl bg-accent/10 border border-border text-accent flex items-center justify-center shadow-inner overflow-hidden`}>
      <div className={`absolute ${large ? 'w-32 h-32' : 'w-8 h-8'} rounded-full bg-accent/10 ${playing ? 'animate-pulse' : ''}`} />
      <Music2Icon />
    </div>
  );

  const libraryArt = () => (
    <div className="relative aspect-square w-full rounded-xl bg-accent/10 border border-border text-accent flex items-center justify-center overflow-hidden shadow-inner">
      <div className={`absolute w-24 h-24 rounded-full bg-accent/10 ${playing ? 'animate-pulse' : ''}`} />
      <Music2Icon />
    </div>
  );

  const audioElement = (
    <audio
      ref={audio}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onTimeUpdate={e => setPosition(e.currentTarget.currentTime)}
      onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
      onError={() => setPlaying(false)}
      onEnded={advance}
    />
  );

  return (
    <>
      {minimized && (
        <div
          className="fixed z-[90] w-[320px] h-[154px] pointer-events-none"
          style={{ left: Math.max(8, minimizedPos.left - 264), top: Math.max(8, minimizedPos.top - 96) }}
        >
          <div
            ref={minimizedWidgetRef}
            className={`absolute right-0 bottom-[66px] w-[300px] rounded-2xl border border-border bg-surface/95 backdrop-blur-xl shadow-2xl p-3 transition-all duration-200 origin-bottom-right ${minimizedHover ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto' : 'opacity-0 translate-y-2 scale-95 pointer-events-none'}`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-accent/10 text-accent flex items-center justify-center overflow-hidden">
                <Music2Icon />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{current?.name || 'Nothing playing'}</div>
                <div className="text-[10px] text-text-secondary truncate">{playing ? 'Playing locally' : 'Paused'}</div>
              </div>
              <button onClick={onRestore} className="p-2 rounded-full hover:bg-surface-raised transition-colors" title="Open player"><ListMusic size={16}/></button>
            </div>
            <div className="mt-2">
              <input
                aria-label="Track progress"
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={Math.min(position, duration || 0)}
                onChange={e => { const v = Number(e.target.value); setPosition(v); if (audio.current) audio.current.currentTime = v; }}
                className="w-full accent-current"
              />
            </div>
            <div className="mt-1 flex items-center justify-center gap-1">
              <button onClick={() => { const i = currentId ? tracks.findIndex(t => t.id === currentId) : -1; if (i > 0) playTrack(tracks[i - 1].id); }} className="p-2 hover:bg-surface-raised rounded-full transition-colors" title="Previous"><SkipBack size={16}/></button>
              <button onClick={toggle} disabled={!current} className="w-9 h-9 rounded-full bg-accent text-bg flex items-center justify-center shadow-lg hover:scale-105 transition-transform" title={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={16}/> : <Play size={16}/>}</button>
              <button onClick={advance} disabled={!current} className="p-2 hover:bg-surface-raised rounded-full transition-colors" title="Next"><SkipForward size={16}/></button>
              <button onClick={() => setShuffle(v => !v)} className={`p-2 hover:bg-surface-raised rounded-full transition-colors ${shuffle ? 'text-accent' : ''}`} title="Shuffle"><Shuffle size={15}/></button>
              <button onClick={onRestore} className="p-2 hover:bg-surface-raised rounded-full transition-colors" title="Expand"><Minimize2 size={15} className="rotate-180"/></button>
            </div>
          </div>

          <button
            onClick={restoreFromMinimized}
            onPointerDown={startMinimizedDrag}
            onPointerMove={moveMinimizedDrag}
            onPointerUp={endMinimizedDrag}
            onPointerCancel={endMinimizedDrag}
            className="absolute right-0 bottom-0 w-14 h-14 rounded-full border border-border bg-surface/95 backdrop-blur-xl text-accent shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing transition-transform duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent/50"
            title="Restore music player"
            onMouseEnter={() => {
              if (minimizedHoverTimer.current) clearTimeout(minimizedHoverTimer.current);
              setMinimizedHover(true);
            }}
            onMouseLeave={() => {
              minimizedHoverTimer.current = setTimeout(() => setMinimizedHover(false), 600);
            }}
          >
            {playing && <span className="absolute inset-[-5px] rounded-full border-2 border-accent/50 animate-ping pointer-events-none" />}
            <span className={`absolute inset-1 rounded-full border ${playing ? 'border-accent/70' : 'border-border'} transition-colors duration-300`} />
            <span className="relative z-10">{playing ? <Music2Icon /> : <Play size={18}/>}</span>
            {playing && <span className="absolute bottom-2 right-2 flex items-end gap-[2px] h-3">{[0,1,2].map(i => <span key={i} className="w-[2px] bg-accent rounded-full animate-pulse" style={{ height: `${7 + i * 2}px`, animationDelay: `${i * 120}ms` }} />)}</span>}
          </button>
        </div>
      )}

      <div className={`fixed z-[75] left-[50%] top-[50%] -translate-x-1/2 -translate-y-1/2 w-[min(1120px,calc(100vw-2rem))] h-[min(760px,calc(100vh-2rem))] bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ${minimized ? 'hidden' : 'opacity-100'}`}>
        <header onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} className="flex items-center justify-between px-5 py-3 border-b border-border cursor-move select-none bg-surface/90 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-accent/10 text-accent flex items-center justify-center"><Music2Icon /></div>
            <div><div className="text-[10px] tracking-widest text-text-secondary">LOCAL MEDIA</div><div className="font-semibold">Music Library</div><div className="text-[11px] text-text-secondary">{tracks.length} tracks · {playlists.length} playlists</div></div>
          </div>
          <div className="flex gap-1">
            <button onPointerDown={e => e.stopPropagation()} onClick={onMinimize} className="p-2 hover:bg-surface-raised rounded" title="Minimize"><Minimize2 size={16}/></button>
            <button onPointerDown={e => e.stopPropagation()} onClick={onClose} className="p-2 hover:bg-surface-raised rounded" title="Close"><X size={17}/></button>
          </div>
        </header>

        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] gap-3 p-3 border-b border-border bg-surface-raised/20">
          <div className="rounded-2xl border border-border bg-surface/80 p-4 flex flex-col md:flex-row gap-5 items-center min-h-[245px]">
            <div className="relative shrink-0">{albumArt(true)}</div>
            <div className="min-w-0 flex-1 w-full">
              <div className="text-[10px] uppercase tracking-[0.2em] text-text-secondary">Now Playing</div>
              <div className="text-2xl font-semibold truncate mt-1">{current?.name || 'Nothing playing'}</div>
              <div className="text-sm text-text-secondary mt-1">Local device · {playing ? 'Playing' : 'Paused'}</div>
              <div className="flex items-center gap-2 text-[10px] text-text-secondary mt-6"><span>{fmt(position)}</span><input className="flex-1 accent-current" type="range" min="0" max={duration||0} step="0.1" value={Math.min(position,duration||0)} onChange={e=>{const v=Number(e.target.value);setPosition(v);if(audio.current)audio.current.currentTime=v;}}/><span>{fmt(duration)}</span></div>
              <div className="flex items-center gap-2 sm:gap-4 mt-5">
                <button onClick={()=>setShuffle(v=>!v)} className={`p-2 rounded-full hover:bg-surface-raised ${shuffle?'text-accent':''}`} title="Shuffle"><Shuffle size={17}/></button>
                <button onClick={()=>{const i=currentId?tracks.findIndex(t=>t.id===currentId):-1;if(i>0)setCurrentId(tracks[i-1].id);}} className="p-2 rounded-full hover:bg-surface-raised" title="Previous"><SkipBack size={18}/></button>
                <button disabled={!current} onClick={toggle} className="w-12 h-12 rounded-full bg-accent text-bg flex items-center justify-center shadow-lg hover:scale-105 transition-transform">{playing?<Pause size={20}/>:<Play size={20}/>}</button>
                <button onClick={advance} disabled={!current} className="p-2 rounded-full hover:bg-surface-raised" title="Next"><SkipForward size={18}/></button>
                <button onClick={()=>setRepeat(r=>r==='off'?'all':r==='all'?'one':'off')} className={`p-2 rounded-full hover:bg-surface-raised ${repeat!=='off'?'text-accent':''}`} title={`Repeat: ${repeat}`}>{repeat==='one'?<Repeat1 size={17}/>:<Repeat size={17}/>}</button>
                <div className="hidden sm:flex items-center gap-2 ml-auto"><Volume2 size={15}/><input type="range" min="0" max="1" step=".01" value={volume} onChange={e=>setVolume(Number(e.target.value))} className="w-20"/></div>
              </div>
            </div>
          </div>
          <aside className="rounded-2xl border border-border bg-surface/80 p-4 min-h-[245px] overflow-hidden">
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-secondary mb-2">Now Playing</div>
            <div className="flex items-center gap-3 rounded-xl bg-surface-raised/60 border border-border p-2 mb-4">
              {albumArt(false)}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{current?.name || 'Nothing playing'}</div>
                <div className="text-[10px] text-text-secondary">{playing ? 'Playing locally' : 'Paused'}</div>
              </div>
              <button onClick={toggle} disabled={!current} className="w-8 h-8 rounded-full bg-accent text-bg flex items-center justify-center">{playing ? <Pause size={14}/> : <Play size={14}/>}</button>
            </div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Up Next</div>
              <button onClick={()=>setTab('queue')} className="text-[10px] text-accent">View queue ({queue.length})</button>
            </div>
            {queueTracks.length ? <div className="space-y-1">{queueTracks.slice(0,4).map((t,i)=><div key={`${t.id}-${i}`} className="flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-surface-raised transition-colors">{albumArt(false)}<div className="min-w-0 flex-1"><div className="text-xs truncate">{t.name}</div><div className="text-[10px] text-text-secondary">Queue #{i+1}</div></div></div>)}</div> : <div className="h-16 flex items-center justify-center text-xs text-text-secondary text-center">Queue is empty · add tracks from Library.</div>}
          </aside>
        </section>

        <div className="px-4 pt-2 flex items-center gap-1 border-b border-border">
          <button onClick={() => setTab('library')} className={`px-3 py-2 text-xs ${tab==='library'?'text-accent border-b-2 border-accent':'text-text-secondary'}`}><Library size={14} className="inline mr-1"/>Library</button>
          <button onClick={() => setTab('queue')} className={`px-3 py-2 text-xs ${tab==='queue'?'text-accent border-b-2 border-accent':'text-text-secondary'}`}><ListMusic size={14} className="inline mr-1"/>Queue ({queue.length})</button>
          <button onClick={() => setTab('playlists')} className={`px-3 py-2 text-xs ${tab==='playlists'?'text-accent border-b-2 border-accent':'text-text-secondary'}`}><FolderPlus size={14} className="inline mr-1"/>Playlists</button>
          <label className="ml-auto inline-flex items-center gap-2 px-3 py-2 text-xs bg-accent text-bg rounded-sm cursor-pointer"><Upload size={14}/>Import audio<input type="file" accept="audio/*" multiple className="hidden" onChange={addFiles}/></label>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4 pt-3">
          {tab==='library' && <><div className="flex items-center gap-3 mb-4"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search music library…" className="flex-1 px-3 py-2.5 bg-surface-raised border border-border rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/30"/><div className="text-xs text-text-secondary whitespace-nowrap">{visibleTracks.length} tracks</div></div>{visibleTracks.length===0?<div className="h-44 flex flex-col items-center justify-center text-center text-text-secondary"><Library size={30} className="mb-3 opacity-60"/><div className="text-sm">Your music library is empty</div><div className="text-xs mt-1">Import local audio to build your library.</div></div>:<><div className="text-sm font-medium mb-3">Recently added</div><div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">{visibleTracks.map(t=><div key={t.id} className={`group rounded-2xl border border-border bg-surface-raised/40 p-2.5 hover:bg-surface-raised transition-all duration-200 ${t.id===currentId?'ring-1 ring-accent/60 bg-accent/5':''}`}><button onClick={() => playTrack(t.id)} className="relative block w-full">{libraryArt()}<span className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-accent text-bg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">{t.id===currentId&&playing?<Pause size={15}/>:<Play size={15}/>}</span></button><div className="mt-2 min-w-0"><div className="text-xs font-medium truncate" title={t.name}>{t.name}</div><div className="text-[10px] text-text-secondary truncate">Local device</div></div><div className="mt-2 flex items-center justify-end gap-1"><button onClick={() => addToQueue(t.id)} title="Add to queue" className="p-1.5 hover:bg-surface rounded-lg"><Plus size={14}/></button>{selectedPlaylistId&&<button onClick={() => addToPlaylist(t.id, selectedPlaylistId)} title="Add to selected playlist" className="p-1.5 hover:bg-surface rounded-lg"><FolderPlus size={14}/></button>}<button onClick={() => remove(t.id)} title="Remove from library" className="p-1.5 hover:bg-surface rounded-lg text-text-secondary"><Trash2 size={13}/></button></div></div>)}</div></>}</>}
          {tab==='queue' && <>{queueTracks.length===0?<div className="h-44 flex flex-col items-center justify-center text-text-secondary"><ListMusic size={30} className="mb-3 opacity-60"/><div className="text-sm">Queue is empty</div><div className="text-xs mt-1">Use + in the Library to add tracks.</div></div>:<div className="space-y-1">{queueTracks.map((t,i)=><div key={`${t.id}-${i}`} className="flex items-center gap-2 px-3 py-2 rounded border border-border"><span className="w-5 text-xs text-text-secondary">{i+1}</span><button onClick={() => playTrack(t.id)} className="flex-1 text-left text-sm truncate">{t.name}</button><button onClick={() => moveQueue(t.id,-1)} title="Move up"><ChevronUp size={15}/></button><button onClick={() => moveQueue(t.id,1)} title="Move down"><ChevronDown size={15}/></button><button onClick={() => removeFromQueue(t.id)} title="Remove"><X size={14}/></button></div>)}</div>}</>}
          {tab==='playlists' && <div className="grid grid-cols-[220px_1fr] gap-4 min-h-full"><aside className="border-r border-border pr-3"><div className="flex gap-2 mb-3"><input value={newPlaylist} onChange={e=>setNewPlaylist(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createPlaylist()} placeholder="New playlist" className="min-w-0 flex-1 px-2 py-2 bg-surface-raised border border-border rounded-sm text-xs"/><button onClick={createPlaylist} className="p-2 bg-accent text-bg rounded-sm"><Plus size={15}/></button></div>{playlists.map(p=><div key={p.id} className={`flex items-center gap-1 mb-1 ${p.id===selectedPlaylistId?'bg-accent/10':''}`}><button onClick={()=>setSelectedPlaylistId(p.id)} className="flex-1 text-left px-2 py-2 text-xs truncate">{p.name}<span className="text-text-secondary ml-1">({p.trackIds.length})</span></button><button onClick={()=>deletePl(p.id)} title="Delete playlist" className="p-2 text-text-secondary"><Trash2 size={13}/></button></div>)}{!playlists.length&&<div className="text-xs text-text-secondary p-2">No playlists yet.</div>}</aside><section>{selectedPlaylist?<><div className="font-semibold text-sm mb-3">{selectedPlaylist.name}</div><div className="space-y-1">{selectedPlaylist.trackIds.map(id=>tracks.find(t=>t.id===id)).filter(Boolean).map(t=><div key={t!.id} className="flex items-center gap-2 px-3 py-2 border border-border rounded"><button onClick={()=>playTrack(t!.id)} className="flex-1 text-left text-sm truncate">{t!.name}</button><button onClick={()=>{const next={...selectedPlaylist,trackIds:selectedPlaylist.trackIds.filter(x=>x!==t!.id)};putPlaylist(next).then(()=>setPlaylists(ps=>ps.map(p=>p.id===next.id?next:p)));}} title="Remove from playlist"><X size={14}/></button></div>)}</div>{selectedPlaylist.trackIds.length===0&&<div className="text-xs text-text-secondary">Select Library and use the folder button to add tracks.</div>}</>:<div className="text-sm text-text-secondary">Select or create a playlist.</div>}</section></div>}
        </div>

        <div className="border-t border-border px-4 py-2 bg-surface/90 backdrop-blur flex items-center gap-3">
          <div className="min-w-0 flex-1 text-xs truncate"><span className="font-medium">{current?.name || 'Nothing playing'}</span><span className="text-text-secondary ml-2">{playing ? 'Playing locally' : 'Paused'}</span></div>
          <span className="text-[10px] text-text-secondary">Device local · never uploaded to LabOS</span>
          {audioElement}
        </div>
      </div>
    </>
  );
}

function Music2Icon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>; }
