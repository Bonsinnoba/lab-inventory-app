import { useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { decideProjectReservation,getProjectReservations,requestProjectReservation,Project } from '../api/projects';
import { getItems } from '../api/items';
import { getStoredUser } from '../api/auth';

export default function ProjectReservations({project,canEdit}:{project:Project;canEdit:boolean}){
 const qc=useQueryClient(),isAdmin=getStoredUser()?.role==='admin';
 const [itemId,setItemId]=useState(''),[quantity,setQuantity]=useState('1'),[from,setFrom]=useState(''),[until,setUntil]=useState(''),[note,setNote]=useState(''),[error,setError]=useState('');
 const reservations=useQuery({queryKey:['project-reservations',project.id],queryFn:()=>getProjectReservations(project.id)});
 const items=useQuery({queryKey:['items'],queryFn:getItems});
 const request=useMutation({mutationFn:()=>requestProjectReservation(project.id,{item_id:itemId,quantity:Number(quantity),needed_from:new Date(from).toISOString(),needed_until:until?new Date(until).toISOString():undefined,note}),onSuccess:()=>{setError('');setNote('');qc.invalidateQueries({queryKey:['project-reservations',project.id]});},onError:(e:Error)=>setError(e.message)});
 const decide=useMutation({mutationFn:({id,decision}:{id:string;decision:'confirm'|'reject'|'release'})=>decideProjectReservation(project.id,id,decision,note),onSuccess:()=>{setError('');setNote('');qc.invalidateQueries({queryKey:['project-reservations',project.id]});},onError:(e:Error)=>setError(e.message)});
 if(!['planning','active'].includes(project.status))return null;
 return <section className="border border-border rounded-md bg-surface p-4 my-4" aria-label="Project reservations">
  <h3 className="font-semibold">Resource reservations</h3>
  <p className="text-xs text-text-secondary mt-1">Requests are submitted to the central lab. Only confirmed reservations allocate stock; physical inventory is not deducted. Offline requests are not yet supported.</p>
  {canEdit&&<div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
   <label className="text-xs">Inventory item<select value={itemId} onChange={e=>setItemId(e.target.value)} className="block w-full bg-bg border border-border p-2 rounded-sm mt-1"><option value="">Select item</option>{items.data?.map(i=><option key={i.id} value={i.id}>{i.name} · {i.current_quantity} available physically</option>)}</select></label>
   <label className="text-xs">Quantity<input type="number" min="0.001" step="any" value={quantity} onChange={e=>setQuantity(e.target.value)} className="block w-full bg-bg border border-border p-2 rounded-sm mt-1"/></label>
   <label className="text-xs">Needed from<input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)} className="block w-full bg-bg border border-border p-2 rounded-sm mt-1"/></label>
   <label className="text-xs">Needed until (optional)<input type="datetime-local" value={until} onChange={e=>setUntil(e.target.value)} className="block w-full bg-bg border border-border p-2 rounded-sm mt-1"/></label>
   <label className="text-xs md:col-span-2">Request note / admin decision reason<textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} maxLength={2000} className="block w-full bg-bg border border-border p-2 rounded-sm mt-1"/></label>
   <button type="button" className="ui-button ui-button-primary ui-button-sm" disabled={!itemId||!from||!(Number(quantity)>0)||request.isPending||!!(until&&Date.parse(until)<=Date.parse(from))} onClick={()=>request.mutate()}>Request reservation</button>
  </div>}
  {error&&<p role="alert" className="text-status-danger text-xs mt-2">{error}</p>}
  {reservations.isError&&<p role="alert" className="text-status-warning text-xs mt-2">Central reservation service unavailable. Reconnect to view or request reservations.</p>}
  <ul className="mt-3 space-y-2">{reservations.data?.map(r=><li key={r.id} className="border border-border rounded-sm p-3 text-sm">
   <strong>{r.item_name}</strong> · {r.quantity} · <span className="capitalize">{r.status.replace('_',' ')}</span>
   <p className="text-xs text-text-secondary mt-1">{new Date(r.needed_from).toLocaleString()} – {r.needed_until?new Date(r.needed_until).toLocaleString():'Until released'} · Project priority: {r.project_priority} · Due: {r.project_due_date?new Date(r.project_due_date).toLocaleDateString():'Not set'}</p>
   {r.note&&<p className="text-xs mt-1">Request: {r.note}</p>}{r.review_note&&<p className="text-xs mt-1">Decision: {r.review_note}</p>}
   {isAdmin&&r.status==='pending_review'&&<div className="flex gap-2 mt-2"><button type="button" disabled={decide.isPending} className="ui-button ui-button-primary ui-button-sm" onClick={()=>decide.mutate({id:r.id,decision:'confirm'})}>Confirm</button><button type="button" disabled={decide.isPending||!note.trim()} className="ui-button ui-button-sm" onClick={()=>decide.mutate({id:r.id,decision:'reject'})}>Reject (reason required)</button></div>}
   {isAdmin&&r.status==='confirmed'&&<button type="button" disabled={decide.isPending} className="ui-button ui-button-sm mt-2" onClick={()=>decide.mutate({id:r.id,decision:'release'})}>Release</button>}
  </li>)}</ul>
 </section>;
}
