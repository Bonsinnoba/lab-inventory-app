import { useMemo, useState } from 'react';

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
  return (
    <div className="flex items-center justify-between gap-3 mt-4 text-sm text-text-secondary">
      <span>Showing {start}–{end} of {total}</span>
      <div className="flex items-center gap-2">
        <label className="text-xs">Per view
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} className="ml-1 bg-surface border border-border rounded px-1.5 py-1">
            <option value={6}>6</option><option value={12}>12</option><option value={24}>24</option><option value={48}>48</option>
          </select>
        </label>
        <button disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="px-2 py-1 border border-border rounded disabled:opacity-40">Prev</button>
        <span className="min-w-[52px] text-center text-xs">{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="px-2 py-1 border border-border rounded disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
