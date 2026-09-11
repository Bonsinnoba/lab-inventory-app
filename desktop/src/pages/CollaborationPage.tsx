import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, History, MessageSquare, Users } from 'lucide-react';
import { getActivity, getNotifications, markAllNotificationsRead, markNotificationRead } from '../api/collaboration';

function prettyEntity(type:string){return type.replace(/_/g,' ');}
function activityText(a:any){const actor=a.actor_username||'System';return `${actor} ${a.action.toLowerCase()} ${prettyEntity(a.entity_type)}`;}

export default function CollaborationPage(){
 const qc=useQueryClient();
 const activity=useQuery({queryKey:['collaboration-activity'],queryFn:()=>getActivity(60),refetchInterval:30000});
 const notifications=useQuery({queryKey:['notifications'],queryFn:()=>getNotifications(),refetchInterval:30000});
 const read=useMutation({mutationFn:markNotificationRead,onSuccess:()=>qc.invalidateQueries({queryKey:['notifications']})});
 const readAll=useMutation({mutationFn:markAllNotificationsRead,onSuccess:()=>qc.invalidateQueries({queryKey:['notifications']})});
 return <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
  <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3"><div><h2 className="text-page-title font-ui font-semibold">Collaboration</h2><p className="text-sm text-text-secondary mt-1">See what is happening across the laboratory and keep up with project discussions.</p></div><div className="flex items-center gap-2 text-sm text-text-secondary"><Users size={16}/><span>Shared lab workspace</span></div></div>
  <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
   <section className="bg-surface border border-border rounded-md overflow-hidden"><div className="p-4 border-b border-border flex items-center justify-between"><h3 className="font-semibold flex items-center gap-2"><History size={17}/>Activity feed</h3><span className="text-xs text-text-secondary">Auto-refreshes</span></div><div className="divide-y divide-border">{activity.isLoading?<div className="p-6 text-sm text-text-secondary">Loading activity…</div>:activity.data?.items.length?activity.data.items.map(a=><div key={a.id} className="p-4 flex gap-3"><div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center flex-shrink-0"><History size={15}/></div><div className="min-w-0"><div className="text-sm text-text-primary">{activityText(a)}</div><div className="text-xs text-text-secondary mt-1">{new Date(a.created_at).toLocaleString()}</div></div></div>):<div className="p-8 text-center text-sm text-text-secondary">No activity recorded yet.</div>}</div></section>
   <section className="bg-surface border border-border rounded-md overflow-hidden"><div className="p-4 border-b border-border flex items-center justify-between"><h3 className="font-semibold flex items-center gap-2"><Bell size={17}/>Notifications {Boolean(notifications.data?.unread_count)&&<span className="text-xs px-1.5 py-0.5 rounded-full bg-accent text-bg">{notifications.data?.unread_count}</span>}</h3>{Boolean(notifications.data?.unread_count)&&<button onClick={()=>readAll.mutate()} className="text-xs text-accent">Mark all read</button>}</div><div className="divide-y divide-border">{notifications.isLoading?<div className="p-6 text-sm text-text-secondary">Loading notifications…</div>:notifications.data?.items.length?notifications.data.items.map(n=><div key={n.id} className={`p-4 ${n.read_at?'opacity-70':'bg-accent/5'}`}><div className="flex items-start gap-3"><MessageSquare size={16} className="text-accent mt-0.5"/><div className="min-w-0 flex-1"><div className="text-sm font-medium">{n.title}</div><div className="text-sm text-text-secondary mt-1">{n.body}</div><div className="text-xs text-text-secondary mt-2">{new Date(n.created_at).toLocaleString()}</div></div>{!n.read_at&&<button title="Mark read" onClick={()=>read.mutate(n.id)} className="p-1.5 text-text-secondary hover:text-accent"><Check size={15}/></button>}</div></div>):<div className="p-8 text-center text-sm text-text-secondary">You're all caught up.</div>}</div></section>
  </div>
 </div>;
}
