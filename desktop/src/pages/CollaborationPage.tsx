import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, History, MessageSquare, Users } from 'lucide-react';
import { getActivity, getNotifications, markAllNotificationsRead, markNotificationRead } from '../api/collaboration';
import Pagination, { usePagination } from '../components/Pagination';

function prettyEntity(type: string) { return type.replace(/_/g, ' '); }
function activityText(a: any) { const actor = a.actor_username || 'System'; return `${actor} ${a.action.toLowerCase()} ${prettyEntity(a.entity_type)}`; }

export default function CollaborationPage() {
 const qc = useQueryClient();
 const activity = useQuery({ queryKey: ['collaboration-activity'], queryFn: () => getActivity(60), refetchInterval: 30000 });
 const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => getNotifications(), refetchInterval: 30000 });
 const read = useMutation({ mutationFn: markNotificationRead, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
 const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
 const activityItems = activity.data?.items || [];
 const notificationItems = notifications.data?.items || [];
 const activityPage = usePagination(activityItems, 6);
 const notificationPage = usePagination(notificationItems, 6);
 return <div className="p-2 sm:p-3 max-w-[1400px] mx-auto space-y-2">
  <div className="flex items-center justify-between gap-2 min-h-8"><div className="min-w-0"><h2 className="text-lg font-ui font-semibold truncate">Collaboration</h2><p className="hidden sm:block text-xs text-text-secondary truncate">Laboratory activity and project discussions.</p></div><div className="hidden md:flex items-center gap-1.5 text-xs text-text-secondary shrink-0"><Users size={14}/>Shared workspace</div></div>
  <div className="grid lg:grid-cols-[1.55fr_1fr] gap-2 min-w-0">
   <section className="bg-surface border border-border rounded-md overflow-hidden min-w-0 flex flex-col"><div className="px-3 py-2 border-b border-border flex items-center justify-between"><h3 className="text-sm font-semibold flex items-center gap-1.5"><History size={15}/>Activity feed</h3><span className="text-[10px] text-text-secondary">Auto-refresh</span></div><div className="divide-y divide-border">{activity.isLoading?<div className="p-4 text-xs text-text-secondary">Loading activity…</div>:activityItems.length?activityPage.pagedItems.map(a=><div key={a.id} className="px-3 py-2 flex gap-2 min-h-[52px]"><div className="w-6 h-6 rounded-full bg-accent/10 text-accent flex items-center justify-center flex-shrink-0"><History size={13}/></div><div className="min-w-0 flex-1"><div className="text-xs text-text-primary truncate">{activityText(a)}</div><div className="text-[10px] text-text-secondary mt-0.5">{new Date(a.created_at).toLocaleString()}</div></div></div>):<div className="p-5 text-center text-xs text-text-secondary">No activity recorded yet.</div>}</div><div className="px-3 pb-2"><Pagination page={activityPage.page} pageSize={activityPage.pageSize} total={activityItems.length} totalPages={activityPage.totalPages} onPageChange={activityPage.setPage} onPageSizeChange={activityPage.changePageSize}/></div></section>
   <section className="bg-surface border border-border rounded-md overflow-hidden min-w-0 flex flex-col"><div className="px-3 py-2 border-b border-border flex items-center justify-between"><h3 className="text-sm font-semibold flex items-center gap-1.5"><Bell size={15}/>Notifications {Boolean(notifications.data?.unread_count)&&<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-bg">{notifications.data?.unread_count}</span>}</h3>{Boolean(notifications.data?.unread_count)&&<button onClick={()=>readAll.mutate()} className="text-[10px] text-accent">Mark all read</button>}</div><div className="divide-y divide-border">{notifications.isLoading?<div className="p-4 text-xs text-text-secondary">Loading notifications…</div>:notificationItems.length?notificationPage.pagedItems.map(n=><div key={n.id} className={`px-3 py-2 ${n.read_at?'opacity-70':'bg-accent/5'}`}><div className="flex items-start gap-2"><MessageSquare size={14} className="text-accent mt-0.5 shrink-0"/><div className="min-w-0 flex-1"><div className="text-xs font-medium truncate">{n.title}</div><div className="text-xs text-text-secondary mt-0.5 line-clamp-2">{n.body}</div><div className="text-[10px] text-text-secondary mt-1">{new Date(n.created_at).toLocaleString()}</div></div>{!n.read_at&&<button title="Mark read" onClick={()=>read.mutate(n.id)} className="p-1 text-text-secondary hover:text-accent"><Check size={13}/></button>}</div></div>):<div className="p-5 text-center text-xs text-text-secondary">You're all caught up.</div>}</div><div className="px-3 pb-2"><Pagination page={notificationPage.page} pageSize={notificationPage.pageSize} total={notificationItems.length} totalPages={notificationPage.totalPages} onPageChange={notificationPage.setPage} onPageSizeChange={notificationPage.changePageSize}/></div></section>
  </div>
 </div>;
}
