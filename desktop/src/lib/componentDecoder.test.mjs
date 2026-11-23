import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(name){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(name,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});return exports;}
const {decodeComponent:decode,defaultDecoderInput:defaults,formatComponentValue:format,decoderSuggestions:suggestions,EIA96_VALUES}=load('./componentDecoder.ts');
const {clampDecoderRect:clamp,clampDecoderIcon:icon}=load('./decoderWindow.ts');
const marked=(family,scheme,marking)=>decode({...defaults(family),scheme,marking});
const close=(a,b)=>assert.ok(Math.abs(a-b)<=Math.max(Math.abs(b)*1e-12,1e-24),`${a} != ${b}`);

test('same marking requires explicit component family: 104 resistor vs capacitor',()=>{
  assert.equal(marked('resistor','smd','104').value,100000);
  const cap=marked('capacitor','capacitor','104');close(cap.value,100e-9);assert.equal(format(cap.value,'F'),'100 nF');assert.equal(cap.tolerance,null);assert.equal(cap.minimum,null);
});
test('manufacturer reference examples: axial 4.7k and 5-band 4.7k',()=>{
  for(const [scheme,bands,tolerance] of [['bands4',['yellow','violet','red','gold'],5],['bands5',['yellow','violet','black','brown','brown'],1]]){
    const r=decode({...defaults('resistor'),scheme,bands});assert.equal(r.value,4700);assert.equal(r.tolerance,tolerance);close(r.minimum,4700*(1-tolerance/100));close(r.maximum,4700*(1+tolerance/100));
  }
});
test('fractional multipliers and absent fourth band preserve nominal/range',()=>{
  const r=decode({...defaults('resistor'),bands:['yellow','violet','gold','none']});close(r.value,4.7);assert.equal(r.tolerance,20);
  close(decode({...defaults('resistor'),bands:['yellow','violet','silver','gold']}).value,.47);
});
test('sixth band uses the selected Vishay TCR profile, including orange 15',()=>{
  const r=decode({...defaults('resistor'),scheme:'bands6',bands:['brown','black','black','red','brown','orange']});assert.equal(r.value,10000);assert.equal(r.tcr,15);assert.equal(r.source,'bands');
  assert.throws(()=>decode({...defaults('resistor'),scheme:'bands6',bands:['brown','black','black','red','brown','grey']}),/profile/);
});
test('invalid band roles, first digit and unsupported tolerance fail explicitly',()=>{
  for(const bands of [['gold','black','red','gold'],['black','brown','red','gold'],['brown','black','none','gold'],['brown','black','red','orange'],['brown','black','red']])assert.throws(()=>decode({...defaults('resistor'),bands}));
  assert.throws(()=>decode({...defaults('resistor'),scheme:'bands5',bands:['brown','black','black','red','none']}));
});
test('numeric SMD, RKM and zero-ohm links remain distinct',()=>{
  assert.equal(marked('resistor','smd','103').value,10000);assert.equal(marked('resistor','smd','1003').value,100000);
  for(const marking of ['0','000','0000'])assert.equal(marked('resistor','smd',marking).value,0);
  for(const [marking,value] of [['R047',.047],['4R7',4.7],['R47',.47],['4K7',4700],['4k7',4700],['1M',1e6]])close(marked('resistor','rkm',marking).value,value);
  assert.throws(()=>marked('resistor','rkm','1m'),/uppercase M/);assert.throws(()=>marked('resistor','rkm','R0'),/zero-ohm/);
});
test('EIA-96 table endpoints and all 96 unique codes, bounded multiplier profile',()=>{
  assert.equal(EIA96_VALUES.length,96);assert.equal(new Set(EIA96_VALUES).size,96);
  assert.equal(marked('resistor','eia96','01C').value,10000);assert.equal(marked('resistor','eia96','96A').value,976);
  assert.equal(marked('resistor','eia96','01Y').value,1);assert.equal(marked('resistor','eia96','01X').value,10);
  for(let i=1;i<=96;i++)assert.equal(marked('resistor','eia96',`${String(i).padStart(2,'0')}A`).value,EIA96_VALUES[i-1]);
  for(const m of ['00A','97A','1A','01Z'])assert.throws(()=>marked('resistor','eia96',m));
});
test('capacitor value and explicitly encoded tolerance; no assumed voltage or dielectric',()=>{
  const r=marked('capacitor','capacitor','104K');close(r.value,100e-9);assert.equal(r.tolerance,10);close(r.minimum,90e-9);close(r.maximum,110e-9);
  assert.equal(format(marked('capacitor','capacitor','471J').value,'F'),'470 pF');
  assert.equal(r.voltage,undefined);assert.equal(r.dielectric,undefined);assert.equal(r.tcr,null);
});
test('unsupported/ambiguous capacitor profiles and malformed input never fabricate values',()=>{
  for(const m of ['','10','104Z','104K 50V','10n','478','479','000','<script>','1'.repeat(65)])assert.throws(()=>marked('capacitor','capacitor',m));
  assert.throws(()=>marked('capacitor','smd','104'));assert.throws(()=>marked('resistor','capacitor','104'));
  for(const m of ['104x','4R7','10','1e3','-104','Infinity','１２３'])assert.throws(()=>marked('resistor','smd',m));
});
test('units normalize sub-ohm, zero, farads and values around floating point boundaries',()=>{
  assert.equal(format(0,'Ω'),'0 Ω');assert.equal(format(.047,'Ω'),'47 mΩ');assert.equal(format(4700,'Ω'),'4.7 kΩ');assert.equal(format(1e-6,'F'),'1 µF');assert.equal(format(1,'F'),'1 F');
});
test('search only offers supported utilities: @ list, aliases and ordinary exact names',()=>{
  assert.equal(suggestions('').length,0);assert.equal(suggestions('@').length,2);
  for(const q of ['@res','resistor','RESISTORS','resistor decoder','color code'])assert.equal(suggestions(q)[0].family,'resistor');
  for(const q of ['@ceramic','ceramic capacitor','capacitors','@capacitor'])assert.equal(suggestions(q)[0].family,'capacitor');
  assert.equal(suggestions('component decoder').length,2);
  for(const q of ['@inductor','@transistor','a resistor inventory project','random','user@example.com'])assert.equal(suggestions(q).length,0);
});
test('window geometry recovers stale/offscreen/invalid layouts even on tiny screens',()=>{
  for(const v of [{width:1280,height:720},{width:320,height:240},{width:1,height:1}])for(const r of [{x:99999,y:-500,width:1e6,height:1e6},{x:NaN,y:Infinity,width:NaN,height:-1},{x:-1,y:-1,width:100,height:100}]){
    const result=clamp(r,v);for(const n of Object.values(result))assert.ok(Number.isFinite(n));assert.ok(result.x>=0&&result.y>=0);assert.ok(result.width>0&&result.height>0);assert.ok(result.x+result.width<=v.width);assert.ok(result.y+result.height<=v.height);
    const p=icon({x:r.x,y:r.y},v);assert.ok(p.x>=0&&p.y>=0);assert.ok(p.x<=Math.max(0,v.width-52)&&p.y<=Math.max(0,v.height-52));
  }
});
