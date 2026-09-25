import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { getFundingSources, createFundingSource, updateFundingSource, deleteFundingSource, FundingSource } from '../api/funding-sources';
import { useState } from 'react';
import { Trash2, Edit, Plus } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

interface ManageFundingSourcesModalProps {
  onClose: () => void;
}

export default function ManageFundingSourcesModal({ onClose }: ManageFundingSourcesModalProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: sources = [], isLoading } = useQuery<FundingSource[]>({
    queryKey: ['fundingSources'],
    queryFn: getFundingSources,
  });

  const [pendingDelete, setPendingDelete] = useState<{id:string;name:string}|null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    source_type: 'donor' as FundingSource['source_type'],
    contact_info: '',
    notes: '',
  });

  const createMutation = useMutation({
    mutationFn: createFundingSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fundingSources'] });
      setShowAddForm(false);
      setFormData({ name: '', source_type: 'donor', contact_info: '', notes: '' });
      showToast('Funding source added');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to add funding source', 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FundingSource> }) => updateFundingSource(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fundingSources'] });
      setEditingId(null);
      setFormData({ name: '', source_type: 'donor', contact_info: '', notes: '' });
      showToast('Funding source updated');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to update funding source', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFundingSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fundingSources'] });
      showToast('Funding source deleted');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to delete funding source', 'error'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (source: FundingSource) => {
    setEditingId(source.id);
    setFormData({
      name: source.name,
      source_type: source.source_type,
      contact_info: source.contact_info || '',
      notes: source.notes || '',
    });
    setShowAddForm(true);
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setEditingId(null);
    setFormData({ name: '', source_type: 'donor', contact_info: '', notes: '' });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div role="dialog" aria-modal="true" className="bg-surface border border-border rounded-md w-[700px] max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border shrink-0">
          <h3 className="text-section-header font-ui font-semibold">Manage Funding Sources</h3>
          <div className="flex items-center gap-2">{showAddForm && <><button type="button" onClick={handleCancel} className="px-3 py-1.5 text-sm border border-border rounded-sm">Cancel</button><button type="submit" form="funding-source-form" disabled={createMutation.isPending || updateMutation.isPending} className="px-3 py-1.5 text-sm bg-accent text-bg rounded-sm disabled:opacity-50">{editingId ? 'Save' : 'Add'}</button></>}<button type="button" aria-label="Close modal" onClick={onClose} className="px-2 py-1.5 text-text-secondary hover:text-text-primary">✕</button></div>
        </div>

        <div className="overflow-y-auto min-h-0 p-4">
        {showAddForm ? (
          <form id="funding-source-form" onSubmit={handleSubmit} className="space-y-4 mb-6 p-4 bg-surface-raised border border-border rounded-md">
            <h4 className="text-sm font-medium">{editingId ? 'Edit' : 'Add'} Funding Source</h4>
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
                  value={formData.source_type}
                  onChange={(e) => setFormData({ ...formData, source_type: e.target.value as FundingSource['source_type'] })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                  required
                >
                  <option value="donor">Donor</option>
                  <option value="investor">Investor</option>
                  <option value="grant_body">Grant Body</option>
                  <option value="institutional">Institutional</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Contact Info</label>
              <input
                type="text"
                value={formData.contact_info}
                onChange={(e) => setFormData({ ...formData, contact_info: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                rows={2}
              />
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-2 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors"
          >
            <Plus size={16} />
            Add New Funding Source
          </button>
        )}

        {isLoading ? (
          <div className="text-center py-8 text-text-secondary">Loading...</div>
        ) : sources.length === 0 ? (
          <div className="text-center py-8 text-text-secondary">No funding sources yet</div>
        ) : (
          <div className="space-y-2">
            {sources.map((source) => (
              <div key={source.id} className="p-3 bg-surface-raised border border-border rounded-sm flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-text-primary font-medium">{source.name}</div>
                  <div className="text-xs text-text-secondary">{source.source_type}</div>
                  {source.total_contributed && (
                    <div className="text-xs text-text-secondary">Contributed: ${source.total_contributed.toFixed(2)}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(source)} className="p-1.5 hover:bg-surface rounded-sm transition-colors">
                    <Edit size={14} />
                  </button>
                  <button onClick={() => setPendingDelete({id:source.id,name:source.name})} aria-label={`Delete ${source.name}`} disabled={deleteMutation.isPending} className="p-1.5 hover:bg-status-danger hover:text-bg rounded-sm transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
      {pendingDelete && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"><div role="alertdialog" aria-modal="true" aria-label="Confirm deletion" className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setPendingDelete(null)}}}><h3 className="text-lg font-semibold">Delete funding source?</h3><p className="my-4 text-sm">Permanently delete "{pendingDelete.name}"? This cannot be undone.</p><div className="flex justify-end gap-2"><button type="button" autoFocus onClick={()=>setPendingDelete(null)} className="rounded border border-border px-4 py-2">Cancel</button><button type="button" disabled={deleteMutation.isPending} onClick={()=>{if(deleteMutation.isPending)return;const id=pendingDelete.id;setPendingDelete(null);deleteMutation.mutate(id)}} className="rounded bg-status-danger px-4 py-2 text-white disabled:opacity-50">Delete permanently</button></div></div></div>}
    </div>
  );
}
