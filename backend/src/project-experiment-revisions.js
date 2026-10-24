// Call only with project IDs obtained from the caller's authorized project query.
// Match the existing revision endpoint, including actor display names and order.
export async function readExperimentRevisionSnapshot(db, authorizedProjectIds) {
  return (await db.query(`SELECT r.*,u.username AS actor_username
    FROM project_experiment_revisions r
    JOIN project_experiments e ON e.id=r.experiment_id
    LEFT JOIN users u ON u.id=r.actor_id
    WHERE e.project_id=ANY($1::uuid[])
    ORDER BY r.experiment_id,r.revision_no DESC`,[authorizedProjectIds])).rows;
}
