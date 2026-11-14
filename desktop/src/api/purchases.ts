import { apiFetch, getApiErrorMessage } from './http';
import {isTauriRuntime} from '../lib/runtime';
import {localWorkbookTemplate} from './local-workbooks';
import {reviewLocalWorkbook} from './workbook-review';
import {preparePurchasePlan,type PurchasePlan} from './purchase-plan';
import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {invoke} from '@tauri-apps/api/tauri';
const plans=new WeakMap<File,PurchasePlan>();
const HEADERS=['Purchase Reference','Purchase Date','Supplier','Invoice Number','Project','Currency','LabOS ID','Item Name','SKU','Type','Category','Unit','Quantity','Unit Cost','Tax','Location','Notes'];

export type PurchasePreview = {
  template: string;
  filename: string;
  total_rows: number;
  ready_rows: number;
  error_rows: number;
  batches: number;
  new_items: number;
  errors: Array<{ row: number; errors: string[] }>;
  preview: Array<Record<string, unknown>>;
};


export async function downloadPurchaseTemplate(): Promise<Blob> {
  if(isTauriRuntime())return localWorkbookTemplate(['inventory.import','finance.create_expense'],'Purchases',HEADERS,[['Workflow','One row per purchased inventory line. Review before importing.'],['Matching','Use LabOS ID, otherwise SKU or exact Item Name. New items need a name and type.'],['Stock','Import records received quantity and a stock movement.'],['Finance','Each batch creates a purchase expense; purchase reference groups its lines.'],['Project','Optional exact existing project name.'],['Purchase Date','Required YYYY-MM-DD.']]);
  const response = await apiFetch('/excel/purchases/template');
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Unable to download the purchase template'));
  return response.blob();
}
export async function previewPurchaseExcel(file: File): Promise<PurchasePreview> {
  plans.delete(file);const session=captureAccountSession();if(!session)throw Error('Sign in before reviewing purchases');
  const result=await reviewLocalWorkbook(file,'purchases');if(!isAccountSessionCurrent(session))throw Error('Account changed while reviewing purchases');
  if(!('inventory_snapshot' in result)||!Array.isArray(result.inventory_snapshot))throw Error('Inventory snapshot unavailable');
  let newItems=result.new_items;if(!result.error_rows&&result.ready_rows){const plan=preparePurchasePlan(result.valid_rows,result.inventory_snapshot,session.accountId);plans.set(file,plan);newItems=plan.payload.rows.filter(r=>r.operation==='create').length;}
  const {valid_rows,inventory_snapshot,...preview}=result;return {...preview,new_items:newItems} as PurchasePreview;
}
export async function importPurchaseExcel(file: File): Promise<{ imported: number; batches: number; created_items: number; received_quantity: number; expense_total: number;pending_sync?:boolean }> {
  const session=captureAccountSession(),plan=plans.get(file);if(!session||!plan||session.accountId!==plan.accountId||!isAccountSessionCurrent(session))throw Error('Review this purchase workbook with the current account first');
  if(isTauriRuntime()){
   const result=await invoke<any>('import_local_purchase_workbook',{payloadJson:JSON.stringify(plan.payload),expectedSnapshotJson:plan.base,expectedAccountId:plan.accountId,changeId:plan.id});
   if(!isAccountSessionCurrent(session))throw Error('Account changed during purchase import');if(!result?.ok||result.imported!==plan.payload.lines.length)throw Error('Local purchase import was not confirmed; no server fallback attempted');plans.delete(file);return {...result,pending_sync:true};
  }
  const key='labos.purchase.workbook.device';let device=sessionStorage.getItem(key);if(!device){device=crypto.randomUUID();sessionStorage.setItem(key,device);}
  const response=await apiFetch('/sync/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:device,changes:[{change_id:plan.id,entity_type:'item',entity_id:null,operation:'purchase_import',payload:plan.payload}]})});
  if(!response.ok)throw Error(await getApiErrorMessage(response,'Purchase import failed'));const body=await response.json();if(!isAccountSessionCurrent(session))throw Error('Account changed during purchase import');
  const result=Array.isArray(body?.results)&&body.results.length===1&&body.results[0]?.change_id===plan.id?body.results[0]:null;if(result?.status!=='synced')throw Error(result?.error?.message||'Purchase import was not confirmed; retry the reviewed workbook');
  plans.delete(file);return {imported:plan.payload.lines.length,batches:plan.payload.batches.length,created_items:plan.payload.rows.filter(r=>r.operation==='create').length,received_quantity:plan.payload.lines.reduce((n,r)=>n+r.quantity,0),expense_total:plan.payload.lines.reduce((n,r)=>n+r.line_total,0)};
}
