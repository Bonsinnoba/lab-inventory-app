import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateProposalGraph,proposalDigest,generatedProposal,proposalUuid} from './assistant-proposal-contract.js';
const cases=JSON.parse(readFileSync(new URL('../../contracts/assistant-proposal-cases.json',import.meta.url),'utf8'));
for(const item of cases)test(item.name,()=>{if(!item.valid)return assert.throws(()=>validateProposalGraph(item.input));const normalized=validateProposalGraph(item.input);assert.deepEqual(normalized,item.normalized);assert.equal(proposalDigest(normalized),item.digest);});
test('generation identity is stable while deliberate regeneration creates new IDs',()=>{
 const id='10000000-0000-4000-8000-000000000001',output={name:'Planning',tasks:[{title:'Task'}],experiments:[{title:'Experiment'}],links:[{task_index:0,experiment_index:0}]};
 assert.deepEqual(generatedProposal(id,output,null),generatedProposal(id,output,null));assert.notEqual(generatedProposal(id,output,null).target.project_id,generatedProposal('10000000-0000-4000-8000-000000000002',output,null).target.project_id);
 assert.equal(proposalUuid(id,'task:0'),generatedProposal(id,output,null).tasks[0].id);
 assert.throws(()=>generatedProposal(id,{...output,links:[{task_index:1,experiment_index:0}]},null));
});
test('invisible Unicode trim and null optional text normalize consistently; malformed Unicode cannot enter drafts',()=>{
 const graph=structuredClone(cases[0].input);graph.tasks[0].title='\uFEFF測定\u3000';graph.tasks[0].description=null;
 assert.equal(validateProposalGraph(graph).tasks[0].title,'測定');assert.equal(validateProposalGraph(graph).tasks[0].description,'');graph.tasks[0].title='\ud800';assert.throws(()=>validateProposalGraph(graph));
});
