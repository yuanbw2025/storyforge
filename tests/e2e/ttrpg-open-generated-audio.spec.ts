/** Normal UI adoption and native IndexedDB/WAV/lifecycle. Source narration,
 * speech PCM and automated declarations are explicit engineering fixtures. */
import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v
const digest=(v:string)=>createHash('sha256').update(v).digest('hex')
async function enter(page:Page,id:number){await page.goto('./play/session/'+id);await page.getByLabel('我的主持席位',{exact:true}).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。',{exact:true}).check();await page.getByRole('button',{name:'确认主持身份并进入',exact:true}).click()
  const panel=page.getByTestId('ttrpg-open-audio-panel');await expect(panel).toBeVisible({timeout:30000});return panel}
test('native generated audio requires independent rights and final confirmation, then survives original Run and parent deletion, branch and backup without regenerating',async({page},info)=>{
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW!=='1','isolated open preview only');test.setTimeout(300000)
  let starts=0,creates=0,previews=0,rawReads=0,packet:any,raw=''
  const profile=JSON.parse(readFileSync('scripts/ttrpg-local-tts/product-profile.json','utf8')),profileHash=digest(JSON.stringify(stable(profile))),reading=JSON.parse(readFileSync('scripts/ttrpg-local-tts/reading-profile.json','utf8'))
  await page.route('**/storyforge/local-tts/v1/**',async route=>{const path=new URL(route.request().url()).pathname,send=(v:any)=>route.fulfill({contentType:'application/json',body:typeof v==='string'?v:JSON.stringify(v)})
    if(path.endsWith('/reading-preview')){previews++;const {input}=route.request().postDataJSON(),normalized=input.text.replaceAll('。','.').replaceAll('1000','一千');return send({schema:'storyforge.ttrpg-local-tts-reading-preview',version:1,profileHash:digest(JSON.stringify(stable(reading))),normalizerSha256:reading.normalizerSha256,status:'ready-for-reading-review',sourceText:input.text,sourceTextSha256:digest(input.text),overrides:[],readingText:input.text,normalizedText:normalized,normalizedTextSha256:digest(normalized),issues:[],issueCount:0,issueOffsetsReferTo:'readingText-utf16',modelCalled:false,generationAllowed:false,adoptionAllowed:false,network:'disabled'})}
    if(path.endsWith('/profile'))return send({kind:'local-offline-speech-v1',profileHash,profile})
    if(path.endsWith('/jobs')){creates++;packet=route.request().postDataJSON();return send({jobKey:packet.jobKey,inputArtifactHash:packet.inputArtifactHash,profileHash,status:'waiting-for-slot',canStart:true})}
    if(path.endsWith('/start')){starts++;return send({jobKey:packet.jobKey,inputArtifactHash:packet.inputArtifactHash,profileHash,status:'generated',canStart:false})}
    if(path.endsWith('/raw')){rawReads++;raw=execFileSync(process.execPath,['--input-type=module','-e',`
import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{syntheticResult}from'./tests/helpers/local-voice-product-fixture.mjs';import{verifyProductResult}from'./scripts/ttrpg-local-tts/product-contract.mjs';const input=JSON.parse(readFileSync(0,'utf8')),{bytes,result}=syntheticResult(input,8*44100),text=input.execution.reading.normalizedText,half=Math.floor(text.length/2),samples=result.audio.samples;
result.alignment.segments=[{index:0,readingOffsetUtf16:0,readingLengthUtf16:half,sampleOffset:0,sampleCount:samples/2,gain:1},{index:1,readingOffsetUtf16:half,readingLengthUtf16:text.length-half,sampleOffset:samples/2,sampleCount:samples/2,gain:1}].map(row=>({...row,textSha256:createHash('sha256').update(text.slice(row.readingOffsetUtf16,row.readingOffsetUtf16+row.readingLengthUtf16)).digest('hex')}));
result.usage={textEncoderCallsStarted:2,textEncoderCallsCompleted:2,speechCallsStarted:2,speechCallsCompleted:2};
verifyProductResult(result,bytes,input);
console.log(JSON.stringify({schema:'storyforge.ttrpg-local-tts-product-raw-response',version:1,result,workerExecutionKind:'pinned-offline-worker',completionEvidence:'observed-child-close',cancellationRequested:false,audio:{encoding:'base64',data:bytes.toString('base64')},candidateAccepted:false,adoptionAllowed:false}));
`],{input:JSON.stringify(packet),encoding:'utf8',maxBuffer:2*1024*1024});return send(raw)}
    throw Error('Unexpected native generated-audio fixture request: '+path)
  })
  await page.goto('./');const f=await page.evaluate(async()=>{const load=new Function('p','return import(p)'),s=await(await load('/storyforge/tests/helpers/open-audio-runtime.ts')).setupAudioRuntimeV1(true,'编号1000。'.repeat(42)),state=await(await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(s.owner.sessionId);return {owner:s.owner,text:s.text,narrationSourceRef:s.narrationSourceRef,entities:JSON.stringify(state.entities),time:JSON.stringify(state.ttrpg.openRun.worldTime)}})
  let panel=await enter(page,f.owner.sessionId)
  // This raw/WAV fixture exercises the retained Melo worker protocol. Choose
  // that voice explicitly; the product's Qwen default remains independently tested.
  const narrator=page.getByTestId('ttrpg-narration-listening-settings').getByLabel('旁白试听声线',{exact:true})
  await expect(narrator).toHaveValue('qwen.uncle_fu');await narrator.selectOption('melo.zh')
  let studio=panel.getByTestId('ttrpg-open-voice-studio');await studio.locator('summary').click()
  await studio.getByLabel('配音原文',{exact:true}).selectOption(JSON.stringify(f.narrationSourceRef));await studio.getByRole('button',{name:'预览本机读法',exact:true}).click()
  await expect(studio.getByLabel('本机归一读法',{exact:true})).toHaveText(f.text.replaceAll('。','.').replaceAll('1000','一千'))
  await studio.getByLabel('确认原文读法与范围',{exact:true}).check();await studio.getByRole('button',{name:'确认并生成本机配音',exact:true}).click()
  await expect(studio.getByTestId('ttrpg-voice-candidate')).toBeVisible({timeout:30000})
  await info.attach('generated-audio-original-raw-response',{body:raw,contentType:'application/json'})
  await expect(studio.getByRole('heading',{name:'原音频候选待试听',exact:true})).toBeVisible()
  await panel.getByRole('button',{name:'开启本机音频',exact:true}).click();await studio.getByRole('button',{name:'准备这条候选试听',exact:true}).click()
  const audition=studio.getByLabel('候选配音试听',{exact:true});await expect.poll(()=>audition.evaluate((el:HTMLAudioElement)=>el.readyState),{timeout:30000}).toBeGreaterThanOrEqual(1)
  await audition.focus();await audition.press('Space');await expect.poll(()=>audition.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(false)
  await studio.getByLabel('确认这条原音频的本人试听结果',{exact:true}).check();await studio.getByRole('button',{name:'保存本人试听确认',exact:true}).click()
  await expect(studio.getByRole('heading',{name:'本人审阅已保存',exact:true})).toBeVisible({timeout:30000})
  let use=studio.getByTestId('ttrpg-generated-voice-adoption')
  await expect(use.getByRole('button',{name:'核对配音文件与使用范围',exact:true})).toBeDisabled()
  await use.getByLabel('生成配音音轨名称',{exact:true}).fill('调查现场配音');await use.getByLabel('生成配音来源说明',{exact:true}).fill('原叙述的合成PCM工程fixture');await use.getByLabel('生成配音许可说明',{exact:true}).fill('仅隔离工程验证，不作为真人质量或使用权验收')
  await use.getByLabel('确认生成配音使用权',{exact:true}).check();await use.getByRole('button',{name:'核对配音文件与使用范围',exact:true}).click()
  await expect(use.getByTestId('ttrpg-generated-audio-review')).toBeVisible({timeout:30000})
  const pending=await page.evaluate(async()=>{const {db}=await(new Function('p','return import(p)'))('/storyforge/src/lib/db/schema.ts');return {assets:await db.productMediaAssets.count(),events:(await db.productRuntimeEvents.toArray()).filter((e:any)=>e.type==='ttrpg.audio.cue.applied').length}})
  expect(pending).toEqual({assets:1,events:0})
  // A real reload loses the local grant and rights checkbox, but retains the
  // prepared file. Reopen it explicitly before the actual final button.
  await page.reload();panel=await enter(page,f.owner.sessionId);studio=panel.getByTestId('ttrpg-open-voice-studio');await studio.locator('summary').click()
  await studio.getByLabel('原配音记录',{exact:true}).selectOption({index:1});await studio.getByRole('button',{name:'核对原音频候选',exact:true}).click()
  use=studio.getByTestId('ttrpg-generated-voice-adoption');await use.getByRole('button',{name:'读取已准备文件',exact:true}).click();await use.getByRole('button',{name:'重新核对：调查现场配音',exact:true}).click()
  await expect(use.getByLabel('确认生成配音使用权',{exact:true})).not.toBeChecked();await expect(use.getByRole('button',{name:'确认加入本局音轨',exact:true})).toHaveCount(0)
  await use.getByLabel('确认生成配音使用权',{exact:true}).check();await use.getByRole('button',{name:'核对配音文件与使用范围',exact:true}).click();await expect(use.getByTestId('ttrpg-generated-audio-review')).toBeVisible({timeout:30000})
  await use.getByRole('button',{name:'确认加入本局音轨',exact:true}).click();await expect(use.getByRole('heading',{name:'已加入本局音轨',exact:true})).toBeVisible({timeout:30000})
  const accepted=await page.evaluate(async({owner})=>{const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),state=await(await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(owner.sessionId),receipt=state.ttrpg.openRun.audioReceipts[0];return {receipt,entities:JSON.stringify(state.entities),time:JSON.stringify(state.ttrpg.openRun.worldTime),assets:await db.productMediaAssets.count(),modelDispatches:(await db.agentRunEvents.toArray()).filter((e:any)=>e.type==='model.requested').length}},f)
  await info.attach('generated-audio-observed-first-acceptance',{body:JSON.stringify(accepted),contentType:'application/json'})
  expect({entities:accepted.entities,time:accepted.time,assets:accepted.assets,modelDispatches:accepted.modelDispatches}).toEqual({entities:f.entities,time:f.time,assets:1,modelDispatches:1})
  expect(accepted.receipt.version).toBe(2);expect(accepted.receipt.request.voiceTimeline).toBeNull();expect(accepted.receipt.generated.timeline.clock.segments.length).toBeGreaterThan(1)
  await panel.getByRole('button',{name:'开启本机音频',exact:true}).click()
  let audio=panel.getByLabel('配音播放',{exact:true});await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.readyState),{timeout:30000}).toBeGreaterThanOrEqual(1)
  expect(await audio.evaluate((el:HTMLAudioElement)=>({paused:el.paused,autoplay:el.autoplay,duration:el.duration}))).toEqual({paused:true,autoplay:false,duration:8})
  await audio.focus();await audio.press('Space');await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(false)
  const timeline=accepted.receipt.generated.timeline,segment=timeline.clock.segments[1]
  await audio.evaluate((el:HTMLAudioElement,seconds:number)=>{el.currentTime=seconds},segment.sampleOffset/timeline.clock.sampleRate+0.01)
  await expect(panel.getByLabel('音轨实际读法',{exact:true}).locator('mark')).toHaveText(timeline.normalizedText.slice(segment.readingOffsetUtf16,segment.readingOffsetUtf16+segment.readingLengthUtf16))
  await expect(panel.getByLabel('配音字幕',{exact:true})).toHaveText(f.text);await panel.getByRole('button',{name:'本机静音',exact:true}).click()
  const restored=await page.evaluate(async({owner})=>{const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),core=await load('/storyforge/src/lib/product/runtime-core.ts'),ledger=await load('/storyforge/src/lib/agent/run/event-store.ts'),commands=await load('/storyforge/src/lib/ttrpg/runtime-commands.ts'),helper=await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const source=await core.readProductRuntimeState(owner.sessionId),requestKey=source.ttrpg.openRun.voiceRequests[0].requestKey,runs=await db.agentRuns.toArray(),childRun=runs.find((r:any)=>r.parentRunId!=null)
    await ledger.deleteAgentRunV1(owner.scope,childRun.id);await ledger.deleteAgentRunV1(owner.scope,childRun.parentRunId)
    const adopted=await(await load('/storyforge/src/lib/ttrpg/open-audio-service.ts')).readTtrpgOpenGeneratedAudioAdoptionV1({...owner,requestKey})
    const child=await core.branchProductRuntimeSession({parentSessionId:owner.sessionId,throughSequence:source.lastSequence,title:'生成音频浏览器续团'}),state=await core.readProductRuntimeState(child.id)
    await commands.completeTtrpgOpenSessionZeroV1({...await helper.openEnvelopeV1(child.id,'generated.native.child.zero'),viewerKey:owner.viewerKey,acceptedItemKeys:state.ttrpg.product.sessionZero.requiredItemKeys,selectedCharacterKeys:['hero','companion.1','companion.2']})
    await core.deleteProductRuntimeSession(owner.sessionId)
    const backup=await load('/storyforge/src/lib/export/json-export.ts'),projectId=await backup.importProjectJSON(await backup.exportProjectJSON(owner.scope.projectId)),copy=(await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    return {owner:{scope:{projectId,worldId:copy.worldId,workId:copy.workId},sessionId:copy.id,viewerKey:owner.viewerKey},adopted,originalRunsGone:await db.agentRuns.count()===0,receipt:(await core.readProductRuntimeState(copy.id)).ttrpg.openRun.audioReceipts[0]}
  },f)
  expect(restored.originalRunsGone).toBe(true);expect(JSON.stringify(restored.receipt)).toBe(JSON.stringify(accepted.receipt));expect(restored.adopted.candidateHash).toBe(accepted.receipt.generated.completion.candidateHash)
  panel=await enter(page,restored.owner.sessionId);await expect(panel.getByLabel('配音播放',{exact:true})).toHaveCount(0)
  await panel.getByRole('button',{name:'开启本机音频',exact:true}).click();audio=panel.getByLabel('配音播放',{exact:true});await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.readyState),{timeout:30000}).toBeGreaterThanOrEqual(1)
  expect(await audio.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(true);await audio.focus();await audio.press('Space');await expect.poll(()=>audio.evaluate((el:HTMLAudioElement)=>el.paused)).toBe(false)
  expect({starts,creates,previews,rawReads}).toEqual({starts:1,creates:1,previews:1,rawReads:1})
  await info.attach('generated-audio-accepted-and-restored',{body:JSON.stringify({accepted,restored,starts,creates,previews,rawReads}),contentType:'application/json'})
})
