import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[
 ['operations migration',()=>fs.existsSync(path.join(root,'src/migrations/028_laboratory_operations.sql')) && /CREATE TABLE IF NOT EXISTS suppliers/.test(read('src/migrations/028_laboratory_operations.sql'))],
 ['resource requirements table',()=>/CREATE TABLE IF NOT EXISTS project_resource_requirements/.test(read('src/migrations/028_laboratory_operations.sql'))],
 ['supplier link on items',()=>/supplier_id UUID REFERENCES suppliers/.test(read('src/migrations/028_laboratory_operations.sql'))],
 ['operations overview endpoint',()=>/router\.get\('\/overview'/.test(read('src/routes/operations.js'))],
 ['low stock intelligence',()=>/low_stock/.test(read('src/routes/operations.js')) && /current_quantity <= initial_quantity/.test(read('src/routes/operations.js'))],
 ['calibration intelligence',()=>/calibration_due/.test(read('src/routes/operations.js')) && /next_calibration_date/.test(read('src/routes/operations.js'))],
 ['maintenance intelligence',()=>/maintenance_due/.test(read('src/routes/operations.js')) && /maintenance_records/.test(read('src/routes/operations.js'))],
 ['BOM readiness intelligence',()=>/missing_bom/.test(read('src/routes/operations.js')) && /project_bom_items/.test(read('src/routes/operations.js'))],
 ['supplier CRUD',()=>/router\.get\('\/suppliers'/.test(read('src/routes/operations.js')) && /router\.post\('\/suppliers'/.test(read('src/routes/operations.js')) && /router\.patch\('\/suppliers\/:id'/.test(read('src/routes/operations.js')) && /router\.delete\('\/suppliers\/:id'/.test(read('src/routes/operations.js'))],
 ['resource requirements CRUD',()=>/router\.get\('\/requirements'/.test(read('src/routes/operations.js')) && /router\.post\('\/requirements'/.test(read('src/routes/operations.js')) && /router\.patch\('\/requirements\/:id'/.test(read('src/routes/operations.js')) && /router\.delete\('\/requirements\/:id'/.test(read('src/routes/operations.js'))],
 ['operations router mounted',()=>/operationsRouter/.test(read('src/index.js')) && /app\.use\('\/api\/operations'/.test(read('src/index.js'))],
 ['desktop operations api',()=>fs.existsSync(path.join(root,'../desktop/src/api/operations.ts')) && /getOperationsOverview/.test(read('../desktop/src/api/operations.ts'))],
 ['operations UI page',()=>fs.existsSync(path.join(root,'../desktop/src/pages/OperationsPage.tsx')) && /Laboratory Operations/.test(read('../desktop/src/pages/OperationsPage.tsx'))],
 ['operations route',()=>/Route path="\/operations"/.test(read('../desktop/src/App.tsx'))],
 ['operations sidebar entry',()=>/id: 'operations'/.test(read('../desktop/src/components/Sidebar.tsx'))],
 ['inventory integration',()=>/to=\{`\/inventory\/.+\`\}/.test(read('../desktop/src/pages/OperationsPage.tsx'))],
 ['supplier management UI',()=>/Add supplier/.test(read('../desktop/src/pages/OperationsPage.tsx'))],
 ['equipment UI',()=>/Equipment, instruments and tools/.test(read('../desktop/src/pages/OperationsPage.tsx'))],
 ['requirements UI',()=>/Project resource requirements/.test(read('../desktop/src/pages/OperationsPage.tsx'))],
 ['track3 regression test present',()=>fs.existsSync(path.join(root,'src/test-track3-static.js'))],
];
let ok=true; for(const [name,fn] of checks){let pass=false;try{pass=!!fn()}catch{};console.log(`${pass?'✓':'✗'} ${name}`);if(!pass)ok=false}
if(!ok){console.error('TRACK 4 STATIC TESTS FAILED');process.exit(1)}
console.log('TRACK 4 STATIC TESTS PASSED');
