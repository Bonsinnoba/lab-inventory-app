import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const id='20000000-0000-4000-8000-000000000001';
const source=readFileSync(new URL('./excel.ts',import.meta.url),'utf8');
function load(){
 const exports={};let requests=0;
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:{randomUUID},require:p=>{
   if(p==='./http'||p==='./inventory-http')return new Proxy({},{get:()=>async()=>{requests++;throw Error('unexpected HTTP')}});
   if(p==='./auth')return{captureAccountSession:()=>({accountId:'a'}),isAccountSessionCurrent:()=>true};
   if(p==='./local-inventory')return{getLocalInventorySnapshot:async()=>null};
   if(p==='../lib/runtime')return{isTauriRuntime:()=>true};
   if(p==='@tauri-apps/api/tauri')return{invoke:async()=>{throw Error('unexpected IPC')}};
   if(p==='./items')return{};throw Error(p);
 }});return{api:exports,requests:()=>requests};
}
test('import plans classify new UUID rows explicitly and freeze preview versions',()=>{
 const {api}=load(),local=[{id,sync_version:7,name:'old'}],rows=[{id:null,name:'new'},{id,name:'edited'}];
 const p=api.prepareInventoryImport(rows,local,'a');assert.equal(p.rows[0].operation,'create');assert.match(p.rows[0].record.id,/^[0-9a-f-]{36}$/);assert.equal(p.rows[1].operation,'update');assert.equal(p.bases[1].version,7);local[0].sync_version=8;assert.equal(JSON.parse(p.base)[0].sync_version,7);
 assert.throws(()=>api.prepareInventoryImport([{id,name:'x'}],[{id}],'a'),/Refresh/);assert.throws(()=>api.prepareInventoryImport([],[],'a'),/1–500/);
});
test('inventory workbook UUID normalization catches compact/canonical duplicates',()=>{
 const {api}=load(),headers=Array.from(source.matchAll(/^  '([^\n]+)'/gm));
 const headerBlock=source.split('const INVENTORY_HEADERS = [')[1].split('] as const')[0];const names=Array.from(headerBlock.matchAll(/'([^']+)'/g),m=>m[1]);
 const row=record=>names.map(h=>record[h]??'');const one=row({'LabOS ID':id,Name:'one',Type:'tool'}),two=row({'LabOS ID':id.replaceAll('-',''),Name:'two',Type:'tool'});
 const result=api.validateLocalInventoryRows([names,one,two],'test.xlsx',[{id,sync_version:1}]);assert.equal(result.error_rows,1);assert.match(result.errors[0].errors.join(),/Duplicate/);
});
test('missing desktop snapshot and unreviewed import cannot reach server writes',async()=>{
 const c=load();await assert.rejects(c.api.previewInventoryExcel({name:'test.xlsx'}),/Local inventory/);await assert.rejects(c.api.importInventoryExcel({name:'test.xlsx'}),/Review/);assert.equal(c.requests(),0);
});
