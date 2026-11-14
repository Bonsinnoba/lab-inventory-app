// Explicitly opted-in, rollback-only acceptance against real PostgreSQL.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {applyFinanceWorkbook} from './finance-workbook.js';
if(process.env.LABOS_FINANCE_WORKBOOK_PROBE!=='1')throw Error('Set LABOS_FINANCE_WORKBOOK_PROBE=1');
const c=await pool.connect();let checks=0;
try{
 const database=(await c.query('SELECT current_database() AS name')).rows[0].name;
 if(!database.startsWith('labos_phase2_acceptance_'))throw Error('This probe requires the isolated Phase 2 acceptance database');
 await c.query('BEGIN');
 const actor=(await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING *",[randomUUID(),`workbook-probe-${randomUUID()}`])).rows[0];
 const user={userId:actor.id,role:actor.role,credentialVersion:actor.credential_version};
 const record=(extra={})=>({id:randomUUID(),type:'other',direction:'expense',amount:12.5,date:'2026-11-06',vendor:null,notes:null,item_id:null,project_id:null,funding_source_id:null,budget_period_id:null,...extra});
 const change=rows=>({change_id:randomUUID(),entity_type:'transaction',operation:'import',payload:{rows},__device_id:'workbook-probe'});
 const first=record(),one=change([{operation:'create',record:first}]);
 assert.equal((await applyFinanceWorkbook(c,one,user)).created,1);checks++;
 let stored=(await c.query('SELECT * FROM transactions WHERE id=$1',[first.id])).rows[0];assert.equal(stored.logged_by,actor.id);checks++;
 assert.equal(Number((await c.query("SELECT count(*) AS n FROM audit_log WHERE actor_user_id=$1 AND entity_type='transaction'",[actor.id])).rows[0].n),1);checks++;
 const second={...first,amount:19};
 assert.equal((await applyFinanceWorkbook(c,change([{operation:'update',record:second,expected_before:stored}]),user)).updated,1);checks++;
 async function reject(rows,pattern){await c.query('SAVEPOINT rejected_batch');try{await assert.rejects(applyFinanceWorkbook(c,change(rows),user),pattern);}finally{await c.query('ROLLBACK TO SAVEPOINT rejected_batch');await c.query('RELEASE SAVEPOINT rejected_batch');}checks++;}
 await reject([{operation:'update',record:second,expected_before:stored}],/changed after review/);
 await reject([{operation:'create',record:record({direction:'income',type:'purchase'})}],/direction, type/);
 await reject([{operation:'create',record:first}],/existence changed/);
 const lateOne=record(),lateTwo=record({funding_source_id:randomUUID()});
 await reject([{operation:'create',record:lateOne},{operation:'create',record:lateTwo}],/foreign key/);
 assert.equal((await c.query('SELECT id FROM transactions WHERE id=ANY($1::uuid[])',[[lateOne.id,lateTwo.id]])).rowCount,0);checks++;
 await c.query("UPDATE users SET role='member' WHERE id=$1",[actor.id]);user.role='member';
 await c.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'finance.import','deny')",[actor.id]);
 await reject([{operation:'create',record:record()}],/finance.import required/);
 await c.query("DELETE FROM user_permission_overrides WHERE user_id=$1 AND permission='finance.import'",[actor.id]);
 await c.query("UPDATE users SET role='admin' WHERE id=$1",[actor.id]);user.role='admin';
 await c.query(`CREATE FUNCTION pg_temp.reject_workbook_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_user_id='${actor.id}'::uuid THEN RAISE EXCEPTION 'injected required workbook audit failure'; END IF; RETURN NEW; END $$`);
 await c.query('CREATE TRIGGER probe_workbook_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_workbook_audit()');
 const auditFailure=record();await reject([{operation:'create',record:auditFailure}],/required workbook audit failure/);
 assert.equal((await c.query('SELECT id FROM transactions WHERE id=$1',[auditFailure.id])).rowCount,0);checks++;
 await c.query('DROP TRIGGER probe_workbook_audit ON audit_log');
 await c.query("UPDATE users SET credential_version=credential_version+1 WHERE id=$1",[actor.id]);
 await reject([{operation:'create',record:record()}],/credentials/);
 console.log(`Finance workbook PostgreSQL: ${checks} checks passed; all fixtures rolled back`);
}finally{await c.query('ROLLBACK').catch(()=>{});c.release();await pool.end();}
