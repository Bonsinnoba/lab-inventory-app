import { apiFetch, getApiErrorMessage } from './http';
export interface AutomationDue { maintenance:any[]; calibration:any[]; tasks:any[]; }
export async function getAutomationDue():Promise<AutomationDue>{const r=await apiFetch('/automation/due');if(!r.ok)throw new Error('Failed to load automation due items');return r.json();}
export async function runAutomation():Promise<{created:number;due:AutomationDue}>{const r=await apiFetch('/automation/run',{method:'POST'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to run automation'));return r.json();}
