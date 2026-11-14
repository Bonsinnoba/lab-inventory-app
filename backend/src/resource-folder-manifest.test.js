import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceFolderManifest} from './resource-folder-manifest.js';
const root={id:'root',kind:'folder',name:'Designs'};
test('browser folder manifests retain empty folders, nested canonical parents, flat paths and links',()=>{
 const rows=[{id:'empty',kind:'folder',name:'Empty',parent_resource_id:'root',relative_path:'virtual/Empty'},{id:'nested',kind:'file',name:'part.txt',relative_path:'part.txt',parent_resource_id:'empty'},{id:'flat',kind:'file',name:'legacy.txt',parent_resource_id:'root',relative_path:'import/legacy.txt'},{id:'link',kind:'link',name:'Reviewed reference',parent_resource_id:'root'}];
 const result=resourceFolderManifest(root,rows);assert.equal(result.files.length,4);assert.equal(result.files.find(row=>row.id==='empty').kind,'folder');assert.equal(result.files.find(row=>row.id==='nested').relative_path,'virtual/Empty/part.txt');assert.equal(result.files.find(row=>row.id==='link').original_filename,'Reviewed reference');assert.equal(result.files.find(row=>row.id==='flat').relative_path,'import/legacy.txt');
});
test('incomplete ancestry, aliases and conflicting logical paths fail instead of dropping files',()=>{
 for(const rows of [[{id:'orphan',kind:'file',name:'a',parent_resource_id:'missing'}],[{id:'bad',kind:'file',name:'../bad',parent_resource_id:'root'}],[{id:'a',kind:'file',name:'same',parent_resource_id:'root'},{id:'b',kind:'folder',name:'SAME',parent_resource_id:'root'}],[{id:'a',kind:'file',name:'part',parent_resource_id:'root'},{id:'b',kind:'file',name:'x',relative_path:'part/x',parent_resource_id:'root'}]])assert.throws(()=>resourceFolderManifest(root,rows),error=>error.code==='RESOURCE_FOLDER_MANIFEST_INVALID');
});
