import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getItems, bulkUpdateItemStatus, bulkDeleteItems, Item } from '../api/items';
import StatusLED from '../components/StatusLED';
import { SkeletonTable } from '../components/Skeleton';
import { Plus, Box, Download, Trash2, X } from 'lucide-react';
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

  // Quote every field and escape embedded quotes, so names/notes containing
  // commas or quotes don't silently corrupt the CSV structure.
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

  if (isLoading) return <div className="p-6 max-w-[1400px] mx-auto"><SkeletonTable /></div>;
  if (error) return <div className="p-6 text-status-danger">Error loading items</div>;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <NeedsAttentionBanner />
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-page-title font-ui font-semibold">Inventory</h2>
        <div className="flex gap-2">
          <button
            onClick={() => exportItemsToCsv(items)}
            disabled={items.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            Export CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors font-medium"
          >
            <Plus size={18} />
            Add Item
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          className="px-3 py-2 bg-surface border border-border rounded-sm text-text-primary text-sm focus:outline-none focus:border-accent"
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
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="px-3 py-2 bg-surface border border-border rounded-sm text-text-primary text-sm focus:outline-none focus:border-accent"
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
          <select value={filters.location_id} onChange={(e) => setFilters({ ...filters, location_id: e.target.value })} className="px-3 py-2 bg-surface border border-border rounded-sm text-text-primary text-sm focus:outline-none focus:border-accent">
            <option value="">All locations</option>
            {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
          <label className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary">
            <input type="checkbox" checked={filters.low_stock} onChange={(e) => setFilters({ ...filters, low_stock: e.target.checked })} />
            Low stock only
          </label>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-accent/10 border border-accent/30 rounded-md">
          <span className="text-sm text-text-primary font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <select
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
              Set Status
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-sm hover:bg-status-danger hover:border-status-danger hover:text-bg transition-colors text-sm text-status-danger disabled:opacity-50"
            >
              <Trash2 size={14} />
              Delete
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary"
              title="Clear selection"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="bg-surface border border-border rounded-md overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-raised border-b border-border">
            <tr>
              <th className="w-10 px-4 py-3">
                {items.length > 0 && (
                  <input
                    type="checkbox"
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
                <td colSpan={7} className="px-4 py-12 text-center">
                  <p className="text-text-secondary mb-3">No items yet — add your first one to get started.</p>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm font-medium"
                  >
                    <Plus size={16} />
                    Add Item
                  </button>
                </td>
              </tr>
            ) : (
              items.map((item: Item) => (
                <tr
                  key={item.id}
                  className={`border-b border-border hover:bg-surface-raised transition-colors ${
                    selectedIds.has(item.id) ? 'bg-accent/5' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/inventory/${item.id}`} className="block w-9 h-9 flex-shrink-0">
                      {item.image_resource_id ? (
                        <img
                          src={getResourceDownloadUrl(item.image_resource_id)}
                          alt={item.name}
                          className="w-9 h-9 aspect-square rounded-sm object-cover border border-border"
                        />
                      ) : (
                        <div className="w-9 h-9 aspect-square rounded-sm bg-surface-raised border border-border flex items-center justify-center">
                          <Box size={14} className="text-text-secondary" />
                        </div>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-primary">
                    <Link to={`/inventory/${item.id}`} className="hover:text-accent">
                      {item.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-secondary capitalize">{item.type}</td>
                  <td className="px-4 py-3">
                    <StatusLED status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text-primary">
                    {formatQuantity(item.current_quantity)} {item.unit || ''}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-text-secondary">
                    {formatQuantity(item.initial_quantity)} {item.unit || ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && <AddItemModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
