import type { QueryClient } from '@tanstack/react-query';

// Refresh projections after a confirmed local save; never discard form state or
// manufacture a new review token. The native/server review guards remain final.
export async function refreshProjectPlan(client: Pick<QueryClient, 'invalidateQueries'>, projectId: string) {
  await Promise.all([
    ['project-bom', projectId], ['project-workspace', projectId],
    ['project-review', projectId], ['project-context', projectId],
    ['project-reservations', projectId],
    ['task-experiments', projectId], ['task-attachments', projectId],
    ['experiment-attachments', projectId], ['experiment-measurements', projectId],
    ['experiment-observations', projectId], ['experiment-revisions', projectId],
    ['experiment-history', projectId],
    ['project', projectId], ['projects'], ['experience', 'dashboard'],
  ].map(queryKey => client.invalidateQueries({ queryKey })));
}

export function validBomForm(value: {name:string; required_quantity:string; preferred_item_id:string; alternative_item_id:string}):boolean {
  const quantity=Number(value.required_quantity);
  return value.name.trim().length>0 && Number.isFinite(quantity) && quantity>0
    && (!value.preferred_item_id || !value.alternative_item_id || value.preferred_item_id!==value.alternative_item_id);
}
