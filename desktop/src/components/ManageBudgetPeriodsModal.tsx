import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { getBudgetPeriods, createBudgetPeriod, updateBudgetPeriod, deleteBudgetPeriod, BudgetPeriod } from '../api/budget-periods';
import { useState } from 'react';
import { Trash2, Edit, Plus } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

interface ManageBudgetPeriodsModalProps {
  onClose: () => void;
}

export default function ManageBudgetPeriodsModal({ onClose }: ManageBudgetPeriodsModalProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: periods = [], isLoading } = useQuery<BudgetPeriod[]>({
    queryKey: ['budgetPeriods'],
    queryFn: getBudgetPeriods,
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    label: '',
    total_budget: '',
    start_date: '',
    end_date: '',
  });

  const createMutation = useMutation({
    mutationFn: createBudgetPeriod,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgetPeriods'] });
      setShowAddForm(false);
      setFormData({ label: '', total_budget: '', start_date: '', end_date: '' });
      showToast('Budget period added');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to add budget period', 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BudgetPeriod> }) => updateBudgetPeriod(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgetPeriods'] });
      setEditingId(null);
      setFormData({ label: '', total_budget: '', start_date: '', end_date: '' });
      showToast('Budget period updated');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to update budget period', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBudgetPeriod,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgetPeriods'] });
      showToast('Budget period deleted');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to delete budget period', 'error'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      label: formData.label,
      total_budget: formData.total_budget ? Number(formData.total_budget) : 0,
      start_date: formData.start_date,
      end_date: formData.end_date,
    };
    
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (period: BudgetPeriod) => {
    setEditingId(period.id);
    setFormData({
      label: period.label,
      total_budget: period.total_budget ? String(period.total_budget) : '',
      start_date: period.start_date || '',
      end_date: period.end_date || '',
    });
    setShowAddForm(true);
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setEditingId(null);
    setFormData({ label: '', total_budget: '', start_date: '', end_date: '' });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface border border-border rounded-md p-6 w-[700px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-section-header font-ui font-semibold">Manage Budget Periods</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">✕</button>
        </div>

        {showAddForm ? (
          <form onSubmit={handleSubmit} className="space-y-4 mb-6 p-4 bg-surface-raised border border-border rounded-md">
            <h4 className="text-sm font-medium">{editingId ? 'Edit' : 'Add'} Budget Period</h4>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Label *</label>
              <input
                type="text"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Total Budget</label>
              <input
                type="number"
                step="0.01"
                value={formData.total_budget}
                onChange={(e) => setFormData({ ...formData, total_budget: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Start Date *</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">End Date *</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                  required
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={handleCancel} className="px-4 py-2 bg-surface border border-border rounded-sm hover:bg-surface-raised transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors disabled:opacity-50">
                {editingId ? 'Update' : 'Add'}
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-2 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors"
          >
            <Plus size={16} />
            Add New Budget Period
          </button>
        )}

        {isLoading ? (
          <div className="text-center py-8 text-text-secondary">Loading...</div>
        ) : periods.length === 0 ? (
          <div className="text-center py-8 text-text-secondary">No budget periods yet</div>
        ) : (
          <div className="space-y-2">
            {periods.map((period) => (
              <div key={period.id} className="p-3 bg-surface-raised border border-border rounded-sm flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-text-primary font-medium">{period.label}</div>
                  <div className="text-xs text-text-secondary">
                    {period.start_date && period.end_date ? (
                      `${new Date(period.start_date).toLocaleDateString()} - ${new Date(period.end_date).toLocaleDateString()}`
                    ) : 'No dates set'}
                  </div>
                  {period.total_budget && (
                    <div className="text-xs text-text-secondary">Budget: ${Number(period.total_budget).toFixed(2)}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(period)} className="p-1.5 hover:bg-surface rounded-sm transition-colors">
                    <Edit size={14} />
                  </button>
                  <button onClick={() => deleteMutation.mutate(period.id)} className="p-1.5 hover:bg-status-danger hover:text-bg rounded-sm transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
