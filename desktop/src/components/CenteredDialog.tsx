import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Mount above workspace/dock stacking contexts rather than inside a transformed
// page. Keep keyboard focus and scrolling inside the active dialog.
export default function CenteredDialog({ title, eyebrow, onClose, wide = false, compact = false, children }: {
  title: string; eyebrow?: string; onClose: () => void; wide?: boolean; compact?: boolean; children: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.contains(document.activeElement)) dialog.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]')?.focus();
    return () => { if (previous?.isConnected && (document.activeElement === document.body || dialog.contains(document.activeElement))) previous.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<div className="centered-dialog-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close.current(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); event.currentTarget.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }} tabIndex={-1} className={`centered-dialog ${wide ? 'centered-dialog-wide' : ''} ${compact ? 'centered-dialog-compact' : ''}`}>
    <div className="flex max-h-[inherit] min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3.5">
        <div className="min-w-0">{eyebrow && <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-accent">{eyebrow}</div>}<h2 id={id} className="mt-0.5 truncate text-base font-semibold sm:text-lg">{title}</h2></div>
        <button type="button" onClick={onClose} aria-label="Close dialog" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"><X size={17}/></button>
      </header>
      <div className={`min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 ${wide ? 'md:flex md:flex-1 md:flex-col md:overflow-hidden' : ''}`}>{children}</div>
    </div>
    </div>
  </div>, document.body);
}
