import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgV5MediaReviewFixture,avgV5ReviewReport } from '../helpers/avg-v5-media-review-fixture'
import { confirmAvgV5PendingCandidate,avgV5Accepted } from '../helpers/avg-v5-registered-proposals-fixture'
import { stageAvgVisualReviewV2,stageAvgMediaChoiceV5 } from '../../src/lib/avg/visual-review-service-v5'
import { configureAvgChosenMediaDraftV2,stageAvgWorkspaceInputV1,confirmAvgWorkspaceInputV1,runAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { verifyFrozenAvgAuthorInputsV1 } from '../../src/lib/avg/author-artifacts'
import { startProductProductionPreviewV1,recoverImportedProductProductionProofsV1 } from '../../src/lib/product-production/service'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import * as mediaVerifier from '../../src/lib/product-production/media-runtime-verifier'
import { verifyProductBuildTerminalArtifactSetV1 } from '../../src/lib/product-production/artifact-store'

beforeEach(async()=>{
  await db.delete();await db.open()
  useAIConfigStore.getState().setConfig({provider:'agnes',baseUrl:'https://v5-proposal.fixture.invalid/v1',apiKey:'test-only-intercepted-no-external-network',model:'agnes-2.5-flash',temperature:.7,maxTokens:0})
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unconfigured engineering network forbidden')}))
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})

function observeControlledStage(){
  vi.spyOn(mediaVerifier,'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input=>({environment:input.environment,measuredAt:Date.now(),
    assets:input.assets.map(asset=>({assetKey:asset.assetKey,contentHash:asset.contentHash,mimeType:asset.mimeType,mediaClass:'image',status:'decoded',
      decodedWidth:asset.width,decodedHeight:asset.height,decodedDurationMs:null,decodedHasAlpha:asset.assetKey.includes('.keeper.'),
      decodedChannelCount:null,decodedSampleRateHz:null,integratedLufs:null,truePeakDbtp:null,loopSeamDbfs:null,policyFailures:[],failureCode:null}))}))
}
type Fixture=Awaited<ReturnType<typeof avgV5MediaReviewFixture>>
async function choose(s:Fixture,raw:Fixture['rows'][number]){
  const r=JSON.parse(raw.payloadJson).requirement
  const report=await avgV5ReviewReport(r,raw.contentHash,'pass')
  await confirmAvgV5PendingCandidate(s,await stageAvgVisualReviewV2({...s,requirementKey:r.requirementKey,rawVersion:raw.version,
    rawContentHash:raw.contentHash,report,declaration:'逐项模拟工程观察；不签真实美术或商业质量'}))
  return stageAvgMediaChoiceV5({...s,requirementKey:r.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash,
    declaration:'作者独立选择准确工程图及消费用途；不代表真实美术验收'})
}
const configure=async(s:Fixture)=>configureAvgChosenMediaDraftV2({...s,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision})

