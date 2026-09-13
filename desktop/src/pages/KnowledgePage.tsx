import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, FileText, FolderOpen, Search, Tag, ArrowRight, Clock3, X } from 'lucide-react';
import { getKnowledgeOverview } from '../api/knowledge';
import { getAllResources, Resource } from '../api/resources';
import { getNotes, Note } from '../api/notes';
import { Link } from 'react-router-dom';
import Pagination, { usePagination } from '../components/Pagination';

type Tab = 'overview' | 'notes' | 'resources';
function formatDate(value: string) { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function resourceIcon(resource: Resource) { if (resource.file_type === 'pdf' || resource.file_type === 'document' || resource.file_type === 'text') return <FileText size={18} />; if (resource.kind === 'folder') return <FolderOpen size={18} />; return <BookOpen size={18} />; }

export default function KnowledgePage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const overview = useQuery({ queryKey: ['knowledge', 'overview'], queryFn: getKnowledgeOverview });
  const resources = useQuery<Resource[]>({ queryKey: ['resources', 'all'], queryFn: getAllResources });
  const notes = useQuery<Note[]>({ queryKey: ['notes', 'all'], queryFn: () => getNotes() });
  const filteredResources = useMemo(() => { const q = query.trim().toLowerCase(); return (resources.data || []).filter(r => (category === 'all' || r.category === category) && (!q || `${r.name} ${r.description || ''} ${(r.tags || []).join(' ')} ${r.category || ''}`.toLowerCase().includes(q))); }, [resources.data, query, category]);
  const filteredNotes = useMemo(() => { const q = query.trim().toLowerCase(); return (notes.data || []).filter(n => !q || `${n.title} ${n.body} ${(n.tags || []).join(' ')}`.toLowerCase().includes(q)); }, [notes.data, query]);
  const categories = overview.data?.categories || [];
  const recentNotes = overview.data?.recent_notes || [];
  const recentResources = overview.data?.recent_resources || [];
  const notesPage = usePagination(filteredNotes, 6);
  const resourcesPage = usePagination(filteredResources, 6);
  const recentNotesPage = usePagination(recentNotes, 6);
  const recentResourcesPage = usePagination(recentResources, 6);
  const hasFilters = query.trim().length > 0 || category !== 'all';
  const clearFilters = () => { setQuery(''); setCategory('all'); };

  return <div className="p-4 md:p-6 max-w-[1500px] mx-auto space-y-5">
    <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-md bg-accent/10 border border-accent/30 flex items-center justify-center text-accent shrink-0"><BookOpen size={21}/></div>
        <div className="min-w-0"><h1 className="text-page-title font-ui font-semibold">Knowledge</h1><p className="text-sm text-text-secondary">The shared memory of the laboratory.</p></div>
      </div>
    </header>

    <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2" role="tablist" aria-label="Knowledge sections">
      {(['overview','notes','resources'] as Tab[]).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => { setTab(value); if (value === 'overview') clearFilters(); }} className={`px-3 py-2 text-sm rounded-sm capitalize transition-colors ${tab === value ? 'bg-accent text-bg' : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'}`}>{value}</button>)}
      <Link to="/search" className="ml-auto px-3 py-2 text-sm text-text-secondary hover:text-text-primary flex items-center gap-2 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><Search size={16}/> Global search</Link>
    </div>

    {tab !== 'overview' && <div className="flex flex-col md:flex-row gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" size={17}/>
        <label htmlFor="knowledge-search" className="sr-only">Search {tab}</label>
        <input id="knowledge-search" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${tab}...`} className="w-full pl-10 pr-10 py-2.5 bg-surface border border-border rounded-sm text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-secondary hover:text-text-primary rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><X size={15}/></button>}
      </div>
      {tab === 'resources' && <label className="md:w-56"><span className="sr-only">Filter resources by category</span><select value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2.5 bg-surface border border-border rounded-sm text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"><option value="all">All categories</option>{categories.map(c => <option key={c.category} value={c.category}>{c.category} ({c.count})</option>)}</select></label>}
      {hasFilters && <button type="button" onClick={clearFilters} className="ui-button ui-button-sm self-start md:self-auto">Clear filters</button>}
    </div>}

    {overview.isLoading ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-surface border border-border rounded-md p-4 animate-pulse"><div className="h-3 w-24 bg-surface-raised rounded"/><div className="h-7 w-12 bg-surface-raised rounded mt-3"/></div>)}</div> : overview.error ? <div className="bg-surface border border-border rounded-md py-12 px-6 text-center"><p className="text-sm font-medium text-status-danger">Unable to load the knowledge overview.</p><p className="text-xs text-text-secondary mt-1.5">Check the connection and try again.</p><button type="button" onClick={() => overview.refetch()} className="ui-button ui-button-sm mt-4">Try again</button></div> : tab === 'overview' ? <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Stat label="Notes" value={overview.data?.counts.notes ?? 0} icon={<FileText size={18}/>} /><Stat label="Resources" value={overview.data?.counts.resources ?? 0} icon={<FolderOpen size={18}/>} /><Stat label="Categories" value={categories.length} icon={<Tag size={18}/>} /><Stat label="Recent activity" value={recentNotes.length + recentResources.length} icon={<Clock3 size={18}/>} /></div>
      <div className="grid lg:grid-cols-2 gap-4">
        <section className="bg-surface border border-border rounded-md p-4"><div className="flex items-center justify-between mb-3"><div><h2 className="font-semibold">Recent notes</h2><p className="text-xs text-text-secondary mt-0.5">Latest changes to shared notes.</p></div><button type="button" onClick={() => setTab('notes')} className="text-xs text-accent flex items-center gap-1 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">View all <ArrowRight size={13}/></button></div><div className="space-y-2">{recentNotesPage.pagedItems.map(n => <Link key={n.id} to="/notebook" className="block p-3 bg-surface-raised rounded-sm hover:bg-surface-raised/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><div className="text-sm font-medium">{n.title}</div><div className="text-xs text-text-secondary mt-1">{formatDate(n.updated_at)}{n.tags?.length ? ` · ${n.tags.join(', ')}` : ''}</div></Link>)}{recentNotes.length === 0 && <Empty text="No notes yet." />}</div><Pagination page={recentNotesPage.page} pageSize={recentNotesPage.pageSize} total={recentNotes.length} totalPages={recentNotesPage.totalPages} onPageChange={recentNotesPage.setPage} onPageSizeChange={recentNotesPage.changePageSize}/></section>
        <section className="bg-surface border border-border rounded-md p-4"><div className="flex items-center justify-between mb-3"><div><h2 className="font-semibold">Recent resources</h2><p className="text-xs text-text-secondary mt-0.5">Recently added or updated material.</p></div><button type="button" onClick={() => setTab('resources')} className="text-xs text-accent flex items-center gap-1 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">View all <ArrowRight size={13}/></button></div><div className="space-y-2">{recentResourcesPage.pagedItems.map(r => <Link key={r.id} to="/resources" className="block p-3 bg-surface-raised rounded-sm flex gap-3 hover:bg-surface-raised/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><span className="text-accent mt-0.5">{resourceIcon(r as Resource)}</span><div className="min-w-0"><div className="text-sm font-medium truncate">{r.name}</div><div className="text-xs text-text-secondary mt-1">{r.category} · {formatDate(r.updated_at)}</div></div></Link>)}{recentResources.length === 0 && <Empty text="No resources yet." />}</div><Pagination page={recentResourcesPage.page} pageSize={recentResourcesPage.pageSize} total={recentResources.length} totalPages={recentResourcesPage.totalPages} onPageChange={recentResourcesPage.setPage} onPageSizeChange={recentResourcesPage.changePageSize}/></section>
      </div>
    </> : tab === 'notes' ? <div className="space-y-2">{notes.isLoading ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-surface border border-border rounded-md p-4 animate-pulse"><div className="h-4 w-1/3 bg-surface-raised rounded"/><div className="h-3 w-2/3 bg-surface-raised rounded mt-3"/></div>) : notes.isError ? <div className="bg-surface border border-border rounded-md py-12 text-center"><p className="text-sm font-medium text-status-danger">Unable to load notes.</p><button type="button" onClick={() => notes.refetch()} className="ui-button ui-button-sm mt-4">Try again</button></div> : <>{notesPage.pagedItems.map(n => <Link key={n.id} to="/notebook" className="block bg-surface border border-border rounded-md p-4 hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><div className="font-medium">{n.title}</div><div className="text-sm text-text-secondary mt-1 line-clamp-2">{n.body || 'Empty note'}</div><div className="text-xs text-text-secondary mt-2">{formatDate(n.updated_at)}{n.tags?.length ? ` · ${n.tags.join(', ')}` : ''}</div></Link>)}{filteredNotes.length === 0 && <Empty text={hasFilters ? 'No notes match your search.' : 'No notes yet.'}/>}<Pagination page={notesPage.page} pageSize={notesPage.pageSize} total={filteredNotes.length} totalPages={notesPage.totalPages} onPageChange={notesPage.setPage} onPageSizeChange={notesPage.changePageSize}/></>}</div> : <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">{resources.isLoading ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-surface border border-border rounded-md p-4 animate-pulse"><div className="h-4 w-2/3 bg-surface-raised rounded"/><div className="h-3 w-1/2 bg-surface-raised rounded mt-3"/></div>) : resources.isError ? <div className="col-span-full bg-surface border border-border rounded-md py-12 text-center"><p className="text-sm font-medium text-status-danger">Unable to load resources.</p><button type="button" onClick={() => resources.refetch()} className="ui-button ui-button-sm mt-4">Try again</button></div> : <>{resourcesPage.pagedItems.map(r => <Link key={r.id} to="/resources" className="bg-surface border border-border rounded-md p-4 hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><div className="flex gap-3"><span className="text-accent">{resourceIcon(r)}</span><div className="min-w-0"><div className="font-medium truncate">{r.name}</div><div className="text-xs text-text-secondary mt-1">{r.category || 'general'} · {r.kind}</div>{r.description && <p className="text-sm text-text-secondary mt-2 line-clamp-2">{r.description}</p>}{r.tags?.length ? <div className="flex flex-wrap gap-1 mt-2">{r.tags.slice(0,5).map(t => <span key={t} className="px-1.5 py-0.5 bg-surface-raised rounded text-[11px]">#{t}</span>)}</div> : null}</div></div></Link>)}{filteredResources.length === 0 && <Empty text={hasFilters ? 'No resources match your filters.' : 'No resources yet.'}/>}<div className="col-span-full"><Pagination page={resourcesPage.page} pageSize={resourcesPage.pageSize} total={filteredResources.length} totalPages={resourcesPage.totalPages} onPageChange={resourcesPage.setPage} onPageSizeChange={resourcesPage.changePageSize}/></div></>}</div>}
  </div>;
}
function Stat({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) { return <div className="bg-surface border border-border rounded-md p-4"><div className="flex items-center gap-2 text-text-secondary text-xs">{icon}{label}</div><div className="text-2xl font-semibold mt-2 tabular-nums">{value}</div></div>; }
function Empty({ text }: { text: string }) { return <div className="col-span-full py-12 text-center text-text-secondary text-sm">{text}</div>; }
