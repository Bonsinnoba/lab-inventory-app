import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
const require=createRequire(import.meta.url);
const formatting={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/noteFormatting.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:formatting,URL});
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./NotePreview.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:path=>path==='../lib/noteFormatting'?formatting:path==='./FocusedResourceMedia'?{default:({src})=>React.createElement('video',{src,controls:true})}:require(path)});
const render=text=>renderToStaticMarkup(React.createElement(exports.default,{text,onResource:()=>{},onToggleCheck:()=>{}}));
test('preview renders formatting without executing note HTML',()=>{
 const html=render('# Title\n**bold** *italic* <u>underlined</u>\n<script>alert(1)</script>');
 assert.match(html,/<h1>Title<\/h1>/);assert.match(html,/<strong>bold<\/strong>/);assert.match(html,/<em>italic<\/em>/);assert.match(html,/<u>underlined<\/u>/);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
});
test('code blocks preserve literal syntax and never render HTML',()=>{
 const html=render('```\n<img src=x onerror=alert(1)>\n```');assert.match(html,/<pre><code>/);assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);
});
test('tables, checkbox state and collapsible sections are represented',()=>{
 const html=render('| Name | Value |\n| --- | --- |\n| A | 42 |\n- [x] Done\n- [ ] Next\n<details>\n<summary>More</summary>\n\n**Details**\n\n</details>');
 assert.match(html,/<th>Name<\/th>/);assert.match(html,/<td>42<\/td>/);assert.equal((html.match(/type="checkbox"/g)||[]).length,2);assert.equal((html.match(/checked=""/g)||[]).length,1);assert.match(html,/<summary>More<\/summary>/);assert.match(html,/<strong>Details<\/strong>/);
});
test('unsafe links and media remain text while resource references are actions',()=>{
 const html=render('![bad](javascript:alert)\n[x](data:bad)\n[File](labos-resource:abc-123)');assert.ok(!html.includes('<img'));assert.ok(!html.includes('<a '));assert.match(html,/<button[^>]*>File<\/button>/);
});
test('videos require explicit controls, do not autoplay, and URLs support parentheses',()=>{
 const html=render('[video: Clip](<https://example.com/a(b).mp4>)');assert.match(html,/<video/);assert.match(html,/a\(b\)\.mp4/);assert.match(html,/controls/);assert.ok(!html.includes('autoplay'));
});
test('preview bounds large documents without changing their contents',()=>{
 const text='x'.repeat(200001),lines='line\n'.repeat(4001);assert.match(render(text),/remains editable/);assert.match(render(lines),/4,000 lines/);assert.equal(text.length,200001);
});
