import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./knowledge.js', import.meta.url), 'utf8');
const relationshipAccess = readFileSync(new URL('../middleware/knowledge-relationship-access.js', import.meta.url), 'utf8');

test('knowledge records use record visibility, not project membership alone', () => {
  assert.match(source, /const projectFilter = \(alias\) => visibilityReadSql\(/);
  assert.match(source, /f: 'finding', r: 'result', c: 'engineering_calculation'/);
  assert.match(source, /roleParameter: '\$1'/);
  assert.match(source, /userIdParameter: '\$2'/);
  assert.doesNotMatch(source, /const projectFilter = \(alias\) => `\(/);
});

test('knowledge overview and tags inherit Note and Resource access rules', () => {
  assert.match(source, /noteOverviewVisibility = visibilityReadSql\(\{ alias: 'n', entityType: 'note'/);
  assert.match(source, /async function visibleKnowledgeResources[\s\S]*?getResourceAccess\(row\.id, user\)/);
  assert.match(source, /router\.get\('\/overview'[\s\S]*?visibleKnowledgeResources\(req\.user\)/);
  assert.match(source, /router\.get\('\/tags'[\s\S]*?visibleKnowledgeResources\(req\.user\)/);
});

test('relationships are filtered by both readable endpoints and project access', () => {
  assert.match(source, /import \{ canReadRelationshipEndpoint, canReadKnowledgeRelationship \} from/);
  assert.match(relationshipAccess, /async function canReadKnowledgeRelationship[\s\S]*?canReadRelationshipEndpoint\(row\.source_type[\s\S]*?canReadRelationshipEndpoint\(row\.target_type/);
  assert.match(source, /router\.get\('\/relationships'[\s\S]*?visibleKnowledgeRelationships/);
  assert.match(source, /visibleRelationships=await visibleKnowledgeRelationships\(relationships\.rows,req\.user\)/);
  assert.match(source, /router\.post\('\/relationships'[\s\S]*?canReadRelationshipEndpoint\(source_type[\s\S]*?ON CONFLICT[\s\S]*?DO NOTHING/);
});

test('restricted findings and results require explicit edit access', () => {
  assert.match(source, /async function canEditKnowledgeRecord[\s\S]*?canEditRestrictedEntity/);
  assert.match(source, /router\.patch\('\/findings\/:id'[\s\S]*?canEditKnowledgeRecord\(before\.rows\[0\],'finding'/);
  assert.match(source, /router\.delete\('\/findings\/:id'[\s\S]*?canEditKnowledgeRecord\(b\.rows\[0\],'finding'/);
  assert.match(source, /router\.patch\('\/results\/:id'[\s\S]*?canEditKnowledgeRecord\(b\.rows\[0\],'result'/);
  assert.match(source, /router\.delete\('\/results\/:id'[\s\S]*?canEditKnowledgeRecord\(b\.rows\[0\],'result'/);
});
