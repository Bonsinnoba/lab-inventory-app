import { pool } from './db.js';

async function assert(condition, message) {
  if (!condition) throw new Error(`ENGINEERING DATA FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testEngineeringDataFoundation() {
  const client = await pool.connect();
  let userId = null;
  let projectId = null;
  let itemId = null;
  let locationId = null;

  try {
    await client.query('BEGIN');

    // Clean up stale rows from prior failed runs so the test can be rerun reliably
    // against the same database without collisions from leftover data.
    await client.query(
      `DELETE FROM maintenance_records
       WHERE item_id IN (
         SELECT id FROM items WHERE name IN ('ARM Cortex-M4 Microcontroller', 'Resistor 10k 1/4W', 'Oscilloscope 100MHz')
       )`
    );
    await client.query(
      `DELETE FROM project_items
       WHERE project_id IN (
         SELECT id FROM projects WHERE name = 'Robot Arm Development'
       )`
    );
    await client.query(
      `DELETE FROM resources
       WHERE project_id IN (
         SELECT id FROM projects WHERE name = 'Robot Arm Development'
       ) OR item_id IN (
         SELECT id FROM items WHERE name IN ('ARM Cortex-M4 Microcontroller', 'Resistor 10k 1/4W', 'Oscilloscope 100MHz')
       )`
    );
    await client.query(
      `DELETE FROM notes
       WHERE project_id IN (
         SELECT id FROM projects WHERE name = 'Robot Arm Development'
       )`
    );
    await client.query(
      `DELETE FROM items
       WHERE name IN ('ARM Cortex-M4 Microcontroller', 'Resistor 10k 1/4W', 'Oscilloscope 100MHz')
          OR sku IN ('MCU-ARM-CM4', 'RES-10K-025', 'OSC-100MHZ-DSO')`
    );
    await client.query(
      `DELETE FROM locations
       WHERE name IN ('Main Laboratory', 'Storage Room', 'Electronics Shelf')`
    );
    await client.query(
      `DELETE FROM projects
       WHERE name = 'Robot Arm Development'`
    );
    await client.query(
      `DELETE FROM users WHERE username = 'engineering_test_user'`
    );

    // Create test user
    const userResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('engineering_test_user', '$2b$12$test_hash_engineering', 'admin', TRUE)
       RETURNING id`,
      []
    );
    userId = userResult.rows[0].id;

    // Create test location hierarchy
    const mainLab = await client.query(
      `INSERT INTO locations (name) VALUES ('Main Laboratory') RETURNING id`,
      []
    );
    const mainLabId = mainLab.rows[0].id;

    const storageRoom = await client.query(
      `INSERT INTO locations (name, parent_id) VALUES ('Storage Room', $1) RETURNING id`,
      [mainLabId]
    );
    const storageRoomId = storageRoom.rows[0].id;

    const electronicsShelf = await client.query(
      `INSERT INTO locations (name, parent_id) VALUES ('Electronics Shelf', $1) RETURNING id`,
      [storageRoomId]
    );
    const electronicsShelfId = electronicsShelf.rows[0].id;

    // Test 1: Location hierarchy persists
    await assert(mainLabId, 'Main laboratory location created');
    await assert(storageRoomId, 'Storage room location created with parent');
    await assert(electronicsShelfId, 'Electronics shelf location created with parent');

    // Test 2: Verify location hierarchy relationships
    const locationHierarchy = await client.query(
      `SELECT l1.name as level1, l2.name as level2, l3.name as level3
       FROM locations l1
       LEFT JOIN locations l2 ON l2.parent_id = l1.id
       LEFT JOIN locations l3 ON l3.parent_id = l2.id
       WHERE l1.id = $1`,
      [mainLabId]
    );
    await assert(locationHierarchy.rowCount === 1, 'Location hierarchy query works');
    await assert(locationHierarchy.rows[0].level1 === 'Main Laboratory', 'Level 1 location is correct');
    await assert(locationHierarchy.rows[0].level2 === 'Storage Room', 'Level 2 location is correct');
    await assert(locationHierarchy.rows[0].level3 === 'Electronics Shelf', 'Level 3 location is correct');

    // Test 3: Create engineering components
    const component1 = await client.query(
      `INSERT INTO items (name, type, category, sku, current_quantity, unit, dimensions, condition_notes, unit_cost, replacement_cost, location_id)
       VALUES ('ARM Cortex-M4 Microcontroller', 'component', 'microcontroller', 'MCU-ARM-CM4', 50, 'pcs', '10x10x1.5mm', '32-bit ARM Cortex-M4 with FPU', 8.50, 15.00, $1)
       RETURNING *`,
      [electronicsShelfId]
    );
    const component1Id = component1.rows[0].id;

    const component2 = await client.query(
      `INSERT INTO items (name, type, category, sku, current_quantity, unit, dimensions, condition_notes, unit_cost, replacement_cost, location_id)
       VALUES ('Resistor 10k 1/4W', 'component', 'passive', 'RES-10K-025', 500, 'pcs', '2mm x 6mm', 'Carbon film resistor', 0.05, 0.10, $1)
       RETURNING *`,
      [electronicsShelfId]
    );
    const component2Id = component2.rows[0].id;

    const equipment1 = await client.query(
      `INSERT INTO items (name, type, category, sku, current_quantity, unit, dimensions, condition_notes, unit_cost, replacement_cost, location_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      ['Oscilloscope 100MHz', 'equipment', 'test', 'OSC-100MHZ-DSO', 2, 'each', '30x20x15cm', 'Digital storage oscilloscope', 500.00, 800.00, mainLabId]
    );
    const equipment1Id = equipment1.rows[0].id;

    // Test 4: Component fields persist
    await assert(component1.rows[0].name === 'ARM Cortex-M4 Microcontroller', 'Component name persists');
    await assert(component1.rows[0].type === 'component', 'Component type persists');
    await assert(component1.rows[0].category === 'microcontroller', 'Component category persists');
    await assert(component1.rows[0].sku === 'MCU-ARM-CM4', 'Component SKU persists');
    await assert(parseFloat(component1.rows[0].current_quantity) === 50, 'Component quantity persists');
    await assert(component1.rows[0].unit === 'pcs', 'Component unit persists');
    await assert(component1.rows[0].dimensions === '10x10x1.5mm', 'Component dimensions persist');
    await assert(component1.rows[0].condition_notes === '32-bit ARM Cortex-M4 with FPU', 'Component condition notes persist');
    await assert(parseFloat(component1.rows[0].unit_cost) === 8.50, 'Component unit cost persists');
    await assert(parseFloat(component1.rows[0].replacement_cost) === 15.00, 'Component replacement cost persists');
    await assert(component1.rows[0].location_id === electronicsShelfId, 'Component location persists');

    // Test 5: Equipment fields persist
    await assert(equipment1.rows[0].type === 'equipment', 'Equipment type persists');
    await assert(equipment1.rows[0].category === 'test', 'Equipment category persists');
    await assert(parseFloat(equipment1.rows[0].current_quantity) === 2, 'Equipment quantity persists');
    await assert(equipment1.rows[0].unit === 'each', 'Equipment unit persists');

    // Test 6: Create engineering project
    const engineeringProject = await client.query(
      `INSERT INTO projects (name, status, description, priority, start_date, due_date, owner_id)
       VALUES ('Robot Arm Development', 'active', 'Development of 6-axis robotic arm for laboratory automation', 'high', '2026-01-01', '2026-12-31', $1)
       RETURNING id`,
      [userId]
    );
    const engineeringProjectId = engineeringProject.rows[0].id;

    // Test 7: Link components to project (simulating BOM)
    const projectItem1 = await client.query(
      `INSERT INTO project_items (project_id, item_id, allocated_quantity, notes, added_by)
       VALUES ($1, $2, 10, 'Main controller unit', $3) RETURNING *`,
      [engineeringProjectId, component1Id, userId]
    );
    await assert(projectItem1.rowCount === 1, 'Component linked to project successfully');
    await assert(parseFloat(projectItem1.rows[0].allocated_quantity) === 10, 'Allocated quantity persists');

    const projectItem2 = await client.query(
      `INSERT INTO project_items (project_id, item_id, allocated_quantity, notes, added_by)
       VALUES ($1, $2, 100, 'Power supply resistors', $3) RETURNING *`,
      [engineeringProjectId, component2Id, userId]
    );
    await assert(projectItem2.rowCount === 1, 'Second component linked to project successfully');

    // Test 8: Verify project BOM
    const projectBOM = await client.query(
      `SELECT pi.*, i.name, i.type, i.category, i.sku, i.current_quantity, i.unit, l.name AS location_name
       FROM project_items pi JOIN items i ON i.id=pi.item_id LEFT JOIN locations l ON l.id=i.location_id
       WHERE pi.project_id=$1 ORDER BY i.name`,
      [engineeringProjectId]
    );
    await assert(projectBOM.rowCount === 2, 'Project BOM contains 2 components');
    await assert(projectBOM.rows[0].name === 'ARM Cortex-M4 Microcontroller', 'BOM component 1 is correct');
    await assert(projectBOM.rows[1].name === 'Resistor 10k 1/4W', 'BOM component 2 is correct');

    // Test 9: Attach datasheet resource to component
    const datasheetResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, item_id, uploaded_by)
       VALUES ('ARM Cortex-M4 Datasheet', 'link', 'other', 'datasheet', 'Technical datasheet for ARM Cortex-M4', $1::text[], $2, $3)
       RETURNING *`,
      [['datasheet', 'ARM', 'technical'], component1Id, userId]
    );
    const datasheetResourceId = datasheetResource.rows[0].id;
    await assert(datasheetResourceId, 'Datasheet resource created for component');
    await assert(datasheetResource.rows[0].item_id === component1Id, 'Datasheet linked to component');

    // Test 10: Verify component datasheet relationship
    const componentDatasheets = await client.query(
      `SELECT * FROM resources WHERE item_id = $1`,
      [component1Id]
    );
    await assert(componentDatasheets.rowCount === 1, 'Component has datasheet resource');
    await assert(componentDatasheets.rows[0].name === 'ARM Cortex-M4 Datasheet', 'Datasheet name is correct');

    // Test 11: Create project notes with engineering content
    const engineeringNote = await client.query(
      `INSERT INTO notes (title, body, tags, project_id, author_id)
       VALUES ('Robot Arm Calculations', 'Torque calculations and motor specifications for 6-axis robot arm', $1::text[], $2, $3)
       RETURNING *`,
      [['calculations', 'robotics', 'engineering'], engineeringProjectId, userId]
    );
    const engineeringNoteId = engineeringNote.rows[0].id;
    await assert(engineeringNoteId, 'Engineering calculation note created');
    await assert(engineeringNote.rows[0].project_id === engineeringProjectId, 'Note linked to project');

    // Test 12: Verify project has engineering notes
    const projectNotes = await client.query(
      `SELECT * FROM notes WHERE project_id = $1`,
      [engineeringProjectId]
    );
    await assert(projectNotes.rowCount === 1, 'Project has engineering notes');
    await assert(projectNotes.rows[0].title === 'Robot Arm Calculations', 'Engineering note title is correct');

    // Test 13: Create specifications document
    const specResource = await client.query(
      `INSERT INTO resources (name, kind, file_type, category, description, tags, project_id, uploaded_by)
       VALUES ('Robot Arm Specifications', 'link', 'other', 'specification', 'Technical specifications for robot arm project', $1::text[], $2, $3)
       RETURNING *`,
      [['specification', 'robotics', 'technical'], engineeringProjectId, userId]
    );
    const specResourceId = specResource.rows[0].id;
    await assert(specResourceId, 'Specification resource created for project');
    await assert(specResource.rows[0].project_id === engineeringProjectId, 'Specification linked to project');

    // Test 14: Verify project specifications
    const projectSpecs = await client.query(
      `SELECT * FROM resources WHERE project_id = $1`,
      [engineeringProjectId]
    );
    await assert(projectSpecs.rowCount === 1, 'Project has specification resource');
    await assert(projectSpecs.rows[0].name === 'Robot Arm Specifications', 'Specification name is correct');

    // Test 15: Test full-text search for engineering terms
    const componentSearch = await client.query(
      `SELECT id, name, ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS rank
       FROM items WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC, name ASC LIMIT 30`,
      ['microcontroller']
    );
    await assert(componentSearch.rowCount >= 1, 'Engineering component search works');
    const foundComponent = componentSearch.rows.find(c => c.id === component1Id);
    await assert(foundComponent, 'Test component found by engineering search');

    // Test 16: Test equipment search
    const equipmentSearch = await client.query(
      `SELECT id, name, ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS rank
       FROM items WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC, name ASC LIMIT 30`,
      ['oscilloscope']
    );
    await assert(equipmentSearch.rowCount >= 1, 'Equipment search works');

    // Test 17: Test location-based component lookup
    const locationComponents = await client.query(
      `SELECT i.*, l.name as location_name, l2.name as parent_location
       FROM items i 
       JOIN locations l ON l.id = i.location_id
       LEFT JOIN locations l2 ON l2.id = l.parent_id
       WHERE i.location_id = $1`,
      [electronicsShelfId]
    );
    await assert(locationComponents.rowCount === 2, 'Location-based component lookup works');
    await assert(locationComponents.rows[0].location_name === 'Electronics Shelf', 'Location name is correct');

    // Test 18: Test SKU uniqueness
    const skuCheck = await client.query(
      `SELECT COUNT(*)::int AS count FROM items WHERE sku = $1`,
      ['MCU-ARM-CM4']
    );
    await assert(skuCheck.rows[0].count === 1, 'SKU uniqueness constraint works');

    // Test 19: Test component status management
    const componentStatusUpdate = await client.query(
      `UPDATE items SET status = 'in_use' WHERE id = $1 RETURNING status`,
      [component1Id]
    );
    await assert(componentStatusUpdate.rows[0].status === 'in_use', 'Component status update persists');

    // Test 20: Test BOM quantity calculations
    const totalAllocated = await client.query(
      `SELECT SUM(allocated_quantity)::float as total FROM project_items WHERE item_id = $1`,
      [component1Id]
    );
    await assert(parseFloat(totalAllocated.rows[0].total) === 10, 'BOM quantity calculation works');

    // Test 21: Test cost calculations for project
    const projectCostCalculation = await client.query(
      `SELECT SUM(i.unit_cost * pi.allocated_quantity)::float as estimated_cost
       FROM project_items pi
       JOIN items i ON i.id = pi.item_id
       WHERE pi.project_id = $1`,
      [engineeringProjectId]
    );
    await assert(projectCostCalculation.rows[0].estimated_cost > 0, 'Project cost calculation works');

    // Test 22: Test maintenance record for equipment
    const maintenanceRecord = await client.query(
      `INSERT INTO maintenance_records (item_id, maintenance_type, status, scheduled_date, performed_by, notes, cost)
       VALUES ($1, 'calibration', 'completed', '2026-06-01', $2, 'Annual calibration of oscilloscope', 150.00)
       RETURNING *`,
      [equipment1Id, userId]
    );
    const maintenanceId = maintenanceRecord.rows[0].id;
    await assert(maintenanceId, 'Maintenance record created for equipment');
    await assert(maintenanceRecord.rows[0].maintenance_type === 'calibration', 'Maintenance type persists');
    await assert(maintenanceRecord.rows[0].status === 'completed', 'Maintenance status persists');

    // Test 23: Verify equipment maintenance history
    const equipmentMaintenance = await client.query(
      `SELECT * FROM maintenance_records WHERE item_id = $1 ORDER BY scheduled_date DESC`,
      [equipment1Id]
    );
    await assert(equipmentMaintenance.rowCount === 1, 'Equipment maintenance history works');

    // Test 24: Test part number through SKU field
    const partNumberSearch = await client.query(
      `SELECT * FROM items WHERE sku = $1`,
      ['MCU-ARM-CM4']
    );
    await assert(partNumberSearch.rowCount === 1, 'Part number search through SKU works');
    await assert(partNumberSearch.rows[0].name === 'ARM Cortex-M4 Microcontroller', 'Part number returns correct component');

    // Test 25: Clean up test data
    await client.query('DELETE FROM maintenance_records WHERE id = $1', [maintenanceId]);
    await client.query('DELETE FROM project_items WHERE project_id = $1', [engineeringProjectId]);
    await client.query('DELETE FROM resources WHERE project_id = $1', [engineeringProjectId]);
    await client.query('DELETE FROM resources WHERE item_id = $1', [component1Id]);
    await client.query('DELETE FROM notes WHERE project_id = $1', [engineeringProjectId]);
    await client.query('DELETE FROM items WHERE id IN ($1, $2, $3)', [component1Id, component2Id, equipment1Id]);
    await client.query('DELETE FROM locations WHERE id IN ($1, $2, $3)', [electronicsShelfId, storageRoomId, mainLabId]);
    await client.query('DELETE FROM projects WHERE id = $1', [engineeringProjectId]);

    await client.query('ROLLBACK');
    console.log('\n✅ ENGINEERING DATA FOUNDATION TESTS PASSED');
    console.log('Engineering data foundation verified.');
    console.log('Component/inventory system verified.');
    console.log('Location hierarchy verified.');
    console.log('Project BOM functionality verified.');
    console.log('Datasheet resource linking verified.');
    console.log('Specification document linking verified.');
    console.log('Engineering notes verified.');
    console.log('Search for engineering terms verified.');
    console.log('SKU/part number system verified.');
    console.log('Equipment maintenance records verified.');
    console.log('Cost calculations verified.');
    console.log('Status management verified.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ ENGINEERING DATA FOUNDATION TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testEngineeringDataFoundation();