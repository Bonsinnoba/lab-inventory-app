export type ProjectConflict = {entity_type:string;operation:string;error_code?:string;access_restricted?:boolean};

// Presentation only. Native conflict resolution remains authoritative.
export function projectConflictGuidance(conflict:ProjectConflict) {
  if(conflict.entity_type!=='project')return null;
  const deletion=conflict.operation==='delete';
  const protectedHistory=deletion&&['PROJECT_INVENTORY_HISTORY_PROTECTED','PROJECT_RECORDED_HISTORY_PROTECTED'].includes(conflict.error_code??'');
  const staleLifecycle=conflict.error_code==='PROJECT_LIFECYCLE_CONFLICT';
  if(!deletion&&!staleLifecycle)return null;
  return {
    retryBlocked:protectedHistory||staleLifecycle,
    acceptLabel:deletion?'Cancel deletion':'Use server status',
    explanation:conflict.access_restricted
      ?'Access changed. Saved work is retained, but this action does not restore access. A fresh authorized sync is required.'
      :protectedHistory
        ?'Recorded history prevents permanent deletion. Cancel this deletion, synchronize, then archive the project instead.'
        :staleLifecycle
          ?'Another lifecycle decision is newer. Retrieve the current project status and review it before making a new decision.'
          :'Cancel only this pending deletion. The project returns after a successful authorized sync; other pending edits are not discarded.',
    confirmation:deletion
      ?'Cancel this pending project deletion? Its saved payload will be retained for recovery. Other pending edits remain unchanged. The project will return only after a successful authorized sync; this does not restore revoked access.'
      :'Stop retrying this outdated lifecycle decision? Its original payload remains retained. Synchronize and review the current project status before making a new decision.',
    result:deletion?'Deletion cancelled locally; synchronize to retrieve the authorized project.':'Outdated status decision retired; synchronize and review the current project.'
  };
}
