import { pool } from './db.js';

async function assert(condition, message) {
  if (!condition) throw new Error(`PROJECT WORKSPACE PERSISTENCE FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testProjectWorkspacePersistence() {
  const client = await pool.connect();
  let projectId = null;
  let userId = null;

  try {
    await client.query('BEGIN');

    // Create a test user for the tests
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('test_user_workspace', '$2b$12$test_hash_for_testing_only', 'member', TRUE)
       RETURNING id`
    );
    userId = userResult.rows[0].id;
    await assert(userId, 'Test user created');

    // Test 1: Project creation persists
    const projectResult = await client.query(
      `INSERT INTO projects (name, status, description, priority, owner_id)
       VALUES ('Workspace Test Project', 'active', 'Test description', 'normal', $1)
       RETURNING *`,
      [userId]
    );
    projectId = projectResult.rows[0].id;
    await assert(projectId, 'Project creation persists');
    await assert(projectResult.rows[0].name === 'Workspace Test Project', 'Project name persists');
    await assert(projectResult.rows[0].status === 'active', 'Project status persists');
    await assert(projectResult.rows[0].owner_id === userId, 'Project owner persists');

    // Test 2: Project update persists
    const updatedProject = await client.query(
      `UPDATE projects 
       SET name = 'Updated Workspace Project', status = 'on_hold', description = 'Updated description'
       WHERE id = $1 RETURNING *`,
      [projectId]
    );
    await assert(updatedProject.rows[0].name === 'Updated Workspace Project', 'Project name update persists');
    await assert(updatedProject.rows[0].status === 'on_hold', 'Project status update persists');
    await assert(updatedProject.rows[0].description === 'Updated description', 'Project description update persists');

    // Test 3: Project membership addition persists
    const memberResult = await client.query(
      `INSERT INTO project_members (project_id, user_id, member_role)
       VALUES ($1, $2, 'member') RETURNING *`,
      [projectId, userId]
    );
    await assert(memberResult.rowCount === 1, 'Project membership addition persists');
    await assert(memberResult.rows[0].member_role === 'member', 'Member role persists');

    // Test 4: Verify member appears in project query
    const membersQuery = await client.query(
      `SELECT pm.*, u.username FROM project_members pm 
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [projectId]
    );
    await assert(membersQuery.rowCount === 1, 'Member appears in project member query');
    await assert(membersQuery.rows[0].username === 'test_user_workspace', 'Member username is correct');

    // Test 5: Project membership role update persists
    const roleUpdate = await client.query(
      `UPDATE project_members SET member_role = 'lead' 
       WHERE project_id = $1 AND user_id = $2 RETURNING *`,
      [projectId, userId]
    );
    await assert(roleUpdate.rows[0].member_role === 'lead', 'Member role update persists');

    // Test 6: Task creation persists
    const taskResult = await client.query(
      `INSERT INTO project_tasks (project_id, title, description, status, priority, created_by)
       VALUES ($1, 'Test Task', 'Test task description', 'todo', 'normal', $2)
       RETURNING *`,
      [projectId, userId]
    );
    const taskId = taskResult.rows[0].id;
    await assert(taskId, 'Task creation persists');
    await assert(taskResult.rows[0].title === 'Test Task', 'Task title persists');
    await assert(taskResult.rows[0].status === 'todo', 'Task status persists');

    // Test 7: Task update persists
    const taskUpdate = await client.query(
      `UPDATE project_tasks 
       SET title = 'Updated Task', status = 'in_progress', priority = 'high'
       WHERE id = $1 RETURNING *`,
      [taskId]
    );
    await assert(taskUpdate.rows[0].title === 'Updated Task', 'Task title update persists');
    await assert(taskUpdate.rows[0].status === 'in_progress', 'Task status update persists');
    await assert(taskUpdate.rows[0].priority === 'high', 'Task priority update persists');

    // Test 8: Verify task appears in project tasks query
    const tasksQuery = await client.query(
      `SELECT * FROM project_tasks WHERE project_id = $1`,
      [projectId]
    );
    await assert(tasksQuery.rowCount === 1, 'Task appears in project tasks query');
    await assert(tasksQuery.rows[0].title === 'Updated Task', 'Task data is correct in query');

    // Test 9: Experiment creation persists
    const experimentResult = await client.query(
      `INSERT INTO project_experiments (project_id, title, status, hypothesis, performed_by)
       VALUES ($1, 'Test Experiment', 'planned', 'Test hypothesis', $2)
       RETURNING *`,
      [projectId, userId]
    );
    const experimentId = experimentResult.rows[0].id;
    await assert(experimentId, 'Experiment creation persists');
    await assert(experimentResult.rows[0].title === 'Test Experiment', 'Experiment title persists');
    await assert(experimentResult.rows[0].status === 'planned', 'Experiment status persists');

    // Test 10: Experiment update persists
    const experimentUpdate = await client.query(
      `UPDATE project_experiments 
       SET title = 'Updated Experiment', status = 'running', hypothesis = 'Updated hypothesis'
       WHERE id = $1 RETURNING *`,
      [experimentId]
    );
    await assert(experimentUpdate.rows[0].title === 'Updated Experiment', 'Experiment title update persists');
    await assert(experimentUpdate.rows[0].status === 'running', 'Experiment status update persists');
    await assert(experimentUpdate.rows[0].hypothesis === 'Updated hypothesis', 'Experiment hypothesis update persists');

    // Test 11: Verify experiment appears in project experiments query
    const experimentsQuery = await client.query(
      `SELECT * FROM project_experiments WHERE project_id = $1`,
      [projectId]
    );
    await assert(experimentsQuery.rowCount === 1, 'Experiment appears in project experiments query');
    await assert(experimentsQuery.rows[0].title === 'Updated Experiment', 'Experiment data is correct in query');

    // Test 12: Task deletion persists
    await client.query('DELETE FROM project_tasks WHERE id = $1', [taskId]);
    const taskAfterDelete = await client.query('SELECT * FROM project_tasks WHERE id = $1', [taskId]);
    await assert(taskAfterDelete.rowCount === 0, 'Task deletion persists');

    // Test 13: Experiment deletion persists
    await client.query('DELETE FROM project_experiments WHERE id = $1', [experimentId]);
    const experimentAfterDelete = await client.query('SELECT * FROM project_experiments WHERE id = $1', [experimentId]);
    await assert(experimentAfterDelete.rowCount === 0, 'Experiment deletion persists');

    // Test 14: Project membership deletion persists
    await client.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
    const memberAfterDelete = await client.query(
      'SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );
    await assert(memberAfterDelete.rowCount === 0, 'Project membership deletion persists');

    // Test 15: Verify workspace endpoint would return empty arrays after deletions
    const workspaceTasks = await client.query(
      `SELECT * FROM project_tasks WHERE project_id = $1`,
      [projectId]
    );
    await assert(workspaceTasks.rowCount === 0, 'Workspace tasks query returns empty after deletion');

    const workspaceExperiments = await client.query(
      `SELECT * FROM project_experiments WHERE project_id = $1`,
      [projectId]
    );
    await assert(workspaceExperiments.rowCount === 0, 'Workspace experiments query returns empty after deletion');

    const workspaceMembers = await client.query(
      `SELECT * FROM project_members WHERE project_id = $1`,
      [projectId]
    );
    await assert(workspaceMembers.rowCount === 0, 'Workspace members query returns empty after deletion');

    // Test 16: Project deletion persists
    await client.query('DELETE FROM projects WHERE id = $1', [projectId]);
    const projectAfterDelete = await client.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    await assert(projectAfterDelete.rowCount === 0, 'Project deletion persists');

    await client.query('ROLLBACK');
    console.log('\n✅ PROJECT WORKSPACE PERSISTENCE TESTS PASSED');
    console.log('All CRUD operations properly persist to database and are verified through queries.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ PROJECT WORKSPACE PERSISTENCE TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testProjectWorkspacePersistence();