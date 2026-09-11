import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(`CORE PHASE 1 STATIC FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const blocks = read('backend/src/routes/blocks.js');
const connectors = read('backend/src/routes/project-connectors.js');
const projects = read('backend/src/routes/projects.js');
const detail = read('desktop/src/pages/ProjectDetailPage.tsx');
const canvas = read('desktop/src/api/canvas.ts');

// Block delete must load the complete record before audit logging oldValue.
assert(
  /const current = await pool\.query\('SELECT \* FROM project_blocks WHERE id = \$1'/.test(blocks),
  'Block delete loads the complete existing block'
);
assert(/const currentBlock = current\.rows\[0\];/.test(blocks), 'Block delete defines currentBlock');
assert(/action: 'DELETE'[\s\S]*?oldValue: currentBlock/.test(blocks), 'Block delete audit uses the pre-delete block');

// Connector creation must enforce project ownership and reject self-links.
assert(/sourceCheck[\s\S]*?sourceCheck\.rows\[0\]\.project_id !== req\.params\.projectId/.test(connectors), 'Connector validates source block project ownership');
assert(/targetCheck[\s\S]*?targetCheck\.rows\[0\]\.project_id !== req\.params\.projectId/.test(connectors), 'Connector validates target block project ownership');
assert(/source_block_id === target_block_id/.test(connectors), 'Connector rejects self-connections');

// Project updates must return the persisted row.
assert(projects.includes('UPDATE projects SET ${updates.join(\', \')} WHERE id = $${values.length} RETURNING *'), 'Project update returns the persisted project');

// Project detail must verify team persistence and refresh its workspace cache.
assert(/getProjectWorkspace\(projectId\)/.test(detail), 'Project team mutation re-reads project workspace');
assert(/qc\.setQueryData\(\['project-workspace',projectId\],fresh\)/.test(detail), 'Project team mutation refreshes workspace query data');
assert(/qc\.invalidateQueries\(\{queryKey:\['project-candidates',projectId\]/.test(detail), 'Project team mutation refreshes candidate query');

// Canvas must use free-form geometry rather than the retired grid fields.
assert(/\bx:\s*number/.test(canvas) && /\by:\s*number/.test(canvas), 'Canvas API exposes x/y geometry');
assert(/\bwidth:\s*number/.test(canvas) && /\bheight:\s*number/.test(canvas), 'Canvas API exposes width/height geometry');
assert(!/\b(row_index|col_start|col_span)\b/.test(canvas), 'Canvas API contains no legacy grid fields');

console.log('\nCORE PHASE 1 STATIC REGRESSION TESTS PASSED');
