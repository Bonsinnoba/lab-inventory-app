import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./mediaFrame.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const fit=exports.mediaFrameSize;
test('ratio choices produce distinct fitted frames inside a wide viewer pane',()=>{
  const wide=fit(1000,600,'16/9',2),square=fit(1000,600,'1/1',2),portrait=fit(1000,600,'9/16',2);
  assert.equal(wide.width,1000);assert.equal(square.width,600);assert.equal(portrait.width,337.5);
  assert.equal(square.height,600);assert.equal(portrait.height,600);assert.notEqual(wide.height,square.height);
});
test('all frames fit both dimensions in narrow split panes and short windows',()=>{
  for(const [width,height] of [[280,700],[900,180],[1200,800]])for(const ratio of ['auto','16/9','4/3','1/1','9/16']){
    const result=fit(width,height,ratio,1.7);assert.ok(result.width<=width+.001);assert.ok(result.height<=height+.001);assert.ok(result.width>0&&result.height>0);
  }
});
test('Original follows actual image/video dimensions and resize preserves the ratio',()=>{
  const first=fit(1000,600,'auto',3/4),second=fit(300,600,'auto',3/4);
  assert.equal(first.width/first.height,3/4);assert.equal(second.width/second.height,3/4);assert.notEqual(first.width,second.width);
});
test('missing metadata and unknown selections remain finite and bounded',()=>{
  for(const aspect of ['auto','unknown','constructor'])for(const natural of [0,NaN,Infinity]){
    const result=fit(0,0,aspect,natural);assert.ok(Number.isFinite(result.width)&&Number.isFinite(result.height));assert.ok(result.width>0&&result.height>0);
  }
});

test('invalid transient viewport measurements cannot create infinite/NaN CSS sizes',()=>{
  for(const width of [NaN,Infinity,-Infinity,-5,0])for(const height of [NaN,Infinity,-Infinity,-5,0]){
    const result=fit(width,height,'16/9',2);assert.ok(Number.isFinite(result.width)&&Number.isFinite(result.height));assert.ok(result.width>0&&result.height>0);
  }
});
