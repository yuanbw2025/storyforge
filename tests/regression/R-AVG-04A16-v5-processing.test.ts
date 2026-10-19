import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgV5FormalFixture } from '../helpers/avg-v5-formal-fixture'
import { buildAvgVisualPlanningPlanV5 } from '../../src/lib/avg/visual-planning-plan-v5'
import { avgVisualPlanningBudgetV5,avgVisualPlanningGateIdsV5 } from '../../src/lib/avg/visual-planning-policy-v5'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { avgV5MediaReviewFixture,avgV5ReviewReport } from '../helpers/avg-v5-media-review-fixture'
import { avgV5Accepted,confirmAvgV5PendingCandidate,type AvgV5RegisteredFixture } from '../helpers/avg-v5-registered-proposals-fixture'
import { avgImageProcessingRecipeFixture,avgImageProcessingReceiptFixture } from '../helpers/avg-image-processing-fixture'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import * as processing from '../../src/lib/avg/image-processing'
import { inspectAvgVisualProcessedImageV5 } from '../../src/lib/avg/visual-image-processing-v5'
import { readAvgProcessedImageSourceV5 } from '../../src/lib/avg/image-processing-source-v5'
import { readAvgChosenMediaSourceV5 } from '../../src/lib/avg/media-choice-validation-v5'
import { stageAvgVisualReviewV2,stageAvgMediaChoiceV5 } from '../../src/lib/avg/visual-review-service-v5'
import { prepareAvgAssemblyBriefV1,readAvgAssemblyWorkspaceV1,configureAvgChosenMediaDraftV2,stageAvgWorkspaceInputV1,confirmAvgWorkspaceInputV1,runAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { verifyFrozenAvgAuthorInputsV1 } from '../../src/lib/avg/author-artifacts'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import * as mediaVerifier from '../../src/lib/product-production/media-runtime-verifier'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { prepareAvgAdoptedGeneratedImageV2,readAvgAdoptedGeneratedImageV2,readAvgGeneratedReferenceBytesV2 } from '../../src/lib/avg/media-generated-reference'
import { parseAvgGeneratedReferenceSourceV5,parseAvgGeneratedImageSource } from '../../src/lib/avg/media-generated-reference-contract'
import { parseAvgGeneratedReferenceSourceV4 } from '../../src/lib/avg/visual-processed-source-contract'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import type { AvgImageProcessingPlanV1 } from '../../src/lib/avg/image-processing-contract'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unconfigured engineering network forbidden')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})
function plan():AvgImageProcessingPlanV1{
  const r=avgVersionedPlanningFixture().versioned.templates.find(t=>t.subjectKind==='environment')!.parameters
  return {schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:r.requirementKey,
    recipe:{...avgImageProcessingRecipeFixture(),width:r.width,height:r.height,crop:{x:500,y:500,width:9000,height:9000}}}]}
}
async function controlledPixels(onPixels?:()=>Promise<void>){
  // Controlled pixel receipt/decoder only. Actual native geometry and alpha
  // remain browser checks; this fixture grants no art/commercial acceptance.
  const output=await deterministicRegionMapPngV1({width:576,height:324,palette:['#293021','#857456','#f1d390']})
  return vi.spyOn(processing,'processAvgImageBytesV1').mockImplementation(async input=>{
    await onPixels?.()
    return {data:output,receipt:await avgImageProcessingReceiptFixture({recipe:input.recipe,source:{...input.source,byteSize:input.data.byteLength},data:output})}
  })
}
function observeStage(){
  vi.spyOn(mediaVerifier,'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input=>({environment:input.environment,measuredAt:Date.now(),
    assets:input.assets.map(asset=>({assetKey:asset.assetKey,contentHash:asset.contentHash,mimeType:asset.mimeType,mediaClass:'image',status:'decoded',
      decodedWidth:asset.width,decodedHeight:asset.height,decodedDurationMs:null,decodedHasAlpha:asset.assetKey.includes('.keeper.'),
      decodedChannelCount:null,decodedSampleRateHz:null,integratedLufs:null,truePeakDbtp:null,loopSeamDbfs:null,policyFailures:[],failureCode:null}))}))
}
describe('AVG actual V5 local derivative producer and author consumption',()=>{
  it('preserves a valid author family key that also names the shared compilation lock',async()=>{
    const {brief}=await avgV5FormalFixture()
    brief.avgVisualPlanning.scope.templates[0].parameters.family.familyKey='avg.media.compiled-visual-requirements'
    brief.avgVisualPlanning.imageProcessing=plan()
    brief.productionBudget=avgVisualPlanningBudgetV5(brief);brief.completionContract.requiredGateIds=avgVisualPlanningGateIdsV5(brief)
    parseProductProductionBriefV3(brief)
    const briefHash=await hashProductProductionValueV2(brief)
    const topology=buildAvgVisualPlanningPlanV5({brief,briefHash,buildNumber:1,controlEpoch:0})
    expect(parseProductProductionPlanV3(topology,brief,briefHash)).toEqual(topology)
  })
  it('processes exact raw2 once without provider calls and separately reviews/chooses the derivative through frozen Preview',async()=>{
    const process=await controlledPixels(),imageProcessing=plan(),key=imageProcessing.entries[0].requirementKey
    const s=await avgV5MediaReviewFixture(phase=>console.info('[v5-processing-positive]',phase),{imageProcessing}),raw=s.rows.find(r=>r.artifactKey===`avg.media.raw.${key}`)!
    const processed=(await avgV5Accepted(s,`avg.media.processed.${key}`))!
    expect(processed,(await db.productBuilds.get(s.buildId))!.failureJson).toBeDefined()
    expect(s.plan.tasks.filter(t=>['avg-media-image-generate','avg-media-image-process'].includes(t.kind)).every(t=>t.subjectLockKeys.includes('avg.media.compiled-visual-requirements'))).toBe(true)
    expect(process).toHaveBeenCalledTimes(1);expect(s.imageCalls).toHaveLength(5);expect(s.calls).toHaveLength(4)
    expect(processed.contentHash).not.toBe(raw.contentHash);expect(processed.requirementKey).toBeNull()
    expect(JSON.parse(raw.payloadJson).version).toBe(2);expect(JSON.parse(processed.payloadJson).version).toBe(1)
    expect(JSON.parse(processed.qualityJson)).toMatchObject({schema:'storyforge.avg.visual-image-processing-evidence',version:2,noProviderRequest:true,decoderVerified:true})
    const ledger=JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks[`avg.media.process.${key}`]
    expect(ledger).toMatchObject({status:'settled',usage:{modelCalls:0,mediaCalls:0,costUsd:0}})
    const child=await readAgentRunV1(s.scope,processed.producerRunId!)
    expect(child.events.some(e=>e.type==='model.requested'||e.type==='tool.called'||e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='raw-response')).toBe(false)
    await expect(inspectAvgVisualProcessedImageV5({compiled:s.compiled,raw,artifact:{...processed,
      qualityJson:JSON.stringify({...JSON.parse(processed.qualityJson),version:1})}})).rejects.toThrow(/加工/)
    const selected=await readAvgProcessedImageSourceV5({scope:s.scope,buildId:s.buildId,brief:s.brief,raw})
    expect(selected.row.id).toBe(processed.id)
    const beforeRaw=structuredClone(raw),base={scope:s.scope,productionId:s.productionId,requirementKey:key,rawVersion:raw.version,rawContentHash:raw.contentHash,
      declaration:'明确模拟作者工程观察；不签实际美术、参考遵从或商业质量'}
    const r=s.compiled.definition.mediaBatch.requirements.find(r=>r.requirementKey===key)!
    await expect(stageAvgVisualReviewV2({...base,report:await avgV5ReviewReport(r,raw.contentHash,'pass')})).rejects.toThrow()
    useAIConfigStore.getState().setConfig({apiKey:''});db.close();await db.open()
    await runProductProductionUntilBlockedV1(s)
    expect(process).toHaveBeenCalledTimes(1);expect(s.imageCalls).toHaveLength(5)
    const unknown=await stageAvgVisualReviewV2({...base,report:await avgV5ReviewReport(r,processed.contentHash,'unknown')})
    expect(unknown.status).toBe('pending');await confirmAvgV5PendingCandidate(s,unknown)
    await expect(stageAvgMediaChoiceV5(base)).rejects.toThrow()
    await confirmAvgV5PendingCandidate(s,await stageAvgVisualReviewV2({...base,report:await avgV5ReviewReport(r,processed.contentHash,'pass')}))
    const candidate=await stageAvgMediaChoiceV5(base),choice=JSON.parse(candidate.payloadJson)
    expect(candidate.status).toBe('pending');expect(await avgV5Accepted(s,candidate.artifactKey)).toBeUndefined()
    expect(choice).toMatchObject({version:2,processed:{artifactKey:processed.artifactKey,version:processed.version,contentHash:processed.contentHash}})
    expect(choice.asset.contentHash).toBe(processed.contentHash)
    const {processed:_processed,...fields}=choice
    await expect(readAvgChosenMediaSourceV5({...s,choice:{...fields,version:1,asset:JSON.parse(raw.metadataJson)}})).rejects.toThrow(/加工/)
    await expect(readAvgChosenMediaSourceV5({...s,choice:{...choice,processed:{...choice.processed,contentHash:'f'.repeat(64)}}})).rejects.toThrow(/加工/)
    await confirmAvgV5PendingCandidate(s,candidate)
    for(const other of s.rows.filter(row=>row.id!==raw.id)){
      const requirement=JSON.parse(other.payloadJson).requirement,common={...base,requirementKey:requirement.requirementKey,rawVersion:other.version,rawContentHash:other.contentHash}
      await confirmAvgV5PendingCandidate(s,await stageAvgVisualReviewV2({...common,report:await avgV5ReviewReport(requirement,other.contentHash,'pass')}))
      await confirmAvgV5PendingCandidate(s,await stageAvgMediaChoiceV5(common))
    }
    expect(await db.productBuildArtifacts.get(raw.id!)).toEqual(beforeRaw)
    const saved=await configureAvgChosenMediaDraftV2({...s,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision}),workspace=parseAvgAuthorWorkspaceV1(saved.editorJson)
    expect(workspace.presentation.stage.assets.find(a=>a.assetKey===r.assetKey)?.contentHash).toBe(processed.contentHash)
    expect(await avgV5Accepted(s,'avg.author.stage')).toBeUndefined()
    observeStage()
    const stage=await stageAvgWorkspaceInputV1({...s,expectedDraftRevision:saved.revision,artifactKey:'avg.author.stage',declaration:base.declaration})
    expect(stage.status).toBe('pending');await confirmAvgWorkspaceInputV1({...s,artifactKey:stage.artifactKey,candidateVersion:stage.version,candidateHash:JSON.parse(stage.metadataJson).candidateHash})
    await runAvgAssemblyV1(s)
    const build=(await db.productBuilds.get(s.buildId))!
    expect(build.status).toBe('preview-ready');expect(build.previewHash).not.toBe('')
    await verifyStoredProductBuildPreview(build)
    const frozen=await verifyFrozenAvgAuthorInputsV1({scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch})
    expect(frozen.mediaChoices?.find(c=>c.payload.requirementKey===key)?.image.contentHash).toBe(processed.contentHash)
    const retained=await prepareAvgAdoptedGeneratedImageV2({scope:s.scope,choiceId:candidate.id!})
    if(retained.source.version!==6)throw new Error('Expected distinct Source6 derivative provenance')
    const source=retained.source
    expect(source.raw.version).toBe(5);expect(source.processing).toMatchObject({version:1,noProviderRequest:true})
    expect(parseAvgGeneratedImageSource(source)).toEqual(source)
    expect(()=>parseAvgGeneratedReferenceSourceV5(source)).toThrow();expect(()=>parseAvgGeneratedReferenceSourceV4(source)).toThrow()
    const {processing:_processing,...rawOnly}=source
    await expect(readAvgAdoptedGeneratedImageV2({scope:s.scope,source:{...rawOnly,version:5}})).rejects.toThrow()
    await expect(readAvgAdoptedGeneratedImageV2({scope:s.scope,source:{...source,version:4,raw:{...source.raw,version:4}}})).rejects.toThrow()
    for(const changed of [{...source,processing:{...source.processing,processingEvidenceHash:'f'.repeat(64)}},
      {...source,review:{...source.review,authorReceiptHash:'f'.repeat(64)}},
      {...source,choice:{...source.choice,contentHash:'f'.repeat(64)}}]){
      await expect(readAvgAdoptedGeneratedImageV2({scope:s.scope,source:changed})).rejects.toThrow()
    }
    const bytes=await readAvgAdoptedGeneratedImageV2({scope:s.scope,source})
    expect(await sha256MediaData(bytes.data)).toBe(processed.contentHash)
    const reference={...r.references[0],assetKey:retained.asset.assetKey,assetVersion:retained.asset.version,contentHash:retained.asset.contentHash,
      mimeType:retained.asset.mimeType,byteSize:retained.asset.byteSize,license:retained.asset.license,generatedSource:source}
    expect(await sha256MediaData(await readAvgGeneratedReferenceBytesV2(s.scope,reference,r.family))).toBe(processed.contentHash)
    const copyId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),copy=(await db.productBuilds.where('projectId').equals(copyId).first())!
    const copyScope={projectId:copyId,worldId:copy.worldId,workId:copy.workId}
    expect((await verifyStoredProductBuildPreview(copy)).previewHash).toBe(build.previewHash)
    const restored=await readAvgAdoptedGeneratedImageV2({scope:copyScope,source})
    expect(await sha256MediaData(restored.data)).toBe(processed.contentHash)
    expect(restored.blobObjectId).not.toBe(bytes.blobObjectId)
    await expect(stageAvgMediaChoiceV5({...base,scope:copyScope,productionId:copy.productionId})).rejects.toThrow()
    await deleteWork(copy.workId)
    expect(await sha256MediaData((await readAvgAdoptedGeneratedImageV2({scope:s.scope,source})).data)).toBe(processed.contentHash)
    // The current workbench continuation must recognize genuine Source5/6,
    // while leaving all prior producer/adoption records untouched.
    const originalDraft=await readAvgDraftV1(s.scope),continued=parseAvgAuthorWorkspaceV1(originalDraft.editorJson)
    continued.basePreviewHash=build.previewHash
    const revised=await saveAvgAuthorWorkspaceV1(s.scope,originalDraft.revision,continued)
    await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:revised.revision,visualStageContinuation:{expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision}})
    const nextView=await readAvgAssemblyWorkspaceV1(s.scope),nextBrief=parseProductProductionBriefV3(nextView.details!.brief!.briefJson)
    const inherited=parseAvgAuthorWorkspaceV1(nextView.draft.editorJson).presentation.inheritedImages!
    expect(inherited).toHaveLength(5);expect(inherited.some(i=>i.source.version===6)).toBe(true);expect(inherited.some(i=>i.source.version===5)).toBe(true)
    expect(nextBrief.avgVisualPlanning).toBeUndefined();expect(nextBrief.productionBudget).toMatchObject({maximumModelCalls:0,maximumMediaCalls:0})
    expect(nextView.details!.build!.id).toBe(build.id);expect(nextView.details!.production.status).toBe('brief-ready')
    expect(await db.productBuildArtifacts.get(raw.id!)).toEqual(beforeRaw)
    expect(process).toHaveBeenCalledTimes(1);expect(s.imageCalls).toHaveLength(5);expect(s.calls).toHaveLength(4)
  },180_000)
  it.each(['swapped-compiler','swapped-recipe','changed-permission','damaged-original'] as const)('rejects %s without accepting a derivative or silently reprocessing',async mode=>{
    let captured:AvgV5RegisteredFixture|undefined
    const process=await controlledPixels(mode==='changed-permission'?async()=>{
      const row=(await db.avgDraftMedia.where('workId').equals(captured!.scope.workId).first())!
      await db.avgDraftMedia.update(row.id!,{assetJson:JSON.stringify({...JSON.parse(row.assetJson),license:'permission changed during actual local transform'})})
    }:undefined)
    const imageProcessing=plan(),key=imageProcessing.entries[0].requirementKey
    const fixture=avgV5MediaReviewFixture(undefined,{imageProcessing,beforeImages:async s=>{captured=s},executor:s=>{
      const executor=s.executor
      return async input=>{
        if(mode==='damaged-original'&&input.task.kind==='avg-media-image-process'){
          const raw=input.inputArtifacts.find(r=>r.artifactKey.startsWith('avg.media.raw.'))!,blob=(await db.mediaBlobObjects.get(raw.blobObjectId!))!
          const damaged=new Uint8Array(blob.data.slice(0));damaged[damaged.length-1]^=1
          await db.mediaBlobObjects.update(blob.id!,{data:damaged.buffer})
        }
        const result=await executor(input)
        if(input.task.kind==='avg-media-image-process'){
          const a=result.artifacts[0]
          if(mode==='swapped-compiler')a.quality={...a.quality as object,sourceCompilation:{artifactKey:'avg.media.compiled-visual-requirements',version:1,contentHash:'f'.repeat(64)}}
          if(mode==='swapped-recipe')a.payload={...a.payload as object,recipe:{...imageProcessing.entries[0].recipe,declaration:'not the frozen recipe'}}
        }
        return result
      }
    }})
    await expect(fixture.catch(async error=>{console.info('[v5-processing-negative]',mode,String(error),captured?((await db.productBuilds.get(captured.buildId))?.failureJson):'before owner');throw error})).rejects.toThrow()
    const s=captured!
    expect(process).toHaveBeenCalledTimes(mode==='damaged-original'?0:1);expect(await avgV5Accepted(s,`avg.media.processed.${key}`)).toBeUndefined()
    expect(await avgV5Accepted(s,`avg.media.raw.${key}`)).toBeDefined()
    const before=s.imageCalls.length
    db.close();await db.open()
    if(mode==='changed-permission'||mode==='damaged-original'){
      expect((await db.productBuilds.get(s.buildId))!.status).toBe('recovery-required')
      await runProductProductionUntilBlockedV1(s)
    }else await expect(runProductProductionUntilBlockedV1(s)).rejects.toThrow(/加工/)
    expect(process).toHaveBeenCalledTimes(mode==='damaged-original'?0:1);expect(s.imageCalls).toHaveLength(before)
  },120_000)
})
