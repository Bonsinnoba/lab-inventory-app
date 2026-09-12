import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const desktop = (p) => read(`../desktop/${p}`);
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
  ['pagination hook exported', () => desktop('src/components/Pagination.tsx').includes('export function usePagination')],
  ['Resources page paginated', () => desktop('src/pages/ResourcesPage.tsx').includes("usePagination(resources, 6)") && desktop('src/pages/ResourcesPage.tsx').includes('<Pagination')],
  ['Operations page paginated', () => desktop('src/pages/OperationsPage.tsx').includes('usePagination(o?.low_stock || [], 6)') && desktop('src/pages/OperationsPage.tsx').includes('<Pagination')],
  ['Search page paginated', () => desktop('src/pages/SearchPage.tsx').includes('usePagination(topResults,6)') && desktop('src/pages/SearchPage.tsx').includes('function SearchSection')],
  ['Knowledge page paginated', () => desktop('src/pages/KnowledgePage.tsx').includes('usePagination(recentNotes, 6)') && desktop('src/pages/KnowledgePage.tsx').includes('usePagination(recentResources, 6)')],
  ['Collaboration page paginated', () => desktop('src/pages/CollaborationPage.tsx').includes('usePagination(activityItems, 6)') && desktop('src/pages/CollaborationPage.tsx').includes('usePagination(notificationItems, 6)')],
  ['Lab Intelligence page exists', () => fs.existsSync(path.join(root, '..', 'desktop/src/pages/LabIntelligencePage.tsx'))],
  ['Lab Intelligence route', () => read('../desktop/src/App.tsx').includes('path="/lab-intelligence"')],
  ['Lab Intelligence navigation', () => read('../desktop/src/components/Sidebar.tsx').includes("path: '/lab-intelligence'")],
  ['Knowledge navigation grouped', () => desktop('src/components/Sidebar.tsx').includes("label: 'Knowledge'") && desktop('src/components/Sidebar.tsx').includes("label: 'Resources'")],
  ['Laboratory navigation grouped', () => desktop('src/components/Sidebar.tsx').includes("label: 'Laboratory'") && desktop('src/components/Sidebar.tsx').includes("label: 'Operations'") && desktop('src/components/Sidebar.tsx').includes("label: 'Intelligence'")],
];
let ok = 0;
for (const [name, fn] of checks) { let pass = false; try { pass = !!fn(); } catch {} console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`); if (pass) ok++; }
if (ok !== checks.length) { console.error(`PHASE 4 STATIC TESTS FAILED: ${ok}/${checks.length}`); process.exit(1); }
console.log(`PHASE 4 STATIC TESTS PASSED: ${ok}/${checks.length}`);
