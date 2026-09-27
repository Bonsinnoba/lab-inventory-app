import test from 'node:test';
import assert from 'node:assert/strict';
import {LAB_WIDE_READ_PERMISSIONS,rolePermissions} from './permissions.js';

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
