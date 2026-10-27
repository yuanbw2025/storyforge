import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'

// Opt-in engineering evidence for the real product API/IndexedDB/HTTP/CPU
// path. This is not normal author UI acceptance or independent listening.
test('real pinned offline speech uses the original registered source and reading without adopting media or changing the game', async ({ page }, info) => {
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1'
    || process.env.STORYFORGE_TTRPG_REAL_VOICE_ACCEPTANCE !== '1'
    || !process.env.STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR, 'explicit isolated real-model acceptance only')
  test.setTimeout(180000)
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await load('/storyforge/tests/helpers/open-voice-execution-runtime.ts')).setupConfirmedVoiceExecutionRuntimeV1()
  })
  const proof = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const api = await load('/storyforge/src/lib/ttrpg/open-audio-service.ts')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const artifacts = await load('/storyforge/src/lib/memory/artifact-store.ts')
    const ledger = await load('/storyforge/src/lib/agent/run/event-store.ts')
    const before = await core.readProductRuntimeState(f.owner.sessionId)
    const generated = await api.generateTtrpgOpenLocalVoiceV1({ ...f.owner, requestKey: f.requestKey, decision: 'generate-this-original-confirmed-local-voice' })
    const { prepared, result } = generated
    const execution = JSON.parse(await artifacts.readAgentRunArtifactExactV1({ projectId: f.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: prepared.inputArtifactHash }))
    const raw = await artifacts.readAgentRunArtifactExactV1({ projectId: f.owner.scope.projectId, artifactKind: 'raw-response', contentHash: result.responseArtifactHash })
    const snapshot = await ledger.readInstanceAgentRunV1(f.owner.scope, result.runId)
    return { before, after: await core.readProductRuntimeState(f.owner.sessionId), generated, raw, snapshot,
      packet: { jobKey: result.jobKey, inputArtifactHash: prepared.inputArtifactHash, execution },
      runs: await db.agentRuns.count(), media: await db.productMediaAssets.count(), desk: await api.readTtrpgOpenVoiceRequestDeskV1(f.owner) }
  }, f)
  // Preserve the exact response and original source/Run evidence, even if a
  // subsequent assertion fails. No audio is relabelled as accepted/listened.
  await info.attach('original-local-voice-raw-response', { body: proof.raw, contentType: 'application/json' })
  await info.attach('original-local-voice-run', { body: JSON.stringify({ ...proof, raw: undefined }, null, 2), contentType: 'application/json' })
  expect(proof.generated.result.status).toBe('raw-response-recorded')
  expect(proof.packet.execution.source.text).toBe('编号001。')
  expect(proof.packet.execution.reading.normalizedText).toBe('编号零零一.')
  expect(proof.after).toEqual(proof.before)
  expect(proof.runs).toBe(2); expect(proof.media).toBe(0)
  expect(proof.snapshot.events.filter((e: any) => e.type === 'model.requested')).toHaveLength(1)
  expect(proof.snapshot.events.filter((e: any) => e.type === 'model.responded')).toHaveLength(1)
  expect(proof.snapshot.events.some((e: any) => ['candidate.persisted', 'verification.accepted', 'writeback.committed'].includes(e.type))).toBe(false)
  const raw = JSON.parse(proof.raw)
  expect(raw.workerExecutionKind).toBe('pinned-offline-worker')
  expect(raw.candidateAccepted).toBe(false); expect(raw.adoptionAllowed).toBe(false)
  expect(raw.result.humanListening).toBe('unproven')
  const physical = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
import {readFileSync} from 'node:fs';import path from 'node:path';
import {validateProductJob,verifyProductResult,digest} from './scripts/ttrpg-local-tts/product-contract.mjs';
const {packet,raw}=JSON.parse(readFileSync(0,'utf8'));validateProductJob(packet);
verifyProductResult(raw.result,Buffer.from(raw.audio.data,'base64'),packet);
const dir=path.join(process.env.STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR,'product-jobs-v2',digest(packet.jobKey));
const job=JSON.parse(readFileSync(path.join(dir,'job.json'),'utf8'));
const started=JSON.parse(readFileSync(path.join(dir,'worker-started.json'),'utf8'));
const calls=readFileSync(path.join(dir,'calls.jsonl'),'utf8').trim().split(String.fromCharCode(10)).map(line=>JSON.parse(line));
if(job.terminal?.kind!=='observed-child-close'||job.terminal.code!==0||started.jobKey!==packet.jobKey
 ||digest(readFileSync(path.join(dir,'audio.wav')))!==raw.result.audio.sha256)throw Error('Missing actual original worker/PCM terminal proof');
