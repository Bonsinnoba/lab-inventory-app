import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resourceViewerKeys.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {resourceViewerArrow:arrow,boundedPdfPage:page,stepViewerCollection:step}=exports;
const event=(key,overrides={})=>({key,shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,defaultPrevented:false,...overrides});
test('plain arrows navigate loaded PDF pages rather than resources',()=>{
 for(const [key,direction] of [['ArrowLeft',-1],['ArrowRight',1]]){const action=arrow(event(key),717);assert.equal(action.scope,'page');assert.equal(action.direction,direction);}
});
test('Shift arrows navigate resources even when a PDF is open',()=>{
 for(const pages of [0,1,717])for(const key of ['ArrowLeft','ArrowRight'])assert.equal(arrow(event(key,{shiftKey:true}),pages).scope,'resource');
});
test('plain arrows on images or unloaded PDFs do not switch resources',()=>{
 assert.equal(arrow(event('ArrowRight'),0),null);assert.equal(arrow(event('ArrowLeft'),0),null);
});
test('other modifier combinations and handled events remain with their owner',()=>{
 for(const modifier of ['ctrlKey','altKey','metaKey','defaultPrevented'])for(const shiftKey of [false,true])assert.equal(arrow(event('ArrowRight',{[modifier]:true,shiftKey}),50),null);
 assert.equal(arrow(event('ArrowUp'),50),null);
});
test('page boundaries never wrap to another resource',()=>{
 assert.equal(page(1,-1,717),1);assert.equal(page(717,1,717),717);assert.equal(page(1,1,1),1);assert.equal(page(1,-1,1),1);assert.equal(page(20,1,717),21);assert.equal(page(20,-1,717),19);
});
test('plain arrows stay in folder siblings except when a PDF owns page navigation',()=>{
 assert.equal(arrow(event('ArrowRight'),0,true,false).scope,'folder');
 assert.equal(arrow(event('ArrowRight'),3,true,true).scope,'page');
 assert.equal(arrow(event('ArrowRight'),0,true,true),null);
 assert.equal(arrow(event('ArrowLeft',{shiftKey:true}),3,true,true).scope,'resource');
});
test('leaving a folder uses its position in the outer collection',()=>{
 const outer=['before','folder','after'];
 assert.equal(step('child',1,outer,'folder'),'after');assert.equal(step('child',-1,outer,'folder'),'before');
 assert.equal(step('after',-1,outer),'folder');assert.equal(step('before',-1,outer),'after');
});
test('inner navigation never leaves its explicit sibling IDs',()=>{
 assert.equal(step('image-a',1,['image-a','image-b']),'image-b');assert.equal(step('image-b',1,['image-a','image-b']),'image-a');
 assert.equal(step('child',1,['folder'],'folder'),'folder');
});
test('missing context is a no-op, never a guessed jump to another collection',()=>{
 assert.equal(step('child',1,[],'folder'),null);assert.equal(step('child',1,['unrelated'],'folder'),null);assert.equal(step('missing',1,['a','b']),null);
});
