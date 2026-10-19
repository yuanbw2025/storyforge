import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgV5MediaReviewFixture } from '../helpers/avg-v5-media-review-fixture'
import { avgV5Accepted } from '../helpers/avg-v5-registered-proposals-fixture'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { avgImageProcessingRecipeFixture,avgImageProcessingReceiptFixture } from '../helpers/avg-image-processing-fixture'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import * as processing from '../../src/lib/avg/image-processing'
import { readAvgRawImageCandidateBytesV5,readAvgProcessedImageCandidateBytesV5,readAvgHistoricalImageCandidatesV5 } from '../../src/lib/avg/media-candidate-preview-v5'
import { readAvgRawImageCandidateBytesV2,readAvgProcessedImageCandidateBytesV1 } from '../../src/lib/avg/assembly-service'
import { readProductProductionDetailsV1,stopProductProductionV1 } from '../../src/lib/product-production/service'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unconfigured engineering network forbidden')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})

describe('AVG explicit V5 raw and derivative display authority',()=>{
  it('reads exact current/stopped/imported raw2 and local pixels without restoring a key, current adoption or provider authority',async()=>{
    // Controlled pixel/decoder observations only. Original receipt/Harness/
    // HTTP and byte ownership remain real isolated engineering commands.
    const output=await deterministicRegionMapPngV1({width:576,height:324,palette:['#293021','#857456','#f1d390']})
    const pixel=vi.spyOn(processing,'processAvgImageBytesV1').mockImplementation(async input=>({data:output,
      receipt:await avgImageProcessingReceiptFixture({recipe:input.recipe,source:{...input.source,byteSize:input.data.byteLength},data:output})}))
    const r=avgVersionedPlanningFixture().versioned.templates.find(t=>t.subjectKind==='environment')!.parameters
    const imageProcessing={schema:'storyforge.avg.image-processing-plan' as const,version:1 as const,entries:[{requirementKey:r.requirementKey,recipe:avgImageProcessingRecipeFixture()}]}
    const s=await avgV5MediaReviewFixture(undefined,{imageProcessing}),raw=s.rows.find(row=>row.artifactKey===`avg.media.raw.${r.requirementKey}`)!,processed=(await avgV5Accepted(s,`avg.media.processed.${r.requirementKey}`))!
    const selection={scope:s.scope,productionId:s.productionId,requirementKey:r.requirementKey,version:raw.version,contentHash:raw.contentHash}
    const derivative={...selection,version:processed.version,contentHash:processed.contentHash}
    useAIConfigStore.getState().setConfig({apiKey:''})
    const inspect=async()=>{
      expect(await sha256MediaData((await readAvgRawImageCandidateBytesV5(selection)).data)).toBe(raw.contentHash)
      expect(await sha256MediaData((await readAvgProcessedImageCandidateBytesV5(derivative)).data)).toBe(processed.contentHash)
    }
    await inspect()
    await expect(readAvgRawImageCandidateBytesV2(selection)).rejects.toThrow()
    await expect(readAvgProcessedImageCandidateBytesV1(derivative)).rejects.toThrow()
    await expect(readAvgProcessedImageCandidateBytesV5({...derivative,contentHash:'f'.repeat(64)})).rejects.toThrow()
    await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
    db.close();await db.open();await inspect()
    const details=await readProductProductionDetailsV1(s.scope,s.productionId,['avg']),build=details.build!,plan=parseProductProductionPlanV3(build.planJson,details.executionBrief!,build.briefHash)
    const historical={buildId:build.id!,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,controlEpoch:plan.controlEpoch}
    const inventory=await readAvgHistoricalImageCandidatesV5({scope:s.scope,productionId:s.productionId,historical})
    expect(inventory.candidates).toHaveLength(5);expect(inventory.candidates.every(c=>c.available)).toBe(true)
    const local=inventory.candidates.find(c=>c.requirement.requirementKey===r.requirementKey)!
    if(!local.available)throw new Error('Expected exact original engineering pixels')
    expect(local.raw.contentHash).toBe(raw.contentHash);expect(local.processed!.row.contentHash).toBe(processed.contentHash)
    expect(await sha256MediaData((await readAvgRawImageCandidateBytesV5({...selection,historical})).data)).toBe(raw.contentHash)
    expect(await sha256MediaData((await readAvgProcessedImageCandidateBytesV5({...derivative,historical})).data)).toBe(processed.contentHash)
    await expect(readAvgHistoricalImageCandidatesV5({scope:s.scope,productionId:s.productionId,historical:{...historical,expectedBuildRevision:historical.expectedBuildRevision+1}})).rejects.toThrow()
    const copyId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),copy=(await db.productBuilds.where('projectId').equals(copyId).first())!
    const copyScope={projectId:copyId,worldId:copy.worldId,workId:copy.workId}
    expect(await sha256MediaData((await readAvgRawImageCandidateBytesV5({...selection,scope:copyScope,productionId:copy.productionId})).data)).toBe(raw.contentHash)
    expect(await sha256MediaData((await readAvgProcessedImageCandidateBytesV5({...derivative,scope:copyScope,productionId:copy.productionId})).data)).toBe(processed.contentHash)
    const copyDetails=await readProductProductionDetailsV1(copyScope,copy.productionId,['avg']),copyBuild=copyDetails.build!
    const copyBoundary={...historical,buildId:copyBuild.id!,expectedBuildRevision:copyBuild.stateRevision}
    const copied=await readAvgHistoricalImageCandidatesV5({scope:copyScope,productionId:copy.productionId,historical:copyBoundary})
    expect(copied.candidates.every(c=>c.available)).toBe(true)
    await expect(readAvgHistoricalImageCandidatesV5({scope:copyScope,productionId:s.productionId,historical})).rejects.toThrow()
    await expect(readAvgRawImageCandidateBytesV5({...selection,scope:copyScope})).rejects.toThrow()
    await deleteWork(copy.workId);await inspect()
    expect(pixel).toHaveBeenCalledTimes(1);expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
    expect(await avgV5Accepted(s,'avg.author.stage')).toBeUndefined();expect(await avgV5Accepted(s,`avg.media.choice.${r.requirementKey}`)).toBeUndefined()
  },180_000)
})
