import test from 'node:test';
import assert from 'node:assert/strict';
import { isVisibility, normalizeVisibility, visibilityReadSql } from './visibility.js';

test('visibility accepts only the three documented scopes', () => {
  assert.equal(isVisibility('lab'), true);
  assert.equal(isVisibility('project'), true);
  assert.equal(isVisibility('restricted'), true);
  assert.equal(isVisibility('private'), false);
  assert.equal(normalizeVisibility('private'), 'lab');
  assert.equal(normalizeVisibility('private', 'restricted'), 'restricted');
});

test('list visibility predicate is fail-closed for project and restricted records', () => {
  const sql = visibilityReadSql({
    alias: 'n',
    entityType: 'note',
    userIdParameter: '$7',
    roleParameter: '$8',
  });
  assert.match(sql, /COALESCE\(n\.visibility, 'lab'\) = 'lab'/);
  assert.match(sql, /\$8 = 'admin'/);
  assert.match(sql, /visibility_member\.user_id = \$7/);
  assert.match(sql, /visibility_grant\.entity_type = 'note'/);
  assert.match(sql, /visibility_grant\.user_id = \$7/);
});

test('visibility SQL accepts only entity types controlled by source code', () => {
  assert.throws(
    () => visibilityReadSql({ alias: 'n', entityType: "note' OR TRUE --", userIdParameter: '$1', roleParameter: '$2' }),
    /Unsupported visibility entity type/,
  );
});
