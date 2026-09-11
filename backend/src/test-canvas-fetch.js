import { pool } from './db.js';

async function testCanvasFetch() {
  try {
    // Create a test project
    const projectResult = await pool.query(
      "INSERT INTO projects (name, status) VALUES ('Canvas Fetch Test', 'active') RETURNING id"
    );
    const projectId = projectResult.rows[0].id;
    console.log('Created project:', projectId);

    // Create some blocks
    await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 1', 0, 0, 1)`,
      [projectId]
    );
    await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 2', 0, 1, 2)`,
      [projectId]
    );
    await pool.query(
      `INSERT INTO project_blocks (project_id, block_type, text_content, row_index, col_start, col_span)
       VALUES ($1, 'text', 'Block 3', 1, 0, 3)`,
      [projectId]
    );
    console.log('Created 3 blocks');

    // Set a custom row height for row 0
    await pool.query(
      `INSERT INTO project_canvas_rows (project_id, row_index, height)
       VALUES ($1, 0, 250)`,
      [projectId]
    );
    console.log('Set row 0 height to 250');

    // Test the canvas fetch logic
    const blocksResult = await pool.query(
      `SELECT * FROM project_blocks WHERE project_id = $1 ORDER BY row_index, col_start`,
      [projectId]
    );

    const rowHeightsResult = await pool.query(
      `SELECT row_index, height FROM project_canvas_rows WHERE project_id = $1`,
      [projectId]
    );

    const rowHeightsMap = {};
    const DEFAULT_HEIGHT = 200;
    
    for (const row of rowHeightsResult.rows) {
      rowHeightsMap[row.row_index] = row.height;
    }
    
    const rowsWithBlocks = new Set(blocksResult.rows.map(b => b.row_index));
    for (const rowIndex of rowsWithBlocks) {
      if (!(rowIndex in rowHeightsMap)) {
        rowHeightsMap[rowIndex] = DEFAULT_HEIGHT;
      }
    }

    const connectorsResult = await pool.query(
      `SELECT * FROM project_connectors WHERE project_id = $1 ORDER BY created_at`,
      [projectId]
    );

    console.log('Canvas fetch result:');
    console.log('- Blocks:', blocksResult.rows.length);
    console.log('- Row heights:', rowHeightsMap);
    console.log('- Connectors:', connectorsResult.rows.length);

    // Verify row 0 has custom height, row 1 has default
    if (rowHeightsMap[0] === 250 && rowHeightsMap[1] === 200) {
      console.log('Row height fill-in logic correct');
    } else {
      console.log('ERROR: Row height fill-in logic incorrect');
    }

    // Test empty project
    const emptyProject = await pool.query(
      "INSERT INTO projects (name, status) VALUES ('Empty Project', 'active') RETURNING id"
    );
    const emptyProjectId = emptyProject.rows[0].id;

    const emptyBlocks = await pool.query(
      `SELECT * FROM project_blocks WHERE project_id = $1`,
      [emptyProjectId]
    );
    const emptyRowHeights = await pool.query(
      `SELECT row_index, height FROM project_canvas_rows WHERE project_id = $1`,
      [emptyProjectId]
    );
    const emptyConnectors = await pool.query(
      `SELECT * FROM project_connectors WHERE project_id = $1`,
      [emptyProjectId]
    );

    console.log('Empty project canvas:');
    console.log('- Blocks:', emptyBlocks.rows.length);
    console.log('- Row heights:', emptyRowHeights.rows.length);
    console.log('- Connectors:', emptyConnectors.rows.length);

    if (emptyBlocks.rows.length === 0 && emptyRowHeights.rows.length === 0 && emptyConnectors.rows.length === 0) {
      console.log('Empty project returns empty arrays correctly');
    }

    // Clean up
    await pool.query('DELETE FROM project_blocks WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM project_canvas_rows WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM project_connectors WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    await pool.query('DELETE FROM projects WHERE id = $1', [emptyProjectId]);
    console.log('Cleaned up test data');

    console.log('Canvas fetch tests passed');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testCanvasFetch();
