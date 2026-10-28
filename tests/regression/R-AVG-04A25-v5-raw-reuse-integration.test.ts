import Dexie from 'dexie'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgV5MediaReviewFixture } from '../helpers/avg-v5-media-review-fixture'
import { avgV5Accepted,adoptAvgV5CompiledSources } from '../helpers/avg-v5-registered-proposals-fixture'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { avgImageProcessingRecipeFixture,avgImageProcessingReceiptFixture } from '../helpers/avg-image-processing-fixture'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import * as imageProcessing from '../../src/lib/avg/image-processing'
import type { AvgImageProcessingPlanV1 } from '../../src/lib/avg/image-processing-contract'
import { prepareAvgVisualRawReuseSourceV5 } from '../../src/lib/avg/visual-image-reuse'
import { prepareAvgVisualRawReuseV5 } from '../../src/lib/avg/visual-image-reuse-workspace'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { restartAvgVisualPlanningFromDraftV5,startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { stopProductProductionV1 } from '../../src/lib/product-production/service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { resolveAvgVisualPlanningExecutionV5 } from '../../src/lib/avg/visual-planning-workspace'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { verifyHistoricalAvgImageRevalidationProducerV1 } from '../../src/lib/product-production/artifact-store'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { stageAvgMediaChoiceV5 } from '../../src/lib/avg/visual-review-service-v5'
import { readAvgCompiledImageDefinitionV5 } from '../../src/lib/avg/visual-planning-image-definition-v5'
import { readAvgVisualProcessingEvidenceV5 } from '../../src/lib/avg/visual-image-processing-v5'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('V5 raw reuse integration must stay inside its controlled provider fixture')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})

function processingPlan():AvgImageProcessingPlanV1{
  const requirement=avgVersionedPlanningFixture().versioned.templates.find(template=>template.subjectKind==='environment')!.parameters
  return {schema:'storyforge.avg.image-processing-plan',version:1,
    entries:[{requirementKey:requirement.requirementKey,recipe:{...avgImageProcessingRecipeFixture(),width:requirement.width,height:requirement.height}}]}
}

