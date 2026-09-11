import React from 'react';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className = '', style }: SkeletonProps) {
  return <div className={`skeleton ${className}`} style={style} />;
}

// A table-shaped skeleton — mirrors the row/column layout the real data
// will fill in, so the page doesn't visually "jump" once it loads.
export function SkeletonTable({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="bg-surface-raised px-4 py-3 flex gap-6 border-b border-border">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="px-4 py-3 flex gap-6 border-b border-border last:border-0">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton key={colIdx} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// A single-card content skeleton — for detail pages (item/project) while
// their data loads.
export function SkeletonCard() {
  return (
    <div className="bg-surface border border-border rounded-md p-6 space-y-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-2/3" />
      <div className="grid grid-cols-2 gap-4 pt-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}

// A grid of card-shaped skeletons — for image/note/resource card grids.
export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border border-border rounded-md overflow-hidden">
          <Skeleton className="aspect-video rounded-none" />
          <div className="p-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// A chart-shaped skeleton — for Financials while summary data loads.
export function SkeletonChart() {
  return (
    <div className="h-64 flex items-end gap-3 px-2">
      {[60, 85, 45, 70, 55, 90, 40].map((h, i) => (
        <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
