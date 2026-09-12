import { apiFetch, getApiErrorMessage } from './http';

export interface ExperienceNotification { id:string; type:string; title:string; body:string; entity_type?:string; entity_id?:string; read_at?:string|null; created_at:string; }
export interface ExperienceDashboard { metrics:{active_projects:number;overdue_tasks:number;due_next_7_days:number;low_stock:number}; projects:any[]; overdue:any[]; due:any[]; recent:any[]; low_stock:any[]; }

async function json<T>(path:string, init?:RequestInit):Promise<T> {
  const r=await apiFetch(path,init); if(!r.ok) throw new Error(await getApiErrorMessage(r)); return r.json();
}
export const getExperienceDashboard=()=>json<ExperienceDashboard>('/experience/dashboard');
export const getNotifications=()=>json<{items:ExperienceNotification[];unread:number}>('/experience/notifications?limit=40');
export const markNotificationRead=(id:string)=>json<ExperienceNotification>(`/experience/notifications/${id}/read`,{method:'POST'});
export const markAllNotificationsRead=()=>json<{ok:boolean}>('/experience/notifications/read-all',{method:'POST'});
export const getProjectHealth=(id:string)=>json<any>(`/experience/project-health/${id}`);
export const getActivity=(limit=30)=>json<any[]>(`/experience/activity?limit=${limit}`);
