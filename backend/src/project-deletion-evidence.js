import {assertProjectDeletable} from './project-lifecycle.js';
import {requireProjectWorkAuthority} from './project-work-authority.js';
import {visibilityReadSql} from './middleware/visibility.js';

// Caller owns the deletion transaction, required audit and receipt. Audience
// grants only deletion UUIDs, never live records or historical record contents.
export async function prepareProjectDeletion(client,projectId,user){
 const actor=await requireProjectWorkAuthority(client,projectId,user.userId);
 if(!actor.permissions.has('projects.delete'))throw Object.assign(new Error('Current project delete permission required'),{status:403,code:'PROJECT_DELETE_REQUIRED'});
 await client.query('DELETE FROM sync_deleted_project_audience WHERE project_id=$1',[projectId]);
 await client.query(`INSERT INTO sync_deleted_project_audience(project_id,user_id)
   SELECT p.id,u.id FROM projects p CROSS JOIN users u
   WHERE p.id=$1 AND u.is_active=true AND ${visibilityReadSql({alias:'p',entityType:'project',projectIdExpression:'p.id',userIdParameter:'u.id',roleParameter:'u.role'})}
   ON CONFLICT(project_id,user_id) DO NOTHING`,[projectId]);
}

// Canonical project delete effect for HTTP and native outbox application.
// Audit and receipt remain mandatory responsibilities of the caller transaction.
export async function deleteProjectWithEvidence(client,projectId,user){
 await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[projectId]);
 await prepareProjectDeletion(client,projectId,user);
 await assertProjectDeletable(client,projectId);
 const nested=[['project_task','SELECT id FROM project_tasks WHERE project_id=$1'],['project_experiment','SELECT id FROM project_experiments WHERE project_id=$1'],['project_bom','SELECT id FROM project_bom_items WHERE project_id=$1'],['project_block','SELECT id FROM project_blocks WHERE project_id=$1'],['project_connector','SELECT id FROM project_connectors WHERE project_id=$1'],['project_experiment_measurement','SELECT m.id FROM project_experiment_measurements m JOIN project_experiments e ON e.id=m.experiment_id WHERE e.project_id=$1'],['project_experiment_observation','SELECT o.id FROM project_experiment_observations o JOIN project_experiments e ON e.id=o.experiment_id WHERE e.project_id=$1'],['project_task_experiment','SELECT id FROM project_task_experiments WHERE project_id=$1'],['project_work_attachment','SELECT a.id FROM project_work_attachments a LEFT JOIN project_tasks t ON t.id=a.task_id LEFT JOIN project_experiments e ON e.id=a.experiment_id WHERE t.project_id=$1 OR e.project_id=$1'],['project_resource_requirement','SELECT id FROM project_resource_requirements WHERE project_id=$1'],['engineering_calculation','SELECT id FROM engineering_calculations WHERE project_id=$1'],['engineering_test','SELECT id FROM engineering_tests WHERE project_id=$1']];
 for(const [entityType,query] of nested){const rows=await client.query(query,[projectId]);
 for(const row of rows.rows)await client.query('INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id',[entityType,row.id,projectId]);}
 const resources=await client.query('WITH RECURSIVE tree AS (SELECT id,project_id,item_id,note_id FROM resources WHERE project_id=$1 UNION ALL SELECT r.id,r.project_id,r.item_id,r.note_id FROM resources r JOIN tree t ON r.parent_resource_id=t.id) SELECT id,project_id,item_id,note_id FROM tree',[projectId]);
 for(const row of resources.rows)await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id,item_id,note_id) VALUES('resource',$1,$2,$3,$4) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id,item_id=EXCLUDED.item_id,note_id=EXCLUDED.note_id",[row.id,row.project_id||projectId,row.item_id||null,row.note_id||null]);
 await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES('project',$1,$1) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[projectId]);
 await client.query("DELETE FROM record_access_grants WHERE (entity_type='project' AND entity_id=$1) OR (entity_type='resource' AND entity_id=ANY($2::uuid[])) OR (entity_type='engineering_calculation' AND entity_id IN(SELECT id FROM engineering_calculations WHERE project_id=$1)) OR (entity_type='engineering_test' AND entity_id IN(SELECT id FROM engineering_tests WHERE project_id=$1))",[projectId,resources.rows.map(row=>row.id)]);
 await client.query('DELETE FROM projects WHERE id=$1',[projectId]);
 return {id:projectId,project_id:projectId,deleted:true};
}
