// Project IDs must come from the caller's authorized project selection.
// Read status and its events in one statement snapshot, never two racing reads.
export async function readProjectReviewSnapshots(db, projectIds) {
  return (await db.query(`SELECT p.id,'plan-v1:' || p.plan_revision::text AS token,
    jsonb_build_object('id',p.id,'status',p.status,'review_status',p.review_status,
      'priority',p.priority,'start_date',p.start_date,'due_date',p.due_date) AS project,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'decision',e.decision,
      'note',e.note,'created_at',e.created_at,'actor',u.username)
      ORDER BY e.created_at DESC,e.id)
      FROM project_review_events e JOIN users u ON u.id=e.actor_id
      WHERE e.project_id=p.id),'[]'::jsonb) AS events
    FROM projects p WHERE p.id=ANY($1::uuid[])`,[projectIds])).rows;
}
