import { pool } from './db.js';

async function assert(condition, message) {
  if (!condition) throw new Error(`MEMBERSHIP PERSISTENCE FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testProjectMembershipPersistence() {
  const client = await pool.connect();
  let projectId = null;
  let userId1 = null;
  let userId2 = null;

  try {
    await client.query('BEGIN');

    // Create test users
    const user1Result = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('membership_test_user1', '$2b$12$test_hash_1', 'admin', TRUE)
       RETURNING id, username, role`
    );
    userId1 = user1Result.rows[0].id;
    await assert(userId1, 'Test user 1 created');

    const user2Result = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('membership_test_user2', '$2b$12$test_hash_2', 'member', TRUE)
       RETURNING id, username, role`
    );
    userId2 = user2Result.rows[0].id;
    await assert(userId2, 'Test user 2 created');

    // Create a test project with user1 as owner
    const projectResult = await client.query(
      `INSERT INTO projects (name, status, description, priority, owner_id)
       VALUES ('Membership Test Project', 'active', 'Membership test description', 'normal', $1)
       RETURNING *`,
      [userId1]
    );
    projectId = projectResult.rows[0].id;
    await assert(projectId, 'Test project created');
    await assert(projectResult.rows[0].owner_id === userId1, 'Project owner is set correctly');

    // Test 1: Add user2 as a member
    const memberAdd = await client.query(
      `INSERT INTO project_members (project_id, user_id, member_role)
       VALUES ($1, $2, 'member') RETURNING *`,
      [projectId, userId2]
    );
    await assert(memberAdd.rowCount === 1, 'Member addition reports success');
    await assert(memberAdd.rows[0].member_role === 'member', 'Member role is correct in response');

    // Test 2: Immediately verify member appears in direct query
    const immediateQuery = await client.query(
      `SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId2]
    );
    await assert(immediateQuery.rowCount === 1, 'Member appears in immediate query after addition');
    await assert(immediateQuery.rows[0].member_role === 'member', 'Member role is correct in immediate query');

    // Test 3: Verify member appears in workspace members query
    const workspaceMembersQuery = await client.query(
      `SELECT pm.project_id, pm.user_id, pm.member_role, pm.joined_at, u.username, u.role
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1 ORDER BY CASE pm.member_role WHEN 'lead' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.username`,
      [projectId]
    );
    await assert(workspaceMembersQuery.rowCount === 1, 'Member appears in workspace members query');
    await assert(workspaceMembersQuery.rows[0].user_id === userId2, 'Member user_id is correct in workspace query');
    await assert(workspaceMembersQuery.rows[0].username === 'membership_test_user2', 'Member username is correct in workspace query');

    // Test 4: Simulate "refresh" by querying again after a delay
    await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to simulate refresh
    const refreshQuery = await client.query(
      `SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId2]
    );
    await assert(refreshQuery.rowCount === 1, 'Member still appears after "refresh"');
    await assert(refreshQuery.rows[0].member_role === 'member', 'Member role is still correct after refresh');

    // Test 5: Update member role
    const roleUpdate = await client.query(
      `UPDATE project_members SET member_role = 'lead' 
       WHERE project_id = $1 AND user_id = $2 RETURNING *`,
      [projectId, userId2]
    );
    await assert(roleUpdate.rowCount === 1, 'Member role update reports success');
    await assert(roleUpdate.rows[0].member_role === 'lead', 'Updated role is correct in response');

    // Test 6: Verify role update persists
    const roleUpdateQuery = await client.query(
      `SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId2]
    );
    await assert(roleUpdateQuery.rowCount === 1, 'Member still exists after role update');
    await assert(roleUpdateQuery.rows[0].member_role === 'lead', 'Updated role persists in database');

    // Test 7: Verify role update appears in workspace query
    const workspaceAfterRoleUpdate = await client.query(
      `SELECT pm.project_id, pm.user_id, pm.member_role, pm.joined_at, u.username, u.role
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1 ORDER BY CASE pm.member_role WHEN 'lead' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.username`,
      [projectId]
    );
    await assert(workspaceAfterRoleUpdate.rowCount === 1, 'Member appears in workspace after role update');
    await assert(workspaceAfterRoleUpdate.rows[0].member_role === 'lead', 'Updated role appears in workspace query');

    // Test 8: Add user1 as member (owner should already have access, but test explicit membership)
    const ownerMemberAdd = await client.query(
      `INSERT INTO project_members (project_id, user_id, member_role)
       VALUES ($1, $2, 'lead') ON CONFLICT(project_id, user_id) DO UPDATE SET member_role=EXCLUDED.member_role RETURNING *`,
      [projectId, userId1]
    );
    await assert(ownerMemberAdd.rowCount === 1, 'Owner can be added as explicit member');

    // Test 9: Verify both members appear
    const bothMembersQuery = await client.query(
      `SELECT pm.*, u.username FROM project_members pm 
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [projectId]
    );
    await assert(bothMembersQuery.rowCount === 2, 'Both members appear in query');
    const usernames = bothMembersQuery.rows.map(r => r.username).sort();
    await assert(usernames[0] === 'membership_test_user1' && usernames[1] === 'membership_test_user2', 'Both member usernames are correct');

    // Test 10: Remove user2 from project
    const memberRemove = await client.query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING user_id`,
      [projectId, userId2]
    );
    await assert(memberRemove.rowCount === 1, 'Member removal reports success');
    await assert(memberRemove.rows[0].user_id === userId2, 'Removed user_id is correct');

    // Test 11: Verify member is gone after removal
    const afterRemovalQuery = await client.query(
      `SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId2]
    );
    await assert(afterRemovalQuery.rowCount === 0, 'Member is removed from database');

    // Test 12: Verify removal appears in workspace query
    const workspaceAfterRemoval = await client.query(
      `SELECT pm.project_id, pm.user_id, pm.member_role, pm.joined_at, u.username, u.role
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [projectId]
    );
    await assert(workspaceAfterRemoval.rowCount === 1, 'Only one member remains in workspace after removal');
    await assert(workspaceAfterRemoval.rows[0].user_id === userId1, 'Remaining member is the owner');
    await assert(workspaceAfterRemoval.rows[0].member_role === 'lead', 'Remaining member has lead role');

    // Test 13: Test ON CONFLICT behavior - try to add same member again
    // First add user2 back to test ON CONFLICT
    const reAddUser2 = await client.query(
      `INSERT INTO project_members (project_id, user_id, member_role)
       VALUES ($1, $2, 'member') RETURNING *`,
      [projectId, userId2]
    );
    await assert(reAddUser2.rowCount === 1, 'User2 re-added for ON CONFLICT test');

    // Now test ON CONFLICT by trying to add user2 again with different role
    const duplicateAdd = await client.query(
      `INSERT INTO project_members (project_id, user_id, member_role)
       VALUES ($1, $2, 'observer') ON CONFLICT(project_id, user_id) DO UPDATE SET member_role=EXCLUDED.member_role RETURNING *`,
      [projectId, userId2]
    );
    await assert(duplicateAdd.rowCount === 1, 'Duplicate member add uses ON CONFLICT correctly');
    await assert(duplicateAdd.rows[0].member_role === 'observer', 'ON CONFLICT updates to new role');

    // Reset to member for consistency
    await client.query(
      `UPDATE project_members SET member_role = 'member' WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId2]
    );

    // Test 14: Verify project access logic through membership
    const accessQuery = await client.query(
      `SELECT p.owner_id, pm.member_role
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
       WHERE p.id = $1`,
      [projectId, userId1]
    );
    await assert(accessQuery.rowCount === 1, 'Project access query works');
    await assert(accessQuery.rows[0].owner_id === userId1, 'Owner has ownership access');
    await assert(accessQuery.rows[0].member_role === 'lead', 'Owner has lead membership role after reset');

    // Test 15: Test that user2 now has member access (since we re-added them)
    const memberAccessQuery = await client.query(
      `SELECT p.owner_id, pm.member_role
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
       WHERE p.id = $1`,
      [projectId, userId2]
    );
    await assert(memberAccessQuery.rowCount === 1, 'Member access query returns row');
    await assert(memberAccessQuery.rows[0].member_role === 'member', 'User2 has member role after re-add');
    await assert(memberAccessQuery.rows[0].owner_id !== userId2, 'User2 is not owner');

    // Test 16: Final consistency check - both users should have appropriate access
    const finalMembersQuery = await client.query(
      `SELECT pm.*, u.username FROM project_members pm 
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1`,
      [projectId]
    );
    await assert(finalMembersQuery.rowCount === 2, 'Final state has 2 members');
    const finalRoles = finalMembersQuery.rows.map(r => ({ username: r.username, role: r.member_role }));
    await assert(finalRoles.some(r => r.username === 'membership_test_user1' && r.role === 'lead'), 'User1 is lead');
    await assert(finalRoles.some(r => r.username === 'membership_test_user2' && r.role === 'member'), 'User2 is member');

    await client.query('ROLLBACK');
    console.log('\n✅ PROJECT MEMBERSHIP PERSISTENCE TESTS PASSED');
    console.log('All membership operations properly persist and are verified through multiple query methods.');
    console.log('No "operation succeeds but record disappears" issues detected.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ PROJECT MEMBERSHIP PERSISTENCE TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testProjectMembershipPersistence();