import { apiFetch } from './http';

export type SearchType = 'items' | 'notes' | 'transactions' | 'resources' | 'projects' | 'users' | 'tasks' | 'experiments' | 'blocks';

export interface SearchResult {
  id: string;
  type: 'item' | 'note' | 'transaction' | 'resource' | 'project' | 'user' | 'task' | 'experiment' | 'block';
  title: string;
  subtitle: string;
  rank?: number;
  [key: string]: any;
}

export interface SearchResults {
  query?: string;
  total?: number;
  counts?: Partial<Record<SearchType, number>>;
  all?: SearchResult[];
  items?: SearchResult[];
  notes?: SearchResult[];
  transactions?: SearchResult[];
  resources?: SearchResult[];
  projects?: SearchResult[];
  users?: SearchResult[];
  tasks?: SearchResult[];
  experiments?: SearchResult[];
  blocks?: SearchResult[];
}

export async function globalSearch(query: string, types?: SearchType[]): Promise<SearchResults> {
  const params = new URLSearchParams();
  params.append('q', query.trim());
  if (types && types.length > 0) params.append('type', types.join(','));
  const response = await apiFetch(`/search?${params}`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
    throw new Error(message || 'Search failed');
  }
  return response.json();
}
