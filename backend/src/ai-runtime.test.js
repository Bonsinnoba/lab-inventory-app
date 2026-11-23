import test from 'node:test';
import assert from 'node:assert/strict';
import {AiRequestGate,createAiTransport} from './ai-runtime.js';
import {initialAiSettings,validateAiSettings,validateAiEndpoint} from './ai-settings.js';
const runtime=(id='cloud',extra={})=>({profile:{id,provider:'openai-compatible',base_url:'https://api.openai.com/v1'},key:'test-only-key',model:'fixture-model',limits:{concurrency:2,queue:2,timeout_ms:5000,max_output_tokens:512},...extra});
test('configuration validates provider boundaries, limits, and private endpoint allowlists',()=>{
 const config=initialAiSettings({});assert.equal(config.profiles[1].enabled,false);assert.equal(validateAiSettings(config,{}).profiles.length,2);
 for(const endpoint of ['http://169.254.169.254/v1','https://api.openai.com@evil.test/v1','https://evil.test/v1','https://api.openai.com/v1?token=x','https://api.openai.com/v1/../../metadata'])assert.throws(()=>validateAiEndpoint({id:'cloud',provider:'openai-compatible',base_url:endpoint},{}));
 assert.doesNotThrow(()=>validateAiEndpoint({id:'local',provider:'openai-compatible',base_url:'http://labos-model:11434/v1'},{}));
 assert.throws(()=>validateAiSettings({...config,limits:{...config.limits,concurrency:100}},{}));
});
test('shared gate bounds queued requests and allows only one local inference at a time',async()=>{
 const gate=new AiRequestGate(),controller=new AbortController(),releases=[];let active=0,max=0;
 const task=()=>new Promise(resolve=>{active++;max=Math.max(max,active);releases.push(()=>{active--;resolve('ok');});});
 const one=gate.run(runtime('local'),task,controller.signal);await new Promise(r=>setImmediate(r));const two=gate.run(runtime('local'),task,controller.signal);await new Promise(r=>setImmediate(r));assert.equal(active,1);assert.equal(gate.waiting.length,1);
 const cloud=gate.run(runtime('cloud'),task,controller.signal);await new Promise(r=>setImmediate(r));assert.equal(active,2);releases.shift()();await one;await new Promise(r=>setImmediate(r));assert.equal(active,2);while(releases.length)releases.shift()();await Promise.all([two,cloud]);assert.equal(max,2);assert.equal(gate.active,0);
});
test('queue saturation rejects immediately; cancellation removes a waiting request',async()=>{
 const gate=new AiRequestGate(),r=runtime();r.limits={...r.limits,concurrency:1,queue:1};let finish;
 const one=gate.run(r,()=>new Promise(resolve=>finish=resolve));await new Promise(r=>setImmediate(r));const abort=new AbortController();const two=gate.run(r,()=>assert.fail('cancelled task ran'),abort.signal);await new Promise(r=>setImmediate(r));await assert.rejects(gate.run(r,async()=>null),e=>e.code==='AI_BUSY');abort.abort();await assert.rejects(two,e=>e.code==='AI_CANCELLED');assert.equal(gate.waiting.length,0);finish();await one;
});
test('active inference receives its deadline and releases its slot after abort',async()=>{
 const gate=new AiRequestGate(),r=runtime();r.limits={...r.limits,timeout_ms:20};
 await assert.rejects(gate.run(r,signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('provider cancelled')),{once:true}))),error=>error.code==='AI_CANCELLED');assert.equal(gate.active,0);
});
test('OpenAI-compatible chat preserves tool call IDs, scopes and first-round tool forcing',async()=>{
 const requests=[],answers=[{content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'read_fixture',arguments:'{"id":"fixture"}'}}]},{content:'Grounded answer'}];
 const transport=createAiTransport({fetchImpl:async(url,options)=>{requests.push({url,...options,body:JSON.parse(options.body)});return new Response(JSON.stringify({choices:[{message:answers.shift()}]}));}});
 const chat=transport.chat(runtime(),{systemInstruction:'Read-only',tools:[{name:'read_fixture',description:'Allowed read',parametersJsonSchema:{type:'object'}}],forceTool:true});
 const reply=await chat.sendMessage({message:'Show fixture'});assert.equal(reply.functionCalls[0].args.id,'fixture');assert.equal(requests[0].body.tool_choice,'required');assert.equal(requests[0].redirect,'error');assert.equal(requests[0].headers.Authorization,'Bearer test-only-key');
 const result=await chat.sendMessage({message:[{functionResponse:{name:'read_fixture',response:{result:'Only permitted content'}}}]});assert.equal(result.text,'Grounded answer');assert.equal(requests[1].body.tool_choice,'auto');assert.ok(requests[1].body.messages.some(m=>m.role==='tool'&&m.tool_call_id==='call-1'));assert.equal(requests[0].body.max_tokens,512);
});
test('Gemini adapter forces tools only for the first round and uses the configured model/key',async()=>{
 const calls=[];class Google{constructor(options){assert.equal(options.apiKey,'test-only-key');this.chats={create:options=>{assert.equal(options.model,'fixture-model');return{sendMessage:async request=>{calls.push(request);return {text:'ok',functionCalls:[]};}};}};}}
 const transport=createAiTransport({Google}),chat=transport.chat(runtime('cloud',{profile:{id:'cloud',provider:'gemini'}}),{systemInstruction:'Safe',tools:[{name:'read'}],forceTool:true});await chat.sendMessage({message:'one'});await chat.sendMessage({message:[]});assert.equal(calls[0].config.toolConfig.functionCallingConfig.mode,'ANY');assert.equal(calls[1].config.toolConfig.functionCallingConfig.mode,'AUTO');
});
test('provider exceptions and malformed responses never expose credentials or trigger fallback',async()=>{
 let calls=0;const transport=createAiTransport({fetchImpl:async()=>{calls++;throw Error('Sensitive provider URL with test-only-key');}});await assert.rejects(transport.json(runtime(),{systemInstruction:'Safe',prompt:'Test'}),error=>error.code==='AI_PROVIDER_FAILED'&&!error.message.includes('test-only-key'));assert.equal(calls,1);
 const invalid=createAiTransport({fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'not JSON'}}]}))});await assert.rejects(invalid.json(runtime(),{prompt:'Test'}),e=>e.code==='AI_JSON_INVALID');
});
