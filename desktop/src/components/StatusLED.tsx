import { useEffect, useRef, useState } from 'react';

interface StatusLEDProps {
  status: 'available' | 'in_use' | 'damaged' | 'needs_repair' | 'needs_replacement' | 'low_stock' | 'retired';
}

const statusColors = {
  available: 'var(--color-status-ok)',
  in_use: 'var(--color-accent)',
  damaged: 'var(--color-status-danger)',
  needs_repair: 'var(--color-status-warn)',
  needs_replacement: 'var(--color-status-danger)',
  low_stock: 'var(--color-status-warn)',
  retired: 'var(--color-status-neutral)',
};

export default function StatusLED({ status }: StatusLEDProps) {
  const color = statusColors[status];
  const previousStatus = useRef(status);
  const [isPulsing, setIsPulsing] = useState(false);

  useEffect(() => {
    // Skip the pulse on initial mount — only pulse when the status
    // actually changes to something different, giving visible
    // confirmation an update just happened.
    if (previousStatus.current !== status) {
      previousStatus.current = status;
      setIsPulsing(true);
      const timeout = setTimeout(() => setIsPulsing(false), 500);
      return () => clearTimeout(timeout);
    }
  }, [status]);

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2 h-2 rounded-full ${isPulsing ? 'status-led-pulse' : ''}`}
        style={{
          backgroundColor: color,
          boxShadow: `0 0 8px ${color}66`,
        }}
      />
      <span className="text-sm capitalize" style={{ color }}>
        {status.replace('_', ' ')}
      </span>
    </div>
  );
}
