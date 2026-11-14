import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('./local-workbooks.ts',import.meta.url),'utf8');
function load({permissions=['inventory.import'],rows=[],current=true,error}={}){const exports={},calls=[];vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:p=>{
 if(p==='@tauri-apps/api/tauri')return{invoke:async(command,args)=>{calls.push([command,args]);if(error)throw Error(error);return command==='local_current_permissions'?permissions:rows;}};
 if(p==='./auth')return{captureAccountSession:()=>({accountId:'a'}),isAccountSessionCurrent:()=>current};
 if(p==='../lib/workbook')return{buildWorkbook:sheets=>sheets};throw Error(p);
}});return{api:exports,calls};}
test('offline templates require all permissions and reject changed sessions',async()=>{
 let c=load();await assert.rejects(c.api.localWorkbookTemplate(['inventory.import','finance.create_expense'],'Purchases',['Name'],[]),/requires/);
 c=load({current:false});await assert.rejects(c.api.localWorkbookTemplate('inventory.import','Inventory',['Name'],[]),/Account changed/);
 c=load();assert.equal((await c.api.localWorkbookTemplate('inventory.import','Inventory',['Name'],[]))[1].rows.length,9);
});
test('exports use one account-bound native snapshot and never retry over HTTP',async()=>{
 let c=load({rows:[{id:'id',date:'2026-11-06T00:00:00Z',amount:22,hidden:'secret'}]});
 const sheets=await c.api.localWorkbookExport('finance','Transactions',['Date','Amount'],['date','amount']);
 assert.deepEqual(JSON.parse(JSON.stringify(sheets[1].rows)),[['Date','Amount'],['2026-11-06',22]]);
 assert.deepEqual(JSON.parse(JSON.stringify(c.calls)),[['get_local_workbook_export',{domain:'finance',expectedAccountId:'a'}]]);
 c=load({error:'not synchronized'});await assert.rejects(c.api.localWorkbookExport('inventory','Inventory',[],[]),/not synchronized/);assert.equal(c.calls.length,1);
 c=load({current:false});await assert.rejects(c.api.localWorkbookExport('inventory','Inventory',[],[]),/Account changed/);
});
