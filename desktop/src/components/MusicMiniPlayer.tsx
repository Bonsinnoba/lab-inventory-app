import { useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';

interface Props {
  onRestore: () => void;
  onClose: () => void;
}

export default function MusicMiniPlayer({ onRestore, onClose }: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [positionOffset, setPositionOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [trackName, setTrackName] = useState('Nothing playing');
  const [trackSubtitle, setTrackSubtitle] = useState('Your music library');
  const [artwork, setArtwork] = useState('');
  const drag = useRef({ active: false, moved: false, startX: 0, startY: 0, originX: 0, originY: 0, left: 0, top: 0, width: 0, height: 0 });
  const getAudio = () => document.querySelector('audio') as HTMLAudioElement | null;
  const clickMusicControl = (label: string) => {
    const button = document.querySelector(`[aria-label="Music player"] button[aria-label="${label}"]`) as HTMLButtonElement | null;
    button?.click();
  };
  useEffect(() => {
    const sync = () => {
      const audio = getAudio();
      if (audio) {
        setPlaying(!audio.paused);
        setPosition(audio.currentTime || 0);
        setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      }
      const track = document.querySelector('.music-now-playing');
      const details = track?.querySelector('.music-track-details');
      setTrackName(details?.querySelector('[data-track-title]')?.textContent || 'Nothing playing');
      setTrackSubtitle(details?.querySelector('[data-track-subtitle]')?.textContent || 'Your music library');
      const cover = track?.querySelector('.music-artwork-frame img') as HTMLImageElement | null;
      setArtwork(cover?.src || '');
    };
    const timer = window.setInterval(sync, 250);
    sync();
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!controlsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setControlsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [controlsOpen]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!drag.current.active) return;
      const dx = event.clientX - drag.current.startX;
      const dy = event.clientY - drag.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.current.moved = true;
      const maxDx = window.innerWidth - drag.current.left - drag.current.width;
      const maxDy = window.innerHeight - drag.current.top - drag.current.height;
      const boundedDx = Math.max(-drag.current.left, Math.min(maxDx, dx));
      const boundedDy = Math.max(-drag.current.top, Math.min(maxDy, dy));
      setPositionOffset({ x: drag.current.originX + boundedDx, y: drag.current.originY + boundedDy });
    };
    const up = () => {
      if (!drag.current.active) return;
      drag.current.active = false;
      setDragging(false);
      window.setTimeout(() => { drag.current.moved = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, []);

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    drag.current = { active: true, moved: false, startX: event.clientX, startY: event.clientY, originX: positionOffset.x, originY: positionOffset.y, left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const toggle = () => {
    const audio = getAudio();
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => undefined);
    else audio.pause();
  };
  const secondaryButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;
  const circumference = 163.36;

  return <div ref={container} className="fixed right-[68px] bottom-5 z-[85]" style={{ transform: `translate(${positionOffset.x}px, ${positionOffset.y}px)` }} aria-label="Minimized music player">
    <div aria-hidden={!controlsOpen} className={`music-mini-controls absolute bottom-[calc(100%+10px)] right-0 w-[min(210px,calc(100vw-88px))] rounded-2xl border border-border bg-surface-raised p-2.5 shadow-2xl ${controlsOpen ? 'is-open' : ''}`}>
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" onClick={onRestore} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" title="Open music player" aria-label={`Open ${trackName} in music player`}>
          <div className="music-artwork-mini flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border text-accent">
            {artwork ? <img src={artwork} alt="" className="h-full w-full object-cover"/> : <Music2 size={17}/>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-text-primary">{trackName}</div>
            <div className="truncate text-[10px] text-text-secondary">{trackSubtitle}</div>
          </div>
        </button>
        <button type="button" onClick={onClose} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface hover:text-text-primary" title="Close music player" aria-label="Close music player"><X size={14}/></button>
      </div>
      <div className="mt-2.5 flex items-center justify-center gap-5 border-t border-border/70 pt-2">
        <button type="button" onClick={() => clickMusicControl('Previous track')} className={secondaryButton} title="Previous track" aria-label="Previous track"><SkipBack size={15}/></button>
        <button type="button" onClick={toggle} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-bg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}</button>
        <button type="button" onClick={() => clickMusicControl('Next track')} className={secondaryButton} title="Next track" aria-label="Next track"><SkipForward size={15}/></button>
      </div>
    </div>
    <button type="button" onPointerDown={startDrag} onClick={() => { if (!drag.current.moved) setControlsOpen(value => !value); }} aria-expanded={controlsOpen} className={`relative flex h-[60px] w-[60px] select-none touch-none items-center justify-center overflow-hidden rounded-full border-2 border-border bg-surface-raised text-text-primary shadow-xl transition-[transform,box-shadow] duration-150 hover:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/60 ${dragging ? 'scale-105 cursor-grabbing shadow-2xl' : 'cursor-grab'}`} title={controlsOpen ? 'Hide music controls' : `Show controls for ${trackName}`} aria-label={`${controlsOpen ? 'Hide' : 'Show'} music controls${duration > 0 ? `, ${Math.round(progress * 100)}% played` : ''}`}>
      {artwork ? <img src={artwork} alt="" draggable={false} className="h-full w-full object-cover"/> : trackName !== 'Nothing playing' ? (playing ? <Pause size={25} fill="currentColor"/> : <Play size={25} fill="currentColor"/>) : <Music2 size={25}/>}
      <svg className="music-mini-progress pointer-events-none absolute inset-0 h-full w-full rotate-[-90deg]" viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeOpacity=".28" strokeWidth="2"/>
        <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} strokeLinecap="round" className="text-accent"/>
      </svg>
      {playing && <span className="absolute right-0 top-0 h-4 w-4 rounded-full border-[3px] border-surface-raised bg-accent" aria-hidden="true"/>}
    </button>
  </div>;
}
