import { apiFetch, getApiErrorMessage } from './http';
import { getProjects, Project, getProjectWorkspace } from './projects';
import { getItems } from './items';
import { getNotes } from './notes';
import { getAllResources } from './resources';

export interface ExperienceNotification { id:string; type:string; title:string; body:string; entity_type?:string; entity_id?:string; read_at?:string|null; created_at:string; }
export interface ExperienceDashboard { metrics:{active_projects:number;overdue_tasks:number;due_next_7_days:number;low_stock:number}; projects:any[]; overdue:any[]; due:any[]; recent:any[]; low_stock:any[]; }

function isTauriRuntime(): boolean { return typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__; }

async function json<T>(path:string, init?:RequestInit):Promise<T> {
  const r=await apiFetch(path,init); if(!r.ok) throw new Error(await getApiErrorMessage(r)); return r.json();
}

function localDate(value:any): Date | null {
  const d=new Date(value||'');
  return Number.isNaN(d.getTime()) ? null : d;
}

async function getLocalExperienceDashboard(): Promise<ExperienceDashboard> {
  const [projects, items, notes, resources] = await Promise.all([
    getProjects(),
    getItems(),
    getNotes(),
    getAllResources(),
  ]);

  const now = Date.now();
  const nextWeek = now + 7*24*60*60*1000;
  const workspaces = await Promise.all(projects.map(async project => {
    try { return { project, workspace: await getProjectWorkspace(project.id) }; }
    catch { return { project, workspace: { tasks: [], experiments: [] } as any }; }
  }));

  const projectRows = workspaces.map(({project,workspace}) => {
    const tasks = Array.isArray(workspace.tasks) ? workspace.tasks : [];
    const openTasks = tasks.filter((t:any) => !['done','cancelled'].includes(String(t.status))).length;
    const overdueCount = tasks.filter((t:any) => {
      const d=localDate(t.due_date);
      return d && d.getTime()<now && !['done','cancelled'].includes(String(t.status));
    }).length;
    const blockedCount = tasks.filter((t:any) => String(t.status)==='blocked').length;
    const healthScore = Math.max(0,Math.min(100,100-(overdueCount*15)-(blockedCount*10)));
    return {
      ...project,
      open_tasks: openTasks,
      experiment_count: Array.isArray(workspace.experiments) ? workspace.experiments.length : 0,
      health_score: healthScore,
      health: healthScore>=80 ? 'healthy' : healthScore>=60 ? 'watch' : 'attention',
    };
  });

  const overdue:any[] = [];
  const due:any[] = [];
  const recent:any[] = [];
  for(const {project,workspace} of workspaces) {
    const tasks=Array.isArray(workspace.tasks)?workspace.tasks:[];
    for(const task of tasks) {
      const d=localDate(task.due_date);
      if(d && !['done','cancelled'].includes(String(task.status))) {
        if(d.getTime()<now) overdue.push({...task,project_id:project.id,project_name:project.name});
        else if(d.getTime()<=nextWeek) due.push({...task,project_id:project.id,project_name:project.name});
      }
      if(task.created_at) recent.push({...task,project_id:project.id,project_name:project.name,type:'task'});
    }
    for(const experiment of (Array.isArray(workspace.experiments)?workspace.experiments:[])) {
      if(experiment.created_at) recent.push({...experiment,project_id:project.id,project_name:project.name,type:'experiment'});
    }
  }
  for(const note of notes) {
    if(note.created_at || note.updated_at) recent.push({...note,type:'note',title:note.title,created_at:note.updated_at||note.created_at});
  }
  for(const resource of resources) {
    if(resource.created_at || resource.updated_at) recent.push({...resource,type:'resource',title:resource.name,created_at:resource.updated_at||resource.created_at});
  }
  overdue.sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)));
  due.sort((a,b)=>String(a.due_date).localeCompare(String(b.due_date)));
  recent.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));

  const lowStock=items.filter(item => item.status==='low_stock' || Number(item.current_quantity)<=0)
    .sort((a,b)=>Number(a.current_quantity)-Number(b.current_quantity));

  return {
    metrics:{
      active_projects: projectRows.filter(p=>p.status==='active').length,
      overdue_tasks: overdue.length,
      due_next_7_days: due.length,
      low_stock: lowStock.length,
    },
    projects: projectRows,
    overdue,
    due,
    recent: recent.slice(0,30),
    low_stock: lowStock,
  };
}

export const getExperienceDashboard=async():Promise<ExperienceDashboard>=>{
  if(isTauriRuntime()) return getLocalExperienceDashboard();
  return json<ExperienceDashboard>('/experience/dashboard');
};
export const getNotifications=()=>json<{items:ExperienceNotification[];unread:number}>('/experience/notifications?limit=40');
export const markNotificationRead=(id:string)=>json<ExperienceNotification>(`/experience/notifications/${id}/read`,{method:'POST'});
export const markAllNotificationsRead=()=>json<{ok:boolean}>('/experience/notifications/read-all',{method:'POST'});
export const getProjectHealth=(id:string)=>json<any>(`/experience/project-health/${id}`);
export const getActivity=(limit=30)=>json<any[]>(`/experience/activity?limit=${limit}`);
