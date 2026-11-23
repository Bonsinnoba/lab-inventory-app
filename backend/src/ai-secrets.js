import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdir,open,readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';

export class AiSecretStore {
 constructor(env=process.env){this.env=env;}
 async key(create=false){
  const configured=this.env.LABOS_AI_MASTER_KEY;
  if(configured){const key=Buffer.from(configured,'base64');if(key.length!==32||key.toString('base64')!==configured)throw Error('AI master key must be 32 bytes in canonical base64');return key;}
  const dir=resolve(this.env.LABOS_AI_SECRET_DIR||'.labos-secrets'),file=resolve(dir,'master.key');
  if(create){await mkdir(dir,{recursive:true,mode:0o700});let handle;try{handle=await open(file,'wx',0o600);await handle.writeFile(randomBytes(32));await handle.sync();}catch(error){if(error.code!=='EEXIST')throw error;}finally{await handle?.close();}}
  for(let attempt=0;attempt<3;attempt++){if(process.platform!=='win32'&&((await stat(file)).mode&0o077))throw Error('AI master key permissions must be private');const key=await readFile(file);if(key.length===32)return key;await new Promise(r=>setTimeout(r,10));}
  throw Error('AI credential key is unavailable');
 }
 async encrypt(value,aad,{create=false}={}){const key=await this.key(create),iv=randomBytes(12);try{const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return {v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};}finally{key.fill(0);}}
 async decrypt(record,aad){if(record?.v!==1)throw Error('Unsupported AI credential envelope');const key=await this.key();try{const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(record.iv,'base64'));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(Buffer.from(record.tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(record.ciphertext,'base64')),cipher.final()]).toString('utf8');}finally{key.fill(0);}}
}
