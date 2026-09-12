import { useEffect, useState } from 'react';
import { Bell, Check, CheckCheck, X, AlertTriangle, Wrench, FlaskConical, ClipboardList } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getNotifications, markAllNotificationsRead, markNotificationRead, ExperienceNotification } from '../api/experience';

const icon=(type:string)=> type.includes('maintenance')||type.includes('calibration') ? Wrench : type.includes('task') ? ClipboardList : type.includes('experiment') ? FlaskConical : AlertTriangle;

export default function NotificationCenter(){
 const [open,setOpen]=useState(false); const qc=useQueryClient();
 const {data}=useQuery({queryKey:['experience','notifications'],queryFn:getNotifications,refetchInterval:30000});
 useEffect(()=>{const on=()=>setOpen(true);window.addEventListener('labos:notifications',on);return()=>window.removeEventListener('labos:notifications',on)},[]);
 const unread=data?.unread||0;
 const read=async(n:ExperienceNotification)=>{if(n.read_at)return;await markNotificationRead(n.id);qc.invalidateQueries({queryKey:['experience','notifications']})};
 return <div className="relative">
   <button type="button" onClick={()=>setOpen(v=>!v)} aria-label={`Notifications${unread?`, ${unread} unread`:''}`} title="Notifications" className="relative p-2 hover:bg-surface-raised rounded-sm text-text-secondary hover:text-text-primary">
    <Bell size={18}/>{unread>0&&<span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">{unread>99?'99+':unread}</span>}
   </button>
   {open&&<><button aria-label="Close notifications" className="fixed inset-0 z-[70] cursor-default" onClick={()=>setOpen(false)}/><section className="absolute right-0 top-11 z-[80] w-[360px] max-w-[calc(100vw-24px)] bg-surface border border-border shadow-2xl rounded-md overflow-hidden">
    <header className="px-4 py-3 border-b border-border flex items-center justify-between"><div><div className="page-kicker">LABOS / NOTIFICATIONS</div><h2 className="font-semibold text-sm">Activity requiring attention</h2></div><div className="flex items-center gap-1">{unread>0&&<button onClick={async()=>{await markAllNotificationsRead();qc.invalidateQueries({queryKey:['experience','notifications']})}} title="Mark all read" className="p-1.5 hover:bg-surface-raised rounded"><CheckCheck size={15}/></button>}<button onClick={()=>setOpen(false)} className="p-1.5 hover:bg-surface-raised rounded"><X size={15}/></button></div></header>
    <div className="max-h-[420px] overflow-auto">{!data?.items.length?<div className="p-8 text-center text-sm text-text-secondary">No notifications.</div>:data.items.map(n=>{const I=icon(n.type);return <button key={n.id} onClick={()=>read(n)} className={`w-full text-left px-4 py-3 border-b border-border hover:bg-surface-raised ${!n.read_at?'bg-accent/5':''}`}><div className="flex gap-3"><span className="mt-0.5 text-accent"><I size={16}/></span><span className="min-w-0 flex-1"><span className="flex justify-between gap-2"><strong className="text-sm">{n.title}</strong>{!n.read_at&&<span className="text-accent"><Check size={13}/></span>}</span><span className="block text-xs text-text-secondary mt-1">{n.body}</span><span className="block text-[10px] text-text-secondary mt-2">{new Date(n.created_at).toLocaleString()}</span></span></div></button>})}</div>
   </section></>}
 </div>
}
