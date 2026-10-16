import {pool} from './db.js';
import {getUserPermissions} from './middleware/permissions.js';
import {requireResourceEditor} from './middleware/resource-access.js';

// Read a fresh role/active flag, not the account snapshot from queue creation.
// Infrastructure errors throw: they are not proof of revoked authorization.
export async function downloadRequesterDenial(job){
  const user=(await pool.query('SELECT id,role,is_active FROM users WHERE id=$1',[job.requested_by])).rows[0];
  if(!user?.is_active)return 'Download requester is no longer active; queue a new request with an authorized account';
  const permissions=await getUserPermissions(user.id,user.role);
  if(!permissions.has('resources.edit'))return 'Download requester no longer has resources.edit permission';
  const access=await requireResourceEditor(job.resource_id,{userId:user.id,role:user.role});
  return access.ok?null:'Download requester no longer has edit access to this resource';
}
