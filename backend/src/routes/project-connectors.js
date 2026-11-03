import {Router} from 'express';
import {requireProjectEditor} from '../middleware/project-access.js';
import {projectWorkHttpMutation} from '../project-work-http.js';
const router=Router();
router.post('/:projectId/connectors',requireProjectEditor,projectWorkHttpMutation('connector','create'));
export default router;
