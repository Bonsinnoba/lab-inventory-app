import { apiFetch } from './http';

export interface ActivityItem { id:string; action:string; entity_type:string; entity_id?:string|null; metadata?:Record<string,any>|null; created_at:string; actor_username?:string|null; }
export interface Notification { id:string; type:string; title:string; body:string; entity_type?:string|null; entity_id?:string|null; metadata?:Record<string,any>|null; read_at?:string|null; created_at:string; }
export interface ProjectComment { id:string; project_id:string; author_id?:string|null; author_username?:string|null; body:string; created_at:string; updated_at:string; }

export async function getActivity(limit=40):Promise<{items:ActivityItem[];next_before:string|null}>{const r=await apiFetch(`/collaboration/activity?limit=${limit}`);if(!r.ok)throw new Error('Failed to fetch activity');return r.json();}
export async function getNotifications(limit=30):Promise<{items:Notification[];unread_count:number}>{const r=await apiFetch(`/collaboration/notifications?limit=${limit}`);if(!r.ok)throw new Error('Failed to fetch notifications');return r.json();}
export async function markNotificationRead(id:string){const r=await apiFetch(`/collaboration/notifications/${id}/read`,{method:'PATCH'});if(!r.ok)throw new Error('Failed to mark notification');return r.json();}
export async function markAllNotificationsRead(){const r=await apiFetch('/collaboration/notifications/read-all',{method:'POST'});if(!r.ok)throw new Error('Failed to mark notifications');return r.json();}
export async function getProjectComments(projectId:string):Promise<ProjectComment[]>{const r=await apiFetch(`/collaboration/projects/${projectId}/comments`);if(!r.ok)throw new Error('Failed to fetch comments');return r.json();}
export async function createProjectComment(projectId:string,body:string):Promise<ProjectComment>{const r=await apiFetch(`/collaboration/projects/${projectId}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body})});if(!r.ok)throw new Error((await r.json().catch(()=>({})))?.error||'Failed to create comment');return r.json();}
export async function deleteProjectComment(projectId:string,commentId:string){const r=await apiFetch(`/collaboration/projects/${projectId}/comments/${commentId}`,{method:'DELETE'});if(!r.ok)throw new Error('Failed to delete comment');}
