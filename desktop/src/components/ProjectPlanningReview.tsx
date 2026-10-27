import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { decideProjectReview, getProjectReview, Project } from '../api/projects';
import { getStoredUser } from '../api/auth';

export default function ProjectPlanningReview({project,canEdit}:{project:Project;canEdit:boolean}){
 const qc=useQueryClient();
 const user=getStoredUser();
 const isAdmin=user?.role==='admin';
 const [note,setNote]=useState('');
 const [message,setMessage]=useState('');
 const review=useQuery({queryKey:['project-review',project.id],queryFn:()=>getProjectReview(project.id),enabled:project.status==='planning'});
 const decision=useMutation({
  mutationFn:(choice:'submit'|'request_changes'|'approve')=>decideProjectReview(project.id,choice,note,review.data?.token),
  onSuccess:(updated)=>{setMessage(updated.local_review_pending?'Review decision saved on this PC; awaiting server validation.':'');setNote('');qc.setQueryData(['project',project.id],updated);qc.invalidateQueries({queryKey:['project-review',project.id]});qc.invalidateQueries({queryKey:['projects']});},
  onError:(error:Error)=>setMessage(error.message)
 });
 if(project.status!=='planning')return null;
 const state=review.data?.project.review_status;
 return <section className="border border-border rounded-md bg-surface p-4 mb-4" aria-label="Project planning review">
  <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Planning review</h3><button type="button" disabled={review.isFetching||decision.isPending} onClick={()=>void review.refetch()} className="ui-button ui-button-sm">Refresh review</button></div>
  <p className="text-xs text-text-secondary mt-1">Prepare your BOM, Requirements, budget and proposed dates before submitting. Submitting does not reserve inventory. Admin approval activates the project.</p>
  {isAdmin&&<p className="text-xs text-text-secondary mt-1">As an administrator, you can approve this plan directly, including projects you created. Synchronize pending project edits first.</p>}
  <p className="text-xs text-text-secondary mt-1">On desktop, this is the last synchronized review. Decisions are saved locally for server validation. A queued approval does not activate the project.</p>
  {!!review.data?.pending_intents?.length&&<div role="status" className="text-xs text-status-warning mt-2">{review.data.pending_intents.map(intent=><p key={intent.change_id}>{intent.decision.replace('_',' ')} · {intent.state.replace('_',' ')}{intent.error?` — ${intent.error}`:''}{intent.state==='rejected'?' — Review this preserved decision in Sync conflicts.':''}</p>)}</div>}
  {review.isLoading&&<p className="text-xs mt-3">Loading review snapshot…</p>}
  {review.isError&&<p className="text-xs mt-3 text-status-warning" role="alert">{review.data?'Review could not be refreshed. Showing the last loaded snapshot.':'Review snapshot is unavailable. This does not mean there is no review history.'}<button type="button" disabled={review.isFetching} onClick={()=>void review.refetch()} className="ml-2 text-accent underline">Retry</button></p>}
  {state&&<div className="flex items-center gap-2 mt-3 text-sm"><span className="text-text-secondary">Review status:</span><span className={`px-2 py-0.5 rounded-full border text-xs font-medium capitalize ${state === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : state === 'submitted' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : state === 'changes_requested' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-surface-raised text-text-secondary border-border'}`}>{state.replace('_',' ')}</span></div>}
  {state&&canEdit&&!review.data?.pending_intents?.length&&<div className="mt-3">
   <label className="block text-xs text-text-secondary mb-1" htmlFor="project-review-note">Review note (required when requesting changes)</label>
   <textarea id="project-review-note" value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} rows={2} className="w-full bg-bg border border-border rounded-sm p-2 text-sm" placeholder="Planning notes or reasons for decision"/>
   <div className="flex flex-wrap gap-2 mt-2">
    {!isAdmin&&['draft','changes_requested'].includes(state)&&<button type="button" disabled={decision.isPending} onClick={()=>decision.mutate('submit')} className="ui-button ui-button-primary ui-button-sm">Submit for admin review</button>}
    {isAdmin&&['draft','changes_requested','submitted'].includes(state)&&
     <button type="button" disabled={decision.isPending} onClick={()=>decision.mutate('approve')} className="ui-button ui-button-primary ui-button-sm">Approve and activate</button>
    }
    {state==='submitted'&&isAdmin&&<>
     <button type="button" disabled={decision.isPending||!note.trim()} onClick={()=>decision.mutate('request_changes')} className="ui-button ui-button-sm">Request changes</button>
    </>}
   </div>
  </div>}
  {message&&<p role="alert" className="text-sm text-status-danger mt-2">{message}</p>}
  {!!review.data?.events.length&&<div className="mt-4 border-t border-border pt-3"><h4 className="text-xs font-semibold uppercase text-text-secondary">Review history</h4><ul className="mt-2 space-y-1 text-xs">{review.data.events.map(e=><li key={e.id}><strong>{e.actor}</strong> · {e.decision.replace('_',' ')} · {new Date(e.created_at).toLocaleString()}{e.note&&<p className="text-text-secondary">{e.note}</p>}</li>)}</ul></div>}
 </section>;
}
