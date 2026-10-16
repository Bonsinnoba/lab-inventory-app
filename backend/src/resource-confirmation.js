import {authorityIds} from './resource-authority.js';
import {createHash} from 'node:crypto';
// Native intents use ASCII schema keys and integer protocol values. Sort object
// keys, preserve array order and encode strings as JSON UTF-8 on both sides.
export function confirmationDigest(value){
  const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
  return createHash('sha256').update(canonical(value),'utf8').digest('hex');
}
export function confirmationRequest(body){
  const change_ids=authorityIds(body?.change_ids),resource_id=authorityIds([body?.resource_id])[0];
  if(body?.protocol!==undefined&&![1,2].includes(body.protocol))
    throw Object.assign(new Error('Unsupported resource confirmation protocol'),{status:400});
  if(!change_ids.length||typeof body.device_id!=='string'||!body.device_id.trim()||body.device_id.length>200)
    throw Object.assign(new Error('Invalid resource confirmation request'),{status:400});
  return {change_ids,resource_id,device_id:body.device_id,...(body.protocol===2?{protocol:2}:{})};
}
// Confirmation describes a historical owned event, not permission to read/edit
// the resource now. Missing/foreign receipts reveal no historical metadata.
export function confirmationReceipt(changeId,row,request,userId){
  const pending={change_id:changeId,confirmed:false};
  if(!row||row.change_id!==changeId||row.user_id!==userId||row.device_id!==request.device_id||row.entity_type!=='resource'||row.entity_id!==request.resource_id||!['create','create_copy','edit_content','attach','edit_metadata'].includes(row.operation))return pending;
  const record=row.response_json;
  if(['attach','edit_metadata'].includes(row.operation)){
    if(record?.id!==request.resource_id||!['file','link','folder'].includes(record.kind)||typeof record.updated_at!=='string'||!Number.isFinite(Date.parse(record.updated_at))||row.payload_json?.id!==record.id)return pending;
    const mutation={kind:record.kind,visibility:record.visibility??'lab',item_id:record.item_id??null,project_id:record.project_id??null,note_id:record.note_id??null,parent_resource_id:record.parent_resource_id??null,category:record.category??null,description:record.description??null,tags:record.tags??[]};
    return {...pending,confirmed:true,resource_id:record.id,operation:row.operation,revision:record.updated_at,mutation_sha256:confirmationDigest(mutation),payload_sha256:confirmationDigest(row.payload_json)};
  }
  const size=Number(record?.size_bytes);
  if(record?.id!==request.resource_id||record.kind!=='file'||typeof record.updated_at!=='string'||!Number.isFinite(Date.parse(record.updated_at))||record.size_bytes==null||!Number.isSafeInteger(size)||size<0)return pending;
  const receipt={...pending,confirmed:true,resource_id:record.id,operation:row.operation,revision:record.updated_at,size_bytes:size};
  // Older desktops retain their protocol-1 shape. Protocol 2 binds the receipt
  // to the exact committed native upload intent, including its content digest.
  if(request.protocol===2){
    const payload=row.payload_json,upload=payload?.upload;
    if(payload?.resource?.id!==record.id||upload?.protocol!==1||upload.size_bytes!==size||
      typeof upload.sha256!=='string'||!/^[a-f0-9]{64}$/.test(upload.sha256))return pending;
    return {...receipt,payload_sha256:confirmationDigest(payload)};
  }
  return receipt;
}
