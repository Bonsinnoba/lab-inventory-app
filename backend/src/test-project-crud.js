import { pool } from './db.js';

async function assert(condition, message) {
  if (!condition) throw new Error(`PROJECT CRUD FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testProjectCRUD() {
  const client = await pool.connect();
  let projectId = null;
  let userId = null;

  try {
    await client.query('BEGIN');

    // Create a test user
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('crud_test_user', '$2b$12$test_hash_crud', 'admin', TRUE)
       RETURNING id, username, role`
    );
    userId = userResult.rows[0].id;
    await assert(userId, 'Test user created for CRUD test');

    // Test 1: CREATE - Project creation
    const createResult = await client.query(
      `INSERT INTO projects (name, status, description, priority, start_date, due_date, owner_id)
       VALUES ('CRUD Test Project', 'active', 'Test description for CRUD', 'normal', '2026-01-01', '2026-12-31', $1)
       RETURNING *`,
      [userId]
    );
    projectId = createResult.rows[0].id;
    await assert(projectId, 'Project creation returns ID');
    await assert(createResult.rows[0].name === 'CRUD Test Project', 'Project name persists on creation');
    await assert(createResult.rows[0].status === 'active', 'Project status persists on creation');
    await assert(createResult.rows[0].description === 'Test description for CRUD', 'Project description persists on creation');
    await assert(createResult.rows[0].priority === 'normal', 'Project priority persists on creation');
    await assert(createResult.rows[0].owner_id === userId, 'Project owner persists on creation');

    // Test 2: READ - Immediate read after creation
    const readResult = await client.query(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId]
    );
    await assert(readResult.rowCount === 1, 'Project can be read immediately after creation');
    await assert(readResult.rows[0].name === 'CRUD Test Project', 'Read project name matches created name');
    await assert(readResult.rows[0].status === 'active', 'Read project status matches created status');

    // Test 3: READ - Project appears in list query
    const listResult = await client.query(
      `SELECT * FROM projects ORDER BY created_at DESC`
    );
    await assert(listResult.rowCount >= 1, 'Project appears in projects list');
    const createdProject = listResult.rows.find(p => p.id === projectId);
    await assert(createdProject, 'Created project found in list');
    await assert(createdProject.name === 'CRUD Test Project', 'Project name in list is correct');

    // Test 4: UPDATE - Single field update
    const updateName = await client.query(
      `UPDATE projects SET name = 'Updated CRUD Project' WHERE id = $1 RETURNING *`,
      [projectId]
    );
    await assert(updateName.rowCount === 1, 'Project name update reports success');
    await assert(updateName.rows[0].name === 'Updated CRUD Project', 'Updated name persists');

    // Test 5: READ - Verify update persists
    const readAfterNameUpdate = await client.query(
      `SELECT name FROM projects WHERE id = $1`,
      [projectId]
    );
    await assert(readAfterNameUpdate.rows[0].name === 'Updated CRUD Project', 'Name update persists in read');

    // Test 6: UPDATE - Multiple field update
    const updateMultiple = await client.query(
      `UPDATE projects 
       SET status = 'on_hold', description = 'Updated description', priority = 'high', due_date = '2027-06-30'
       WHERE id = $1 RETURNING *`,
      [projectId]
    );
    await assert(updateMultiple.rowCount === 1, 'Multiple field update reports success');
    await assert(updateMultiple.rows[0].status === 'on_hold', 'Status update persists');
    await assert(updateMultiple.rows[0].description === 'Updated description', 'Description update persists');
    await assert(updateMultiple.rows[0].priority === 'high', 'Priority update persists');
    await assert(updateMultiple.rows[0].due_date.toISOString().startsWith('2027-06-30'), 'Due date update persists');

    // Test 7: READ - Verify all updates persist
    const readAfterMultipleUpdate = await client.query(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId]
    );
    await assert(readAfterMultipleUpdate.rows[0].name === 'Updated CRUD Project', 'Name still correct after multiple updates');
    await assert(readAfterMultipleUpdate.rows[0].status === 'on_hold', 'Status persists after multiple updates');
    await assert(readAfterMultipleUpdate.rows[0].description === 'Updated description', 'Description persists after multiple updates');
    await assert(readAfterMultipleUpdate.rows[0].priority === 'high', 'Priority persists after multiple updates');

    // Test 8: UPDATE - Budget field
    const updateBudget = await client.query(
      `UPDATE projects SET budget = 50000.00 WHERE id = $1 RETURNING *`,
      [projectId]
    );
    await assert(updateBudget.rowCount === 1, 'Budget update reports success');
    await assert(parseFloat(updateBudget.rows[0].budget) === 50000.00, 'Budget update persists');

    // Test 9: READ - Verify budget persists
    const readAfterBudget = await client.query(
      `SELECT budget FROM projects WHERE id = $1`,
      [projectId]
    );
    await assert(parseFloat(readAfterBudget.rows[0].budget) === 50000.00, 'Budget persists in read');

    // Test 10: UPDATE - Change owner
    const user2Result = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('crud_test_user2', '$2b$12$test_hash_crud2', 'member', TRUE)
       RETURNING id`
    );
    const userId2 = user2Result.rows[0].id;

    const updateOwner = await client.query(
      `UPDATE projects SET owner_id = $1 WHERE id = $2 RETURNING *`,
      [userId2, projectId]
    );
    await assert(updateOwner.rowCount === 1, 'Owner update reports success');
    await assert(updateOwner.rows[0].owner_id === userId2, 'Owner change persists');

    // Test 11: READ - Verify owner change persists
    const readAfterOwner = await client.query(
      `SELECT owner_id FROM projects WHERE id = $1`,
      [projectId]
    );
    await assert(readAfterOwner.rows[0].owner_id === userId2, 'Owner change persists in read');

    // Test 12: UPDATE - Set status to completed
    const updateCompleted = await client.query(
      `UPDATE projects SET status = 'completed' WHERE id = $1 RETURNING *`,
      [projectId]
    );
    await assert(updateCompleted.rowCount === 1, 'Status update to completed reports success');
    await assert(updateCompleted.rows[0].status === 'completed', 'Completed status persists');

    // Test 13: READ - Verify completed status persists
    const readAfterCompleted = await client.query(
      `SELECT status FROM projects WHERE id = $1`,
      [projectId]
    );
    await assert(readAfterCompleted.rows[0].status === 'completed', 'Completed status persists in read');

    // Test 14: DELETE - Project deletion
    const deleteResult = await client.query(
      `DELETE FROM projects WHERE id = $1 RETURNING id`,
      [projectId]
    );
    await assert(deleteResult.rowCount === 1, 'Project deletion reports success');
    await assert(deleteResult.rows[0].id === projectId, 'Deleted project ID is correct');

    // Test 15: READ - Verify project is gone after deletion
    const readAfterDelete = await client.query(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId]
    );
    await assert(readAfterDelete.rowCount === 0, 'Project is removed from database after deletion');

    // Test 16: READ - Verify project is gone from list
    const listAfterDelete = await client.query(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId]
    );
    await assert(listAfterDelete.rowCount === 0, 'Project does not appear in queries after deletion');

    // Test 17: Test with nullable values (budget, dates, owner_id can be null; description has default)
    const projectWithNulls = await client.query(
      `INSERT INTO projects (name, status, description, priority, budget, start_date, due_date, owner_id)
       VALUES ('Null Test Project', 'active', '', 'low', NULL, NULL, NULL, NULL)
       RETURNING *`,
      []
    );
    const nullProjectId = projectWithNulls.rows[0].id;
    await assert(nullProjectId, 'Project with nullable values creates successfully');
    await assert(projectWithNulls.rows[0].description === '', 'Empty description persists (NOT NULL with default)');
    await assert(projectWithNulls.rows[0].budget === null, 'Null budget persists');
    await assert(projectWithNulls.rows[0].start_date === null, 'Null start_date persists');

    // Test 18: Update nullable fields to non-null
    const updateNulls = await client.query(
      `UPDATE projects
       SET description = 'Now has description', budget = 1000.00, start_date = '2026-03-01'
       WHERE id = $1 RETURNING *`,
      [nullProjectId]
    );
    await assert(updateNulls.rows[0].description === 'Now has description', 'Empty to non-null description update works');
    await assert(parseFloat(updateNulls.rows[0].budget) === 1000.00, 'Null to non-null budget update works');
    await assert(updateNulls.rows[0].start_date !== null, 'Null to non-null start_date update works');

    // Test 19: Delete null test project
    await client.query('DELETE FROM projects WHERE id = $1', [nullProjectId]);

    // Test 20: Test project creation without optional fields
    const minimalProject = await client.query(
      `INSERT INTO projects (name, status) VALUES ('Minimal Project', 'active') RETURNING *`,
      []
    );
    const minimalProjectId = minimalProject.rows[0].id;
    await assert(minimalProjectId, 'Minimal project creates successfully');
    await assert(minimalProject.rows[0].name === 'Minimal Project', 'Minimal project name persists');
    await assert(minimalProject.rows[0].status === 'active', 'Minimal project status persists');
    await assert(minimalProject.rows[0].description === '', 'Default description is empty string');
    await assert(minimalProject.rows[0].priority === 'normal', 'Default priority is normal');

    // Test 21: Delete minimal project
    await client.query('DELETE FROM projects WHERE id = $1', [minimalProjectId]);

    // Clean up test users
    await client.query('DELETE FROM users WHERE id = $1', [userId2]);

    await client.query('ROLLBACK');
    console.log('\n✅ PROJECT CRUD TESTS PASSED');
    console.log('All project CRUD operations properly persist to database.');
    console.log('CREATE → READ → UPDATE → DELETE lifecycle verified.');
    console.log('Null value handling and default values verified.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ PROJECT CRUD TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testProjectCRUD();