import { afterEach,beforeEach,describe,expect,it,onTestFinished,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/visual-planning-brief-v5'
import * as decoder from '../../src/lib/avg/image-decoder'
import { avgV5RegisteredProposalsFixture,adoptAvgV5CompiledSources,cycleAvgV5Until,type AvgV5RegisteredFixture } from '../helpers/avg-v5-registered-proposals-fixture'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1,runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { readAvgCompiledImageDefinitionV5 } from '../../src/lib/avg/visual-planning-image-definition-v5'
import { readAvgCompiledImageDefinitionV4 } from '../../src/lib/avg/visual-planning-image-definition'
import { parseAvgRawImagePayloadV2,assertAvgRawImageArtifactFromDefinitionV2 } from '../../src/lib/avg/media-raw-contract-v2'
import { parseAvgRawImagePayloadV1 } from '../../src/lib/avg/media-raw-contract'
import { assertAvgImageRequestV1 } from '../../src/lib/avg/media-reference-contract'
import { avgReferenceTransmissionV1 } from '../../src/lib/avg/media-reference-adapter'
import { assertAvgMediaRawProducerAdmissionV2 } from '../../src/lib/avg/media-production-admission'
import { readAvgVisualPlanningContextV5 } from '../../src/lib/avg/visual-planning-context-v5'
import { readAvgVisualPlanningContextV4 } from '../../src/lib/avg/visual-planning-context'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { verifyAcceptedProductBuildArtifactV1 } from '../../src/lib/product-production/artifact-store'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unconfigured engineering network forbidden')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})
async function compileImages(mode:'normal'|'unknown'|'unauthorized'|'malformed'|'changed-license'='normal',image25=false){
  vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
  // Happy DOM cannot decode images. Only this physical browser observation is
  // controlled; original PNG/HTTP, Run, adoption, compiler and Blob are real.
  vi.spyOn(decoder,'inspectAvgImageBytesV1').mockResolvedValue({width:32,height:32,hasAlpha:false})
  const s:AvgV5RegisteredFixture=await avgV5RegisteredProposalsFixture({imageAdapterId:image25?'agnes.image-2.5-flash.v1':'agnes.image-2.1-flash.v1',imageResponse:async(body,index)=>{
    if(mode==='unknown')return new Response(JSON.stringify({operation_id:'controlled.new.image.pending'}),{status:202,headers:{'content-type':'application/json'}})
    if(mode==='unauthorized')return new Response(JSON.stringify({error:{message:'controlled authorization failure'}}),{status:401,headers:{'content-type':'application/json'}})
    const r=s.brief.avgVisualPlanning!.scope.templates.find(t=>String(body.prompt).includes(t.parameters.requirementKey))!.parameters
    const data=await deterministicRegionMapPngV1({width:r.width,height:r.height,palette:['#253746','#9f8772','#d1cbb8']})
    if(mode==='changed-license'){
      const row=(await db.avgDraftMedia.where('workId').equals(s.scope.workId).first())!
      await db.avgDraftMedia.update(row.id!,{assetJson:JSON.stringify({...JSON.parse(row.assetJson),license:'Consent changed during the actual controlled HTTP request'})})
    }
    const bytes=new Uint8Array(data);let binary=''
    for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384))
    return new Response(JSON.stringify({data:[{b64_json:mode==='malformed'?'%%%%':btoa(binary)}]}),
      {headers:{'content-type':'application/json','x-request-id':`controlled-v5-original-${index}`}})
  }})
  await adoptAvgV5CompiledSources(s)
  expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(0)
  return s
}
async function currentDefinition(s:AvgV5RegisteredFixture){
  const build=(await db.productBuilds.get(s.buildId))!
  return readAvgCompiledImageDefinitionV5({scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,expectedBrief:s.brief})
}
describe('AVG V5 original images from actual registered compiler and producer',()=>{
  it.each([['0','0',false],['0','1',false],['1','0',false],['1','1',true]] as const)('requires both original experiment switches: media=%s visual=%s', (media,visual,expected)=>{
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION',media);vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING',visual)
    expect(readiness.avgVisualPlanningExecutionReadyV5()).toBe(expected)
  })
  it('sends exact reference bytes and declared policies for all five tasks, retains raw V2 evidence and grants no author choice',async()=>{
    const started=performance.now(),phases:Array<{phase:string;elapsedMs:number}>=[]
    const mark=(phase:string)=>phases.push({phase,elapsedMs:Math.round(performance.now()-started)})
    onTestFinished(()=>console.info('[avg-v5-images] phases',JSON.stringify(phases)))
    const s=await compileImages(),before=await currentDefinition(s)
    mark('compiled')
    await expect(readAvgCompiledImageDefinitionV4({scope:s.scope,buildId:s.buildId,expectedBuildRevision:before.build.stateRevision,controlEpoch:before.build.controlEpoch})).rejects.toThrow()
    await runProductProductionUntilBlockedV1(s)
    mark('generated')
    const rows=await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(r=>r.status==='accepted'&&r.artifactKey.startsWith('avg.media.raw.')).toArray()
    expect(rows).toHaveLength(5);expect(s.imageCalls).toHaveLength(5);expect(s.calls).toHaveLength(4)
    const d=await currentDefinition(s)
    for(const raw of rows){
      const proved=await verifyAcceptedProductBuildArtifactV1({scope:s.scope,buildId:s.buildId,artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash})
      expect(proved.producerRunId).toBe(raw.producerRunId)
      const parsed=await assertAvgRawImageArtifactFromDefinitionV2({...d.definition,capability:d.capability,qualityProfile:s.brief.qualityProfile},raw)
      const p=parsed.payload,q=JSON.parse(raw.qualityJson),task=s.plan.tasks.find(t=>t.outputArtifactKeys.includes(raw.artifactKey))!
      expect(p.version).toBe(2);expect(p.request.version).toBe(2);expect(p.request.targetFamily).toEqual(p.requirement.family)
      expect(task.skillId).toBe('avg.compiled-image-request.v2')
      await expect(parseAvgRawImagePayloadV1(raw.payloadJson)).rejects.toThrow()
      await expect(assertAvgImageRequestV1(p.request as never)).rejects.toThrow()
      expect(q).toMatchObject({decoderVerified:false,sourceCompilation:d.definition.compilation,referenceTransmission:avgReferenceTransmissionV1(p.request)})
      expect(q.referenceTransmission).toMatchObject({version:2,referencePurposeGuaranteed:false,alphaGuaranteed:false,targetFamily:p.requirement.family})
      const call=s.imageCalls.find(c=>String(c.prompt).includes(p.requirement.requirementKey))!
      expect(call.model).toBe('agnes-image-2.1-flash');expect(call.size).toBe(p.request.resolutionTier)
      expect(String(call.prompt)).toContain('permittedFeatures');expect(String(call.prompt)).toContain('excludedFeatures');expect(String(call.prompt)).toContain('Do not copy excludedFeatures')
      const transmitted=(call.extra_body as {image:string[]}).image
      expect(transmitted).toHaveLength(p.requirement.references.length)
      for(const [i,reference] of p.requirement.references.entries())expect(await sha256MediaData(Uint8Array.from(atob(transmitted[i].split(',')[1]),c=>c.charCodeAt(0)).buffer)).toBe(reference.contentHash)
      const child=await readAgentRunV1(s.scope,raw.producerRunId!)
      expect(child.projection.state).toBe('completed');expect(child.events.filter(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='raw-response')).toHaveLength(1)
      const context={projectId:s.scope.projectId,scope:s.scope,productProductionId:s.productionId,productBuildId:s.buildId,productProductionTaskKey:task.taskKey,productArtifactKeys:task.inputArtifactKeys}
      const packet=JSON.parse(await readAvgVisualPlanningContextV5(context)),json=JSON.stringify(packet)
      expect(packet).toMatchObject({version:5,operation:'produce-compiled-image',compilation:d.definition.compilation})
      for(const forbidden of ['generatedSource','blobObjectId','providerInputAllowed','license','data:image/','producerRunId'])expect(json).not.toContain(forbidden)
      expect(json).not.toContain(s.author.source.scripts[0].lines[0].text)
      await expect(readAvgVisualPlanningContextV4(context)).rejects.toThrow()
      // All five actual producers already passed sealed admission. Exercise
      // each generic receipt rejection once, without repeating the same full
      // dependency graph fifteen times in this single 60-second UI/DB case.
      if(raw===rows[0]){
        const admission={scope:s.scope,build:{...d.build,id:s.buildId},task,producerRunId:raw.producerRunId!,artifact:raw}
        await assertAvgMediaRawProducerAdmissionV2(admission)
        for(const mutation of [{...q,referenceTransmission:{...q.referenceTransmission,referencePurposeGuaranteed:true}},
          {...q,referenceTransmission:{...q.referenceTransmission,targetFamily:{...p.requirement.family,variantKey:'other'}}},
          {...q,referenceTransmission:{...q.referenceTransmission,references:q.referenceTransmission.references.map((r:object)=>({...r,contentPolicy:{permittedFeatures:['other'],excludedFeatures:[]}}))}}]){
          await expect(assertAvgMediaRawProducerAdmissionV2({...admission,artifact:{...raw,qualityJson:JSON.stringify(mutation)}})).rejects.toThrow()
        }
      }
      mark(`verified:${raw.artifactKey}`)
    }
    expect(await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(r=>r.artifactKey.startsWith('avg.media.choice.')).count()).toBe(0)
    expect((await db.productBuilds.get(s.buildId))!.packageHash).toBe('')
    await runProductProductionSchedulerCycleV1(s);expect(s.imageCalls).toHaveLength(5)
    const backup=await exportProjectJSON(s.scope.projectId)
    mark('exported')
    const copyProjectId=await importProjectJSON(backup)
    mark('imported')
    const copyBuild=(await db.productBuilds.where('projectId').equals(copyProjectId).first())!,copyScope={projectId:copyProjectId,workId:copyBuild.workId!,worldId:copyBuild.worldId!}
    const copyRaw=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([copyBuild.id!,rows[0].artifactKey]).first())!
    expect(await parseAvgRawImagePayloadV2(copyRaw.payloadJson)).toEqual(await parseAvgRawImagePayloadV2(rows[0].payloadJson))
    expect(copyRaw.producerRunId).not.toBe(rows[0].producerRunId)
    const copyBlob=(await db.mediaBlobObjects.get(copyRaw.blobObjectId!))!
    expect(await sha256MediaData(copyBlob.data as ArrayBuffer)).toBe(rows[0].contentHash)
    await expect(readAvgCompiledImageDefinitionV5({scope:copyScope,buildId:copyBuild.id!,expectedBuildRevision:copyBuild.stateRevision,controlEpoch:copyBuild.controlEpoch})).rejects.toThrow()
    await deleteWork(copyScope.workId)
    mark('copy-deleted')
    expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...backup,exportedAt:0})
    expect(s.imageCalls).toHaveLength(5)
  },60_000)
  it.each(['context','route','old-skill'] as const)('rejects a caller-substituted image %s against the actual child claim',async mode=>{
    const s=await compileImages(),executor:typeof s.executor=input=>s.executor(input.task.kind!=='avg-media-image-generate'?input
      :mode==='context'?{...input,contextText:input.contextText+'\nUnregistered image policy'}
        :mode==='route'?{...input,capabilityBindings:input.capabilityBindings.map(b=>({...b,bindingHash:'e'.repeat(64)}))}
          :{...input,task:{...input.task,skillId:'avg.compiled-image-request.v1'}})
    await runProductProductionUntilBlockedV1({...s,executor})
    expect(s.imageCalls).toHaveLength(0);expect(s.calls).toHaveLength(4)
    const ledger=JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson)
    const attempts=ledger.attempts.filter((a:any)=>String(a.taskKey).startsWith('avg.media.generate.'))
    expect(attempts.length).toBeGreaterThan(0)
    for(const attempt of attempts)expect(attempt).toMatchObject({usageKnown:true,usage:{modelCalls:0,mediaCalls:0,costUsd:0}})
  },60_000)
  it.each(['missing','license','closed-gate','route'] as const)('rejects %s after compilation before any image dispatch',async mode=>{
    const s=await compileImages()
    const reference=(await db.avgDraftMedia.where('workId').equals(s.scope.workId).first())!
    if(mode==='missing')await db.avgDraftMedia.delete(reference.id!)
    if(mode==='license')await db.avgDraftMedia.update(reference.id!,{assetJson:JSON.stringify({...JSON.parse(reference.assetJson),license:'Changed consent'})})
    if(mode==='closed-gate')vi.mocked(readiness.avgVisualPlanningExecutionReadyV5).mockReturnValue(false)
    if(mode==='route')s.capabilityBindings.find(b=>b.requirementKey==='avg.media.image')!.bindingHash='f'.repeat(64)
    if(mode==='missing'||mode==='license')await expect(runProductProductionUntilBlockedV1(s)).rejects.toThrow(/参考/)
    else await runProductProductionUntilBlockedV1(s)
    expect(s.imageCalls).toHaveLength(0)
    expect(await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(r=>r.artifactKey.startsWith('avg.media.raw.')).count()).toBe(0)
  },60_000)
  it('keeps an explicitly frozen image-2.5 route and V2 reference request through the actual configured producer',async()=>{
    const s=await compileImages('normal',true),r=s.brief.avgVisualPlanning!.scope.templates[0].parameters
    await cycleAvgV5Until(s,`avg.media.raw.${r.requirementKey}`)
    const rows=await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(r=>r.status==='accepted'&&r.kind==='image').toArray()
    expect(rows.length).toBeGreaterThan(0)
    expect(s.imageCalls.every(c=>c.model==='agnes-image-2.5-flash')).toBe(true)
    const d=await currentDefinition(s)
    for(const row of rows){
      const raw=await assertAvgRawImageArtifactFromDefinitionV2({...d.definition,capability:d.capability,qualityProfile:s.brief.qualityProfile},row)
      expect(raw.payload.request.request.adapterId).toBe('agnes.image-2.5-flash.v1')
      expect(JSON.parse(row.qualityJson).referenceTransmission.version).toBe(2)
    }
    expect(s.calls).toHaveLength(4)
  },60_000)
  it.each(['unknown','unauthorized','malformed','changed-license'] as const)('retains %s outcome and never silently resends',async mode=>{
    const s=await compileImages(mode);await runProductProductionUntilBlockedV1(s)
    expect(s.imageCalls).toHaveLength(1)
    expect(await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(r=>r.artifactKey.startsWith('avg.media.raw.')).count()).toBe(0)
    const build=(await db.productBuilds.get(s.buildId))!,ledger=JSON.parse(build.budgetLedgerJson)
    const task=Object.values(ledger.tasks).find((t:any)=>t.taskKey?.startsWith('avg.media.generate.')&&t.runId) as any
    const attempts=ledger.attempts.filter((a:any)=>String(a.taskKey).startsWith('avg.media.generate.'))
    expect(attempts).toHaveLength(1)
    if(mode==='unknown')expect(attempts[0].usageKnown).toBe(false)
    else expect(attempts[0]).toMatchObject({usageKnown:true,usage:{mediaCalls:1,modelCalls:0,costUsd:null}})
    const runId=task?.runId??attempts[0].runId,child=await readAgentRunV1(s.scope,runId)
    expect(child.events.some(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='raw-response')).toBe(true)
    db.close();await db.open();await runProductProductionSchedulerCycleV1(s)
    expect(s.imageCalls).toHaveLength(1);expect(s.calls).toHaveLength(4)
  },60_000)
})
