import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./themes.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {getThemeColors,normalizeTheme,themeContrast,resolvedThemeMode,themeNames}=exports;
test('legacy appearance keeps its selected mode/accent and tinted background',()=>{
  const old=normalizeTheme({mode:'light',color:'purple'});
  assert.equal(old.background,'tinted');assert.equal(getThemeColors(old.mode,old.color,old).bg,'#FAF5FF');
  assert.equal(getThemeColors('dark','purple').bg,'#1A0A2D');
});
test('all named accents remain selectable independently of pure white and black',()=>{
  for(const color of Object.keys(themeNames))for(const mode of ['light','dark']){
    const result=getThemeColors(mode,color,{background:'plain'});
    assert.equal(result.bg,mode==='light'?'#FFFFFF':'#000000');assert.equal(result.surface,result.bg);
    assert.equal(result.accent,getThemeColors(mode,color).accent);
    assert.ok(themeContrast(result.bg,result['text-primary'])>=4.5);
    assert.ok(themeContrast(result.accent,result['accent-foreground'])>=4.5);
  }
});
test('custom background and accent are validated, independent and preserved exactly',()=>{
  const theme=normalizeTheme({mode:'light',color:'red',background:'custom',customBackground:'#102030',customAccent:'#FF8800'});
  const result=getThemeColors(theme.mode,theme.color,theme);
  assert.equal(result.bg,'#102030');assert.equal(result.accent,'#FF8800');assert.equal(resolvedThemeMode(theme),'dark');
  assert.ok(themeContrast(result.bg,result['text-primary'])>=4.5);
});
test('custom backgrounds choose readable foregrounds on background and raised surfaces',()=>{
  for(const background of ['#FFFFFF','#000000','#777777','#888888','#F0A0CC','#008800','#FFFF00','#3030FF']){
    const result=getThemeColors('dark','default',{background:'custom',customBackground:background});
    assert.equal(result.bg,background);
    assert.ok(themeContrast(result.bg,result['text-primary'])>=4.5);
    assert.ok(themeContrast(result['surface-raised'],result['text-primary'])>=4.5);
  }
});
test('malformed persisted settings cannot become CSS or a missing palette',()=>{
  for(const bad of [null,[],{mode:'system',color:'__proto__'},{mode:'light',color:'constructor',background:'url(evil)',customBackground:'red; color:white',customAccent:'#ABC'}]){
    const theme=normalizeTheme(bad),result=getThemeColors(theme.mode,theme.color,theme);assert.match(result.bg,/^#[0-9A-Fa-f]{6}$/);
    assert.equal(theme.customAccent,undefined);assert.equal(theme.customBackground,undefined);
  }
});
test('custom accent produces optional tints without affecting plain backgrounds',()=>{
  const tinted=getThemeColors('light','default',{background:'tinted',customAccent:'#FF0000'});
  assert.notEqual(tinted.bg,'#FFFFFF');assert.equal(tinted.accent,'#FF0000');
  assert.equal(getThemeColors('light','default',{background:'plain',customAccent:'#FF0000'}).bg,'#FFFFFF');
});
