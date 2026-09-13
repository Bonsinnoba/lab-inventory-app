import { useRef, useState, useCallback, ReactNode } from 'react';
import { X, GripVertical } from 'lucide-react';

interface RightPanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 380;

export default function RightPanel({ title, onClose, children }: RightPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [width]);

  return (
    <div
      ref={panelRef}
      style={{ width }}
      role="complementary"
      aria-label={title}
      className="relative flex flex-col h-full bg-surface border-l border-border flex-shrink-0"
    >
      <div
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${title} panel`}
        className={`absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-col-resize z-10 flex items-center justify-center group ${isResizing ? 'bg-accent/10' : ''}`}
      >
        <span className={`rounded-full transition-all ${isResizing ? 'h-10 w-0.5 bg-accent' : 'h-8 w-px bg-transparent group-hover:bg-accent/60'}`}>
          <GripVertical size={12} className={`-ml-[5px] mt-1 transition-opacity ${isResizing ? 'opacity-100 text-accent' : 'opacity-0 group-hover:opacity-60 text-accent'}`} aria-hidden="true" />
        </span>
      </div>

      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border flex-shrink-0 min-h-[56px]">
        <h2 className="text-sm font-ui font-semibold text-text-primary truncate">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          title={`Close ${title}`}
          aria-label={`Close ${title}`}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}
