import {Router} from 'express';
import multer from 'multer';
import {pool} from '../db.js';
import {rateLimit} from '../middleware/security.js';
import {VOICE_MAX_BYTES,VOICE_MIME_TYPES,transcriptionSettings,authorizeTranscription,transcribeWithGemini} from '../assistant-transcription.js';

// No disk storage, database/outbox audio payloads, provider Files API upload,
// conversation insertion or automatic chat submission.
export function createAssistantVoiceRouter({settings=transcriptionSettings,transcribe=transcribeWithGemini}={}){
 const router=Router();
 router.get('/capabilities',async(req,res,next)=>{
  try{await authorizeTranscription(pool,req.user);res.setHeader('Cache-Control','no-store');res.json(settings());}catch(error){next(error);}
 });
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:VOICE_MAX_BYTES,files:1,fields:1,fieldSize:128,parts:2}}).single('audio');
 router.post('/transcribe',rateLimit({windowMs:60000,max:6,keyGenerator:req=>`voice:${req.user.userId}`}),async(req,res,next)=>{
  const capabilities=settings();
  if(!capabilities.enabled)return res.status(503).json({error:{code:'VOICE_UNAVAILABLE',message:'Server transcription is not configured. Use text input.'}});
  upload(req,res,async uploadError=>{
   const buffer=req.file?.buffer;
   if(uploadError){buffer?.fill(0);if(res.destroyed)return;return res.status(uploadError.code==='LIMIT_FILE_SIZE'?413:400).json({error:{code:'VOICE_UPLOAD_INVALID',message:'Provide one supported audio recording of at most 6 MB.'}});}
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);
   const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
   try{
    await authorizeTranscription(pool,req.user);
    if(req.body?.consent!==capabilities.disclosure_id)return res.status(409).json({error:{code:'VOICE_CONSENT_REQUIRED',message:'Review the current voice processing disclosure before uploading.'}});
    const mime=(req.file?.mimetype||'').split(';')[0].toLowerCase();
    if(!buffer?.length||!VOICE_MIME_TYPES.includes(mime))return res.status(400).json({error:{code:'VOICE_AUDIO_INVALID',message:'The recording is empty or its format is unsupported.'}});
    const text=await transcribe({buffer,mime,model:capabilities.model,signal:controller.signal});
    if(controller.signal.aborted){if(!res.destroyed)res.status(408).json({error:{code:'VOICE_CANCELLED',message:'Transcription timed out or was cancelled.'}});return;}
    await authorizeTranscription(pool,req.user);
    if(typeof text!=='string'||text.length>8000)throw Object.assign(Error('Invalid transcript response'),{status:502,code:'VOICE_RESPONSE_INVALID',voice_public:true});
    res.setHeader('Cache-Control','no-store');res.json({text,review_required:true});
   }catch(error){
    if(!res.destroyed&&!res.headersSent)res.status(error.voice_public?error.status:502).json({error:{code:error.voice_public?error.code:controller.signal.aborted?'VOICE_CANCELLED':'VOICE_PROVIDER_FAILED',message:error.voice_public?error.message:'Unable to transcribe this recording. You can use text input.'}});
   }finally{clearTimeout(timer);res.off('close',disconnect);buffer?.fill(0);}
  });
 });
 return router;
}
export default createAssistantVoiceRouter();
