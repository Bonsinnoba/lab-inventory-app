import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./sync.js', import.meta.url), 'utf8');

test('Notes pull uses the shared server-side visibility predicate', () => {
  assert.match(source, /router\.get\('\/notes\/pull'[\s\S]*?visibilityReadSql\(\{alias:'n',entityType:'note'/);
  assert.match(source, /visible_note_ids:notes\.rows\.map\(row=>row\.id\)/);
  assert.doesNotMatch(source, /const visibility=req\.user\.role==='admin'/);
});

test('offline Note changes carry the scope and enforce restricted editing', () => {
  assert.match(source, /const NOTE_FIELDS=\['title','body','tags','item_id','project_id','visibility'\]/);
  assert.match(source, /async function canEditSyncedNote[\s\S]*?canEditRestrictedEntity/);
  assert.match(source, /INVALID_NOTE_VISIBILITY/);
  assert.match(source, /visibility==='restricted'[\s\S]*?record_access_grants/);
  assert.match(source, /current\.visibility!==nextVisibility&&nextVisibility==='restricted'[\s\S]*?record_access_grants/);
  assert.match(source, /current\.visibility==='restricted'&&nextVisibility!=='restricted'[\s\S]*?DELETE FROM record_access_grants/);
});
