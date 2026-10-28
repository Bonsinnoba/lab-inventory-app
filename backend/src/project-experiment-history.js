// Call only with IDs from the caller's authorized project query. This is audit
// history, not editable experiment revisions or optimistic pending changes.
export async function readExperimentHistorySnapshot(db, authorizedProjectIds) {
  if (!authorizedProjectIds.length) return [];
  const result = await db.query(`SELECT e.id AS experiment_id,
    a.id,a.action,a.old_value,a.new_value,a.metadata,a.created_at,
    u.username AS actor_username
    FROM project_experiments e
    JOIN audit_log a ON a.entity_type='project_experiment' AND a.entity_id::text=e.id::text
    LEFT JOIN users u ON u.id=a.actor_user_id
    WHERE e.project_id=ANY($1::uuid[])
    ORDER BY e.id,a.created_at DESC,a.id DESC`, [authorizedProjectIds]);
  return result.rows;
}
