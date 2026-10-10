import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, History, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { getActivity, getNotifications, markAllNotificationsRead, markNotificationRead } from '../api/collaboration';
import Pagination, { usePagination } from '../components/Pagination';

function prettyEntity(type:string){return type.replace(/_/g,' ');}
function activityText(a:any){return `${a.actor_username||'System'} ${prettyEntity(a.action).toLowerCase()} ${prettyEntity(a.entity_type)}`;}
function LoadingRows(){return <div aria-busy="true" aria-label="Loading collaboration" className="p-4 space-y-3">{[1,2,3].map(i=><div key={i} className="h-10 rounded bg-surface-raised animate-pulse"/>)}</div>;}

export default function CollaborationPage() {
  const qc=useQueryClient();
  const activity=useQuery({queryKey:['collaboration-activity'],queryFn:()=>getActivity(60),refetchInterval:30000});
  const notifications=useQuery({queryKey:['notifications'],queryFn:()=>getNotifications(),refetchInterval:30000});
  const read=useMutation({mutationFn:markNotificationRead,onSuccess:()=>qc.invalidateQueries({queryKey:['notifications']})});
  const readAll=useMutation({mutationFn:markAllNotificationsRead,onSuccess:()=>qc.invalidateQueries({queryKey:['notifications']})});
  // A failed permission/lease read must not keep rendering the previous account's
  // query result. Persistent native snapshots remain intact on network failures.
  const activityReady=!!activity.data&&!activity.error&&(!activity.data.state||activity.data.state==='available');
  const notificationReady=!!notifications.data&&!notifications.error;
  const activityItems=activityReady?activity.data!.items:[];
  const notificationItems=notificationReady?notifications.data!.items:[];
  const unreadCount=notificationReady?notifications.data!.unread_count:null;
  const activityPage=usePagination(activityItems,6),notificationPage=usePagination(notificationItems,6);
  const refreshing=activity.isFetching||notifications.isFetching;
  const retry=()=>{activity.refetch();notifications.refetch();};
  const unavailableActivity=activity.data?.state==='restricted'?'Activity history is restricted to authorized administrators.':
    activity.data?.state==='not_downloaded'?'Activity has not been synchronized to this PC yet. Connect and sync to download it.':
    'Activity is unavailable. Check your session and permissions; an unavailable feed is not an empty history.';
  const button='inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface-raised text-sm hover:border-accent disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent/40';
  return <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
    <header className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
      <div><div className="text-[11px] uppercase tracking-[0.16em] text-text-tertiary mb-1">WORKSPACE ACTIVITY</div><h1 className="text-page-title font-ui font-semibold">Collaboration</h1></div>
      <div className="flex items-center gap-2"><span className="inline-flex items-center gap-2 text-sm text-text-secondary"><Users size={16}/>Shared lab workspace</span>
        <button type="button" onClick={retry} disabled={refreshing} aria-label="Refresh collaboration" className={button}><RefreshCw size={15} className={refreshing?'animate-spin':''}/>{refreshing?'Refreshing…':'Refresh'}</button></div>
    </header>
    {(activity.error||notifications.error)&&<div role="alert" className="rounded-md border border-status-danger/40 bg-status-danger/5 p-4">
      <p className="text-sm text-status-danger">Some collaboration data could not be loaded.</p><p className="text-xs text-text-secondary mt-1">Available sections remain visible. Missing totals are unknown, not zero.</p>
      <button type="button" onClick={retry} className={`${button} mt-3`}>Try again</button>
    </div>}
    {activityReady&&activity.data?.last_synced_at&&<aside role="status" className="rounded-md border border-border p-3 text-xs text-text-secondary">
      Local activity snapshot from {new Date(activity.data.last_synced_at).toLocaleString()}. New server events appear after synchronization; this timestamp is not refreshed by local reads.
    </aside>}
    {(read.error||readAll.error)&&<p role="alert" className="text-sm text-status-danger">The read acknowledgement could not be saved. Your notifications remain available; retry the action.</p>}
    <div className="grid sm:grid-cols-3 gap-3">{[
      ['Recent activity',activityReady?activityItems.length:'—','Latest events available'],
      ['Notifications',notificationReady?notificationItems.length:'—','In the current activity window'],
      ['Unread',unreadCount??'—','Needs your attention'],
    ].map(([label,value,description])=><div key={label} className="bg-surface border border-border rounded-md p-4"><div className="text-xs text-text-secondary">{label}</div><div className="text-2xl font-semibold mt-1">{value}</div><div className="text-xs text-text-tertiary mt-1">{description}</div></div>)}</div>
    <div className="grid lg:grid-cols-2 items-start gap-6">
      <section className="bg-surface border border-border rounded-md overflow-hidden">
        <div className="p-4 border-b border-border"><h2 className="font-semibold flex items-center gap-2"><History size={17}/>Activity feed</h2><p className="text-xs text-text-secondary mt-1">Latest synchronized workspace events.</p></div>
        {activity.isLoading?<LoadingRows/>:!activityReady?<p className="p-6 text-sm text-text-secondary">{unavailableActivity}</p>:
          <div className="divide-y divide-border">{activityItems.length?activityPage.pagedItems.map(a=><div key={a.id} className="p-4 flex gap-3"><History size={16} className="text-accent shrink-0 mt-1"/><div className="min-w-0"><div className="text-sm">{activityText(a)}</div><div className="text-xs text-text-secondary mt-1">{new Date(a.created_at).toLocaleString()}</div></div></div>):<p className="p-8 text-center text-sm text-text-secondary">No activity in the synchronized snapshot.</p>}</div>}
        {activityReady&&<div className="px-4 pb-4"><Pagination page={activityPage.page} pageSize={activityPage.pageSize} total={activityItems.length} totalPages={activityPage.totalPages} onPageChange={activityPage.setPage} onPageSizeChange={activityPage.changePageSize}/></div>}
      </section>
      <section className="bg-surface border border-border rounded-md overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-3"><div><h2 className="font-semibold flex items-center gap-2"><Bell size={17}/>Notifications</h2><p className="text-xs text-text-secondary mt-1">Unread items stay highlighted.</p></div>
          {!!unreadCount&&<button type="button" disabled={readAll.isPending} onClick={()=>readAll.mutate()} className="text-xs text-accent hover:underline disabled:opacity-50">{readAll.isPending?'Marking…':'Mark all read'}</button>}</div>
        {notifications.isLoading?<LoadingRows/>:!notificationReady?<p className="p-6 text-sm text-text-secondary">Notifications are unavailable. This does not mean you have no unread messages.</p>:
          <div className="divide-y divide-border">{notificationItems.length?notificationPage.pagedItems.map(n=><div key={n.id} className={`p-4 ${n.read_at?'opacity-70':'bg-accent/5'}`}><div className="flex items-start gap-3"><MessageSquare size={16} className="text-accent mt-0.5 shrink-0"/><div className="min-w-0 flex-1"><div className="text-sm font-medium">{n.title}</div><div className="text-sm text-text-secondary mt-1">{n.body}</div><div className="text-xs text-text-secondary mt-2">{new Date(n.created_at).toLocaleString()}</div></div>{!n.read_at&&<button type="button" aria-label={`Mark ${n.title} as read`} disabled={read.isPending} onClick={()=>read.mutate(n.id)} className="p-1.5 rounded text-text-secondary hover:text-accent disabled:opacity-50"><Check size={15}/></button>}</div></div>):<p className="p-8 text-center text-sm text-text-secondary">No unread notifications in the local view.</p>}</div>}
        {notificationReady&&<div className="px-4 pb-4"><Pagination page={notificationPage.page} pageSize={notificationPage.pageSize} total={notificationItems.length} totalPages={notificationPage.totalPages} onPageChange={notificationPage.setPage} onPageSizeChange={notificationPage.changePageSize}/></div>}
      </section>
    </div>
  </div>;
}
