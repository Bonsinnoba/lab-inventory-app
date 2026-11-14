import {invoke} from '@tauri-apps/api/tauri';
import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {parseWorkbookSheet} from './excel';
import {isTauriRuntime} from '../lib/runtime';
import {apiFetch,getApiErrorMessage} from './http';
type Row=Record<string,any>;
export type ReviewContext={permissions:string[];items?:Row[]|null;projects?:Row[];transactions?:Row[];funding_sources?:Row[];budget_periods?:Row[]};
export const FINANCE_HEADERS=['Transaction ID','Date','Direction','Type','Amount','Vendor','Notes','Item ID','Project ID','Funding Source ID','Budget Period ID'];
export const PURCHASE_HEADERS=['Purchase Reference','Purchase Date','Supplier','Invoice Number','Project','Currency','LabOS ID','Item Name','SKU','Type','Category','Unit','Quantity','Unit Cost','Tax','Location','Notes'];
const text=(v:unknown)=>v==null?'':String(v).trim();
const canonical=(v:unknown)=>{const s=text(v).replaceAll('-','').toLowerCase();return /^[a-f0-9]{32}$/.test(s)?s.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5'):null;};
function rowsFromSheet(rows:unknown[][],headers:string[]):Row[]{
 const actual=(rows[0]||[]).map(text),missing=headers.filter(h=>!actual.includes(h));
 if(missing.length||new Set(actual.filter(Boolean)).size!==actual.filter(Boolean).length)throw Error(`Invalid workbook columns${missing.length?`: ${missing.join(', ')}`:': duplicate headers'}`);
 const rowsOut=rows.slice(1).map(row=>Object.fromEntries(headers.map(h=>[h,row[actual.indexOf(h)]??'']))).filter(row=>Object.values(row).some(v=>text(v)));
 if(rowsOut.length>500)throw Error('Review at most 500 workbook rows at a time');return rowsOut;
}
function date(value:unknown,errors:string[],required=false):string|null{
 let s=text(value);if(typeof value==='number'&&Number.isFinite(value)&&value>=1&&value<=2958465)s=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
 if(!s){if(required)errors.push('Date is required');return null;}
 const d=new Date(`${s}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s){errors.push('Date must be a valid YYYY-MM-DD');return null;}return s;
}
function number(value:unknown,field:string,errors:string[],positive=false,required=false):number|null{if(!text(value)){if(required)errors.push(`${field} is required`);return null;}const n=Number(value);if(!Number.isFinite(n)||(positive?n<=0:n<0)){errors.push(`${field} must be ${positive?'greater than zero':'zero or greater'}`);return null;}return n;}
function reference(value:unknown,field:string,known:Row[]|null|undefined,errors:string[]):string|null{if(!text(value))return null;const id=canonical(value);if(!id)errors.push(`${field} must be a UUID`);else if(!known?.some(row=>canonical(row.id)===id))errors.push(`${field} is not present in the authorized local snapshot`);return id;}
function permission(context:ReviewContext,key:string,errors:string[]){if(!context.permissions.includes(key))errors.push(`Permission required: ${key}`);}
export async function reviewLocalWorkbook(file:File,domain:'finance'|'purchases'){
 const session=captureAccountSession();if(!session)throw Error('Sign in before reviewing a workbook');
 let context:ReviewContext;
 if(isTauriRuntime())context=await invoke<ReviewContext>('get_local_workbook_context',{domain,expectedAccountId:session.accountId});
 else{
  const read=async(path:string)=>{const response=await apiFetch(path,{cache:'no-store'});if(!response.ok)throw Error(await getApiErrorMessage(response,'Workbook reference data unavailable'));const body=await response.json();if(!isAccountSessionCurrent(session))throw Error('Account changed while loading workbook references');return body;};
  const authority=await read('/auth/me/permissions');if(authority?.user?.id!==session.accountId||!Array.isArray(authority.permissions))throw Error('Workbook authority unavailable');
  const permissions=authority.permissions.filter((p:any)=>p.effective===true).map((p:any)=>p.permission);
  for(const p of domain==='finance'?['finance.import','finance.view','finance.view_sensitive']:['inventory.import','inventory.view','finance.view','finance.create_expense'])if(!permissions.includes(p))throw Error(`Workbook requires ${p}`);
  const [items,projects]=await Promise.all([permissions.includes('inventory.view')?read('/items'):null,permissions.includes('projects.view')?read('/projects'):null]);
  context={permissions,items,projects};if(items!==null&&!Array.isArray(items)||projects!==null&&!Array.isArray(projects))throw Error('Invalid workbook reference snapshot');
  if(domain==='finance'){const finance=await read('/sync/finance/pull');if(finance.snapshot_complete!==true||finance.sensitive_access!==true||![finance.transactions,finance.funding_sources,finance.budget_periods].every(Array.isArray))throw Error('Complete sensitive finance snapshot required');Object.assign(context,{transactions:finance.transactions,funding_sources:finance.funding_sources,budget_periods:finance.budget_periods});}
 }
 if(!isAccountSessionCurrent(session))throw Error('Account changed while reviewing workbook');
 if(!context||!Array.isArray(context.permissions))throw Error('Local workbook context unavailable');
 const rows=await parseWorkbookSheet(file,domain==='finance'?'Transactions':'Purchases');
 if(!isAccountSessionCurrent(session))throw Error('Account changed while reading workbook');
 return domain==='finance'?validateFinanceWorkbook(rows,file.name,context):validatePurchaseWorkbook(rows,file.name,context);
}
export function validateFinanceWorkbook(sheet:unknown[][],filename:string,context:ReviewContext){
 const rows=rowsFromSheet(sheet,FINANCE_HEADERS),valid:Row[]=[],errors:Array<{row:number;errors:string[]}>=[],seen=new Set<string>();
 rows.forEach((r,index)=>{
  const e:string[]=[],id=reference(r['Transaction ID'],'Transaction ID',context.transactions,e),direction=text(r.Direction).toLowerCase(),type=text(r.Type).toLowerCase();
  const types=direction==='income'?['donation','investment','grant','lab_allocation','other_income']:direction==='expense'?['purchase','repair','replacement','project_expense','other']:[];
  if(!types.includes(type))e.push('Direction and transaction type must match');
  if(id&&seen.has(id))e.push('Duplicate Transaction ID in workbook');if(id)seen.add(id);
  const amount=number(r.Amount,'Amount',e,true,true),day=date(r.Date,e);
  const item=reference(r['Item ID'],'Item ID',context.items,e),project=reference(r['Project ID'],'Project ID',context.projects,e),funding=reference(r['Funding Source ID'],'Funding Source ID',context.funding_sources,e),budget=reference(r['Budget Period ID'],'Budget Period ID',context.budget_periods,e);
  if(direction==='income'&&['donation','investment','grant'].includes(type)&&!funding)e.push('Funding Source ID is required');
  if(type==='project_expense'&&!project)e.push('Project ID is required for project_expense');
  permission(context,id?'finance.edit':direction==='income'?'finance.create_income':'finance.create_expense',e);
  const previous=id?context.transactions?.find(row=>canonical(row.id)===id):null;
  if(id&&previous?.direction!==direction)permission(context,direction==='income'?'finance.create_income':'finance.create_expense',e);
  if(project||previous?.project_id)permission(context,'projects.edit',e);
  const record={id,date:day,direction,type,amount,vendor:text(r.Vendor)||null,notes:text(r.Notes)||null,item_id:item,project_id:project,funding_source_id:funding,budget_period_id:budget};
  if(e.length)errors.push({row:index+2,errors:e});else valid.push(record);
 });
 return{template:'finance-transactions-v1',filename,total_rows:rows.length,ready_rows:valid.length,error_rows:errors.length,creates:valid.filter(r=>!r.id).length,updates:valid.filter(r=>r.id).length,errors,preview:valid.slice(0,25),valid_rows:valid,snapshot:context.transactions,source:'local' as const};
}
export function validatePurchaseWorkbook(sheet:unknown[][],filename:string,context:ReviewContext){
 const rows=rowsFromSheet(sheet,PURCHASE_HEADERS),valid:Row[]=[],errors:Array<{row:number;errors:string[]}>=[],batchMetadata=new Map<string,string>();
 rows.forEach((r,index)=>{
  const e:string[]=[],referenceName=text(r['Purchase Reference']),day=date(r['Purchase Date'],e,true),quantity=number(r.Quantity,'Quantity',e,true,true),unitCost=number(r['Unit Cost'],'Unit Cost',e)??0,tax=number(r.Tax,'Tax',e)??0;
  if(!referenceName)e.push('Purchase Reference is required');
  const suppliedId=text(r['LabOS ID']),sku=text(r.SKU),name=text(r['Item Name']);let item:Row|undefined;
  if(suppliedId){const id=reference(suppliedId,'LabOS ID',context.items,e);item=context.items?.find(row=>canonical(row.id)===id);}
  else {const matches=sku?context.items?.filter(row=>text(row.sku).toLowerCase()===sku.toLowerCase()):name?context.items?.filter(row=>text(row.name).toLowerCase()===name.toLowerCase()):[];if((matches?.length??0)>1)e.push('Ambiguous item match; provide LabOS ID');else item=matches?.[0];}
  const type=text(r.Type)||item?.type;if(!name&&!item)e.push('Item Name is required for new items');
  if(!['tool','component','equipment','material','chemical','consumable','instrument','spare_part'].includes(type))e.push('Invalid inventory type');
  const projectName=text(r.Project),projects=context.projects?.filter(p=>text(p.name).toLowerCase()===projectName.toLowerCase());
  if(projectName&&projects?.length!==1)e.push('Project must match exactly one authorized local project');const project=projectName&&projects?.length===1?projects[0].id:null;
  const currency=text(r.Currency)||'USD',supplier=text(r.Supplier)||null,invoice=text(r['Invoice Number'])||null;
  const metadata=JSON.stringify([day,supplier,invoice,project,currency]);if(batchMetadata.has(referenceName)&&batchMetadata.get(referenceName)!==metadata)e.push('Lines with the same Purchase Reference must share date, supplier, invoice, project and currency');else batchMetadata.set(referenceName,metadata);
  permission(context,'finance.create_expense',e);for(const p of item?['inventory.edit','inventory.adjust_stock']:['inventory.create'])permission(context,p,e);if(project)permission(context,'projects.edit',e);
  const total=Math.round(((quantity??0)*unitCost+tax)*100)/100;if(!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)e.push('Purchase line total exceeds supported range');
  if(e.length)errors.push({row:index+2,errors:e});else valid.push({row:index+2,reference:referenceName,purchase_date:day,supplier,invoice_number:invoice,project_id:project,currency,item_id:item?.id||null,item_name:name||item?.name,sku:sku||item?.sku||null,type,category:text(r.Category)||item?.category||null,unit:text(r.Unit)||item?.unit||null,quantity,unit_cost:unitCost,tax,line_total:total,storage_location:text(r.Location)||item?.storage_location||null,notes:text(r.Notes)||null});
 });
 return{template:'bulk-purchase-v1',filename,total_rows:rows.length,ready_rows:valid.length,error_rows:errors.length,batches:new Set(valid.map(r=>r.reference)).size,new_items:valid.filter(r=>!r.item_id).length,errors,preview:valid.slice(0,25),valid_rows:valid,inventory_snapshot:context.items,source:'local' as const};
}
