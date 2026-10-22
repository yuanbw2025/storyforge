import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

function node(script: string) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';import path from 'node:path';
import {assertProductImplementation,validateProductJob,verifyProductResult,productProfile,productProfileHash,stable,digest} from './scripts/ttrpg-local-tts/product-contract.mjs';
import {createProductVoiceJobs} from './scripts/ttrpg-local-tts/product-jobs.mjs';
import {syntheticJob,syntheticRuntime,fakeChild,syntheticResult,writeSyntheticResult} from './tests/helpers/local-voice-product-fixture.mjs';
function unknownComplete(jobs,runtime,input){
 jobs.create(input);const dir=path.join(runtime,'product-jobs-v2',digest(input.jobKey)),nonce='12345678-1234-4234-8234-123456789abc';
 const claim={kind:'start-authorized',jobKey:input.jobKey,inputArtifactHash:input.inputArtifactHash,nonce,owner:{pid:process.pid,start:'an earlier controller process epoch'}};
 writeFileSync(path.join(dir,'start.json'),stable(claim));writeFileSync(path.join(dir,'worker-started.json'),stable({jobKey:input.jobKey,inputArtifactHash:input.inputArtifactHash,launchNonce:nonce,pid:process.pid,processStart:'an earlier worker process epoch'}));
 const record=JSON.parse(readFileSync(path.join(dir,'job.json'),'utf8'));writeFileSync(path.join(dir,'job.json'),stable({...record,status:'running',launchNonce:nonce}));
 writeSyntheticResult(dir,input);return {dir,claim};
}
${script}`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }))
}
describe('R-TTRPGOPEN10 actual offline worker protocol and physical raw audio boundary', () => {
  it('low disk preserves the waiting original input and prevents a worker, lease or physical slot from being created', () => {
    expect(node(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const runtime=syntheticRuntime(),input=syntheticJob();let calls=0;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}});jobs.create(input);
const dir=path.join(runtime,'product-jobs-v2',digest(input.jobKey)),before=readFileSync(path.join(dir,'input.json'),'utf8'),record=readFileSync(path.join(dir,'job.json'),'utf8');
const observe=fs.statfsSync;fs.statfsSync=()=>({bavail:0,bsize:4096});syncBuiltinESMExports();
try{assert.throws(()=>jobs.start(input.jobKey,input.inputArtifactHash),/Insufficient free space/)}finally{fs.statfsSync=observe;syncBuiltinESMExports()}
assert.equal(calls,0);assert.equal(readFileSync(path.join(dir,'input.json'),'utf8'),before);assert.equal(readFileSync(path.join(dir,'job.json'),'utf8'),record);
for(const file of ['start.json','lease.json','result.json','audio.wav'])assert.equal(existsSync(path.join(dir,file)),false);
assert.equal(existsSync(path.join(runtime,'.eval.lock')),false);assert.equal(existsSync(path.join(runtime,'.product-voice-worker.lock')),false);
assert.equal(productProfile.minimumFreeBytes,5*1024**3);console.log(JSON.stringify({calls,originalRetained:true,noClaimOrLease:true,runtime}));`)).toMatchObject({ calls: 0, originalRetained: true, noClaimOrLease: true })
  })
  it('a renewal arriving after the observed successful close reads the original terminal without extending its lease or cancelling the result', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let calls=0,child,dir;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(d){calls++;dir=d;child=fakeChild();return child}});
jobs.create(input);assert.equal(jobs.start(input.jobKey,input.inputArtifactHash).status,'running');
const observed=jobs.get(input.jobKey),lease=readFileSync(path.join(dir,'lease.json'),'utf8');assert.equal(observed.status,'running');
writeSyntheticResult(dir,input);child.emit('close',0,null);
const record=readFileSync(path.join(dir,'job.json'),'utf8'),state=jobs.renew(input.jobKey,input.inputArtifactHash);
assert.equal(state.status,'generated');assert.equal(state.canStart,false);assert.equal(state.cancellationRequested,false);
assert.equal(readFileSync(path.join(dir,'lease.json'),'utf8'),lease);assert.equal(readFileSync(path.join(dir,'job.json'),'utf8'),record);
const restarted=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('must not restart')}});
assert.deepEqual(restarted.renew(input.jobKey,input.inputArtifactHash),state);
assert.throws(()=>jobs.renew(input.jobKey,'0'.repeat(64)));assert.throws(()=>jobs.renew(syntheticJob(2).jobKey,input.inputArtifactHash));
assert.deepEqual(child.signals,[]);assert.equal(calls,1);assert.equal(existsSync(path.join(dir,'cancel-request.json')),false);
const raw=jobs.raw(input.jobKey);assert.equal(raw.result.inputArtifactHash,input.inputArtifactHash);assert.equal(raw.candidateAccepted,false);assert.equal(raw.adoptionAllowed,false);
const wav=readFileSync(path.join(dir,'audio.wav'));wav[100]^=1;writeFileSync(path.join(dir,'audio.wav'),wav);
assert.equal(jobs.renew(input.jobKey,input.inputArtifactHash).status,'generated');assert.throws(()=>jobs.raw(input.jobKey));
assert.equal(readFileSync(path.join(dir,'lease.json'),'utf8'),lease);
console.log(JSON.stringify({calls,terminalReadOnly:true,originalRaw:true,runtime}));`)).toMatchObject({ calls: 1, terminalReadOnly: true, originalRaw: true })
  })
  it('the actual HTTP lease boundary returns the just-completed original metadata and raw without another start or a cancellation', () => {
    expect(node(`import {createServer} from 'node:http';import {createProductVoiceBridge,PREFIX} from './scripts/ttrpg-local-tts/product-bridge.mjs';
