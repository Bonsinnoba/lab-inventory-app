import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./engineering.js', import.meta.url), 'utf8');

test('engineering lists and compare apply per-record visibility', () => {
  assert.match(source, /canReadEngineeringRecord[\s\S]*?canReadEntity/);
  assert.match(source, /router\.get\('\/calculations'[\s\S]*?canReadEngineeringRecord\(row,'engineering_calculation',req\)/);
  assert.match(source, /router\.get\('\/tests'[\s\S]*?canReadEngineeringRecord\(row,'engineering_test',req\)/);
  assert.match(source, /router\.get\('\/compare'[\s\S]*?canReadEngineeringRecord\(row,'engineering_calculation',req\)/);
});

test('restricted engineering mutations require an edit grant', () => {
  assert.match(source, /canEditEngineeringRecord[\s\S]*?canEditRestrictedEntity/);
  assert.match(source, /router\.delete\('\/calculations\/:id'[\s\S]*?canEditEngineeringRecord/);
  assert.match(source, /router\.patch\('\/tests\/:id'[\s\S]*?canEditEngineeringRecord/);
  assert.match(source, /router\.delete\('\/tests\/:id'[\s\S]*?canEditEngineeringRecord/);
});