console.log(JSON.stringify({job,started,calls,audio:raw.result.audio,usage:raw.result.usage}));
`], { encoding: 'utf8', input: JSON.stringify({ packet: proof.packet, raw }), maxBuffer: 4 * 1024 * 1024 }))
  expect(physical.job.workerExecutionKind).toBe('pinned-offline-worker')
  expect(physical.calls.map((e: any) => e.type)).toEqual(['encoder.requested', 'encoder.returned', 'speech.requested', 'speech.returned'])
  expect(physical.usage).toEqual({ textEncoderCallsStarted: 1, textEncoderCallsCompleted: 1, speechCallsStarted: 1, speechCallsCompleted: 1 })
  await info.attach('actual-original-worker-terminal', { body: JSON.stringify(physical, null, 2), contentType: 'application/json' })
})

// Explicit serial/physical-slot acceptance only. This leaves listening and
// rights unchecked; the retained original WAV can be judged by a real person.
for (const voice of ['melo.zh','qwen.uncle_fu','qwen.serena'] as const) test('real normal host UI generates and manually decodes the selected offline Chinese voice '+voice+' without inferring human acceptance',async({page},info)=>{
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW!=='1'||process.env.STORYFORGE_TTRPG_REAL_VOICE_ACCEPTANCE!=='1'
    ||!process.env.STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR||voice.startsWith('qwen.')&&(!process.env.STORYFORGE_TTRPG_QWEN_TTS_RUNTIME_DIR||process.env.STORYFORGE_TTRPG_REAL_QWEN_ACCEPTANCE!=='1'),'explicit isolated selected-engine real voice acceptance only')
  test.setTimeout(240000)
  await page.goto('./')
  const f=await page.evaluate(async()=>{const load=new Function('p','return import(p)'),s=await(await load('/storyforge/tests/helpers/open-audio-runtime.ts')).setupAudioRuntimeV1(true,'湖畔灯火。'),state=await(await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(s.owner.sessionId);return {owner:s.owner,narrationSourceRef:s.narrationSourceRef,text:s.text,entities:JSON.stringify(state.entities),time:JSON.stringify(state.ttrpg.openRun.worldTime)}})
  await page.goto('./play/session/'+f.owner.sessionId);await page.getByLabel('旁白试听声线',{exact:true}).selectOption(voice);await page.getByLabel('我的主持席位',{exact:true}).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。',{exact:true}).check();await page.getByRole('button',{name:'确认主持身份并进入',exact:true}).click()
  const panel=page.getByTestId('ttrpg-open-audio-panel'),studio=panel.getByTestId('ttrpg-open-voice-studio')
  await expect(panel).toBeVisible({timeout:30000});await studio.locator('summary').click()
  await studio.getByLabel('配音原文',{exact:true}).selectOption(JSON.stringify(f.narrationSourceRef));await studio.getByRole('button',{name:'预览本机读法',exact:true}).click()
  await expect(studio.getByLabel('本机归一读法',{exact:true})).toHaveText('湖畔灯火.')
  await studio.getByLabel('确认原文读法与范围',{exact:true}).check();await studio.getByRole('button',{name:'确认并生成本机配音',exact:true}).click()
  const readProof=()=>page.evaluate(async({owner})=>{const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),core=await load('/storyforge/src/lib/product/runtime-core.ts'),ledger=await load('/storyforge/src/lib/agent/run/event-store.ts'),artifacts=await load('/storyforge/src/lib/memory/artifact-store.ts'),runs=await db.agentRuns.toArray(),child=runs.find((r:any)=>r.parentRunId!=null),snapshot=await ledger.readInstanceAgentRunV1(owner.scope,child.id),response=snapshot.events.find((e:any)=>e.type==='model.responded'),raw=response?await artifacts.readAgentRunArtifactExactV1({projectId:owner.scope.projectId,artifactKind:'raw-response',contentHash:response.payload.outputHash}):null,
    execution=JSON.parse(await artifacts.readAgentRunArtifactExactV1({projectId:owner.scope.projectId,artifactKind:'source-snapshot',contentHash:child.contractHash?JSON.parse(child.contractJson).runtimeBindingHash:''})),state=await core.readProductRuntimeState(owner.sessionId)
    return {raw,snapshot,packet:{jobKey:'ttrpg.voice.'+child.id+'.'+JSON.parse(child.contractJson).runtimeBindingHash,inputArtifactHash:JSON.parse(child.contractJson).runtimeBindingHash,execution},entities:JSON.stringify(state.entities),time:JSON.stringify(state.ttrpg.openRun.worldTime),media:await db.productMediaAssets.count()}
  },f)
  try{await expect(studio.getByTestId('ttrpg-voice-candidate')).toBeVisible({timeout:150000})}
  catch(error){
    // Keep the original durable Run/attempt/raw even when no candidate renders.
    // Reading evidence cannot resend or manufacture a successful UI result.
    try{const failed=await readProof();await info.attach('failed-normal-ui-original-run',{body:JSON.stringify({...failed,raw:undefined}),contentType:'application/json'});
      if(failed.raw)await info.attach('failed-normal-ui-original-raw',{body:failed.raw,contentType:'application/json'})}
    catch(diagnosticError){await info.attach('failed-normal-ui-evidence-read-error',{body:String(diagnosticError),contentType:'text/plain'})}
    throw error
  }
  const proof=await readProof()
  await info.attach('actual-normal-ui-voice-source-run',{body:JSON.stringify({...proof,raw:undefined}),contentType:'application/json'})
  if(proof.raw)await info.attach('actual-normal-ui-voice-raw-response',{body:proof.raw,contentType:'application/json'})
  expect(proof.raw).not.toBeNull();await expect(studio.getByRole('heading',{name:'原音频候选待试听',exact:true})).toBeVisible()
  const raw=JSON.parse(proof.raw!);await info.attach('actual-normal-ui-original-audio',{body:Buffer.from(raw.audio.data,'base64'),contentType:'audio/wav'})
  expect({entities:proof.entities,time:proof.time,media:proof.media}).toEqual({entities:f.entities,time:f.time,media:0})
  expect(proof.snapshot.events.filter((e:any)=>e.type==='model.requested')).toHaveLength(1);expect(proof.snapshot.events.filter((e:any)=>e.type==='model.responded')).toHaveLength(1)
  expect(proof.snapshot.events.some((e:any)=>['confirmation.recorded','verification.accepted','adoption.committed','runtime.candidate.adopted'].includes(e.type))).toBe(false)
  await panel.getByRole('button',{name:'开启本机音频',exact:true}).click();await studio.getByRole('button',{name:'准备这条候选试听',exact:true}).click()
  const audio=studio.getByLabel('候选配音试听',{exact:true});await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.readyState),{timeout:30000}).toBeGreaterThanOrEqual(1)
  expect(await audio.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(true);await audio.focus();await audio.press('Space');await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(false)
  await expect(studio.getByLabel('确认这条原音频的本人试听结果',{exact:true})).not.toBeChecked();await expect(studio.getByRole('button',{name:'保存本人试听确认',exact:true})).toBeDisabled()
  await page.screenshot({path:info.outputPath('actual-normal-ui-voice-candidate.png')})
  const physical=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`
