import type { Resource } from './resources';

type Destination = { id: string; name?: string; title?: string };

// Parent IDs are authoritative; joined names may be absent in offline records.
export function resourceAttachmentLabel(resource: Resource, projects: Destination[], items: Destination[], notes: Destination[]): string {
  if (resource.project_id) return `Project: ${projects.find(p => p.id === resource.project_id)?.name || resource.project_name || 'Linked project'}`;
  if (resource.item_id) return `Item: ${items.find(p => p.id === resource.item_id)?.name || resource.item_name || 'Linked item'}`;
  if (resource.note_id) return `Note: ${notes.find(p => p.id === resource.note_id)?.title || resource.note_title || 'Linked note'}`;
  if (resource.parent_resource_id) return 'In resource folder';
  return 'Unattached';
}

export async function invalidateResourceAttachments(client: { invalidateQueries: (filters: {queryKey: string[]}) => Promise<unknown> }) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['resources'] }),
    client.invalidateQueries({ queryKey: ['project-workspace'] }),
  ]);
}