const runtime=syntheticRuntime(),input=syntheticJob();let calls=0,child,dir,finishOnLease=false,finished=false;
const bridge=createProductVoiceBridge(runtime,{spawnWorker(d){calls++;dir=d;child=fakeChild();return child}});
const server=createServer((req,res)=>{if(finishOnLease&&!finished&&req.url.endsWith('/lease')){finished=true;writeSyntheticResult(dir,input);child.emit('close',0,null)}return bridge.middleware(req,res,()=>{res.writeHead(404);res.end()})});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
try{const origin='http://127.0.0.1:'+server.address().port,headers={'X-StoryForge-Tts':'1','Content-Type':'application/json'},url=origin+PREFIX+'/jobs/'+input.jobKey;
await fetch(origin+PREFIX+'/jobs',{method:'POST',headers,body:JSON.stringify(input)});
const post=(action,value)=>fetch(url+'/'+action,{method:'POST',headers,body:JSON.stringify(value)});
assert.equal((await post('start',{inputArtifactHash:input.inputArtifactHash})).status,200);
assert.equal((await(await fetch(url,{headers})).json()).status,'running');const lease=readFileSync(path.join(dir,'lease.json'),'utf8');
finishOnLease=true;const result=await post('lease',{inputArtifactHash:input.inputArtifactHash});assert.equal(result.status,200);
const state=await result.json();assert.equal(state.status,'generated');assert.equal(state.inputArtifactHash,input.inputArtifactHash);assert.equal(state.cancellationRequested,false);
assert.equal((await post('lease',{inputArtifactHash:'0'.repeat(64)})).status,409);
assert.equal((await post('lease',{inputArtifactHash:input.inputArtifactHash,extra:true})).status,409);
assert.equal((await post('lease',{inputArtifactHash:input.inputArtifactHash})).status,200);
assert.equal(readFileSync(path.join(dir,'lease.json'),'utf8'),lease);
const rawResponse=await fetch(url+'/raw',{headers});assert.equal(rawResponse.status,200);const raw=await rawResponse.json();
assert.equal(raw.result.jobKey,input.jobKey);assert.equal(raw.workerExecutionKind,'injected-test-worker');assert.equal(raw.cancellationRequested,false);
assert.equal(raw.candidateAccepted,false);assert.equal(raw.adoptionAllowed,false);assert.equal(calls,1);assert.deepEqual(child.signals,[]);
assert.equal(existsSync(path.join(dir,'cancel-request.json')),false);
}finally{bridge.close();await new Promise(ok=>server.close(ok))}
console.log(JSON.stringify({calls,completionRace:true,noLeaseExtension:true,runtime}));`)).toMatchObject({ calls: 1, completionRace: true, noLeaseExtension: true })
  })
  it('late lease reads cannot turn failed, cancelled, unknown or unproven output into a completed result or renew their lease', () => {
    expect(node(`for(const scenario of ['failed','cancelled','unknown','unproven-generated','failed-proof-generated']){
const runtime=syntheticRuntime(),input=syntheticJob();let child,dir;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(d){dir=d;child=fakeChild();return child}});jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);
if(scenario==='cancelled')jobs.cancel(input.jobKey);child.emit('close',scenario==='cancelled'?null:2,scenario==='cancelled'?'SIGTERM':null);
const file=path.join(dir,'job.json'),record=JSON.parse(readFileSync(file,'utf8'));
if(scenario==='unknown'){record.status='running';delete record.terminal}
if(scenario==='unproven-generated'){record.status='generated';delete record.terminal}
if(scenario==='failed-proof-generated'){record.status='generated';record.terminal={kind:'observed-child-close',code:2,signal:null}}
writeFileSync(file,stable(record));const before=readFileSync(file,'utf8'),lease=readFileSync(path.join(dir,'lease.json'),'utf8');
assert.throws(()=>jobs.renew(input.jobKey,input.inputArtifactHash));assert.equal(readFileSync(file,'utf8'),before);assert.equal(readFileSync(path.join(dir,'lease.json'),'utf8'),lease);
}console.log(JSON.stringify({rejected:5,noLeaseOrTerminalMutation:true}));`)).toEqual({ rejected: 5, noLeaseOrTerminalMutation: true })
  })
  it('keeps the first complete raw delivery byte-identical after a later stop while status still reports the new request', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob(),jobs=createProductVoiceJobs(runtime,{spawnWorker(){throw new Error('must-not-infer')}});
unknownComplete(jobs,runtime,input);const first=jobs.recoverRaw(input.jobKey,input.inputArtifactHash),before=jobs.get(input.jobKey);
jobs.cancel(input.jobKey);const second=jobs.raw(input.jobKey),after=jobs.get(input.jobKey);
const restarted=createProductVoiceJobs(runtime,{spawnWorker(){throw new Error('must-not-infer')}}),again=restarted.raw(input.jobKey);
console.log(JSON.stringify({sameBytes:JSON.stringify(first)===JSON.stringify(second)&&JSON.stringify(first)===JSON.stringify(again),beforeCancellation:before.cancellationRequested,nowCancellation:after.cancellationRequested,rawCancellation:second.cancellationRequested,smallReceipt:readFileSync(path.join(runtime,'product-jobs-v2',digest(input.jobKey),'raw-delivery-v1.json')).length<2048,runtime}));
`)).toMatchObject({ sameBytes: true, beforeCancellation: false, nowCancellation: true, rawCancellation: false, smallReceipt: true })
  })
  it('does not overwrite a corrupted first-delivery record or accept changed result bytes as the same raw response', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob(),jobs=createProductVoiceJobs(runtime,{spawnWorker(){throw new Error('must-not-infer')}});
const {dir}=unknownComplete(jobs,runtime,input);jobs.recoverRaw(input.jobKey,input.inputArtifactHash);
const file=path.join(dir,'raw-delivery-v1.json'),record=JSON.parse(readFileSync(file,'utf8'));record.inputArtifactHash='0'.repeat(64);writeFileSync(file,stable(record));
const corrupt=readFileSync(file,'utf8');assert.throws(()=>jobs.raw(input.jobKey));assert.equal(readFileSync(file,'utf8'),corrupt);
console.log(JSON.stringify({preserved:true,runtime}));`).preserved).toBe(true)
  })
  it('pins the product implementation independently while old eval and reading keep no product/model permission', () => {
    expect(node(`assertProductImplementation();const input=syntheticJob();assert.deepEqual(validateProductJob(input),input);
const invalid=[{...input,outputDir:'/tmp/author'},{...input,jobKey:'other'}, {...input,execution:{...input.execution,profileHash:'0'.repeat(64)}}];
for(const bad of invalid)assert.throws(()=>validateProductJob(bad));
assert.equal(JSON.parse(readFileSync('scripts/ttrpg-local-tts/runtime-profile.json')).productInvocationAllowed,false);
assert.equal(JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json')).modelInvocationAllowed,false);
assert.equal(JSON.parse(readFileSync('scripts/ttrpg-local-tts/product-profile-v1.json')).version,1);
console.log(JSON.stringify({version:productProfile.version,pinned:productProfile.implementation.sources.length}));`)).toEqual({ version: 2, pinned: 9 })
  })
  it('complete segment planning runs before any model import and preserves all normalized UTF16 text under independent caps', () => {
    const script = `
import importlib.util,json,sys
s=importlib.util.spec_from_file_location('worker','scripts/ttrpg-local-tts/product-worker.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=json.load(open('scripts/ttrpg-local-tts/product-profile.json'))
for text in ['门口的灯还亮着.','中文.'*1000,'文'*4000]:
 rows=m.plan_segments(text,p);assert ''.join(r['text'] for r in rows)==text and len(rows)<=64 and all(r['readingLengthUtf16']<=200 for r in rows)
 assert sum(r['readingLengthUtf16'] for r in rows)==m.utf16(text)
for text in ['文'*4001,'.'*4000,'😀']:
 try:m.plan_segments(text,p);raise AssertionError('must reject')
 except ValueError:pass
assert not any(x in sys.modules for x in ['torch','transformers','melo'])
print(json.dumps({'planned':3,'modelLoaded':False}))`
    expect(JSON.parse(execFileSync('python3', ['-B', '-c', script], { encoding: 'utf8' }))).toEqual({ planned: 3, modelLoaded: false })
  })
  it('historical exact jobs remain inspectable and stoppable after a profile upgrade, but cannot acquire current execution permission', () => {
    expect(node(`import {mkdirSync} from 'node:fs';const runtime=syntheticRuntime(),input=syntheticJob();
input.execution.profile=JSON.parse(readFileSync('scripts/ttrpg-local-tts/product-profile-v1.json','utf8'));
input.execution.profileHash=digest(stable(input.execution.profile));input.inputArtifactHash=digest(stable(input.execution));input.jobKey='ttrpg.voice.1.'+input.inputArtifactHash;
const dir=path.join(runtime,'product-jobs-v2',digest(input.jobKey));mkdirSync(dir,{recursive:true});
writeFileSync(path.join(dir,'input.json'),stable(input));writeFileSync(path.join(dir,'job.json'),stable({jobKey:input.jobKey,inputArtifactHash:input.inputArtifactHash,status:'waiting-for-slot'}));
let calls=0;const jobs=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}});
assert.equal(jobs.get(input.jobKey).profileHash,input.execution.profileHash);assert.equal(jobs.get(input.jobKey).canStart,false);
assert.throws(()=>jobs.start(input.jobKey,input.inputArtifactHash));assert.equal(calls,0);
assert.equal(jobs.cancel(input.jobKey).status,'cancelled-before-start');assert.equal(jobs.get(input.jobKey).cancellationConfirmed,true);
console.log(JSON.stringify({calls,historicalStop:true,runtime}));`).historicalStop).toBe(true)
  })
  it('the orphan watchdog uses monotonic lease deadlines across clock rollback and cannot revive an expired original lease', () => {
    const script = `
