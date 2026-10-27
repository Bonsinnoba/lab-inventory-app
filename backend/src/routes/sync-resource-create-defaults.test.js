import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('./sync.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const RESOURCE_FIELDS='),source.indexOf('async function applyResourceDownloadJobEntity'));
const resourceId='ac7046e8-a331-4199-af71-0f0564add409';
function handler(){
  return vm.runInNewContext(code+';applyResourceEntity',{
    object:v=>v,id:v=>v,fail:(_s,_c,m)=>{throw Error(m);},
    getUserPermissions:async()=>new Set(['resources.create']),
    isVisibility:v=>['lab','restricted','project'].includes(v),
    validateResourceParent:async()=>({ok:true}),
    prepareUploadedResource:async()=> 'test/file.bin',writeAuditLog:async()=>{},
  });
}
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
