import { apiFetch } from './http';
import {isTauriRuntime} from '../lib/runtime';
import {localWorkbookTemplate,localWorkbookExport} from './local-workbooks';
import {reviewLocalWorkbook} from './workbook-review';
import {invoke} from '@tauri-apps/api/tauri';
import {captureAccountSession,isAccountSessionCurrent} from './auth';
const HEADERS=['Transaction ID','Date','Direction','Type','Amount','Vendor','Notes','Item ID','Project ID','Funding Source ID','Budget Period ID'];
type FinancePlan={id:string;accountId:string;base:string;rows:Array<Record<string,unknown>>};
const plans=new WeakMap<File,FinancePlan>();

export interface FinancePreview {
  template: string;
  filename: string;
  total_rows: number;
  ready_rows: number;
  error_rows: number;
  creates: number;
  updates: number;
  errors: Array<{ row: number; errors: string[] }>;
  preview: Array<Record<string, unknown>>;
}

async function download(path: string): Promise<Blob> {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error('Unable to download Excel workbook');
  return response.blob();
}

export function downloadFinanceTemplate() { return isTauriRuntime()?localWorkbookTemplate('finance.import','Transactions',HEADERS,[['Workflow','Fill Transactions, review the preview, then import. Leave Transaction ID blank to create.'],['Date','Use YYYY-MM-DD.'],['Direction','income or expense; type must match the direction.'],['Funding','Donation, investment and grant require Funding Source ID.'],['Project expense','project_expense requires Project ID.']]):download('/excel/finance/template'); }
export function exportFinanceExcel() { return isTauriRuntime()?localWorkbookExport('finance','Transactions',HEADERS,['id','date','direction','type','amount','vendor','notes','item_id','project_id','funding_source_id','budget_period_id']):download('/excel/finance/export'); }

export async function previewFinanceExcel(file: File):Promise<FinancePreview> {
  plans.delete(file);const session=captureAccountSession();if(!session)throw Error('Sign in before reviewing finance');
  const result=await reviewLocalWorkbook(file,'finance');if(!isAccountSessionCurrent(session))throw Error('Account changed while reviewing finance');
  if(!('snapshot' in result)||!Array.isArray(result.snapshot))throw Error('Local finance snapshot unavailable');
  if(!result.error_rows&&result.ready_rows){const rows=result.valid_rows.map(row=>({operation:row.id?'update':'create',record:{...row,id:row.id||crypto.randomUUID(),date:row.date||new Date().toISOString().slice(0,10)},...(row.id?{expected_before:result.snapshot!.find((old:any)=>old.id===row.id)}:{})}));plans.set(file,{id:crypto.randomUUID(),accountId:session.accountId,base:JSON.stringify(result.snapshot),rows});}
  const {valid_rows,snapshot,...preview}=result;return preview as FinancePreview;
}
export async function importFinanceExcel(file: File): Promise<{ ok: boolean; imported: number; created: number; updated: number; pending_sync?:boolean }> {
    const session=captureAccountSession(),plan=plans.get(file);if(!session||!plan||session.accountId!==plan.accountId)throw Error('Review this workbook with the current account before importing');
  if(isTauriRuntime()){
    const result=await invoke<{ok:boolean;imported:number;created:number;updated:number}>('import_local_finance_rows',{rowsJson:JSON.stringify(plan.rows),expectedSnapshotJson:plan.base,expectedAccountId:plan.accountId,changeId:plan.id});
    if(!isAccountSessionCurrent(session))throw Error('Account changed while importing finance');if(!result?.ok)throw Error('Local financial import was not confirmed; no server fallback attempted');plans.delete(file);return {...result,pending_sync:true};
  }
  if(!isAccountSessionCurrent(session))throw Error('Account changed before finance import');
  const deviceKey='labos.finance.workbook.device';let device=sessionStorage.getItem(deviceKey);if(!device){device=crypto.randomUUID();sessionStorage.setItem(deviceKey,device);}
  const response = await apiFetch('/sync/push', { method: 'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:device,changes:[{change_id:plan.id,entity_type:'transaction',entity_id:null,operation:'import',payload:{rows:plan.rows}}]}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Financial Excel import failed');
  if(!isAccountSessionCurrent(session))throw Error('Account changed during finance import');
  const confirmation=Array.isArray(data?.results)&&data.results.length===1&&data.results[0]?.change_id===plan.id?data.results[0]:null;if(confirmation?.status!=='synced')throw Error(confirmation?.error?.message||'Financial import was not confirmed; retry this reviewed workbook');
  plans.delete(file);return {ok:true,imported:plan.rows.length,created:plan.rows.filter(r=>r.operation==='create').length,updated:plan.rows.filter(r=>r.operation==='update').length};
}
