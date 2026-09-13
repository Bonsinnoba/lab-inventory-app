import { useEffect, useRef, useState } from 'react';
import { Maximize2, Music2, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, X, Repeat, Repeat1 } from 'lucide-react';

interface Props {
  onRestore: () => void;
  onClose: () => void;
}

export default function MusicMiniPlayer({ onRestore, onClose }: Props) {
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  const [controlsOpen, setControlsOpen] = useState(false);
  const [positionOffset, setPositionOffset] = useState({ x: 0, y: 0 });
  const drag = useRef({ active: false, moved: false, startX: 0, startY: 0, originX: 0, originY: 0 });
  const hideTimer = useRef<number | null>(null);

  const getAudio = () => document.querySelector('audio') as HTMLAudioElement | null;
  const clickMusicControl = (label: string) => {
    const button = Array.from(document.querySelectorAll('button')).find(candidate => candidate.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
    button?.click();
  };
  const clearHideTimer = () => { if (hideTimer.current !== null) { window.clearTimeout(hideTimer.current); hideTimer.current = null; } };
  const scheduleHide = () => { clearHideTimer(); hideTimer.current = window.setTimeout(() => setControlsOpen(false), 1400); };

  useEffect(() => {
    const sync = () => { const audio = getAudio(); if (!audio) return; setPlaying(!audio.paused); setPosition(audio.currentTime || 0); setDuration(Number.isFinite(audio.duration) ? audio.duration : 0); };
    const timer = window.setInterval(sync, 250);
    sync();
    return () => { window.clearInterval(timer); clearHideTimer(); };
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!drag.current.active) return;
      const dx = event.clientX - drag.current.startX;
      const dy = event.clientY - drag.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.current.moved = true;
      setPositionOffset({ x: drag.current.originX + dx, y: drag.current.originY + dy });
    };
    const up = () => {
      if (!drag.current.active) return;
      drag.current.active = false;
      window.setTimeout(() => { drag.current.moved = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  useEffect(() => {
    const syncRepeat = (event: Event) => { const value = (event as CustomEvent<'off' | 'all' | 'one'>).detail; if (value) setRepeat(value); };
    window.addEventListener('labos:music-repeat-state', syncRepeat);
    return () => window.removeEventListener('labos:music-repeat-state', syncRepeat);
  }, []);

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    drag.current = { active: true, moved: false, startX: event.clientX, startY: event.clientY, originX: positionOffset.x, originY: positionOffset.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const toggle = () => { const audio = getAudio(); if (!audio) return; if (audio.paused) audio.play().catch(() => undefined); else audio.pause(); };
  const seek = (delta: number) => { const audio = getAudio(); if (!audio) return; audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + delta)); };
  const toggleRepeat = () => clickMusicControl('Toggle repeat');
  const fmt = (value: number) => `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`;

  return <div className="fixed right-[68px] bottom-5 z-[85]" style={{ transform: `translate(${positionOffset.x}px, ${positionOffset.y}px)` }} onMouseEnter={() => { clearHideTimer(); setControlsOpen(true); }} onMouseLeave={scheduleHide} aria-label="Minimized music player">
    {controlsOpen && <div className="absolute right-0 bottom-[calc(100%+10px)] flex items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-2.5 py-2 shadow-2xl whitespace-nowrap" onMouseEnter={clearHideTimer} onMouseLeave={scheduleHide}>
      <button type="button" onClick={() => clickMusicControl('Previous track')} className="w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface flex items-center justify-center" title="Previous track" aria-label="Previous track"><SkipBack size={15}/></button>
      <button type="button" onClick={() => seek(-15)} className="w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface flex items-center justify-center" title="Back 15 seconds" aria-label="Back 15 seconds"><RotateCcw size={15}/></button>
      <button type="button" onClick={toggle} className="w-9 h-9 rounded-full bg-accent text-bg flex items-center justify-center" title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={16}/> : <Play size={16}/>}</button>
      <button type="button" onClick={() => seek(15)} className="w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface flex items-center justify-center" title="Forward 15 seconds" aria-label="Forward 15 seconds"><RotateCw size={15}/></button>
      <button type="button" onClick={() => clickMusicControl('Next track')} className="w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface flex items-center justify-center" title="Next track" aria-label="Next track"><SkipForward size={15}/></button>
      <button type="button" onClick={toggleRepeat} className={`w-8 h-8 rounded-lg flex items-center justify-center ${repeat !== 'off' ? 'text-accent' : 'text-text-secondary'} hover:text-text-primary hover:bg-surface`} title={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'} aria-label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}>{repeat === 'one' ? <Repeat1 size={15}/> : <Repeat size={15}/>}</button>
      <div className="w-px h-6 bg-border mx-0.5" aria-hidden="true" />
      <div className="text-[10px] tabular-nums text-text-secondary px-1">{fmt(position)} / {fmt(duration)}</div>
      <button type="button" onClick={onRestore} className="w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface flex items-center justify-center" title="Open music player" aria-label="Open music player"><Maximize2 size={15}/></button>
      <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface flex items-center justify-center" title="Close music player" aria-label="Close music player"><X size={15}/></button>
    </div>}
    <button type="button" onPointerDown={startDrag} onClick={() => { if (!drag.current.moved) onRestore(); }} className="relative w-12 h-12 rounded-full border border-border bg-surface-raised text-text-primary shadow-xl flex items-center justify-center hover:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/60 cursor-grab active:cursor-grabbing" title="Open music player" aria-label="Open music player"><Music2 size={19}/>{playing && <span className="absolute -right-0.5 -top-0.5 w-3 h-3 rounded-full bg-accent border-2 border-surface-raised" aria-hidden="true"/>}</button>
  </div>;
}
