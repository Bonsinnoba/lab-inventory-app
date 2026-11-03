import {Router} from 'express';
import {hasPermission} from '../middleware/permissions.js';
import {projectWorkFlatMutation} from '../project-work-http.js';
const router=Router();
router.put('/:id',hasPermission('projects.edit'),projectWorkFlatMutation('block','update'));
router.delete('/:id',hasPermission('projects.edit'),projectWorkFlatMutation('block','delete'));
export default router;
