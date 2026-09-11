import { useRef, useState, useCallback, ReactNode } from 'react';
import { X } from 'lucide-react';

interface RightPanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 360;

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
      // Dragging left (negative delta) widens a right-docked panel.
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
      className="relative flex flex-col h-full bg-surface border-l border-border flex-shrink-0"
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-col-resize z-10 group`}
      >
        <div
          className={`h-full w-full transition-colors ${
            isResizing ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/50'
          }`}
        />
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <h3 className="text-sm font-ui font-semibold text-text-primary">{title}</h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary hover:text-text-primary"
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}
