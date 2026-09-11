import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getItems, Item } from '../api/items';
import { AlertTriangle, ChevronDown, ChevronUp, X, Wrench } from 'lucide-react';

const ATTENTION_STATUSES: Item['status'][] = ['damaged', 'needs_repair', 'needs_replacement', 'low_stock'];

const STATUS_LABELS: Record<string, string> = {
  damaged: 'Damaged',
  needs_repair: 'Needs Repair',
  needs_replacement: 'Needs Replacement',
  low_stock: 'Low Stock',
};

const STATUS_COLOR_VAR: Record<string, string> = {
  damaged: 'var(--color-status-danger)',
  needs_repair: 'var(--color-status-warn)',
  needs_replacement: 'var(--color-status-danger)',
  low_stock: 'var(--color-status-warn)',
};

// Items with maintenance due within this many days (or already overdue)
// show up alongside status-based attention items.
const MAINTENANCE_LOOKAHEAD_DAYS = 7;

type AttentionEntry =
  | { kind: 'status'; item: Item; status: Item['status'] }
  | { kind: 'maintenance' | 'calibration'; item: Item; overdue: boolean };

export default function NeedsAttentionBanner() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ['items'],
    queryFn: () => getItems(),
  });

  const now = new Date();
  const lookahead = new Date();
  lookahead.setDate(now.getDate() + MAINTENANCE_LOOKAHEAD_DAYS);

  const statusEntries: AttentionEntry[] = items
    .filter((item) => ATTENTION_STATUSES.includes(item.status))
    .map((item) => ({ kind: 'status', item, status: item.status }));

  const maintenanceEntries: AttentionEntry[] = items
    .filter((item) => item.next_maintenance_date && new Date(item.next_maintenance_date) <= lookahead)
    .map((item) => ({
      kind: 'maintenance',
      item,
      overdue: new Date(item.next_maintenance_date!) < now,
    }));
  const calibrationEntries: AttentionEntry[] = items
    .filter((item) => item.next_calibration_date && new Date(item.next_calibration_date) <= lookahead)
    .map((item) => ({ kind: 'calibration', item, overdue: new Date(item.next_calibration_date!) < now }));

  const allEntries = [...statusEntries, ...maintenanceEntries, ...calibrationEntries];

  if (dismissed || allEntries.length === 0) return null;

  const countByStatus = ATTENTION_STATUSES.reduce((acc, status) => {
    const count = statusEntries.filter((e) => e.kind === 'status' && e.status === status).length;
    if (count > 0) acc[status] = count;
    return acc;
  }, {} as Record<string, number>);

  const overdueMaintenanceCount = maintenanceEntries.filter((e) => e.kind === 'maintenance' && e.overdue).length;
  const upcomingMaintenanceCount = maintenanceEntries.length - overdueMaintenanceCount;
  const overdueCalibrationCount = calibrationEntries.filter((entry) => entry.kind === 'calibration' && entry.overdue).length;
  const upcomingCalibrationCount = calibrationEntries.length - overdueCalibrationCount;

  return (
    <div className="mb-6 bg-surface border border-status-warn/30 rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 flex-1 text-left flex-wrap"
        >
          <AlertTriangle size={18} className="text-status-warn flex-shrink-0" />
          <span className="text-text-primary font-medium">
            {allEntries.length} item{allEntries.length !== 1 ? 's' : ''} need{allEntries.length === 1 ? 's' : ''} attention
          </span>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(countByStatus).map(([status, count]) => (
              <span
                key={status}
                className="text-xs px-2 py-0.5 rounded-sm border"
                style={{ color: STATUS_COLOR_VAR[status], borderColor: `${STATUS_COLOR_VAR[status]}4d` }}
              >
                {count} {STATUS_LABELS[status]}
              </span>
            ))}
            {overdueMaintenanceCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-sm border" style={{ color: 'var(--color-status-danger)', borderColor: 'var(--color-status-danger)4d' }}>
                {overdueMaintenanceCount} Maintenance Overdue
              </span>
            )}
            {upcomingMaintenanceCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-sm border" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-accent)4d' }}>
                {upcomingMaintenanceCount} Maintenance Due Soon
              </span>
            )}
            {overdueCalibrationCount > 0 && <span className="text-xs px-2 py-0.5 rounded-sm border" style={{ color: 'var(--color-status-danger)', borderColor: 'var(--color-status-danger)4d' }}>{overdueCalibrationCount} Calibration Overdue</span>}
            {upcomingCalibrationCount > 0 && <span className="text-xs px-2 py-0.5 rounded-sm border" style={{ color: 'var(--color-accent)', borderColor: 'var(--color-accent)4d' }}>{upcomingCalibrationCount} Calibration Due Soon</span>}
          </div>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setExpanded(!expanded)} className="p-1.5 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button onClick={() => setDismissed(true)} className="p-1.5 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary" title="Dismiss for this session">
            <X size={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {allEntries.map((entry, i) => (
            <button
              key={`${entry.kind}-${entry.item.id}-${i}`}
              onClick={() => navigate(`/inventory/${entry.item.id}`)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-surface-raised transition-colors"
            >
              <span className="text-sm text-text-primary flex items-center gap-2">
                {(entry.kind === 'maintenance' || entry.kind === 'calibration') && <Wrench size={12} className="text-text-secondary" />}
                {entry.item.name}
              </span>
              {entry.kind === 'status' ? (
                <span className="text-xs px-2 py-0.5 rounded-sm" style={{ color: STATUS_COLOR_VAR[entry.status] }}>
                  {STATUS_LABELS[entry.status]}
                </span>
              ) : (
                <span
                  className="text-xs px-2 py-0.5 rounded-sm"
                  style={{ color: entry.overdue ? 'var(--color-status-danger)' : 'var(--color-accent)' }}
                >
                  {entry.kind === 'calibration' ? 'Calibration' : 'Maintenance'} {entry.overdue ? 'overdue' : 'due soon'} — {new Date((entry.kind === 'calibration' ? entry.item.next_calibration_date : entry.item.next_maintenance_date)!).toLocaleDateString()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
