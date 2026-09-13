import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, History, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { getActivity, getNotifications, markAllNotificationsRead, markNotificationRead } from '../api/collaboration';
import Pagination, { usePagination } from '../components/Pagination';

function prettyEntity(type: string) { return type.replace(/_/g, ' '); }
function activityText(a: any) { const actor = a.actor_username || 'System'; return `${actor} ${a.action.toLowerCase()} ${prettyEntity(a.entity_type)}`; }

function LoadingRows({ count = 4 }: { count?: number }) {
 return <div className="divide-y divide-border">{Array.from({ length: count }).map((_, i) => <div key={i} className="p-4 flex gap-3 animate-pulse"><div className="w-8 h-8 rounded-full bg-surface-raised shrink-0"/><div className="min-w-0 flex-1 space-y-2"><div className="h-3 bg-surface-raised rounded w-3/4"/><div className="h-2.5 bg-surface-raised rounded w-1/3"/></div></div>)}</div>;
}

export default function CollaborationPage() {
 const qc = useQueryClient();
 const activity = useQuery({ queryKey: ['collaboration-activity'], queryFn: () => getActivity(60), refetchInterval: 30000 });
 const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => getNotifications(), refetchInterval: 30000 });
 const read = useMutation({ mutationFn: markNotificationRead, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
 const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
 const activityItems = activity.data?.items || [];
 const notificationItems = notifications.data?.items || [];
 const unreadCount = notifications.data?.unread_count || 0;
 const activityPage = usePagination(activityItems, 6);
 const notificationPage = usePagination(notificationItems, 6);
 const retry = () => { activity.refetch(); notifications.refetch(); };
 return <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
  <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
   <div><div className="text-[11px] uppercase tracking-[0.16em] text-text-tertiary mb-1">WORKSPACE ACTIVITY</div><h1 className="text-page-title font-ui font-semibold">Collaboration</h1><p className="text-sm text-text-secondary mt-1 max-w-2xl">See what is happening across the laboratory and keep up with project discussions.</p></div>
   <div className="flex items-center gap-2"><div className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-secondary"><Users size={16}/><span>Shared lab workspace</span></div><button type="button" onClick={retry} disabled={activity.isFetching || notifications.isFetching} title="Refresh collaboration" aria-label="Refresh collaboration" className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface-raised text-sm hover:border-accent disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent/40"><RefreshCw size={15} className={activity.isFetching || notifications.isFetching ? 'animate-spin' : ''}/><span>{activity.isFetching || notifications.isFetching ? 'Refreshing…' : 'Refresh'}</span></button></div>
  </div>

  {(activity.error || notifications.error) && <div className="rounded-md border border-status-danger/40 bg-status-danger/5 p-4 flex items-center justify-between gap-4"><div><div className="text-sm font-medium text-status-danger">Some collaboration data could not be loaded</div><p className="text-xs text-text-secondary mt-1">Retry to refresh the activity feed and notifications.</p></div><button type="button" onClick={retry} className="px-3 py-2 rounded-md border border-border bg-surface text-sm hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40">Try again</button></div>}

  <div className="grid sm:grid-cols-3 gap-3">
   <div className="bg-surface border border-border rounded-md p-4"><div className="text-xs text-text-secondary">Recent activity</div><div className="text-2xl font-semibold mt-1">{activity.isLoading ? '—' : activityItems.length}</div><div className="text-xs text-text-tertiary mt-1">Latest events available</div></div>
   <div className="bg-surface border border-border rounded-md p-4"><div className="text-xs text-text-secondary">Notifications</div><div className="text-2xl font-semibold mt-1">{notifications.isLoading ? '—' : notificationItems.length}</div><div className="text-xs text-text-tertiary mt-1">In the current activity window</div></div>
   <div className="bg-surface border border-border rounded-md p-4"><div className="text-xs text-text-secondary">Unread</div><div className="text-2xl font-semibold mt-1">{notifications.isLoading ? '—' : unreadCount}</div><div className="text-xs text-text-tertiary mt-1">Needs your attention</div></div>
  </div>

  <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
   <section className="bg-surface border border-border rounded-md overflow-hidden"><div className="p-4 border-b border-border flex items-center justify-between"><div><h2 className="font-semibold flex items-center gap-2"><History size={17}/>Activity feed</h2><p className="text-xs text-text-secondary mt-1">Latest workspace events.</p></div><span className="text-xs text-text-secondary">Auto-refreshes</span></div>{activity.isLoading?<LoadingRows/>:<div className="divide-y divide-border">{activityItems.length?activityPage.pagedItems.map(a=><div key={a.id} className="p-4 flex gap-3 hover:bg-surface-raised/40 transition-colors"><div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center flex-shrink-0"><History size={15}/></div><div className="min-w-0"><div className="text-sm text-text-primary">{activityText(a)}</div><div className="text-xs text-text-secondary mt-1">{new Date(a.created_at).toLocaleString()}</div></div></div>):<div className="p-8 text-center text-sm text-text-secondary">No activity recorded yet.</div>}</div>}{!activity.error&&<div className="px-4 pb-4"><Pagination page={activityPage.page} pageSize={activityPage.pageSize} total={activityItems.length} totalPages={activityPage.totalPages} onPageChange={activityPage.setPage} onPageSizeChange={activityPage.changePageSize}/></div>}</section>
   <section className="bg-surface border border-border rounded-md overflow-hidden"><div className="p-4 border-b border-border flex items-center justify-between gap-3"><div><h2 className="font-semibold flex items-center gap-2"><Bell size={17}/>Notifications {Boolean(unreadCount)&&<span className="text-xs px-1.5 py-0.5 rounded-full bg-accent text-bg">{unreadCount}</span>}</h2><p className="text-xs text-text-secondary mt-1">Unread items stay highlighted.</p></div>{Boolean(unreadCount)&&<button type="button" disabled={readAll.isPending} onClick={()=>readAll.mutate()} className="text-xs text-accent hover:underline disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent/40 rounded">{readAll.isPending?'Marking…':'Mark all read'}</button>}</div>{notifications.isLoading?<LoadingRows count={3}/>:<div className="divide-y divide-border">{notificationItems.length?notificationPage.pagedItems.map(n=><div key={n.id} className={`p-4 ${n.read_at?'opacity-70':'bg-accent/5'} hover:bg-surface-raised/40 transition-colors`}><div className="flex items-start gap-3"><MessageSquare size={16} className="text-accent mt-0.5 shrink-0"/><div className="min-w-0 flex-1"><div className="text-sm font-medium">{n.title}</div><div className="text-sm text-text-secondary mt-1">{n.body}</div><div className="text-xs text-text-secondary mt-2">{new Date(n.created_at).toLocaleString()}</div></div>{!n.read_at&&<button type="button" title="Mark read" aria-label={`Mark ${n.title} as read`} disabled={read.isPending} onClick={()=>read.mutate(n.id)} className="p-1.5 rounded text-text-secondary hover:text-accent hover:bg-surface-raised disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent/40"><Check size={15}/></button>}</div></div>):<div className="p-8 text-center text-sm text-text-secondary">You're all caught up.</div>}</div>}{!notifications.error&&<div className="px-4 pb-4"><Pagination page={notificationPage.page} pageSize={notificationPage.pageSize} total={notificationItems.length} totalPages={notificationPage.totalPages} onPageChange={notificationPage.setPage} onPageSizeChange={notificationPage.changePageSize}/></div>}</section>
  </div>
 </div>;
}
