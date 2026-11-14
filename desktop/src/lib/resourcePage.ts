// Bound card/poster mounting, independently of the full search/selection set.
export const RESOURCE_PAGE_SIZE = 48;
export function resourcePage<T>(rows: readonly T[], requested: number) {
  const pages = Math.max(1, Math.ceil(rows.length / RESOURCE_PAGE_SIZE));
  const index = Math.min(pages - 1, Math.max(0, Number.isFinite(requested) ? Math.floor(requested) : 0));
  const start = index * RESOURCE_PAGE_SIZE;
  return {index, pages, start, rows: rows.slice(start, start + RESOURCE_PAGE_SIZE)};
}
