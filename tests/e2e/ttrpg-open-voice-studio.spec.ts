/** Normal host controls + real native WAV decoder/transport in isolated IDB.
 * Source production, CPU reading and speech bytes are engineering fixtures;
 * this does not prove real provider or independent human listening quality. */
import { test,expect,type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

test.beforeEach(()=>test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW!=='1','isolated open preview only'))
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v
const hash=(v:string)=>createHash('sha256').update(v).digest('hex')
async function enter(page:Page,id:number){await page.goto('./play/session/'+id);await page.getByLabel('我的主持席位',{exact:true}).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。',{exact:true}).check();await page.getByRole('button',{name:'确认主持身份并进入',exact:true}).click()
  const panel=page.getByTestId('ttrpg-open-audio-panel');await expect(panel).toBeVisible({timeout:30000});const studio=panel.getByTestId('ttrpg-open-voice-studio');await studio.locator('summary').click();return {panel,studio}}
test('native original source/reading/generation/review reaches a manual decoded audition, survives reload without resend and releases on identity handoff',async({page})=>{
  test.setTimeout(240000);let starts=0,creates=0,previews=0,rawReads=0,packet:any
  let profile=JSON.parse(readFileSync('scripts/ttrpg-local-tts/product-profile.json','utf8')),profileHash=hash(JSON.stringify(stable(profile)))
  const reading=JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json','utf8'))
  await page.route('**/storyforge/local-tts/v1/**',async route=>{const path=new URL(route.request().url()).pathname,send=(value:any)=>route.fulfill({contentType:'application/json',body:typeof value==='string'?value:JSON.stringify(value)})
    if(path.endsWith('/reading-preview')){previews++;const {input,decision}=route.request().postDataJSON();expect(decision).toBe('preview-this-original-voice-reading');const normalized=input.text.replaceAll('。','.').replaceAll('1000','一千')
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
    if(path.endsWith('/raw')){rawReads++;const content=execFileSync(process.execPath,['--input-type=module','-e',`
import{readFileSync}from'node:fs';import{syntheticResult}from'./tests/helpers/local-voice-product-fixture.mjs';const packet=JSON.parse(readFileSync(0,'utf8')),{bytes,result}=syntheticResult(packet,8*packet.execution.profile.sampleRate);
console.log(JSON.stringify({schema:'storyforge.ttrpg-local-tts-product-raw-response',version:1,result,workerExecutionKind:'pinned-offline-worker',completionEvidence:'observed-child-close',cancellationRequested:false,audio:{encoding:'base64',data:bytes.toString('base64')},candidateAccepted:false,adoptionAllowed:false}));
`],{input:JSON.stringify(packet),encoding:'utf8',maxBuffer:2*1024*1024});return send(content)}
    throw Error('Unexpected native voice request: '+path)
  })
  await page.goto('./');const f=await page.evaluate(async()=>{const load=new Function('p','return import(p)'),partText='编号1000。',prefix='前段。'.repeat(700),source=prefix+partText+'后段。'.repeat(20),s=await (await load('/storyforge/tests/helpers/open-audio-runtime.ts')).setupAudioRuntimeV1(true,source),state=await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(s.owner.sessionId)
    return {owner:s.owner,text:s.text,partText,partOffset:prefix.length,narrationSourceRef:s.narrationSourceRef,entities:JSON.stringify(state.entities),time:JSON.stringify(state.ttrpg.openRun.worldTime)}})
  const {panel,studio}=await enter(page,f.owner.sessionId)
  await studio.getByLabel('配音原文',{exact:true}).selectOption(JSON.stringify(f.narrationSourceRef));await studio.getByRole('button',{name:'预览本机读法',exact:true}).click()
  const full=studio.getByLabel('配音完整原文',{exact:true});await expect(full).toHaveValue(f.text)
  expect(f.text.length).toBeGreaterThan(2000);expect(previews).toBe(0);await expect(studio.getByLabel('确认原文读法与范围',{exact:true})).toHaveCount(0)
  await full.evaluate((el:HTMLTextAreaElement,{offset,length})=>el.setSelectionRange(offset,offset+length),{offset:f.partOffset,length:f.partText.length})
  await studio.getByRole('button',{name:'使用选中的原文片段',exact:true}).click();await expect(studio.getByLabel('本次朗读片段',{exact:true})).toHaveValue(f.partText)
  await studio.getByRole('button',{name:'预览本机读法',exact:true}).click();await expect(studio.getByLabel('本机归一读法',{exact:true})).toHaveText('编号一千.')
  await expect(studio.getByRole('button',{name:'确认并生成本机配音',exact:true})).toBeDisabled()
  await studio.getByLabel('确认原文读法与范围',{exact:true}).check();await studio.getByRole('button',{name:'确认并生成本机配音',exact:true}).click()
  await expect(studio.getByTestId('ttrpg-voice-candidate')).toBeVisible({timeout:30000});await expect(studio.getByRole('button',{name:'停止本次生成',exact:true})).toHaveCount(0)
  expect({starts,creates,previews,rawReads}).toEqual({starts:1,creates:1,previews:1,rawReads:1});await expect(studio.getByRole('button',{name:'准备这条候选试听',exact:true})).toBeDisabled()
  await panel.getByRole('button',{name:'开启本机音频',exact:true}).click();await studio.getByRole('button',{name:'准备这条候选试听',exact:true}).click()
  await page.getByLabel('旁白语速',{exact:true}).selectOption('0.85')
  const audio=studio.getByLabel('候选配音试听',{exact:true});await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.readyState),{timeout:30000}).toBeGreaterThanOrEqual(1)
  expect(await audio.evaluate((el:HTMLAudioElement)=>({rate:el.playbackRate,pitch:el.preservesPitch}))).toEqual({rate:0.85,pitch:true})
  expect(await audio.evaluate((el:HTMLAudioElement)=>({duration:el.duration,paused:el.paused,autoplay:el.autoplay}))).toEqual({duration:8,paused:true,autoplay:false})
  await audio.focus();await audio.press('Space');await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(false)
  await expect(studio.getByLabel('试听原文',{exact:true})).toHaveText(f.text);await expect(studio.getByLabel('本次配音原文范围',{exact:true})).toHaveText(f.partText)
  await audio.evaluate((el:HTMLAudioElement)=>{el.currentTime=3});await expect(studio.getByLabel('试听读法',{exact:true}).locator('mark')).toHaveText('编号一千.')
  const old=await audio.elementHandle()
  // A genuine parent progress update used to unmount the original studio/audio.
  const conversation=page.getByTestId('ttrpg-open-table-conversation')
  await conversation.locator('summary').click();await conversation.getByLabel('讨论内容',{exact:true}).fill('先核对原配音，再继续冒险。')
  await conversation.getByRole('button',{name:'发送讨论',exact:true}).click()
  await expect(conversation.getByLabel('当前身份可见的本桌讨论',{exact:true})).toContainText('先核对原配音，再继续冒险。')
  await expect(studio.getByTestId('ttrpg-voice-candidate')).toBeVisible();await expect(audio).toBeVisible()
  expect(await old!.evaluate(el=>el.isConnected&&el.getAttribute('src')!==null)).toBe(true)
  await studio.getByRole('button',{name:'读取配音记录',exact:true}).click();expect(starts).toBe(1)
  await panel.getByRole('button',{name:'本机静音',exact:true}).click();expect(await old!.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(true);expect(await old!.getAttribute('src')).toBeNull();await expect(audio).toHaveCount(0)
  await page.reload();const again=await enter(page,f.owner.sessionId);await expect(again.studio.locator('audio')).toHaveCount(0)
  const requests=again.studio.getByLabel('原配音记录',{exact:true});await expect(requests.locator('option')).toHaveCount(2);await requests.selectOption({index:1})
  await again.studio.getByRole('button',{name:'核对原音频候选',exact:true}).click();await expect(again.studio.getByTestId('ttrpg-voice-candidate')).toBeVisible()
  await again.panel.getByRole('button',{name:'开启本机音频',exact:true}).click();await again.studio.getByRole('button',{name:'准备这条候选试听',exact:true}).click()
  const retained=again.studio.getByLabel('候选配音试听',{exact:true});await expect(retained).toHaveCount(1);const retainedNode=await retained.elementHandle()
  await expect(again.studio.getByRole('button',{name:'保存本人试听确认',exact:true})).toBeDisabled()
  await retained.focus();await retained.press('Space');await expect.poll(()=>retained.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(false)
  await again.studio.getByLabel('确认这条原音频的本人试听结果',{exact:true}).check()
  await again.studio.getByRole('button',{name:'保存本人试听确认',exact:true}).click()
  await expect(again.studio.getByRole('heading',{name:'本人审阅已保存',exact:true})).toBeVisible({timeout:30000})
  await expect(retained).toHaveCount(0)
  const originalReview=await page.evaluate(async({owner})=>{
    const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),api=await load('/storyforge/src/lib/ttrpg/open-audio-service.ts')
    const state=await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(owner.sessionId),requestKey=state.ttrpg.openRun.voiceRequests[0].requestKey
    const candidate=(await api.readTtrpgOpenVoiceCandidateV1({...owner,requestKey})).candidate,review=await api.readTtrpgOpenVoiceCandidateReviewV1({...owner,requestKey,candidateHash:candidate.candidateHash})
    const verification=await (await load('/storyforge/src/lib/memory/artifact-store.ts')).readAgentRunArtifactExactV1({projectId:owner.scope.projectId,artifactKind:'source-snapshot',contentHash:review.verificationArtifactHash})
    return {review,verification,media:await db.productMediaAssets.count(),audio:state.ttrpg.openRun.audioReceipts?.length??0,adoptions:(await db.agentRunEvents.toArray()).filter((e:any)=>['adoption.committed','runtime.candidate.adopted'].includes(e.type)).length}
  },f)
  expect(originalReview.review).toMatchObject({complete:true,runState:'completed',generationAllowed:false,adoptionAllowed:false,independentListening:'unproven'})
  expect({media:originalReview.media,audio:originalReview.audio,adoptions:originalReview.adoptions}).toEqual({media:0,audio:0,adoptions:0})
  await test.info().attach('original-voice-generation-review',{body:Buffer.from(JSON.stringify(originalReview)),contentType:'application/json'})
  await page.getByRole('button',{name:'返回身份选择',exact:true}).click();expect(await retainedNode!.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(true);expect(await retainedNode!.getAttribute('src')).toBeNull()
  const evidence=await page.evaluate(async({owner})=>{const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),state=await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(owner.sessionId)
    const request=state.ttrpg.openRun.voiceRequests[0]
    return {entities:JSON.stringify(state.entities),time:JSON.stringify(state.ttrpg.openRun.worldTime),audio:state.ttrpg.openRun.audioReceipts?.length??0,requests:state.ttrpg.openRun.voiceRequests.length,source:request.script.text,part:{offset:request.part.textOffset,length:request.part.textLength},reading:request.reading.normalizedText,assets:await db.productMediaAssets.count(),models:(await db.agentRunEvents.toArray()).filter((e:any)=>e.type==='model.requested').length}},f)
  expect(evidence).toEqual({entities:f.entities,time:f.time,audio:0,requests:1,source:f.text,part:{offset:f.partOffset,length:f.partText.length},reading:'编号一千.',assets:0,models:1});expect({starts,creates,previews,rawReads}).toEqual({starts:1,creates:1,previews:1,rawReads:1})
  // Additional engineering API/lifecycle proof after the normal UI path. This
  // imports a clearly unadopted fixture file solely to own the evidence roots;
  // it is not a human listening/rights declaration or a generated E16 cue.
  const archive=await page.evaluate(async({owner})=>{
    const load=new Function('p','return import(p)'),api=await load('/storyforge/src/lib/ttrpg/open-audio-service.ts'),{db}=await load('/storyforge/src/lib/db/schema.ts')
    const core=await load('/storyforge/src/lib/product/runtime-core.ts'),state=await core.readProductRuntimeState(owner.sessionId),requestKey=state.ttrpg.openRun.voiceRequests[0].requestKey
    const original={...owner,requestKey},candidate=(await api.readTtrpgOpenVoiceCandidateV1(original)).candidate
    const saved=await api.freezeTtrpgOpenVoiceSourceEvidenceV1({...original,candidateHash:candidate.candidateHash,decision:'freeze-this-original-voice-source-evidence'})
    const completed=await api.captureTtrpgOpenVoiceCompletionV1({...original,candidateHash:candidate.candidateHash})
    const bytes=await (await load('/storyforge/src/lib/ttrpg/open-voice-candidate.ts')).readTtrpgOpenVoiceAuditionBasisForKernelV1({...original,candidateHash:candidate.candidateHash})
    await (await load('/storyforge/src/lib/product/runtime-media-library.ts')).importProductRuntimeMediaAssetV1({scope:owner.scope,productRuntimeSessionId:owner.sessionId,assetKey:'native.voice.capsule.fixture',kind:'voice',name:'Unadopted capsule fixture',blob:new Blob([bytes.data],{type:'audio/wav'}),source:'Synthetic browser lifecycle fixture',license:'Fixture only; no listening, rights or E16 acceptance',durationMs:saved.audio.durationMs,exactArtifactRefs:completed.artifactRefs})
    const parent=(await db.agentRuns.get(candidate.runId)).parentRunId,{deleteAgentRunV1}=await load('/storyforge/src/lib/agent/run/event-store.ts')
    await deleteAgentRunV1(owner.scope,candidate.runId);await deleteAgentRunV1(owner.scope,parent)
    const input={projectId:owner.scope.projectId,evidenceArtifactHash:saved.evidenceArtifactHash,candidateHash:candidate.candidateHash,requestKey,sessionKey:state.ttrpg.sessionKey,runtimeSourceHash:(await db.productRuntimeSessions.get(owner.sessionId)).runtimeSourceHash}
    const {readTtrpgOpenVoiceSourceEvidenceForKernelV1}=await load('/storyforge/src/lib/ttrpg/open-voice-source-evidence.ts'),before=await readTtrpgOpenVoiceSourceEvidenceForKernelV1(input)
    const {exportProjectJSON,importProjectJSON}=await load('/storyforge/src/lib/export/json-export.ts'),copy=await importProjectJSON(await exportProjectJSON(owner.scope.projectId)),after=await readTtrpgOpenVoiceSourceEvidenceForKernelV1({...input,projectId:copy})
    const {readTtrpgOpenVoiceCompletionForKernelV1}=await load('/storyforge/src/lib/ttrpg/open-voice-completion-evidence.ts')
    const completedInput={projectId:owner.scope.projectId,requestKey,sessionKey:input.sessionKey,runtimeSourceHash:input.runtimeSourceHash,completion:completed.completion}
    const completionBefore=await readTtrpgOpenVoiceCompletionForKernelV1(completedInput),completionAfter=await readTtrpgOpenVoiceCompletionForKernelV1({...completedInput,projectId:copy})
    const capsule=await (await load('/storyforge/src/lib/memory/artifact-store.ts')).readAgentRunArtifactExactV1({projectId:copy,artifactKind:'source-snapshot',contentHash:saved.evidenceArtifactHash})
    return {sameArchive:JSON.stringify(before)===JSON.stringify(after),archiveOnly:after.archiveOnly,generationAllowed:after.generationAllowed,adoptionAllowed:after.adoptionAllowed,humanListening:after.humanListening,physicalAudioRechecked:after.physicalAudioRechecked,
      audioReceipts:(await core.readProductRuntimeState(owner.sessionId)).ttrpg.openRun.audioReceipts?.length??0,visibleTracks:(await api.readTtrpgOpenAudioDeskV1(owner)).tracks.length,
      originalRunsGone:!(await db.agentRuns.get(candidate.runId))&&!(await db.agentRuns.get(parent)),originalAssets:await db.productMediaAssets.where('projectId').equals(owner.scope.projectId).count(),importedAssets:await db.productMediaAssets.where('projectId').equals(copy).count(),capsule,
      completionSame:JSON.stringify(completed)===JSON.stringify(completionBefore)&&JSON.stringify(completionBefore)===JSON.stringify(completionAfter),completion:completionAfter}
  },f)
  const {capsule,completion,...archiveSummary}=archive
  expect(archiveSummary).toEqual({sameArchive:true,archiveOnly:true,generationAllowed:false,adoptionAllowed:false,humanListening:'unproven',physicalAudioRechecked:false,audioReceipts:0,visibleTracks:0,originalRunsGone:true,originalAssets:1,importedAssets:1,completionSame:true})
  expect(completion).toMatchObject({archiveOnly:true,generationAllowed:false,adoptionAllowed:false,independentListening:'unproven',physicalAudioRechecked:false,runtimePostStateReplayed:false})
  expect(completion.completion.receiptHash).toBe(originalReview.review.receiptHash)
  await test.info().attach('original-voice-source-capsule',{body:Buffer.from(capsule),contentType:'application/json'})
  await test.info().attach('original-voice-generation-completion',{body:Buffer.from(JSON.stringify(completion)),contentType:'application/json'})
  expect({starts,creates,previews,rawReads}).toEqual({starts:1,creates:1,previews:1,rawReads:1})
})
