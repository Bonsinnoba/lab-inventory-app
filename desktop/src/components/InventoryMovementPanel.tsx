import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, ArrowRightLeft, Wrench, UserCheck, ShieldCheck, CornerDownLeft, Flame, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { createItemMovement, getItemMovements, getItemCustody, getAssigneeDirectory, Item, MovementType, ItemCustodyRecord } from '../api/items';
import { useToast } from '../contexts/ToastContext';
import { formatQuantity } from '../lib/utils';
import { captureAccountSession } from '../api/auth';

interface Props { item: Item; }
const options: { type: MovementType; label: string; icon: typeof ArrowDownToLine }[] = [
  { type: 'receive', label: 'Receive into Storeroom', icon: ArrowDownToLine },
  { type: 'checkout', label: 'Issue / Check Out (Custody)', icon: ArrowUpFromLine },
  { type: 'return', label: 'Direct Return to Storeroom', icon: ArrowDownToLine },
  { type: 'consume', label: 'Direct Storeroom Consumption', icon: ArrowUpFromLine },
  { type: 'adjust', label: 'Adjust Stock', icon: ArrowRightLeft },
  { type: 'damage', label: 'Damage', icon: Wrench },
  { type: 'loss', label: 'Loss', icon: ArrowUpFromLine },
  { type: 'repair_out', label: 'Send to Repair', icon: Wrench },
  { type: 'repair_in', label: 'Return from Repair', icon: Wrench },
  { type: 'transfer', label: 'Transfer Location', icon: ArrowRightLeft },
];

