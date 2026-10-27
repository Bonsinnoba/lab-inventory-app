import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDateValue} from './project-date-value.js';
test('optional date blanks become null without mutating the queued event',()=>{
  const record=Object.freeze({start_date:'',due_date:'  ',description:''});
  assert.equal(projectDateValue('start_date',record.start_date),null);
  assert.equal(projectDateValue('due_date',record.due_date),null);
  assert.equal(projectDateValue('description',record.description),'');
  assert.equal(projectDateValue('due_date','2026-10-26'),'2026-10-26');
  assert.equal(projectDateValue('due_date',null),null);
  assert.equal(projectDateValue('due_date','not-a-date'),'not-a-date');
  assert.equal(record.start_date,'');
});
test('actual PostgreSQL accepts blank optional dates after projection',{skip:!process.env.LABOS_REAL_PG_TEST},async()=>{
  const {pool}=await import('./db.js');const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query('CREATE TEMP TABLE date_probe(start_date date,due_date date) ON COMMIT DROP');
    await c.query('INSERT INTO date_probe VALUES($1,$2)',['2026-10-26',projectDateValue('due_date','')]);
    const result=await c.query('UPDATE date_probe SET start_date=$1,due_date=$2 RETURNING *',[projectDateValue('start_date',''),projectDateValue('due_date','')]);
    assert.equal(result.rows[0].start_date,null);assert.equal(result.rows[0].due_date,null);
  }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
