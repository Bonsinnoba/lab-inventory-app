import { pool } from './db.js';

async function assert(condition, message) {
  if (!condition) throw new Error(`F2 FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testF2Foundation() {
  const client = await pool.connect();
  let projectId = null;

  try {
    await client.query('BEGIN');

    // Current free-form canvas schema must exist; legacy grid columns/tables
    // must not be required by the application.
    const columns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'project_blocks'
    `);
    const columnNames = new Set(columns.rows.map(r => r.column_name));
    for (const name of ['x', 'y', 'width', 'height', 'title']) {
      await assert(columnNames.has(name), `project_blocks has ${name}`);
    }
    for (const name of ['row_index', 'col_start', 'col_span']) {
      await assert(!columnNames.has(name), `legacy project_blocks column ${name} is absent`);
    }

    const project = await client.query(
      `INSERT INTO projects (name, status) VALUES ('F2 Verification Project', 'active') RETURNING id`
    );
    projectId = project.rows[0].id;

    const block1 = await client.query(
      `INSERT INTO project_blocks
       (project_id, block_type, text_content, title, x, y, width, height)
       VALUES ($1, 'text', 'F2 block one', 'Block One', 25, 40, 320, 200)
       RETURNING *`,
      [projectId]
    );
    const block2 = await client.query(
      `INSERT INTO project_blocks
       (project_id, block_type, text_content, x, y, width, height)
       VALUES ($1, 'text', 'F2 block two', 500, 40, 280, 180)
       RETURNING *`,
      [projectId]
    );

    await assert(block1.rows[0].x === 25 && block1.rows[0].y === 40, 'free-form block position persists');
    await assert(block1.rows[0].width === 320 && block1.rows[0].height === 200, 'free-form block size persists');

    const updated = await client.query(
      `UPDATE project_blocks
       SET title = 'Updated Block', x = 125, y = 150, width = 400, height = 260, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [block1.rows[0].id]
    );
    await assert(updated.rows[0].title === 'Updated Block', 'block update persists');
    await assert(updated.rows[0].x === 125 && updated.rows[0].y === 150, 'block position update persists');
    await assert(updated.rows[0].width === 400 && updated.rows[0].height === 260, 'block size update persists');

    const connector = await client.query(
      `INSERT INTO project_connectors (project_id, source_block_id, target_block_id, label)
       VALUES ($1, $2, $3, 'F2 test connection') RETURNING id`,
      [projectId, block1.rows[0].id, block2.rows[0].id]
    );
    await assert(connector.rowCount === 1, 'connector creation persists');

    await client.query('DELETE FROM project_blocks WHERE id = $1', [block1.rows[0].id]);
    const connectorAfterCascade = await client.query(
      'SELECT id FROM project_connectors WHERE id = $1',
      [connector.rows[0].id]
    );
    await assert(connectorAfterCascade.rowCount === 0, 'connector cascades when source block is deleted');

    const resource = await client.query(
      `INSERT INTO resources
       (name, kind, file_type, project_id, category, description, tags)
       VALUES ('F2 Resource', 'link', 'other', $1, 'general', 'F2 test', ARRAY['f2'])
       RETURNING id`,
      [projectId]
    );
    await assert(resource.rowCount === 1, 'resource creation persists');

    const mediaBlock = await client.query(
      `INSERT INTO project_blocks
       (project_id, block_type, resource_id, x, y, width, height)
       VALUES ($1, 'image', $2, 0, 0, 320, 200)
       RETURNING id`,
      [projectId, resource.rows[0].id]
    );
    await assert(mediaBlock.rowCount === 1, 'media block can reference a project resource');

    // Deleting a referenced media resource must fail rather than silently
    // leaving an invalid block with resource_id = NULL.
    let resourceDeleteRejected = false;
    try {
      await client.query('DELETE FROM resources WHERE id = $1', [resource.rows[0].id]);
    } catch {
      resourceDeleteRejected = true;
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      // Recreate the verification project state after the failed statement
      // because PostgreSQL aborts the transaction on constraint violation.
      const p = await client.query(
        `INSERT INTO projects (name, status) VALUES ('F2 Verification Project 2', 'active') RETURNING id`
      );
      projectId = p.rows[0].id;
    }
    await assert(resourceDeleteRejected, 'referenced media resource deletion is rejected safely');

    await client.query('ROLLBACK');
    console.log('\nF2 foundation checks passed.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testF2Foundation();
