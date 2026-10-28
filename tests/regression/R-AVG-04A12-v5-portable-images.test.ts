import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgV5MediaReviewFixture,avgV5ReviewReport } from '../helpers/avg-v5-media-review-fixture'
import { avgV5Accepted,confirmAvgV5PendingCandidate } from '../helpers/avg-v5-registered-proposals-fixture'
import { stageAvgVisualReviewV2,stageAvgMediaChoiceV5 } from '../../src/lib/avg/visual-review-service-v5'
import { prepareAvgAdoptedGeneratedImageV2,readAvgAdoptedGeneratedImageV2 } from '../../src/lib/avg/media-generated-reference'
import { parseAvgGeneratedReferenceSourceV2,parseAvgGeneratedReferenceSourceV5,parseAvgGeneratedImageSource } from '../../src/lib/avg/media-generated-reference-contract'
import { readAvgHistoricalCompiledImageDefinitionV4 } from '../../src/lib/avg/visual-image-history'
import { readAvgHistoricalCompiledImageDefinitionV5 } from '../../src/lib/avg/visual-image-history-v5'
import { readAvgImageConsumptionDefinitionV5 } from '../../src/lib/avg/image-consumption-v5'
import { stopProductProductionV1 } from '../../src/lib/product-production/service'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { parseAvgAuthorStageV1 } from '../../src/lib/avg/author-workspace-contract'
import { readAvgInheritedStageImagesV1 } from '../../src/lib/avg/stage-image-sources'
import * as editorService from '../../src/lib/avg/editor-service'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unconfigured engineering network forbidden')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})
type Fixture=Awaited<ReturnType<typeof avgV5MediaReviewFixture>>
async function choose(s:Fixture,raw:ProductBuildArtifactRecordV1){
  const r=s.compiled.definition.mediaBatch.requirements.find(r=>raw.artifactKey===`avg.media.raw.${r.requirementKey}`)!
  const base={scope:s.scope,productionId:s.productionId,requirementKey:r.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash,
    declaration:'受控工程模拟作者观察/采用，不代签真实艺术或商业验收'}
  const review=await stageAvgVisualReviewV2({...base,report:await avgV5ReviewReport(r,raw.contentHash,'pass')})
  await confirmAvgV5PendingCandidate(s,review)
  const choice=await stageAvgMediaChoiceV5(base);await confirmAvgV5PendingCandidate(s,choice)
  return (await avgV5Accepted(s,choice.artifactKey))!
}
async function stop(s:Fixture){await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})}
const stableBackup=async(projectId:number)=>({...await exportProjectJSON(projectId),exportedAt:0})
const observer=(test:string)=>{const start=performance.now();return(phase:string)=>console.info('[avg-v5-portable-phase]',test,phase,Math.round(performance.now()-start))}

