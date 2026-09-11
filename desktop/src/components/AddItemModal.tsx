import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { createItem, Item } from '../api/items';
import { getLocations, Location } from '../api/locations';
import { useToast } from '../contexts/ToastContext';
import { useState } from 'react';

interface AddItemModalProps {
  onClose: () => void;
}

export default function AddItemModal({ onClose }: AddItemModalProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: getLocations,
  });

  const [formData, setFormData] = useState({
    name: '',
    type: 'tool' as Item['type'],
    category: '',
    sku: '',
    initial_quantity: 1,
    unit: '',
    dimensions: '',
    status: 'available' as Item['status'],
    location_id: '',
    unit_cost: '',
    replacement_cost: '',
    supplier: '',
    part_number: '',
  });

  const createMutation = useMutation({
    mutationFn: createItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      showToast('Item created');
      onClose();
    },
    onError: (err: any) => showToast(err?.message || 'Failed to create item', 'error'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      ...formData,
      initial_quantity: Number(formData.initial_quantity),
      unit_cost: formData.unit_cost ? Number(formData.unit_cost) : undefined,
      replacement_cost: formData.replacement_cost ? Number(formData.replacement_cost) : undefined,
      location_id: formData.location_id || undefined,
      current_quantity: Number(formData.initial_quantity),
    } as Omit<Item, 'id' | 'created_at' | 'updated_at'>);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface border border-border rounded-md p-6 w-[600px] max-h-[90vh] overflow-y-auto">
        <h3 className="text-section-header font-ui font-semibold mb-4">Add Item</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Type *</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as Item['type'] })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                required
              >
                <option value="tool">Tool</option>
                <option value="component">Component</option>
                <option value="equipment">Equipment</option>
                <option value="material">Material</option>
                <option value="chemical">Chemical</option>
                <option value="consumable">Consumable</option>
                <option value="instrument">Instrument</option>
                <option value="spare_part">Spare Part</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Category</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">SKU</label>
              <input
                type="text"
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm text-text-secondary mb-1">Supplier</label><input value={formData.supplier} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent" /></div>
            <div><label className="block text-sm text-text-secondary mb-1">Part Number</label><input value={formData.part_number} onChange={(e) => setFormData({ ...formData, part_number: e.target.value })} className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent" /></div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Initial Qty *</label>
              <input
                type="number"
                value={formData.initial_quantity}
                onChange={(e) => setFormData({ ...formData, initial_quantity: parseInt(e.target.value) || 1 })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                required
                min="1"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Unit</label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                placeholder="e.g., pcs, kg, mL"
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Status *</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as Item['status'] })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                required
              >
                <option value="available">Available</option>
                <option value="in_use">In Use</option>
                <option value="damaged">Damaged</option>
                <option value="needs_repair">Needs Repair</option>
                <option value="needs_replacement">Needs Replacement</option>
                <option value="low_stock">Low Stock</option>
                <option value="retired">Retired</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Dimensions</label>
            <input
              type="text"
              value={formData.dimensions}
              onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
              placeholder="e.g., 10x5x2 cm"
              className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Location</label>
            <select
              value={formData.location_id}
              onChange={(e) => setFormData({ ...formData, location_id: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">No location</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Unit Cost</label>
              <input
                type="number"
                step="0.01"
                value={formData.unit_cost}
                onChange={(e) => setFormData({ ...formData, unit_cost: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Replacement Cost</label>
              <input
                type="number"
                step="0.01"
                value={formData.replacement_cost}
                onChange={(e) => setFormData({ ...formData, replacement_cost: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-surface-raised border border-border rounded-sm hover:bg-surface-raised transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
