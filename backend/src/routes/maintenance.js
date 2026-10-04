import { Router } from 'express';
import { hasPermission } from '../middleware/permissions.js';
import { pool } from '../db.js';
import { applyMaintenanceChange } from '../maintenance-sync.js';

const router = Router({ mergeParams: true });
router.use(hasPermission('inventory.view'));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use((req,res,next) => {
  if (!uuid.test(req.params.id)) return res.status(400).json({error:{code:'INVALID_ITEM_ID',message:'Invalid item ID'}});
  next();
});
router.get('/',async(req,res,next) => {
  try {
    if (!(await pool.query('SELECT 1 FROM items WHERE id=$1',[req.params.id])).rowCount) return res.status(404).json({error:{code:'ITEM_NOT_FOUND',message:'Item not found'}});
    const result=await pool.query(`SELECT m.*,u.username AS performed_by_username FROM maintenance_records m
      LEFT JOIN users u ON u.id=m.performed_by WHERE m.item_id=$1 ORDER BY m.scheduled_date DESC NULLS LAST,m.created_at DESC`,[req.params.id]);
    res.json(result.rows);
  } catch(error) {next(error);}
});

function mutate(operation) {
  return async(req,res,next) => {
    const client=await pool.connect();
    try {
      const changeId=req.get('Idempotency-Key');
      if (!changeId || !uuid.test(changeId)) return res.status(400).json({error:{code:'IDEMPOTENCY_KEY_REQUIRED',message:'A UUID Idempotency-Key is required for maintenance writes'}});
      const recordId=operation==='create'?req.body?.id:req.params.maintenanceId;
      if (!uuid.test(recordId||'')) return res.status(400).json({error:{code:'INVALID_MAINTENANCE_ID',message:'A stable maintenance UUID is required'}});
      const record={...req.body,id:recordId.toLowerCase(),item_id:req.params.id.toLowerCase()};
      delete record.expected_version;
      const payload={record,expected_version:req.body?.expected_version??0,depends_on:null};
      const change={change_id:changeId,entity_type:'maintenance_record',entity_id:record.id,operation,payload};
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+changeId]);
      const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[changeId])).rows[0];
      let result;
      if (prior) {
        const same=(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
        if (prior.user_id!==req.user.userId || prior.device_id!=='maintenance-http' || prior.entity_type!=='maintenance_record' || prior.operation!==operation || prior.entity_id!==record.id || !same) {
          await client.query('ROLLBACK');
          return res.status(409).json({error:{code:'IDEMPOTENCY_MISMATCH',message:'This key belongs to a different maintenance intent'}});
        }
        result=prior.response_json;
      } else {
        result=await applyMaintenanceChange(client,change,req.user);
        await client.query(`INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status)
          VALUES($1,'maintenance-http',$2,'maintenance_record',$3,$4,$5,$6,$7)`,[changeId,req.user.userId,record.id,operation,payload,result,operation==='create'?201:200]);
      }
      await client.query('COMMIT');
      res.status(operation==='create'?201:200).json(result);
    } catch(error) {
      await client.query('ROLLBACK').catch(()=>{});
      if(error.status) return res.status(error.status).json({error:{code:error.code,message:error.message}});
      next(error);
    } finally {client.release();}
  };
}
router.post('/',mutate('create'));
router.patch('/:maintenanceId',mutate('update'));
router.delete('/:maintenanceId',mutate('delete'));
export default router;
