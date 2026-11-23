import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Music2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import { parseBlob } from 'music-metadata';
import { useToast } from '../contexts/ToastContext';
import { useMusicDefaults } from '../hooks/useMusicDefaults';
import { useMusicTransport } from '../hooks/useMusicTransport';
import MusicLibraryBrowser from './MusicLibraryBrowser';
import { addMusicIds, deleteMusicTrack, musicLibrary, musicRead, musicWrite, updateMusicTags, updateMusicArtwork, nextQueueTrack, shuffleMusicIds, normalizeMusicQueue, uniqueMusicIds } from '../lib/musicLibrary';
import type { MusicQueue, MusicState, MusicTrack, MusicPlaylist, StoredMusicTrack } from '../lib/musicLibrary';
interface Props {
    onClose: () => void;
    onMinimize?: () => void;
    onRestore?: () => void;
    minimized?: boolean;
    autoPause: boolean;
}
const emptyState: MusicState = { id: 'player', activeId: null, queues: [] };
const fmt = (seconds: number) => !Number.isFinite(seconds) ? '0:00' : `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export default function MusicDock({ onClose, onMinimize, onRestore, minimized = false, autoPause }: Props) {
    const { showToast } = useToast();
    const audio = useRef<HTMLAudioElement | null>(null);
    const libraryToggle=useRef<HTMLButtonElement>(null);
    function returnToPlayer(){setLibraryOpen(false);window.requestAnimationFrame(()=>libraryToggle.current?.focus());}
    const [tracks, setTracks] = useState<MusicTrack[]>([]), [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
    const [state, setState] = useState<MusicState>(emptyState), [ready, setReady] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false), [playing, setPlaying] = useState(false), [position, setPosition] = useState(0), [duration, setDuration] = useState(0), [volume, setVolume] = useState(.65);
    const [selectionVersion, setSelectionVersion] = useState(0);
    const [loaded, setLoaded] = useState<{
        id: string | null;
        url: string;
    }>({ id: null, url: '' });
    const [artwork, setArtwork] = useState('');
    const wanted = useRef(false), mounted = useRef(true), readyRef = useRef(false), stateRef = useRef(state), positionRef = useRef(0);
    const seek = useRef<{
        id: string;
        position: number;
    } | null>(null), urlRef = useRef(''), artTask = useRef(Promise.resolve()), savedValue = useRef('');
    const active = state.queues.find(q => q.id === state.activeId), currentId = active?.currentId || null;
    const current = tracks.find(t => t.id === currentId) || null, shuffle = active?.shuffle || false, repeat = active?.repeat || 'off';
    stateRef.current = state;
    const playback = useMusicTransport(audio, { source: loaded.url, id: loaded.id, volume, autoPause, ownerId: 'music-dock', playing: setPlaying, reset: () => { setPosition(0); setDuration(0); }, error: message => showToast(message, 'error') });
    useMusicDefaults(setVolume);
    function snapshot() { const s = stateRef.current; return { ...s, queues: s.queues.map(q => q.id === s.activeId ? { ...q, position: positionRef.current } : q) }; }
    const save = (value: MusicState) => { const serialized = JSON.stringify(value); if (serialized === savedValue.current)
        return; savedValue.current = serialized; void musicWrite('state', value).catch(() => { savedValue.current = ''; if (mounted.current)
        showToast('Unable to save music queues on this device', 'error'); }); };
    function change(value: MusicState, autoplay = false) {
        const old = stateRef.current;
        const oldActive = old.queues.find(q => q.id === old.activeId);
        const next: MusicState = { ...value, queues: value.queues.map(q => normalizeMusicQueue(q, tracks)) };
        if (next.activeId !== old.activeId) {
            if (!autoplay)
                wanted.current = false;
            next.queues = next.queues.map(q => q.id === old.activeId ? { ...q, position: positionRef.current } : q);
            playback.transport.current?.pause();
        }
        const q = next.queues.find(q => q.id === next.activeId);
        if (q?.id !== oldActive?.id || q?.currentId !== oldActive?.currentId)
            positionRef.current = q?.position || 0;
        stateRef.current = next;
        setState(next);
        if (readyRef.current)
            save(next);
    }
    async function load() { try {
        setError(false);
        const data = await musicLibrary();
        if (!mounted.current)
            return;
        setTracks(data.tracks);
        setPlaylists(data.playlists.map(p => ({ ...p, trackIds: uniqueMusicIds(p.trackIds, data.tracks) })));
        const s = readyRef.current ? stateRef.current : (await musicRead<MusicState>('state', 'player') || emptyState);
        if (!mounted.current)
            return;
        const next = { ...s, queues: s.queues.map(q => normalizeMusicQueue(q, data.tracks)) };
        stateRef.current = next;
        setState(next);
        if (!readyRef.current) {
            positionRef.current = next.queues.find(q => q.id === next.activeId)?.position || 0;
            readyRef.current = true;
            setReady(true);
        }
        save(next);
    }
    catch {
        if (mounted.current)
            setError(true);
    }
    finally {
        if (mounted.current)
            setLoading(false);
    } }
    useEffect(() => {
        mounted.current = true;
        let live = true;
        void (async () => {
            try {
                const data = await musicLibrary(), saved = await musicRead<MusicState>('state', 'player');
                if (!live)
                    return;
                const queues = (saved?.queues || []).map(q => normalizeMusicQueue(q, data.tracks));
                const restored: MusicState = { id: 'player', queues, activeId: queues.some(q => q.id === saved?.activeId) ? saved!.activeId : queues[0]?.id || null };
                setTracks(data.tracks);
                setPlaylists(data.playlists.map(p => ({ ...p, trackIds: uniqueMusicIds(p.trackIds, data.tracks) })));
                stateRef.current = restored;
                setState(restored);
                positionRef.current = restored.queues.find(q => q.id === restored.activeId)?.position || 0;
                readyRef.current = true;
                setReady(true);
                setLoading(false);
            }
            catch {
                if (live) {
                    setError(true);
                    setLoading(false);
                }
            }
        })();
        const timer = window.setInterval(() => { if (readyRef.current)
            save(snapshot()); }, 5000);
        return () => { live = false; mounted.current = false; clearInterval(timer); if (readyRef.current)
            save(snapshot()); if (urlRef.current)
            URL.revokeObjectURL(urlRef.current); };
    }, []);
    useEffect(() => { if (!libraryOpen)
        return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape')
        setLibraryOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [libraryOpen]);
    useEffect(() => {
        let live = true;
        if (!ready)
            return;
        playback.transport.current?.pause();
        const target = stateRef.current.queues.find(q => q.id === stateRef.current.activeId);
        const id = target?.currentId;
        if (!id) {
            setLoaded({ id: null, url: '' });
            if(urlRef.current){URL.revokeObjectURL(urlRef.current);urlRef.current='';}
            seek.current=null;
            setPosition(0);
            positionRef.current = 0;
            return;
        }
        void (async () => {
            try {
                const track = await musicRead<StoredMusicTrack>('tracks', id);
                if (!live)
                    return;
                if (!track?.blob?.size)
                    throw new Error('This song is missing or empty. Remove it from the library and import the file again.');
                const url = URL.createObjectURL(track.blob);
                const previous = urlRef.current;
                urlRef.current = url;
                seek.current = { id, position: target.position || 0 };
                setLoaded({ id, url });
                playback.transport.current?.select(id, url, wanted.current, false, false);
                wanted.current = false;
                if (previous)
                    URL.revokeObjectURL(previous);
            }
            catch (cause) {
                if (live) {
                    wanted.current = false;
                    setLoaded({ id: null, url: '' });
                    if(urlRef.current){URL.revokeObjectURL(urlRef.current);urlRef.current='';}
                    seek.current=null;
                    showToast(cause instanceof Error ? cause.message : 'Unable to load this song', 'error');
                }
            }
        })();
        return () => { live = false; };
    }, [ready, state.activeId, currentId, selectionVersion]);
    useEffect(() => {
        let live = true, url = '';
        setArtwork('');
        if (loaded.id)
            artTask.current = artTask.current.catch(() => { }).then(async () => {
                if (!live)
                    return;
                try {
                    const track = await musicRead<StoredMusicTrack>('tracks', loaded.id!);
                    if (!track)
                        return;
                    let art = track.artwork;
                    if (!track.artworkChecked || !track.metadataChecked) {
                        const metadata = await parseBlob(track.blob);
                        if(live && !track.metadataChecked){
                            const tags={title:metadata.common.title,artist:metadata.common.artist,album:metadata.common.album};
                            if(await updateMusicTags(track.id,tags)){
                                if(live)setTracks(value=>value.map(item=>item.id===track.id?{...item,...Object.fromEntries(Object.entries(tags).filter(([,value])=>!!value)),metadataChecked:true}:item));
                            }
                        }
                        const picture = metadata.common.picture?.[0];
                        if (picture && picture.data.byteLength<=4*1024*1024 && /^image\/(jpeg|png|webp|gif)$/i.test(picture.format))
                            art = new Blob([Uint8Array.from(picture.data).buffer], { type: picture.format });
                        if(live&&!track.artworkChecked)await updateMusicArtwork(track.id,art);
                    }
                    if (live && art) {
                        url = URL.createObjectURL(art);
                        setArtwork(url);
                    }
                }
                catch { /* Artwork is optional; audio remains usable. */ }
            });
        return () => { live = false; if (url)
            URL.revokeObjectURL(url); };
    }, [loaded.id]);
    function playTrack(id: string, queueId?: string) {
        id = uniqueMusicIds([id], tracks)[0];
        if (!id)
            return;
        let s = stateRef.current;
        let q = s.queues.find(q => q.id === (queueId || s.activeId));
        if (!q) {
            q = { id: crypto.randomUUID(), name: 'My queue', trackIds: [], currentId: null, position: 0, shuffle: false, repeat: 'off' };
            s = { ...s, queues: [...s.queues, q] };
        }
        const same = s.activeId === q.id && q.currentId === id;
        wanted.current = true;
        q = { ...q, trackIds: uniqueMusicIds([...q.trackIds, id], tracks), currentId: id, position: same ? positionRef.current : 0 };
        change({ ...s, activeId: q.id, queues: s.queues.map(item => item.id === q!.id ? q! : item) }, true);
        if (same && loaded.id !== id) setSelectionVersion(value=>value+1);
        if (same && loaded.id === id) {
            wanted.current = false;
            playback.transport.current?.play();
        }
    }
    function enqueue(ids: string[], where: 'next' | 'end') {
        let s = stateRef.current, q = s.queues.find(q => q.id === s.activeId);
        if (!q) {
            q = { id: crypto.randomUUID(), name: 'My queue', trackIds: [], currentId: null, position: 0, shuffle: false, repeat: 'off' };
            s = { ...s, activeId: q.id, queues: [...s.queues, q] };
        }
        const updated = addMusicIds(q, ids, where, tracks);
        change({ ...s, queues: s.queues.map(item => item.id === q!.id ? updated : item) });
    }
    function source(name: string, key: string, ids: string[], mode: 'resume' | 'replace' | 'merge', shuffled = false) {
        let s = stateRef.current, q = s.queues.find(q => q.sourceKey === key);
        const unique = shuffled ? shuffleMusicIds(uniqueMusicIds(ids, tracks)) : uniqueMusicIds(ids, tracks);
        if (!unique.length)
            return;
        if (!q) {
            q = { id: crypto.randomUUID(), name, sourceKey: key, trackIds: [], currentId: null, position: 0, shuffle: false, repeat: 'off' };
            s = { ...s, queues: [...s.queues, q] };
        }
        if (mode === 'replace')
            q = { ...q, trackIds: unique, currentId: unique[0], position: 0, shuffle: shuffled };
        if (mode === 'merge')
            q = addMusicIds(q, unique, 'end', tracks);
        if (!q.currentId)
            q = { ...q, currentId: q.trackIds[0] || null, position: 0 };
        const same = s.activeId === q.id && currentId === q.currentId;
        wanted.current = true;
        change({ ...s, activeId: q.id, queues: s.queues.map(item => item.id === q!.id ? q! : item) }, true);
        if (same && loaded.id !== q.currentId) setSelectionVersion(value=>value+1);
        if (same && loaded.id === q.currentId) {
            wanted.current = false;
            if (mode === 'replace' && audio.current) {
                audio.current.currentTime = 0;
                positionRef.current = 0;
                setPosition(0);
            }
            playback.transport.current?.play();
        }
    }
    function advance(ended = false) {
        const q = stateRef.current.queues.find(q => q.id === stateRef.current.activeId);
        if (!q)
            return;
        const id = nextQueueTrack(q, ended);
        if (id) {
            if (id === q.currentId && audio.current) {
                audio.current.currentTime = 0;
                positionRef.current = 0;
                setPosition(0);
                playback.transport.current?.play();
            }
            else
                playTrack(id, q.id);
        }
        else {
            playback.transport.current?.pause();
            wanted.current = false;
        }
    }
    function previous() {
        const q = stateRef.current.queues.find(q => q.id === stateRef.current.activeId);
        if (!q?.trackIds.length)
            return;
        if (audio.current && audio.current.currentTime > 3) {
            audio.current.currentTime = 0;
            positionRef.current = 0;
            setPosition(0);
            return;
        }
        const id = playback.transport.current?.previous(q.trackIds);
        if (id)
            playTrack(id, q.id);
    }
    function toggle() { if (!active?.currentId) {
        if (active?.trackIds[0])
            playTrack(active.trackIds[0], active.id);
        return;
    } if (loaded.id === currentId)
        playback.transport.current?.toggle();
    else
        playTrack(active.currentId, active.id); }
    function setShuffle(update:(value:boolean)=>boolean){
        if(!active)return;const shuffle=update(active.shuffle);
        change({...stateRef.current,queues:stateRef.current.queues.map(q=>{
            if(q.id!==active.id)return q;
            const split=q.currentId?Math.max(0,q.trackIds.indexOf(q.currentId)+1):0;
            return {...q,shuffle,trackIds:shuffle?[...q.trackIds.slice(0,split),...shuffleMusicIds(q.trackIds.slice(split))]:q.trackIds};
        })});
    }
    function setRepeat(update: (value: MusicQueue['repeat']) => MusicQueue['repeat']) { if (active)
        change({ ...stateRef.current, queues: stateRef.current.queues.map(q => q.id === active.id ? { ...q, repeat: update(q.repeat) } : q) }); }
    async function remove(id: string) { await deleteMusicTrack(id); change({ ...stateRef.current, queues: stateRef.current.queues.map(q => ({ ...q, trackIds: q.trackIds.filter(x => x !== id), currentId: q.currentId === id ? null : q.currentId, position: q.currentId === id ? 0 : q.position })) }); await load(); }
    const art = (small = false, _track?: MusicTrack) => <div className={`${small ? 'music-artwork-mini w-10 h-10 rounded-lg' : 'music-artwork w-[min(70%,190px)] aspect-square rounded-2xl'} shrink-0 border border-border text-accent flex items-center justify-center overflow-hidden shadow-lg`}>{artwork ? <img src={artwork} alt="" className="h-full w-full object-cover"/> : <Music2 size={small ? 17 : 34} strokeWidth={1.4}/>}</div>;
    const volumeControl = <div className="shrink-0 px-4 py-3 flex items-center gap-2 text-[10px] text-text-secondary"><Volume2 size={15}/><input aria-label="Volume" className="flex-1 accent-current" type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))}/><span className="w-8 text-right tabular-nums">{Math.round(volume * 100)}%</span></div>;
    const audioElement = <audio data-labos-music="true" ref={playback.bind} onTimeUpdate={e => { const value = e.currentTarget.currentTime; positionRef.current = value; setPosition(value); }} onPause={() => { if (readyRef.current)
        save(snapshot()); }} onLoadedMetadata={e => { setDuration(e.currentTarget.duration); const pending = seek.current; if (pending && pending.id === playback.transport.current?.currentId) {
        const value = Math.max(0, Math.min(pending.position, Number.isFinite(e.currentTarget.duration) ? Math.max(0, e.currentTarget.duration - .05) : pending.position));
        e.currentTarget.currentTime = value;
        positionRef.current = value;
        setPosition(value);
        seek.current = null;
    } }} onEnded={e => { if (e.currentTarget.ended)
        advance(true); }}/>;
    const actions = useRef({ load, change, playTrack, source, enqueue, remove });
    actions.current = { load, change, playTrack, source, enqueue, remove };
    const browserActions = useMemo(() => ({ reload: () => actions.current.load(), change: (s: MusicState) => actions.current.change(s), play: (id: string, q?: string) => actions.current.playTrack(id, q), source: (name: string, key: string, ids: string[], mode: 'resume' | 'replace' | 'merge', shuffled?: boolean) => actions.current.source(name, key, ids, mode, shuffled), enqueue: (ids: string[], where: 'next' | 'end') => actions.current.enqueue(ids, where), remove: (id: string) => actions.current.remove(id), onNowPlaying:()=>{setLibraryOpen(false);window.requestAnimationFrame(()=>libraryToggle.current?.focus());} }), []);
    if (minimized)
        return <div className="fixed right-[68px] bottom-5 z-[80] group" aria-label="Minimized music player"><div className="absolute right-0 bottom-full mb-2 pointer-events-none opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150"><div className="rounded-lg border border-border bg-surface-raised px-3 py-2 shadow-xl whitespace-nowrap"><div className="text-[10px] uppercase tracking-[0.16em] text-text-secondary">Music</div><div className="text-xs font-semibold max-w-48 truncate">{current?.title || current?.name || 'Nothing playing'}</div></div></div><button type="button" onClick={onRestore} className="relative w-12 h-12 rounded-full border border-border bg-surface-raised text-text-primary shadow-xl flex items-center justify-center hover:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/60" title="Restore music player" aria-label="Restore music player"><Music2 size={19}/>{playing && <span className="absolute -right-0.5 -top-0.5 w-3 h-3 rounded-full bg-accent border-2 border-surface-raised" aria-hidden="true"/>}</button>{audioElement}</div>;
    return <section className={`music-player-shell relative min-h-0 flex flex-col bg-surface ${libraryOpen ? 'is-library-open' : ''}`} aria-label="Music player">
    <header className="music-player-header shrink-0 grid grid-cols-3 items-center px-4 py-1.5"><button type="button" onClick={onMinimize} className="justify-self-start p-2 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/50" title="Minimize music player" aria-label="Minimize music player"><ChevronDown size={19}/></button><div className="text-center text-sm font-medium">Now Playing</div><button type="button" onClick={onClose} className="justify-self-end p-2 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/50" title="Close music player" aria-label="Close music player"><X size={17}/></button></header>
    <div className={`music-now-playing ${libraryOpen ? 'library-open shrink-0' : 'flex-1 min-h-0 justify-center'} px-5 pb-1 pt-0.5 flex flex-col items-center`}>
      <div className="music-now-playing-details w-full" aria-hidden={libraryOpen}>
        <div className="music-artwork-frame mt-4 mb-3 flex w-full justify-center">{art(false, current || undefined)}</div>
        <div className="music-track-details w-full text-center"><div data-track-title className="truncate text-sm font-semibold">{current?.title || current?.name || 'Nothing playing'}</div><div data-track-subtitle className="mt-1 text-[11px] text-text-secondary">{current ? (current.artist || active?.name || 'Local audio') : 'Import tracks to get started'}</div></div>
      </div>
      {libraryOpen && <button type="button" className="music-current-strip" onClick={returnToPlayer} aria-label="Return to now playing"><span className="music-current-glyph"><Music2 size={16}/></span><span className="music-current-copy"><strong>{current?.title||current?.name||'Nothing playing'}</strong><span>{current?.artist||active?.name||'Choose music from your library'}</span></span><span className="music-status-label">{playing?'Playing':'Paused'}</span></button>}
      <div className="music-transport music-progress-row mt-3 flex w-full items-center gap-2 text-[10px] tabular-nums text-text-secondary"><span>{fmt(position)}</span><input aria-label="Track progress" className="min-w-0 flex-1 accent-current" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration || 0)} onChange={e => { const v = Number(e.target.value); setPosition(v); positionRef.current = v; if (audio.current)
        audio.current.currentTime = v; }}/><span>{fmt(duration)}</span></div>
      <div className="music-transport music-transport-controls mt-3 flex w-full items-center justify-between"><button type="button" onClick={() => setShuffle(v => !v)} className={`flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-raised ${shuffle ? 'text-accent' : 'text-text-secondary'}`} aria-label="Toggle shuffle"><Shuffle size={15}/></button><button type="button" onClick={previous} disabled={!currentId} className="flex h-9 w-9 items-center justify-center rounded-full text-text-primary hover:bg-surface-raised disabled:opacity-40" aria-label="Previous track"><SkipBack size={17} fill="currentColor"/></button><button type="button" onClick={toggle} disabled={!current} className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-raised text-text-primary shadow-md hover:bg-surface disabled:opacity-40" aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><button type="button" onClick={() => advance(false)} disabled={!currentId} className="flex h-9 w-9 items-center justify-center rounded-full text-text-primary hover:bg-surface-raised disabled:opacity-40" aria-label="Next track"><SkipForward size={17} fill="currentColor"/></button><button type="button" onClick={() => setRepeat(r => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')} className={`flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-raised ${repeat !== 'off' ? 'text-accent' : 'text-text-secondary'}`} aria-label="Toggle repeat">{repeat === 'one' ? <Repeat1 size={15}/> : <Repeat size={15}/>}</button></div>
    </div>
    <button ref={libraryToggle} type="button" onClick={() => setLibraryOpen(value => !value)} aria-expanded={libraryOpen} aria-controls="music-library-popup" aria-label={libraryOpen ? 'Close music library' : 'Open music library'} className="music-library-toggle absolute bottom-2 right-2 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-raised text-text-secondary shadow-sm hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><ChevronUp size={17} className={`transition-transform duration-200 ${libraryOpen ? 'rotate-180' : ''}`}/></button>
    <div id="music-library-popup" aria-hidden={!libraryOpen} className={`music-library-popup flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ${libraryOpen ? 'is-open' : ''}`}>
      <MusicLibraryBrowser tracks={tracks} playlists={playlists} state={state} currentId={currentId} loading={loading} error={error} isPlaying={playing} {...browserActions}/>
      {libraryOpen && volumeControl}
    </div>
    {!libraryOpen && <div className="music-volume-dock mt-auto">{volumeControl}</div>}
    {audioElement}
  </section>;
}
