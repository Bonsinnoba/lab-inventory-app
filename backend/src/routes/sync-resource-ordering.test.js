import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('./sync.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const RESOURCE_FIELDS='),source.indexOf('async function applyResourceDownloadJobEntity'));
function handler(overrides={}){
  return vm.runInNewContext(code+';applyResourceEntity',{
    object:v=>v,id:v=>v,fail:(status,code,message)=>{throw Object.assign(Error(message),{status,code});},
    getUserPermissions:async()=>new Set(['resources.create']),
    isVisibility:v=>['lab','restricted','project'].includes(v),
    requireResourceEditor:async()=>({ok:true}),validateResourceParent:async()=>({ok:true}),
    prepareUploadedResource:async()=> 'fixture/file',writeAuditLog:async()=>{},...overrides,
  });
}
const intent=(id,operation)=>({change_id:randomUUID(),entity_type:'resource',entity_id:id,operation,payload:{resource:{id,name:'Ordering fixture',kind:'file',file_type:'image',size_bytes:0}}});
test('absent delete without tombstone stays retryable, not successfully acknowledged',async()=>{
  const queries=[];const c={query:async sql=>{queries.push(sql);return {rows:[],rowCount:0};}};
  await assert.rejects(()=>handler()(c,intent(randomUUID(),'delete'),{userId:randomUUID()}),e=>e.status===503&&e.code==='RESOURCE_DELETE_WAITING_FOR_CREATE');
  assert.ok(queries.every(sql=>sql.startsWith('SELECT')));
});
test('existing tombstone allows idempotent absent deletion',async()=>{
  const c={query:async sql=>sql.includes('FROM sync_tombstones')?{rows:[{}],rowCount:1}:{rows:[],rowCount:0}};
  const result=await handler()(c,intent(randomUUID(),'delete'),{userId:randomUUID()});
  assert.equal(result.deleted,true);assert.equal(result.already_deleted,true);
});
test('deleted identity blocks create before publishing staged bytes',async()=>{
  let prepared=false;
  const c={query:async sql=>sql.includes('FROM sync_tombstones')?{rows:[{}],rowCount:1}:{rows:[],rowCount:0}};
  await assert.rejects(()=>handler({prepareUploadedResource:async()=>{prepared=true;}})(c,intent(randomUUID(),'create'),{userId:randomUUID()}),e=>e.code==='RESOURCE_PREVIOUSLY_DELETED');
  assert.equal(prepared,false);
});
test('resource lock uses normalized UUID across different change IDs',async()=>{
  const keys=[],c={query:async(sql,args)=>{if(sql.includes('pg_advisory_xact_lock'))keys.push(args[0]);return {rows:[],rowCount:0};}};
  const id=randomUUID(),run=handler();
  for(const spelling of [id,id.replaceAll('-','').toUpperCase()])await assert.rejects(()=>run(c,intent(spelling,'delete'),{userId:randomUUID()}));
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
});

test('real PostgreSQL: failed create -> pending delete -> retry create/delete; no resurrection',{skip:!process.env.LABOS_REAL_PG_TEST},async()=>{
  const {pool}=await import('../db.js');const c=await pool.connect();
  const owner=randomUUID(),id=randomUUID(),run=handler();
  try{
    await c.query('BEGIN');
    for(const table of ['resources','sync_tombstones','sync_idempotency','record_access_grants'])
      await c.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP`);
    const create=intent(id,'create'),remove=intent(id,'delete');
    const original=JSON.stringify(create);
    // Exercise the real batch handler/receipt writes, nested within the outer
    // rollback. This is not an HTTP/authentication middleware test.
    let push,uploadFails=true,inTransaction=false;
    const routeClient={release(){assert.equal(inTransaction,false);},async query(sql,args){
      if(sql==='BEGIN'){inTransaction=true;return c.query('SAVEPOINT resource_route');}
      if(sql==='COMMIT'){inTransaction=false;return c.query('RELEASE SAVEPOINT resource_route');}
      if(sql==='ROLLBACK'){if(inTransaction){inTransaction=false;await c.query('ROLLBACK TO SAVEPOINT resource_route');return c.query('RELEASE SAVEPOINT resource_route');}return;}
      return c.query(sql,args);
    }};
    const apply=handler({prepareUploadedResource:async()=>{if(uploadFails)throw Error('Injected upload failure');return 'fixture/file';}});
    vm.runInNewContext(source.slice(source.indexOf("router.post('/push'"),source.indexOf('const NOTE_FIELDS=')),{
      router:{post:(_path,fn)=>{push=fn;}},object:v=>v,
      getUserPermissions:async()=>new Set(['resources.create','resources.delete']),
      knowledgeEntityType:()=>false,engineeringEntityType:()=>false,projectEntityType:()=>false,FINANCE_CONFIG:{},
      pool:{connect:async()=>routeClient,query:(...args)=>c.query(...args)},
      applyChange:(client,change,userId)=>apply(client,change,{userId,role:'admin'}),
      syncResponseProjection:(_type,result)=>result,writeAuditLog:async()=>{},
    });
    const send=async changes=>{
      let body;const res={status(){return this;},json(value){body=value;return this;}};
      await push({body:{device_id:'fixture',changes:structuredClone(changes)},user:{userId:owner,role:'admin'}},res,e=>{throw e;});
      return body.results;
    };
    const failed=await send([create,remove]);
    assert.equal(failed[0].status,'failed');assert.equal(failed[1].status,'failed');
    assert.equal(failed[1].error.code,'RESOURCE_DELETE_WAITING_FOR_CREATE');
    assert.equal((await c.query('SELECT * FROM sync_idempotency')).rowCount,0);
    assert.equal((await c.query('SELECT * FROM resources')).rowCount,0);
    assert.equal((await c.query('SELECT * FROM sync_tombstones')).rowCount,0);
    uploadFails=false;
    for(const result of await send([create,remove]))assert.equal(result.status,'synced');
    assert.equal((await c.query('SELECT * FROM resources')).rowCount,0);
    assert.equal((await c.query('SELECT * FROM sync_tombstones')).rowCount,1);
    assert.equal((await c.query('SELECT * FROM sync_idempotency')).rowCount,2);
    for(const result of await send([create,remove]))assert.equal(result.status,'synced');
    assert.equal((await c.query('SELECT * FROM resources')).rowCount,0,'Historical create replay must not resurrect');
    const late=(await send([intent(id,'create')]))[0];
    assert.equal(late.status,'rejected');assert.equal(late.error.code,'RESOURCE_PREVIOUSLY_DELETED');
    assert.equal((await run(c,remove,{userId:owner})).already_deleted,true);
    assert.equal(JSON.stringify(create),original);

    // Compatibility with old absent-delete acknowledgements that lack tombstones.
    const legacy=randomUUID();
    await c.query(`INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status)
      VALUES($1,'fixture',$2,'resource',$3,'delete','{}',$4,200)`,[randomUUID(),owner,legacy.replaceAll('-','').toUpperCase(),{id:legacy,deleted:true,already_deleted:true}]);
    await assert.rejects(()=>run(c,intent(legacy,'create'),{userId:owner}),e=>e.code==='RESOURCE_PREVIOUSLY_DELETED');
    // An unrelated account cannot poison an unused identity via an old absent delete.
    await run(c,intent(legacy,'create'),{userId:randomUUID()});
    assert.equal((await c.query('SELECT * FROM resources WHERE id=$1',[legacy])).rowCount,1);
  }finally{await c.query('ROLLBACK');c.release();await pool.end();}
});
