import { useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { decideProjectReservation,fulfillProjectReservation,getProjectReservations,requestProjectReservation,Project } from '../api/projects';
import { getItems } from '../api/items';
import { captureAccountSession,getStoredUser } from '../api/auth';
import ReservationCheckoutModal from './ReservationCheckoutModal';
import type { ProjectReservation } from '../api/projects';

export default function ProjectReservations({project,canEdit}:{project:Project;canEdit:boolean}){
 const qc=useQueryClient(),isAdmin=getStoredUser()?.role==='admin';
 const session=captureAccountSession();
 const [checkout,setCheckout]=useState<ProjectReservation|null>(null);
 const [fulfillTarget,setFulfillTarget]=useState<string|null>(null);
 const [fulfillQuantity,setFulfillQuantity]=useState('');
 const [fulfillRequestId,setFulfillRequestId]=useState('');
 const [itemId,setItemId]=useState(''),[quantity,setQuantity]=useState('1'),[from,setFrom]=useState(''),[until,setUntil]=useState(''),[note,setNote]=useState(''),[error,setError]=useState('');
 const reservations=useQuery({queryKey:['project-reservations',project.id,session?.accountId,session?.generation],queryFn:()=>getProjectReservations(project.id),retry:false});
 const items=useQuery({queryKey:['items'],queryFn:()=>getItems()});
 const request=useMutation({mutationFn:()=>requestProjectReservation(project.id,{item_id:itemId,quantity:Number(quantity),needed_from:new Date(from).toISOString(),needed_until:until?new Date(until).toISOString():undefined,note}),onSuccess:()=>{setError('');setNote('');qc.invalidateQueries({queryKey:['project-reservations',project.id]});},onError:(e:Error)=>setError(e.message)});
 const decide=useMutation({mutationFn:({id,decision}:{id:string;decision:'confirm'|'reject'|'release'})=>decideProjectReservation(project.id,id,decision,note),onSuccess:()=>{setError('');setNote('');qc.invalidateQueries({queryKey:['project-reservations',project.id]});},onError:(e:Error)=>setError(e.message)});
 const fulfill=useMutation({mutationFn:({id,quantity,requestId}:{id:string;quantity:number;requestId:string})=>fulfillProjectReservation(project.id,id,quantity,requestId),onSuccess:()=>{setError('');qc.invalidateQueries({queryKey:['project-reservations',project.id]});qc.invalidateQueries({queryKey:['items']});},onError:(e:Error)=>setError(e.message)});
 if(!['planning','active'].includes(project.status))return null;
 return <section className="border border-border rounded-md bg-surface p-4 my-4" aria-label="Project reservations">
  <h3 className="font-semibold">Resource reservations</h3>
  {checkout&&<ReservationCheckoutModal key={checkout.id} reservation={checkout} onClose={()=>setCheckout(null)}/>}
  <p className="text-xs text-text-secondary mt-1">Reservations allocate stock logically; physical stock stays in the storeroom until issued or consumed. Desktop requests and reviews are saved on this PC for synchronization. A pending review does not authorize stock issuance. Fulfilled quantity includes issues and consumption, not necessarily settled custody.</p>
  {canEdit&&<div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
   <label className="text-xs">Inventory item<select value={itemId} onChange={e=>setItemId(e.target.value)} className="block w-full bg-bg border border-border p-2 rounded-sm mt-1"><option value="">Select item</option>{items.data?.map(i=><option key={i.id} value={i.id}>{i.name} · {i.current_quantity} available physically</option>)}</select></label>
   <label className="text-xs">Quantity<input type="number" min="0.001" step="any" value={quantity} onChange={e=>setQuantity(e.target.value)} className="block w-full bg-bg border border-border p-2 rounded-sm mt-1"/></label>
   <label className="text-xs">Needed from<input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)} className="block w-full bg-bg border border-border p-2 rounded-sm mt-1"/></label>
   <label className="text-xs">Needed until (optional)<input type="datetime-local" value={until} onChange={e=>setUntil(e.target.value)} className="block w-full bg-bg border border-border p-2 rounded-sm mt-1"/></label>
   <label className="text-xs md:col-span-2">Request note / admin decision reason<textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} maxLength={2000} className="block w-full bg-bg border border-border p-2 rounded-sm mt-1"/></label>
   <button type="button" className="ui-button ui-button-primary ui-button-sm" disabled={!itemId||!from||!(Number(quantity)>0)||request.isPending||!!(until&&Date.parse(until)<=Date.parse(from))} onClick={()=>request.mutate()}>Request reservation</button>
  </div>}
  {fulfillTarget&&<div role="alertdialog" aria-modal="true" aria-label="Confirm reservation fulfillment" className="border border-status-warning rounded-sm p-3 mt-3"><p className="text-sm">Consume the specified confirmed quantity and permanently record the stock movement? This action cannot be undone.</p><label className="text-xs block mt-2">Quantity to consume (maximum {reservations.data?.find(r=>r.id===fulfillTarget)?.quantity})<input type="number" min="0.001" step="0.001" max={Number(reservations.data?.find(r=>r.id===fulfillTarget)?.quantity||0)} value={fulfillQuantity} onChange={e=>{setFulfillQuantity(e.target.value);setFulfillRequestId(crypto.randomUUID());}} className="block w-full bg-bg border border-border rounded-sm p-2 mt-1"/></label><div className="flex gap-2 mt-2"><button type="button" className="ui-button ui-button-primary ui-button-sm" disabled={fulfill.isPending||!(Number(fulfillQuantity)>0)||Number(fulfillQuantity)>Number(reservations.data?.find(r=>r.id===fulfillTarget)?.quantity||0)} onClick={()=>fulfill.mutate({id:fulfillTarget,quantity:Number(fulfillQuantity),requestId:fulfillRequestId},{onSuccess:()=>setFulfillTarget(null)})}>Confirm consumption</button><button type="button" className="ui-button ui-button-sm" onClick={()=>setFulfillTarget(null)}>Cancel</button></div></div>}
  {error&&<p role="alert" className="text-status-danger text-xs mt-2">{error}</p>}
  {reservations.isError&&<p role="alert" className="text-status-warning text-xs mt-2">{reservations.error instanceof Error?reservations.error.message:'Reservation snapshot unavailable.'}</p>}
  {!reservations.isError&&<ul className="mt-3 space-y-2">{reservations.data?.map(r=><li key={r.id} className="border border-border rounded-sm p-3 text-sm">
   <div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{r.item_name}</strong> · <span className="font-mono">{r.quantity}</span> allocated{r.fulfilled_quantity&&Number(r.fulfilled_quantity)>0?` · ${r.fulfilled_quantity} fulfilled`:''}</div><span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${r.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : r.status === 'pending_review' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : r.status === 'rejected' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-surface-raised text-text-secondary border-border'}`}>{r.status === 'confirmed' ? 'Confirmed Allocation' : r.status.replace('_',' ')}</span></div>
   <p className="text-xs text-text-secondary mt-1">{new Date(r.needed_from).toLocaleString()} – {r.needed_until?new Date(r.needed_until).toLocaleString():'Until released'} · Project priority: {r.project_priority} · Due: {r.project_due_date?new Date(r.project_due_date).toLocaleDateString():'Not set'}</p>
   {r.note&&<p className="text-xs mt-1">Request: {r.note}</p>}{r.review_note&&<p className="text-xs mt-1">Decision: {r.review_note}</p>}
   {!!r.local_pending_issue_quantity&&<p className="text-xs text-status-warning mt-1">{r.local_pending_issue_quantity} issued or consumed on this PC, not yet included in the server snapshot. Allocation shown includes this local deduction.</p>}
   {r.local_issue_error&&<p role="alert" className="text-xs text-status-warning mt-1">{r.local_issue_error}</p>}
   {canEdit&&r.status==='confirmed'&&<button type="button" disabled={!!r.local_issue_error||Number(r.quantity)<=0} className="ui-button ui-button-primary ui-button-sm mt-2 mr-2" onClick={()=>setCheckout(r)}>Issue to recipient</button>}
   {isAdmin&&r.status==='pending_review'&&<div className="flex gap-2 mt-2"><button type="button" disabled={decide.isPending||!!r.local_issue_error} className="ui-button ui-button-primary ui-button-sm" onClick={()=>decide.mutate({id:r.id,decision:'confirm'})}>Confirm</button><button type="button" disabled={decide.isPending||!!r.local_issue_error||!note.trim()} className="ui-button ui-button-sm" onClick={()=>decide.mutate({id:r.id,decision:'reject'})}>Reject (reason required)</button></div>}
   {isAdmin&&r.status==='confirmed'&&<button type="button" disabled={fulfill.isPending||!!r.local_issue_error} className="ui-button ui-button-primary ui-button-sm mt-2 mr-2" onClick={()=>{setFulfillTarget(r.id);setFulfillQuantity(String(r.quantity));setFulfillRequestId(crypto.randomUUID());}}>Fulfill consumables</button>}
   {isAdmin&&r.status==='confirmed'&&<button type="button" disabled={decide.isPending||!!r.local_issue_error} className="ui-button ui-button-sm mt-2" onClick={()=>decide.mutate({id:r.id,decision:'release'})}>Release</button>}
  </li>)}</ul>}
 </section>;
}
