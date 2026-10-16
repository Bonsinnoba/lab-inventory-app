// Pure decisions shared by claim, observer and final publication. A job identity
// alone is not ownership: each execution gets an immutable run ID.
export function ownsDownloadAttempt(current,attempt){
  return !!current&&!!attempt?.worker_run_id&&!attempt.lease_lost&&current.id===attempt.id
    &&current.resource_id===attempt.resource_id&&current.worker_run_id===attempt.worker_run_id
    &&current.status==='downloading';
}
export function downloadStopReason(current,attempt){
  if(!ownsDownloadAttempt(current,attempt))return 'superseded';
  return current.stop_requested_status||(current.cancel_requested?'cancelled':null);
}
export function publicationDecision({current,attempt,resource,source,denial,error,media}){
  if(!ownsDownloadAttempt(current,attempt))return {action:'ignore'};
  const stop=current.stop_requested_status||(current.cancel_requested?'cancelled':null);
  if(stop)return{action:'stop',status:stop,error:current.error_message||null};
  if(!resource||resource.kind!=='link'||resource.url!==source.url)return{action:'stop',status:'cancelled',error:'Resource source changed; queue a new request after review'};
  if(denial)return{action:'stop',status:'cancelled',error:denial};
  if(resource.local_media_path)return{action:'stop',status:'cancelled',error:'Resource already has server media; existing file preserved'};
  if(error||!media||!Number.isSafeInteger(media.size)||media.size<=0||typeof media.name!=='string'||!media.name)return{action:'stop',status:current.attempts<Math.max(1,Math.min(5,current.max_attempts||3))?'queued':'failed',error:String(error?.message||error||'Download produced no valid media').slice(0,2000)};
  return{action:'publish'};
}
