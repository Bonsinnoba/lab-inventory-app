import type {ReadAvailability} from '../api/read-availability';
import { Clock, AlertCircle } from 'lucide-react';

const labels:Record<string,string>={inventory:'Inventory',projects:'Projects',requirements:'Requirements',maintenance:'Maintenance',bom:'Project readiness',tasks:'Tasks',experiments:'Experiments',activity:'Audit activity',notes:'Notes',resources:'Resources',recent:'Recent activity'};

export default function ReadAvailabilityNotice({availability}:{availability?:ReadAvailability}){
  if(!availability)return null;
  const missing=Object.entries(availability.sections).filter(([,state])=>state!=='available');
  return <aside role="status" className="rounded-md border border-border bg-surface-raised/40 p-3 text-xs text-text-secondary space-y-1.5">
    <div className="flex items-center gap-2">
      <Clock size={14} className="text-accent shrink-0" />
      <span title={`Last local read: ${new Date(availability.readAt).toLocaleString()}`}>Local snapshot. May include unsynced changes; server freshness and lab-wide completeness are not verified.</span>
    </div>
    {!!missing.length&&<div className="flex items-start gap-2 pt-1 border-t border-border/60 text-status-warning">
      <AlertCircle size={14} className="shrink-0 mt-0.5" />
      <span>{missing.map(([key,state])=>`${labels[key]||key}: ${state}`).join(' · ')}. Available sections remain visible; unknown totals are shown as —. Reconnect or check access to refresh missing sections.</span>
    </div>}
  </aside>;
}
