/** Normal host recovery/rejection and actual native audio lifecycle. Narration,
 * normalization, PCM and declarations are explicit engineering fixtures. */
import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v
const hash=(v:string)=>createHash('sha256').update(v).digest('hex')
async function enter(page:Page,id:number){await page.goto('./play/session/'+id);await page.getByLabel('我的主持席位',{exact:true}).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。',{exact:true}).check();await page.getByRole('button',{name:'确认主持身份并进入',exact:true}).click()
  const panel=page.getByTestId('ttrpg-open-audio-panel');await expect(panel).toBeVisible({timeout:30000});const studio=panel.getByTestId('ttrpg-open-voice-studio');await studio.locator('summary').click();return {panel,studio}}
test('native original review resumes without inference, explicitly rejects one candidate and rereads the same failed original after reload without adopting or regenerating',async({page},info)=>{
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW!=='1','isolated preview only');test.setTimeout(240000)
  let creates=0,starts=0,rawReads=0,previews=0,cancels=0,packet:any,raw=''
  let profile=JSON.parse(readFileSync('scripts/ttrpg-local-tts/product-profile.json','utf8')),profileHash=hash(JSON.stringify(stable(profile)))
  const reading=JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json','utf8'))
  await page.route('**/storyforge/local-tts/v1/**',async route=>{const path=new URL(route.request().url()).pathname,send=(v:any)=>route.fulfill({contentType:'application/json',body:typeof v==='string'?v:JSON.stringify(v)})
    if(path.endsWith('/reading-preview')){previews++;const {input}=route.request().postDataJSON(),normalized=input.text.replaceAll('。','.')
      return send({schema:'storyforge.ttrpg-local-tts-reading-preview',version:1,profileHash:hash(JSON.stringify(stable(reading))),normalizerSha256:reading.normalizerSha256,status:'ready-for-reading-review',sourceText:input.text,sourceTextSha256:hash(input.text),overrides:[],readingText:input.text,normalizedText:normalized,normalizedTextSha256:hash(normalized),issues:[],issueCount:0,issueOffsetsReferTo:'readingText-utf16',modelCalled:false,generationAllowed:false,adoptionAllowed:false,network:'disabled'})}
    if(path.endsWith('/profile')){
      const id=new URL(route.request().url()).searchParams.get('profileId')
      const file=id==='qwen-mlx-uncle_fu-product-v1'?'product-qwen-uncle_fu-v1.json':id==='qwen-mlx-serena-product-v1'?'product-qwen-serena-v1.json':!id||id==='melo-zh-product-v2'?'product-profile.json':null
      if(!file)throw Error('Unknown closed voice profile')
      profile=JSON.parse(readFileSync('scripts/ttrpg-local-tts/'+file,'utf8'));profileHash=hash(JSON.stringify(stable(profile)))
      return send({kind:'local-offline-speech-v1',profileHash,profile})
    }
    if(path.endsWith('/jobs')){creates++;packet=route.request().postDataJSON();return send({jobKey:packet.jobKey,inputArtifactHash:packet.inputArtifactHash,profileHash,status:'waiting-for-slot',canStart:true})}
    if(path.endsWith('/start')){starts++;return send({jobKey:packet.jobKey,inputArtifactHash:packet.inputArtifactHash,profileHash,status:'generated',canStart:false})}
    if(path.endsWith('/raw')){rawReads++;raw=execFileSync(process.execPath,['--input-type=module','-e',`
import{readFileSync}from'node:fs';import{syntheticResult}from'./tests/helpers/local-voice-product-fixture.mjs';import{verifyProductResult}from'./scripts/ttrpg-local-tts/product-contract.mjs';const input=JSON.parse(readFileSync(0,'utf8')),{bytes,result}=syntheticResult(input,8*input.execution.profile.sampleRate);verifyProductResult(result,bytes,input);console.log(JSON.stringify({schema:'storyforge.ttrpg-local-tts-product-raw-response',version:1,result,workerExecutionKind:'pinned-offline-worker',completionEvidence:'observed-child-close',cancellationRequested:false,audio:{encoding:'base64',data:bytes.toString('base64')},candidateAccepted:false,adoptionAllowed:false}));
`],{input:JSON.stringify(packet),encoding:'utf8',maxBuffer:2*1024*1024});return send(raw)}
    if(path.endsWith('/cancel')){cancels++;return send({jobKey:packet.jobKey,inputArtifactHash:packet.inputArtifactHash,profileHash,status:'generated',canStart:false,cancellationConfirmed:false,cancellationRequested:true,futureStartBlocked:true,hasResultFile:true,workerExecutionKind:'pinned-offline-worker',automaticRetryAllowed:false})}
    throw Error('Unexpected disposition fixture request: '+path)
  })
  await page.goto('./');const f=await page.evaluate(async()=>{const load=new Function('p','return import(p)'),s=await(await load('/storyforge/tests/helpers/open-audio-runtime.ts')).setupAudioRuntimeV1(true,'湖畔灯火。'),state=await(await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(s.owner.sessionId);return {owner:s.owner,narrationSourceRef:s.narrationSourceRef,entities:JSON.stringify(state.entities),time:JSON.stringify(state.ttrpg.openRun.worldTime)}})
  let {panel,studio}=await enter(page,f.owner.sessionId)
  await studio.getByLabel('配音原文',{exact:true}).selectOption(JSON.stringify(f.narrationSourceRef));await studio.getByRole('button',{name:'预览本机读法',exact:true}).click()
  await expect(studio.getByLabel('本机归一读法',{exact:true})).toHaveText('湖畔灯火.')
  await studio.getByLabel('确认原文读法与范围',{exact:true}).check();await studio.getByRole('button',{name:'确认并生成本机配音',exact:true}).click()
  await expect(studio.getByRole('heading',{name:'原音频候选待试听',exact:true})).toBeVisible({timeout:30000});await expect(studio.getByRole('button',{name:'停止本次生成',exact:true})).toHaveCount(0)
  await info.attach('voice-disposition-original-raw-response',{body:raw,contentType:'application/json'})
  await studio.getByRole('button',{name:'停止原本机任务',exact:true}).click();await expect(studio.getByRole('button',{name:'继续原审阅',exact:true})).toBeEnabled()
  await studio.getByRole('button',{name:'继续原审阅',exact:true}).click();await expect(studio.getByRole('button',{name:'继续原审阅',exact:true})).toHaveCount(0)
  expect({creates,starts,rawReads,previews,cancels}).toEqual({creates:1,starts:1,rawReads:1,previews:1,cancels:1})
  await panel.getByRole('button',{name:'开启本机音频',exact:true}).click();await studio.getByRole('button',{name:'准备这条候选试听',exact:true}).click()
  const audio=studio.getByLabel('候选配音试听',{exact:true});await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.readyState),{timeout:30000}).toBeGreaterThanOrEqual(1)
  await audio.focus();await audio.press('Space');await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(false)
  const node=await audio.elementHandle();await studio.getByLabel('配音拒绝原因',{exact:true}).fill('音色不适合调查场景')
  await expect(studio.getByRole('button',{name:'拒绝这条配音',exact:true})).toBeDisabled()
  await studio.getByLabel('确认这条原音频的本人试听结果',{exact:true}).check();await studio.getByRole('button',{name:'拒绝这条配音',exact:true}).click()
  await expect(studio.getByRole('heading',{name:'原配音已拒绝',exact:true})).toBeVisible({timeout:30000})
  expect(await node!.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(true);expect(await node!.getAttribute('src')).toBeNull()
  await expect(studio.getByTestId('ttrpg-generated-voice-adoption')).toHaveCount(0);await expect(studio.getByRole('button',{name:'保存本人试听确认',exact:true})).toHaveCount(0)
  await page.reload();({panel,studio}=await enter(page,f.owner.sessionId));await studio.getByLabel('原配音记录',{exact:true}).selectOption({index:1})
  await studio.getByRole('button',{name:'读取拒绝决定',exact:true}).click();await expect(studio.getByTestId('ttrpg-voice-rejection')).toContainText('音色不适合调查场景')
  await expect(studio.getByRole('heading',{name:'原配音已拒绝',exact:true})).toBeVisible();await expect(studio.locator('audio')).toHaveCount(0);await expect(studio.getByTestId('ttrpg-generated-voice-adoption')).toHaveCount(0)
  const proof=await page.evaluate(async({owner})=>{const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),state=await(await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(owner.sessionId),child=(await db.agentRuns.toArray()).find((r:any)=>r.parentRunId!=null),snapshot=await(await load('/storyforge/src/lib/agent/run/event-store.ts')).readInstanceAgentRunV1(owner.scope,child.id),requestKey=state.ttrpg.openRun.voiceRequests[0].requestKey,rejection=await(await load('/storyforge/src/lib/ttrpg/open-audio-service.ts')).readTtrpgOpenVoiceCandidateRejectionV1({...owner,requestKey})
    return {snapshot,rejection,assets:await db.productMediaAssets.count(),audioEvents:(await db.productRuntimeEvents.toArray()).filter((e:any)=>e.type==='ttrpg.audio.cue.applied').length,entities:JSON.stringify(state.entities),time:JSON.stringify(state.ttrpg.openRun.worldTime)}} ,f)
  expect(proof.rejection.complete).toBe(true);expect(proof.snapshot.projection.state).toBe('failed')
  expect(proof.snapshot.events.filter((e:any)=>e.type==='model.requested')).toHaveLength(1);expect(proof.snapshot.events.filter((e:any)=>e.type==='confirmation.recorded')).toHaveLength(1)
  expect(proof.snapshot.events.some((e:any)=>['verification.started','verification.accepted','adoption.started','adoption.committed','runtime.candidate.adopted'].includes(e.type))).toBe(false)
  expect({assets:proof.assets,audioEvents:proof.audioEvents,entities:proof.entities,time:proof.time}).toEqual({assets:0,audioEvents:0,entities:f.entities,time:f.time})
  expect({creates,starts,rawReads,previews,cancels}).toEqual({creates:1,starts:1,rawReads:1,previews:1,cancels:1})
  await info.attach('voice-disposition-native-original-rejection',{body:JSON.stringify(proof),contentType:'application/json'})
  await page.screenshot({path:info.outputPath('native-original-rejection.png')})
})
