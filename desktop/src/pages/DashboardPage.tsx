import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getExperienceDashboard } from '../api/experience';
import { Activity, AlertTriangle, ArrowRight, Box, CalendarClock, CheckCircle2, ClipboardList, FlaskConical, Layers, Package, ShieldAlert } from 'lucide-react';

function HealthBadge({status}:{status:string}){
  const label=status==='healthy'?'Healthy':status==='watch'?'Watch':'Needs attention';
  return <span className={`shrink-0 text-[10px] uppercase tracking-wider px-2 py-1 rounded border ${status==='healthy'?'text-status-ok border-status-ok/30':status==='watch'?'text-status-warning border-status-warning/30':'text-status-danger border-status-danger/30'}`}>{label}</span>;
}

function plural(count:number, singular:string, pluralForm=`${singular}s`){return `${count} ${count===1?singular:pluralForm}`;}

export default function DashboardPage(){
 const {data,isLoading,error}=useQuery({queryKey:['experience','dashboard'],queryFn:getExperienceDashboard,refetchInterval:60000});
 if(isLoading)return <div className="page-frame p-6 text-text-secondary">Loading command center…</div>;
 if(error)return <div className="page-frame p-6 text-status-danger" role="alert">Command center unavailable. Refresh and try again.</div>;
 const m=data?.metrics||{active_projects:0,overdue_tasks:0,due_next_7_days:0,low_stock:0};
 const due=data?.due??[];
 return <div className="page-frame space-y-5">
  <header className="dashboard-hero rounded-lg p-5 md:p-7 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
   <div className="page-header-copy max-w-3xl"><div className="page-kicker">LABORATORY COMMAND CENTER</div><h2 className="page-title text-2xl md:text-3xl mt-1">Today at a glance.</h2><p className="page-subtitle mt-2 max-w-2xl">One operational view of active work, upcoming deadlines, inventory risk and project health.</p></div>
   <div className="page-actions flex gap-2 shrink-0"><Link to="/projects" className="ui-button ui-button-primary ui-button-sm">Projects</Link><Link to="/inventory" className="ui-button ui-button-sm">Inventory</Link></div>
  </header>

  <section aria-label="Lab overview" className="grid grid-cols-2 xl:grid-cols-4 gap-3">
   <Link to="/projects" aria-label={`${m.active_projects} active projects`} className="metric-card ui-panel-raised rounded-md p-4 transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
    <Layers size={17} className="text-accent"/><div className="text-2xl font-mono font-medium mt-2 leading-none">{m.active_projects}</div><div className="text-xs text-text-secondary mt-2">Active projects</div>
   </Link>
   <div className="metric-card ui-panel-raised rounded-md p-4"><AlertTriangle size={17} className={m.overdue_tasks?'text-status-danger':'text-status-ok'}/><div className="text-2xl font-mono font-medium mt-2 leading-none">{m.overdue_tasks}</div><div className="text-xs text-text-secondary mt-2">Overdue tasks</div></div>
   <div className="metric-card ui-panel-raised rounded-md p-4"><CalendarClock size={17} className="text-accent"/><div className="text-2xl font-mono font-medium mt-2 leading-none">{m.due_next_7_days}</div><div className="text-xs text-text-secondary mt-2">Due in 7 days</div></div>
   <Link to="/inventory" aria-label={`${m.low_stock} low-stock items`} className="metric-card ui-panel-raised rounded-md p-4 transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
    <Package size={17} className={m.low_stock?'text-status-warning':'text-status-ok'}/><div className="text-2xl font-mono font-medium mt-2 leading-none">{m.low_stock}</div><div className="text-xs text-text-secondary mt-2">Low-stock items</div>
   </Link>
  </section>

  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
   <section className="workspace-card ui-panel rounded-md p-5" aria-labelledby="project-health-heading">
    <div className="flex items-center justify-between gap-3 mb-4"><h3 id="project-health-heading" className="text-section-header font-semibold">Project health</h3><Link to="/projects" className="text-accent text-xs flex items-center gap-1 shrink-0 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 rounded">All projects <ArrowRight size={13}/></Link></div>
    {!data?.projects.length?<p className="text-sm text-text-secondary py-5">No active projects.</p>:<div className="space-y-2">{data.projects.slice(0,8).map((p:any)=><Link key={p.id} to={`/projects/${p.id}`} className="grid grid-cols-[auto,minmax(0,1fr),auto,auto] items-center gap-3 p-3 rounded border border-border hover:border-accent/60 hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
      <span className="text-accent"><Activity size={16}/></span>
      <span className="min-w-0"><strong className="block text-sm truncate">{p.name}</strong><span className="text-[11px] text-text-secondary block mt-0.5">{plural(p.open_tasks,'open task')} · {plural(p.experiment_count,'experiment')}</span></span>
      <span className="font-mono text-xs tabular-nums whitespace-nowrap">{p.health_score}%</span><HealthBadge status={p.health}/>
     </Link>)}</div>}
   </section>

   <section className="workspace-card ui-panel rounded-md p-5" aria-labelledby="attention-heading">
    <h3 id="attention-heading" className="text-section-header font-semibold mb-4">Attention queue</h3>
    {data?.overdue.length?<div className="space-y-2">{data.overdue.slice(0,6).map((x:any)=><Link key={x.id} to={`/projects/${x.project_id}/tasks`} className="flex gap-3 p-3 rounded border border-status-danger/20 bg-status-danger/5 hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/50"><ShieldAlert size={16} className="text-status-danger mt-0.5 shrink-0"/><span className="min-w-0"><strong className="block text-sm truncate">{x.title}</strong><span className="text-xs text-text-secondary">{x.project_name} · overdue since {x.due_date}</span></span></Link>)}</div>:<div className="py-5 text-sm text-status-ok flex items-center gap-2"><CheckCircle2 size={17} className="shrink-0"/><span>No overdue tasks.</span></div>}
    {due.length>0&&<><div className="border-t border-border my-4"/><h4 className="text-xs uppercase tracking-wider text-text-secondary mb-2">Next 7 days</h4><div className="space-y-0.5">{due.slice(0,5).map((x:any)=><Link key={x.id} to={`/projects/${x.project_id}/tasks`} className="flex items-center gap-2 py-2 px-1 rounded text-sm hover:text-accent hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><ClipboardList size={14} className="shrink-0"/><span className="truncate flex-1">{x.title}</span><span className="font-mono text-[11px] whitespace-nowrap">{x.due_date}</span></Link>)}</div></>}
   </section>

   <section className="workspace-card ui-panel rounded-md p-5" aria-labelledby="stock-heading"><div className="flex items-center justify-between gap-3 mb-4"><h3 id="stock-heading" className="text-section-header font-semibold">Low-stock intelligence</h3><Link to="/inventory" className="text-accent text-xs shrink-0 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 rounded">Open inventory</Link></div>{!data?.low_stock.length?<p className="text-sm text-status-ok flex items-center gap-2"><CheckCircle2 size={15} className="shrink-0"/> Stock levels are above configured minimums.</p>:<div className="space-y-2">{data.low_stock.map((x:any)=><div key={x.id} className="flex items-center gap-3 py-2"><Box size={15} className="text-status-warning shrink-0"/><span className="flex-1 text-sm truncate">{x.name}</span><span className="font-mono text-xs whitespace-nowrap">{x.current_quantity} {x.unit||''}</span></div>)}</div>}</section>

   <section className="workspace-card ui-panel rounded-md p-5" aria-labelledby="activity-heading"><h3 id="activity-heading" className="text-section-header font-semibold mb-4">Recent lab activity</h3>{!data?.recent.length?<p className="text-sm text-text-secondary">No recent activity.</p>:<div className="space-y-2">{data.recent.slice(0,8).map((x:any)=><Link key={`${x.type}-${x.id}`} to={`/projects/${x.project_id}`} className="flex items-center gap-3 py-2 px-1 rounded hover:text-accent hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"><span className="text-accent shrink-0">{x.type==='experiment'?<FlaskConical size={15}/>:<ClipboardList size={15}/>}</span><span className="flex-1 min-w-0"><strong className="block text-sm truncate">{x.title}</strong><span className="text-[10px] text-text-secondary">{x.project_name} · {x.type}</span></span><span className="text-[10px] text-text-secondary whitespace-nowrap">{new Date(x.created_at).toLocaleDateString()}</span></Link>)}</div>}</section>
  </div>
 </div>
}
