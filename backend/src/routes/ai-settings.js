import {Router} from 'express';
import {requireRole} from '../middleware/auth.js';
import {rateLimit} from '../middleware/security.js';
import {aiService} from '../ai-service.js';
import {mayTransmitAiKey} from '../ai-admin-transport.js';

export function createAiSettingsRouter({service=aiService,authorize=requireRole('admin')}={}){
 const router=Router();router.use(authorize);router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 const respond=(res,error)=>res.status(error.ai_public?error.status:503).json({error:{code:error.ai_public?error.code:'AI_SETTINGS_UNAVAILABLE',message:error.ai_public?error.message:'AI settings are unavailable. Check server configuration and migrations.'}});
 router.get('/',async(req,res)=>{try{res.json(service.repository.public(await service.repository.read()));}catch(error){respond(res,error);}});
 router.put('/',async(req,res)=>{try{const hasSecret=Array.isArray(req.body?.profiles)&&req.body.profiles.some(p=>p?.api_key);if(hasSecret&&!mayTransmitAiKey(req))return res.status(400).json({error:{code:'AI_TLS_REQUIRED',message:'Configure API keys over HTTPS or from the server itself.'}});res.json(await service.repository.save(req.body,req.user.userId));}catch(error){respond(res,error);}});
 router.post('/:id/test',rateLimit({windowMs:60000,max:6,keyGenerator:req=>`ai-settings-test:${req.user.userId}`}),async(req,res)=>{
  res.setTimeout(130000);
  const controller=new AbortController(),disconnect=()=>{if(!res.writableEnded)controller.abort();},deadline=setTimeout(()=>controller.abort(),120000);res.on('close',disconnect);
  try{res.json(await service.test(req.params.id,req.body?.version,req.user.userId,controller.signal));}catch(error){if(!res.destroyed)respond(res,error);}finally{clearTimeout(deadline);res.off('close',disconnect);}
 });
 return router;
}
export default createAiSettingsRouter();
