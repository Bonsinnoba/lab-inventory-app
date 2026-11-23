import {createHash} from 'node:crypto';
import {AiSecretStore} from './ai-secrets.js';
export const AI_FEATURES=['chat','planning','transcription'];
export const aiError=(status,code,message)=>Object.assign(Error(message),{status,code,ai_public:true});
const bad=message=>{throw aiError(400,'AI_SETTINGS_INVALID',message);};
const text=(value,max,label)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))bad(`Invalid ${label}`);return value.trim();};
const bound=(n,min,max,label)=>{if(!Number.isInteger(n)||n<min||n>max)bad(`Invalid ${label} (${min}-${max})`);return n;};
export function initialAiSettings(env=process.env){return {profiles:[
 {id:'cloud',name:'Cloud AI',provider:'gemini',enabled:!!env.GEMINI_API_KEY,key_mode:env.GEMINI_API_KEY?'environment':'none',base_url:'',models:{chat:env.GEMINI_MODEL||'gemini-3.6-flash',planning:env.GEMINI_PROPOSAL_MODEL||env.GEMINI_MODEL||'gemini-3.6-flash',transcription:env.GEMINI_TRANSCRIPTION_MODEL||env.GEMINI_MODEL||''},tools:true,structured:true,transcription_policy:env.LABOS_TRANSCRIPTION_PROVIDER_POLICY||''},
 {id:'local',name:'Server-local AI',provider:'openai-compatible',enabled:false,key_mode:'none',base_url:'http://labos-model:11434/v1',models:{chat:'',planning:'',transcription:''},tools:true,structured:true,transcription_policy:''}
 ],assignments:{chat:'cloud',planning:'cloud',transcription:env.LABOS_TRANSCRIPTION_ENABLED==='true'?'cloud':null},limits:{concurrency:2,queue:8,timeout_ms:25000,max_output_tokens:2048}};}
