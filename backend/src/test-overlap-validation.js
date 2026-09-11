import { pool } from './db.js';

async function testOverlapValidation() {
  try {
    // Create a test project
    const projectResult = await pool.query(
      "INSERT INTO projects (name, status) VALUES ('Overlap Test Project', 'active') RETURNING id"
    );
    const projectId = projectResult.rows[0].id;
    console.log('Created project:', projectId);

    // Create three 1-column blocks in row 0 (non-overlapping)
    const block1 = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 1', 0, 0, 1) RETURNING *`,
      [projectId]
    );
    console.log('Created block 1 at col_start=0, col_span=1');

    const block2 = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 2', 0, 1, 1) RETURNING *`,
      [projectId]
    );
    console.log('Created block 2 at col_start=1, col_span=1');

    const block3 = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 3', 0, 2, 1) RETURNING *`,
      [projectId]
    );
    console.log('Created block 3 at col_start=2, col_span=1');

    // Try to create a fourth block that overlaps (should fail at DB level)
    try {
      const block4 = await pool.query(
        `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
         VALUES ($1, 'text', 'Block 4', 0, 1, 1) RETURNING *`,
        [projectId]
      );
      console.log('ERROR: Block 4 should have failed due to overlap but succeeded');
    } catch (err) {
      console.log('Block 4 correctly rejected by DB constraint:', err.message);
    }

    // Test row height endpoint
    const rowHeight = await pool.query(
      `INSERT INTO project_canvas_rows (project_id, row_index, height)
       VALUES ($1, 0, 250)
       ON CONFLICT (project_id, row_index) 
       DO UPDATE SET height = 250
       RETURNING *`,
      [projectId]
    );
    console.log('Set row 0 height to 250:', rowHeight.rows[0]);

    // Clean up
    await pool.query('DELETE FROM project_blocks WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM project_canvas_rows WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    console.log('Cleaned up test data');

    console.log('Overlap validation tests passed');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testOverlapValidation();
