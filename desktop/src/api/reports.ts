import { invoke } from '@tauri-apps/api/tauri';
import { apiFetch } from './http';
import { localBackend } from './local-backend';
import { captureAccountSession } from './auth';
import { getProjects, getProjectWorkspace } from './projects';
import { getLocalInventorySnapshot } from './local-inventory';
import { getAllResources } from './resources';
import { assertReadAccount, readLocalSections, readWithDeadline, type ReadAvailability } from './read-availability';

export interface ReportCount { status?:string; kind?:string; action?:string; count:number; }
export interface InventoryReportCount { type:string; status:string; unit:string; count:number; quantity:number; }
export interface ReportsOverview {
  projects:ReportCount[]; inventory:InventoryReportCount[]; tasks:ReportCount[];
  experiments:ReportCount[]; resources:ReportCount[]; activity:ReportCount[];
  generated_at:string; availability?:ReadAvailability;
}

function countBy(rows:Array<{id:string;[key:string]:any}>, key:'status'|'kind'):ReportCount[] {
  const counts=new Map<string,number>();
  for(const row of new Map(rows.map(row=>[row.id,row])).values()) {
    const value=String(row[key]??'unknown');
    counts.set(value,(counts.get(value)??0)+1);
  }
  return Array.from(counts,([value,count])=>({[key]:value,count}))
    .sort((a,b)=>String((a as any)[key]).localeCompare(String((b as any)[key])));
}

async function requireReportAccess() {
  // Consult native lease/permissions directly. An unavailable API is not needed
  // to authorize a local projection; source repositories enforce their own access.
  const permissions=await invoke<string[]>('local_current_permissions');
  if(!permissions.includes('reports.view'))throw new Error('Reports access required');
}

async function getLocalReportsOverview():Promise<ReportsOverview> {
  const session=captureAccountSession();
  assertReadAccount(session);
  await requireReportAccess();
  const {values,availability}=await readLocalSections({
    projects:getProjects,inventory:getLocalInventorySnapshot,resources:getAllResources,
  },session);
  const tasks:any[]=[],experiments:any[]=[];
  let taskSources=0,experimentSources=0;
  const projects=values.projects??[];
  // Bound native fan-out for large workspaces. A failed project leaves other
  // readable projects visible, but its absence must not become a complete total.
  for(let start=0;start<projects.length;start+=6) {
    assertReadAccount(session);
    const workspaces=await Promise.allSettled(projects.slice(start,start+6).map(
      project=>readWithDeadline(()=>getProjectWorkspace(project.id))));
    assertReadAccount(session);
    for(const result of workspaces) {
      if(result.status!=='fulfilled')continue;
      if(Array.isArray(result.value.tasks)){tasks.push(...result.value.tasks);taskSources++;}
      if(Array.isArray(result.value.experiments)){experiments.push(...result.value.experiments);experimentSources++;}
    }
  }
  const sourceState=(count:number)=>values.projects===null?'unavailable':
    count===projects.length?'available':count>0?'partial':'unavailable';
  availability.sections.tasks=sourceState(taskSources);
  availability.sections.experiments=sourceState(experimentSources);
  // There is not yet a replicated audit ledger. Never fabricate an empty
  // 30-day audit report from entity modification times or workspace activity.
  availability.sections.activity='unavailable';
  const inventory=new Map<string,InventoryReportCount>();
  for(const item of new Map((values.inventory??[]).map(item=>[item.id,item])).values()) {
    const type=String(item.type??'unknown'),status=String(item.status??'unknown'),unit=item.unit??'';
    const key=JSON.stringify([type,status,unit]);
    const row=inventory.get(key)??{type,status,unit,count:0,quantity:0};
    const quantity=Number(item.current_quantity);
    if(item.current_quantity==null||!Number.isFinite(quantity)) {
      availability.sections.inventory='unavailable';
      inventory.clear();
      break;
    }
    row.count++;row.quantity+=quantity;inventory.set(key,row);
  }
  await requireReportAccess();
  assertReadAccount(session);
  return {
    projects:countBy(projects,'status'),inventory:Array.from(inventory.values()).sort(
      (a,b)=>a.type.localeCompare(b.type)||a.status.localeCompare(b.status)||a.unit.localeCompare(b.unit)),
    tasks:countBy(tasks,'status'),experiments:countBy(experiments,'status'),
    resources:countBy(values.resources??[],'kind'),activity:[],
    generated_at:new Date().toISOString(),availability,
  };
}

export async function getReportsOverview():Promise<ReportsOverview> {
  if(localBackend.isAvailable())return getLocalReportsOverview();
  const response=await apiFetch('/reports/overview');
  if(!response.ok)throw new Error('Failed to load reports');
  return response.json();
}
