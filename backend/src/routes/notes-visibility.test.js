import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./notes.js', import.meta.url), 'utf8');

test('Notes apply visibility gates to lists, detail reads, and revisions', () => {
  assert.match(source, /router\.get\('\/', hasPermission\('notes\.view'\)[\s\S]*?visibilityReadSql/);
  assert.match(source, /router\.get\('\/:id', hasPermission\('notes\.view'\)[\s\S]*?visibilityReadSql/);
  assert.match(source, /router\.get\('\/:id\/revisions'[\s\S]*?canReadEntity/);
});

test('restricted note creation and scope transitions preserve creator access', () => {
  assert.match(source, /INSERT INTO notes[\s\S]*?visibility\)/);
  assert.match(source, /visibility === 'restricted'[\s\S]*?record_access_grants/);
  assert.match(source, /current\.rows\[0\]\.visibility !== nextVisibility && nextVisibility === 'restricted'[\s\S]*?record_access_grants/);
  assert.match(source, /current\.rows\[0\]\.visibility === 'restricted' && nextVisibility !== 'restricted'[\s\S]*?DELETE FROM record_access_grants/);
});

test('only administrators and project leads can administer restricted-note grants', () => {
  assert.match(source, /async function requireNoteGrantManager[\s\S]*?canManageEntityGrants/);
  assert.match(source, /router\.get\('\/:id\/access-grants'/);
  assert.match(source, /router\.put\('\/:id\/access-grants\/:userId'/);
  assert.match(source, /router\.delete\('\/:id\/access-grants\/:userId'/);
  assert.match(source, /access_level must be view or edit/);
});
