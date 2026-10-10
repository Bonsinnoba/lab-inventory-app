import type {ReadAvailability} from '../api/read-availability';
const labels:Record<string,string>={inventory:'Inventory',projects:'Projects',requirements:'Requirements',maintenance:'Maintenance',bom:'Project readiness',tasks:'Tasks',experiments:'Experiments',activity:'Audit activity',notes:'Notes',resources:'Resources',recent:'Recent activity'};
export default function ReadAvailabilityNotice({availability}:{availability?:ReadAvailability}){
  if(!availability)return null;
  const missing=Object.entries(availability.sections).filter(([,state])=>state!=='available');
  return <aside role="status" className="rounded-md border border-border bg-surface-raised/50 p-3 text-xs text-text-secondary">
    <p>Local snapshot · read at {new Date(availability.readAt).toLocaleTimeString()}. May include unsynced changes; server freshness and lab-wide completeness are not verified.</p>
    {!!missing.length&&<p className="mt-1 text-status-warning">{missing.map(([key,state])=>`${labels[key]||key}: ${state}`).join(' · ')}. Available sections remain visible; unknown totals are shown as —. Reconnect or check access to refresh missing sections.</p>}
  </aside>;
}
