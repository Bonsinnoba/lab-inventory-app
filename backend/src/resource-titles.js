import {writeAuditLog} from './middleware/audit.js';
export function cleanResourceTitle(value){if(typeof value!=='string')return null;const title=Array.from(value.replace(/[\x00-\x1f\x7f]/g,' ').trim()).slice(0,200).join('');return title||null;}
export function titleFromDownloader(output){if(typeof output!=='string')return null;for(const line of output.split(/\r?\n/).reverse()){if(!line.startsWith('LABOS_TITLE:')||line.length>8192)continue;try{return cleanResourceTitle(JSON.parse(line.slice('LABOS_TITLE:'.length)));}catch{}}return null;}
export function metadataCanName(resource){return resource?.name_source==='url_fallback'&&typeof resource.url==='string'&&resource.name?.trim()===resource.url.trim();}
// Caller owns the publication transaction and current actor authorization.
// Explicit user names and unknown legacy provenance are never guessed away.
export async function publishResourceTitle(client,resourceId,title,actorUserId){
 title=cleanResourceTitle(title);if(!title)return null;
 const resource=(await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[resourceId])).rows[0];
 if(!metadataCanName(resource))return null;
 const updated=(await client.query("UPDATE resources SET name=$2,name_source='metadata',updated_at=GREATEST(date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',updated_at)+interval '1 millisecond') WHERE id=$1 RETURNING *",[resourceId,title])).rows[0];
 await writeAuditLog({req:{user:{userId:actorUserId}},actorUserId,action:'metadata:title',entityType:'resource',entityId:resourceId,client,required:true,oldValue:{name:resource.name,name_source:resource.name_source},newValue:{name:updated.name,name_source:updated.name_source}});return updated;
}
export function youtubeMetadataEndpoint(raw){
 try{const source=new URL(raw);if(!['https:','http:'].includes(source.protocol)||!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(source.hostname)||source.username||source.password)return null;source.hash='';return `https://www.youtube.com/oembed?url=${encodeURIComponent(source.toString())}&format=json`;}catch{return null;}
}
export async function fetchYoutubeTitle(raw,{fetcher=fetch,signal}={}){
 const endpoint=youtubeMetadataEndpoint(raw);if(!endpoint)return null;
 const response=await fetcher(endpoint,{redirect:'error',signal,headers:{Accept:'application/json'}});if(!response.ok)throw Error('Provider metadata unavailable');
 if(!response.body?.getReader)throw Error('Provider metadata stream unavailable');const reader=response.body.getReader();const chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536)throw Error('Provider metadata exceeded its bound');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=Buffer.concat(chunks.map(value=>Buffer.from(value)));return cleanResourceTitle(JSON.parse(bytes.toString('utf8')).title);
}
