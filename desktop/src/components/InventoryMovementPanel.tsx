import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, Wrench } from 'lucide-react';
import { useState } from 'react';
import { createItemMovement, getItemMovements, Item, MovementType } from '../api/items';
import { useToast } from '../contexts/ToastContext';
import { formatQuantity } from '../lib/utils';

interface Props { item: Item; }
const options: { type: MovementType; label: string; icon: typeof ArrowDownToLine }[] = [
  { type: 'receive', label: 'Receive', icon: ArrowDownToLine }, { type: 'checkout', label: 'Check Out', icon: ArrowUpFromLine },
  { type: 'return', label: 'Return', icon: ArrowDownToLine }, { type: 'consume', label: 'Consume', icon: ArrowUpFromLine },
  { type: 'adjust', label: 'Adjust', icon: ArrowRightLeft },
  { type: 'damage', label: 'Damage', icon: Wrench }, { type: 'loss', label: 'Loss', icon: ArrowUpFromLine },
  { type: 'repair_out', label: 'Send to Repair', icon: Wrench }, { type: 'repair_in', label: 'Return from Repair', icon: Wrench },
  { type: 'transfer', label: 'Transfer Location', icon: ArrowRightLeft },
];

export default function InventoryMovementPanel({ item }: Props) {
  const queryClient = useQueryClient(); const { showToast } = useToast();
  const [type, setType] = useState<MovementType>('receive'); const [quantity, setQuantity] = useState('1');
  const [toLocation, setToLocation] = useState(''); const [reason, setReason] = useState('');
  const { data: movements = [] } = useQuery({ queryKey: ['item-movements', item.id], queryFn: () => getItemMovements(item.id) });
  const mutation = useMutation({
    mutationFn: () => createItemMovement(item.id, { movement_type: type, quantity: Number(quantity), to_storage_location: type === 'transfer' ? toLocation.trim() : undefined, reason: reason || undefined }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['item', item.id] }); queryClient.invalidateQueries({ queryKey: ['items'] }); queryClient.invalidateQueries({ queryKey: ['item-movements', item.id] }); setReason(''); setQuantity('1'); setToLocation(''); showToast('Inventory movement recorded'); },
    onError: (err: any) => showToast(err?.message || 'Failed to record movement', 'error'),
  });
  return <div className="space-y-5">
    <div className="bg-surface border border-border rounded-md p-5">
      <div className="flex items-center justify-between mb-4"><div><h3 className="text-section-header font-ui font-semibold">Stock Movement</h3><p className="text-xs text-text-secondary mt-1">Current quantity: <span className="font-mono text-text-primary">{formatQuantity(item.current_quantity)} {item.unit || ''}</span>{item.storage_location ? <> · Location: <span className="text-text-primary">{item.storage_location}</span></> : null}</p></div></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <select value={type} onChange={e => setType(e.target.value as MovementType)} className="bg-bg border border-border rounded-sm px-3 py-2 text-sm">{options.map(o => <option key={o.type} value={o.type}>{o.label}</option>)}</select>
        <input type="number" min="0.001" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} className="bg-bg border border-border rounded-sm px-3 py-2 text-sm" placeholder="Quantity" />
        {type === 'transfer' ? <input value={toLocation} onChange={e => setToLocation(e.target.value)} className="bg-bg border border-border rounded-sm px-3 py-2 text-sm" placeholder="Destination container..." /> : <input value={reason} onChange={e => setReason(e.target.value)} className="bg-bg border border-border rounded-sm px-3 py-2 text-sm" placeholder={type === 'adjust' ? 'Reason (required)' : 'Reason (optional)'} />}
      </div>
      {type === 'transfer' && <input value={reason} onChange={e => setReason(e.target.value)} className="mt-3 w-full bg-bg border border-border rounded-sm px-3 py-2 text-sm" placeholder="Reason (optional)" />}
      <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !quantity || (type === 'transfer' && !toLocation.trim()) || (type === 'adjust' && !reason.trim())} className="mt-4 px-4 py-2 bg-accent text-bg rounded-sm text-sm font-medium disabled:opacity-50">{mutation.isPending ? 'Recording...' : 'Record Movement'}</button>
      <p className="text-xs text-text-secondary mt-3">An item has one primary storage container. A transfer changes that free-form container label; partial quantities do not create separate per-location stock.</p>
    </div>
    <div className="bg-surface border border-border rounded-md overflow-hidden">
      <div className="px-5 py-4 border-b border-border"><h3 className="font-ui font-semibold">Movement History</h3></div>
      {movements.length === 0 ? <p className="p-5 text-sm text-text-secondary">No stock movements recorded yet.</p> : <div className="divide-y divide-border">{movements.map(m => <div key={m.id} className="p-4 flex items-start gap-4"><div className="w-8 h-8 rounded-full bg-surface-raised border border-border flex items-center justify-center text-accent">{m.movement_type === 'transfer' ? <ArrowRightLeft size={15}/> : <Wrench size={15}/>}</div><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><span className="font-medium capitalize">{m.movement_type.replace('_',' ')}</span><span className="font-mono text-sm">{formatQuantity(m.quantity_before)} → {formatQuantity(m.quantity_after)}</span></div><p className="text-xs text-text-secondary mt-1">{new Date(m.created_at).toLocaleString()}{m.performed_by_username ? ` · ${m.performed_by_username}` : ''}{m.reason ? ` · ${m.reason}` : ''}</p>{m.movement_type === 'transfer' && <p className="text-xs text-text-secondary mt-1">{m.from_storage_location || 'Unassigned'} → {m.to_storage_location || 'Unassigned'}</p>}</div></div>)}</div>}
    </div>
  </div>;
}
