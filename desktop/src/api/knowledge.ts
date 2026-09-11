import { apiFetch } from './http';

export interface KnowledgeOverview {
  counts: { notes: number; resources: number };
  categories: Array<{ category: string; count: number }>;
  recent_notes: Array<{ id: string; title: string; tags: string[]; updated_at: string; author_id?: string }>;
  recent_resources: Array<{ id: string; name: string; kind: string; file_type: string; category: string; tags: string[]; updated_at: string }>;
}

export interface KnowledgeTag { tag: string; note_count: number; resource_count: number }

export async function getKnowledgeOverview(): Promise<KnowledgeOverview> {
  const response = await apiFetch('/knowledge/overview');
  if (!response.ok) throw new Error('Failed to load knowledge overview');
  return response.json();
}

export async function getKnowledgeTags(): Promise<KnowledgeTag[]> {
  const response = await apiFetch('/knowledge/tags');
  if (!response.ok) throw new Error('Failed to load knowledge tags');
  return response.json();
}
