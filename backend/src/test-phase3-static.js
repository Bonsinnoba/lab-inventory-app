import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.cwd());
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[
 ['migration 031 exists',()=>fs.existsSync(path.join(root,'src/migrations/031_experience_workflow.sql'))],
 ['experience route exists',()=>fs.existsSync(path.join(root,'src/routes/experience.js'))],
 ['notifications endpoint',()=>read('src/routes/experience.js').includes("router.get('/notifications'")],
 ['notification read endpoint',()=>read('src/routes/experience.js').includes("router.post('/notifications/:id/read'")],
 ['read all endpoint',()=>read('src/routes/experience.js').includes("router.post('/notifications/read-all'")],
 ['dashboard endpoint',()=>read('src/routes/experience.js').includes("router.get('/dashboard'")],
 ['project health endpoint',()=>read('src/routes/experience.js').includes("router.get('/project-health/:id'")],
 ['activity endpoint',()=>read('src/routes/experience.js').includes("router.get('/activity'")],
 ['experience mounted',()=>read('src/index.js').includes("app.use('/api/experience', authenticateToken, experienceRouter)")],
 ['desktop experience api',()=>fs.existsSync(path.join(root,'..','desktop/src/api/experience.ts'))],
 ['notification UI',()=>fs.existsSync(path.join(root,'..','desktop/src/components/NotificationCenter.tsx'))],
 ['dashboard uses experience API',()=>fs.readFileSync(path.join(root,'..','desktop/src/pages/DashboardPage.tsx'),'utf8').includes("getExperienceDashboard")],
 ['dashboard health cards',()=>fs.readFileSync(path.join(root,'..','desktop/src/pages/DashboardPage.tsx'),'utf8').includes('Project health')],
 ['topbar notifications',()=>fs.readFileSync(path.join(root,'..','desktop/src/components/TopBar.tsx'),'utf8').includes('NotificationCenter')],
 ['no global notification user leak',()=>!read('src/routes/experience.js').includes('SELECT * FROM notifications')],
 ['dashboard inventory uses real item quantity fields',()=>{const x=read('src/routes/experience.js');return x.includes('current_quantity')&&x.includes('initial_quantity')&&!x.includes('min_quantity')}],
];
let ok=0; for(const [name,fn] of checks){let pass=false;try{pass=!!fn()}catch{};console.log(`${pass?'PASS':'FAIL'}: ${name}`);if(pass)ok++;}
if(ok!==checks.length){console.error(`PHASE 3 STATIC TESTS FAILED: ${ok}/${checks.length}`);process.exit(1);}
console.log(`PHASE 3 STATIC TESTS PASSED: ${ok}/${checks.length}`);