import{readFileSync}from'node:fs';import path from'node:path';import{validateProductJob,verifyProductResult,digest}from'./scripts/ttrpg-local-tts/product-contract.mjs';const{packet,raw}=JSON.parse(readFileSync(0,'utf8'));validateProductJob(packet);verifyProductResult(raw.result,Buffer.from(raw.audio.data,'base64'),packet);
const dir=path.join(process.env.STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR,'product-jobs-v2',digest(packet.jobKey)),job=JSON.parse(readFileSync(path.join(dir,'job.json'),'utf8')),started=JSON.parse(readFileSync(path.join(dir,'worker-started.json'),'utf8')),calls=readFileSync(path.join(dir,'calls.jsonl'),'utf8').trim().split(String.fromCharCode(10)).map(line=>JSON.parse(line));if(job.terminal?.kind!=='observed-child-close'||job.terminal.code!==0||started.jobKey!==packet.jobKey||digest(readFileSync(path.join(dir,'audio.wav')))!==raw.result.audio.sha256)throw Error('Missing actual native UI original worker terminal');console.log(JSON.stringify({job,started,calls,audio:raw.result.audio,usage:raw.result.usage,humanListening:'unproven'}));
`],{encoding:'utf8',input:JSON.stringify({packet:proof.packet,raw}),maxBuffer:4*1024*1024}))
  expect(physical.calls.map((e:any)=>e.type)).toEqual(voice.startsWith('qwen.')?['speech.requested','speech.returned']:['encoder.requested','encoder.returned','speech.requested','speech.returned'])
  expect(physical.usage).toEqual({textEncoderCallsStarted:voice.startsWith('qwen.')?0:1,textEncoderCallsCompleted:voice.startsWith('qwen.')?0:1,speechCallsStarted:1,speechCallsCompleted:1})
  expect(proof.packet.execution.profile.speaker).toBe(voice==='melo.zh'?'ZH':voice.slice(5))
  expect(physical.audio.sampleRate).toBe(voice==='melo.zh'?44100:24000)
  if(voice.startsWith('qwen.')){
    expect(raw.result.native.speaker).toBe(voice.slice(5));expect(raw.result.native.peakMetalBytes).toBeLessThanOrEqual(6442450944)
    expect(raw.result.native.segments).toHaveLength(1);expect(raw.result.native.segments[0].eosObserved).toBe(true)
    expect(raw.result.audio.samples).toBe(raw.result.native.segments[0].codecTokens*1920)
    await info.attach('actual-qwen-native-resource-clock',{body:JSON.stringify(raw.result.native),contentType:'application/json'})
  }
  await info.attach('actual-normal-ui-original-worker-terminal',{body:JSON.stringify(physical),contentType:'application/json'})
})
