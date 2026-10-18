import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Route-contract tests only: the query double models explicit SELECT projection.
// They are not PostgreSQL or native desktop acceptance tests.
const source=readFileSync(new URL('./sync.js',import.meta.url),'utf8');
const start=source.indexOf("router.get('/resources/pull'");
const end=source.indexOf("router.get('/engineering/pull'",start);
assert.ok(start>=0&&end>start,'resource pull route must be present');
const route=source.slice(start,end);
const media={local_media_path:'resource/video.mp4',local_media_filename:'video.mp4',
  local_media_mime_type:'video/mp4',local_media_size_bytes:7800000,
  local_media_downloaded_at:'2026-10-16T21:00:00.000Z'};

async function pull(rows,{permission=true,access=async()=>({access:'view'})}={}){
  let handler,result,status=200;const queries=[];
  vm.runInNewContext(route,{
    router:{get:(_path,fn)=>{handler=fn;}},
    getUserPermissions:async()=>new Set(permission?['resources.view']:[]),
    getResourceAccess:access,
    pool:{query:async sql=>{
      queries.push(sql);
      if(sql.includes('FROM sync_tombstones'))return {rows:[]};
      const match=sql.match(/^SELECT (.+) FROM resources r ORDER BY r.updated_at DESC$/);
      assert.ok(match,'snapshot must read canonical resources, not infer from job history');
      const fields=match[1].split(',').map(field=>field.trim().replace(/^r\./,''));
      return {rows:rows.map(row=>Object.fromEntries(fields.map(field=>[field,row[field]??null])))};
    }},
  });
  const res={status:code=>{status=code;return res;},setHeader:()=>{},json:value=>{result=value;}};
  await handler({user:{userId:'account',role:'member'}},res,error=>{throw error;});
  return {status,body:JSON.parse(JSON.stringify(result)),queries};
}

test('canonical completion metadata reaches resource snapshot without inventing a PC copy',async()=>{
  const {body}=await pull([{id:'resource',kind:'link',...media}]);
  for(const [field,value] of Object.entries(media))assert.equal(body.resources[0][field],value,field);
  assert.deepEqual(body.visible_resource_ids,['resource']);
  assert.equal(body.resources[0].local_file_available,undefined);
  assert.equal(body.resources[0].local_copy,undefined);
});

test('undownloaded canonical link stays undownloaded, even without consulting old job history',async()=>{
  const {body,queries}=await pull([{id:'resource',kind:'link'}]);
  for(const field of Object.keys(media))assert.equal(body.resources[0][field],null,field);
  assert.ok(queries.every(sql=>!sql.includes('resource_download_jobs')));
});

test('resource permission denial prevents querying or exposing media metadata',async()=>{
  const result=await pull([{id:'resource',...media}],{permission:false});
  assert.equal(result.status,403);assert.equal(result.queries.length,0);
  assert.equal(result.body.error.code,'PERMISSION_DENIED');
});

test('record visibility and invalid inheritance still filter completed media',async()=>{
  const {body}=await pull(['visible','denied','invalid'].map(id=>({id,...media})),{
    access:async id=>id==='denied'?{access:'none'}:id==='invalid'?{access:'view',context:{invalid:true}}:{access:'view'},
  });
  assert.deepEqual(body.resources.map(row=>row.id),['visible']);
  assert.deepEqual(body.visible_resource_ids,['visible']);
});
