interface PaginationProps { page: number; pageSize: number; totalPages: number; total: number; onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void; }
export default function Pagination({ page, pageSize, totalPages, total, onPageChange, onPageSizeChange }: PaginationProps) {
  if (total === 0) return null;
  return <div className="flex items-center justify-between gap-3 mt-4 text-sm text-text-secondary">
    <span>Page {page} of {totalPages} · {total} records</span>
    <div className="flex items-center gap-2">
      <label className="text-xs">Rows <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} className="ml-1 bg-surface border border-border rounded px-1.5 py-1"><option value={6}>6</option><option value={12}>12</option><option value={24}>24</option><option value={48}>48</option></select></label>
      <button disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="px-2 py-1 border border-border rounded disabled:opacity-40">Prev</button>
      <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="px-2 py-1 border border-border rounded disabled:opacity-40">Next</button>
    </div>
  </div>;
}
