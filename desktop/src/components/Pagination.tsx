import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function usePagination<T>(items: T[], defaultPageSize = 6) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );
  const changePageSize = (size: number) => {
    setPageSize(size);
    setPage(1);
  };
  return { page: safePage, pageSize, totalPages, pagedItems, setPage, changePageSize };
}

export default function Pagination({ page, pageSize, totalPages, total, onPageChange, onPageSizeChange }: PaginationProps) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const controlClass = 'inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface-raised px-2 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35';
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-text-secondary">
      <span className="whitespace-nowrap">Showing <strong className="font-medium text-text-primary">{start}–{end}</strong> of {total}</span>
      <div className="ml-auto flex items-center gap-2">
        <label className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-2 text-xs">
          <span>Per page</span>
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} aria-label="Items per page" className="bg-transparent text-text-primary outline-none">
            <option value={6}>6</option><option value={12}>12</option><option value={24}>24</option><option value={48}>48</option>
          </select>
        </label>
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className={controlClass} aria-label="Previous page" title="Previous page"><ChevronLeft size={15} /></button>
        <span className="min-w-[56px] text-center font-mono text-[11px] text-text-primary" aria-label={`Page ${page} of ${totalPages}`}>{page} / {totalPages}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className={controlClass} aria-label="Next page" title="Next page"><ChevronRight size={15} /></button>
      </div>
    </div>
  );
}
