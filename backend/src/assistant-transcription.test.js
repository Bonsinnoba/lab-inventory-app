import test from 'node:test';
import assert from 'node:assert/strict';
import {transcriptionSettings} from './assistant-transcription.js';
test('voice requires explicit enablement, provider key, model and processing policy',()=>{
 const env={LABOS_TRANSCRIPTION_ENABLED:'true',GEMINI_API_KEY:'not-a-real-key',GEMINI_TRANSCRIPTION_MODEL:'configured-model',LABOS_TRANSCRIPTION_PROVIDER_POLICY:'Operator reviewed provider terms'};
 assert.equal(transcriptionSettings(env).enabled,true);
 for(const key of Object.keys(env))assert.equal(transcriptionSettings({...env,[key]:''}).enabled,false);
 assert.ok(!JSON.stringify(transcriptionSettings(env)).includes('not-a-real-key'));
});
test('consent identity changes with model or disclosed processing policy',()=>{
 const env={GEMINI_TRANSCRIPTION_MODEL:'one',LABOS_TRANSCRIPTION_PROVIDER_POLICY:'first'};
 const first=transcriptionSettings(env);assert.notEqual(first.disclosure_id,transcriptionSettings({...env,GEMINI_TRANSCRIPTION_MODEL:'two'}).disclosure_id);assert.notEqual(first.disclosure_id,transcriptionSettings({...env,LABOS_TRANSCRIPTION_PROVIDER_POLICY:'second'}).disclosure_id);
 assert.equal(first.max_bytes,6*1024*1024);assert.equal(first.max_recording_seconds,60);
});
