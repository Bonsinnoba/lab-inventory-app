import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./project-plan-refresh.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const form={name:'Capacitor',required_quantity:'2',preferred_item_id:'',alternative_item_id:''};
test('BOM demand does not require inventory already selected',()=>{
 for(const ids of [{},{preferred_item_id:'a'},{alternative_item_id:'b'},{preferred_item_id:'a',alternative_item_id:'b'}]) assert.equal(exports.validBomForm({...form,...ids}),true);
 assert.equal(exports.validBomForm({...form,preferred_item_id:'a',alternative_item_id:'a'}),false);
});
test('invalid demand still cannot be submitted',()=>{
 for(const required_quantity of ['','0','-1','NaN','Infinity','abc']) assert.equal(exports.validBomForm({...form,required_quantity}),false);
 assert.equal(exports.validBomForm({...form,name:'  '}),false);
});
test('plan mutations invalidate connected projections without clearing cached data',async()=>{
 const keys=[];
 await exports.refreshProjectPlan({invalidateQueries:async({queryKey})=>keys.push(queryKey.join('/'))},'p');
 assert.deepEqual(keys,['project-bom/p','project-workspace/p','project-review/p','project-context/p','project-reservations/p','task-experiments/p','task-attachments/p','experiment-attachments/p','experiment-measurements/p','experiment-observations/p','experiment-revisions/p','experiment-history/p','project/p','projects','experience/dashboard']);
});
