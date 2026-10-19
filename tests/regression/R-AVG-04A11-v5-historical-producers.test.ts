import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgV5MediaReviewFixture } from '../helpers/avg-v5-media-review-fixture'
import { verifyAcceptedProductBuildArtifactV1,verifyHistoricalAvgVisualImageProducerV4,verifyHistoricalAvgVisualImageProducerV5,
  verifyHistoricalAvgVisualPlanningArtifactV4,verifyHistoricalAvgVisualPlanningArtifactV5 } from '../../src/lib/product-production/artifact-store'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { stopProductProductionV1 } from '../../src/lib/product-production/service'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { stageAvgMediaChoiceV5 } from '../../src/lib/avg/visual-review-service-v5'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unconfigured engineering network forbidden')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})
type Fixture=Awaited<ReturnType<typeof avgV5MediaReviewFixture>>
async function boundary(s:Pick<Fixture,'scope'|'buildId'>,row:ProductBuildArtifactRecordV1){
  const build=(await db.productBuilds.get(s.buildId))!
  return {scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
    expectedPlanHash:build.planHash,sourceControlEpoch:JSON.parse(build.planJson).controlEpoch as number,
    artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash}
}
const stableBackup=async(projectId:number)=>({...await exportProjectJSON(projectId),exportedAt:0})

