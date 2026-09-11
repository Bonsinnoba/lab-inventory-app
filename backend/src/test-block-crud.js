import { pool } from './db.js';

async function testBlockCRUD() {
  try {
    // Create a test project first
    const projectResult = await pool.query(
      "INSERT INTO projects (name, status) VALUES ('Test Canvas Project', 'active') RETURNING id"
    );
    const projectId = projectResult.rows[0].id;
    console.log('Created project:', projectId);

    // Create a text block
    const textBlockResult = await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Test block content', 0, 0, 2)
       RETURNING *`,
      [projectId]
    );
    console.log('Created text block:', textBlockResult.rows[0]);

    // Update the text block
    const updateResult = await pool.query(
      `UPDATE project_blocks SET text_content = 'Updated content', updated_at = now()
       WHERE id = $1 RETURNING *`,
      [textBlockResult.rows[0].id]
    );
    console.log('Updated text block:', updateResult.rows[0]);

    // Delete the block
    const deleteResult = await pool.query(
      'DELETE FROM project_blocks WHERE id = $1 RETURNING id',
      [textBlockResult.rows[0].id]
    );
    console.log('Deleted block:', deleteResult.rows[0]);

    // Clean up test project
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    console.log('Cleaned up test project');

    console.log('All block CRUD tests passed');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testBlockCRUD();