describe('AVG actual V5 choices enter the existing author draft and formal assembly',()=>{
  it('configures all five slots, independently adopts Stage, and freezes a portable no-new-call Preview through public commands',async()=>{
    const s=await avgV5MediaReviewFixture()
    for(const raw of s.rows)await confirmAvgV5PendingCandidate(s,await choose(s,raw))
    useAIConfigStore.getState().setConfig({apiKey:''})
    db.close();await db.open()
    const before=await readAvgDraftV1(s.scope),changed=parseAvgAuthorWorkspaceV1(before.editorJson)
    changed.scripts[0].lines[0].text+=' changed source'
    await saveAvgAuthorWorkspaceV1(s.scope,before.revision,changed)
    await expect(configure(s)).rejects.toThrow(/系统、文本或画幅已变化/)
    expect(await avgV5Accepted(s,'avg.author.stage')).toBeUndefined()
    await saveAvgAuthorWorkspaceV1(s.scope,(await readAvgDraftV1(s.scope)).revision,parseAvgAuthorWorkspaceV1(before.editorJson))
    const saved=await configure(s),workspace=parseAvgAuthorWorkspaceV1(saved.editorJson)
    expect(workspace.mediaBatch).toBeUndefined();expect(workspace.imageProcessing).toBeUndefined()
    expect(workspace.presentation.stage.assets).toHaveLength(5)
    expect(workspace.systemPlan).toEqual(s.author.source.systemPlan);expect(workspace.scripts).toEqual(s.author.source.scripts)
    for(const r of s.compiled.definition.mediaBatch.requirements){
      expect(workspace.presentation.stage.assets.find(a=>a.assetKey===r.assetKey)?.contentHash).toBe(s.rows.find(raw=>JSON.parse(raw.payloadJson).requirement.requirementKey===r.requirementKey)!.contentHash)
      if(r.consumer.domain==='stage')expect(workspace.presentation.stage.cues).toContainEqual(expect.objectContaining({assetKey:r.assetKey,beatKey:r.triggerBeatKey}))
      else{
        if(workspace.systemPlan.version!==2)throw new Error('Expected native inventory')
        const item=workspace.systemPlan.inventory.items.find(item=>item.key===r.consumer.subjectKey)!,view=r.itemVariantKey===null?item:item.variants.find(v=>v.key===r.itemVariantKey)!
        expect(r.consumer.domain==='inventory'?view.iconAssetKey:view.detailAssetKey).toBe(r.assetKey)
      }
    }
    expect(await avgV5Accepted(s,'avg.author.stage')).toBeUndefined()
    expect((await db.productBuilds.get(s.buildId))!.previewHash).toBe('')
    observeControlledStage()
    const candidate=await stageAvgWorkspaceInputV1({...s,expectedDraftRevision:saved.revision,artifactKey:'avg.author.stage',
      declaration:'独立采用已保存的五用途工程演出；实际解码/艺术须另验'})
    expect(candidate.status).toBe('pending');expect(await avgV5Accepted(s,'avg.author.stage')).toBeUndefined()
    expect((await db.productBuilds.get(s.buildId))!.previewHash).toBe('')
    await confirmAvgWorkspaceInputV1({...s,artifactKey:candidate.artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
    const finished=await runAvgAssemblyV1(s),build=(await db.productBuilds.get(s.buildId))!
    expect(finished.buildStatus,build.failureJson).toBe('preview-ready')
    const preview=await verifyStoredProductBuildPreview(build),module=preview.runtimePackage.modules[0]
    await verifyProductBuildTerminalArtifactSetV1({...s,expectedControlEpoch:build.controlEpoch,expectedPlanHash:build.planHash})
    expect(module.version).toBe(2);expect(module.stage.assets).toEqual(workspace.presentation.stage.assets)
    const author=await verifyFrozenAvgAuthorInputsV1({scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch})
    expect(author.mediaChoices).toHaveLength(5);expect(author.mediaChoices!.every(c=>c.review?.payload.version===2)).toBe(true)
    expect(JSON.parse((await avgV5Accepted(s,'runtime.package'))!.qualityJson).visualPlanning.compilation).toEqual(s.compiled.definition.compilation)
    const session=await startProductProductionPreviewV1({...s,expectedBuildId:build.id!,expectedPreviewHash:build.previewHash!})
    expect((await db.productRuntimeSessions.get(session.sessionId))!.productBuildId).toBe(s.buildId)
    const copyId=await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const copy=(await db.productBuilds.where('projectId').equals(copyId).first())!
    const copyScope={projectId:copyId,worldId:copy.worldId,workId:copy.workId}
    expect((await verifyStoredProductBuildPreview(copy)).previewHash).toBe(preview.previewHash)
    const terminal={scope:copyScope,productionId:copy.productionId,buildId:copy.id!,expectedControlEpoch:copy.controlEpoch,expectedPlanHash:copy.planHash}
    // Import stales completed Run verification. The existing explicit local
    // recovery re-proves it; restoring pixels alone never grants this authority.
    await expect(verifyProductBuildTerminalArtifactSetV1(terminal)).rejects.toThrow()
    await recoverImportedProductProductionProofsV1({scope:copyScope,productionId:copy.productionId})
    await verifyProductBuildTerminalArtifactSetV1(terminal)
    const restored=(await db.productBuilds.get(copy.id!))!
    expect(restored.stateRevision).toBeGreaterThan(copy.stateRevision)
    expect(restored.previewHash).toBe(copy.previewHash);expect(restored.packageHash).toBe(copy.packageHash)
    const copiedAuthor=await verifyFrozenAvgAuthorInputsV1({scope:copyScope,buildId:copy.id!,
      expectedBuildRevision:restored.stateRevision,controlEpoch:restored.controlEpoch})
    expect(copiedAuthor.mediaChoices?.map(c=>({artifact:c.artifact,receipt:c.authorReceiptHash,review:c.review?.authorReceiptHash})))
      .toEqual(author.mediaChoices?.map(c=>({artifact:c.artifact,receipt:c.authorReceiptHash,review:c.review?.authorReceiptHash})))
    const raw=s.rows[0],r=JSON.parse(raw.payloadJson).requirement
    await expect(stageAvgMediaChoiceV5({scope:copyScope,productionId:copy.productionId,requirementKey:r.requirementKey,rawVersion:raw.version,
      rawContentHash:raw.contentHash,declaration:'导入复验不能成为新采用授权'})).rejects.toThrow()
    await expect(runAvgAssemblyV1({scope:copyScope,productionId:copy.productionId})).rejects.toThrow()
    await deleteWork(copy.workId)
    expect((await verifyStoredProductBuildPreview((await db.productBuilds.get(s.buildId))!)).previewHash).toBe(preview.previewHash)
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
  // Multiple independent author commands, frozen verification and a full
  // project round trip. This new integration bound is not a latency target.
  },180_000)

  it('refuses missing or pending choices and stale draft without configuring or adopting a Stage',async()=>{
    const s=await avgV5MediaReviewFixture(),original=await readAvgDraftV1(s.scope)
    await expect(configure(s)).rejects.toThrow()
    const pending=await choose(s,s.rows[0])
    expect(pending.status).toBe('pending')
    await expect(configure(s)).rejects.toThrow()
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(original.editorJson)
    await expect(configureAvgChosenMediaDraftV2({...s,expectedDraftRevision:original.revision+1})).rejects.toThrow(/草稿/)
    expect(await avgV5Accepted(s,'avg.author.stage')).toBeUndefined();expect((await db.productBuilds.get(s.buildId))!.previewHash).toBe('')
    expect(s.calls).toHaveLength(4);expect(s.imageCalls).toHaveLength(5)
  },60_000)
})
