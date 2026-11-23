import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {AiSecretStore} from './ai-secrets.js';
test('server credential envelope authenticates profile identity and survives reopening the secret store',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'labos-ai-secret-test-'));try{const store=new AiSecretStore({LABOS_AI_SECRET_DIR:dir}),record=await store.encrypt('test-only-secret','cloud:provider',{create:true});assert.equal(JSON.stringify(record).includes('test-only-secret'),false);assert.equal(await new AiSecretStore({LABOS_AI_SECRET_DIR:dir}).decrypt(record,'cloud:provider'),'test-only-secret');await assert.rejects(store.decrypt(record,'different-profile'));const key=await readFile(join(dir,'master.key'));assert.equal(key.length,32);await rm(join(dir,'master.key'));await assert.rejects(store.decrypt(record,'cloud:provider'));}finally{await rm(dir,{recursive:true,force:true});}
});
