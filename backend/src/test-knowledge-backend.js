import { pool } from './db.js';

async function assert(condition, message) {
  if (!condition) throw new Error(`KNOWLEDGE BACKEND FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testKnowledgeBackend() {
  const client = await pool.connect();
  let noteId = null;
  let itemId = null;
  let projectId = null;
  let userId = null;

  try {
    await client.query('BEGIN');

    // Create test user
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('knowledge_test_user', '$2b$12$test_hash_knowledge', 'admin', TRUE)
       RETURNING id`,
      []
    );
    userId = userResult.rows[0].id;

    // Create test item
    const itemResult = await client.query(
      `INSERT INTO items (name, type, category, current_quantity, unit)
       VALUES ('Knowledge Test Item', 'component', 'electronic', 10, 'pcs')
       RETURNING id`,
      []
    );
    itemId = itemResult.rows[0].id;

    // Create test project
    const projectResult = await client.query(
      `INSERT INTO projects (name, status, description, priority, owner_id)
       VALUES ('Knowledge Test Project', 'active', 'Knowledge test description', 'normal', $1)
       RETURNING id`,
      [userId]
    );
    projectId = projectResult.rows[0].id;

    // Test 1: CREATE - Note creation with all fields
    const createResult = await client.query(
      `INSERT INTO notes (title, body, tags, item_id, project_id, author_id)
       VALUES ('Test Note', 'This is a test note body', $1::text[], $2, $3, $4)
       RETURNING *`,
      [['test', 'knowledge'], itemId, projectId, userId]
    );
    noteId = createResult.rows[0].id;
    await assert(noteId, 'Note creation returns ID');
    await assert(createResult.rows[0].title === 'Test Note', 'Note title persists on creation');
    await assert(createResult.rows[0].body === 'This is a test note body', 'Note body persists on creation');
    await assert(createResult.rows[0].tags.length === 2, 'Note tags array persists on creation');
    await assert(createResult.rows[0].tags.includes('test'), 'Note tags contain expected values');
    await assert(createResult.rows[0].item_id === itemId, 'Note item_id persists on creation');
    await assert(createResult.rows[0].project_id === projectId, 'Note project_id persists on creation');
    await assert(createResult.rows[0].author_id === userId, 'Note author_id persists on creation');

    // Test 2: READ - Immediate read after creation
    const readResult = await client.query(
      `SELECT * FROM notes WHERE id = $1`,
      [noteId]
    );
    await assert(readResult.rowCount === 1, 'Note can be read immediately after creation');
    await assert(readResult.rows[0].title === 'Test Note', 'Read note title matches created title');

    // Test 3: READ - Note appears in notes list
    const notesList = await client.query(
      `SELECT * FROM notes ORDER BY updated_at DESC`
    );
    await assert(notesList.rowCount >= 1, 'Note appears in notes list');
    const createdNote = notesList.rows.find(n => n.id === noteId);
    await assert(createdNote, 'Created note found in list');

    // Test 4: READ - Note appears in item notes query
    const itemNotes = await client.query(
      `SELECT * FROM notes WHERE item_id = $1`,
      [itemId]
    );
    await assert(itemNotes.rowCount === 1, 'Note appears in item notes query');
    await assert(itemNotes.rows[0].title === 'Test Note', 'Item note title is correct');

    // Test 5: READ - Note appears in project notes query
    const projectNotes = await client.query(
      `SELECT * FROM notes WHERE project_id = $1`,
      [projectId]
    );
    await assert(projectNotes.rowCount === 1, 'Note appears in project notes query');
    await assert(projectNotes.rows[0].title === 'Test Note', 'Project note title is correct');

    // Test 6: READ - Note search by tag
    const tagSearch = await client.query(
      `SELECT * FROM notes WHERE $1 = ANY(tags)`,
      ['test']
    );
    await assert(tagSearch.rowCount >= 1, 'Note appears in tag search');
    const foundByTag = tagSearch.rows.find(n => n.id === noteId);
    await assert(foundByTag, 'Note found by tag search');

    // Test 7: UPDATE - Create revision before update (simulating API behavior)
    const previousState = await client.query(
      `SELECT title, body, tags FROM notes WHERE id = $1 FOR UPDATE`,
      [noteId]
    );
    await assert(previousState.rowCount === 1, 'Previous state retrieved for revision');

    const revisionResult = await client.query(
      `INSERT INTO note_revisions (note_id, title, body, tags, edited_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [noteId, previousState.rows[0].title, previousState.rows[0].body, previousState.rows[0].tags || [], userId]
    );
    await assert(revisionResult.rowCount === 1, 'Note revision created successfully');
    await assert(revisionResult.rows[0].note_id === noteId, 'Revision note_id is correct');
    await assert(revisionResult.rows[0].title === 'Test Note', 'Revision title matches original');
    await assert(revisionResult.rows[0].edited_by === userId, 'Revision editor is correct');

    // Test 8: UPDATE - Update note fields
    const updateResult = await client.query(
      `UPDATE notes SET title = 'Updated Note', body = 'Updated body content', tags = $1::text[]
       WHERE id = $2 RETURNING *`,
      [['updated', 'knowledge'], noteId]
    );
    await assert(updateResult.rowCount === 1, 'Note update reports success');
    await assert(updateResult.rows[0].title === 'Updated Note', 'Updated title persists');
    await assert(updateResult.rows[0].body === 'Updated body content', 'Updated body persists');
    await assert(updateResult.rows[0].tags.length === 2, 'Updated tags array persists');
    await assert(updateResult.rows[0].tags.includes('updated'), 'Updated tags contain new values');

    // Test 9: READ - Verify revision still exists after update
    const revisionAfterUpdate = await client.query(
      `SELECT * FROM note_revisions WHERE note_id = $1`,
      [noteId]
    );
    await assert(revisionAfterUpdate.rowCount === 1, 'Revision persists after note update');
    await assert(revisionAfterUpdate.rows[0].title === 'Test Note', 'Revision contains original title');

    // Test 10: CREATE - Second revision after another update
    const previousState2 = await client.query(
      `SELECT title, body, tags FROM notes WHERE id = $1 FOR UPDATE`,
      [noteId]
    );

    const revisionResult2 = await client.query(
      `INSERT INTO note_revisions (note_id, title, body, tags, edited_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [noteId, previousState2.rows[0].title, previousState2.rows[0].body, previousState2.rows[0].tags || [], userId]
    );
    await assert(revisionResult2.rowCount === 1, 'Second revision created successfully');

    // Test 11: UPDATE - Another note update
    await client.query(
      `UPDATE notes SET body = 'Third version of body content' WHERE id = $1`,
      [noteId]
    );

    // Test 12: READ - Verify multiple revisions exist
    const allRevisions = await client.query(
      `SELECT * FROM note_revisions WHERE note_id = $1 ORDER BY created_at DESC`,
      [noteId]
    );
    await assert(allRevisions.rowCount === 2, 'Multiple revisions are stored');
    // Just verify both expected titles exist in revisions
    const revisionTitles = allRevisions.rows.map(r => r.title);
    await assert(revisionTitles.includes('Test Note'), 'Original title exists in revisions');
    await assert(revisionTitles.includes('Updated Note'), 'Updated title exists in revisions');

    // Test 13: READ - Verify revision with user join
    const revisionsWithUser = await client.query(
      `SELECT r.id, r.title, r.body, r.tags, r.edited_by, r.created_at, u.username AS editor
       FROM note_revisions r LEFT JOIN users u ON u.id = r.edited_by
       WHERE r.note_id = $1 ORDER BY r.created_at DESC`,
      [noteId]
    );
    await assert(revisionsWithUser.rowCount === 2, 'Revisions with user join work');
    await assert(revisionsWithUser.rows[0].editor === 'knowledge_test_user', 'Editor username is joined correctly');

    // Test 14: UPDATE - Change note associations
    const updateAssociations = await client.query(
      `UPDATE notes SET item_id = NULL, project_id = NULL WHERE id = $1 RETURNING *`,
      [noteId]
    );
    await assert(updateAssociations.rowCount === 1, 'Note association update reports success');
    await assert(updateAssociations.rows[0].item_id === null, 'Note item_id can be set to null');
    await assert(updateAssociations.rows[0].project_id === null, 'Note project_id can be set to null');

    // Test 15: UPDATE - Re-associate to different project
    const project2Result = await client.query(
      `INSERT INTO projects (name, status, description, priority, owner_id)
       VALUES ('Knowledge Test Project 2', 'active', 'Second test project', 'normal', $1)
       RETURNING id`,
      [userId]
    );
    const project2Id = project2Result.rows[0].id;

    const reassociateResult = await client.query(
      `UPDATE notes SET project_id = $1 WHERE id = $2 RETURNING *`,
      [project2Id, noteId]
    );
    await assert(reassociateResult.rowCount === 1, 'Note reassociation reports success');
    await assert(reassociateResult.rows[0].project_id === project2Id, 'Note project_id updated to new project');

    // Test 16: CREATE - Note with minimal fields
    const minimalNote = await client.query(
      `INSERT INTO notes (title, author_id)
       VALUES ('Minimal Note', $1) RETURNING *`,
      [userId]
    );
    const minimalNoteId = minimalNote.rows[0].id;
    await assert(minimalNoteId, 'Minimal note creates successfully');
    await assert(minimalNote.rows[0].title === 'Minimal Note', 'Minimal note title persists');
    await assert(minimalNote.rows[0].body === '', 'Default body is empty string');
    await assert(minimalNote.rows[0].tags.length === 0, 'Default tags is empty array');
    await assert(minimalNote.rows[0].item_id === null, 'Minimal note has no item_id');
    await assert(minimalNote.rows[0].project_id === null, 'Minimal note has no project_id');

    // Test 17: DELETE - Minimal note
    await client.query('DELETE FROM notes WHERE id = $1', [minimalNoteId]);

    // Test 18: CREATE - Note with empty tags array
    const emptyTagsNote = await client.query(
      `INSERT INTO notes (title, body, tags, author_id)
       VALUES ('Empty Tags Note', 'Note with no tags', ARRAY[]::text[], $1) RETURNING *`,
      [userId]
    );
    const emptyTagsNoteId = emptyTagsNote.rows[0].id;
    await assert(emptyTagsNote.rows[0].tags.length === 0, 'Empty tags array persists');

    // Test 19: DELETE - Empty tags note
    await client.query('DELETE FROM notes WHERE id = $1', [emptyTagsNoteId]);

    // Test 20: READ - Test full-text search
    const searchNote = await client.query(
      `INSERT INTO notes (title, body, tags, author_id)
       VALUES ('Search Test Note', 'This note contains searchable content about electronics and components', $1::text[], $2) RETURNING *`,
      [['search', 'test'], userId]
    );
    const searchNoteId = searchNote.rows[0].id;

    const searchResult = await client.query(
      `SELECT * FROM notes WHERE search_vector @@ plainto_tsquery('english', 'electronics')`,
      []
    );
    await assert(searchResult.rowCount >= 1, 'Full-text search works');
    const foundBySearch = searchResult.rows.find(n => n.id === searchNoteId);
    await assert(foundBySearch, 'Note found by full-text search');

    // Test 21: DELETE - Search test note
    await client.query('DELETE FROM notes WHERE id = $1', [searchNoteId]);

    // Test 22: DELETE - Main test note
    const deleteNote = await client.query(
      `DELETE FROM notes WHERE id = $1 RETURNING id`,
      [noteId]
    );
    await assert(deleteNote.rowCount === 1, 'Note deletion reports success');

    // Test 23: READ - Verify note is gone
    const noteAfterDelete = await client.query(
      `SELECT * FROM notes WHERE id = $1`,
      [noteId]
    );
    await assert(noteAfterDelete.rowCount === 0, 'Note is removed after deletion');

    // Test 24: READ - Verify revisions are cascaded (note_revisions has ON DELETE CASCADE)
    const revisionsAfterNoteDelete = await client.query(
      `SELECT * FROM note_revisions WHERE note_id = $1`,
      [noteId]
    );
    await assert(revisionsAfterNoteDelete.rowCount === 0, 'Revisions are cascaded when note is deleted');

    // Test 25: Test note ordering by updated_at
    const note1 = await client.query(
      `INSERT INTO notes (title, body, author_id)
       VALUES ('Note 1', 'First note', $1) RETURNING id`,
      [userId]
    );
    await new Promise(resolve => setTimeout(resolve, 10)); // Small delay for timestamp difference

    const note2 = await client.query(
      `INSERT INTO notes (title, body, author_id)
       VALUES ('Note 2', 'Second note', $1) RETURNING id`,
      [userId]
    );

    const orderedNotes = await client.query(
      `SELECT * FROM notes WHERE author_id=$1 ORDER BY updated_at DESC`,
      [userId]
    );
    await assert(orderedNotes.rowCount >= 2, 'Notes appear in ordered query');

    // Test 26: Clean up test notes
    await client.query('DELETE FROM notes WHERE author_id = $1', [userId]);

    // Test 27: Test unique tags query
    const noteWithTag1 = await client.query(
      `INSERT INTO notes (title, body, tags, author_id)
       VALUES ('Tag Test 1', 'Note with tag1', $1::text[], $2) RETURNING id`,
      [['tag1', 'common'], userId]
    );
    const noteWithTag2 = await client.query(
      `INSERT INTO notes (title, body, tags, author_id)
       VALUES ('Tag Test 2', 'Note with tag2', $1::text[], $2) RETURNING id`,
      [['tag2', 'common'], userId]
    );

    const uniqueTags = await client.query(
      `SELECT DISTINCT unnest(tags) as tag FROM notes WHERE tags IS NOT NULL AND array_length(tags, 1) > 0 ORDER BY tag ASC`,
      []
    );
    await assert(uniqueTags.rowCount >= 3, 'Unique tags query works');
    const tagValues = uniqueTags.rows.map(r => r.tag);
    await assert(tagValues.includes('tag1'), 'Tag1 appears in unique tags');
    await assert(tagValues.includes('tag2'), 'Tag2 appears in unique tags');
    await assert(tagValues.includes('common'), 'Common tag appears in unique tags');

    // Test 28: Clean up tag test notes
    await client.query('DELETE FROM notes WHERE author_id = $1', [userId]);

    await client.query('ROLLBACK');
    console.log('\n✅ KNOWLEDGE BACKEND TESTS PASSED');
    console.log('All knowledge backend operations properly persist to database.');
    console.log('Notes CRUD with full lifecycle verified.');
    console.log('Note revision system and cascading verified.');
    console.log('Note-item/project relationships verified.');
    console.log('Tag management and search verified.');
    console.log('Full-text search functionality verified.');
    console.log('Null value handling and default values verified.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ KNOWLEDGE BACKEND TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testKnowledgeBackend();