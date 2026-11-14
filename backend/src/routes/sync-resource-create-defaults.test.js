import {requireLockedResourceDestination} from '../resource-scope-lock.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('./sync.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const RESOURCE_FIELDS='),source.indexOf('async function applyResourceDownloadJobEntity'));
const resourceId='ac7046e8-a331-4199-af71-0f0564add409';
function handler(overrides={}){
  return vm.runInNewContext(code+';applyResourceEntity',{
    requireLockedResourceDestination,requireLockedResourceEditor:async()=>({ok:true}),
    object:v=>v,id:v=>v,fail:(_s,_c,m)=>{throw Error(m);},
    getUserPermissions:async()=>new Set(['resources.create']),
    isVisibility:v=>['lab','restricted','project'].includes(v),
    validateResourceParent:async()=>({ok:true}),
    prepareUploadedResource:async()=> 'test/file.bin',writeAuditLog:async()=>{},requireFolderNamespace:async()=>{},...overrides,
  });
}
for(const visible of [true,false])test(`link deduplication rechecks matching record visibility: ${visible}`,async()=>{
 const duplicate={id:'bb7046e8-a331-4199-af71-0f0564add409',kind:'link'};let reads=0,writes=0;
 const client={query:async sql=>{if(sql.includes("kind='link'"))return {rows:[duplicate],rowCount:1};if(!sql.startsWith('SELECT'))writes++;return{rows:[],rowCount:0};}};
 const run=handler({lockResourceLink:async()=>{},requireResourceRead:async id=>{reads++;assert.equal(id,duplicate.id);return visible?{ok:true}:{ok:false,status:403,error:{code:'DENIED',message:'Matching resource is unavailable'}};}});
 const work=()=>run(client,{entity_id:resourceId,operation:'create',payload:{resource:{id:resourceId,name:'Saved link',url:'https://example.test',kind:'link'}}},{userId:resourceId});
 if(visible)assert.equal((await work()).id,duplicate.id);else await assert.rejects(work,/Matching resource is unavailable/);
 assert.equal(reads,1);assert.equal(writes,0);
});
for(const kind of ['file','folder'])for(const mode of ['missing','null','explicit']){
  test(`${kind} create defaults: ${mode}; queued payload remains immutable`,async()=>{
    const record={id:resourceId,name:'Regression fixture',kind};
    if(mode==='null')Object.assign(record,{category:null,description:null,tags:null,visibility:null});
    if(mode==='explicit')Object.assign(record,{category:'reference',description:'Keep me',tags:['lab'],visibility:'lab'});
    const before=JSON.stringify(record);let inserted;
    const client={query:async(sql,values)=>{
      if(sql.startsWith('SELECT'))return {rows:[],rowCount:0};
      const fields=sql.match(/INSERT INTO resources \(([^)]+)\)/)?.[1].split(',');
      assert.ok(fields,sql);inserted=Object.fromEntries(fields.map((field,i)=>[field,values[i]]));
      return {rows:[inserted],rowCount:1};
    }};
    await handler()(client,{entity_id:resourceId,operation:'create',payload:{resource:record}},{userId:resourceId,role:'admin'});
    assert.equal(inserted.category,mode==='explicit'?'reference':'general');
    assert.equal(inserted.description,mode==='explicit'?'Keep me':'');
    assert.equal(JSON.stringify(inserted.tags),mode==='explicit'?'["lab"]':'[]');
    assert.equal(inserted.visibility,'lab');
    assert.equal(JSON.stringify(record),before);
  });
}

// Opt-in integration check runs against the existing PostgreSQL instance.
// A temporary table shadows resources; rollback leaves all application data intact.
test('PostgreSQL accepts native null metadata with production defaults',{skip:!process.env.LABOS_REAL_PG_TEST},async()=>{
  const {pool}=await import('../db.js');const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE resources (LIKE public.resources INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE sync_tombstones (LIKE public.sync_tombstones INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE sync_idempotency (LIKE public.sync_idempotency INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP');
    const result=await handler()(client,{entity_id:resourceId,operation:'create',payload:{resource:{id:resourceId,name:'Temporary sync regression',kind:'folder',category:null,description:null,tags:null,visibility:null}}},{userId:resourceId,role:'admin'});
    assert.equal(result.category,'general');assert.equal(result.description,'');assert.deepEqual(result.tags,[]);assert.equal(result.visibility,'lab');
  }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});


for(const kind of ['link','folder'])test(`${kind} create requires audit on the same client before returning`,async()=>{
 const calls=[],client={query:async(sql)=>{calls.push(sql);if(sql.startsWith('INSERT INTO resources'))return {rows:[{id:resourceId,kind}],rowCount:1};return {rows:[],rowCount:0};}};
 await assert.rejects(handler({writeAuditLog:async audit=>{
  assert.equal(audit.client,client);assert.equal(audit.required,true);assert.equal(audit.entityId,resourceId);
  assert.equal(calls.filter(sql=>sql.startsWith('INSERT INTO resources')).length,1);
  throw Error('audit unavailable');
 }})(client,{entity_id:resourceId,operation:'create',payload:{resource:{id:resourceId,name:'Audit fixture',kind}}},{userId:resourceId,role:'admin'}),/audit unavailable/);
});

test('PostgreSQL rolls back nonfile creation when required audit fails',{skip:!process.env.LABOS_REAL_PG_TEST},async()=>{
 const {default:pg}=await import('pg');const db=new pg.Pool();const client=await db.connect();
 const {writeAuditLog}=await import('../middleware/audit.js');
 try{
  await client.query('BEGIN');
  for(const table of ['resources','sync_tombstones','sync_idempotency','audit_log'])await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP`);
  await client.query("CREATE FUNCTION pg_temp.reject_resource_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'required audit probe'; END $$");
  await client.query('CREATE TRIGGER reject_resource_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_resource_audit()');
  await client.query('SAVEPOINT before_create');
  const event={entity_id:resourceId,operation:'create',payload:{resource:{id:resourceId,name:'Transactional audit fixture',kind:'folder'}}};
  await assert.rejects(handler({writeAuditLog})(client,event,{userId:resourceId,role:'admin'}),/required audit probe/);
  await client.query('ROLLBACK TO SAVEPOINT before_create');
  assert.equal((await client.query('SELECT count(*)::int AS count FROM resources')).rows[0].count,0);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count,0);
  await client.query('DROP TRIGGER reject_resource_audit ON audit_log');
  await handler({writeAuditLog})(client,event,{userId:resourceId,role:'admin'});
  assert.equal((await client.query('SELECT count(*)::int AS count FROM resources')).rows[0].count,1);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count,1);
 }finally{await client.query('ROLLBACK');client.release();await db.end();}
});
