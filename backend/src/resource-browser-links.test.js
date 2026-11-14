import test from 'node:test';
import assert from 'node:assert/strict';
import {browserLinkInput} from './resource-browser-links.js';
import {resourceLinkLockKey} from './resource-link-identity.js';
test('browser link validation uses explicit title provenance without fetching providers',()=>{
 const record=browserLinkInput({url:' https://youtu.be/abc/ ',name:'  Lab reference  '});
 assert.equal(record.url,'https://youtu.be/abc');assert.equal(record.name,'Lab reference');assert.equal(record.name_source,'user');assert.equal(record.file_type,'youtube');
 const fallback=browserLinkInput({url:'https://example.test/topic'});assert.equal(fallback.name,fallback.url);assert.equal(fallback.name_source,'url_fallback');
 assert.equal(browserLinkInput({url:'https://youtube.com.evil.test/a'}).file_type,'other');
});
test('browser links reject unsafe protocols, credentials, malformed destinations and names',()=>{
 for(const input of [{url:'file:///C:/secret'},{url:'javascript:alert(1)'},{url:'https://name:secret@example.test'},{url:'https://example.test',project_id:{}},{url:'https://example.test',name:[]},{url:'https://example.test',name:'a\nb'},{url:'https://example.test',name:'a'.repeat(201)}])assert.throws(()=>browserLinkInput(input),error=>error.status===400);
});
test('browser and sync link lock identities normalize all UUID context spellings',()=>{
 const id='aabbccdd-1234-4321-abcd-001122334455';
 for(const field of ['item_id','project_id','note_id','parent_resource_id'])assert.equal(resourceLinkLockKey({url:' HTTPS://EXAMPLE.TEST/a/// ',[field]:id}),resourceLinkLockKey({url:'https://example.test/a',[field]:id.replaceAll('-','').toUpperCase()}));
 assert.notEqual(resourceLinkLockKey({url:'https://example.test/a',item_id:id}),resourceLinkLockKey({url:'https://example.test/a',project_id:id}));
});