describe('AVG V5 current-Build raw reuse integration',()=>{
  it('revalidates one exact historical image locally, runs its V5 pixel processing, keeps the other four provider slots, and requires new review and adoption',async()=>{
    const plan=processingPlan(),requirementKey=plan.entries[0].requirementKey
    const output=await deterministicRegionMapPngV1({width:576,height:324,palette:['#293021','#857456','#f1d390']})
    const process=vi.spyOn(imageProcessing,'processAvgImageBytesV1').mockImplementation(async input=>({data:output,
      receipt:await avgImageProcessingReceiptFixture({recipe:input.recipe,source:{...input.source,byteSize:input.data.byteLength},data:output})}))
    const s=await avgV5MediaReviewFixture(undefined,{imageProcessing:plan}),raw=s.rows.find(row=>row.artifactKey===`avg.media.raw.${requirementKey}`)!
    expect(s.imageCalls).toHaveLength(5)
    await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
    const parent=(await db.productBuilds.get(s.buildId))!
    const source=await prepareAvgVisualRawReuseSourceV5({scope:s.scope,buildId:s.buildId,expectedBuildRevision:parent.stateRevision,
      controlEpoch:s.plan.controlEpoch,expectedBriefHash:parent.briefHash,expectedPlanHash:parent.planHash,
      artifact:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})
    const restarted=await restartAvgVisualPlanningFromDraftV5({scope:s.scope,productionId:s.productionId,expectedBuildId:parent.id!,
      expectedBuildRevision:parent.stateRevision,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision})
    const draft=await readAvgDraftV1(s.scope),ready=await prepareAvgVisualRawReuseV5({scope:s.scope,productionId:s.productionId,
      expectedBriefHash:restarted.brief!.briefHash,expectedDraftRevision:draft.revision,expectedBuildId:parent.id!,
      expectedBuildRevision:parent.stateRevision,sources:[source]})
    const brief=parseProductProductionBriefV3(ready.brief!.briefJson)
    expect(brief.avgVisualPlanning?.rawReuse).toEqual([source])
    expect(brief.productionBudget.maximumMediaCalls).toBe(4)
    const started=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:ready.brief!.briefHash}),build=started.build!
    const execution=await resolveAvgVisualPlanningExecutionV5(s.scope,brief,build.id!)
    const child={...s,brief,buildId:build.id!,plan:parseProductProductionPlanV3(build.planJson,brief,build.briefHash),
      executor:createConfiguredProductProductionExecutorV1({production:started.production,brief,runText:s.runText,...execution}),
      capabilityBindings:execution.capabilityBindings}
    await adoptAvgV5CompiledSources(child)
    await runProductProductionUntilBlockedV1(child)

    const reused=await avgV5Accepted(child,raw.artifactKey)
    expect(reused).toBeDefined()
    expect(reused!.payloadJson).toBe(raw.payloadJson)
    expect(reused!.metadataJson).toBe(raw.metadataJson)
    expect(reused!.rightsJson).toBe(raw.rightsJson)
    expect(reused!.contentHash).toBe(raw.contentHash)
    expect(reused!.blobObjectId).toBe(raw.blobObjectId)
    expect(JSON.parse(reused!.qualityJson)).toMatchObject({schema:'storyforge.avg.visual-raw-image-revalidation',version:2,
      noProviderRequest:true,contentHashVerified:true,decoderVerified:false,original:source})
    expect(await db.productBuildArtifacts.get(raw.id!)).toEqual(raw)
    const currentReview=await avgV5Accepted(child,`avg.review.visual.${requirementKey}`),currentChoice=await avgV5Accepted(child,`avg.media.choice.${requirementKey}`)
    expect(currentReview).toBeUndefined();expect(currentChoice).toBeUndefined()
    await expect(stageAvgMediaChoiceV5({scope:s.scope,productionId:s.productionId,requirementKey,
      rawVersion:reused!.version,rawContentHash:reused!.contentHash,declaration:'当前版本必须先完成新的视觉审查'})).rejects.toThrow()
    const processed=await avgV5Accepted(child,`avg.media.processed.${requirementKey}`)
    expect(processed).toBeDefined();expect(process).toHaveBeenCalledTimes(2)
    expect(JSON.parse(processed!.payloadJson).raw).toMatchObject({artifactKey:reused!.artifactKey,version:reused!.version,
      contentHash:reused!.contentHash,producerReceiptHash:reused!.producerReceiptHash})
    const compiled=await readAvgCompiledImageDefinitionV5({scope:s.scope,buildId:build.id!,
      expectedBuildRevision:(await db.productBuilds.get(build.id!))!.stateRevision,controlEpoch:build.controlEpoch,expectedBrief:brief})
    const processingEvidence=await db.transaction('r',db.tables,async()=>{
      const snapshot=Dexie.currentTransaction
      const evidence=await readAvgVisualProcessingEvidenceV5({scope:s.scope,compiled,artifact:{artifactKey:processed!.artifactKey,
        version:processed!.version,contentHash:processed!.contentHash}})
      expect(Dexie.currentTransaction).toBe(snapshot)
      expect(snapshot?.active).toBe(true)
      return evidence
    })
    expect(processingEvidence.originalReuseSource).toEqual(source)
    expect(processingEvidence.raw.contentHash).toBe(raw.contentHash)

    const originalCalls=s.imageCalls.slice(0,5),childCalls=s.imageCalls.slice(5)
    expect(originalCalls).toHaveLength(5);expect(childCalls).toHaveLength(4)
    expect(childCalls.every(call=>!String(call.prompt).includes(requirementKey))).toBe(true)
    const proof=await verifyHistoricalAvgImageRevalidationProducerV1({scope:s.scope,buildId:build.id!,expectedBuildRevision:(await db.productBuilds.get(build.id!))!.stateRevision,
      expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,sourceControlEpoch:build.controlEpoch,
      artifactKey:reused!.artifactKey,version:reused!.version,contentHash:reused!.contentHash})
    const run=await readAgentRunV1(s.scope,reused!.producerRunId!)
    expect(proof.provenance).toMatchObject({schema:'storyforge.avg.image-revalidation-producer-proof',version:1,noProviderRequest:true})
    expect(run.events.some(event=>event.type==='model.requested'||event.type==='tool.called'
      ||event.type==='evidence.artifact.recorded'&&event.payload.artifactKind==='raw-response')).toBe(false)
    const ledger=JSON.parse((await db.productBuilds.get(build.id!))!.budgetLedgerJson)
    const attempts=ledger.attempts.filter((attempt:{taskKey:string})=>attempt.taskKey===`avg.media.generate.${requirementKey}`)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].usage).toMatchObject({modelCalls:0,mediaCalls:0,costUsd:0})
    expect(JSON.parse((await db.productBuilds.get(build.id!))!.budgetLedgerJson).tasks[`avg.media.process.${requirementKey}`].usage)
      .toMatchObject({modelCalls:0,mediaCalls:0,costUsd:0})
    expect(s.calls).toHaveLength(8)
  },120_000)
})
