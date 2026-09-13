import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getItems, bulkUpdateItemStatus, bulkDeleteItems, Item } from '../api/items';
import StatusLED from '../components/StatusLED';
import { SkeletonTable } from '../components/Skeleton';
import { Plus, Box, Download, Trash2, X, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import AddItemModal from '../components/AddItemModal';
import NeedsAttentionBanner from '../components/NeedsAttentionBanner';
import { useToast } from '../contexts/ToastContext';
import { formatQuantity } from '../lib/utils';
import { getResourceDownloadUrl } from '../api/resources';
import { getLocations, Location } from '../api/locations';

const STATUS_OPTIONS: Item['status'][] = [
  'available', 'in_use', 'damaged', 'needs_repair', 'needs_replacement', 'low_stock', 'retired',
];

function exportItemsToCsv(items: Item[]) {
  const headers = ['Name', 'Type', 'Category', 'SKU', 'Status', 'Current Qty', 'Initial Qty', 'Unit', 'Unit Cost', 'Replacement Cost', 'Condition Notes'];
  const rows = items.map((item) => [
    item.name, item.type, item.category || '', item.sku || '', item.status,
    item.current_quantity, item.initial_quantity, item.unit || '',
    item.unit_cost ?? '', item.replacement_cost ?? '', item.condition_notes || '',
  ]);

  const escapeCell = (val: any) => `"${String(val).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inventory-export-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [filters, setFilters] = useState({ type: '', status: '', location_id: '', low_stock: false });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<Item['status']>('available');

  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ['locations'], queryFn: getLocations });

  const { data: items = [], isLoading, error } = useQuery({
    queryKey: ['items', filters],
    queryFn: () => getItems(filters),
  });

  const hasActiveFilters = Boolean(filters.type || filters.status || filters.location_id || filters.low_stock);
  const clearFilters = () => setFilters({ type: '', status: '', location_id: '', low_stock: false });

  const bulkStatusMutation = useMutation({
    mutationFn: () => bulkUpdateItemStatus(Array.from(selectedIds), bulkStatus),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      showToast(`${result.updated} item${result.updated !== 1 ? 's' : ''} updated`);
      setSelectedIds(new Set());
    },
    onError: (err: any) => showToast(err?.message || 'Failed to update items', 'error'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => bulkDeleteItems(Array.from(selectedIds)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      showToast(`${result.deleted} item${result.deleted !== 1 ? 's' : ''} deleted`);
      setSelectedIds(new Set());
    },
    onError: (err: any) => showToast(err?.message || 'Failed to delete items', 'error'),
  });

  const handleBulkDelete = () => {
    if (window.confirm(`Delete ${selectedIds.size} selected item${selectedIds.size !== 1 ? 's' : ''}? This can't be undone.`)) {
      bulkDeleteMutation.mutate();
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map((i) => i.id)));
  };

  if (isLoading) return <div className="p-4 sm:p-6 max-w-[1400px] mx-auto"><SkeletonTable /></div>;
  if (error) return <div className="p-4 sm:p-6 text-status-danger">Error loading items</div>;

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <NeedsAttentionBanner />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-page-title font-ui font-semibold">Inventory</h2>
          <p className="mt-1 text-sm text-text-secondary">
            {items.length} {items.length === 1 ? 'item' : 'items'}{hasActiveFilters ? ' matching current filters' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => exportItemsToCsv(items)}
            disabled={items.length === 0}
            className="flex items-center gap-2 px-3.5 py-2 bg-surface-raised border border-border rounded-sm hover:border-accent hover:bg-surface transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            Export CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors font-medium"
          >
            <Plus size={18} />
            Add Item
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-md border border-border bg-surface-raised/60 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Filters</span>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface rounded-sm transition-colors"
            >
              <RotateCcw size={13} />
              Reset
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Filter by type"
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            className="min-h-10 px-3 py-2 bg-surface border border-border rounded-sm text-text-primary text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          >
            <option value="">All Types</option>
            <option value="tool">Tool</option>
            <option value="component">Component</option>
            <option value="equipment">Equipment</option>
            <option value="material">Material</option>
            <option value="chemical">Chemical</option>
            <option value="consumable">Consumable</option>
            <option value="instrument">Instrument</option>
            <option value="spare_part">Spare Part</option>
          </select>

          <select
            aria-label="Filter by status"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="min-h-10 px-3 py-2 bg-surface border border-border rounded-sm text-text-primary text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          >
            <option value="">All Status</option>
            <option value="available">Available</option>
            <option value="in_use">In Use</option>
            <option value="damaged">Damaged</option>
            <option value="needs_repair">Needs Repair</option>
            <option value="needs_replacement">Needs Replacement</option>
            <option value="low_stock">Low Stock</option>
            <option value="retired">Retired</option>
          </select>

          <select
            aria-label="Filter by location"
            value={filters.location_id}
            onChange={(e) => setFilters({ ...filters, location_id: e.target.value })}
            className="min-h-10 px-3 py-2 bg-surface border border-border rounded-sm text-text-primary text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          >
            <option value="">All locations</option>
            {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>

          <label className="min-h-10 inline-flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary cursor-pointer rounded-sm hover:bg-surface transition-colors">
            <input
              type="checkbox"
              checked={filters.low_stock}
              onChange={(e) => setFilters({ ...filters, low_stock: e.target.checked })}
              className="accent-[var(--color-accent)]"
            />
            Low stock only
          </label>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4 px-4 py-3 bg-accent/10 border border-accent/30 rounded-md">
          <span className="text-sm text-text-primary font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <select
              aria-label="Bulk status"
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value as Item['status'])}
              className="px-2 py-1.5 bg-surface border border-border rounded-sm text-text-primary text-sm focus:outline-none focus:border-accent"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
            <button
              onClick={() => bulkStatusMutation.mutate()}
              disabled={bulkStatusMutation.isPending}
              className="px-3 py-1.5 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm font-medium disabled:opacity-50"
            >
              {bulkStatusMutation.isPending ? 'Updating…' : 'Set Status'}
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-sm hover:bg-status-danger hover:border-status-danger hover:text-bg transition-colors text-sm text-status-danger disabled:opacity-50"
            >
              <Trash2 size={14} />
              {bulkDeleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary"
              title="Clear selection"
              aria-label="Clear selection"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="bg-surface border border-border rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="bg-surface-raised border-b border-border">
              <tr>
                <th className="w-10 px-4 py-3">
                  {items.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Select all items"
                      checked={selectedIds.size === items.length}
                      onChange={toggleSelectAll}
                      className="cursor-pointer"
                    />
                  )}
                </th>
                <th className="w-14 px-4 py-3"></th>
                <th className="text-left px-4 py-3 text-text-secondary text-sm font-medium">Name</th>
                <th className="text-left px-4 py-3 text-text-secondary text-sm font-medium">Type</th>
                <th className="text-left px-4 py-3 text-text-secondary text-sm font-medium">Status</th>
                <th className="text-right px-4 py-3 text-text-secondary text-sm font-medium font-mono whitespace-nowrap">Current Qty</th>
                <th className="text-right px-4 py-3 text-text-secondary text-sm font-medium font-mono whitespace-nowrap">Initial Qty</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center">
                    <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-surface-raised border border-border flex items-center justify-center">
                      <Box size={18} className="text-text-secondary" />
                    </div>
                    <p className="text-text-primary font-medium mb-1">No inventory items found</p>
                    <p className="text-sm text-text-secondary mb-4">
                      {hasActiveFilters ? 'Try clearing or adjusting your filters.' : 'Add your first item to start tracking your lab inventory.'}
                    </p>
                    {hasActiveFilters ? (
                      <button onClick={clearFilters} className="inline-flex items-center gap-2 px-3.5 py-2 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-sm font-medium">
                        <RotateCcw size={15} />
                        Clear filters
                      </button>
                    ) : (
                      <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm font-medium">
                        <Plus size={16} />
                        Add Item
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                items.map((item: Item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-border last:border-b-0 hover:bg-surface-raised transition-colors ${selectedIds.has(item.id) ? 'bg-accent/5' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.name}`}
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/inventory/${item.id}`} className="block w-9 h-9 flex-shrink-0" aria-label={`Open ${item.name}`}>
                        {item.image_resource_id ? (
                          <img src={getResourceDownloadUrl(item.image_resource_id)} alt="" className="w-9 h-9 aspect-square rounded-sm object-cover border border-border" />
                        ) : (
                          <div className="w-9 h-9 aspect-square rounded-sm bg-surface-raised border border-border flex items-center justify-center">
                            <Box size={14} className="text-text-secondary" />
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-primary">
                      <Link to={`/inventory/${item.id}`} className="font-medium hover:text-accent transition-colors">
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-secondary capitalize">{item.type.replace('_', ' ')}</td>
                    <td className="px-4 py-3"><StatusLED status={item.status} /></td>
                    <td className="px-4 py-3 text-right font-mono text-text-primary whitespace-nowrap">
                      {formatQuantity(item.current_quantity)} {item.unit || ''}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-text-secondary whitespace-nowrap">
                      {formatQuantity(item.initial_quantity)} {item.unit || ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && <AddItemModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
