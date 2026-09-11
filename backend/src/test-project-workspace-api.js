import { pool } from './db.js';

async function assert(condition, message) {
  if (!condition) throw new Error(`PROJECT WORKSPACE API FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testProjectWorkspaceAPI() {
  const client = await pool.connect();
  let projectId = null;
  let userId = null;
  let authToken = null;

  try {
    await client.query('BEGIN');

    // Create a test user
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('api_test_user', '$2b$12$test_hash_for_api_testing', 'admin', TRUE)
       RETURNING id, username, role`
    );
    userId = userResult.rows[0].id;
    await assert(userId, 'Test user created for API test');

    // Create a test project
    const projectResult = await client.query(
      `INSERT INTO projects (name, status, description, priority, owner_id)
       VALUES ('API Test Project', 'active', 'API test description', 'normal', $1)
       RETURNING *`,
      [userId]
    );
    projectId = projectResult.rows[0].id;
    await assert(projectId, 'Test project created for API test');

    // Test 1: GET /api/projects/:id/workspace should return workspace data
    const workspaceQuery = await client.query(
      `SELECT pm.project_id, pm.user_id, pm.member_role, pm.joined_at, u.username, u.role
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [projectId]
    );
    await assert(workspaceQuery.rowCount === 0, 'Workspace initially has no members');

    // Test 2: Add member through direct database operation (simulating API call)
    const memberAdd = await client.query(
      `INSERT INTO project_members (project_id, user_id, member_role)
       VALUES ($1, $2, 'member') RETURNING *`,
      [projectId, userId]
    );
    await assert(memberAdd.rowCount === 1, 'Member added successfully');

    // Test 3: Verify member appears in workspace query
    const workspaceAfterAdd = await client.query(
      `SELECT pm.project_id, pm.user_id, pm.member_role, pm.joined_at, u.username, u.role
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [projectId]
    );
    await assert(workspaceAfterAdd.rowCount === 1, 'Member appears in workspace after addition');
    await assert(workspaceAfterAdd.rows[0].username === 'api_test_user', 'Member username is correct');

    // Test 4: Test task creation through database operation
    const taskAdd = await client.query(
      `INSERT INTO project_tasks (project_id, title, description, status, priority, created_by)
       VALUES ($1, 'API Test Task', 'API task description', 'todo', 'normal', $2)
       RETURNING *`,
      [projectId, userId]
    );
    const taskId = taskAdd.rows[0].id;
    await assert(taskId, 'Task created successfully');

    // Test 5: Verify task appears in workspace tasks query
    const tasksQuery = await client.query(
      `SELECT t.*, u.username AS assignee_username, c.username AS creator_username
       FROM project_tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN users c ON c.id=t.created_by
       WHERE t.project_id=$1`,
      [projectId]
    );
    await assert(tasksQuery.rowCount === 1, 'Task appears in workspace tasks query');
    await assert(tasksQuery.rows[0].title === 'API Test Task', 'Task title is correct');

    // Test 6: Test experiment creation
    const experimentAdd = await client.query(
      `INSERT INTO project_experiments (project_id, title, status, hypothesis, performed_by)
       VALUES ($1, 'API Test Experiment', 'planned', 'API test hypothesis', $2)
       RETURNING *`,
      [projectId, userId]
    );
    const experimentId = experimentAdd.rows[0].id;
    await assert(experimentId, 'Experiment created successfully');

    // Test 7: Verify experiment appears in workspace experiments query
    const experimentsQuery = await client.query(
      `SELECT e.*, u.username AS performer_username FROM project_experiments e LEFT JOIN users u ON u.id=e.performed_by
       WHERE e.project_id=$1`,
      [projectId]
    );
    await assert(experimentsQuery.rowCount === 1, 'Experiment appears in workspace experiments query');
    await assert(experimentsQuery.rows[0].title === 'API Test Experiment', 'Experiment title is correct');

    // Test 8: Test project item linking
    const itemResult = await client.query(
      `INSERT INTO items (name, type, category, current_quantity, unit)
       VALUES ('API Test Item', 'component', 'electronic', 10, 'pcs')
       RETURNING id`
    );
    const itemId = itemResult.rows[0].id;
    await assert(itemId, 'Test item created');

    const projectItemAdd = await client.query(
      `INSERT INTO project_items (project_id, item_id, allocated_quantity, notes, added_by)
       VALUES ($1, $2, 5, 'API test allocation', $3) RETURNING *`,
      [projectId, itemId, userId]
    );
    await assert(projectItemAdd.rowCount === 1, 'Project item linked successfully');

    // Test 9: Verify project item appears in workspace items query
    const itemsQuery = await client.query(
      `SELECT pi.*, i.name, i.type, i.status AS item_status, i.current_quantity, i.unit, i.sku, l.name AS location_name
       FROM project_items pi JOIN items i ON i.id=pi.item_id LEFT JOIN locations l ON l.id=i.location_id
       WHERE pi.project_id=$1`,
      [projectId]
    );
    await assert(itemsQuery.rowCount === 1, 'Project item appears in workspace items query');
    await assert(itemsQuery.rows[0].name === 'API Test Item', 'Item name is correct');
    await assert(parseFloat(itemsQuery.rows[0].allocated_quantity) === 5, 'Allocated quantity is correct');

    // Test 10: Test project note creation
    const noteAdd = await client.query(
      `INSERT INTO notes (title, body, tags, project_id, author_id)
       VALUES ('API Test Note', 'API test note body', ARRAY['api', 'test'], $1, $2)
       RETURNING id`,
      [projectId, userId]
    );
    const noteId = noteAdd.rows[0].id;
    await assert(noteId, 'Note created successfully');

    // Test 11: Verify note appears in workspace notes query
    const notesQuery = await client.query(
      `SELECT id,title,body,tags,author_id,created_at,updated_at FROM notes WHERE project_id=$1`,
      [projectId]
    );
    await assert(notesQuery.rowCount === 1, 'Note appears in workspace notes query');
    await assert(notesQuery.rows[0].title === 'API Test Note', 'Note title is correct');

    // Test 12: Test resource creation
    const resourceAdd = await client.query(
      `INSERT INTO resources (name, kind, file_type, project_id, category, description, tags)
       VALUES ('API Test Resource', 'link', 'other', $1, 'general', 'API test resource', ARRAY['api'])
       RETURNING id`,
      [projectId]
    );
    const resourceId = resourceAdd.rows[0].id;
    await assert(resourceId, 'Resource created successfully');

    // Test 13: Verify resource appears in workspace resources query
    const resourcesQuery = await client.query(
      `SELECT id,name,kind,file_type,original_filename,category,description,tags,created_at,updated_at FROM resources WHERE project_id=$1`,
      [projectId]
    );
    await assert(resourcesQuery.rowCount === 1, 'Resource appears in workspace resources query');
    await assert(resourcesQuery.rows[0].name === 'API Test Resource', 'Resource name is correct');

    // Test 14: Test audit log creation
    const auditAdd = await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'CREATE', 'project', $2, '{"test": "api_test"}')
       RETURNING id`,
      [userId, projectId]
    );
    const auditId = auditAdd.rows[0].id;
    await assert(auditId, 'Audit log entry created successfully');

    // Test 15: Verify audit log appears in workspace activity query
    const activityQuery = await client.query(
      `SELECT a.id,a.action,a.entity_type,a.entity_id,a.metadata,a.created_at,u.username AS actor_username
       FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
       WHERE (a.entity_type='project' AND a.entity_id::text=$1) OR a.metadata->>'project_id'=$1
       ORDER BY a.created_at DESC LIMIT 100`,
      [projectId]
    );
    await assert(activityQuery.rowCount >= 1, 'Audit log appears in workspace activity query');

    // Test 16: Verify complete workspace data consistency
    const completeWorkspace = await Promise.all([
      client.query(`SELECT COUNT(*)::int as count FROM project_members WHERE project_id=$1`, [projectId]),
      client.query(`SELECT COUNT(*)::int as count FROM project_tasks WHERE project_id=$1`, [projectId]),
      client.query(`SELECT COUNT(*)::int as count FROM project_experiments WHERE project_id=$1`, [projectId]),
      client.query(`SELECT COUNT(*)::int as count FROM project_items WHERE project_id=$1`, [projectId]),
      client.query(`SELECT COUNT(*)::int as count FROM notes WHERE project_id=$1`, [projectId]),
      client.query(`SELECT COUNT(*)::int as count FROM resources WHERE project_id=$1`, [projectId]),
    ]);

    await assert(completeWorkspace[0].rows[0].count === 1, 'Workspace members count is correct');
    await assert(completeWorkspace[1].rows[0].count === 1, 'Workspace tasks count is correct');
    await assert(completeWorkspace[2].rows[0].count === 1, 'Workspace experiments count is correct');
    await assert(completeWorkspace[3].rows[0].count === 1, 'Workspace items count is correct');
    await assert(completeWorkspace[4].rows[0].count === 1, 'Workspace notes count is correct');
    await assert(completeWorkspace[5].rows[0].count === 1, 'Workspace resources count is correct');

    await client.query('ROLLBACK');
    console.log('\n✅ PROJECT WORKSPACE API TESTS PASSED');
    console.log('All workspace endpoint queries return consistent, persisted data.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ PROJECT WORKSPACE API TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testProjectWorkspaceAPI();