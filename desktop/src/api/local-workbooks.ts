import {invoke} from '@tauri-apps/api/tauri';
import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {buildWorkbook,type WorkbookCell} from '../lib/workbook';
export async function localWorkbookTemplate(permission:string|string[],name:string,headers:readonly string[],instructions:string[][]):Promise<Blob>{
 const session=captureAccountSession();if(!session)throw Error('Sign in before creating a workbook');
 const permissions=await invoke<string[]>('local_current_permissions');
 if(!isAccountSessionCurrent(session))throw Error('Account changed while creating workbook');
 const required=typeof permission==='string'?[permission]:permission;
 if(!Array.isArray(permissions)||required.some(p=>!permissions.includes(p)))throw Error(`Workbook requires ${required.join(', ')}`);
 return buildWorkbook([{name:'Instructions',rows:instructions},{name,rows:[[...headers],...Array.from({length:8},()=>headers.map(()=>''))]}]);
}
export async function localWorkbookExport(domain:'inventory'|'finance',name:string,headers:readonly string[],fields:readonly string[]):Promise<Blob>{
 const session=captureAccountSession();if(!session)throw Error('Sign in before exporting');
 const rows=await invoke<Record<string,unknown>[]>('get_local_workbook_export',{domain,expectedAccountId:session.accountId});
 if(!isAccountSessionCurrent(session))throw Error('Account changed while exporting');
 if(!Array.isArray(rows))throw Error('Local export snapshot unavailable');
 const cells=rows.map(row=>fields.map(field=>{const value=row[field];return (field==='date'&&typeof value==='string'?value.slice(0,10):typeof value==='string'||typeof value==='number'||typeof value==='boolean'?value:null) as WorkbookCell;}));
 return buildWorkbook([{name:'Instructions',rows:[['Source','Authorized local snapshot; may contain pending changes and may not include changes from other PCs since the last sync.']]},{name,rows:[[...headers],...cells]}]);
}
