import { pool } from '../db.js';
import { getProjectAccess } from './project-access.js';
import { getResourceAccess } from './resource-access.js';
import { canReadEntity } from './visibility.js';

// Shared final projection for search, aggregate inputs, context, and AI tools.
// Resolve authority from the stored record, never from a projected/missing flag.
export async function filterReadableRows(type, rows, user) {
  const visible = [];
  const projects = new Map();
  async function projectReadable(id) {
    if (!id) return true;
    if (!projects.has(id)) projects.set(id, (await getProjectAccess(id, user)).access !== 'none');
    return projects.get(id);
  }
  for (const row of rows) {
    let readable = true;
    if (type === 'projects') readable = await projectReadable(row.id);
    else if (type === 'resources') {
      const access = await getResourceAccess(row.id, user);
      readable = access.access !== 'none' && !access.context?.invalid;
    } else if (type === 'notes') {
      const { rows: stored } = await pool.query('SELECT id,visibility,project_id FROM notes WHERE id=$1', [row.id]);
      const note = stored[0];
      readable = Boolean(note) && await canReadEntity({ entityType:'note',entityId:note.id,visibility:note.visibility,projectId:note.project_id,user });
      if (readable) readable = await projectReadable(note.project_id);
    } else if (['tasks','experiments','blocks','transactions'].includes(type)) readable = await projectReadable(row.project_id);
    if (readable) visible.push(row);
  }
  return visible;
}
