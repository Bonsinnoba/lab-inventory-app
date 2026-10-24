type CollectionQuery = {
  data?: unknown[];
  isError: boolean;
  isPending: boolean;
  isFetching: boolean;
  refetch: () => unknown;
};

// Render alongside retained rows: a background refresh must not replace them.
export default function ExperimentCollectionStatus({ query, label, empty }: {
  query: CollectionQuery;
  label: string;
  empty: string;
}) {
  if (query.isError) return <div role="status" className="text-xs text-status-warning mb-2">
    {query.data !== undefined
      ? `${label} could not be refreshed. Showing the last loaded data.`
      : `${label} are unavailable. This does not mean there are no records.`}
    <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}
      className="ml-2 text-accent underline disabled:opacity-50">Retry</button>
  </div>;
  if (query.isPending && query.data === undefined) return <div role="status" className="text-xs text-text-secondary">Loading {label.toLowerCase()}…</div>;
  if (query.data?.length === 0) return <div className="text-xs text-text-secondary">{empty}</div>;
  return null;
}
