import {useQuery} from '@tanstack/react-query';
import {getProjectContext} from '../api/context';
export default function ProjectContextPanel({projectId}:{projectId:string}){
 const context=useQuery({queryKey:['project-context',projectId],queryFn:()=>getProjectContext(projectId),staleTime:30000,retry:1});
 const c=context.data;
 return <section aria-label="Project context" className="border border-border rounded-md bg-surface p-4 my-4">
  <h3 className="font-semibold">Project context</h3>
  <p className="text-xs text-text-secondary mt-1">Live central context · Access-controlled · Read-only</p>
  {context.isLoading&&<p className="text-sm mt-2">Loading linked project records…</p>}
  {context.isError&&<p role="alert" className="text-sm text-status-warning mt-2">Central context unavailable. Offline project records remain accessible elsewhere; this panel does not use stale central data.</p>}
  {c&&<div className="mt-3">
   <p className="text-sm">{c.project.name} · {c.project.status}</p>
   <p className="text-xs text-text-secondary">Snapshot: {new Date(c.generated_at).toLocaleString()}</p>
   <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
    {Object.entries(c.sections).map(([name,rows])=><div key={name} className="border border-border rounded-sm p-2"><strong className="capitalize text-sm">{name.replace('_',' ')}</strong><p className="text-lg">{rows.length}{c.provenance.truncated[name]?'+':''}</p></div>)}
   </div>
   <details className="mt-3"><summary className="cursor-pointer text-sm">Linked evidence and resource allocations</summary>
    <ul className="mt-2 space-y-1 text-sm">
     {c.sections.reservations.map(r=><li key={r.id}>{r.item_name}: {r.quantity} ({r.status})</li>)}
     {c.sections.notes.map(n=><li key={n.id}>Note: {n.title}</li>)}
     {c.sections.resources.map(r=><li key={r.id}>Resource: {r.name}</li>)}
    </ul>
   </details>
  </div>}
 </section>;
}
