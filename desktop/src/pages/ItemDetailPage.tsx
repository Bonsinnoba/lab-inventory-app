import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getItem, updateItem, deleteItem, Item } from '../api/items';
import { createTransaction, getTransactions, Transaction } from '../api/transactions';
import { getFundingSources, FundingSource } from '../api/funding-sources';
import StatusLED from '../components/StatusLED';
import ItemPicture from '../components/ItemPicture';
import ItemHistoryPanel from '../components/ItemHistoryPanel';
import ItemQrCode from '../components/ItemQrCode';
import InventoryMovementPanel from '../components/InventoryMovementPanel';
import MaintenancePanel from '../components/MaintenancePanel';
import Tabs from '../components/Tabs';
import { SkeletonCard } from '../components/Skeleton';
import { ArrowLeft, Edit, Trash2, Plus, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { formatQuantity } from '../lib/utils';
import { getManagedUsers } from '../api/users';
import { getStoredUser } from '../api/auth';

export default function ItemDetailPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const location = useLocation();
  const queryClient = useQueryClient();
  const currentUser = getStoredUser();

  const { data: item, isLoading, error } = useQuery<Item>({ queryKey: ['item', itemId], queryFn: () => getItem(itemId!), enabled: !!itemId });
  const { data: transactions } = useQuery<Transaction[]>({ queryKey: ['transactions', 'item', itemId], queryFn: () => getTransactions({ item_id: itemId }), enabled: !!itemId });
  const { data: fundingSources } = useQuery<FundingSource[]>({ queryKey: ['fundingSources'], queryFn: getFundingSources });
  const { data: managedUsers = [] } = useQuery({ queryKey: ['managed-users'], queryFn: getManagedUsers, enabled: currentUser?.role === 'admin' });

  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Item>>({});
  const [transactionForm, setTransactionForm] = useState({ type: 'purchase' as Transaction['type'], direction: 'expense' as Transaction['direction'], amount: '', vendor: '', notes: '', funding_source_id: '' });

  const transactionMutation = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions', 'item', itemId] });
      setShowTransactionForm(false);
      setTransactionForm({ type: 'purchase', direction: 'expense', amount: '', vendor: '', notes: '', funding_source_id: '' });
      showToast('Transaction logged');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to log transaction', 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Item>) => updateItem(itemId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item', itemId] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setIsEditing(false);
      showToast('Item updated');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to update item', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteItem(itemId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['items'] }); showToast('Item deleted'); navigate('/inventory'); },
    onError: (err: any) => showToast(err?.message || 'Failed to delete item', 'error'),
  });

  const handleEdit = () => {
    if (!item) return;
    setEditForm({
      name: item.name, type: item.type, status: item.status, initial_quantity: item.initial_quantity,
      unit: item.unit, sku: item.sku, category: item.category, dimensions: item.dimensions,
      storage_location: item.storage_location ?? '', unit_cost: item.unit_cost, replacement_cost: item.replacement_cost,
      condition_notes: item.condition_notes, next_maintenance_date: item.next_maintenance_date,
      maintenance_interval_days: item.maintenance_interval_days, manufacturer: item.manufacturer,
      model_number: item.model_number, serial_number: item.serial_number, asset_tag: item.asset_tag,
      calibration_interval_days: item.calibration_interval_days, next_calibration_date: item.next_calibration_date,
      assigned_to: item.assigned_to, supplier: item.supplier, part_number: item.part_number,
    });
    setIsEditing(true);
  };

  const handleDelete = () => { if (window.confirm(`Delete "${item?.name}"? This can't be undone.`)) deleteMutation.mutate(); };
  const handleTransactionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    transactionMutation.mutate({ ...transactionForm, amount: parseFloat(transactionForm.amount), item_id: itemId, funding_source_id: transactionForm.funding_source_id || undefined, date: new Date().toISOString().split('T')[0] });
  };

  if (isLoading) return <div className="p-6 max-w-2xl"><SkeletonCard /></div>;
  if (error) return <div className="p-6 text-status-danger">Error loading item</div>;
  if (!item) return <div className="p-6">Item not found</div>;

  const tabs = [
    { id: 'details', label: 'Details', path: `/inventory/${itemId}` },
    { id: 'transactions', label: 'Transactions', path: `/inventory/${itemId}/transactions` },
    { id: 'history', label: 'History', path: `/inventory/${itemId}/history` },
    { id: 'movements', label: 'Movements', path: `/inventory/${itemId}/movements` },
    { id: 'maintenance', label: 'Maintenance', path: `/inventory/${itemId}/maintenance` },
  ];
  const activeTab = location.pathname.endsWith('/transactions') ? 'transactions' : location.pathname.endsWith('/history') ? 'history' : location.pathname.endsWith('/movements') ? 'movements' : location.pathname.endsWith('/maintenance') ? 'maintenance' : 'details';

  return <div className="flex flex-col h-full">
    <div className="flex items-center gap-4 px-6 pt-6 pb-2 flex-shrink-0">
      <button onClick={() => navigate('/inventory')} className="p-2 hover:bg-surface-raised rounded-sm transition-colors" aria-label="Back to inventory"><ArrowLeft size={20} /></button>
      <h2 className="text-page-title font-ui font-semibold">{item.name}</h2>
      <div className="flex gap-2 ml-auto">
        <button onClick={isEditing ? () => updateMutation.mutate(editForm) : handleEdit} disabled={updateMutation.isPending} className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-sm hover:bg-surface-raised transition-colors text-sm"><Edit size={16} />{isEditing ? (updateMutation.isPending ? 'Saving...' : 'Save') : 'Edit'}</button>
        {isEditing && <button onClick={() => setIsEditing(false)} className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-sm hover:bg-surface-raised transition-colors text-sm">Cancel</button>}
        <button onClick={handleDelete} disabled={deleteMutation.isPending} className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-sm hover:bg-status-danger hover:border-status-danger hover:text-bg transition-colors text-sm text-status-danger disabled:opacity-50"><Trash2 size={16} />{deleteMutation.isPending ? 'Deleting...' : 'Delete'}</button>
      </div>
    </div>

    <Tabs tabs={tabs} activePath={location.pathname} />

    <div className="flex-1 overflow-auto p-6 max-w-[1400px] mx-auto w-full">
      {activeTab === 'details' && <div className="bg-surface border border-border rounded-md p-6 max-w-2xl">
        <h3 className="text-section-header font-ui font-semibold mb-4">Details</h3>
        <ItemPicture itemId={itemId!} imageResourceId={item.image_resource_id} />
        <div className="space-y-4">
          <div><label className="block text-text-secondary text-sm mb-1">Status</label>{isEditing ? <select value={editForm.status || item.status} onChange={e => setEditForm({ ...editForm, status: e.target.value as Item['status'] })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"><option value="available">Available</option><option value="in_use">In Use</option><option value="damaged">Damaged</option><option value="needs_repair">Needs Repair</option><option value="needs_replacement">Needs Replacement</option><option value="low_stock">Low Stock</option><option value="retired">Retired</option></select> : <StatusLED status={item.status} />}</div>
          <div><label className="block text-text-secondary text-sm mb-1">Type</label>{isEditing ? <select value={editForm.type || item.type} onChange={e => setEditForm({ ...editForm, type: e.target.value })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"><option value="tool">Tool</option><option value="component">Component</option><option value="equipment">Equipment</option><option value="material">Material</option><option value="chemical">Chemical</option><option value="consumable">Consumable</option><option value="instrument">Instrument</option><option value="spare_part">Spare Part</option></select> : <p className="text-text-primary capitalize">{item.type}</p>}</div>
          <div><label className="block text-text-secondary text-sm mb-1">SKU</label>{isEditing ? <input type="text" value={editForm.sku || item.sku || ''} onChange={e => setEditForm({ ...editForm, sku: e.target.value })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /> : <p className="text-text-primary font-mono">{item.sku || 'N/A'}</p>}</div>

          {(item.type === 'equipment' || isEditing || item.manufacturer || item.model_number || item.serial_number || item.asset_tag) && <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">{(['manufacturer', 'model_number', 'serial_number', 'asset_tag'] as const).map(field => <div key={field}><label className="block text-text-secondary text-sm mb-1">{field.replace('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())}</label>{isEditing ? <input value={String(editForm[field] ?? item[field] ?? '')} onChange={e => setEditForm({ ...editForm, [field]: e.target.value || null })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /> : <p className="text-text-primary">{item[field] || 'Not set'}</p>}</div>)}</div>}

          {(isEditing || item.supplier || item.part_number) && <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border"><div><label className="block text-text-secondary text-sm mb-1">Supplier</label>{isEditing ? <input value={editForm.supplier ?? item.supplier ?? ''} onChange={e => setEditForm({ ...editForm, supplier: e.target.value || null })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /> : <p className="text-text-primary">{item.supplier}</p>}</div><div><label className="block text-text-secondary text-sm mb-1">Part Number</label>{isEditing ? <input value={editForm.part_number ?? item.part_number ?? ''} onChange={e => setEditForm({ ...editForm, part_number: e.target.value || null })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /> : <p className="text-text-primary">{item.part_number}</p>}</div></div>}

          <div className="grid grid-cols-2 gap-4"><div><label className="block text-text-secondary text-sm mb-1">Current Quantity</label><p className="text-text-primary font-mono">{formatQuantity(item.current_quantity)} {item.unit || ''}</p><p className="text-xs text-text-secondary mt-1">Use Movements to change stock so every adjustment is recorded.</p></div><div><label className="block text-text-secondary text-sm mb-1">Initial Quantity</label>{isEditing ? <input type="number" value={editForm.initial_quantity ?? item.initial_quantity} onChange={e => setEditForm({ ...editForm, initial_quantity: parseInt(e.target.value) || 0 })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /> : <p className="text-text-primary font-mono">{formatQuantity(item.initial_quantity)} {item.unit || ''}</p>}</div></div>

          <div><label className="block text-text-secondary text-sm mb-1">Unit</label>{isEditing ? <input type="text" value={editForm.unit || item.unit || ''} onChange={e => setEditForm({ ...editForm, unit: e.target.value })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /> : <p className="text-text-primary">{item.unit || ''}</p>}</div>

          <div><label className="block text-text-secondary text-sm mb-1">Location</label>{isEditing ? <><input type="text" value={editForm.storage_location ?? item.storage_location ?? ''} onChange={e => setEditForm({ ...editForm, storage_location: e.target.value })} placeholder="e.g. Toolbox A, Components Cabinet, Drawer 3" className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /><p className="text-xs text-text-secondary mt-1">Use your real storage container name. No predefined locations, bins, or racks are required.</p></> : <p className="text-text-primary">{item.storage_location || 'No location'}</p>}</div>

          <div><label className="block text-text-secondary text-sm mb-1">Assigned To</label>{isEditing && currentUser?.role === 'admin' ? <select value={editForm.assigned_to || item.assigned_to || ''} onChange={e => setEditForm({ ...editForm, assigned_to: e.target.value || null })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"><option value="">Unassigned</option>{managedUsers.filter(user => user.is_active).map(user => <option key={user.id} value={user.id}>{user.username}</option>)}</select> : <p className="text-text-primary">{item.assigned_to_username || 'Unassigned'}</p>}</div>

          {(item.condition_notes || isEditing) && <div><label className="block text-text-secondary text-sm mb-1">Condition Notes</label>{isEditing ? <textarea value={editForm.condition_notes ?? item.condition_notes ?? ''} onChange={e => setEditForm({ ...editForm, condition_notes: e.target.value })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" rows={2} /> : <p className="text-text-primary">{item.condition_notes}</p>}</div>}

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
            <div><label className="block text-text-secondary text-sm mb-1">Next Maintenance Date</label>{isEditing ? <input type="date" value={(editForm.next_maintenance_date ?? item.next_maintenance_date ?? '').toString().split('T')[0]} onChange={e => setEditForm({ ...editForm, next_maintenance_date: e.target.value || null })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /> : <p className={`text-sm ${item.next_maintenance_date && new Date(item.next_maintenance_date) < new Date() ? 'text-status-danger' : 'text-text-primary'}`}>{item.next_maintenance_date ? new Date(item.next_maintenance_date).toLocaleDateString() : 'Not scheduled'}</p>}</div>
            <div><label className="block text-text-secondary text-sm mb-1">Maintenance Interval (days)</label>{isEditing ? <input type="number" value={editForm.maintenance_interval_days ?? item.maintenance_interval_days ?? ''} onChange={e => setEditForm({ ...editForm, maintenance_interval_days: e.target.value ? parseInt(e.target.value) : null })} placeholder="e.g. 90" className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /> : <p className="text-text-primary text-sm">{item.maintenance_interval_days ? `Every ${item.maintenance_interval_days} days` : 'Not set'}</p>}</div>
            <div><label className="block text-text-secondary text-sm mb-1">Next Calibration Date</label>{isEditing ? <input type="date" value={(editForm.next_calibration_date ?? item.next_calibration_date ?? '').toString().split('T')[0]} onChange={e => setEditForm({ ...editForm, next_calibration_date: e.target.value || null })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /> : <p className={`text-sm ${item.next_calibration_date && new Date(item.next_calibration_date) < new Date() ? 'text-status-danger' : 'text-text-primary'}`}>{item.next_calibration_date ? new Date(item.next_calibration_date).toLocaleDateString() : 'Not scheduled'}</p>}</div>
            <div><label className="block text-text-secondary text-sm mb-1">Calibration Interval (days)</label>{isEditing ? <input type="number" min="1" value={editForm.calibration_interval_days ?? item.calibration_interval_days ?? ''} onChange={e => setEditForm({ ...editForm, calibration_interval_days: e.target.value ? parseInt(e.target.value, 10) : null })} placeholder="e.g. 365" className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /> : <p className="text-text-primary text-sm">{item.calibration_interval_days ? `Every ${item.calibration_interval_days} days` : 'Not set'}</p>}</div>
          </div>

          {!isEditing && item.next_maintenance_date && item.maintenance_interval_days && <button onClick={() => { const next = new Date(); next.setDate(next.getDate() + item.maintenance_interval_days!); updateMutation.mutate({ next_maintenance_date: next.toISOString().split('T')[0] }); }} disabled={updateMutation.isPending} className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-sm disabled:opacity-50"><Wrench size={14} />Mark Maintenance Done</button>}
          {!isEditing && item.sku && <div className="pt-3 border-t border-border"><ItemQrCode sku={item.sku} itemName={item.name} /></div>}
        </div>
      </div>}

      {activeTab === 'movements' && <InventoryMovementPanel item={item} />}
      {activeTab === 'maintenance' && <MaintenancePanel item={item} />}
      {activeTab === 'transactions' && <div className="bg-surface border border-border rounded-md p-6">
        <div className="flex items-center justify-between mb-4"><h3 className="text-section-header font-ui font-semibold">Transaction History</h3><button onClick={() => setShowTransactionForm(!showTransactionForm)} className="flex items-center gap-2 px-3 py-1.5 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm"><Plus size={16} />Log Transaction</button></div>
        {showTransactionForm && <form onSubmit={handleTransactionSubmit} className="space-y-4 mb-4 p-4 bg-surface-raised border border-border rounded-sm">
          <div className="grid grid-cols-2 gap-4"><div><label className="block text-text-secondary text-sm mb-1">Direction</label><select value={transactionForm.direction} onChange={e => setTransactionForm({ ...transactionForm, direction: e.target.value as 'income' | 'expense' })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"><option value="expense">Expense</option><option value="income">Income</option></select></div><div><label className="block text-text-secondary text-sm mb-1">Type</label><select value={transactionForm.type} onChange={e => setTransactionForm({ ...transactionForm, type: e.target.value as Transaction['type'] })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent">{transactionForm.direction === 'expense' ? <><option value="purchase">Purchase</option><option value="repair">Repair</option><option value="replacement">Replacement</option><option value="project_expense">Project Expense</option><option value="other">Other</option></> : <><option value="donation">Donation</option><option value="investment">Investment</option><option value="grant">Grant</option><option value="lab_allocation">Lab Allocation</option><option value="other_income">Other Income</option></>}</select></div></div>
          <div><label className="block text-text-secondary text-sm mb-1">Amount</label><input type="number" step="0.01" value={transactionForm.amount} onChange={e => setTransactionForm({ ...transactionForm, amount: e.target.value })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" required /></div>
          <div><label className="block text-text-secondary text-sm mb-1">Vendor (optional)</label><input type="text" value={transactionForm.vendor} onChange={e => setTransactionForm({ ...transactionForm, vendor: e.target.value })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /></div>
          {transactionForm.direction === 'income' && ['donation', 'investment', 'grant'].includes(transactionForm.type) && <div><label className="block text-text-secondary text-sm mb-1">Funding Source (required)</label><select value={transactionForm.funding_source_id} onChange={e => setTransactionForm({ ...transactionForm, funding_source_id: e.target.value })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" required><option value="">Select funding source...</option>{fundingSources?.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div>}
          <div><label className="block text-text-secondary text-sm mb-1">Notes (optional)</label><textarea value={transactionForm.notes} onChange={e => setTransactionForm({ ...transactionForm, notes: e.target.value })} className="w-full bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" rows={2} /></div>
          <div className="flex gap-2"><button type="submit" disabled={transactionMutation.isPending} className="flex-1 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm font-medium disabled:opacity-50">{transactionMutation.isPending ? 'Saving...' : 'Save Transaction'}</button><button type="button" onClick={() => setShowTransactionForm(false)} className="px-4 py-2 bg-surface border border-border rounded-sm hover:bg-surface-raised transition-colors text-sm">Cancel</button></div>
        </form>}
        {transactions && transactions.length > 0 ? <div className="space-y-2">{transactions.map(tx => <div key={tx.id} className="p-3 bg-surface-raised border border-border rounded-sm"><div className="flex justify-between"><span className="text-text-primary capitalize">{tx.type.replace('_', ' ')}</span><span className={`font-mono ${tx.direction === 'income' ? 'text-status-ok' : 'text-text-primary'}`}>{tx.direction === 'income' ? '+' : '-'}${parseFloat(String(tx.amount)).toFixed(2)}</span></div><div className="text-xs text-text-secondary mt-1">{new Date(tx.date).toLocaleDateString()}{tx.vendor ? ` · ${tx.vendor}` : ''}</div></div>)}</div> : <p className="text-text-secondary text-sm">No transactions yet.</p>}
      </div>}

      {activeTab === 'history' && <div className="bg-surface border border-border rounded-md p-6"><h3 className="text-section-header font-ui font-semibold mb-4">Change History</h3><ItemHistoryPanel itemId={itemId!} /></div>}
    </div>
  </div>;
}