import importlib.util,json
s=importlib.util.spec_from_file_location('worker','scripts/ttrpg-local-tts/product-worker.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
mono=[100.];wall=[1000.];m.time.monotonic=lambda:mono[0];m.time.time=lambda:wall[0]
lease=m.OriginalLease('job','hash','nonce',10000)
value={'jobKey':'job','inputArtifactHash':'hash','launchNonce':'nonce','sequence':1,'expiresAt':1010000}
assert lease.valid(value) and lease.deadline==110
mono[0]=105;wall[0]=900;assert lease.valid(value) and lease.deadline==110
mono[0]=111;wall[0]=899;assert not lease.valid(value)
value.update(sequence=2,expiresAt=1000000000);assert not lease.valid(value)
another=m.OriginalLease('job','hash','nonce',10000);mono[0]=120;wall[0]=1500;value.update(sequence=1,expiresAt=1510000)
assert another.valid(value);mono[0]=125;wall[0]=1490;value.update(sequence=2,expiresAt=1500000)
assert another.valid(value) and another.deadline==135
mono[0]=136;assert not another.valid(value)
print(json.dumps({'rollbackBounded':True,'expiredCannotRevive':True}))`
    expect(JSON.parse(execFileSync('python3', ['-B', '-c', script], { encoding: 'utf8' }))).toEqual({ rollbackBounded: true, expiredCannotRevive: true })
  })
  it('an unknown control-directory symlink is preserved without writing a cancellation into its target', () => {
    expect(node(`import {symlinkSync,readdirSync} from 'node:fs';const runtime=syntheticRuntime(),outside=syntheticRuntime(),input=syntheticJob();
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('no inference')}}),before=readdirSync(outside);symlinkSync(outside,path.join(runtime,'product-jobs-v2','cancellations'),'dir');
assert.throws(()=>jobs.cancel(input.jobKey));assert.deepEqual(readdirSync(outside),before);
console.log(JSON.stringify({outsideUnchanged:true,runtime,outside}));`).outsideUnchanged).toBe(true)
  })
  it('creating, polling, duplicate submission and a new service never launch a model; the one durable start is irreversible', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let calls=0,child,dir;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(d){calls++;dir=d;child=fakeChild();return child}});
assert.equal(jobs.create(input).status,'waiting-for-slot');assert.equal(jobs.get(input.jobKey).status,'waiting-for-slot');jobs.create(input);assert.equal(calls,0);
const reloaded=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('reload must not start')}});assert.equal(reloaded.get(input.jobKey).status,'waiting-for-slot');
jobs.start(input.jobKey,input.inputArtifactHash);jobs.start(input.jobKey,input.inputArtifactHash);assert.equal(calls,1);
assert.equal(readFileSync(path.join(dir,'start.json'),'utf8').includes('start-authorized'),true);
writeSyntheticResult(dir,input);child.emit('close',0,null);const raw=jobs.raw(input.jobKey);
assert.equal(raw.workerExecutionKind,'injected-test-worker');assert.equal(raw.candidateAccepted,false);assert.equal(raw.adoptionAllowed,false);
jobs.start(input.jobKey,input.inputArtifactHash);assert.equal(calls,1);assert.equal(jobs.get(input.jobKey).status,'generated');
console.log(JSON.stringify({calls,runtime,rawOnly:true}));`).calls).toBe(1)
  })
  it('cancellation before start wins the same immutable claim and stays confirmed without any later inference', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let calls=0;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}});jobs.create(input);
