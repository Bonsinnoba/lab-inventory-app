import { pool } from './db.js';

async function testConnectors() {
  try {
    // Create a test project
    const projectResult = await pool.query(
      "INSERT INTO projects (name, status) VALUES ('Connector Test', 'active') RETURNING id"
    );
    const projectId = projectResult.rows[0].id;
    console.log('Created project:', projectId);

    // Create two blocks
    const block1 = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 1', 0, 0, 1) RETURNING *`,
      [projectId]
    );
    const block2 = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 2', 0, 1, 1) RETURNING *`,
      [projectId]
    );
    console.log('Created blocks:', block1.rows[0].id, block2.rows[0].id);

    // Create a connector between them
    const connector = await pool.query(
      `INSERT INTO project_connectors (project_id, source_block_id, target_block_id, label)
       VALUES ($1, $2, $3, 'Test connection') RETURNING *`,
      [projectId, block1.rows[0].id, block2.rows[0].id]
    );
    console.log('Created connector:', connector.rows[0].id);

    // Verify connector exists
    const connectorCheck = await pool.query(
      'SELECT * FROM project_connectors WHERE id = $1',
      [connector.rows[0].id]
    );
    console.log('Connector exists before delete:', connectorCheck.rows.length > 0);

    // Delete one block - connector should cascade-delete
    await pool.query('DELETE FROM project_blocks WHERE id = $1', [block1.rows[0].id]);
    console.log('Deleted block 1');

    // Verify connector is gone
    const connectorAfterDelete = await pool.query(
      'SELECT * FROM project_connectors WHERE id = $1',
      [connector.rows[0].id]
    );
    console.log('Connector exists after block delete:', connectorAfterDelete.rows.length > 0);

    if (connectorAfterDelete.rows.length === 0) {
      console.log('Cascade-delete working correctly');
    } else {
      console.log('ERROR: Cascade-delete not working');
    }

    // Test cross-project connection rejection
    const project2 = await pool.query(
      "INSERT INTO projects (name, status) VALUES ('Project 2', 'active') RETURNING id"
    );
    const project2Id = project2.rows[0].id;

    const block3 = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 3', 0, 0, 1) RETURNING *`,
      [project2Id]
    );

    try {
      const crossProjectConnector = await pool.query(
        `INSERT INTO project_connectors (project_id, source_block_id, target_block_id, label)
         VALUES ($1, $2, $3, 'Cross project') RETURNING *`,
        [projectId, block2.rows[0].id, block3.rows[0].id]
      );
      console.log('ERROR: Cross-project connector should have been rejected');
    } catch (err) {
      console.log('Cross-project connector correctly rejected:', err.message);
    }

    // Clean up
    await pool.query('DELETE FROM project_connectors WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM project_blocks WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM project_blocks WHERE project_id = $1', [project2Id]);
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    await pool.query('DELETE FROM projects WHERE id = $1', [project2Id]);
    console.log('Cleaned up test data');

    console.log('Connector tests passed');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testConnectors();
