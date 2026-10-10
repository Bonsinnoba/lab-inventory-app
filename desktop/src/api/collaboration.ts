import { listComments, mutateComment } from './comments';
import { listNotifications, markNotificationsRead, markAllVisibleNotificationsRead } from './notifications';
import { listActivity } from './activity';

export interface ActivityItem { id:string; action:string; entity_type:string; entity_id?:string|null; metadata?:Record<string,any>|null; created_at:string; actor_username?:string|null; }
export interface Notification { id:string; type:string; title:string; body:string; entity_type?:string|null; entity_id?:string|null; metadata?:Record<string,any>|null; read_at?:string|null; created_at:string; }
export interface ProjectComment { id:string; project_id:string; author_id?:string|null; author_username?:string|null; body:string; created_at:string; updated_at:string; }

export const getActivity=listActivity;
export async function getNotifications(limit=30):Promise<{items:Notification[];unread_count:number}>{const rows=await listNotifications();return {items:rows.slice(0,limit),unread_count:rows.filter(r=>!r.read_at).length};}
export const markNotificationRead=(id:string)=>markNotificationsRead([id]);
export const markAllNotificationsRead=markAllVisibleNotificationsRead;
export const getProjectComments=listComments;
export const createProjectComment=(projectId:string,body:string)=>mutateComment(projectId,'create',body);
export const deleteProjectComment=async(projectId:string,commentId:string)=>{await mutateComment(projectId,'delete',undefined,commentId);};
