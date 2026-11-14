import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load({native=true}={}){let current=true,failure=true,requests=0;const calls=[],httpCalls=[],storage=new Map(),exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./excel-finance.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:{randomUUID},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},require:p=>{
 if(p==='./http')return{apiFetch:async(path,options)=>{requests++;httpCalls.push([path,options]);if(failure)throw Error('HTTP response lost');const id=JSON.parse(options.body).changes[0].change_id;return{ok:true,json:async()=>({results:[{change_id:id,status:'synced',result:{acknowledged:true}}]})};}};
 if(p==='../lib/runtime')return{isTauriRuntime:()=>native};if(p==='./local-workbooks')return{};
 if(p==='./auth')return{captureAccountSession:()=>({accountId:'a'}),isAccountSessionCurrent:()=>current};
 if(p==='./workbook-review')return{reviewLocalWorkbook:async()=>({template:'finance-transactions-v1',filename:'test.xlsx',snapshot:[],total_rows:1,ready_rows:1,error_rows:0,creates:1,updates:0,errors:[],preview:[],valid_rows:[{id:null,date:null,direction:'expense',type:'other',amount:12}]})};
 if(p==='@tauri-apps/api/tauri')return{invoke:async(command,args)=>{calls.push([command,JSON.parse(JSON.stringify(args))]);if(failure)throw Error('native response lost');return{ok:true,imported:1,created:1,updated:0};}};throw Error(p);
}});return{api:exports,calls,httpCalls,requests:()=>requests,succeed:()=>{failure=false;},switchAccount:()=>{current=false;}};}
test('finance import is review-bound, retry-stable and has no server fallback',async()=>{
 const c=load(),file={name:'test.xlsx'};await assert.rejects(c.api.importFinanceExcel(file),/Review/);await c.api.previewFinanceExcel(file);
 await assert.rejects(c.api.importFinanceExcel(file),/response lost/);c.succeed();await c.api.importFinanceExcel(file);
 assert.deepEqual(c.calls[0],c.calls[1]);const payload=JSON.parse(c.calls[0][1].rowsJson);assert.match(payload[0].record.id,/^[a-f0-9-]{36}$/);assert.match(payload[0].record.date,/^\d{4}-\d{2}-\d{2}$/);assert.equal(c.requests(),0);
 await assert.rejects(c.api.importFinanceExcel(file),/Review/);
});
test('account change during finance preview cannot create an import plan',async()=>{const c=load(),file={name:'x.xlsx'};c.switchAccount();await assert.rejects(c.api.previewFinanceExcel(file),/Account changed/);await assert.rejects(c.api.importFinanceExcel(file),/Review/);assert.equal(c.requests(),0);});
test('browser finance imports share the broker batch and preserve uncertain retry identity',async()=>{const c=load({native:false}),file={name:'x.xlsx'};await c.api.previewFinanceExcel(file);await assert.rejects(c.api.importFinanceExcel(file),/HTTP response lost/);c.succeed();assert.equal((await c.api.importFinanceExcel(file)).created,1);assert.equal(c.httpCalls[0][0],'/sync/push');assert.deepEqual(c.httpCalls[0],c.httpCalls[1]);assert.equal(c.calls.length,0);});