assert.equal(jobs.cancel(input.jobKey).cancellationConfirmed,true);assert.equal(jobs.get(input.jobKey).status,'cancelled-before-start');
jobs.start(input.jobKey,input.inputArtifactHash);assert.equal(calls,0);assert.equal(jobs.cancel(input.jobKey).cancellationConfirmed,true);
console.log(JSON.stringify({calls,runtime}));`).calls).toBe(0)
  })
  it('a stop received before the job exists persists a barrier, reports no confirmed stop, and prevents a later create/start', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let calls=0;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}});
const stopped=jobs.cancel(input.jobKey);assert.equal(stopped.status,'stop-requested-without-job');assert.equal(stopped.futureStartBlocked,true);assert.equal(stopped.cancellationConfirmed,false);
assert.equal(jobs.get(input.jobKey).futureStartBlocked,true);assert.equal(jobs.create(input).status,'cancelled-before-start');
jobs.start(input.jobKey,input.inputArtifactHash);assert.equal(calls,0);
console.log(JSON.stringify({calls,runtime}));`).calls).toBe(0)
  })
  it('a cross-controller stop after the permanent launch claim but before spawn prevents inference and retains the claim', () => {
    expect(node(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const runtime=fs.realpathSync(syntheticRuntime()),input=syntheticJob();let calls=0,intercepted=false;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}}),other=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('must not launch')}});jobs.create(input);
