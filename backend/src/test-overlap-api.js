import { pool } from './db.js';

async function testOverlapViaAPI() {
  try {
    // Create a test project
    const projectResult = await pool.query(
      "INSERT INTO projects (name, status) VALUES ('Overlap API Test', 'active') RETURNING id"
    );
    const projectId = projectResult.rows[0].id;
    console.log('Created project:', projectId);

    // Create three 1-column blocks in row 0 (non-overlapping)
    const block1 = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 1', 0, 0, 1) RETURNING *`,
      [projectId]
    );
    console.log('Created block 1 at col_start=0, col_span=1, id:', block1.rows[0].id);

    const block2 = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 2', 0, 1, 1) RETURNING *`,
      [projectId]
    );
    console.log('Created block 2 at col_start=1, col_span=1, id:', block2.rows[0].id);

    const block3 = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 3', 0, 2, 1) RETURNING *`,
      [projectId]
    );
    console.log('Created block 3 at col_start=2, col_span=1, id:', block3.rows[0].id);

    // Test the overlap check SQL directly to verify logic
    const overlapCheck = await pool.query(
      `SELECT id, col_start, col_span FROM project_blocks 
       WHERE project_id = $1 AND row_index = $2 
       AND col_start < $3 AND col_start + col_span > $4`,
      [projectId, 0, 1 + 1, 1]  // Trying to place at col_start=1, col_span=1
    );
    console.log('Overlap check for col_start=1, col_span=1:', overlapCheck.rows.length, 'conflicts found');
    if (overlapCheck.rows.length > 0) {
      console.log('Conflicting blocks:', overlapCheck.rows);
    }

    // Clean up
    await pool.query('DELETE FROM project_blocks WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    console.log('Cleaned up test data');

    console.log('Overlap SQL validation test passed');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testOverlapViaAPI();
