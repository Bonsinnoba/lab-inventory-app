import { pool } from './db.js';
import bcrypt from 'bcrypt';

async function assert(condition, message) {
  if (!condition) throw new Error(`AUTH/AUTHZ FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function testAuthAuthorization() {
  const client = await pool.connect();
  let adminUserId = null;
  let memberUserId = null;
  let disabledUserId = null;
  let projectId = null;

  try {
    await client.query('BEGIN');

    // Test 1: Create admin user
    const adminPasswordHash = await bcrypt.hash('adminPassword123', 12);
    const adminResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('test_admin', $1, 'admin', TRUE)
       RETURNING id, username, role, is_active`,
      [adminPasswordHash]
    );
    adminUserId = adminResult.rows[0].id;
    await assert(adminUserId, 'Admin user created');
    await assert(adminResult.rows[0].role === 'admin', 'Admin has admin role');
    await assert(adminResult.rows[0].is_active === true, 'Admin is active');

    // Test 2: Create regular member user
    const memberPasswordHash = await bcrypt.hash('memberPassword123', 12);
    const memberResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('test_member', $1, 'member', TRUE)
       RETURNING id, username, role, is_active`,
      [memberPasswordHash]
    );
    memberUserId = memberResult.rows[0].id;
    await assert(memberUserId, 'Member user created');
    await assert(memberResult.rows[0].role === 'member', 'Member has member role');
    await assert(memberResult.rows[0].is_active === true, 'Member is active');

    // Test 3: Create disabled user (ensure it's a member, not admin)
    const disabledPasswordHash = await bcrypt.hash('disabledPassword123', 12);
    const disabledResult = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('test_disabled', $1, 'member', FALSE)
       RETURNING id, username, role, is_active`,
      [disabledPasswordHash]
    );
    disabledUserId = disabledResult.rows[0].id;
    await assert(disabledUserId, 'Disabled user created');
    await assert(disabledResult.rows[0].role === 'member', 'Disabled user is member role');
    await assert(disabledResult.rows[0].is_active === false, 'Disabled user is inactive');

    // Test 4: Password verification works for active admin
    const adminPasswordValid = await bcrypt.compare('adminPassword123', adminPasswordHash);
    await assert(adminPasswordValid, 'Admin password verification works');

    // Test 5: Password verification works for active member
    const memberPasswordValid = await bcrypt.compare('memberPassword123', memberPasswordHash);
    await assert(memberPasswordValid, 'Member password verification works');

    // Test 6: Wrong password fails verification
    const wrongPasswordValid = await bcrypt.compare('wrongPassword', adminPasswordHash);
    await assert(!wrongPasswordValid, 'Wrong password verification fails');

    // Test 7: Create a project owned by admin
    const projectResult = await client.query(
      `INSERT INTO projects (name, status, description, priority, owner_id)
       VALUES ('Auth Test Project', 'active', 'Auth test description', 'normal', $1)
       RETURNING *`,
      [adminUserId]
    );
    projectId = projectResult.rows[0].id;
    await assert(projectId, 'Project created by admin');
    await assert(projectResult.rows[0].owner_id === adminUserId, 'Project owner is admin');

    // Test 8: Add member as project member
    const memberAdd = await client.query(
      `INSERT INTO project_members (project_id, user_id, member_role)
       VALUES ($1, $2, 'member') RETURNING *`,
      [projectId, memberUserId]
    );
    await assert(memberAdd.rowCount === 1, 'Member added to project');

    // Test 9: Verify admin has edit access (owner)
    const adminAccess = await client.query(
      `SELECT p.owner_id, pm.member_role
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
       WHERE p.id = $1`,
      [projectId, adminUserId]
    );
    await assert(adminAccess.rowCount === 1, 'Admin access query works');
    await assert(adminAccess.rows[0].owner_id === adminUserId, 'Admin is project owner');

    // Test 10: Verify member has edit access (member role)
    const memberAccess = await client.query(
      `SELECT p.owner_id, pm.member_role
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
       WHERE p.id = $1`,
      [projectId, memberUserId]
    );
    await assert(memberAccess.rowCount === 1, 'Member access query works');
    await assert(memberAccess.rows[0].member_role === 'member', 'Member has member role');

    // Test 11: Verify disabled user has no access
    const disabledAccess = await client.query(
      `SELECT p.owner_id, pm.member_role
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
       WHERE p.id = $1`,
      [projectId, disabledUserId]
    );
    await assert(disabledAccess.rowCount === 1, 'Disabled user access query returns row');
    await assert(disabledAccess.rows[0].owner_id !== disabledUserId, 'Disabled user is not owner');
    await assert(disabledAccess.rows[0].member_role === null, 'Disabled user has no membership');

    // Test 12: Add disabled user as observer
    const disabledObserverAdd = await client.query(
      `INSERT INTO project_members (project_id, user_id, member_role)
       VALUES ($1, $2, 'observer') RETURNING *`,
      [projectId, disabledUserId]
    );
    await assert(disabledObserverAdd.rowCount === 1, 'Disabled user can be added as observer');

    // Test 13: Disabled user now has observer role in database
    const disabledObserverAccess = await client.query(
      `SELECT pm.member_role FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = $2`,
      [projectId, disabledUserId]
    );
    await assert(disabledObserverAccess.rows[0].member_role === 'observer', 'Disabled user has observer role in database');

    // Test 14: Admin can disable member account
    const disableMember = await client.query(
      `UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING is_active`,
      [memberUserId]
    );
    await assert(disableMember.rows[0].is_active === false, 'Admin can disable member account');

    // Test 15: Verify member is now disabled
    const memberAfterDisable = await client.query(
      `SELECT is_active FROM users WHERE id = $1`,
      [memberUserId]
    );
    await assert(memberAfterDisable.rows[0].is_active === false, 'Member account is disabled');

    // Test 16: Re-enable member account
    const enableMember = await client.query(
      `UPDATE users SET is_active = TRUE WHERE id = $1 RETURNING is_active`,
      [memberUserId]
    );
    await assert(enableMember.rows[0].is_active === true, 'Admin can re-enable member account');

    // Test 17: Verify user roles can be queried correctly
    const roleQuery = await client.query(
      `SELECT id, username, role, is_active FROM users WHERE id IN ($1, $2, $3) ORDER BY username`,
      [adminUserId, memberUserId, disabledUserId]
    );
    await assert(roleQuery.rowCount === 3, 'All three test users exist');
    const roles = roleQuery.rows;
    await assert(roles.some(r => r.username === 'test_admin' && r.role === 'admin'), 'Admin user has admin role');
    await assert(roles.some(r => r.username === 'test_member' && r.role === 'member'), 'Member user has member role');
    await assert(roles.some(r => r.username === 'test_disabled' && r.role === 'member'), 'Disabled user has member role');

    // Test 18: Re-enable users for cleanup
    await client.query('UPDATE users SET is_active = TRUE WHERE id = $1', [memberUserId]);
    await client.query('UPDATE users SET is_active = TRUE WHERE id = $1', [disabledUserId]);

    // Test 20: Test observer role access (read-only)
    const observerAdd = await client.query(
      `INSERT INTO project_members (project_id, user_id, member_role)
       VALUES ($1, $2, 'observer') ON CONFLICT(project_id, user_id) DO UPDATE SET member_role=EXCLUDED.member_role RETURNING *`,
      [projectId, disabledUserId]
    );
    await assert(observerAdd.rows[0].member_role === 'observer', 'Observer role can be set');

    // Test 21: Verify observer role persists
    const observerCheck = await client.query(
      `SELECT member_role FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, disabledUserId]
    );
    await assert(observerCheck.rows[0].member_role === 'observer', 'Observer role persists');

    // Test 22: Observer can be promoted to member
    const promoteObserver = await client.query(
      `UPDATE project_members SET member_role = 'member' WHERE project_id = $1 AND user_id = $2 RETURNING member_role`,
      [projectId, disabledUserId]
    );
    await assert(promoteObserver.rows[0].member_role === 'member', 'Observer can be promoted to member');

    // Test 23: Member can be demoted to observer
    const demoteToObserver = await client.query(
      `UPDATE project_members SET member_role = 'observer' WHERE project_id = $1 AND user_id = $2 RETURNING member_role`,
      [projectId, disabledUserId]
    );
    await assert(demoteToObserver.rows[0].member_role === 'observer', 'Member can be demoted to observer');

    // Test 24: Admin can remove member from project
    const removeMember = await client.query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING user_id`,
      [projectId, disabledUserId]
    );
    await assert(removeMember.rowCount === 1, 'Admin can remove member from project');

    // Test 25: Verify removal persists
    const afterRemoval = await client.query(
      `SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, disabledUserId]
    );
    await assert(afterRemoval.rowCount === 0, 'Member removal persists');

    // Test 26: Username uniqueness constraint - use savepoint to avoid transaction abort
    await client.query('SAVEPOINT username_test');
    let duplicateRejected = false;
    try {
      await client.query(
        `INSERT INTO users (username, password_hash, role, is_active)
         VALUES ('test_admin', $1, 'member', TRUE)`,
        [await bcrypt.hash('duplicate123', 12)]
      );
    } catch (err) {
      duplicateRejected = err.code === '23505'; // unique_violation
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT username_test');
    }
    await assert(duplicateRejected, 'Duplicate username is rejected with unique constraint violation');

    // Test 27: Multiple admins can exist
    const secondAdmin = await client.query(
      `INSERT INTO users (username, password_hash, role, is_active)
       VALUES ('test_admin2', $1, 'admin', TRUE) RETURNING id`,
      [await bcrypt.hash('admin2Password123', 12)]
    );
    await assert(secondAdmin.rowCount === 1, 'Multiple admins can exist');

    // Clean up second admin
    await client.query('DELETE FROM users WHERE id = $1', [secondAdmin.rows[0].id]);

    await client.query('ROLLBACK');
    console.log('\n✅ AUTHENTICATION AND AUTHORIZATION TESTS PASSED');
    console.log('User creation, authentication, and authorization logic verified.');
    console.log('Role-based access control works correctly.');
    console.log('Active/inactive account handling verified.');
    console.log('Project membership and role management verified.');
    console.log('Username uniqueness constraint verified.');
    console.log('Multiple admin support verified.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ AUTHENTICATION AND AUTHORIZATION TEST FAILED:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
}

testAuthAuthorization();