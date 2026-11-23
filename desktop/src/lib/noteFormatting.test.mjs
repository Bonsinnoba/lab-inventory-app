import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./noteFormatting.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL});
const {formatNote:format,safeNoteUrl,noteMediaMarkup,noteResourceMarkup}=exports;
test('formatting preserves the rest of an existing note and selection',()=>{
 const edit=format('before selected after',7,15,'bold');assert.equal(edit.text,'before **selected** after');assert.equal(edit.text.slice(edit.start,edit.end),'selected');
 assert.equal(format(edit.text,edit.start,edit.end,'bold').text,'before selected after');
});
test('underline toggles without converting arbitrary HTML',()=>{
 const edit=format('abc',0,3,'underline');assert.equal(edit.text,'<u>abc</u>');assert.equal(format(edit.text,edit.start,edit.end,'underline').text,'abc');
});
test('empty selection supplies editable content inside markers',()=>{
 const edit=format('',0,0,'italic');assert.equal(edit.text,'*text*');assert.equal(edit.text.slice(edit.start,edit.end),'text');
});
test('paragraph removes line style without dropping content',()=>{
 assert.equal(format('## Title\n- [x] Finished\n3. Third',0,32,'paragraph').text,'Title\nFinished\nThird');
});
test('multiline selections get independent checklist and numbered prefixes',()=>{
 assert.equal(format('one\ntwo',0,7,'checklist').text,'- [ ] one\n- [ ] two');
 assert.equal(format('one\ntwo',0,7,'numbered').text,'1. one\n2. two');
});
test('selection ending on newline does not format the following line',()=>{
 assert.equal(format('one\ntwo',0,4,'h2').text,'## one\ntwo');
 assert.equal(format('\nnext',0,0,'h2').text,'## \nnext');
});
test('blocks are separated from existing text rather than corrupting it',()=>{
 const edit=format('beforeafter',6,6,'table');assert.ok(edit.text.startsWith('before\n\n| Column'));assert.ok(edit.text.endsWith('\n\nafter'));assert.match(edit.text,/\| --- \| --- \|/);
});
test('code and collapsible sections preserve selected source verbatim',()=>{
 assert.match(format('x < y',0,5,'code').text,/```\nx < y\n```/);
 assert.match(format('body',0,4,'dropdown').text,/<summary>Section title<\/summary>\n\nbody\n\n<\/details>/);
});
test('unsafe URLs cannot become executable or local-file media',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,hi','file:///C:/secret','https://user:password@example.com/a','https://example.com/a\nscript','/api/private'])assert.equal(safeNoteUrl(url),null);
});
test('media URLs and labels stay inside their markup boundaries',()=>{
 assert.equal(noteMediaMarkup('image','a] <b>','https://example.com/a(b).png'),'![a b](<https://example.com/a(b).png>)');
 assert.equal(noteMediaMarkup('video','Clip','https://example.com/a.mp4'),'[video: Clip](<https://example.com/a.mp4>)');
 assert.equal(noteMediaMarkup('link','bad','javascript:alert(1)'),null);
});
test('resource references retain identity and never embed filesystem paths',()=>{
 assert.equal(noteResourceMarkup('abc-123','Photo]'),'[Photo](labos-resource:abc-123)');assert.equal(noteResourceMarkup('../../private','bad'),null);
});
