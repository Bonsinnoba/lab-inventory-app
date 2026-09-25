import test from 'node:test';
import assert from 'node:assert/strict';
import {findMissingBom,enrichOutstandingRequirements} from './operations-calculations.ts';

test('BOM: preferred stock covers required quantity',()=>{
  assert.deepEqual(findMissingBom([{id:'a',required_quantity:3,preferred_item_id:'x'}],[{id:'x',current_quantity:3}]),[]);
});
test('BOM: insufficient preferred stock and no alternative is missing',()=>{
  assert.deepEqual(findMissingBom([{id:'a',required_quantity:4,preferred_item_id:'x'}],[{id:'x',current_quantity:3}]).map(x=>x.id),['a']);
});
test('BOM: alternative stock independently covers line',()=>{
  assert.deepEqual(findMissingBom([{id:'a',required_quantity:'4',preferred_item_id:'x',alternative_item_id:'y'}],[{id:'x',current_quantity:2},{id:'y',current_quantity:4}]),[]);
});
test('BOM: absent match, invalid quantities and partial stock are not falsely covered',()=>{
  const lines=[{id:'absent',required_quantity:2,preferred_item_id:'unknown'},{id:'invalid',required_quantity:'invalid',preferred_item_id:'x'},{id:'partial',required_quantity:5,preferred_item_id:'x',alternative_item_id:'y'}];
  assert.deepEqual(findMissingBom(lines,[{id:'x',current_quantity:3},{id:'y',current_quantity:2}]).map(x=>x.id),['absent','invalid','partial']);
});
test('BOM: independently evaluates competing projects without reserving stock',()=>{
  const line={id:'a',required_quantity:3,preferred_item_id:'x'};
  assert.deepEqual(findMissingBom([line,{...line,id:'b'}],[{id:'x',current_quantity:3}]),[]);
});
test('Requirements: exclude fulfilled and cancelled; enrich active with local stock',()=>{
  const rows=[{status:'pending',preferred_item_id:'x',name:'A'},{status:'fulfilled',preferred_item_id:'x',name:'B'},{status:'cancelled',name:'C'}];
  assert.deepEqual(enrichOutstandingRequirements(rows,[{id:'x',name:'Resistor',current_quantity:8}]),[{status:'pending',preferred_item_id:'x',name:'A',preferred_item_name:'Resistor',preferred_quantity:8}]);
});
test('Requirements: retain existing name and quantity when inventory match is absent',()=>{
  const rows=[{status:'pending',preferred_item_id:'missing',preferred_item_name:'Saved',preferred_quantity:2}];
  assert.deepEqual(enrichOutstandingRequirements(rows,[])[0].preferred_item_name,'Saved');
  assert.equal(enrichOutstandingRequirements(rows,[])[0].preferred_quantity,2);
});