export function validateAiEndpoint(profile,env=process.env){
 if(profile.provider==='gemini'){if(profile.base_url)bad('Gemini uses its fixed provider endpoint');return;}
 let url;try{url=new URL(profile.base_url);}catch{bad('Enter a valid provider endpoint');}
 const allowed=(profile.id==='local'?(env.LABOS_AI_LOCAL_ORIGINS||'http://labos-model:11434,http://127.0.0.1:11434,http://localhost:11434,http://host.docker.internal:11434'):(env.LABOS_AI_CLOUD_ORIGINS||'https://api.openai.com')).split(',').map(s=>s.trim());
 if(url.username||url.password||url.search||url.hash||!allowed.includes(url.origin)||!/^\/v1\/?$/.test(url.pathname))bad('Endpoint must use an operator-approved origin and /v1 path');
 if(profile.id==='cloud'&&url.protocol!=='https:')bad('Cloud endpoints require HTTPS');
}
export function validateAiSettings(input,env=process.env){
 if(!input||!Array.isArray(input.profiles)||input.profiles.length!==2)bad('Configure exactly one cloud and one local profile');
 const profiles=['cloud','local'].map(id=>{const p=input.profiles.find(p=>p?.id===id);if(!p)bad('Missing provider profile');
  if(!['gemini','openai-compatible'].includes(p.provider)||(id==='local'&&p.provider!=='openai-compatible'))bad('Unsupported provider');
  if(typeof p.enabled!=='boolean'||typeof p.tools!=='boolean'||typeof p.structured!=='boolean'||!['managed','environment','none'].includes(p.key_mode))bad('Invalid provider switches');
  if(p.key_mode==='environment'&&(id!=='cloud'||p.provider!=='gemini'))bad('Environment key is supported only for Gemini');
  const profile={id,name:text(p.name,80,'profile name'),provider:p.provider,enabled:p.enabled,key_mode:p.key_mode,base_url:text(p.base_url,300,'endpoint'),models:Object.fromEntries(AI_FEATURES.map(f=>[f,text(p.models?.[f],120,`${f} model`)])),tools:p.tools,structured:p.structured,transcription_policy:text(p.transcription_policy,2000,'transcription policy')};
  if(p.api_key!==undefined)profile.api_key=text(p.api_key,4096,'API key');
  validateAiEndpoint(profile,env);return profile;
 });
 const assignments=Object.fromEntries(AI_FEATURES.map(f=>{const id=input.assignments?.[f];if(id!==null&&!['cloud','local'].includes(id))bad(`Invalid ${f} assignment`);return [f,id];}));
 const limits={concurrency:bound(input.limits?.concurrency,1,4,'concurrency'),queue:bound(input.limits?.queue,0,32,'queue'),timeout_ms:bound(input.limits?.timeout_ms,5000,60000,'timeout'),max_output_tokens:bound(input.limits?.max_output_tokens,256,8192,'output token limit')};
 return {profiles,assignments,limits};
}
export const credentialAad=p=>`labos-ai-v1:${p.id}:${p.provider}:${p.base_url}`;
export function profileFingerprint(p,key){return createHash('sha256').update(JSON.stringify([p.id,p.provider,p.base_url,p.models,p.tools,p.structured,p.transcription_policy,key])).digest('hex');}
export class AiSettingsRepository {
 constructor({pool,secrets=new AiSecretStore(),env=process.env,audit=async()=>{}}){Object.assign(this,{pool,secrets,env,audit});}
 async read(){const row=(await this.pool.query('SELECT version,document FROM assistant_provider_settings WHERE singleton=true')).rows[0];return row?{version:row.version,...row.document}:{version:0,...initialAiSettings(this.env)};}
 public(config){return {version:config.version,profiles:config.profiles.map(p=>({id:p.id,name:p.name,provider:p.provider,base_url:p.base_url,enabled:p.enabled,key_mode:p.key_mode,has_key:p.key_mode==='managed'?!!p.encrypted_key:p.key_mode==='environment'?!!this.env.GEMINI_API_KEY:false,models:p.models,tools:p.tools,structured:p.structured,transcription_policy:p.transcription_policy,tested_at:p.tested_at||null,verified:p.verified||null})),assignments:config.assignments,limits:config.limits};}
 async key(profile){try{return profile.key_mode==='managed'?await this.secrets.decrypt(profile.encrypted_key,credentialAad(profile)):profile.key_mode==='environment'?this.env.GEMINI_API_KEY||'':'';}catch{throw aiError(503,'AI_CREDENTIAL_UNAVAILABLE','Stored AI credentials cannot be unlocked. Check the server secret volume or master key.');}}
 async ready(feature){const config=await this.read(),p=config.profiles.find(p=>p.id===config.assignments[feature]);if(!p?.enabled||!p.models[feature])throw aiError(503,'AI_NOT_CONFIGURED',`Configure ${feature} in Settings > AI & Models`);
  validateAiEndpoint(p,this.env);const key=await this.key(p);if(p.id==='cloud'&&!key)throw aiError(503,'AI_NOT_CONFIGURED','Cloud AI credentials are not configured');
  if(feature==='chat'&&!p.tools)throw aiError(503,'AI_TOOLS_UNAVAILABLE','The selected assistant model must support tool calling');
  if(feature==='planning'&&!p.structured)throw aiError(503,'AI_JSON_UNAVAILABLE','Planning requires structured output support');
  if(feature==='transcription'&&(p.provider!=='gemini'||!p.transcription_policy))throw aiError(503,'AI_AUDIO_UNAVAILABLE','Transcription needs a supported audio provider and a processing disclosure');
  if(config.version>0&&p.tested_hash!==profileFingerprint(p,key))throw aiError(503,'AI_TEST_REQUIRED','Test the selected provider profile before using it');
  if(config.version>0&&feature!=='transcription'&&p.verified?.[feature]!==true)throw aiError(503,'AI_TEST_REQUIRED','The selected feature has not passed its connection test');
  return {profile:p,key,model:p.models[feature],limits:config.limits};
 }
 async save(input,actor){const clean=validateAiSettings(input,this.env);if(!Number.isInteger(input.version)||input.version<0)bad('Invalid settings version');const client=await this.pool.connect();
  try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('labos-ai-settings'))");const stored=(await client.query('SELECT version,document FROM assistant_provider_settings WHERE singleton=true FOR UPDATE')).rows[0];const previous=stored?{version:stored.version,...stored.document}:{version:0,...initialAiSettings(this.env)};if(previous.version!==input.version)throw aiError(409,'AI_SETTINGS_CHANGED','AI settings changed. Reload before saving.');
   for(const p of clean.profiles){const old=previous.profiles.find(x=>x.id===p.id),same=credentialAad(p)===credentialAad(old);
    if(p.key_mode==='managed'){if(p.api_key){p.encrypted_key=await this.secrets.encrypt(p.api_key,credentialAad(p),{create:!previous.profiles.some(x=>x.encrypted_key)});}else if(same&&old.encrypted_key)p.encrypted_key=old.encrypted_key;else bad('Enter a new API key for this provider');}
    delete p.api_key;
    if(same&&old.tested_hash){const key=await this.key(p);if(profileFingerprint(p,key)===old.tested_hash){p.tested_hash=old.tested_hash;p.tested_at=old.tested_at;p.verified=old.verified;}}
    if(p.enabled){const key=await this.key(p);if(p.id==='cloud'&&!key)bad('A cloud API key is required');if(!p.tested_hash)bad('Save the profile disabled, test it, then enable it');}
   }
   const version=previous.version+1;await client.query('INSERT INTO assistant_provider_settings(singleton,version,document,updated_by) VALUES(true,$1,$2,$3) ON CONFLICT(singleton) DO UPDATE SET version=$1,document=$2,updated_by=$3,updated_at=now()',[version,clean,actor]);
   await this.audit(client,actor,{action:'AI_SETTINGS_UPDATED',version});await client.query('COMMIT');return this.public({version,...clean});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async recordTest(version,id,fingerprint,verified,actor){const config=await this.read();if(config.version!==version)throw aiError(409,'AI_SETTINGS_CHANGED','Settings changed during the provider test');const p=config.profiles.find(p=>p.id===id);if(!p)bad('Unknown profile');p.tested_hash=fingerprint;p.tested_at=new Date().toISOString();p.verified=verified;const {version:ignored,...document}=config;
  const client=await this.pool.connect();try{await client.query('BEGIN');const result=await client.query('UPDATE assistant_provider_settings SET document=$1,version=version+1,updated_by=$2,updated_at=now() WHERE singleton=true AND version=$3 RETURNING version',[document,actor,version]);if(!result.rowCount)throw aiError(409,'AI_SETTINGS_CHANGED','Settings changed during the provider test');await this.audit(client,actor,{action:'AI_PROVIDER_TESTED',profile:id,features:Object.entries(verified).filter(([,value])=>value===true).map(([feature])=>feature),version:result.rows[0].version});await client.query('COMMIT');return this.public({version:result.rows[0].version,...document});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
}