describe('AVG V5 portable originals retain exact original author and policy evidence',()=>{
  it('proves all five selected image families through Source5 and the existing inherited-stage reader without credentials or adoption',async()=>{
    const progress=observer('five-families'),s=await avgV5MediaReviewFixture(progress),choices=[]
    for(const raw of s.rows)choices.push(await choose(s,raw))
    progress('five-choices:ready')
    await expect(prepareAvgAdoptedGeneratedImageV2({scope:s.scope,choiceId:choices[0].id!})).rejects.toThrow(/停止|冻结/)
    await stop(s);useAIConfigStore.getState().setConfig({apiKey:''})
    const before=await stableBackup(s.scope.projectId),selected=[];progress('before-backup:ready')
    for(const choice of choices){
      const image=await prepareAvgAdoptedGeneratedImageV2({scope:s.scope,choiceId:choice.id!})
      expect(image.source.version).toBe(5)
      if(image.source.version!==5)throw new Error('Source5 required')
      expect(image.source.raw.version).toBe(5)
      expect(parseAvgGeneratedImageSource(image.source)).toEqual(image.source)
      expect(parseAvgGeneratedReferenceSourceV5(image.source)).toEqual(image.source)
      expect(()=>parseAvgGeneratedReferenceSourceV2(image.source)).toThrow()
      expect(()=>parseAvgGeneratedReferenceSourceV2({...image.source,version:2})).toThrow()
      expect(()=>parseAvgGeneratedReferenceSourceV5({...image.source,raw:{...image.source.raw,version:4}})).toThrow()
      expect(()=>parseAvgGeneratedReferenceSourceV5({...image.source,buildId:s.buildId})).toThrow()
      // Structural V4 grammar cannot prove a retagged producer. Its original
      // ordered scalar serialization stays unchanged; actual use still fails.
      const legacy={schema:image.source.schema,version:2 as const,productionKey:image.source.productionKey,requirementKey:image.source.requirementKey,
        raw:{...image.source.raw,version:4 as const},compilation:image.source.compilation,choice:image.source.choice,review:image.source.review}
      expect(JSON.stringify(parseAvgGeneratedReferenceSourceV2(legacy))).toBe(JSON.stringify(legacy))
      await expect(readAvgAdoptedGeneratedImageV2({scope:s.scope,source:legacy})).rejects.toThrow(/V4/)
      const read=await readAvgAdoptedGeneratedImageV2({scope:s.scope,source:image.source})
      expect(read.asset).toEqual(JSON.parse(choice.payloadJson).asset)
      expect(read.data).toEqual((await db.mediaBlobObjects.get(read.blobObjectId))!.data)
      expect(image.source.choice.authorReceiptHash).toBe(JSON.parse(choice.metadataJson).receiptHash)
      const review=(await avgV5Accepted(s,image.source.review.artifactKey))!
      expect(JSON.parse(review.payloadJson).version).toBe(2)
      expect(image.source.review.authorReceiptHash).toBe(JSON.parse(review.metadataJson).receiptHash)
      selected.push(image);progress(`source:${selected.length}:ready`)
    }
    const build=(await db.productBuilds.get(s.buildId))!,boundary={scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,
      controlEpoch:JSON.parse(build.planJson).controlEpoch as number,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash}
    expect((await readAvgHistoricalCompiledImageDefinitionV5(boundary)).definition.mediaBatch).toEqual(s.compiled.definition.mediaBatch)
    await expect(readAvgHistoricalCompiledImageDefinitionV4(boundary)).rejects.toThrow(/原始完整版本/)
    await expect(readAvgImageConsumptionDefinitionV5({scope:s.scope,buildId:s.buildId,brief:s.brief})).rejects.toThrow()
    progress('original-compiler:ready')
    const payload=parseAvgAuthorStageV1({...s.author.source.presentation,stage:{...s.author.source.presentation.stage,
      assets:[...s.author.source.presentation.stage.assets,...selected.map(i=>i.asset)]},
      inheritedImages:selected.map(i=>({assetKey:i.asset.assetKey,source:i.source,declaration:'准确旧图在新演出草稿中保留，仍待本版本作者确认采用'}))})
    const inherit={scope:s.scope,payload,productionKey:s.compiled.production.productionKey,targetBuildNumber:build.buildNumber+1,worldContentHash:s.brief.source.worldContentHash}
    expect((await readAvgInheritedStageImagesV1(inherit)).size).toBe(5);progress('inherited-stage:ready')
    await expect(readAvgInheritedStageImagesV1({...inherit,targetBuildNumber:build.buildNumber})).rejects.toThrow(/当前版本/)
    expect(await stableBackup(s.scope.projectId)).toEqual(before)
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
    expect(build.packageHash).toBe('');expect(build.previewHash).toBe('')
  },60_000)

  it('reproves actual review and choice commands after full remap, rejects missing witnesses and deletes only the restored owner',async()=>{
    const progress=observer('portable-owner'),s=await avgV5MediaReviewFixture(progress),choice=await choose(s,s.rows.find(r=>r.mediaKind==='background')!)
    progress('original-choice:ready')
    await stop(s)
    const original=await prepareAvgAdoptedGeneratedImageV2({scope:s.scope,choiceId:choice.id!})
    if(original.source.version!==5)throw new Error('Source5 required')
    const backup=await exportProjectJSON(s.scope.projectId),projectId=await importProjectJSON(backup)
    progress('full-remap:ready')
    const build=(await db.productBuilds.where('projectId').equals(projectId).first())!,scope={projectId,workId:build.workId!,worldId:build.worldId!}
    useAIConfigStore.getState().setConfig({apiKey:''})
    progress('copy-before-backup:ready')
    const before=await stableBackup(projectId),read=await readAvgAdoptedGeneratedImageV2({scope,source:original.source})
    progress('copy-source:ready')
    expect(read.source).toEqual(original.source);expect(read.asset).toEqual(original.asset)
    const copiedChoice=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,choice.artifactKey]).filter(r=>r.status==='accepted').first())!
    expect(copiedChoice.workId).toBe(scope.workId);expect(copiedChoice.workId).not.toBe(choice.workId)
    expect(await prepareAvgAdoptedGeneratedImageV2({scope,choiceId:copiedChoice.id!})).toEqual(original)
    for(const key of [choice.artifactKey,original.source.review.artifactKey]){
      const row=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,key]).filter(r=>r.status==='accepted').first())!
      const envelope=JSON.parse(row.metadataJson),command=(await db.productProductionCommands.where('[productionId+commandId]').equals([build.productionId,envelope.commandId]).first())!
      expect(command).toMatchObject({type:'adopt-avg-artifact',status:'succeeded',workId:scope.workId})
      expect(JSON.parse(command.resultJson)).toMatchObject({artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash,authorReceiptHash:envelope.receiptHash})
      await db.productProductionCommands.delete(command.id!)
      await expect(readAvgAdoptedGeneratedImageV2({scope,source:original.source})).rejects.toThrow()
      await db.productProductionCommands.add(command)
      await db.productBuildArtifacts.update(row.id!,{rightsJson:'{}'})
      await expect(readAvgAdoptedGeneratedImageV2({scope,source:original.source})).rejects.toThrow(/权利声明/)
      await db.productBuildArtifacts.put(row)
    }
    const compilation=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,original.source.compilation.artifactKey]).filter(r=>r.status==='accepted').first())!
    await db.productBuildArtifacts.update(compilation.id!,{status:'orphaned'})
    await expect(readAvgAdoptedGeneratedImageV2({scope,source:original.source})).rejects.toThrow()
    await db.productBuildArtifacts.put(compilation)
    expect(await stableBackup(projectId)).toEqual(before)
    await deleteWork(scope.workId)
    expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
    expect(await stableBackup(s.scope.projectId)).toEqual({...backup,exportedAt:0})
    expect((await readAvgAdoptedGeneratedImageV2({scope:s.scope,source:original.source})).asset).toEqual(original.asset)
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
  },60_000)

  it('refuses changed portable witnesses, reference licence and missing original response without an imported-asset fallback',async()=>{
    const progress=observer('negative-evidence'),s=await avgV5MediaReviewFixture(progress),choice=await choose(s,s.rows.find(r=>r.mediaKind==='background')!)
    progress('original-choice:ready')
    await stop(s);const image=await prepareAvgAdoptedGeneratedImageV2({scope:s.scope,choiceId:choice.id!})
    if(image.source.version!==5)throw new Error('Source5 required')
    useAIConfigStore.getState().setConfig({apiKey:''})
    const before=await stableBackup(s.scope.projectId)
    for(const source of [{...image.source,review:{...image.source.review,authorReceiptHash:'f'.repeat(64)}},
      {...image.source,raw:{...image.source.raw,responseEvidenceHash:'f'.repeat(64)}},
      {...image.source,compilation:{...image.source.compilation,contentHash:'f'.repeat(64)}}]){
      await expect(readAvgAdoptedGeneratedImageV2({scope:s.scope,source})).rejects.toThrow()
    }
    const reference=s.compiled.definition.mediaBatch.requirements.find(r=>r.requirementKey===image.source.requirementKey)!.references[0]
    const upload=(await db.avgDraftMedia.where('workId').equals(s.scope.workId).filter(r=>JSON.parse(r.assetJson).assetKey===reference.assetKey).first())!
    expect(upload).toBeDefined()
    await db.avgDraftMedia.update(upload.id!,{assetJson:JSON.stringify({...JSON.parse(upload.assetJson),license:'已撤销原使用声明'})})
    await expect(readAvgAdoptedGeneratedImageV2({scope:s.scope,source:image.source})).rejects.toThrow()
    await db.avgDraftMedia.put(upload)
    const responses=await db.agentRunArtifacts.filter(r=>r.projectId===s.scope.projectId&&r.artifactKind==='raw-response'&&r.contentHash===image.source.raw.responseEvidenceHash).toArray()
    expect(responses.length).toBeGreaterThan(0);await db.agentRunArtifacts.bulkDelete(responses.map(r=>r.id!))
    await expect(readAvgAdoptedGeneratedImageV2({scope:s.scope,source:image.source})).rejects.toThrow()
    await db.agentRunArtifacts.bulkAdd(responses)
    expect(await stableBackup(s.scope.projectId)).toEqual(before)
    expect((await readAvgAdoptedGeneratedImageV2({scope:s.scope,source:image.source})).asset).toEqual(image.asset)
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
  },60_000)

  it('rejects an original model proposal changed during asynchronous reference reading instead of returning an authority snapshot',async()=>{
    const progress=observer('source-race'),s=await avgV5MediaReviewFixture(progress);await stop(s);progress('stopped:ready')
    const build=(await db.productBuilds.get(s.buildId))!,before=await stableBackup(s.scope.projectId)
    const input={scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:JSON.parse(build.planJson).controlEpoch as number,
      expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash}
    const proposal=(await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(r=>r.status==='accepted'&&r.artifactKey.startsWith('avg.proposal.')).first())!
    progress('source-before-backup:ready')
    const actual=editorService.readAvgDraftReferenceBytesV2
    const read=vi.spyOn(editorService,'readAvgDraftReferenceBytesV2').mockImplementationOnce(async(...args)=>{
      const bytes=await actual(...args);progress('reference-read:ready')
      await db.productBuildArtifacts.update(proposal.id!,{payloadJson:'{}'});progress('source-mutated:ready')
      return bytes
    })
    await expect(readAvgHistoricalCompiledImageDefinitionV5(input)).rejects.toThrow(/读取期间变化/)
    progress('stale-read:rejected')
    read.mockRestore();await db.productBuildArtifacts.put(proposal);progress('source-restored:ready')
    expect((await readAvgHistoricalCompiledImageDefinitionV5(input)).definition.mediaBatch).toEqual(s.compiled.definition.mediaBatch)
    expect(await stableBackup(s.scope.projectId)).toEqual(before)
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
  },60_000)
})
