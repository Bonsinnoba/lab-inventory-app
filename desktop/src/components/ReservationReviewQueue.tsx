import { useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { decideProjectReservation,getReservationReviewQueue } from '../api/projects';
import { getStoredUser } from '../api/auth';

export default function ReservationReviewQueue(){
 const admin=getStoredUser()?.role==='admin';
 const qc=useQueryClient();
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [error,setError]=useState('');
 const queue=useQuery({queryKey:['reservation-review-queue'],queryFn:getReservationReviewQueue,enabled:admin});
 const decision=useMutation({
  mutationFn:({projectId,id,choice}:{projectId:string;id:string;choice:'confirm'|'reject'})=>decideProjectReservation(projectId,id,choice,notes[id]||''),
  onSuccess:()=>{setError('');qc.invalidateQueries({queryKey:['reservation-review-queue']});qc.invalidateQueries({queryKey:['project-reservations']});},
  onError:(e:Error)=>setError(e.message)
 });
 if(!admin)return null;
 return <section className="bg-surface border border-border rounded-md p-4 mb-5" aria-label="Lab reservation review queue">
  <h2 className="text-base font-semibold">Laboratory reservation review</h2>
  <p className="text-xs text-text-secondary mt-1">Compare project priority, required dates and competing confirmed allocations before deciding. Confirmation never deducts physical stock.</p>
  {queue.isLoading&&<p className="text-sm mt-3">Loading pending requests…</p>}
  {queue.isError&&<p role="alert" className="text-sm text-status-warning mt-3">Central review queue unavailable. Reconnect and try again.</p>}
  {queue.data?.length===0&&<p className="text-sm text-text-secondary mt-3">No reservations awaiting review.</p>}
  {error&&<p role="alert" className="text-sm text-status-danger mt-3">{error}</p>}
  <div className="space-y-3 mt-3">{queue.data?.map(r=>{
   const available=Number(r.current_quantity)-Number(r.overlapping_confirmed);
   return <article key={r.id} className="border border-border rounded-sm p-3">
    <div className="flex flex-wrap gap-2 items-center justify-between"><strong>{r.project_name} · {r.item_name}</strong><span className="text-xs uppercase text-text-secondary">{r.project_priority} priority</span></div>
    <p className="text-xs mt-1">Requested: {r.quantity} · Physically on hand: {r.current_quantity} · Already confirmed: {r.overlapping_confirmed} · Unreserved: {available}</p>
    <p className="text-xs text-text-secondary mt-1">Project: {r.project_status} · Start: {r.project_start_date?new Date(r.project_start_date).toLocaleDateString():'Unspecified'} · Due: {r.project_due_date?new Date(r.project_due_date).toLocaleDateString():'Unspecified'}</p>
    <p className="text-xs text-text-secondary mt-1">Usage: {new Date(r.needed_from).toLocaleString()} – {r.needed_until?new Date(r.needed_until).toLocaleString():'Until released'}</p>
    {r.note&&<p className="text-xs mt-1">Lead's note: {r.note}</p>}
    <label className="text-xs block mt-2">Decision reason<input value={notes[r.id]||''} maxLength={2000} onChange={e=>setNotes(old=>({...old,[r.id]:e.target.value}))} className="block w-full bg-bg border border-border rounded-sm p-2 mt-1"/></label>
    <div className="flex gap-2 mt-2"><button type="button" className="ui-button ui-button-primary ui-button-sm" disabled={decision.isPending||available<Number(r.quantity)} onClick={()=>decision.mutate({projectId:r.project_id,id:r.id,choice:'confirm'})}>Confirm</button><button type="button" className="ui-button ui-button-sm" disabled={decision.isPending||!(notes[r.id]||'').trim()} onClick={()=>decision.mutate({projectId:r.project_id,id:r.id,choice:'reject'})}>Reject with reason</button></div>
   </article>;
  })}</div>
 </section>;
}
