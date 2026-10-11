import { Router, raw } from 'express';
import { pool } from '../db.js';
import { stageUploadChunk, uploadStagingStatus, UPLOAD_CHUNK_BYTES } from '../resource-upload-staging.js';

const router=Router();
router.post('/uploads/:changeId/status',async(req,res)=>{
  try{res.setHeader('Cache-Control','no-store');res.json(await uploadStagingStatus(pool,req.user.userId,req.params.changeId,req.body));}
  catch(error){res.status(error.status||503).json({error:{code:error.status?error.code:'UPLOAD_STAGING_UNAVAILABLE',message:'Unable to inspect pending file transfer.'}});}
});
// Mounted under the existing authenticated resources.create POST boundary.
// Staging is not resource publication and grants no read access to staged files.
router.post('/uploads/:changeId/chunk',raw({type:'application/octet-stream',limit:UPLOAD_CHUNK_BYTES}),async(req,res)=>{
  let client;
  try{
    client=await pool.connect();
    await client.query('BEGIN');
    const result=await stageUploadChunk(client,req.user.userId,req.params.changeId,{
      resource_id:req.headers['x-resource-id'],size_bytes:req.headers['x-file-size'],sha256:req.headers['x-file-sha256'],
    },Number(req.headers['x-chunk-offset']),req.headers['x-file-size']==='0'?Buffer.alloc(0):req.body);
    await client.query('COMMIT');if(!res.writableEnded&&!res.destroyed){res.setHeader('Cache-Control','no-store');res.json(result);}
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});if(!res.writableEnded&&!res.destroyed)res.status(error.status||503).json({error:{code:error.status?error.code:'UPLOAD_STAGING_UNAVAILABLE',message:'File transfer is pending; the saved PC copy is unchanged.'}});}
  finally{if(client)client.release();}
});
export default router;
