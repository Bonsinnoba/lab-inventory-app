import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [
  ['Phase 4 migration exists', () => fs.existsSync(path.join(root, 'src/migrations/032_storage_pagination_science.sql'))],
  ['storage containers table', () => read('src/migrations/032_storage_pagination_science.sql').includes('CREATE TABLE IF NOT EXISTS storage_containers')],
  ['free-form storage column', () => read('src/migrations/032_storage_pagination_science.sql').includes('ADD COLUMN IF NOT EXISTS storage_location TEXT')],
  ['container relation', () => read('src/migrations/032_storage_pagination_science.sql').includes('storage_container_id UUID')],
  ['Phase 4 route exists', () => fs.existsSync(path.join(root, 'src/routes/phase4.js'))],
  ['paginated items endpoint', () => read('src/routes/phase4.js').includes("router.get('/items'") && read('src/routes/phase4.js').includes('LIMIT $')],
  ['containers endpoint', () => read('src/routes/phase4.js').includes("router.get('/containers'")],
  ['storage update endpoint', () => read('src/routes/phase4.js').includes("router.patch('/items/:id/storage'")],
  ['scientific intelligence endpoint', () => read('src/routes/phase4.js').includes("router.get('/intelligence'")],
  ['Phase 4 route mounted', () => read('src/index.js').includes("app.use('/api/phase4', authenticateToken, phase4Router)")],
  ['desktop Phase 4 API exists', () => fs.existsSync(path.join(root, '..', 'desktop/src/api/phase4.ts'))],
  ['pagination component exists', () => fs.existsSync(path.join(root, '..', 'desktop/src/components/Pagination.tsx'))],
  ['Lab Intelligence page exists', () => fs.existsSync(path.join(root, '..', 'desktop/src/pages/LabIntelligencePage.tsx'))],
  ['Lab Intelligence route', () => read('../desktop/src/App.tsx').includes('path="/lab-intelligence"')],
  ['Lab Intelligence navigation', () => read('../desktop/src/components/Sidebar.tsx').includes("path: '/lab-intelligence'")],
];
let ok = 0;
for (const [name, fn] of checks) { let pass = false; try { pass = !!fn(); } catch {} console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`); if (pass) ok++; }
if (ok !== checks.length) { console.error(`PHASE 4 STATIC TESTS FAILED: ${ok}/${checks.length}`); process.exit(1); }
console.log(`PHASE 4 STATIC TESTS PASSED: ${ok}/${checks.length}`);
