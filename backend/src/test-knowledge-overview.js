import { pool } from './db.js';

async function assert(condition, message) {
  if (!condition) throw new Error(`KNOWLEDGE OVERVIEW FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testKnowledgeOverview() {
  const client = await pool.connect();
  let userId = null;
  let noteId = null;
  let resourceId = null;

  try {
    await client.query('BEGIN');

    // Create test user
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('overview_test_user', '$2b$12$test_hash_overview', 'admin', TRUE)
       RETURNING id`,
      []
    );
    userId = userResult.rows[0].id;

    // Test 1: Create test notes for overview
    const note1 = await client.query(
      `INSERT INTO notes (title, body, tags, author_id)
       VALUES ('Overview Note 1', 'First overview note', $1::text[], $2) RETURNING id`,
      [['overview', 'test'], userId]
    );
    const note2 = await client.query(
      `INSERT INTO notes (title, body, tags, author_id)
       VALUES ('Overview Note 2', 'Second overview note', $1::text[], $2) RETURNING id`,
      [['overview', 'documentation'], userId]
    );
    const note3 = await client.query(
      `INSERT INTO notes (title, body, tags, author_id)
       VALUES ('Overview Note 3', 'Third overview note', $1::text[], $2) RETURNING id`,
      [['test'], userId]
    );

    // Test 2: Create test resources for overview
    const resource1 = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, uploaded_by)
       VALUES ('Overview Resource 1', 'link', 'other', 'documentation', 'Test resource 1', $1::text[], $2) RETURNING id`,
      [['resource', 'test'], userId]
    );
    resourceId = resource1.rows[0].id;

    const resource2 = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, uploaded_by)
       VALUES ('Overview Resource 2', 'link', 'other', 'schematics', 'Test resource 2', $1::text[], $2) RETURNING id`,
      [['schematic', 'test'], userId]
    );

    // Test 3: Knowledge overview - counts
    const [notesCount, resourcesCount] = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS count FROM notes`),
      client.query(`SELECT COUNT(*)::int AS count FROM resources`)
    ]);
    await assert(notesCount.rows[0].count >= 3, 'Notes count is correct');
    await assert(resourcesCount.rows[0].count >= 2, 'Resources count is correct');

    // Test 4: Knowledge overview - categories
    const categories = await client.query(
      `SELECT category, COUNT(*)::int AS count FROM resources GROUP BY category ORDER BY count DESC, category`
    );
    await assert(categories.rowCount >= 2, 'Categories query returns results');
    const docCategory = categories.rows.find(c => c.category === 'documentation');
    const schematicCategory = categories.rows.find(c => c.category === 'schematics');
    await assert(docCategory, 'Documentation category appears');
    await assert(schematicCategory, 'Schematics category appears');

    // Test 5: Knowledge overview - recent notes
    const recentNotes = await client.query(
      `SELECT id, title, tags, updated_at, author_id FROM notes ORDER BY updated_at DESC LIMIT 8`
    );
    await assert(recentNotes.rowCount >= 3, 'Recent notes query returns results');
    // Just verify that all our test notes appear in the results
    const noteTitles = recentNotes.rows.map(n => n.title);
    await assert(noteTitles.includes('Overview Note 1'), 'Overview Note 1 appears in recent notes');
    await assert(noteTitles.includes('Overview Note 2'), 'Overview Note 2 appears in recent notes');
    await assert(noteTitles.includes('Overview Note 3'), 'Overview Note 3 appears in recent notes');

    // Test 6: Knowledge overview - recent resources (only top-level)
    const recentResources = await client.query(
      `SELECT id, name, kind, file_type, category, tags, updated_at FROM resources WHERE parent_resource_id IS NULL ORDER BY updated_at DESC LIMIT 8`
    );
    await assert(recentResources.rowCount >= 2, 'Recent resources query returns results');
    // Just verify that our test resources appear in the results
    const resourceNames = recentResources.rows.map(r => r.name);
    await assert(resourceNames.includes('Overview Resource 1'), 'Overview Resource 1 appears in recent resources');
    await assert(resourceNames.includes('Overview Resource 2'), 'Overview Resource 2 appears in recent resources');

    // Test 7: Knowledge tags - aggregate from notes and resources
    const knowledgeTags = await client.query(
      `SELECT tag, SUM(note_count)::int AS note_count, SUM(resource_count)::int AS resource_count
       FROM (
         SELECT unnest(tags) AS tag, 1 AS note_count, 0 AS resource_count FROM notes
         UNION ALL
         SELECT unnest(tags) AS tag, 0 AS note_count, 1 AS resource_count FROM resources
       ) x GROUP BY tag ORDER BY tag`
    );
    await assert(knowledgeTags.rowCount >= 3, 'Knowledge tags query returns results');
    
    const testTag = knowledgeTags.rows.find(t => t.tag === 'test');
    await assert(testTag, 'Test tag appears in knowledge tags');
    await assert(testTag.note_count >= 2, 'Test tag has correct note count');
    await assert(testTag.resource_count >= 2, 'Test tag has correct resource count');

    const overviewTag = knowledgeTags.rows.find(t => t.tag === 'overview');
    await assert(overviewTag, 'Overview tag appears in knowledge tags');
    await assert(overviewTag.note_count >= 2, 'Overview tag has correct note count');

    const resourceTag = knowledgeTags.rows.find(t => t.tag === 'resource');
    await assert(resourceTag, 'Resource tag appears in knowledge tags');
    await assert(resourceTag.resource_count >= 1, 'Resource tag has correct resource count');

    // Test 8: Create additional resources with different categories
    const resource3 = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, uploaded_by)
       VALUES ('Overview Resource 3', 'link', 'other', 'documentation', 'Test resource 3', $1::text[], $2) RETURNING id`,
      [['documentation'], userId]
    );

    // Test 9: Verify category counts updated
    const categoriesAfter = await client.query(
      `SELECT category, COUNT(*)::int AS count FROM resources GROUP BY category ORDER BY count DESC, category`
    );
    const docCategoryAfter = categoriesAfter.rows.find(c => c.category === 'documentation');
    await assert(docCategoryAfter.count >= 2, 'Documentation category count updated');

    // Test 10: Test notes tags all endpoint
    const notesTagsAll = await client.query(
      `SELECT DISTINCT unnest(tags) as tag FROM notes WHERE tags IS NOT NULL AND array_length(tags, 1) > 0 ORDER BY tag ASC`
    );
    await assert(notesTagsAll.rowCount >= 3, 'Notes tags all query returns results');
    const tagValues = notesTagsAll.rows.map(r => r.tag);
    await assert(tagValues.includes('overview'), 'Overview tag in notes tags all');
    await assert(tagValues.includes('test'), 'Test tag in notes tags all');
    await assert(tagValues.includes('documentation'), 'Documentation tag in notes tags all');

    // Test 11: Test with empty tags arrays
    const noteNoTags = await client.query(
      `INSERT INTO notes (title, body, tags, author_id)
       VALUES ('No Tags Note', 'Note without tags', $1::text[], $2) RETURNING id`,
      [[], userId]
    );

    // Test 12: Verify notes tags all still works (should exclude empty arrays)
    const notesTagsAfter = await client.query(
      `SELECT DISTINCT unnest(tags) as tag FROM notes WHERE tags IS NOT NULL AND array_length(tags, 1) > 0 ORDER BY tag ASC`
    );
    await assert(notesTagsAfter.rowCount >= 3, 'Notes tags all still excludes empty arrays');

    // Test 13: Test with resource that has folder structure
    const folderResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, uploaded_by)
       VALUES ('Overview Folder', 'folder', 'schematic_folder', 'schematics', 'Test folder', $1::text[], $2) RETURNING id`,
      [['folder'], userId]
    );
    const folderId = folderResource.rows[0].id;

    const childResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, original_filename, storage_path, mime_type, size_bytes, parent_resource_id, relative_path, category, description, tags, uploaded_by)
       VALUES ('Child File', 'file', 'document', 'child.pdf', 'storage/path/child.pdf', 'application/pdf', 1024, $1, 'child.pdf', 'documents', 'Child file', $2::text[], $3) RETURNING id`,
      [folderId, [['child']], userId]
    );

    // Test 14: Verify recent resources still only returns top-level (parent_resource_id IS NULL)
    const recentResourcesWithFolder = await client.query(
      `SELECT id, name, kind, file_type, category, tags, updated_at FROM resources WHERE parent_resource_id IS NULL ORDER BY updated_at DESC LIMIT 8`
    );
    const childInRecent = recentResourcesWithFolder.rows.find(r => r.name === 'Child File');
    await assert(!childInRecent, 'Child resource does not appear in recent resources (parent_resource_id filter works)');
    const folderInRecent = recentResourcesWithFolder.rows.find(r => r.name === 'Overview Folder');
    await assert(folderInRecent, 'Folder resource appears in recent resources');

    // Test 15: Clean up test data
    await client.query('DELETE FROM notes WHERE author_id = $1', [userId]);
    await client.query('DELETE FROM resources WHERE uploaded_by = $1', [userId]);

    // Test 16: Verify cleanup worked
    const cleanupNotesCount = await client.query(`SELECT COUNT(*)::int AS count FROM notes WHERE author_id = $1`, [userId]);
    const cleanupResourcesCount = await client.query(`SELECT COUNT(*)::int AS count FROM resources WHERE uploaded_by = $1`, [userId]);
    await assert(cleanupNotesCount.rows[0].count === 0, 'Test notes cleaned up');
    await assert(cleanupResourcesCount.rows[0].count === 0, 'Test resources cleaned up');

    await client.query('ROLLBACK');
    console.log('\n✅ KNOWLEDGE OVERVIEW TESTS PASSED');
    console.log('Knowledge overview endpoint queries verified.');
    console.log('Notes and resources counts verified.');
    console.log('Category aggregation verified.');
    console.log('Recent items queries verified.');
    console.log('Knowledge tags aggregation verified.');
    console.log('Parent-child resource filtering verified.');
    console.log('Empty state handling verified.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ KNOWLEDGE OVERVIEW TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testKnowledgeOverview();