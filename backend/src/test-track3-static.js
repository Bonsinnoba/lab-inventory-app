import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const m=read('src/migrations/027_knowledge_engineering.sql'), k=read('src/routes/knowledge.js'), e=read('src/routes/engineering.js'), i=read('src/index.js');
const dApi=fs.readFileSync(path.join(root,'../desktop/src/api/engineering.ts'),'utf8');
const app=fs.readFileSync(path.join(root,'../desktop/src/App.tsx'),'utf8');
const rail=fs.readFileSync(path.join(root,'../desktop/src/components/ActivityRail.tsx'),'utf8');
const sidebar=fs.readFileSync(path.join(root,'../desktop/src/components/Sidebar.tsx'),'utf8');
const kApi=fs.readFileSync(path.join(root,'../desktop/src/api/knowledge.ts'),'utf8');
const dPage=fs.readFileSync(path.join(root,'../desktop/src/pages/EngineeringToolsPage.tsx'),'utf8');
const checks=[
 ['findings table',/CREATE TABLE IF NOT EXISTS lab_findings/.test(m)],
 ['results table',/CREATE TABLE IF NOT EXISTS lab_results/.test(m)],
 ['knowledge relationships table',/CREATE TABLE IF NOT EXISTS knowledge_relationships/.test(m)],
 ['engineering calculations table',/CREATE TABLE IF NOT EXISTS engineering_calculations/.test(m)],
 ['engineering tests table',/CREATE TABLE IF NOT EXISTS engineering_tests/.test(m)],
 ['formula catalog and seeds',/CREATE TABLE IF NOT EXISTS engineering_formulas/.test(m)&&/ohms_law/.test(m)],
 ['finding CRUD',/router\.post\('\/findings'/.test(k)&&/router\.patch\('\/findings\/:id'/.test(k)&&/router\.delete\('\/findings\/:id'/.test(k)],
 ['result CRUD',/router\.post\('\/results'/.test(k)&&/router\.patch\('\/results\/:id'/.test(k)&&/router\.delete\('\/results\/:id'/.test(k)],
 ['knowledge relationships',/router\.post\('\/relationships'/.test(k)&&/router\.delete\('\/relationships\/:id'/.test(k)],
 ['knowledge search',/router\.get\('\/search'/.test(k)],
 ['calculation and formula endpoints',/router\.get\('\/formulas'/.test(e)&&/router\.post\('\/calculate'/.test(e)&&/router\.post\('\/calculations'/.test(e)],
 ['engineering test CRUD',/router\.post\('\/tests'/.test(e)&&/router\.patch\('\/tests\/:id'/.test(e)&&/router\.delete\('\/tests\/:id'/.test(e)],
 ['calculation comparison',/router\.get\('\/compare'/.test(e)],
 ['engineering router mounted',/engineeringRouter/.test(i)&&/app\.use\('\/api\/engineering'/.test(i)],
 ['desktop engineering API',/saveCalculation/.test(dApi)&&/compareCalculations/.test(dApi)&&/createEngineeringTest/.test(dApi)],
 ['desktop knowledge API',/createFinding/.test(kApi)&&/createResult/.test(kApi)&&/createKnowledgeRelationship/.test(kApi)],
 ['engineering tools modal only',/fixed/.test(dPage)&&/PointerEvent/.test(dPage)&&/clampPosition/.test(dPage)&&/return null/.test(dPage)],
 ['engineering tools right rail',/labos:engineering-tools/.test(rail)&&/Engineering Tools/.test(rail)&&!/Engineering Tools.*\/engineering/.test(sidebar)],
 ['engineering tools global mount',/EngineeringToolsPage/.test(app)&&/engineeringToolsOpen/.test(app)&&!/path=\"\/engineering\"/.test(app)],
 ['graphing tool',/Graphing/.test(dPage)&&/points/.test(dPage)],
 ['engineering tests UI',/Engineering Tests/.test(dPage)&&/createEngineeringTest/.test(dPage)],
 ['saved and compare UI',/Saved Calculations/.test(dPage)&&/Compare/.test(dPage)],
];
let fail=0;for(const [n,ok] of checks){if(ok)console.log('✓ '+n);else{console.error('✗ '+n);fail++;}}if(fail)process.exit(1);console.log('\nTRACK 3 STATIC TESTS PASSED');
