import { useQuery } from '@tanstack/react-query';
import { getItemAssignmentHistory, getItemHistory } from '../api/items';
import { History } from 'lucide-react';

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  current_quantity: 'Current Quantity',
  initial_quantity: 'Initial Quantity',
  condition_notes: 'Condition Notes',
  location_id: 'Location',
  next_maintenance_date: 'Next Maintenance Date',
  maintenance_interval_days: 'Maintenance Interval (days)',
  name: 'Name',
  type: 'Type',
  sku: 'SKU',
  category: 'Category',
  unit: 'Unit',
  unit_cost: 'Unit Cost',
  replacement_cost: 'Replacement Cost',
};

export default function ItemHistoryPanel({ itemId }: { itemId: string }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ['itemHistory', itemId],
    queryFn: () => getItemHistory(itemId),
  });
  const { data: assignmentHistory = [] } = useQuery({ queryKey: ['itemAssignmentHistory', itemId], queryFn: () => getItemAssignmentHistory(itemId) });

  if (isLoading) {
    return <div className="text-text-secondary text-sm py-4">Loading history…</div>;
  }

  if ((!history || history.length === 0) && assignmentHistory.length === 0) {
    return (
      <div className="text-text-secondary text-sm py-8 text-center">
        No changes recorded yet — history starts logging from the next edit.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {assignmentHistory.length > 0 && <section><h3 className="text-sm font-semibold mb-2">Assignment history</h3><div className="space-y-2">{assignmentHistory.map((entry) => <div key={entry.id} className="flex items-start gap-3 p-3 bg-surface-raised border border-border rounded-sm"><History size={14} className="text-text-secondary mt-0.5 flex-shrink-0" /><div className="text-sm"><p>{entry.actor_username || 'System'} {entry.action === 'UPDATE' ? 'updated' : entry.action.toLowerCase()} the assignment{entry.old_assignee_username ? ` from ${entry.old_assignee_username}` : ''}{entry.new_assignee_username ? ` to ${entry.new_assignee_username}` : ' to unassigned'}.</p><p className="text-xs text-text-secondary mt-1 font-mono">{new Date(entry.created_at).toLocaleString()}</p></div></div>)}</div></section>}
      {history && history.length > 0 && <section><h3 className="text-sm font-semibold mb-2">Field history</h3><div className="space-y-2">
      {history.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 p-3 bg-surface-raised border border-border rounded-sm">
          <History size={14} className="text-text-secondary mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary">
              <span className="font-medium">{FIELD_LABELS[entry.field_name] || entry.field_name}</span>
              {' changed from '}
              <span className="text-text-secondary">{entry.old_value ?? '(empty)'}</span>
              {' to '}
              <span className="text-status-ok">{entry.new_value ?? '(empty)'}</span>
            </p>
            <p className="text-xs text-text-secondary mt-1 font-mono">
              {new Date(entry.changed_at).toLocaleString()}
            </p>
          </div>
        </div>
      ))}
      </div></section>}
    </div>
  );
}
