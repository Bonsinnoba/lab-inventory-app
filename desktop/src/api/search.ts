import { apiFetch } from './http';
import { invoke } from '@tauri-apps/api/tauri';

const LOCAL_SEARCH_TYPES: SearchType[] = ['items','projects','notes','resources','tasks','experiments','findings','transactions'];
function isTauriRuntime() { return typeof window !== 'undefined' && Boolean((window as any).__TAURI_IPC__); }

export type SearchType = 'items' | 'notes' | 'transactions' | 'resources' | 'projects' | 'users' | 'tasks' | 'experiments' | 'findings' | 'blocks';

export interface SearchResult {
  id: string;
  type: 'item' | 'note' | 'transaction' | 'resource' | 'project' | 'user' | 'task' | 'experiment' | 'finding' | 'block';
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
  findings?: SearchResult[];
  blocks?: SearchResult[];
}

export async function globalSearch(query: string, types?: SearchType[]): Promise<SearchResults> {
  const requested = types && types.length > 0 ? types : (['items','notes','transactions','resources','projects','users','tasks','experiments','findings','blocks'] as SearchType[]);
  let local: SearchResults | null = null;
  if (isTauriRuntime()) {
    try { local = await invoke<SearchResults>('global_local_search', { query: query.trim(), types: requested.filter(type => LOCAL_SEARCH_TYPES.includes(type)) }); } catch {}
    const needsCentral = requested.some(type => !LOCAL_SEARCH_TYPES.includes(type));
    if (!needsCentral && local) return local;
  }
  const params = new URLSearchParams();
  params.append('q', query.trim());
  if (types && types.length > 0) params.append('type', types.join(','));
  try {
    const response = await apiFetch(`/search?${params}`);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
      if (local) return local;
      throw new Error(message || 'Search failed');
    }
    const central = await response.json() as SearchResults;
    if (!local) return central;
    const localAll = Array.isArray(local.all) ? local.all : [];
    const centralAll = Array.isArray(central.all) ? central.all : [];
    const seen = new Set(centralAll.map(result => `${result.type}:${result.id}`));
    const merged = [...centralAll, ...localAll.filter(result => !seen.has(`${result.type}:${result.id}`))];
    return { ...central, all: merged, total: merged.length };
  } catch (error) {
    if (local) return local;
    throw error;
  }
}