describe('AVG explicit V5 intrinsic historical producer foundation',()=>{
  it('proves actual five original HTTP producers and four roles/compiler read-only without retagging V4',async()=>{
    const started=Date.now(),progress=(phase:string)=>console.info('[avg-v5-producer-phase]',phase,Date.now()-started)
    const s=await avgV5MediaReviewFixture(progress)
    useAIConfigStore.getState().setConfig({apiKey:''})
    const before=await stableBackup(s.scope.projectId)
    for(const row of s.rows){
      const input=await boundary(s,row),proof=await verifyHistoricalAvgVisualImageProducerV5(input)
      expect(proof.artifact).toEqual(row)
      const {proofHash,...body}=proof.provenance
      expect(proofHash).toBe(await hashProductProductionValueV2(body))
      expect(body).toMatchObject({schema:'storyforge.avg.visual-image-producer-proof',version:5,
        artifactKey:row.artifactKey,contentHash:row.contentHash,producerReceiptHash:row.producerReceiptHash,
        responseEvidenceHash:JSON.parse(row.qualityJson).responseEvidenceHash})
      expect(JSON.parse(proof.artifact.payloadJson)).toMatchObject({version:2,request:{version:2}})
      for(const key of ['runId','producerRunId','buildId','blobObjectId'])expect(body).not.toHaveProperty(key)
      await expect(verifyHistoricalAvgVisualImageProducerV4(input)).rejects.toThrow(/原始视觉版本/)
      await expect(verifyHistoricalAvgVisualPlanningArtifactV5(input)).rejects.toThrow()
      progress(`original-image:verified:${row.artifactKey}`)
    }
    const planning=await db.productBuildArtifacts.where('buildId').equals(s.buildId)
      .filter(row=>row.status==='accepted'&&(row.artifactKey.startsWith('avg.proposal.')||row.artifactKey==='avg.media.compiled-visual-requirements')).toArray()
    expect(planning).toHaveLength(5)
    for(const row of planning){
      const input=await boundary(s,row)
      expect(await verifyHistoricalAvgVisualPlanningArtifactV5(input)).toEqual(row)
      await expect(verifyHistoricalAvgVisualPlanningArtifactV4(input)).rejects.toThrow(/原始视觉版本/)
      await expect(verifyHistoricalAvgVisualImageProducerV5(input)).rejects.toThrow()
      progress(`planning:verified:${row.artifactKey}`)
    }
    expect(await stableBackup(s.scope.projectId)).toEqual(before)
    const raw=s.rows[0],input=await boundary(s,raw)
    for(const bad of [{...input,expectedBuildRevision:input.expectedBuildRevision+1},{...input,sourceControlEpoch:input.sourceControlEpoch+1},
      {...input,scope:{...input.scope,projectId:input.scope.projectId+1000}},{...input,contentHash:'f'.repeat(64)}]){
      await expect(verifyHistoricalAvgVisualImageProducerV5(bad)).rejects.toThrow()
    }
    progress('bad-boundaries:rejected')
    const checkpoints=await db.agentRunCheckpoints.where('runId').equals(raw.producerRunId!).toArray()
    await db.agentRunCheckpoints.where('runId').equals(raw.producerRunId!).delete()
    await expect(verifyHistoricalAvgVisualImageProducerV5(input)).rejects.toThrow()
    await db.agentRunCheckpoints.bulkAdd(checkpoints)
    progress('missing-checkpoint:rejected')
    const responseHash=JSON.parse(raw.qualityJson).responseEvidenceHash
    const responses=await db.agentRunArtifacts.filter(row=>row.projectId===s.scope.projectId&&row.artifactKind==='raw-response'&&row.contentHash===responseHash).toArray()
    expect(responses.length).toBeGreaterThan(0)
    await db.agentRunArtifacts.bulkDelete(responses.map(row=>row.id!))
    await expect(verifyHistoricalAvgVisualImageProducerV5(input)).rejects.toThrow()
    await db.agentRunArtifacts.bulkAdd(responses)
    progress('missing-response:rejected')
    const blob=(await db.mediaBlobObjects.get(raw.blobObjectId!))!,bytes=new Uint8Array(blob.data!.slice(0));bytes[bytes.length-1]^=1
    await db.mediaBlobObjects.update(blob.id!,{data:bytes.buffer})
    await expect(verifyHistoricalAvgVisualImageProducerV5(input)).rejects.toThrow()
    await db.mediaBlobObjects.put(blob)
    progress('changed-pixels:rejected')
    const read=await verifyHistoricalAvgVisualImageProducerV5(input)
    expect(read.artifact).toEqual(raw)
    progress('restored-original:ready')
    expect(await stableBackup(s.scope.projectId)).toEqual(before)
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
  },60_000)

  it('preserves original producer identity after actual stop and full restore, without granting current adoption',async()=>{
    const started=Date.now(),progress=(phase:string)=>console.info('[avg-v5-producer-phase]',phase,Date.now()-started)
    const s=await avgV5MediaReviewFixture(progress),raw=s.rows[0]
    const original=await verifyHistoricalAvgVisualImageProducerV5(await boundary(s,raw))
    progress('original-producer:ready')
    await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
    progress('actual-stop:ready')
    expect(await verifyHistoricalAvgVisualImageProducerV5(await boundary(s,raw))).toEqual(original)
    progress('stopped-producer:ready')
    const backup=await exportProjectJSON(s.scope.projectId),projectId=await importProjectJSON(backup)
    progress('full-remap:ready')
    const build=(await db.productBuilds.where('projectId').equals(projectId).first())!,scope={projectId,worldId:build.worldId!,workId:build.workId!}
    const restored=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,raw.artifactKey]).first())!
    useAIConfigStore.getState().setConfig({apiKey:''})
    const input=await boundary({scope,buildId:build.id!},restored),before=await stableBackup(projectId)
    const proof=await verifyHistoricalAvgVisualImageProducerV5(input)
    progress('restored-producer:ready')
    expect(proof.provenance).toEqual(original.provenance)
    expect(proof.artifact.workId).toBe(scope.workId);expect(proof.artifact.workId).not.toBe(raw.workId)
    expect(proof.artifact.blobObjectId).not.toBe(raw.blobObjectId)
    expect((await db.mediaBlobObjects.get(proof.artifact.blobObjectId!))!.data).toEqual((await db.mediaBlobObjects.get(raw.blobObjectId!))!.data)
    await expect(verifyAcceptedProductBuildArtifactV1({scope,buildId:build.id!,artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash})).rejects.toThrow()
    await expect(stageAvgMediaChoiceV5({scope,productionId:build.productionId,requirementKey:JSON.parse(raw.payloadJson).requirement.requirementKey,
      rawVersion:raw.version,rawContentHash:raw.contentHash,declaration:'只读原始来源不授权恢复后采用或重新派发'})).rejects.toThrow()
    progress('current-authority:rejected')
    expect(await stableBackup(projectId)).toEqual(before)
    await deleteWork(scope.workId)
    progress('copied-work:deleted')
    expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
    expect(await stableBackup(s.scope.projectId)).toEqual({...backup,exportedAt:0})
    expect((await verifyHistoricalAvgVisualImageProducerV5(await boundary(s,raw))).provenance).toEqual(original.provenance)
    progress('original-producer:preserved')
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
  },60_000)
})
