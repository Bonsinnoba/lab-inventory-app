// Routed receipt/retry acceptance, isolated DB only. Removes only this probe's UUIDs.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_FINANCE_WORKBOOK_HTTP_PROBE!=='1')throw Error('Set LABOS_FINANCE_WORKBOOK_HTTP_PROBE=1');
const database=(await pool.query('SELECT current_database() AS name')).rows[0].name;if(!database.startsWith('labos_phase2_acceptance_'))throw Error('Isolated Phase 2 acceptance DB required');
const actorId=randomUUID(),ids=[randomUUID(),randomUUID()],changes=[randomUUID(),randomUUID(),randomUUID()],device=randomUUID();let checks=0;
try{
 const actor=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING credential_version",[actorId,`http-workbook-${actorId}`])).rows[0];
 const token=jwt.sign({userId:actorId,credentialVersion:actor.credential_version},config.jwtSecret,{expiresIn:'5m'});
 const records=ids.map(id=>({operation:'create',record:{id,type:'other',direction:'expense',amount:2,date:'2026-11-06',vendor:null,notes:null,item_id:null,project_id:null,funding_source_id:null,budget_period_id:null}}));
 const push=async(changeId,rows)=>{const response=await fetch('http://127.0.0.1:4000/api/sync/push',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({device_id:device,changes:[{change_id:changeId,entity_type:'transaction',entity_id:null,operation:'import',payload:{rows}}]})});assert.equal(response.status,200);const body=await response.json();return body.results[0];};
 let result=await push(changes[0],records);assert.equal(result.status,'synced',JSON.stringify(result));checks++;
 assert.equal((await pool.query('SELECT id FROM transactions WHERE id=ANY($1::uuid[])',[ids])).rowCount,2);checks++;
 const auditBefore=Number((await pool.query('SELECT count(*) AS n FROM audit_log WHERE actor_user_id=$1',[actorId])).rows[0].n);assert.equal(auditBefore,3);checks++;
 assert.equal((await push(changes[0],records)).status,'synced');checks++;
 assert.equal(Number((await pool.query('SELECT count(*) AS n FROM audit_log WHERE actor_user_id=$1',[actorId])).rows[0].n),auditBefore);checks++;
 const altered=structuredClone(records);altered[0].record.amount=9;
 assert.equal((await push(changes[0],altered)).error.code,'IDEMPOTENCY_PAYLOAD_MISMATCH');checks++;
 assert.equal((await push(changes[1],records)).error.code,'FINANCE_WORKBOOK_STALE');checks++;
 const before=(await pool.query('SELECT * FROM transactions WHERE id=$1',[ids[0]])).rows[0];
 await pool.query('UPDATE transactions SET amount=5 WHERE id=$1',[ids[0]]);
 result=await push(changes[2],[{operation:'update',record:{...records[0].record,amount:10},expected_before:before}]);assert.equal(result.error.code,'FINANCE_WORKBOOK_STALE');checks++;
 assert.equal(Number((await pool.query('SELECT amount FROM transactions WHERE id=$1',[ids[0]])).rows[0].amount),5);checks++;
 console.log(`Routed finance workbook: ${checks} PostgreSQL/API checks passed; own fixtures cleaned`);
}finally{
 await pool.query('DELETE FROM sync_idempotency WHERE user_id=$1 AND change_id=ANY($2::text[])',[actorId,changes]);
 await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[actorId]);
 await pool.query('DELETE FROM transactions WHERE id=ANY($1::uuid[]) AND logged_by=$2',[ids,actorId]);
 await pool.query('DELETE FROM users WHERE id=$1',[actorId]);await pool.end();
}
