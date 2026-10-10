import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { Download, FileBarChart, Printer, RefreshCw } from 'lucide-react';
import { getReportsOverview, type ReportCount } from '../api/reports';
import { buildReportsCsv } from '../api/reports-export';
import type { ReadState } from '../api/read-availability';
import ReadAvailabilityNotice from '../components/ReadAvailabilityNotice';

function Chart({title,description,data,state='available'}:{title:string;description:string;data:ReportCount[];state?:ReadState}) {
  const colors=['#6688FF','#42C7A5','#F2B84B','#E879A9','#A78BFA','#F47D5D'];
  const points=data.map(row=>({...row,status:row.status??row.kind??'unknown'}));
  return <section className="bg-surface border border-border rounded-md p-4">
    <h3 className="font-semibold">{title}</h3><p className="text-xs text-text-secondary mt-1 mb-3">{description}</p>
    {state!=='available'&&<p className="text-sm text-status-warning">{state==='partial'?'Partial data — totals are incomplete.':'This section is unavailable on this PC or not permitted.'}</p>}
    {state!=='unavailable'&&(points.length?<ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{top:12,right:12,bottom:8,left:0}}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)"/>
        <XAxis dataKey="status" type="category" tick={{fontSize:11}}/><YAxis dataKey="count" type="number" allowDecimals={false} tick={{fontSize:11}}/>
        <ZAxis range={[144,144]}/><Tooltip cursor={{strokeDasharray:'3 3'}}/>
        <Scatter data={points} name={title}>{points.map((entry,index)=><Cell key={entry.status} fill={colors[index%colors.length]}/>)}</Scatter>
      </ScatterChart>
    </ResponsiveContainer>:<p className="py-10 text-center text-sm text-text-secondary">{state==='available'?'No records in this view.':'No records in the available portion.'}</p>)}
  </section>;
}

function Loading(){return <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-5" aria-busy="true" aria-label="Loading reports"><div className="h-24 bg-surface-raised border border-border rounded-md animate-pulse"/><div className="grid grid-cols-2 md:grid-cols-5 gap-3">{[1,2,3,4,5].map(i=><div key={i} className="h-24 bg-surface border border-border rounded-md animate-pulse"/>)}</div></div>;}

export default function ReportsPage() {
  const reports=useQuery({queryKey:['reports-overview'],queryFn:getReportsOverview});
  if(reports.isLoading)return <Loading/>;
  if(reports.error||!reports.data)return <div className="p-4 md:p-6 max-w-[1400px] mx-auto min-h-full flex items-center justify-center">
    <div className="bg-surface border border-border rounded-md p-6 max-w-md w-full text-center" role="alert">
      <FileBarChart size={24} className="mx-auto text-status-danger"/><h1 className="font-semibold mt-4">Reports unavailable</h1>
      <p className="text-sm text-text-secondary mt-2">Check your session and report permissions. Your underlying data is unchanged.</p>
      <button onClick={()=>reports.refetch()} className="mt-5 inline-flex items-center gap-2 px-3 py-2 bg-accent text-bg rounded-sm text-sm"><RefreshCw size={14}/>Try again</button>
    </div>
  </div>;
  const data=reports.data;
  const state=(key:string):ReadState=>data.availability?.sections[key]??'available';
  const metrics=[['Projects','projects'],['Inventory rows','inventory'],['Tasks','tasks'],['Experiments','experiments'],['Resources','resources']] as const;
  const exportCsv=()=>{
    const url=URL.createObjectURL(new Blob([buildReportsCsv(data)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`labos-report-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
  };
  return <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
    <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
      <div><div className="page-kicker">REPORTING & ANALYTICS</div><h1 className="text-page-title font-ui font-semibold mt-1">Reports & Analytics</h1>
        <p className="text-xs text-text-secondary mt-2">Generated {new Date(data.generated_at).toLocaleString()} · {data.availability?'Local authorized data; may include pending changes':'Server report'}</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={()=>reports.refetch()} disabled={reports.isFetching} aria-label="Refresh reports" className="inline-flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-sm text-sm disabled:opacity-50"><RefreshCw size={15} className={reports.isFetching?'animate-spin':''}/>Refresh</button>
        <button onClick={()=>window.print()} className="inline-flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-sm text-sm"><Printer size={15}/>Print</button>
        <button onClick={exportCsv} className="inline-flex items-center gap-2 px-3 py-2 bg-accent text-bg rounded-sm text-sm"><Download size={15}/>Export CSV</button>
      </div>
    </header>
    <ReadAvailabilityNotice availability={data.availability}/>
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{metrics.map(([label,key])=><div key={key} className="bg-surface border border-border rounded-md p-4">
      <div className="text-xs text-text-secondary">{label}</div><div className="text-2xl font-mono mt-1">{state(key)==='available'?data[key].reduce((n,row)=>n+row.count,0):'—'}</div>
      {state(key)!=='available'&&<div className="text-xs text-status-warning mt-1">{state(key)==='partial'?'Incomplete total':'Unavailable'}</div>}
    </div>)}</div>
    <div className="grid lg:grid-cols-2 gap-5">
      <Chart title="Projects by status" description="Projects visible in this view." data={data.projects} state={state('projects')}/>
      <Chart title="Tasks by status" description="Open and completed work." data={data.tasks} state={state('tasks')}/>
      <Chart title="Experiments by status" description="Experiment records by state." data={data.experiments} state={state('experiments')}/>
      <Chart title="Resources by kind" description="Files, folders and links." data={data.resources} state={state('resources')}/>
    </div>
    <section className="bg-surface border border-border rounded-md p-4">
      <h2 className="font-semibold flex items-center gap-2"><FileBarChart size={17}/>Inventory breakdown</h2>
      <p className="text-xs text-text-secondary mt-1">Inventory rows by type and status{data.availability?', keeping different quantity units separate':''}.</p>
      {state('inventory')==='unavailable'?<p className="py-5 text-status-warning text-sm">Inventory reporting is unavailable; quantity is unknown, not zero.</p>:
        <div className="overflow-x-auto mt-3"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-text-secondary"><th className="py-2">Type</th><th>Status</th><th>Unit</th><th className="text-right">Rows</th><th className="text-right">Quantity</th></tr></thead>
          <tbody>{data.inventory.map(row=><tr key={JSON.stringify([row.type,row.status,row.unit])} className="border-b border-border last:border-0"><td className="py-2 capitalize">{row.type.replace(/_/g,' ')}</td><td className="capitalize text-text-secondary">{row.status.replace(/_/g,' ')}</td><td>{row.unit||'—'}</td><td className="text-right font-mono">{row.count}</td><td className="text-right font-mono">{row.quantity}</td></tr>)}</tbody>
        </table>{!data.inventory.length&&<p className="py-5 text-center text-text-secondary">No inventory records in this view.</p>}</div>}
    </section>
  </div>;
}
