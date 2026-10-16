import { requireResourceEditor } from './middleware/resource-access.js';
import { mutationExpectedRevision } from './resource-attachment.js';
import { writeAuditLog } from './middleware/audit.js';

function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
export function metadataFields(intent){
  if(!intent||intent.protocol!==1||Object.keys(intent).some(k=>!['protocol','fields','expected_updated_at','previous_change_id'].includes(k)))fail(400,'INVALID_RESOURCE_METADATA','Unsupported metadata intent');
  const fields=intent.fields;
  if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(k=>!['category','description','tags'].includes(k)))fail(400,'INVALID_RESOURCE_METADATA','Only category, description and tags may be edited');
  if('category' in fields&& !['general','datasheet','manual','schematic','research','tutorial','reference','specification','image','cad','report','video','other'].includes(fields.category))fail(400,'INVALID_RESOURCE_METADATA','Invalid category');
  if('description' in fields&&(typeof fields.description!=='string'||Array.from(fields.description).length>5000))fail(400,'INVALID_RESOURCE_METADATA','Invalid description');
  if('tags' in fields&&(!Array.isArray(fields.tags)||fields.tags.length>30||fields.tags.some(t=>typeof t!=='string'||!t.length||Array.from(t).length>256)))fail(400,'INVALID_RESOURCE_METADATA','Invalid tags');
  if(typeof intent.expected_updated_at!=='string'||!Number.isFinite(Date.parse(intent.expected_updated_at)))fail(400,'RESOURCE_METADATA_REVISION_REQUIRED','A resource revision is required');
  return {...fields};
}
export function metadataRevision(current,expected){
  if(!Number.isFinite(Date.parse(expected))||new Date(current).getTime()!==Date.parse(expected))fail(409,'RESOURCE_METADATA_CONFLICT','Resource changed on the server. Your saved metadata is preserved for review.');
}
export async function metadataExpectedRevision(client,intent,change,user){
  metadataFields(intent);
  return mutationExpectedRevision(client,{...intent,protocol:3},change,user,['file','link','folder']);
}
// Called inside the sync transaction; domain update, required audit and the
// immutable idempotency receipt commit together. No file bytes are changed.
export async function applyResourceMetadata(client,change,user){
  if(typeof change.entity_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(change.entity_id)||change.payload?.id!==change.entity_id)fail(400,'INVALID_RESOURCE_METADATA','Canonical resource identity required');
  const intent=change.payload.metadata,fields=metadataFields(intent);
  const resource=(await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[change.entity_id])).rows[0];
  if(!resource)fail(409,'RESOURCE_NOT_FOUND','Resource no longer exists');
  const access=await requireResourceEditor(resource.id,user);
  if(!access.ok)fail(access.status,access.error.code,access.error.message);
  metadataRevision(resource.updated_at,await metadataExpectedRevision(client,intent,change,user));
  const entries=Object.entries(fields);
  if(!entries.length)return resource;
  const values=entries.map(([,v])=>v);values.push(resource.id);
  const updated=(await client.query(`UPDATE resources SET ${entries.map(([key],i)=>`${key}=$${i+1}`).join(',')},updated_at=GREATEST(date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',updated_at)+interval '1 millisecond') WHERE id=$${values.length} RETURNING *`,values)).rows[0];
  await writeAuditLog({req:{user},actorUserId:user.userId,action:'sync:edit_metadata',entityType:'resource',entityId:resource.id,deviceId:change.__device_id,client,required:true,oldValue:Object.fromEntries(entries.map(([key])=>[key,resource[key]])),newValue:fields,metadata:{source:'offline-resource-metadata'}});
  return updated;
}
