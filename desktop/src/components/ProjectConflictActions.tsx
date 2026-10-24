import { projectConflictGuidance, type ProjectConflict } from '../api/project-conflict-guidance';

export default function ProjectConflictActions({conflict,busy,onResolve}:{
  conflict:ProjectConflict;busy:boolean;onResolve:(resolution:'keep_local'|'accept_server')=>void;
}) {
  const guidance=projectConflictGuidance(conflict);
  if(!guidance)return null;
  return <div className="space-y-2">
    <p className="text-xs text-text-secondary">{guidance.explanation}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy||guidance.retryBlocked||conflict.access_restricted}
        title={guidance.retryBlocked?'Review the current server project instead of retrying this unchanged intention.':undefined}
        onClick={()=>onResolve('keep_local')} className="px-3 py-2 border border-border rounded-lg text-xs disabled:opacity-50">Retry local change</button>
      <button type="button" disabled={busy} onClick={()=>onResolve('accept_server')}
        className="px-3 py-2 border border-accent text-accent rounded-lg text-xs disabled:opacity-50">{guidance.acceptLabel}</button>
    </div>
  </div>;
}
