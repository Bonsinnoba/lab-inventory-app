import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

function frame(mode,body){const header=Buffer.alloc(5);header[0]=mode;header.writeUInt32BE(body.length,1);return Buffer.concat([header,body]);}
function run(input){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=128',fileURLToPath(new URL('./docx-native-worker.js',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{}});
  const chunks=[];let size=0;const timer=setTimeout(()=>{child.kill();reject(Error('Worker timed out'));},20000);
  child.on('error',reject);child.stdin.on('error',()=>{});child.stderr.resume();
  child.stdout.on('data',data=>{size+=data.length;if(size>17*1024*1024){child.kill();reject(Error('Output limit'));}else chunks.push(data);});
  child.on('close',code=>{clearTimeout(timer);try{assert.equal(code,0);const out=Buffer.concat(chunks);assert.ok(out.length>=5);assert.equal(out.readUInt32BE(1),out.length-5);resolve({kind:out[0],body:out.subarray(5)});}catch(e){reject(e);}});
  child.stdin.end(input);
});}
test('native binary protocol round-trips supported DOCX formatting with no server',async()=>{
  const docx=await run(frame(2,Buffer.from('<h1>Local draft</h1><p><b>Bold</b></p><table><tr><td>Cell</td></tr></table>')));
  assert.equal(docx.kind,2);assert.equal(docx.body.subarray(0,4).toString('hex'),'504b0304');
  const preview=await run(frame(1,docx.body));assert.equal(preview.kind,1);
  const result=JSON.parse(preview.body);assert.match(result.html,/Local draft/);assert.match(result.html,/<strong>Bold<\/strong>/);assert.match(result.html,/<table>/);
});
test('native protocol rejects malformed, trailing, invalid UTF-8 and oversized markup',async()=>{
  for(const input of [Buffer.from([2]),frame(9,Buffer.from('bad')),Buffer.concat([frame(2,Buffer.from('<p>ok</p>')),Buffer.from('extra')]),frame(2,Buffer.from([0xff])),frame(2,Buffer.alloc(4*1024*1024+1,65))]){
    const result=await run(input);assert.equal(result.kind,3);assert.ok(JSON.parse(result.body).error.length<=1000);
  }
});
test('native protocol reports invalid DOCX without passing raw paths to a parser',async()=>{
  const result=await run(frame(1,Buffer.from('C:\\private\\not-a-document')));assert.equal(result.kind,3);
});
