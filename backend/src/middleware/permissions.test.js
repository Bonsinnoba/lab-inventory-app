import test from 'node:test';
import assert from 'node:assert/strict';
import {LAB_WIDE_READ_PERMISSIONS,rolePermissions,projectFinancialProjection,projectFinancialSummaryProjection} from './permissions.js';

test('ordinary laboratory reads do not include financial or administrative views',()=>{
 for(const permission of ['inventory.view','projects.view','notes.view','resources.view','engineering.view','automation.view'])
  assert.ok(LAB_WIDE_READ_PERMISSIONS.has(permission),permission);
 for(const permission of ['finance.view','finance.view_sensitive','reports.view','audit.view','users.view'])
  assert.ok(!LAB_WIDE_READ_PERMISSIONS.has(permission),permission);
});
test('lab-wide read access does not grant write or approval permissions',()=>{
 assert.ok([...LAB_WIDE_READ_PERMISSIONS].every(permission=>permission.endsWith('.view')));
 for(const permission of ['projects.edit','projects.delete','projects.manage_members','finance.edit','finance.delete'])
  assert.ok(!LAB_WIDE_READ_PERMISSIONS.has(permission),permission);
});
test('financial role baselines remain distinct from ordinary read access',()=>{
 assert.ok(!rolePermissions('viewer').has('finance.view_sensitive'));
 assert.ok(rolePermissions('admin').has('finance.view_sensitive'));
});

test('project financial projection removes financial fields without mutating source',()=>{
 const original={id:'p1',name:'Lab project',budget:100,total_spent:20,actual_expense:20,project_income:10,allocated_inventory_value:30,budget_remaining:80,net_spend:10};
 const ordinary=projectFinancialProjection(original,new Set(['projects.view']));
 assert.deepEqual(ordinary,{id:'p1',name:'Lab project'});
 assert.equal(original.budget,100);
 assert.equal(projectFinancialProjection(original,new Set(['finance.view'])).budget,100);
});

test('future and unknown project columns fail closed for ordinary readers',()=>{
 const source={id:'p2',name:'Example',description:'ordinary',budget:100,secret_future_financial_column:999,internal_future_column:'private'};
 const projected=projectFinancialProjection(source,new Set(['projects.view']));
 assert.deepEqual(projected,{id:'p2',name:'Example',description:'ordinary'});
 assert.equal(projectFinancialProjection(source,new Set(['finance.view'])).secret_future_financial_column,undefined);
});

test('standard finance cannot read unexpected sensitive financial columns',()=>{
 const source={id:'p1',name:'Project',budget:100,confidential_bank_account:'secret'};
 const standard=projectFinancialProjection(source,new Set(['finance.view']));
 assert.equal(standard.budget,100);
 assert.ok(!Object.hasOwn(standard,'confidential_bank_account'));
 assert.equal(projectFinancialProjection(source,new Set(['finance.view','finance.view_sensitive'])).confidential_bank_account,'secret');
 const summary={project_id:'p1',name:'Project',actual_expense:20,private_supplier_details:'secret'};
 assert.deepEqual(projectFinancialSummaryProjection(summary,new Set(['finance.view'])),{project_id:'p1',name:'Project',actual_expense:20});
 assert.equal(projectFinancialSummaryProjection(summary,new Set(['projects.view'])),null);
});

test('sensitive finance grant alone cannot bypass base finance permission',()=>{
 const source={id:'p3',name:'Project',budget:500,confidential_bank_account:'private'};
 const permissions=new Set(['finance.view_sensitive']);
 assert.deepEqual(projectFinancialProjection(source,permissions),{id:'p3',name:'Project'});
 assert.equal(projectFinancialSummaryProjection({project_id:'p3',actual_expense:20},permissions),null);
});
