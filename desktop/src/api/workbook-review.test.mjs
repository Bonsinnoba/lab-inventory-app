import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('./workbook-review.ts',import.meta.url),'utf8'),exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:p=>{if(['./auth','./excel','./http','../lib/runtime','@tauri-apps/api/tauri'].includes(p))return{};throw Error(p);}});
const id='20000000-0000-4000-8000-000000000001';
const finance=(records,context={permissions:['finance.create_expense']})=>exports.validateFinanceWorkbook([exports.FINANCE_HEADERS,...records.map(r=>exports.FINANCE_HEADERS.map(h=>r[h]??''))],'finance.xlsx',context);
const purchase=(records,context={permissions:['finance.create_expense','inventory.create'],items:[]})=>exports.validatePurchaseWorkbook([exports.PURCHASE_HEADERS,...records.map(r=>exports.PURCHASE_HEADERS.map(h=>r[h]??''))],'purchase.xlsx',context);
test('finance preview validates dates, amount, direction and required references',()=>{
 const result=finance([{Direction:'expense',Type:'other',Amount:23,Date:'2026-11-06'},{Direction:'income',Type:'grant',Amount:-1,Date:'2026-02-30'},{Direction:'expense',Type:'other',Amount:1,'Item ID':id}]);
 assert.equal(result.ready_rows,1);assert.equal(result.error_rows,2);assert.match(result.errors[0].errors.join(),/Date/);assert.match(result.errors[1].errors.join(),/authorized local/);
});
test('finance preview normalizes IDs and rejects duplicate updates and unauthorized direction changes',()=>{
 const row={'Transaction ID':id,Direction:'income',Type:'other_income',Amount:10};
 const result=finance([row,{...row,'Transaction ID':id.replaceAll('-','')}],{permissions:['finance.edit'],transactions:[{id,direction:'expense'}]});
 assert.equal(result.error_rows,2);assert.match(result.errors[0].errors.join(),/finance.create_income/);assert.match(result.errors[1].errors.join(),/Duplicate/);
});
test('purchase preview does not fall back from a missing explicit UUID to a name match',()=>{
 const result=purchase([{'Purchase Reference':'p','Purchase Date':'2026-11-06','LabOS ID':id,'Item Name':'known',Type:'tool',Quantity:2,'Unit Cost':5}],{permissions:['finance.create_expense','inventory.create'],items:[{id:'30000000-0000-4000-8000-000000000001',name:'known',type:'tool'}]});
 assert.equal(result.error_rows,1);assert.match(result.errors[0].errors.join(),/LabOS ID/);
});
test('purchase preview rejects ambiguous matches and inconsistent batch metadata',()=>{
 const row={'Purchase Reference':'p','Purchase Date':'2026-11-06','Item Name':'new',Type:'tool',Quantity:2};
 let result=purchase([row,{...row,Supplier:'different'}]);assert.equal(result.error_rows,1);assert.match(result.errors[0].errors.join(),/share date/);
 result=purchase([row],{permissions:['finance.create_expense','inventory.create'],items:[{id,name:'new',type:'tool'},{id:'30000000-0000-4000-8000-000000000001',name:'new',type:'tool'}]});assert.match(result.errors[0].errors.join(),/Ambiguous/);
});
test('purchase preview computes received expense and enforces existing-item stock permissions',()=>{
 const row={'Purchase Reference':'p','Purchase Date':46332,'Item Name':'known',Type:'tool',Quantity:2,'Unit Cost':5,Tax:1};
 const result=purchase([row],{permissions:['finance.create_expense','inventory.edit','inventory.adjust_stock'],items:[{id,name:'known',type:'tool'}]});
 assert.equal(result.ready_rows,1);assert.equal(result.valid_rows[0].line_total,11);assert.equal(result.valid_rows[0].item_id,id);assert.equal(result.new_items,0);
 const denied=purchase([row],{permissions:['finance.create_expense','inventory.edit'],items:[{id,name:'known',type:'tool'}]});assert.match(denied.errors[0].errors.join(),/inventory.adjust_stock/);
});
