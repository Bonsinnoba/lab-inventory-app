import test from 'node:test';
import assert from 'node:assert/strict';
import {folderNamespace,folderName,requireFolderNamespace} from './resource-folder-namespace.js';
test('empty-folder paths retain one explicit parent and a safe leaf',()=>{
 assert.equal(folderNamespace({name:'Empty'}).relative,'Empty');
 assert.equal(folderNamespace({name:'Empty',parent_resource_id:'parent',relative_path:'virtual/Empty'}).relative,'virtual/Empty');
 for(const record of [{name:'../escape'},{name:'Empty',relative_path:'Empty'},{name:'Empty',parent_resource_id:'parent',relative_path:'../Empty'},{name:'Empty',parent_resource_id:'parent',relative_path:'Other'}])assert.throws(()=>folderNamespace(record));
 assert.equal(folderNamespace({name:'New display',parent_resource_id:'parent',relative_path:'Old path'},{allowDisplayRename:true}).relative,'Old path');
 assert.throws(()=>folderName('bad\\path'));
});
test('namespace claims lock and check the same PostgreSQL case-folded logical path before writing',async()=>{
 const calls=[],client={query:async(sql,args)=>{calls.push({sql,args});return{rows:[],rowCount:0};}};
 await requireFolderNamespace(client,{name:'Empty'});
 assert.match(calls[0].sql,/pg_advisory_xact_lock\(hashtextextended\(\$1/);
 assert.match(calls[1].sql,/lower\(COALESCE\(relative_path,original_filename,name\)\)=lower\(\$5\)/);
 assert.equal(calls[1].args[4],'Empty');
 await assert.rejects(requireFolderNamespace({query:async sql=>({rows:[],rowCount:sql.includes('FROM resources')?1:0})},{name:'Empty'}),error=>error.code==='RESOURCE_FOLDER_PATH_EXISTS');
});
