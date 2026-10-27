/** Real job manager, deliberately injected workers/PCM. Never real audio proof. */
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

function node(body: string) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';import{mkdtempSync,writeFileSync,readFileSync,existsSync}from'node:fs';import path from'node:path';import{tmpdir}from'node:os';
import{syntheticRuntime,syntheticJob,writeSyntheticResult,fakeChild}from'./tests/helpers/local-voice-product-fixture.mjs';
import{createProductVoiceJobs}from'./scripts/ttrpg-local-tts/product-jobs.mjs';
import{qwenProductProfiles,stable,digest}from'./scripts/ttrpg-local-tts/product-contract.mjs';
function native(){const dir=mkdtempSync(path.join(tmpdir(),'qwen-job-protocol-'));writeFileSync(path.join(dir,'product-asset-admission-v1.json'),stable({schema:'storyforge.ttrpg-qwen-product-assets',version:1,status:'verified-assets-only',nativeAssetProfileSha256:qwenProductProfiles[0].nativeAssetProfileSha256,productProfileIds:qwenProductProfiles.map(p=>p.profileId),modelCalls:0,adoptionAllowed:false,humanRightsAcceptance:'unproven'}));return dir}
${body}`], { encoding: 'utf8', maxBuffer: 1024 * 1024 }))
}
it('refuses an unavailable selected engine before creating a job, and preserves an occupied common physical slot', () => {
  expect(node(`const runtime=syntheticRuntime(),input=syntheticJob(1,qwenProductProfiles[0]);let calls=0;
const unavailable=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}});
assert.throws(()=>unavailable.create(input),/not configured/);assert.equal(existsSync(path.join(runtime,'product-jobs-v2',digest(input.jobKey))),false);
const missing=mkdtempSync(path.join(tmpdir(),'qwen-missing-admission-')),broken=native();writeFileSync(path.join(broken,'product-asset-admission-v1.json'),'{broken');
for(const root of [missing,broken]){const service=createProductVoiceJobs(runtime,{qwenRuntimeDir:root,spawnWorker(){calls++;return fakeChild()}});assert.deepEqual(service.profiles().map(p=>p.profileId),['melo-zh-product-v2']);assert.throws(()=>service.create(input),/not configured/);assert.equal(existsSync(path.join(runtime,'product-jobs-v2',digest(input.jobKey))),false)}

const qwen=native(),jobs=createProductVoiceJobs(runtime,{qwenRuntimeDir:qwen,spawnWorker(){calls++;return fakeChild()}});
const file=path.join(runtime,'.eval.lock'),held=stable({kind:'synthetic-other-evaluation',pid:process.pid});writeFileSync(file,held);
assert.equal(jobs.create(input).canStart,false);assert.equal(jobs.start(input.jobKey,input.inputArtifactHash).canStart,false);
assert.equal(readFileSync(file,'utf8'),held);assert.equal(existsSync(path.join(qwen,'.eval.lock')),false);assert.equal(calls,0);
console.log(JSON.stringify({calls,occupiedRetained:true,noUnreadyJob:true,runtime,qwen}));`)).toMatchObject({ calls: 0, occupiedRetained: true, noUnreadyJob: true })
})
it('claims both existing physical slots, freezes the selected input and retires only its own observed terminal claims', () => {
  expect(node(`const runtime=syntheticRuntime(),qwen=native(),input=syntheticJob(1,qwenProductProfiles[1]);let calls=0,child,dir;
const jobs=createProductVoiceJobs(runtime,{qwenRuntimeDir:qwen,spawnWorker(d){calls++;dir=d;child=fakeChild();return child}});
jobs.create(input);assert.equal(jobs.start(input.jobKey,input.inputArtifactHash).status,'running');
const shared=JSON.parse(readFileSync(path.join(runtime,'.eval.lock'),'utf8')),held=JSON.parse(readFileSync(path.join(qwen,'.eval.lock'),'utf8'));
assert.equal(shared.nonce,held.nonce);assert.equal(held.jobKey,input.jobKey);assert.equal(held.kind,'product-voice-native-slot');
const other=syntheticJob(2,qwenProductProfiles[0]);assert.equal(jobs.create(other).canStart,false);jobs.start(other.jobKey,other.inputArtifactHash);assert.equal(calls,1);
writeSyntheticResult(dir,input);child.emit('close',0,null);
assert.equal(existsSync(path.join(runtime,'.eval.lock')),false);assert.equal(existsSync(path.join(qwen,'.eval.lock')),false);
const raw=jobs.raw(input.jobKey);assert.equal(raw.workerExecutionKind,'injected-test-worker');assert.equal(raw.result.native.speaker,'serena');assert.equal(raw.result.audio.sampleRate,24000);
assert.equal(jobs.get(other.jobKey).canStart,true);assert.equal(calls,1);
writeFileSync(path.join(qwen,'product-asset-admission-v1.json'),'{broken');assert.equal(jobs.get(other.jobKey).canStart,false);
const recovered=createProductVoiceJobs(runtime,{qwenRuntimeDir:qwen,spawnWorker(){calls++;return fakeChild()}});assert.deepEqual(recovered.profiles().map(p=>p.profileId),['melo-zh-product-v2']);assert.deepEqual(recovered.raw(input.jobKey),raw);assert.throws(()=>recovered.start(other.jobKey,other.inputArtifactHash),/not configured/);assert.equal(calls,1);assert.equal(readFileSync(path.join(qwen,'product-asset-admission-v1.json'),'utf8'),'{broken');
console.log(JSON.stringify({calls,twoClaims:true,originalSpeaker:true,injectedOnly:true,rawSurvivesBrokenOptionalAssets:true,runtime,qwen}));`)).toMatchObject({ calls: 1, twoClaims: true, originalSpeaker: true, injectedOnly: true })
})
it('candidate setup and explicit cancellation prevent launch without erasing either original source or another owner lock', () => {
  expect(node(`const runtime=syntheticRuntime(),qwen=native(),input=syntheticJob(1,qwenProductProfiles[0]);let calls=0;
const jobs=createProductVoiceJobs(runtime,{qwenRuntimeDir:qwen,spawnWorker(){calls++;return fakeChild()}});
writeFileSync(path.join(qwen,'.prepare.lock'),'synthetic installer claim');jobs.create(input);assert.equal(jobs.get(input.jobKey).canStart,false);jobs.start(input.jobKey,input.inputArtifactHash);
assert.equal(existsSync(path.join(runtime,'.eval.lock')),false);assert.equal(existsSync(path.join(qwen,'.eval.lock')),false);
const other=syntheticJob(2,qwenProductProfiles[1]);assert.equal(jobs.cancel(other.jobKey).cancellationConfirmed,false);assert.equal(jobs.create(other).status,'cancelled-before-start');assert.equal(calls,0);
assert.equal(readFileSync(path.join(qwen,'.prepare.lock'),'utf8'),'synthetic installer claim');console.log(JSON.stringify({calls,setupRetained:true,cancelBeforeCreate:true,runtime,qwen}));`)).toMatchObject({ calls: 0, setupRetained: true, cancelBeforeCreate: true })
})
