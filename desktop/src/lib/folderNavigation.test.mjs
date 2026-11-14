import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./folderNavigation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const file=(id,path)=>({id,relative_path:path,original_filename:path.split('/').at(-1),mime_type:'',size_bytes:1});
test('virtual folders show immediate children, retain sibling independence and sort naturally without mutating manifest',()=>{
 const rows=[file('deep','one/deep/a.pdf'),file('two','two/b.pdf'),file('root','root.pdf'),file('ten','one/10.pdf'),file('first','one/2.pdf')],before=JSON.stringify(rows);
 assert.deepEqual(Array.from(exports.folderContents(rows,'').directories),['one','two']);assert.deepEqual(Array.from(exports.folderContents(rows,'').files,f=>f.id),['root']);assert.deepEqual(Array.from(exports.folderContents(rows,'one').directories),['deep']);assert.deepEqual(Array.from(exports.folderContents(rows,'one').files,f=>f.id),['first','ten']);assert.deepEqual(Array.from(exports.folderContents(rows,'two').files,f=>f.id),['two']);assert.equal(JSON.stringify(rows),before);
});
test('folder boundaries do not leak prefix siblings and malformed manifest paths are excluded',()=>{
 const rows=[file('safe','a/x.pdf'),file('sibling','ab/y.pdf'),file('bad','a/../secret.pdf')];assert.deepEqual(Array.from(exports.folderContents(rows,'a').files,f=>f.id),['safe']);assert.throws(()=>exports.folderContents(rows,'../a'),/Invalid/);assert.throws(()=>exports.folderLocation('C:\\files'),/Invalid/);
});