const rename=fs.renameSync;fs.renameSync=(from,to)=>{rename(from,to);if(String(to).endsWith('/lease.json')&&!intercepted){intercepted=true;other.cancel(input.jobKey)}};syncBuiltinESMExports();
try{assert.equal(jobs.start(input.jobKey,input.inputArtifactHash).status,'cancelled-before-spawn')}
finally{fs.renameSync=rename;syncBuiltinESMExports()}
assert.equal(intercepted,true);assert.equal(calls,0);assert.equal(jobs.get(input.jobKey).cancellationConfirmed,true);
assert.equal(existsSync(path.join(runtime,'.eval.lock')),false);assert.equal(existsSync(path.join(runtime,'product-jobs-v2',digest(input.jobKey),'start.json')),true);
console.log(JSON.stringify({calls,runtime}));`).calls).toBe(0)
  })
  it('complete unknown output is read-only on GET and requires explicit recovery plus actual original owner and worker absence; no exit zero is invented', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let calls=0;const jobs=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}});
const {dir}=unknownComplete(jobs,runtime,input);assert.equal(jobs.get(input.jobKey).status,'unknown');assert.throws(()=>jobs.raw(input.jobKey));
assert.equal(JSON.parse(readFileSync(path.join(dir,'job.json'),'utf8')).terminal,undefined);
const recovered=jobs.recoverRaw(input.jobKey,input.inputArtifactHash);assert.equal(recovered.completionEvidence,'verified-result-worker-absent');
const terminal=JSON.parse(readFileSync(path.join(dir,'job.json'),'utf8')).terminal;assert.equal(terminal.code,undefined);
assert.equal(recovered.candidateAccepted,false);assert.equal(recovered.adoptionAllowed,false);assert.equal(jobs.get(input.jobKey).cancellationConfirmed,false);
assert.deepEqual(jobs.recoverRaw(input.jobKey,input.inputArtifactHash),recovered);jobs.start(input.jobKey,input.inputArtifactHash);assert.equal(calls,0);
console.log(JSON.stringify({calls,runtime}));`).calls).toBe(0)
  })
  it('a stop persisted by another controller cannot be renewed away and is confirmed only after the actual owned child closes', () => {
    expect(node(`for(const renew of [false,true]){const runtime=syntheticRuntime(),input=syntheticJob();let child;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){child=fakeChild();return child}}),other=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('no launch')}});
jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);assert.equal(other.cancel(input.jobKey).cancellationConfirmed,false);
if(renew){assert.throws(()=>jobs.renew(input.jobKey,input.inputArtifactHash));assert.deepEqual(child.signals,['SIGTERM'])}
assert.equal(jobs.get(input.jobKey).cancellationConfirmed,false);child.emit('close',2,null);
assert.equal(jobs.get(input.jobKey).status,'cancelled-confirmed');assert.equal(jobs.get(input.jobKey).cancellationConfirmed,true);
}console.log(JSON.stringify({crossControllerStopPreserved:true}));`)).toEqual({ crossControllerStopPreserved: true })
  })
  it('a live original controller or worker, corrupt complete file, or known failed terminal cannot be replaced by an unknown-result recovery', () => {
    expect(node(`import {execFileSync} from 'node:child_process';const actualStart=execFileSync('ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8',env:{...process.env,LC_ALL:'C'}}).trim();
for(const scenario of ['controller-live','worker-live','corrupt-audio','known-failure']){
const runtime=syntheticRuntime(),input=syntheticJob(),jobs=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('no inference')}}),{dir,claim}=unknownComplete(jobs,runtime,input);
if(scenario==='controller-live'){claim.owner.start=actualStart;writeFileSync(path.join(dir,'start.json'),stable(claim))}
if(scenario==='worker-live'){const f=path.join(dir,'worker-started.json'),v=JSON.parse(readFileSync(f,'utf8'));v.processStart=actualStart;writeFileSync(f,stable(v))}
if(scenario==='corrupt-audio'){const f=path.join(dir,'audio.wav'),v=readFileSync(f);v[100]^=1;writeFileSync(f,v)}
if(scenario==='known-failure'){const f=path.join(dir,'job.json'),v=JSON.parse(readFileSync(f,'utf8'));v.status='failed';v.terminal={kind:'observed-child-close',code:2};writeFileSync(f,stable(v))}
const before=readFileSync(path.join(dir,'job.json'),'utf8');assert.throws(()=>jobs.recoverRaw(input.jobKey,input.inputArtifactHash));assert.equal(readFileSync(path.join(dir,'job.json'),'utf8'),before);
}console.log(JSON.stringify({rejected:4}));`)).toEqual({ rejected: 4 })
  })
  it('an actual process observation error with exit1 cannot be mistaken for an absent original process', () => {
    expect(node(`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';for(const diagnostics of [true,false]){
const runtime=syntheticRuntime(),input=syntheticJob(),jobs=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('no inference')}}),{dir}=unknownComplete(jobs,runtime,input);
const file=path.join(dir,'job.json'),before=readFileSync(file,'utf8'),observe=cp.execFileSync;
cp.execFileSync=(command,args,...rest)=>{if(command==='ps'&&args[0]==='-p'){const error=Error('observation denied');error.status=1;if(diagnostics){error.stdout=Buffer.alloc(0);error.stderr=Buffer.from('ps: observation unavailable')}throw error}return observe(command,args,...rest)};syncBuiltinESMExports();
try{assert.throws(()=>jobs.recoverRaw(input.jobKey,input.inputArtifactHash),/Cannot observe process identity/)}finally{cp.execFileSync=observe;syncBuiltinESMExports()}
assert.equal(readFileSync(file,'utf8'),before);assert.equal(jobs.get(input.jobKey).status,'unknown');}
console.log(JSON.stringify({inspectionFailurePreserved:true}));`).inspectionFailurePreserved).toBe(true)
  })
  it('old V2 implementation output stays readable with its original hashes, while old inputs cannot launch and altered physical budgets are rejected', () => {
    expect(node(`import {mkdirSync} from 'node:fs';const runtime=syntheticRuntime(),input=syntheticJob();input.execution.profile=JSON.parse(readFileSync('scripts/ttrpg-local-tts/product-profile-v2.json','utf8'));
input.execution.profileHash=digest(stable(input.execution.profile));input.inputArtifactHash=digest(stable(input.execution));input.jobKey='ttrpg.voice.1.'+input.inputArtifactHash;
assert.notEqual(input.execution.profileHash,productProfileHash);assert.throws(()=>validateProductJob(input));
const {bytes,result}=syntheticResult(input);verifyProductResult(result,bytes,input);
const changed=structuredClone(input);changed.execution.profile.maxAudioSeconds++;changed.execution.profileHash=digest(stable(changed.execution.profile));assert.throws(()=>verifyProductResult(result,bytes,changed));
const dir=path.join(runtime,'product-jobs-v2',digest(input.jobKey));mkdirSync(dir,{recursive:true});
writeFileSync(path.join(dir,'input.json'),stable(input));writeFileSync(path.join(dir,'start.json'),stable({kind:'start-authorized'}));
writeFileSync(path.join(dir,'job.json'),stable({jobKey:input.jobKey,inputArtifactHash:input.inputArtifactHash,status:'generated',launchNonce:'original-nonce',workerExecutionKind:'injected-test-worker',terminal:{kind:'observed-child-close',code:0,signal:null}}));
writeSyntheticResult(dir,input);const record=readFileSync(path.join(dir,'job.json'),'utf8');
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('historical output must not execute')}}),state=jobs.renew(input.jobKey,input.inputArtifactHash);
assert.equal(state.status,'generated');assert.equal(state.profileHash,input.execution.profileHash);assert.equal(state.canStart,false);
assert.equal(existsSync(path.join(dir,'lease.json')),false);assert.equal(readFileSync(path.join(dir,'job.json'),'utf8'),record);
assert.equal(jobs.raw(input.jobKey).result.profileHash,input.execution.profileHash);
console.log(JSON.stringify({oldOutputReadable:true,oldExecutionDenied:true}));`)).toEqual({ oldOutputReadable: true, oldExecutionDenied: true })
  })
  it('losing the physical slot while its actual eval owner is still writing the lock preserves that owner and releases only the unlaunched product claim', () => {
    expect(node(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const runtime=fs.realpathSync(syntheticRuntime()),input=syntheticJob();let calls=0,intercepted=false;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){calls++;return fakeChild()}});jobs.create(input);
const originalOpen=fs.openSync;fs.openSync=(file,...args)=>{const fd=originalOpen(file,...args);
if(file===path.join(runtime,'.product-voice-worker.lock')&&args[0]==='wx'){intercepted=true;writeFileSync(path.join(runtime,'.eval.lock'),'')}return fd};syncBuiltinESMExports();
try{assert.equal(jobs.start(input.jobKey,input.inputArtifactHash).status,'waiting-for-slot')}
finally{fs.openSync=originalOpen;syncBuiltinESMExports()}
assert.equal(intercepted,true);assert.equal(calls,0);assert.equal(readFileSync(path.join(runtime,'.eval.lock'),'utf8'),'');
assert.equal(existsSync(path.join(runtime,'.product-voice-worker.lock')),false);
console.log(JSON.stringify({foreignPartialLockRetained:true,calls,runtime}));`).foreignPartialLockRetained).toBe(true)
  })
  it('the actual fixed-evaluation launcher and product worker contend for the same exclusive physical slot in both directions', () => {
    expect(node(`import {execFileSync} from 'node:child_process';
const runtime=syntheticRuntime(),input=syntheticJob();let child;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){child=fakeChild();return child}});jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);
const slot=path.join(runtime,'.eval.lock');assert.equal(JSON.parse(readFileSync(slot,'utf8')).kind,'product-voice-physical-slot');
assert.throws(()=>execFileSync(process.execPath,['scripts/ttrpg-local-tts/evaluate.mjs','--runtime-dir',runtime,'--case','narration-zh'],{stdio:'pipe'}));
assert.equal(existsSync(path.join(runtime,'evaluations')),false);child.emit('close',null,'SIGTERM');assert.equal(existsSync(slot),false);
writeFileSync(slot,JSON.stringify({runId:'existing-evaluation',pid:process.pid}));
const second=syntheticJob(2);assert.equal(jobs.create(second).canStart,false);jobs.start(second.jobKey,second.inputArtifactHash);
assert.equal(jobs.get(second.jobKey).status,'waiting-for-slot');assert.equal(JSON.parse(readFileSync(slot,'utf8')).runId,'existing-evaluation');
console.log(JSON.stringify({physicalSlotShared:true,runtime}));`).physicalSlotShared).toBe(true)
  })
  it('a stop request is not confirmed until actual child close, and a late complete output is retained separately', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let child,dir;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(d){dir=d;child=fakeChild();return child}});jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);
let state=jobs.cancel(input.jobKey);assert.equal(state.cancellationRequested,true);assert.equal(state.cancellationConfirmed,false);assert.deepEqual(child.signals,['SIGTERM']);
writeSyntheticResult(dir,input);child.emit('close',0,null);state=jobs.get(input.jobKey);assert.equal(state.status,'generated');assert.equal(state.cancellationConfirmed,false);
assert.equal(jobs.raw(input.jobKey).cancellationRequested,true);console.log(JSON.stringify({lateRetained:true,runtime}));`).lateRetained).toBe(true)
  })
  it('an unobserved launch remains unknown and cannot free capacity or authorize another start from a missing PID/file alone', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let child;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(){child=fakeChild();return child}});jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);
