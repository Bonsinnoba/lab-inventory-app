import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./assistant-proposal-contract.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,crypto:webcrypto});
const cases=JSON.parse(readFileSync(new URL('../../../contracts/assistant-proposal-cases.json',import.meta.url),'utf8'));
for(const item of cases)test('renderer contract: '+item.name,async()=>{if(!item.valid)return assert.throws(()=>exports.validateProposalGraph(item.input));const graph=exports.validateProposalGraph(item.input);assert.deepEqual(JSON.parse(JSON.stringify(graph)),item.normalized);assert.equal(await exports.proposalDigest(graph),item.digest);});
