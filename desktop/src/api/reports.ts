import { apiFetch } from './http';

export interface ReportsOverview { projects:any[]; inventory:any[]; tasks:any[]; experiments:any[]; resources:any[]; activity:any[]; generated_at:string; }
export async function getReportsOverview():Promise<ReportsOverview>{const r=await apiFetch('/reports/overview');if(!r.ok)throw new Error('Failed to load reports');return r.json();}
