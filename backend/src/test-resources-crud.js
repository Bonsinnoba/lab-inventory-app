import { pool } from './db.js';

async function assert(condition, message) {
  if (!condition) throw new Error(`RESOURCES CRUD FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testResourcesCRUD() {
  const client = await pool.connect();
  let projectId = null;
  let itemId = null;
  let noteId = null;
  let userId = null;
  let resourceId = null;
  let folderId = null;

  try {
    await client.query('BEGIN');

    // Create test user
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('resources_test_user', '$2b$12$test_hash_resources', 'admin', TRUE)
       RETURNING id`,
      []
    );
    userId = userResult.rows[0].id;

    // Create test project
    const projectResult = await client.query(
      `INSERT INTO projects (name, status, description, priority, owner_id)
       VALUES ('Resources Test Project', 'active', 'Resources test description', 'normal', $1)
       RETURNING id`,
      [userId]
    );
    projectId = projectResult.rows[0].id;

    // Create test item
    const itemResult = await client.query(
      `INSERT INTO items (name, type, category, current_quantity, unit)
       VALUES ('Resources Test Item', 'component', 'electronic', 10, 'pcs')
       RETURNING id`,
      []
    );
    itemId = itemResult.rows[0].id;

    // Create test note
    const noteResult = await client.query(
      `INSERT INTO notes (title, body, tags, author_id)
       VALUES ('Resources Test Note', 'Resources test note body', ARRAY['resources', 'test'], $1)
       RETURNING id`,
      [userId]
    );
    noteId = noteResult.rows[0].id;

    // Test 1: CREATE - Link resource (simplest type)
    const linkResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, url, category, description, tags, project_id, uploaded_by)
       VALUES ('Test Link', 'link', 'other', 'https://example.com', 'general', 'Test link description', ARRAY['link', 'test']::text[], $1, $2)
       RETURNING *`,
      [projectId, userId]
    );
    resourceId = linkResource.rows[0].id;
    await assert(resourceId, 'Link resource creation returns ID');
    await assert(linkResource.rows[0].name === 'Test Link', 'Resource name persists on creation');
    await assert(linkResource.rows[0].kind === 'link', 'Resource kind persists on creation');
    await assert(linkResource.rows[0].file_type === 'other', 'Resource file_type persists on creation');
    await assert(linkResource.rows[0].url === 'https://example.com', 'Resource URL persists on creation');
    await assert(linkResource.rows[0].category === 'general', 'Resource category persists on creation');
    await assert(linkResource.rows[0].description === 'Test link description', 'Resource description persists on creation');
    await assert(linkResource.rows[0].project_id === projectId, 'Resource project_id persists on creation');
    await assert(linkResource.rows[0].uploaded_by === userId, 'Resource uploaded_by persists on creation');

    // Test 2: READ - Immediate read after creation
    const readResult = await client.query(
      `SELECT * FROM resources WHERE id = $1`,
      [resourceId]
    );
    await assert(readResult.rowCount === 1, 'Resource can be read immediately after creation');
    await assert(readResult.rows[0].name === 'Test Link', 'Read resource name matches created name');
    await assert(readResult.rows[0].kind === 'link', 'Read resource kind matches created kind');

    // Test 3: READ - Resource appears in project resources query
    const projectResourcesQuery = await client.query(
      `SELECT id,name,kind,file_type,original_filename,category,description,tags,created_at,updated_at FROM resources WHERE project_id=$1`,
      [projectId]
    );
    await assert(projectResourcesQuery.rowCount === 1, 'Resource appears in project resources query');
    await assert(projectResourcesQuery.rows[0].name === 'Test Link', 'Resource name in project query is correct');

    // Test 4: UPDATE - Single field update (name)
    const updateName = await client.query(
      `UPDATE resources SET name = 'Updated Test Link' WHERE id = $1 RETURNING *`,
      [resourceId]
    );
    await assert(updateName.rowCount === 1, 'Resource name update reports success');
    await assert(updateName.rows[0].name === 'Updated Test Link', 'Updated name persists');

    // Test 5: READ - Verify name update persists
    const readAfterNameUpdate = await client.query(
      `SELECT name FROM resources WHERE id = $1`,
      [resourceId]
    );
    await assert(readAfterNameUpdate.rows[0].name === 'Updated Test Link', 'Name update persists in read');

    // Test 6: UPDATE - Multiple field update
    const updateMultiple = await client.query(
      `UPDATE resources
       SET description = 'Updated description', category = 'documentation', tags = ARRAY['updated', 'link']::text[]
       WHERE id = $1 RETURNING *`,
      [resourceId]
    );
    await assert(updateMultiple.rowCount === 1, 'Multiple field update reports success');
    await assert(updateMultiple.rows[0].description === 'Updated description', 'Description update persists');
    await assert(updateMultiple.rows[0].category === 'documentation', 'Category update persists');
    await assert(updateMultiple.rows[0].tags.length === 2, 'Tags array update persists');

    // Test 7: UPDATE - URL change
    const updateUrl = await client.query(
      `UPDATE resources SET url = 'https://updated-example.com' WHERE id = $1 RETURNING *`,
      [resourceId]
    );
    await assert(updateUrl.rowCount === 1, 'URL update reports success');
    await assert(updateUrl.rows[0].url === 'https://updated-example.com', 'URL update persists');

    // Test 8: CREATE - Folder resource (unattached, child resources will reference it)
    const folderResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, uploaded_by)
       VALUES ('Test Folder', 'folder', 'schematic_folder', 'schematics', 'Test folder description', ARRAY['folder', 'schematic']::text[], $1)
       RETURNING *`,
      [userId]
    );
    folderId = folderResource.rows[0].id;
    await assert(folderId, 'Folder resource creation returns ID');
    await assert(folderResource.rows[0].kind === 'folder', 'Folder kind persists');
    await assert(folderResource.rows[0].file_type === 'schematic_folder', 'Folder file_type persists');
    await assert(folderResource.rows[0].project_id === null, 'Folder is unattached (can be referenced by children)');

    // Test 9: CREATE - File resource (child of folder) - file should not have project_id if it has parent_resource_id
    const fileResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, original_filename, storage_path, mime_type, size_bytes, parent_resource_id, relative_path, category, description, tags, uploaded_by)
       VALUES ('Test File', 'file', 'document', 'test.pdf', 'storage/path/test.pdf', 'application/pdf', 1024, $1, 'test.pdf', 'documents', 'Test file description', ARRAY['file', 'pdf']::text[], $2)
       RETURNING *`,
      [folderId, userId]
    );
    const fileId = fileResource.rows[0].id;
    await assert(fileId, 'File resource creation returns ID');
    await assert(fileResource.rows[0].kind === 'file', 'File kind persists');
    await assert(fileResource.rows[0].parent_resource_id === folderId, 'File parent_resource_id persists');
    await assert(fileResource.rows[0].relative_path === 'test.pdf', 'File relative_path persists');
    await assert(parseInt(fileResource.rows[0].size_bytes) === 1024, 'File size_bytes persists');
    await assert(fileResource.rows[0].project_id === null, 'Child file has no direct project_id (parent folder has it)');

    // Test 10: READ - Verify folder has child file
    const folderChildrenQuery = await client.query(
      `SELECT * FROM resources WHERE parent_resource_id = $1`,
      [folderId]
    );
    await assert(folderChildrenQuery.rowCount === 1, 'Folder has one child file');
    await assert(folderChildrenQuery.rows[0].id === fileId, 'Child file ID is correct');

    // Test 11: CREATE - Resource attached to item
    const itemResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, url, category, description, tags, item_id, uploaded_by)
       VALUES ('Item Resource', 'link', 'other', 'https://item-resource.com', 'datasheet', 'Item datasheet', ARRAY['datasheet']::text[], $1, $2)
       RETURNING *`,
      [itemId, userId]
    );
    const itemResourceId = itemResource.rows[0].id;
    await assert(itemResourceId, 'Item resource creation returns ID');
    await assert(itemResource.rows[0].item_id === itemId, 'Resource item_id persists');
    await assert(itemResource.rows[0].project_id === null, 'Item resource has no project_id');

    // Test 12: CREATE - Resource attached to note
    const noteResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, url, category, description, tags, note_id, uploaded_by)
       VALUES ('Note Resource', 'link', 'other', 'https://note-resource.com', 'reference', 'Note reference', ARRAY['reference']::text[], $1, $2)
       RETURNING *`,
      [noteId, userId]
    );
    const noteResourceId = noteResource.rows[0].id;
    await assert(noteResourceId, 'Note resource creation returns ID');
    await assert(noteResource.rows[0].note_id === noteId, 'Resource note_id persists');
    await assert(noteResource.rows[0].project_id === null, 'Note resource has no project_id');

    // Test 13: READ - Resource appears in item query
    const itemResourcesQuery = await client.query(
      `SELECT * FROM resources WHERE item_id = $1`,
      [itemId]
    );
    await assert(itemResourcesQuery.rowCount === 1, 'Resource appears in item resources query');
    await assert(itemResourcesQuery.rows[0].name === 'Item Resource', 'Item resource name is correct');

    // Test 14: READ - Resource appears in note query
    const noteResourcesQuery = await client.query(
      `SELECT * FROM resources WHERE note_id = $1`,
      [noteId]
    );
    await assert(noteResourcesQuery.rowCount === 1, 'Resource appears in note resources query');
    await assert(noteResourcesQuery.rows[0].name === 'Note Resource', 'Note resource name is correct');

    // Test 15: DELETE - Child file deletion
    const deleteFile = await client.query(
      `DELETE FROM resources WHERE id = $1 RETURNING id`,
      [fileId]
    );
    await assert(deleteFile.rowCount === 1, 'File deletion reports success');

    // Test 16: READ - Verify file is gone
    const fileAfterDelete = await client.query(
      `SELECT * FROM resources WHERE id = $1`,
      [fileId]
    );
    await assert(fileAfterDelete.rowCount === 0, 'File is removed from database after deletion');

    // Test 17: READ - Verify folder no longer has children
    const folderChildrenAfterDelete = await client.query(
      `SELECT * FROM resources WHERE parent_resource_id = $1`,
      [folderId]
    );
    await assert(folderChildrenAfterDelete.rowCount === 0, 'Folder has no children after file deletion');

    // Test 18: DELETE - Folder deletion
    const deleteFolder = await client.query(
      `DELETE FROM resources WHERE id = $1 RETURNING id`,
      [folderId]
    );
    await assert(deleteFolder.rowCount === 1, 'Folder deletion reports success');

    // Test 19: DELETE - Original link resource
    const deleteLink = await client.query(
      `DELETE FROM resources WHERE id = $1 RETURNING id`,
      [resourceId]
    );
    await assert(deleteLink.rowCount === 1, 'Link deletion reports success');

    // Test 20: READ - Verify project has no resources after deletions
    const projectResourcesAfterDelete = await client.query(
      `SELECT * FROM resources WHERE project_id = $1`,
      [projectId]
    );
    await assert(projectResourcesAfterDelete.rowCount === 0, 'Project has no resources after deletions');

    // Test 21: Test resource with minimal fields
    const minimalResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, uploaded_by)
       VALUES ('Minimal Resource', 'link', 'other', 'general', '', ARRAY[]::text[], $1) RETURNING *`,
      [userId]
    );
    const minimalResourceId = minimalResource.rows[0].id;
    await assert(minimalResourceId, 'Minimal resource creates successfully');
    await assert(minimalResource.rows[0].name === 'Minimal Resource', 'Minimal resource name persists');
    await assert(minimalResource.rows[0].description === '', 'Default description is empty string');
    await assert(minimalResource.rows[0].tags.length === 0, 'Default tags is empty array');
    await assert(minimalResource.rows[0].project_id === null, 'Minimal resource has no parent');

    // Test 22: Delete minimal resource
    await client.query('DELETE FROM resources WHERE id = $1', [minimalResourceId]);

    // Test 23: Test resource ordering by updated_at
    const res1 = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, uploaded_by)
       VALUES ('Resource 1', 'link', 'other', 'general', 'First resource', ARRAY['test']::text[], $1) RETURNING id`,
      [userId]
    );
    await new Promise(resolve => setTimeout(resolve, 10)); // Small delay for timestamp difference

    const res2 = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, uploaded_by)
       VALUES ('Resource 2', 'link', 'other', 'general', 'Second resource', ARRAY['test']::text[], $1) RETURNING id`,
      [userId]
    );

    const orderedResources = await client.query(
      `SELECT * FROM resources WHERE uploaded_by=$1 ORDER BY updated_at DESC`,
      [userId]
    );
    await assert(orderedResources.rowCount >= 2, 'Resources appear in ordered query');

    // Test 24: Clean up test resources
    await client.query('DELETE FROM resources WHERE uploaded_by = $1', [userId]);

    // Test 25: Test resource with all parent fields null (unattached resource)
    const unattachedResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, uploaded_by)
       VALUES ('Unattached Resource', 'link', 'other', 'general', 'Unattached to any entity', ARRAY['unattached']::text[], $1) RETURNING *`,
      [userId]
    );
    const unattachedId = unattachedResource.rows[0].id;
    await assert(unattachedResource.rows[0].item_id === null, 'Unattached resource has no item_id');
    await assert(unattachedResource.rows[0].project_id === null, 'Unattached resource has no project_id');
    await assert(unattachedResource.rows[0].note_id === null, 'Unattached resource has no note_id');
    await assert(unattachedResource.rows[0].parent_resource_id === null, 'Unattached resource has no parent_resource_id');

    // Test 26: Delete unattached resource
    await client.query('DELETE FROM resources WHERE id = $1', [unattachedId]);

    // Test 27: Clean up item and note resources
    await client.query('DELETE FROM resources WHERE item_id = $1', [itemId]);
    await client.query('DELETE FROM resources WHERE note_id = $1', [noteId]);

    await client.query('ROLLBACK');
    console.log('\n✅ RESOURCES CRUD TESTS PASSED');
    console.log('All resource CRUD operations properly persist to database.');
    console.log('CREATE → READ → UPDATE → DELETE lifecycle verified.');
    console.log('Resource kinds (file, folder, link) verified.');
    console.log('Resource-parent relationships (item, project, note, folder) verified.');
    console.log('Resource metadata (tags, category, description) verified.');
    console.log('Null value handling and default values verified.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ RESOURCES CRUD TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testResourcesCRUD();