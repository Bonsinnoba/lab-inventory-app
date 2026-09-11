import { pool } from './db.js';

async function assert(condition, message) {
  if (!condition) throw new Error(`TASKS CRUD FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testTasksCRUD() {
  const client = await pool.connect();
  let projectId = null;
  let userId = null;
  let taskId = null;

  try {
    await client.query('BEGIN');

    // Create test user and project
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('tasks_test_user', '$2b$12$test_hash_tasks', 'admin', TRUE)
       RETURNING id`,
      []
    );
    userId = userResult.rows[0].id;

    const projectResult = await client.query(
      `INSERT INTO projects (name, status, description, priority, owner_id)
       VALUES ('Tasks Test Project', 'active', 'Tasks test description', 'normal', $1)
       RETURNING id`,
      [userId]
    );
    projectId = projectResult.rows[0].id;

    // Test 1: CREATE - Task creation with all fields
    const createResult = await client.query(
      `INSERT INTO project_tasks (project_id, title, description, status, priority, assignee_id, due_date, created_by)
       VALUES ($1, 'Test Task', 'Test task description', 'todo', 'normal', $2, '2026-12-31', $3)
       RETURNING *`,
      [projectId, userId, userId]
    );
    taskId = createResult.rows[0].id;
    await assert(taskId, 'Task creation returns ID');
    await assert(createResult.rows[0].title === 'Test Task', 'Task title persists on creation');
    await assert(createResult.rows[0].description === 'Test task description', 'Task description persists on creation');
    await assert(createResult.rows[0].status === 'todo', 'Task status persists on creation');
    await assert(createResult.rows[0].priority === 'normal', 'Task priority persists on creation');
    await assert(createResult.rows[0].assignee_id === userId, 'Task assignee persists on creation');
    await assert(createResult.rows[0].created_by === userId, 'Task created_by persists on creation');

    // Test 2: READ - Immediate read after creation
    const readResult = await client.query(
      `SELECT * FROM project_tasks WHERE id = $1`,
      [taskId]
    );
    await assert(readResult.rowCount === 1, 'Task can be read immediately after creation');
    await assert(readResult.rows[0].title === 'Test Task', 'Read task title matches created title');
    await assert(readResult.rows[0].status === 'todo', 'Read task status matches created status');

    // Test 3: READ - Task appears in project tasks query
    const projectTasksQuery = await client.query(
      `SELECT t.*, u.username AS assignee_username, c.username AS creator_username
       FROM project_tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN users c ON c.id=t.created_by
       WHERE t.project_id=$1`,
      [projectId]
    );
    await assert(projectTasksQuery.rowCount === 1, 'Task appears in project tasks query');
    await assert(projectTasksQuery.rows[0].title === 'Test Task', 'Task title in project query is correct');
    await assert(projectTasksQuery.rows[0].assignee_username === 'tasks_test_user', 'Assignee username is joined correctly');

    // Test 4: UPDATE - Single field update (title)
    const updateTitle = await client.query(
      `UPDATE project_tasks SET title = 'Updated Task Title' WHERE id = $1 RETURNING *`,
      [taskId]
    );
    await assert(updateTitle.rowCount === 1, 'Task title update reports success');
    await assert(updateTitle.rows[0].title === 'Updated Task Title', 'Updated title persists');

    // Test 5: READ - Verify title update persists
    const readAfterTitleUpdate = await client.query(
      `SELECT title FROM project_tasks WHERE id = $1`,
      [taskId]
    );
    await assert(readAfterTitleUpdate.rows[0].title === 'Updated Task Title', 'Title update persists in read');

    // Test 6: UPDATE - Status change (todo → in_progress)
    const updateStatus = await client.query(
      `UPDATE project_tasks SET status = 'in_progress' WHERE id = $1 RETURNING *`,
      [taskId]
    );
    await assert(updateStatus.rowCount === 1, 'Task status update reports success');
    await assert(updateStatus.rows[0].status === 'in_progress', 'Status update persists');
    await assert(updateStatus.rows[0].completed_at === null, 'completed_at is null for in_progress');

    // Test 7: UPDATE - Priority change
    const updatePriority = await client.query(
      `UPDATE project_tasks SET priority = 'high' WHERE id = $1 RETURNING *`,
      [taskId]
    );
    await assert(updatePriority.rowCount === 1, 'Task priority update reports success');
    await assert(updatePriority.rows[0].priority === 'high', 'Priority update persists');

    // Test 8: UPDATE - Multiple field update
    const updateMultiple = await client.query(
      `UPDATE project_tasks
       SET description = 'Updated description', due_date = '2027-06-30', assignee_id = NULL
       WHERE id = $1 RETURNING *`,
      [taskId]
    );
    await assert(updateMultiple.rowCount === 1, 'Multiple field update reports success');
    await assert(updateMultiple.rows[0].description === 'Updated description', 'Description update persists');
    await assert(updateMultiple.rows[0].due_date.toISOString().startsWith('2027-06-30'), 'Due date update persists');
    await assert(updateMultiple.rows[0].assignee_id === null, 'Assignee can be set to null');

    // Test 9: UPDATE - Change assignee to different user
    const user2Result = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('tasks_test_user2', '$2b$12$test_hash_tasks2', 'member', TRUE)
       RETURNING id`,
      []
    );
    const userId2 = user2Result.rows[0].id;

    const updateAssignee = await client.query(
      `UPDATE project_tasks SET assignee_id = $1 WHERE id = $2 RETURNING *`,
      [userId2, taskId]
    );
    await assert(updateAssignee.rowCount === 1, 'Assignee change reports success');
    await assert(updateAssignee.rows[0].assignee_id === userId2, 'Assignee change persists');

    // Test 10: UPDATE - Status change to done (should set completed_at)
    const updateDone = await client.query(
      `UPDATE project_tasks SET status = 'done' WHERE id = $1 RETURNING *`,
      [taskId]
    );
    await assert(updateDone.rowCount === 1, 'Status change to done reports success');
    await assert(updateDone.rows[0].status === 'done', 'Done status persists');
    await assert(updateDone.rows[0].completed_at !== null, 'completed_at is set when status becomes done');

    // Test 11: UPDATE - Status change from done to in_progress (should clear completed_at)
    const updateInProgress = await client.query(
      `UPDATE project_tasks SET status = 'in_progress' WHERE id = $1 RETURNING *`,
      [taskId]
    );
    await assert(updateInProgress.rowCount === 1, 'Status change from done reports success');
    await assert(updateInProgress.rows[0].status === 'in_progress', 'In_progress status persists');
    await assert(updateInProgress.rows[0].completed_at === null, 'completed_at is cleared when status is not done');

    // Test 12: UPDATE - Status change to blocked
    const updateBlocked = await client.query(
      `UPDATE project_tasks SET status = 'blocked' WHERE id = $1 RETURNING *`,
      [taskId]
    );
    await assert(updateBlocked.rowCount === 1, 'Status change to blocked reports success');
    await assert(updateBlocked.rows[0].status === 'blocked', 'Blocked status persists');

    // Test 13: UPDATE - Status change to cancelled
    const updateCancelled = await client.query(
      `UPDATE project_tasks SET status = 'cancelled' WHERE id = $1 RETURNING *`,
      [taskId]
    );
    await assert(updateCancelled.rowCount === 1, 'Status change to cancelled reports success');
    await assert(updateCancelled.rows[0].status === 'cancelled', 'Cancelled status persists');

    // Test 14: READ - Verify all updates persist
    const finalRead = await client.query(
      `SELECT * FROM project_tasks WHERE id = $1`,
      [taskId]
    );
    await assert(finalRead.rows[0].title === 'Updated Task Title', 'Final title is correct');
    await assert(finalRead.rows[0].status === 'cancelled', 'Final status is correct');
    await assert(finalRead.rows[0].priority === 'high', 'Final priority is correct');
    await assert(finalRead.rows[0].description === 'Updated description', 'Final description is correct');

    // Test 15: DELETE - Task deletion
    const deleteResult = await client.query(
      `DELETE FROM project_tasks WHERE id = $1 RETURNING id`,
      [taskId]
    );
    await assert(deleteResult.rowCount === 1, 'Task deletion reports success');
    await assert(deleteResult.rows[0].id === taskId, 'Deleted task ID is correct');

    // Test 16: READ - Verify task is gone after deletion
    const readAfterDelete = await client.query(
      `SELECT * FROM project_tasks WHERE id = $1`,
      [taskId]
    );
    await assert(readAfterDelete.rowCount === 0, 'Task is removed from database after deletion');

    // Test 17: READ - Verify task is gone from project query
    const projectTasksAfterDelete = await client.query(
      `SELECT * FROM project_tasks WHERE project_id = $1`,
      [projectId]
    );
    await assert(projectTasksAfterDelete.rowCount === 0, 'Task does not appear in project query after deletion');

    // Test 18: Test task creation with minimal fields
    const minimalTask = await client.query(
      `INSERT INTO project_tasks (project_id, title, created_by)
       VALUES ($1, 'Minimal Task', $2) RETURNING *`,
      [projectId, userId]
    );
    const minimalTaskId = minimalTask.rows[0].id;
    await assert(minimalTaskId, 'Minimal task creates successfully');
    await assert(minimalTask.rows[0].title === 'Minimal Task', 'Minimal task title persists');
    await assert(minimalTask.rows[0].description === '', 'Default description is empty string');
    await assert(minimalTask.rows[0].status === 'todo', 'Default status is todo');
    await assert(minimalTask.rows[0].priority === 'normal', 'Default priority is normal');

    // Test 19: Delete minimal task
    await client.query('DELETE FROM project_tasks WHERE id = $1', [minimalTaskId]);

    // Test 20: Test task with null due_date
    const taskNoDueDate = await client.query(
      `INSERT INTO project_tasks (project_id, title, created_by, due_date)
       VALUES ($1, 'Task No Due Date', $2, NULL) RETURNING *`,
      [projectId, userId]
    );
    const noDueDateId = taskNoDueDate.rows[0].id;
    await assert(taskNoDueDate.rows[0].due_date === null, 'Null due_date persists');

    // Test 21: Update null due_date to actual date
    const updateDueDate = await client.query(
      `UPDATE project_tasks SET due_date = '2026-12-25' WHERE id = $1 RETURNING due_date`,
      [noDueDateId]
    );
    await assert(updateDueDate.rows[0].due_date !== null, 'Due date can be updated from null');

    // Test 22: Delete task with due date
    await client.query('DELETE FROM project_tasks WHERE id = $1', [noDueDateId]);

    // Test 23: Test task ordering by status (as used in workspace query)
    const task1 = await client.query(
      `INSERT INTO project_tasks (project_id, title, status, created_by)
       VALUES ($1, 'Low Priority Task', 'todo', $2) RETURNING id`,
      [projectId, userId]
    );
    const task2 = await client.query(
      `INSERT INTO project_tasks (project_id, title, status, created_by)
       VALUES ($1, 'High Priority Task', 'in_progress', $2) RETURNING id`,
      [projectId, userId]
    );
    const task3 = await client.query(
      `INSERT INTO project_tasks (project_id, title, status, created_by)
       VALUES ($1, 'Blocked Task', 'blocked', $2) RETURNING id`,
      [projectId, userId]
    );

    const orderedTasks = await client.query(
      `SELECT * FROM project_tasks WHERE project_id=$1
       ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'blocked' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
       due_date NULLS LAST, created_at DESC`,
      [projectId]
    );
    await assert(orderedTasks.rowCount === 3, 'All tasks appear in ordered query');
    await assert(orderedTasks.rows[0].status === 'in_progress', 'In_progress task comes first in ordering');
    await assert(orderedTasks.rows[1].status === 'todo', 'Todo task comes second in ordering');
    await assert(orderedTasks.rows[2].status === 'blocked', 'Blocked task comes third in ordering');

    // Test 24: Clean up test tasks
    await client.query('DELETE FROM project_tasks WHERE project_id = $1', [projectId]);

    // Test 25: Test task with assignee but no due_date
    const taskAssigneeNoDate = await client.query(
      `INSERT INTO project_tasks (project_id, title, assignee_id, created_by)
       VALUES ($1, 'Assignee Task', $2, $3) RETURNING *`,
      [projectId, userId2, userId]
    );
    await assert(taskAssigneeNoDate.rows[0].assignee_id === userId2, 'Assignee persists without due_date');
    await assert(taskAssigneeNoDate.rows[0].due_date === null, 'Due_date is null when not provided');

    // Test 26: Delete final test task
    await client.query('DELETE FROM project_tasks WHERE id = $1', [taskAssigneeNoDate.rows[0].id]);

    await client.query('ROLLBACK');
    console.log('\n✅ TASKS CRUD TESTS PASSED');
    console.log('All task CRUD operations properly persist to database.');
    console.log('CREATE → READ → UPDATE → DELETE lifecycle verified.');
    console.log('Status transitions and completed_at trigger behavior verified.');
    console.log('Task ordering and query behavior verified.');
    console.log('Null value handling and default values verified.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ TASKS CRUD TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testTasksCRUD();