const reload=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('must not restart')}});assert.equal(reload.get(input.jobKey).status,'unknown');
const second=syntheticJob(2);assert.equal(reload.create(second).canStart,false);reload.start(input.jobKey,input.inputArtifactHash);assert.equal(reload.get(input.jobKey).status,'unknown');
child.emit('close',null,'SIGTERM');console.log(JSON.stringify({unknownPreserved:true,runtime}));`).unknownPreserved).toBe(true)
  })
  it('an expired original authorization lease requests stop but keeps physical capacity until the owned child actually closes', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let child,dir;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(d){dir=d;child=fakeChild();return child}});jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);
jobs.renew(input.jobKey,input.inputArtifactHash);assert.equal(JSON.parse(readFileSync(path.join(dir,'lease.json'),'utf8')).sequence,2);
const actualNow=process.hrtime.bigint;process.hrtime.bigint=()=>actualNow()+11000000000n;
try{assert.throws(()=>jobs.renew(input.jobKey,input.inputArtifactHash));await new Promise(ok=>setTimeout(ok,600));assert.deepEqual(child.signals,['SIGTERM']);
const state=jobs.get(input.jobKey);assert.equal(state.cancellationRequested,true);assert.equal(state.cancellationConfirmed,false);
assert.equal(jobs.create(syntheticJob(2)).canStart,false);assert.throws(()=>jobs.renew(input.jobKey,input.inputArtifactHash));
child.emit('close',null,'SIGTERM');assert.equal(jobs.get(input.jobKey).cancellationConfirmed,true);
assert.equal(jobs.get(syntheticJob(2).jobKey).canStart,true);
}finally{process.hrtime.bigint=actualNow}
console.log(JSON.stringify({expiredStop:true,runtime}));`).expiredStop).toBe(true)
  })
  it('stdout and stderr share one diagnostic byte budget and retain exact bounded prefixes before confirmed stop', () => {
    expect(node(`const runtime=syntheticRuntime(),input=syntheticJob();let child,dir;
const jobs=createProductVoiceJobs(runtime,{spawnWorker(d){dir=d;child=fakeChild();return child}});jobs.create(input);jobs.start(input.jobKey,input.inputArtifactHash);
child.stdout.emit('data',Buffer.alloc(40000,65));child.stderr.emit('data',Buffer.alloc(40000,66));assert.deepEqual(child.signals,['SIGTERM']);
const out=readFileSync(path.join(dir,'stdout.log')),err=readFileSync(path.join(dir,'stderr.log'));assert.equal(out.length+err.length,productProfile.maxDiagnosticBytes);
assert.equal(out.equals(Buffer.alloc(out.length,65)),true);assert.equal(err.equals(Buffer.alloc(err.length,66)),true);
assert.equal(jobs.get(input.jobKey).cancellationConfirmed,false);child.emit('close',null,'SIGTERM');assert.equal(jobs.get(input.jobKey).cancellationConfirmed,true);
console.log(JSON.stringify({sharedBudget:out.length+err.length,runtime}));`).sharedBudget).toBe(65536)
  })
  it('rejects forged physical PCM, word timing, partial reading coverage and fabricated usage before returning raw output', () => {
    expect(node(`const input=syntheticJob(),{bytes,result}=syntheticResult(input);verifyProductResult(result,bytes,input);
const patches=[r=>r.audio.samples++,r=>r.audio.durationMs++,r=>r.alignment.wordAlignmentProvided=true,r=>r.alignment.segments[0].readingLengthUtf16--,
r=>r.usage.speechCallsCompleted++,r=>r.metrics.rms=0,r=>r.candidateAccepted=true,r=>r.audio.sampleRate=24000];
for(const patch of patches){const bad=structuredClone(result);patch(bad);assert.throws(()=>verifyProductResult(bad,bytes,input))}
const bad=Buffer.from(bytes);bad[100]^=1;assert.throws(()=>verifyProductResult(result,bad,input));
console.log(JSON.stringify({rejected:patches.length+1}));`)).toEqual({ rejected: 9 })
  })
  it('the actual HTTP bridge denies remote/foreign-origin/ordinary form requests and never starts on create or GET', () => {
    expect(node(`import {createServer} from 'node:http';import {createProductVoiceBridge,allowedProductVoiceRequest,PREFIX} from './scripts/ttrpg-local-tts/product-bridge.mjs';
const runtime=syntheticRuntime(),input=syntheticJob();let calls=0;const bridge=createProductVoiceBridge(runtime,{spawnWorker(){calls++;return fakeChild()}});
const server=createServer((req,res)=>bridge.middleware(req,res,()=>{res.writeHead(404);res.end()}));await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
try{const origin='http://127.0.0.1:'+server.address().port;
assert.equal((await fetch(origin+PREFIX+'/profile')).status,403);
assert.equal((await fetch(origin+PREFIX+'/profile',{headers:{'X-StoryForge-Tts':'1',Origin:'https://foreign.test'}})).status,403);
const headers={'X-StoryForge-Tts':'1','Content-Type':'application/json'};
assert.equal((await fetch(origin+PREFIX+'/jobs',{method:'POST',headers,body:JSON.stringify(input)})).status,200);
const response=await fetch(origin+PREFIX+'/jobs/'+input.jobKey,{headers});assert.equal((await response.json()).status,'waiting-for-slot');assert.equal(calls,0);
}finally{bridge.close();await new Promise(ok=>server.close(ok))}
console.log(JSON.stringify({calls,runtime}));`).calls).toBe(0)
  })
  it('the HTTP stop-before-create and explicit raw-recovery routes preserve exact identities and never launch inference', () => {
    expect(node(`import {createServer} from 'node:http';import {createProductVoiceBridge,PREFIX} from './scripts/ttrpg-local-tts/product-bridge.mjs';
const runtime=syntheticRuntime(),input=syntheticJob();let calls=0;
const manager=createProductVoiceJobs(runtime,{spawnWorker(){throw Error('must not launch')}});unknownComplete(manager,runtime,input);
const bridge=createProductVoiceBridge(runtime,{spawnWorker(){calls++;return fakeChild()}}),server=createServer((req,res)=>bridge.middleware(req,res,()=>{res.writeHead(404);res.end()}));
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
try{const origin='http://127.0.0.1:'+server.address().port,headers={'X-StoryForge-Tts':'1','Content-Type':'application/json'},url=origin+PREFIX+'/jobs/'+input.jobKey;
const bad=await fetch(url+'/recover-raw',{method:'POST',headers,body:JSON.stringify({decision:'guess-success',inputArtifactHash:input.inputArtifactHash})});assert.equal(bad.status,409);
assert.equal((await(await fetch(url,{headers})).json()).status,'unknown');
const recovered=await fetch(url+'/recover-raw',{method:'POST',headers,body:JSON.stringify({decision:'recover-original-complete-raw-without-resending',inputArtifactHash:input.inputArtifactHash})});assert.equal(recovered.status,200);
assert.equal((await recovered.json()).completionEvidence,'verified-result-worker-absent');
const later=syntheticJob(2),stop=await fetch(origin+PREFIX+'/jobs/'+later.jobKey+'/cancel',{method:'POST',headers,body:JSON.stringify({decision:'request-stop-original-local-voice-job'})});
const status=await stop.json();assert.equal(status.futureStartBlocked,true);assert.equal(status.cancellationConfirmed,false);
assert.equal((await(await fetch(origin+PREFIX+'/jobs',{method:'POST',headers,body:JSON.stringify(later)})).json()).status,'cancelled-before-start');
assert.equal(calls,0);
}finally{bridge.close();await new Promise(ok=>server.close(ok))}
console.log(JSON.stringify({calls,runtime}));`).calls).toBe(0)
  })
})