export default function InventoryMovementPanel({ item }: Props) {
  const session = captureAccountSession();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [type, setType] = useState<MovementType>('receive');
  const [quantity, setQuantity] = useState('1');
  const [toLocation, setToLocation] = useState('');
  const [reason, setReason] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [serialNumber, setSerialNumber] = useState('');

  // Settlement state
  const [settlingCustody, setSettlingCustody] = useState<ItemCustodyRecord | null>(null);
  const [settleType, setSettleType] = useState<'return' | 'consume' | 'damage' | 'loss' | 'transfer'>('return');
  const [settleQuantity, setSettleQuantity] = useState('1');
  const [transferRecipientId, setTransferRecipientId] = useState('');
  const [settleNotes, setSettleNotes] = useState('');

  const movementQuery = useQuery({
    queryKey: ['item-movements', item.id, session?.accountId, session?.generation],
    queryFn: () => getItemMovements(item.id),
  });

  const custodyQuery = useQuery({
    queryKey: ['item-custody', item.id, session?.accountId, session?.generation],
    queryFn: () => getItemCustody(item.id),
  });

  const assigneeQuery = useQuery({
    queryKey: ['assignee-directory', session?.accountId, session?.generation],
    queryFn: () => getAssigneeDirectory(),
  });

  const movements = movementQuery.data ?? [];
  const custodyRecords = custodyQuery.data ?? [];
  const assignees = assigneeQuery.data ?? [];
  const activeCustody = custodyRecords.filter(c => Number(c.outstanding_quantity) > 0);

  const mutation = useMutation({
    mutationFn: () => createItemMovement(
      item.id,
      {
        movement_type: type,
        quantity: Number(quantity),
        to_storage_location: type === 'transfer' ? toLocation.trim() : undefined,
        reason: reason || undefined,
        recipient_id: type === 'checkout' && recipientId ? recipientId : undefined,
        serial_number: type === 'checkout' && serialNumber ? serialNumber.trim() : undefined,
      },
      item.sync_version
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item', item.id] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item-movements', item.id] });
      queryClient.invalidateQueries({ queryKey: ['item-custody', item.id] });
      setReason('');
      setQuantity('1');
      setToLocation('');
      setRecipientId('');
      setSerialNumber('');
      showToast('Inventory movement recorded');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to record movement', 'error'),
  });

  const settleMutation = useMutation({
    mutationFn: () => {
      if (!settlingCustody) throw new Error('No custody record selected');
      return createItemMovement(
        item.id,
        {
          movement_type: settleType === 'return' ? 'return' : 'consume',
          quantity: Number(settleQuantity),
          custody_id: settlingCustody.id,
          settlement_type: settleType,
          transfer_recipient_id: settleType === 'transfer' ? transferRecipientId : undefined,
          reason: settleNotes || undefined,
        },
        item.sync_version
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item', item.id] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['item-movements', item.id] });
      queryClient.invalidateQueries({ queryKey: ['item-custody', item.id] });
      setSettlingCustody(null);
      setSettleNotes('');
      setSettleQuantity('1');
      setTransferRecipientId('');
      showToast('Custody settled successfully');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to settle custody', 'error'),
  });

  const getMovementBadgeClass = (mType: MovementType) => {
    if (['receive', 'return', 'repair_in'].includes(mType)) {
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }
    if (['checkout', 'consume', 'damage', 'loss', 'repair_out'].includes(mType)) {
      return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    }
    return 'bg-surface-raised text-text-secondary border-border';
  };

  // Do not expose retained rows or movement actions after an access failure.
  // Transport outages with a valid native snapshot succeed at the API layer.
  if (movementQuery.isError || custodyQuery.isError || assigneeQuery.isError) {
    return <div role="alert" className="p-4 text-sm text-status-error">Inventory movement details are unavailable. Check your access or offline snapshot. <button type="button" className="underline" onClick={() => { void movementQuery.refetch(); void custodyQuery.refetch(); void assigneeQuery.refetch(); }}>Retry</button></div>;
  }
  if (movementQuery.isLoading || custodyQuery.isLoading || assigneeQuery.isLoading) {
    return <div className="p-4 text-sm text-text-secondary">Loading inventory movement details…</div>;
  }

  return (
    <div className="space-y-6">
      {/* 1. Record Physical Stock Movement / Checkout */}
      <div className="bg-surface border border-border rounded-md p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-section-header font-ui font-semibold">Physical Stock Movements & Custody Issues</h3>
            <p className="text-xs text-text-secondary mt-1">
              Storeroom on-hand stock: <span className="font-mono text-text-primary font-medium">{formatQuantity(item.current_quantity)} {item.unit || ''}</span>
              {item.storage_location ? <> · Container: <span className="text-text-primary">{item.storage_location}</span></> : null}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={type} onChange={e => setType(e.target.value as MovementType)} className="bg-bg border border-border rounded-sm px-3 py-2 text-sm">
            {options.map(o => <option key={o.type} value={o.type}>{o.label}</option>)}
          </select>
          <input type="number" min="0.001" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} className="bg-bg border border-border rounded-sm px-3 py-2 text-sm" placeholder="Quantity" />
          {type === 'transfer' ? (
            <input value={toLocation} onChange={e => setToLocation(e.target.value)} className="bg-bg border border-border rounded-sm px-3 py-2 text-sm" placeholder="Destination container..." />
          ) : (
            <input value={reason} onChange={e => setReason(e.target.value)} className="bg-bg border border-border rounded-sm px-3 py-2 text-sm" placeholder={type === 'adjust' ? 'Reason (required)' : 'Reason (optional)'} />
          )}
        </div>

        {type === 'checkout' && (
          <div className="mt-3 p-3 bg-surface-raised border border-border rounded-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
              <UserCheck size={14} className="text-accent" />
              <span>Physical Custody Assignment (Distinct from Administrative Responsibility)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">Physical Recipient (Authorized Assignee)</label>
                <select value={recipientId} onChange={e => setRecipientId(e.target.value)} className="w-full bg-bg border border-border rounded-sm px-3 py-1.5 text-sm">
                  <option value="">Select recipient...</option>
                  {assignees.map(a => (
                    <option key={a.id} value={a.id}>{a.display_name || a.username} ({a.role})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Serial Number / Unit Tag (Optional)</label>
                <input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} placeholder="e.g. SN-49210" className="w-full bg-bg border border-border rounded-sm px-3 py-1.5 text-sm" />
              </div>
            </div>
          </div>
        )}

        {type === 'transfer' && (
          <input value={reason} onChange={e => setReason(e.target.value)} className="mt-3 w-full bg-bg border border-border rounded-sm px-3 py-2 text-sm" placeholder="Reason (optional)" />
        )}

        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !quantity || (type === 'transfer' && !toLocation.trim()) || (type === 'adjust' && !reason.trim())}
          className="mt-4 px-4 py-2 bg-accent text-bg rounded-sm text-sm font-medium disabled:opacity-50"
        >
          {mutation.isPending ? 'Recording...' : 'Record Movement'}
        </button>
        <p className="text-xs text-text-secondary mt-3">
          Physical movements update storeroom stock. Administrative assignment on the item detail does not deduct physical stock.
        </p>
      </div>

      {/* 2. Outstanding Physical Custody Ledger */}
      <div className="bg-surface border border-border rounded-md p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-section-header font-ui font-semibold flex items-center gap-2">
              <ShieldCheck size={18} className="text-accent" />
              <span>Active Physical Custody & Outstanding Balances</span>
            </h3>
            <p className="text-xs text-text-secondary mt-1">
              Items issued to personnel. Consuming or settling issued stock does NOT double-deduct from storeroom.
            </p>
          </div>
          <span className="text-xs font-mono bg-surface-raised px-2 py-1 rounded border border-border">
            {activeCustody.length} active {activeCustody.length === 1 ? 'holder' : 'holders'}
          </span>
        </div>

        {activeCustody.length === 0 ? (
          <p className="text-sm text-text-secondary py-3">No stock is currently checked out to personnel.</p>
        ) : (
          <div className="divide-y divide-border">
            {activeCustody.map(c => (
              <div key={c.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-text-primary">{c.recipient_display_name || c.recipient_username}</span>
                    <span className="text-xs font-mono bg-accent/10 text-accent px-2 py-0.5 rounded">
                      {formatQuantity(c.outstanding_quantity)} / {formatQuantity(c.initial_quantity)} {c.unit || item.unit || ''}
                    </span>
                    {c.serial_number && (
                      <span className="text-xs font-mono bg-surface-raised border border-border px-1.5 py-0.5 rounded text-text-secondary">
                        SN: {c.serial_number}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mt-1">
                    Issued {new Date(c.issued_at).toLocaleDateString()} by {c.issued_by_username || 'Admin'}
                    {c.project_name ? ` · Project: ${c.project_name}` : ''}
                    {c.notes ? ` · Note: ${c.notes}` : ''}
                  </p>
                </div>
                <div>
                  <button
                    onClick={() => {
                      setSettlingCustody(c);
                      setSettleQuantity(String(c.outstanding_quantity));
                      setSettleType('return');
                    }}
                    className="px-3 py-1 bg-surface-raised border border-border hover:border-accent text-xs rounded-sm font-medium text-text-primary"
                  >
                    Settle / Return
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Settlement Modal / Drawer */}
        {settlingCustody && (
          <div className="mt-4 p-4 border border-accent/40 bg-surface-raised rounded-md space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-text-primary">
                Settle Custody for {settlingCustody.recipient_display_name || settlingCustody.recipient_username}
              </h4>
              <button onClick={() => setSettlingCustody(null)} className="text-xs text-text-secondary hover:text-text-primary">Cancel</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">Settlement Action</label>
                <select
                  value={settleType}
                  onChange={e => setSettleType(e.target.value as any)}
                  className="w-full bg-bg border border-border rounded-sm px-2 py-1.5 text-xs"
                >
                  <option value="return">Return to Storeroom (Adds stock)</option>
                  <option value="consume">Consumed in Field/Task (No storeroom re-deduct)</option>
                  <option value="damage">Damaged in Custody</option>
                  <option value="loss">Lost in Custody</option>
                  <option value="transfer">Transfer Custody to Another Person</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Quantity (Max: {settlingCustody.outstanding_quantity})</label>
                <input
                  type="number"
                  min="0.001"
                  max={settlingCustody.outstanding_quantity}
                  step="any"
                  value={settleQuantity}
                  onChange={e => setSettleQuantity(e.target.value)}
                  className="w-full bg-bg border border-border rounded-sm px-2 py-1.5 text-xs"
                />
              </div>
              {settleType === 'transfer' ? (
                <div>
                  <label className="block text-xs text-text-secondary mb-1">Transfer Recipient</label>
                  <select
                    value={transferRecipientId}
                    onChange={e => setTransferRecipientId(e.target.value)}
                    className="w-full bg-bg border border-border rounded-sm px-2 py-1.5 text-xs"
                  >
                    <option value="">Select recipient...</option>
                    {assignees.filter(a => a.id !== settlingCustody.recipient_id).map(a => (
                      <option key={a.id} value={a.id}>{a.display_name || a.username}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-text-secondary mb-1">Reason / Field Notes</label>
                  <input
                    value={settleNotes}
                    onChange={e => setSettleNotes(e.target.value)}
                    placeholder="e.g. Completed experiment 4"
                    className="w-full bg-bg border border-border rounded-sm px-2 py-1.5 text-xs"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-text-secondary">
                {settleType === 'consume' && 'Note: Storeroom stock was already decremented upon issue and will NOT be subtracted again.'}
                {settleType === 'return' && 'Note: Returned quantity will be added back into storeroom on-hand inventory.'}
              </span>
              <button
                onClick={() => settleMutation.mutate()}
                disabled={settleMutation.isPending || !settleQuantity || (settleType === 'transfer' && !transferRecipientId)}
                className="px-4 py-1.5 bg-accent text-bg rounded-sm text-xs font-semibold disabled:opacity-50"
              >
                {settleMutation.isPending ? 'Settling...' : 'Confirm Settlement'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Physical Stock Movement History */}
      <div className="bg-surface border border-border rounded-md overflow-hidden">
        <div className="px-5 py-4 border-b border-border"><h3 className="font-ui font-semibold">Movement History</h3></div>
        {movements.length === 0 ? (
          <p className="p-5 text-sm text-text-secondary">No stock movements recorded yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {movements.map(m => (
              <div key={m.id} className="p-4 flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-surface-raised border border-border flex items-center justify-center text-accent">
                  {m.movement_type === 'transfer' ? <ArrowRightLeft size={15}/> : <Wrench size={15}/>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize text-sm">{m.movement_type.replace('_',' ')}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-mono ${getMovementBadgeClass(m.movement_type)}`}>
                        {['receive', 'return', 'repair_in'].includes(m.movement_type) ? 'Inflow' : ['transfer'].includes(m.movement_type) ? 'Relocation' : 'Outflow'}
                      </span>
                    </div>
                    <span className="font-mono text-sm">{formatQuantity(m.quantity_before)} → {formatQuantity(m.quantity_after)}</span>
                  </div>
                  <p className="text-xs text-text-secondary mt-1">{new Date(m.created_at).toLocaleString()}{m.performed_by_username ? ` · ${m.performed_by_username}` : ''}{m.reason ? ` · ${m.reason}` : ''}</p>
                  {m.movement_type === 'transfer' && <p className="text-xs text-text-secondary mt-1">{m.from_storage_location || 'Unassigned'} → {m.to_storage_location || 'Unassigned'}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
