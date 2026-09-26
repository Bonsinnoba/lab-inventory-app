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
  mutationFn:(choice:'submit'|'request_changes'|'approve')=>decideProjectReview(project.id,choice,note),
  onSuccess:(updated)=>{setMessage('');setNote('');qc.setQueryData(['project',project.id],updated);qc.invalidateQueries({queryKey:['project-review',project.id]});qc.invalidateQueries({queryKey:['projects']});},
  onError:(error:Error)=>setMessage(error.message)
 });
 if(project.status!=='planning')return null;
 const state=review.data?.project.review_status;
 return <section className="border border-border rounded-md bg-surface p-4 mb-4" aria-label="Project planning review">
  <h3 className="font-semibold">Planning review</h3>
  <p className="text-xs text-text-secondary mt-1">Prepare your BOM, Requirements, budget and proposed dates before submitting. Submitting does not reserve inventory. Admin approval activates the project.</p>
  {review.isLoading&&<p className="text-xs mt-3">Loading central review state…</p>}
  {review.isError&&<p className="text-xs mt-3 text-status-warning" role="alert">Central review is unavailable. Connect and synchronize this project before submitting or approving it.</p>}
  {state&&<p className="text-sm mt-3">Review status: <strong className="capitalize">{state.replace('_',' ')}</strong></p>}
  {state&&canEdit&&<div className="mt-3">
   <label className="block text-xs text-text-secondary mb-1" htmlFor="project-review-note">Review note (required when requesting changes)</label>
   <textarea id="project-review-note" value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} rows={2} className="w-full bg-bg border border-border rounded-sm p-2 text-sm" placeholder="Planning notes or reasons for decision"/>
   <div className="flex flex-wrap gap-2 mt-2">
    {['draft','changes_requested'].includes(state)&&<button type="button" disabled={decision.isPending} onClick={()=>decision.mutate('submit')} className="ui-button ui-button-primary ui-button-sm">Submit for admin review</button>}
    {state==='submitted'&&isAdmin&&<>
     <button type="button" disabled={decision.isPending} onClick={()=>decision.mutate('approve')} className="ui-button ui-button-primary ui-button-sm">Approve and activate</button>
     <button type="button" disabled={decision.isPending||!note.trim()} onClick={()=>decision.mutate('request_changes')} className="ui-button ui-button-sm">Request changes</button>
    </>}
   </div>
  </div>}
  {message&&<p role="alert" className="text-sm text-status-danger mt-2">{message}</p>}
  {!!review.data?.events.length&&<div className="mt-4 border-t border-border pt-3"><h4 className="text-xs font-semibold uppercase text-text-secondary">Review history</h4><ul className="mt-2 space-y-1 text-xs">{review.data.events.map(e=><li key={e.id}><strong>{e.actor}</strong> · {e.decision.replace('_',' ')} · {new Date(e.created_at).toLocaleString()}{e.note&&<p className="text-text-secondary">{e.note}</p>}</li>)}</ul></div>}
 </section>;
}
