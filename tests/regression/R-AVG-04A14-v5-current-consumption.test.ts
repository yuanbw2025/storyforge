import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgV5MediaReviewFixture } from '../helpers/avg-v5-media-review-fixture'
import { readAvgCurrentImageConsumptionDefinition,readAvgCurrentChosenMediaSource,readAvgCurrentCompiledImageDefinition } from '../../src/lib/avg/current-image-consumption'
import { readAvgImageConsumptionDefinitionV4 } from '../../src/lib/avg/image-consumption'
import { stageAvgMediaChoiceV5 } from '../../src/lib/avg/visual-review-service-v5'
import { exportProjectJSON } from '../../src/lib/export/json-export'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import type { AvgAuthorMediaChoiceV1 } from '../../src/lib/avg/media-production-contract'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unconfigured engineering network forbidden')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})
const stableBackup=async(projectId:number)=>({...await exportProjectJSON(projectId),exportedAt:0})

describe('AVG current image consumption retains exact original versions',()=>{
  it('reads all five actual V5/raw2 definitions and pixels without granting author selection',async()=>{
    const s=await avgV5MediaReviewFixture()
    useAIConfigStore.getState().setConfig({apiKey:''})
    const before=await stableBackup(s.scope.projectId),d=await readAvgCurrentImageConsumptionDefinition({scope:s.scope,buildId:s.buildId,brief:s.brief})
    expect(d.mediaBatch).toEqual(s.compiled.definition.mediaBatch);expect(d.mediaBatch.version).toBe(2)
    await expect(readAvgImageConsumptionDefinitionV4({scope:s.scope,buildId:s.buildId,brief:s.brief})).rejects.toThrow()
    for(const raw of s.rows){
      const payload=JSON.parse(raw.payloadJson),r=payload.requirement
      const choice:AvgAuthorMediaChoiceV1={schema:'storyforge.avg.media-choice',version:1,requirementKey:r.requirementKey,requirementRevision:r.revision,
        raw:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash},asset:JSON.parse(raw.metadataJson),referenceOnly:r.consumer.domain==='reference',
        declaration:'仅检查实际原图和版本，尚未保存或采用作者选择'}
      const selected=await readAvgCurrentChosenMediaSource({scope:s.scope,buildId:s.buildId,brief:s.brief,choice})
      expect(selected.requirement).toEqual(r);expect(selected.validation.rawReceiptHash).toBe(raw.producerReceiptHash)
      expect(payload.request.version).toBe(2)
      expect('contentPolicy' in selected.requirement.references[0]).toBe(true)
      await expect(stageAvgMediaChoiceV5({scope:s.scope,productionId:s.productionId,requirementKey:r.requirementKey,
        rawVersion:raw.version,rawContentHash:raw.contentHash,declaration:choice.declaration})).rejects.toThrow()
    }
    expect(await stableBackup(s.scope.projectId)).toEqual(before)
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
  },60_000)

  it('keeps current compilation reads in the actual caller snapshot and rejects frozen, wrong scope or altered Brief authority',async()=>{
    const s=await avgV5MediaReviewFixture(),build=(await db.productBuilds.get(s.buildId))!
    const input={scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,expectedBrief:s.brief,purpose:'assembly' as const}
    const before=await stableBackup(s.scope.projectId)
    await db.transaction('r',scopeTransactionTables(db.productProductions,db.productProductionBriefs,db.productProductionCommands,
      db.productBuilds,db.productBuildArtifacts,db.avgDraftMedia,db.mediaBlobObjects,db.agentRuns,db.agentRunEvents,db.agentRunCheckpoints,db.agentRunArtifacts),async()=>{
      const resolved=await readAvgCurrentCompiledImageDefinition(input)
      expect(resolved.definition.version).toBe(5);expect(resolved.definition.mediaBatch.version).toBe(2)
      expect(resolved.definition.mediaBatch).toEqual(s.compiled.definition.mediaBatch)
      expect((await db.productBuilds.get(s.buildId))!.stateRevision).toBe(build.stateRevision)
    })
    await expect(readAvgCurrentCompiledImageDefinition({...input,purpose:'frozen-verification'})).rejects.toThrow()
    await expect(readAvgCurrentCompiledImageDefinition({...input,scope:{...s.scope,projectId:s.scope.projectId+1000}})).rejects.toThrow()
    await expect(readAvgCurrentCompiledImageDefinition({...input,expectedBrief:{...s.brief,intent:{...s.brief.intent,openingSituation:'Caller changed the original Brief'}}})).rejects.toThrow()
    expect(await stableBackup(s.scope.projectId)).toEqual(before)
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
  },60_000)
})
