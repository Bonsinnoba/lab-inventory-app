// Call inside the deletion transaction after locking the project FOR UPDATE.
// Settled custody is still history; it must not lose its originating project.
export async function assertProjectDeletable(client, projectId) {
  // Freeze existing experiment/test writers while inspecting their evidence.
  // New children must acquire a foreign-key lock on the locked project/experiment.
  // Fail promptly instead of introducing a project/child lock-order deadlock.
  try {
    await client.query('SELECT id FROM project_experiments WHERE project_id=$1 ORDER BY id FOR UPDATE NOWAIT', [projectId]);
    await client.query('SELECT id FROM engineering_tests WHERE project_id=$1 ORDER BY id FOR UPDATE NOWAIT', [projectId]);
  } catch (error) {
    if (error.code === '55P03') throw Object.assign(new Error('Project work is being updated. Synchronize and retry deletion.'),
      {status:409,code:'PROJECT_HISTORY_BUSY'});
    throw error;
  }
  const result = await client.query(`SELECT
    EXISTS(SELECT 1 FROM item_custody_records WHERE project_id=$1) AS custody,
    EXISTS(SELECT 1 FROM item_movements WHERE project_id=$1) AS movements,
    EXISTS(SELECT 1 FROM project_reservation_fulfillments f
      JOIN project_reservations r ON r.id=f.reservation_id
      WHERE r.project_id=$1) AS fulfillment`, [projectId]);
  if (result.rows[0].custody || result.rows[0].movements || result.rows[0].fulfillment) {
    const error = new Error('This project has inventory movement, custody or fulfillment history and cannot be deleted. Preserve the project and settle outstanding stock through recorded movements.');
    error.status = 409;
    error.code = 'PROJECT_INVENTORY_HISTORY_PROTECTED';
    throw error;
  }
  const history = await client.query(`WITH experiments AS (
      SELECT * FROM project_experiments WHERE project_id=$1
    ) SELECT
    (EXISTS(SELECT 1 FROM transactions WHERE project_id=$1) OR
     EXISTS(SELECT 1 FROM purchase_batches WHERE project_id=$1)) AS finance,
    EXISTS(SELECT 1 FROM item_salvage_recoveries WHERE project_id=$1) AS salvage,
    (EXISTS(SELECT 1 FROM experiments WHERE status IN ('running','completed','failed')
       OR started_at IS NOT NULL OR completed_at IS NOT NULL
       OR btrim(observations)<>'' OR btrim(result)<>'' OR btrim(conclusion)<>'') OR
     EXISTS(SELECT 1 FROM project_experiment_measurements WHERE experiment_id IN (SELECT id FROM experiments)) OR
     EXISTS(SELECT 1 FROM project_experiment_observations WHERE experiment_id IN (SELECT id FROM experiments)) OR
     EXISTS(SELECT 1 FROM project_experiment_revisions WHERE experiment_id IN (SELECT id FROM experiments)) OR
     EXISTS(SELECT 1 FROM lab_findings WHERE project_id=$1 OR experiment_id IN (SELECT id FROM experiments)) OR
     EXISTS(SELECT 1 FROM lab_results WHERE project_id=$1 OR experiment_id IN (SELECT id FROM experiments)) OR
     EXISTS(SELECT 1 FROM engineering_calculations WHERE project_id=$1 OR experiment_id IN (SELECT id FROM experiments)) OR
     EXISTS(SELECT 1 FROM engineering_tests WHERE project_id=$1 AND
       (status IN ('running','passed','failed') OR results<>'{}'::jsonb OR btrim(conclusion)<>''))) AS evidence`, [projectId]);
  const row = history.rows[0];
  if (row.finance || row.salvage || row.evidence) {
    throw Object.assign(new Error('This project has financial, salvage or recorded scientific history and cannot be deleted. Archive it to preserve its records and provenance.'),
      {status:409,code:'PROJECT_RECORDED_HISTORY_PROTECTED'});
  }
}

// Caller owns the project FOR UPDATE lock and the encompassing transaction.
export async function applyProjectLifecycle(client, before, nextStatus, expectedRevision) {
  if (!nextStatus || nextStatus === before.status) return;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== before.lifecycle_revision) {
    throw Object.assign(new Error('Project lifecycle changed or has not been synchronized. Review the current project before retrying.'),
      {status:409,code:'PROJECT_LIFECYCLE_CONFLICT'});
  }
  if (!['cancelled','completed','archived'].includes(nextStatus)) return;
  // Inventory writers lock item -> reservation -> project. Never wait here on
  // their reservation while holding the project lock: reject for safe retry.
  try {
    await client.query('SELECT id FROM project_reservations WHERE project_id=$1 ORDER BY id FOR UPDATE NOWAIT',[before.id]);
  } catch (error) {
    if (error.code==='55P03') throw Object.assign(new Error('Inventory activity is in progress. Retry this lifecycle change after synchronization.'),
      {status:409,code:'PROJECT_LIFECYCLE_BUSY'});
    throw error;
  }
  await client.query(`UPDATE project_reservations SET
    status=CASE WHEN status='confirmed' THEN 'released' ELSE 'rejected' END,
    updated_at=now()
    WHERE project_id=$1 AND status IN ('confirmed','pending_review')`,[before.id]);
  // Quantity, fulfillment, custody, tasks, experiments and finance are untouched.
  // Reopening never recreates these released allocations.
}

export async function projectInventorySettlement(client, projectId) {
  const {rows}=await client.query(`SELECT
    (SELECT count(*)::integer FROM item_custody_records WHERE project_id=$1 AND outstanding_quantity>0) AS outstanding_custody_records,
    (SELECT count(*)::integer FROM project_reservations WHERE project_id=$1 AND status IN ('confirmed','pending_review')) AS open_reservations`,[projectId]);
  const row=rows[0];
  return {...row,state:row.outstanding_custody_records||row.open_reservations?'unsettled':'settled',scope:'inventory',observed_at:new Date().toISOString()};
}
