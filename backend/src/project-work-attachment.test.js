import test from 'node:test';
import assert from 'node:assert/strict';
import {workAttachmentIdentity,assertWorkResourceScope} from './project-work-attachment.js';
const project='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',task='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',resource='cccccccc-cccc-4ccc-8ccc-cccccccccccc',attachment='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
test('attachment identities normalize UUIDs and bind exactly one parent',()=>{
 const record={id:attachment,project_id:project,task_id:task,resource_id:resource};
 assert.deepEqual(workAttachmentIdentity({...record,resource_id:resource.replaceAll('-','').toUpperCase()},attachment),{id:attachment,projectId:project,parentField:'task_id',parentId:task,resourceId:resource});
 for(const bad of [{...record,id:task},{...record,experiment_id:task},{...record,task_id:null},{...record,resource_id:'bad'}])assert.throws(()=>workAttachmentIdentity(bad,attachment),e=>e.status===400);
});
test('work attachments cannot cross project, note, item or folder boundaries',()=>{
 assert.doesNotThrow(()=>assertWorkResourceScope({project_id:project},project));
 for(const row of [null,{project_id:task},{project_id:null},{project_id:project,note_id:task},{project_id:project,item_id:task},{project_id:project,parent_resource_id:task}])assert.throws(()=>assertWorkResourceScope(row,project),e=>e.status===404);
});
