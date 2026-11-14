import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {pool} from './db.js';import {applyInventoryMutation} from './inventory-sync.js';
if(process.env.LABOS_PURCHASE_WORKBOOK_PROBE!=='1')throw Error('Set LABOS_PURCHASE_WORKBOOK_PROBE=1');
const c=await pool.connect();let checks=0;
try{
 if(!(await c.query('SELECT current_database() AS name')).rows[0].name.startsWith('labos_phase2_acceptance_'))throw Error('Isolated acceptance database required');await c.query('BEGIN');
 const user=(await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING id,role,credential_version",[randomUUID(),`purchase-probe-${randomUUID()}`])).rows[0];
 const old=(await c.query("INSERT INTO items(id,name,type,initial_quantity,current_quantity,status) VALUES($1,'existing','tool',10,10,'available') RETURNING *",[randomUUID()])).rows[0],newId=randomUUID(),batchA=randomUUID(),batchB=randomUUID();
 const record=(id,name,initial,current)=>({id,name,type:'tool',sku:null,category:null,unit:null,status:'available',initial_quantity:initial,current_quantity:current,unit_cost:id===old.id?5:2,supplier:null,storage_location:null});
 const batch=(id,reference)=>({id,transaction_id:randomUUID(),reference,purchase_date:'2026-11-06',supplier:null,invoice_number:null,project_id:null,currency:'USD',notes:null});
 const line=(item,batchId,q,cost,tax)=>({id:randomUUID(),movement_id:randomUUID(),item_id:item,purchase_batch_id:batchId,quantity:q,unit_cost:cost,tax,line_total:q*cost+tax,notes:null,storage_location:null});
 const p={rows:[{operation:'update',record:record(old.id,'existing',10,12)},{operation:'create',record:record(newId,'new',3,3)}],batches:[batch(batchA,'A'),batch(batchB,'B')],lines:[line(old.id,batchA,1,5,0),line(old.id,batchB,1,5,1),line(newId,batchA,3,2,0)],inventory_protocol:2,item_bases:[{id:old.id,version:old.sync_version},{id:newId,version:0}]};
 const change={change_id:randomUUID(),entity_type:'item',entity_id:null,operation:'purchase_import',payload:p,__device_id:randomUUID(),__credential_version:user.credential_version};const actor={userId:user.id,role:user.role};
 await c.query('SAVEPOINT baseline');
 const result=await applyInventoryMutation(c,change,actor);assert.equal(result.imported,3);assert.equal(result.created_items,1);assert.equal(result.expense_total,17);checks++;
 const stock=(await c.query('SELECT current_quantity,sync_version FROM items WHERE id=$1',[old.id])).rows[0];assert.equal(Number(stock.current_quantity),12);assert.equal(stock.sync_version,old.sync_version+1);checks++;
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[newId])).rows[0].current_quantity),3);checks++;
 assert.equal((await c.query('SELECT id FROM purchase_lines WHERE purchase_batch_id=ANY($1::uuid[])',[[batchA,batchB]])).rowCount,3);checks++;
 assert.equal(Number((await c.query('SELECT sum(amount) AS n FROM transactions WHERE logged_by=$1',[user.id])).rows[0].n),17);checks++;
 const movements=(await c.query('SELECT id,quantity_before,quantity_after FROM item_movements WHERE id=ANY($1::uuid[])',[p.lines.map(l=>l.movement_id)])).rows;
 for(const [index,from,to] of [[0,10,11],[1,11,12],[2,0,3]]){const m=movements.find(m=>m.id===p.lines[index].movement_id);assert.equal(Number(m.quantity_before),from);assert.equal(Number(m.quantity_after),to);checks++;}
 await c.query('ROLLBACK TO SAVEPOINT baseline');
 async function reject(payload,pattern){await c.query('SAVEPOINT rejected');try{await assert.rejects(applyInventoryMutation(c,{...change,payload},actor),pattern);}finally{await c.query('ROLLBACK TO SAVEPOINT rejected');await c.query('RELEASE SAVEPOINT rejected');}assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[old.id])).rows[0].current_quantity),10);assert.equal((await c.query('SELECT id FROM transactions WHERE logged_by=$1',[user.id])).rowCount,0);checks++;}
 const stale=structuredClone(p);stale.item_bases[0].version=999;await reject(stale,/changed on another client/);
 const forged=structuredClone(p);forged.rows[0].record.current_quantity=99;await reject(forged,/disagrees/);
 const duplicate=structuredClone(p);duplicate.lines[1].movement_id=duplicate.lines[0].movement_id;await reject(duplicate,/Duplicate purchase identity/);
 const invalidPrice=structuredClone(p);invalidPrice.lines[0].unit_cost=1.001;await reject(invalidPrice,/Invalid purchase line/);
 await c.query(`CREATE FUNCTION pg_temp.reject_purchase_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_user_id='${user.id}'::uuid THEN RAISE EXCEPTION 'injected purchase audit failure'; END IF; RETURN NEW; END $$`);await c.query('CREATE TRIGGER probe_purchase_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_purchase_audit()');
 await reject(p,/purchase audit failure/);await c.query('DROP TRIGGER probe_purchase_audit ON audit_log');
 await c.query('UPDATE users SET credential_version=credential_version+1 WHERE id=$1',[user.id]);await reject(p,/credentials/);
 console.log(`Purchase workbook PostgreSQL: ${checks} checks passed; all fixtures rolled back`);
}finally{await c.query('ROLLBACK').catch(()=>{});c.release();await pool.end();}
