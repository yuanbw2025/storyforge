import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgVisualBatchDraftV1, prepareAvgAssemblyBriefV1, startAvgAssemblyV1, stageAvgWorkspaceInputV1,
  confirmAvgWorkspaceInputV1, runAvgAssemblyV1, stageAvgMediaChoiceV2, configureAvgChosenMediaDraftV2, prepareAvgImageRecoveryBriefV1, keepAvgGeneratedStageDraftV1,stageAvgVisualReviewV1,saveAvgImageProcessingDraftV1,readAvgProcessedImageCandidateBytesV1,readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { readProductProductionDetailsV1, stopProductProductionV1 } from '../../src/lib/product-production/service'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import * as mediaVerifier from '../../src/lib/product-production/media-runtime-verifier'
import type { AvgVisualProductionRequirementV1 } from '../../src/lib/avg/media-production-contract'
import { avgExecutableModule } from '../../src/lib/avg/executable-module'
import { verifyAcceptedProductBuildArtifactV1, verifyRetainedAvgRawImageArtifactV1 } from '../../src/lib/product-production/artifact-store'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import * as mediaBlobStore from '../../src/lib/product-production/media-blob-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { prepareAvgImageRecoveryV1 } from '../../src/lib/avg/media-recovery'
import { prepareAvgGeneratedReferenceImageV1, readAvgGeneratedReferenceBytesV1, readAvgGeneratedReferenceImageV1 } from '../../src/lib/avg/media-generated-reference'
import { createAvgDraftReferenceAdapterV1 } from '../../src/lib/avg/editor-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { readAvgInheritedStageImagesV1 } from '../../src/lib/avg/stage-image-sources'
import { prepareAvgCharacterFamilyProposalV1, saveAvgCharacterFamilyBatchDraftV1 } from '../../src/lib/avg/character-family-service'
import type { AvgCharacterFamilyPlanV1 } from '../../src/lib/avg/character-family-contract'
import { validateAvgVisualProductionBatchSourceV1 } from '../../src/lib/avg/media-source'
import { verifyFrozenAvgAuthorInputsV1 } from '../../src/lib/avg/author-artifacts'
import { avgVisualReviewFixture } from '../helpers/avg-visual-review-fixture'
import { prepareAvgRawImageRequestV1 } from '../../src/lib/avg/media-raw-contract'
import * as imageProcessing from '../../src/lib/avg/image-processing'
import { avgImageProcessingRecipeFixture,avgImageProcessingReceiptFixture } from '../helpers/avg-image-processing-fixture'
import type { AvgImageProcessingPlanV1 } from '../../src/lib/avg/image-processing-contract'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

const requirement = (): AvgVisualProductionRequirementV1 => ({ requirementKey: 'desk.background', revision: 1,
  assetKey: 'avg.generated.desk', name: '原创工程背景', altText: '仅用于管线验证的原创色块',
  family: { subjectKey: 'desk', familyKey: 'desk.day', variantKey: 'day', revision: 1 },
  consumer: { consumerKey: 'desk.background', domain: 'stage', slot: 'background', subjectKey: 'desk', sceneKey: 'desk', lineKey: null, required: true, fallback: 'none' },
  triggerBeatKey: 'line.desk', itemVariantKey: null, mediaKind: 'background', prompt: '原创房间的工程图', negativePrompt: '', invariants: [], forbiddenDepictions: [],
  width: 576, height: 324, resolutionTier: '1K', alpha: 'not-required', references: [] })

async function prepare(requirements = [requirement()],review=false,processing?:AvgImageProcessingPlanV1) {
  const s = await prepareNativeAvgAssembly(), draft = await readAvgDraftV1(s.scope)
  let saved = await saveAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: draft.revision, batchKey: 'engineering.batch', revision: 1, requirements,...(review?{visualReviewPolicy:'author-visual-v1' as const}:{}) })
  if(processing)saved=await saveAvgImageProcessingDraftV1({scope:s.scope,expectedDraftRevision:saved.revision,plan:processing})
  const details = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
  return { ...s, details }
}
async function start(s: Awaited<ReturnType<typeof prepare>>) {
  const details = await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: s.details.brief!.briefHash })
  return { ...s, details, buildId: details.build!.id! }
}
async function confirm(s: Awaited<ReturnType<typeof start>>, artifactKey: string) {
  const draft = await readAvgDraftV1(s.scope)
  const candidate = await stageAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: draft.revision, artifactKey,
    declaration: '确认原创工程输入及准确媒资清单；不代表商业或艺术质量验收' })
  await confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey, candidateVersion: candidate.version,
    candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
}
async function confirmSources(s: Awaited<ReturnType<typeof start>>) {
  for (const key of ['avg.system.plan', ...s.details.executionBrief!.avgAssembly!.sceneKeys.map(key => `avg.content.scene-script.${key}`)]) await confirm(s, key)
}
async function response() {
  const data = new Uint8Array(await deterministicRegionMapPngV1({ width: 576, height: 324, palette: ['#18213b', '#39506b', '#c8dce8'] }))
  let binary = ''; for (let i = 0; i < data.length; i += 16384) binary += String.fromCharCode(...data.subarray(i, i + 16384))
  return JSON.stringify({ data: [{ b64_json: btoa(binary) }] })
}
const secondaryRequirement=():AvgVisualProductionRequirementV1=>({...requirement(),requirementKey:'desk.reference',assetKey:'avg.generated.reference',
  consumer:{consumerKey:'desk.reference',domain:'reference',slot:'style',subjectKey:'desk',sceneKey:null,lineKey:null,required:false,fallback:'omit'},triggerBeatKey:null})
async function recover(s:Awaited<ReturnType<typeof start>>,keys=['desk.background']){
  const build=(await db.productBuilds.get(s.buildId))!
  const prepared=await prepareAvgImageRecoveryBriefV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision,
    expectedBuildId:s.buildId,expectedBuildRevision:build.stateRevision,retainedRequirementKeys:keys,declaration:'明确保留准确原图，仅对未保留项授权新版本中的一次请求；工程校准非艺术验收'})
  return start({...s,details:prepared})
}
async function chooseImage(s: Awaited<ReturnType<typeof start>>, requirementKey: string) {
  const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,`avg.media.raw.${requirementKey}`]).first())!
  const processed=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,`avg.media.processed.${requirementKey}`]).filter(r=>r.status==='accepted').first()
  if(!raw)throw new Error((await db.productBuilds.get(s.buildId))!.failureJson)
  if(s.details.executionBrief!.avgAssembly!.version===2&&s.details.executionBrief!.avgAssembly!.mediaBatch.visualReviewPolicy){
    const current=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,`avg.review.visual.${requirementKey}`]).filter(row=>row.status==='accepted').first()
    if(!current)await reviewImage(s,avgVisualReviewFixture(s.details.executionBrief!.avgAssembly!.mediaBatch.requirements.find(r=>r.requirementKey===requirementKey)!,(processed??raw).contentHash))
  }
  const candidate = await stageAvgMediaChoiceV2({scope:s.scope,productionId:s.productionId,requirementKey,
    rawVersion:raw.version,rawContentHash:raw.contentHash,declaration:'查看准确工程图并明确采用；后续外发和衍生仍须另行授权',...(processed?{processed:{version:processed.version,contentHash:processed.contentHash}}:{})})
  await confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey:candidate.artifactKey,
    candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
  return (await db.productBuildArtifacts.get(candidate.id!))!
}
async function reviewImage(s:Awaited<ReturnType<typeof start>>,report:ReturnType<typeof avgVisualReviewFixture>){
  const raw=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,`avg.media.raw.${report.targetKey}`]).first())!
  const candidate=await stageAvgVisualReviewV1({scope:s.scope,productionId:s.productionId,requirementKey:report.targetKey,rawVersion:raw.version,rawContentHash:raw.contentHash,report,
    declaration:'保存原创工程材料的准确作者问题记录；未知和 blocking 不签选用或商业验收'})
  await confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey:candidate.artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
  return (await db.productBuildArtifacts.get(candidate.id!))!
}

describe('R-AVG-BASE01B · actual public media Harness with controlled HTTP/decoder', () => {
  beforeEach(async () => {
    await db.delete(); await db.open()
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
    useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: 'test-only-agnes-no-network', model: 'agnes-2.5-flash',
      baseUrl: 'https://apihub.agnes-ai.com/v1', temperature: 0.7, maxTokens: 0 })
    // jsdom has no image decoder. Browser E2E must separately prove decoding.
    vi.spyOn(mediaVerifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ environment: input.environment, measuredAt: Date.now(),
      assets: input.assets.map(asset => ({ assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
        mediaClass: 'image', status: 'decoded', decodedWidth: 576, decodedHeight: 324, decodedDurationMs: null, decodedHasAlpha: false,
        decodedChannelCount: null, decodedSampleRateHz: null, integratedLufs: null, truePeakDbtp: null, loopSeamDbfs: null, policyFailures: [], failureCode: null })) }))
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); db.close() })

  it('one POST retains original response, waits for author choice, configures exact bytes and joins the native Preview', async () => {
    const body = await response(), dispatch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'engineering.http.1' } }))
    vi.stubGlobal('fetch', dispatch)
    const s = await start(await prepare())
    await confirmSources(s)
    const generated = await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    const build = (await db.productBuilds.get(s.buildId))!
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(generated.buildStatus, build.failureJson).toBe('building')
    const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background']).filter(row => row.status === 'accepted').first())!
    expect(raw, build.failureJson).toBeDefined()
    await expect(stageAvgMediaChoiceV2({ scope: s.scope, productionId: s.productionId, requirementKey: 'desk.background', rawVersion: raw.version + 1,
      rawContentHash: raw.contentHash, declaration: '错误版本探针' })).rejects.toThrow(/准确/)
    await expect(stageAvgMediaChoiceV2({ scope: s.scope, productionId: s.productionId, requirementKey: 'desk.background', rawVersion: raw.version,
      rawContentHash: 'f'.repeat(64), declaration: '错误 hash 探针' })).rejects.toThrow(/准确/)
    await expect(confirm(s, 'avg.system.plan')).rejects.toThrow(/新建 Build/)
    expect(build.previewHash).toBe('')
    expect(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.choice.desk.background']).count()).toBe(0)
    const evidence = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'raw-response')!
    expect(JSON.parse(evidence.content!).rawText).toBe(body)
    await expect(configureAvgChosenMediaDraftV2({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })).rejects.toThrow()
    const choice = await stageAvgMediaChoiceV2({ scope: s.scope, productionId: s.productionId, requirementKey: 'desk.background', rawVersion: raw.version,
      rawContentHash: raw.contentHash, declaration: '作者选择准确原图用于背景；工程验证不代表艺术验收' })
    expect(choice.status).toBe('pending')
    const blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!, changed = blob.data!.slice(0)
    new Uint8Array(changed)[changed.byteLength - 1] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: changed })
    await expect(confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey: choice.artifactKey, candidateVersion: choice.version,
      candidateHash: JSON.parse(choice.metadataJson).candidateHash })).rejects.toThrow(/哈希/)
    expect((await db.productBuildArtifacts.get(choice.id!))!.status).toBe('pending')
    await db.mediaBlobObjects.update(blob.id!, { data: blob.data })
    await confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey: choice.artifactKey, candidateVersion: choice.version,
      candidateHash: JSON.parse(choice.metadataJson).candidateHash })
    const configured = await configureAvgChosenMediaDraftV2({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const workspace = JSON.parse(configured.editorJson!)
    expect(workspace.presentation.stage.assets[0]).toMatchObject({ assetKey: 'avg.generated.desk', contentHash: raw.contentHash })
    expect(workspace.presentation.stage.cues[0]).toMatchObject({ type: 'set-background', beatKey: 'line.desk', assetKey: 'avg.generated.desk' })
    await confirm(s, 'avg.author.stage')
    db.close(); await db.open()
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '0')
    useAIConfigStore.getState().setConfig({ apiKey: '' })
    const finished = await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(finished.buildStatus, details.build!.failureJson).toBe('preview-ready')
    const preview = await verifyStoredProductBuildPreview(details.build!)
    expect(avgExecutableModule(preview!.runtimePackage)!.stage.assets).toHaveLength(1)
    expect(avgExecutableModule(preview!.runtimePackage)!.stage.assets[0]).toMatchObject({ assetKey: 'avg.generated.desk', contentHash: raw.contentHash })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('a stopped raw image keeps exact read-only provenance and rejects stale, foreign, forged or unaccounted inputs', async () => {
    const body = await response(), dispatch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', dispatch)
    const s = await start(await prepare()); await confirmSources(s)
    await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background']).filter(row => row.status === 'accepted').first())!
    await stopProductProductionV1({ scope: s.scope, production: details.production })
    const build = (await db.productBuilds.get(s.buildId))!
    const input = { scope: s.scope, buildId: build.id!, expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash,
      expectedPlanHash: build.planHash, sourceControlEpoch: raw.controlEpoch, artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash }
    const before = await db.productBuildArtifacts.toArray()
    const proved = await verifyRetainedAvgRawImageArtifactV1(input)
    expect(proved.artifact).toEqual(raw)
    const { proofHash, ...material } = proved.provenance
    expect(proofHash).toBe(await hashProductProductionValueV2(material))
    expect(proved.provenance).toMatchObject({ buildNumber: build.buildNumber, controlEpoch: raw.controlEpoch, artifactVersion: raw.version,
      producerReceiptHash: raw.producerReceiptHash, contentHash: raw.contentHash })
    await expect(verifyAcceptedProductBuildArtifactV1(input)).rejects.toThrow(/revision/)
    await expect(verifyRetainedAvgRawImageArtifactV1({ ...input, expectedBuildRevision: build.stateRevision - 1 })).rejects.toThrow(/冻结版本/)
    await expect(verifyRetainedAvgRawImageArtifactV1({ ...input, expectedPlanHash: 'f'.repeat(64) })).rejects.toThrow(/冻结版本/)
    await expect(verifyRetainedAvgRawImageArtifactV1({ ...input, sourceControlEpoch: build.controlEpoch })).rejects.toThrow(/Plan epoch/)
    await expect(verifyRetainedAvgRawImageArtifactV1({ ...input, version: raw.version + 1 })).rejects.toThrow(/revision/)
    await expect(verifyRetainedAvgRawImageArtifactV1({ ...input, artifactKey: 'avg.system.plan' })).rejects.toThrow(/仅用于 AVG/)
    const foreign = await seedCurrentProductWorld('foreign-retained-image')
    await expect(verifyRetainedAvgRawImageArtifactV1({ ...input, scope: foreign.scope })).rejects.toThrow(/跨 Work/)
    await db.productBuildArtifacts.update(raw.id!, { metadataJson: '{"forged":true}' })
    await expect(verifyRetainedAvgRawImageArtifactV1(input)).rejects.toThrow(/candidate/)
    await db.productBuildArtifacts.put(raw)
    await db.productBuildArtifacts.update(raw.id!, { status: 'orphaned' })
    await expect(verifyRetainedAvgRawImageArtifactV1(input)).rejects.toThrow(/revision/)
    await db.productBuildArtifacts.put(raw)
    const ledger = JSON.parse(build.budgetLedgerJson)
    ledger.tasks['avg.media.generate.desk.background'].status = 'reserved'
    await db.productBuilds.update(build.id!, { budgetLedgerJson: canonicalProductProductionJsonV2(ledger) })
    await expect(verifyRetainedAvgRawImageArtifactV1(input)).rejects.toThrow(/ledger/)
    await db.productBuilds.put(build)
    const changedUsage = JSON.parse(build.budgetLedgerJson)
    changedUsage.tasks['avg.media.generate.desk.background'].usage.mediaCalls = 0
    await db.productBuilds.update(build.id!, { budgetLedgerJson: canonicalProductProductionJsonV2(changedUsage) })
    await expect(verifyRetainedAvgRawImageArtifactV1(input)).rejects.toThrow(/ledger/)
    await db.productBuilds.put(build)
    const blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!, changed = blob.data!.slice(0)
    new Uint8Array(changed)[0] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: changed })
    await expect(verifyRetainedAvgRawImageArtifactV1(input)).rejects.toThrow()
    await db.mediaBlobObjects.put(blob)
    const read = mediaBlobStore.readVerifiedMediaBlobObjectData
    const concurrentChange = vi.spyOn(mediaBlobStore, 'readVerifiedMediaBlobObjectData').mockImplementationOnce(async value => {
      const bytes = await read(value)
      await db.productBuilds.update(build.id!, { stateRevision: build.stateRevision + 1 })
      return bytes
    })
    await expect(verifyRetainedAvgRawImageArtifactV1(input)).rejects.toThrow(/读取期间已变化/)
    concurrentChange.mockRestore(); await db.productBuilds.put(build)
    await db.transaction('rw', scopeTransactionTables(db.productProductions, db.productProductionBriefs, db.productBuilds, db.productBuildArtifacts,
      db.mediaBlobObjects, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, db.agentRunArtifacts), async () => {
      expect((await verifyRetainedAvgRawImageArtifactV1(input)).artifact).toEqual(raw)
    })
    expect(await db.productBuildArtifacts.toArray()).toEqual(before)
    expect(await db.productBuilds.get(build.id!)).toEqual(build)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('a stopped original image retains exact provenance across a real project backup/remap without another POST', async () => {
    const body = await response(), dispatch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', dispatch)
    const s = await start(await prepare()); await confirmSources(s)
    await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    await stopProductProductionV1({ scope: s.scope, production: details.production })
    const before = (await db.productBuilds.get(s.buildId))!
    const original = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background']).filter(row => row.status === 'accepted').first())!
    const sourceProof = await verifyRetainedAvgRawImageArtifactV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: before.stateRevision,
      expectedBriefHash: before.briefHash, expectedPlanHash: before.planHash, sourceControlEpoch: original.controlEpoch,
      artifactKey: original.artifactKey, version: original.version, contentHash: original.contentHash })
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(projectId).first())!
    const scope = { projectId, worldId: build.worldId, workId: build.workId }
    const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!, 'avg.media.raw.desk.background']).filter(row => row.status === 'accepted').first())!
    const proof = await verifyRetainedAvgRawImageArtifactV1({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
      expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash, sourceControlEpoch: raw.controlEpoch,
      artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash })
    expect(proof.artifact.blobObjectId).toBe(raw.blobObjectId)
    expect(raw.blobObjectId).not.toBe(original.blobObjectId)
    expect(proof.provenance).toEqual(sourceProof.provenance)
    expect(proof.provenance).toMatchObject({ planHash: before.planHash, buildNumber: before.buildNumber })
    expect((await db.agentRuns.get(raw.producerRunId!))!.status).toBe('running')
    await expect(verifyAcceptedProductBuildArtifactV1({ scope, buildId: build.id!, artifactKey: raw.artifactKey, version: raw.version,
      contentHash: raw.contentHash })).rejects.toThrow()
    expect(await db.productBuilds.get(s.buildId)).toEqual(before)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('a failed second image retains the first exact producer proof without retrying either HTTP request', async () => {
    const body = await response(), dispatch = vi.fn()
      .mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{"error":{"message":"controlled second-image failure"}}', { status: 401, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', dispatch)
    const second: AvgVisualProductionRequirementV1 = { ...requirement(), requirementKey: 'desk.reference', assetKey: 'avg.generated.reference',
      consumer: { consumerKey: 'desk.reference', domain: 'reference', slot: 'style', subjectKey: 'desk', sceneKey: null, lineKey: null, required: false, fallback: 'omit' }, triggerBeatKey: null }
    const s = await start(await prepare([requirement(), second])); await confirmSources(s)
    expect((await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })).buildStatus).toBe('recovery-required')
    const build = (await db.productBuilds.get(s.buildId))!
    const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background']).filter(row => row.status === 'accepted').first())!
    expect(raw).toBeDefined()
    const input = { scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash,
      expectedPlanHash: build.planHash, sourceControlEpoch: raw.controlEpoch, artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash }
    const before = await db.productBuildArtifacts.toArray()
    const root = await db.agentRuns.get(JSON.parse(build.budgetLedgerJson).rootRunId)
    expect(root!.status).toBe('cancelled')
    await expect(verifyAcceptedProductBuildArtifactV1(input)).rejects.toThrow(/root/)
    expect((await verifyRetainedAvgRawImageArtifactV1(input)).artifact).toEqual(raw)
    expect(await db.productBuildArtifacts.toArray()).toEqual(before)
    expect(await db.productBuilds.get(s.buildId)).toEqual(build)
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('a fresh child revalidates the good image with zero calls, regenerates only the failed item, and compiles after new author choices', async () => {
    const body=await response(),dispatch=vi.fn().mockResolvedValueOnce(new Response(body,{status:200}))
      .mockResolvedValueOnce(new Response('{"error":"controlled failure"}',{status:401})).mockResolvedValueOnce(new Response(body,{status:200}))
    vi.stubGlobal('fetch',dispatch)
    const parent=await start(await prepare([requirement(),secondaryRequirement()]));await confirmSources(parent)
    expect((await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})).buildStatus).toBe('recovery-required')
    const old=(await db.productBuilds.get(parent.buildId))!,original=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([parent.buildId,'avg.media.raw.desk.background']).first())!
    const child=await recover(parent);expect(child.buildId).not.toBe(parent.buildId)
    expect(child.details.executionBrief!.productionBudget.maximumMediaCalls).toBe(1)
    expect(JSON.parse(child.details.build!.planJson).tasks.find((t:any)=>t.taskKey==='avg.media.generate.desk.background')).toMatchObject({kind:'avg-media-image-reuse',executionMode:'deterministic',budgetReservation:{mediaCalls:0}})
    await confirmSources(child)
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('building')
    expect(dispatch).toHaveBeenCalledTimes(3)
    const first=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([child.buildId,original.artifactKey]).first())!
    expect(first).toMatchObject({status:'accepted',payloadJson:original.payloadJson,metadataJson:original.metadataJson,contentHash:original.contentHash,blobObjectId:original.blobObjectId})
    expect(first.producerRunId).not.toBe(original.producerRunId);expect(first.producerReceiptHash).not.toBe(original.producerReceiptHash)
    expect(JSON.parse((await db.productBuilds.get(child.buildId))!.budgetLedgerJson).tasks['avg.media.generate.desk.background'].usage).toMatchObject({mediaCalls:0,costUsd:0})
    expect((await db.agentRunEvents.where('runId').equals(first.producerRunId!).toArray()).some(e=>e.type==='evidence.artifact.recorded'&&JSON.parse(e.payloadJson).artifactKind==='raw-response')).toBe(false)
    expect(await db.productBuildArtifacts.where('buildId').equals(child.buildId).filter(r=>r.artifactKey.startsWith('avg.media.choice.')).count()).toBe(0)
    for(const r of child.details.executionBrief!.avgAssembly!.version===2?child.details.executionBrief!.avgAssembly!.mediaBatch.requirements:[]){
      const raw=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([child.buildId,`avg.media.raw.${r.requirementKey}`]).first())!
      const candidate=await stageAvgMediaChoiceV2({scope:child.scope,productionId:child.productionId,requirementKey:r.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash,declaration:'重新查看并确认当前 Build 的准确原图；工程验证'})
      await confirmAvgWorkspaceInputV1({scope:child.scope,productionId:child.productionId,artifactKey:candidate.artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
    }
    await configureAvgChosenMediaDraftV2({scope:child.scope,productionId:child.productionId,expectedDraftRevision:(await readAvgDraftV1(child.scope)).revision})
    await confirm(child,'avg.author.stage')
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('preview-ready')
    expect(await db.productBuilds.get(parent.buildId)).toEqual(old)
    const importedId=await importProjectJSON(await exportProjectJSON(child.scope.projectId))
    const imported=(await db.productBuilds.where('projectId').equals(importedId).filter(b=>b.buildNumber===2).first())!
    const preview=await verifyStoredProductBuildPreview(imported)
    expect(preview!.runtimePackage.productType).toBe('avg')
    expect(dispatch).toHaveBeenCalledTimes(3)
  },15_000)

  it('repeated child repair verifies retained provenance recursively, including a remapped stopped child', async () => {
    const body=await response(),dispatch=vi.fn().mockResolvedValueOnce(new Response(body,{status:200}))
      .mockResolvedValueOnce(new Response('{}',{status:401})).mockResolvedValueOnce(new Response('{}',{status:401})).mockResolvedValueOnce(new Response(body,{status:200}))
    vi.stubGlobal('fetch',dispatch)
    const parent=await start(await prepare([requirement(),secondaryRequirement()]));await confirmSources(parent)
    await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    const child=await recover(parent);await confirmSources(child)
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('recovery-required')
    const importedId=await importProjectJSON(await exportProjectJSON(child.scope.projectId))
    const imported=(await db.productBuilds.where('projectId').equals(importedId).filter(b=>b.buildNumber===2).first())!
    const remapped={...child,scope:{projectId:importedId,worldId:imported.worldId,workId:imported.workId},productionId:imported.productionId,buildId:imported.id!}
    const grandchild=await recover(remapped);await confirmSources(grandchild)
    expect((await runAvgAssemblyV1({scope:grandchild.scope,productionId:grandchild.productionId})).buildStatus).toBe('building')
    const good=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([grandchild.buildId,'avg.media.raw.desk.background']).first())!
    expect(JSON.parse(good.qualityJson).retainedOrigin.buildNumber).toBe(2)
    expect(JSON.parse((await db.productBuilds.get(grandchild.buildId))!.budgetLedgerJson).tasks['avg.media.generate.desk.background'].usage.mediaCalls).toBe(0)
    expect(dispatch).toHaveBeenCalledTimes(4)
  },15_000)

  it('all-retained recovery works without a key and unknown-result regeneration is rejected before changing the Brief', async () => {
    const body=await response(),dispatch=vi.fn(async()=>new Response(body,{status:200}));vi.stubGlobal('fetch',dispatch)
    const parent=await start(await prepare());await confirmSources(parent);await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    await stopProductProductionV1({scope:parent.scope,production:(await readProductProductionDetailsV1(parent.scope,parent.productionId,['avg'])).production})
    useAIConfigStore.getState().setConfig({apiKey:''})
    const child=await recover(parent);await confirmSources(child)
    expect(child.details.executionBrief!.productionBudget.maximumMediaCalls).toBe(0)
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('building')
    expect(dispatch).toHaveBeenCalledTimes(1)
    useAIConfigStore.getState().setConfig({apiKey:'test-only-agnes-no-network'})
    const unknown=await start(await prepare([requirement(),secondaryRequirement()]));await confirmSources(unknown)
    dispatch.mockImplementationOnce(async()=>new Response(body,{status:200})).mockImplementationOnce(async()=>new Response('{"task_id":"controlled-unknown"}',{status:202}))
    await runAvgAssemblyV1({scope:unknown.scope,productionId:unknown.productionId})
    const before={briefs:await db.productProductionBriefs.count(),builds:await db.productBuilds.count(),runs:await db.agentRuns.count()}
    await expect(recover(unknown)).rejects.toThrow(/未知.*封账|未知的调用/)
    expect({briefs:await db.productProductionBriefs.count(),builds:await db.productBuilds.count(),runs:await db.agentRuns.count()}).toEqual(before)
    expect(dispatch).toHaveBeenCalledTimes(3)
  },15_000)

  it('stale recovery, changed routes, forged proofs and damaged source bytes reject without changing production authority', async () => {
    const body = await response(), dispatch = vi.fn().mockResolvedValueOnce(new Response(body, { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    vi.stubGlobal('fetch', dispatch)
    const parent = await start(await prepare([requirement(), secondaryRequirement()])); await confirmSources(parent)
    await runAvgAssemblyV1({ scope: parent.scope, productionId: parent.productionId })
    const build = (await db.productBuilds.get(parent.buildId))!
    const input = { scope: parent.scope, productionId: parent.productionId, expectedDraftRevision: (await readAvgDraftV1(parent.scope)).revision,
      expectedBuildId: parent.buildId, expectedBuildRevision: build.stateRevision, retainedRequirementKeys: ['desk.background'], declaration: '核对后保留原图' }
    const snapshot = async () => ({ production: await db.productProductions.get(parent.productionId),
      draft: await readAvgDraftV1(parent.scope), briefs: await db.productProductionBriefs.toArray(), builds: await db.productBuilds.toArray(), runs: await db.agentRuns.toArray() })
    const before = await snapshot()
    await expect(prepareAvgImageRecoveryBriefV1({ ...input, expectedBuildRevision: build.stateRevision + 1 })).rejects.toThrow(/停止|失败/)
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://apihub.agnes-ai.com/changed/v1' })
    await expect(prepareAvgImageRecoveryBriefV1(input)).rejects.toThrow(/路由已改变/)
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://apihub.agnes-ai.com/v1' })
    const prepared = await prepareAvgImageRecoveryV1(input), forged = structuredClone(prepared.recovery)
    forged.retained[0].proof.contentHash = 'f'.repeat(64)
    await expect(prepareAvgAssemblyBriefV1({ scope: parent.scope, expectedDraftRevision: input.expectedDraftRevision, imageRecovery: forged })).rejects.toThrow(/准确|证明/)
    const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([parent.buildId, 'avg.media.raw.desk.background']).first())!
    const blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!
    expect(blob.backend).toBe('indexeddb')
    const damaged = new Uint8Array(blob.data!.slice(0)); damaged[0] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: damaged.buffer })
    await expect(prepareAvgImageRecoveryBriefV1(input)).rejects.toThrow(/哈希不匹配/)
    await db.mediaBlobObjects.put(blob)
    expect(await snapshot()).toEqual(before)
    expect(dispatch).toHaveBeenCalledTimes(2)
  }, 15_000)

  it('an author-adopted generated image remains an exact reference after stopped backup import and produces a new native Preview', async () => {
    const body = await response(), dispatch = vi.fn(async () => new Response(body,{status:200,headers:{'content-type':'application/json'}}))
    vi.stubGlobal('fetch',dispatch)
    const parent = await start(await prepare([secondaryRequirement()])); await confirmSources(parent)
    await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    const choice = await chooseImage(parent,'desk.reference')
    const selected = await prepareAvgGeneratedReferenceImageV1({scope:parent.scope,choiceId:choice.id!})
    expect(await db.avgDraftMedia.count()).toBe(0)
    await stopProductProductionV1({scope:parent.scope,production:(await readProductProductionDetailsV1(parent.scope,parent.productionId,['avg'])).production})
    const importedId = await importProjectJSON(await exportProjectJSON(parent.scope.projectId))
    const imported = (await db.productBuilds.where('projectId').equals(importedId).first())!
    const importedScope = {projectId:imported.projectId,worldId:imported.worldId,workId:imported.workId}
    const restored = await readAvgGeneratedReferenceImageV1({scope:importedScope,source:selected.source})
    expect(restored.source).toEqual(selected.source)
    expect(await mediaBlobStore.sha256MediaData(restored.data)).toBe(selected.asset.contentHash)
    const ref = {assetKey:selected.asset.assetKey,assetVersion:selected.asset.version,contentHash:selected.asset.contentHash,
      mimeType:selected.asset.mimeType as 'image/png',byteSize:selected.asset.byteSize,purpose:'composition' as const,allowedChange:'保持房间结构，改为白天光线',
      dataClass:'avg-authorized-reference',license:selected.asset.license,providerInputAllowed:true as const,derivativeUseAllowed:true as const,crop:null,mask:null,generatedSource:selected.source}
    const draft = await readAvgDraftV1(importedScope)
    const saved = await saveAvgVisualBatchDraftV1({scope:importedScope,expectedDraftRevision:draft.revision,batchKey:'derived.reference.batch',revision:1,
      requirements:[{...requirement(),references:[ref]}]})
    const details = await prepareAvgAssemblyBriefV1({scope:importedScope,expectedDraftRevision:saved.revision})
    const child = await start({...parent,scope:importedScope,productionId:imported.productionId,details}); await confirmSources(child)
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('building')
    expect(dispatch).toHaveBeenCalledTimes(2)
    const requestBody = JSON.parse(String(dispatch.mock.calls[1][1]!.body))
    expect(requestBody.extra_body.image).toEqual([`data:image/png;base64,${JSON.parse(body).data[0].b64_json}`])
    const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([child.buildId,'avg.media.raw.desk.background']).first())!
    expect(JSON.parse(raw.payloadJson).request.references[0].generatedSource).toEqual(selected.source)
    expect(JSON.parse(raw.qualityJson).referenceTransmission.references[0].generatedSource).toEqual(selected.source)
    await chooseImage(child,'desk.background')
    await configureAvgChosenMediaDraftV2({scope:child.scope,productionId:child.productionId,expectedDraftRevision:(await readAvgDraftV1(child.scope)).revision})
    await confirm(child,'avg.author.stage')
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('preview-ready')
    expect(await db.avgDraftMedia.count()).toBe(0)
    expect(dispatch).toHaveBeenCalledTimes(2)
  },15_000)

  it('pending, forged, foreign and damaged generated references never fall back to an imported alias or dispatch', async () => {
    const body = await response(), dispatch = vi.fn(async () => new Response(body,{status:200})); vi.stubGlobal('fetch',dispatch)
    const s = await start(await prepare([secondaryRequirement()])); await confirmSources(s); await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,'avg.media.raw.desk.reference']).first())!
    const pending = await stageAvgMediaChoiceV2({scope:s.scope,productionId:s.productionId,requirementKey:'desk.reference',rawVersion:raw.version,rawContentHash:raw.contentHash,declaration:'尚未确认的工程候选'})
    await expect(prepareAvgGeneratedReferenceImageV1({scope:s.scope,choiceId:pending.id!})).rejects.toThrow(/先明确采用/)
    await confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey:pending.artifactKey,candidateVersion:pending.version,candidateHash:JSON.parse(pending.metadataJson).candidateHash})
    const selected = await prepareAvgGeneratedReferenceImageV1({scope:s.scope,choiceId:pending.id!})
    const forged = structuredClone(selected.source); forged.choice.authorReceiptHash='f'.repeat(64)
    await expect(readAvgGeneratedReferenceImageV1({scope:s.scope,source:forged})).rejects.toThrow(/证明已变化/)
    const foreign = await seedCurrentProductWorld('foreign-generated-reference')
    await expect(readAvgGeneratedReferenceImageV1({scope:foreign.scope,source:selected.source})).rejects.toThrow(/跨作品|不存在/)
    // Even an exact imported-looking alias cannot bypass an explicit generated origin.
    await db.avgDraftMedia.add({...s.scope,blobObjectId:raw.blobObjectId!,assetJson:JSON.stringify(selected.asset),createdAt:Date.now()})
    const ref = {assetKey:selected.asset.assetKey,assetVersion:1,contentHash:selected.asset.contentHash,mimeType:'image/png' as const,byteSize:selected.asset.byteSize,
      purpose:'composition' as const,allowedChange:'仅调整照明',dataClass:'avg-authorized-reference',license:selected.asset.license,
      providerInputAllowed:true as const,derivativeUseAllowed:true as const,crop:null,mask:null,generatedSource:forged}
    await expect(readAvgGeneratedReferenceBytesV1(s.scope,{...ref,purpose:'identity',generatedSource:selected.source},
      {...secondaryRequirement().family,subjectKey:'keeper'})).rejects.toThrow(/身份参考.*另一个主体/)
    await expect(readAvgGeneratedReferenceBytesV1(s.scope,{...ref,purpose:'identity',generatedSource:selected.source},
      {...secondaryRequirement().family,revision:2})).rejects.toThrow(/身份基准版本已变化/)
    const frozen = await prepareAvgRawImageRequestV1({brief:s.details.executionBrief!,requirementKey:'desk.reference',idempotencyKey:'a'.repeat(64)})
    const {freezeAvgImageRequestV1}=await import('../../src/lib/avg/media-reference-contract')
    const withReference = await freezeAvgImageRequestV1({request:{...frozen.request,allowedDataClasses:[ref.dataClass]},resolutionTier:'1K',references:[ref]})
    const adapter = await createAvgDraftReferenceAdapterV1({scope:s.scope,frozen:withReference})
    const transport = {request:vi.fn()}
    await expect(adapter.generate({...withReference.request,inputHash:withReference.inputHash},transport,new AbortController().signal)).rejects.toThrow(/证明已变化/)
    expect(transport.request).not.toHaveBeenCalled()
    const blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!, bytes = new Uint8Array(blob.data!.slice(0));bytes[0]^=1
    await db.mediaBlobObjects.update(blob.id!,{data:bytes.buffer})
    await expect(readAvgGeneratedReferenceBytesV1(s.scope,{...ref,generatedSource:selected.source})).rejects.toThrow(/哈希不匹配/)
    expect(dispatch).toHaveBeenCalledTimes(1)
  },15_000)

  it('adopted stage images survive a new V1 Build and backup remap without a provider key or new media calls', async () => {
    const body=await response(),dispatch=vi.fn(async()=>new Response(body,{status:200}));vi.stubGlobal('fetch',dispatch)
    const parent=await start(await prepare());await confirmSources(parent)
    await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId});await chooseImage(parent,'desk.background')
    await configureAvgChosenMediaDraftV2({scope:parent.scope,productionId:parent.productionId,expectedDraftRevision:(await readAvgDraftV1(parent.scope)).revision})
    await confirm(parent,'avg.author.stage');await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    const old=(await db.productBuilds.get(parent.buildId))!,before=await db.productBuildArtifacts.where('buildId').equals(parent.buildId).toArray()
    const draft=await readAvgDraftV1(parent.scope),workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
    workspace.basePreviewHash=old.previewHash
    const saved=await saveAvgAuthorWorkspaceV1(parent.scope,draft.revision,workspace)
    const kept=await keepAvgGeneratedStageDraftV1({scope:parent.scope,productionId:parent.productionId,expectedDraftRevision:saved.revision,expectedBuildId:parent.buildId})
    const next=parseAvgAuthorWorkspaceV1(kept.editorJson)
    expect(next.mediaBatch).toBeUndefined();expect(next.presentation.inheritedImages).toHaveLength(1)
    expect(next.presentation.stage.assets).toEqual(workspace.presentation.stage.assets)
    useAIConfigStore.getState().setConfig({apiKey:''})
    const details=await prepareAvgAssemblyBriefV1({scope:parent.scope,expectedDraftRevision:kept.revision})
    const child=await start({...parent,details});await confirmSources(child);await confirm(child,'avg.author.stage')
    const result=await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})
    expect(result.buildStatus,(await db.productBuilds.get(child.buildId))!.failureJson).toBe('preview-ready')
    expect(child.details.executionBrief!.avgAssembly!.version).toBe(1);expect(dispatch).toHaveBeenCalledTimes(1)
    expect(await db.productBuilds.get(parent.buildId)).toEqual(old)
    expect(await db.productBuildArtifacts.where('buildId').equals(parent.buildId).toArray()).toEqual(before)
    const importedId=await importProjectJSON(await exportProjectJSON(parent.scope.projectId))
    const imported=(await db.productBuilds.where('projectId').equals(importedId).filter(b=>b.buildNumber===2).first())!
    const scope={projectId:importedId,worldId:imported.worldId,workId:imported.workId}
    const restored=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(scope)).editorJson)
    expect(restored.presentation.inheritedImages).toEqual(next.presentation.inheritedImages)
    expect((await readAvgInheritedStageImagesV1({scope,payload:restored.presentation,productionKey:details.production.productionKey,targetBuildNumber:2,
      worldContentHash:details.executionBrief!.source.worldContentHash})).size).toBe(1)
    expect((await verifyFrozenAvgAuthorInputsV1({scope,buildId:imported.id!,expectedBuildRevision:imported.stateRevision,controlEpoch:imported.controlEpoch})).authorStage!.payload.inheritedImages).toEqual(next.presentation.inheritedImages)
    expect(await db.avgDraftMedia.count()).toBe(0);expect(dispatch).toHaveBeenCalledTimes(1)
  },15_000)

  it('a different image batch retains old stage pixels, rejects forged inheritance, and re-adopts the combined stage', async () => {
    const body=await response(),dispatch=vi.fn(async()=>new Response(body,{status:200}));vi.stubGlobal('fetch',dispatch)
    const parent=await start(await prepare());await confirmSources(parent);await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    await chooseImage(parent,'desk.background')
    await configureAvgChosenMediaDraftV2({scope:parent.scope,productionId:parent.productionId,expectedDraftRevision:(await readAvgDraftV1(parent.scope)).revision})
    await confirm(parent,'avg.author.stage');await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    const old=(await db.productBuilds.get(parent.buildId))!,draft=await readAvgDraftV1(parent.scope),workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
    workspace.basePreviewHash=old.previewHash;await saveAvgAuthorWorkspaceV1(parent.scope,draft.revision,workspace)
    const saved=await saveAvgVisualBatchDraftV1({scope:parent.scope,expectedDraftRevision:(await readAvgDraftV1(parent.scope)).revision,batchKey:'second.batch',revision:1,requirements:[secondaryRequirement()]})
    const details=await prepareAvgAssemblyBriefV1({scope:parent.scope,expectedDraftRevision:saved.revision})
    const inherited=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(parent.scope)).editorJson).presentation
    const read={scope:parent.scope,payload:inherited,productionKey:details.production.productionKey,targetBuildNumber:2,worldContentHash:details.executionBrief!.source.worldContentHash}
    await expect(readAvgInheritedStageImagesV1({...read,targetBuildNumber:1})).rejects.toThrow(/旧版/)
    await expect(readAvgInheritedStageImagesV1({...read,worldContentHash:'f'.repeat(64)})).rejects.toThrow(/旧版/)
    const forged=structuredClone(inherited);forged.inheritedImages![0].source.choice.authorReceiptHash='f'.repeat(64)
    await expect(readAvgInheritedStageImagesV1({...read,payload:forged})).rejects.toThrow(/证明已变化/)
    const wrongAsset=structuredClone(inherited);wrongAsset.stage.assets[0].license='伪造授权'
    await expect(readAvgInheritedStageImagesV1({...read,payload:wrongAsset})).rejects.toThrow(/旧版/)
    const child=await start({...parent,details});await confirmSources(child);await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})
    await chooseImage(child,'desk.reference')
    await configureAvgChosenMediaDraftV2({scope:child.scope,productionId:child.productionId,expectedDraftRevision:(await readAvgDraftV1(child.scope)).revision})
    await confirm(child,'avg.author.stage')
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('preview-ready')
    expect(await db.productBuilds.get(parent.buildId)).toEqual(old);expect(dispatch).toHaveBeenCalledTimes(2)
    expect(parseAvgAuthorWorkspaceV1((await readAvgDraftV1(child.scope)).editorJson).presentation.stage.assets).toEqual(workspace.presentation.stage.assets)
  },15_000)

  it('an explicitly revised same-key image replaces only the inherited draft version and keeps the old Build immutable',async()=>{
    const body=await response(),dispatch=vi.fn(async()=>new Response(body,{status:200}));vi.stubGlobal('fetch',dispatch)
    const parent=await start(await prepare());await confirmSources(parent);await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId});await chooseImage(parent,'desk.background')
    await configureAvgChosenMediaDraftV2({scope:parent.scope,productionId:parent.productionId,expectedDraftRevision:(await readAvgDraftV1(parent.scope)).revision})
    await confirm(parent,'avg.author.stage');await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    const old=(await db.productBuilds.get(parent.buildId))!,draft=await readAvgDraftV1(parent.scope),workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
    workspace.basePreviewHash=old.previewHash;const edited=await saveAvgAuthorWorkspaceV1(parent.scope,draft.revision,workspace)
    const saved=await saveAvgVisualBatchDraftV1({scope:parent.scope,expectedDraftRevision:edited.revision,batchKey:'revised.desk',revision:2,
      requirements:[{...requirement(),revision:2,name:'修订后的准确背景',prompt:'同一主体的明确新版本'}]})
    const details=await prepareAvgAssemblyBriefV1({scope:parent.scope,expectedDraftRevision:saved.revision}),child=await start({...parent,details})
    await confirmSources(child);await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId});await chooseImage(child,'desk.background')
    await configureAvgChosenMediaDraftV2({scope:child.scope,productionId:child.productionId,expectedDraftRevision:(await readAvgDraftV1(child.scope)).revision})
    const next=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(child.scope)).editorJson)
    expect(next.presentation.stage.assets).toHaveLength(1);expect(next.presentation.stage.assets[0].name).toBe('修订后的准确背景')
    expect(next.presentation.inheritedImages).toBeUndefined()
    await confirm(child,'avg.author.stage')
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('preview-ready')
    expect(await db.productBuilds.get(parent.buildId)).toEqual(old);expect(dispatch).toHaveBeenCalledTimes(2)
  },15_000)

  it('one reviewed identity plan creates two exact family requests, retains the prior background and reaches native Preview',async()=>{
    const body=await response(),dispatch=vi.fn(async()=>new Response(body,{status:200}));vi.stubGlobal('fetch',dispatch)
    const baseline:AvgVisualProductionRequirementV1={...secondaryRequirement(),requirementKey:'keeper.base',assetKey:'avg.keeper.base',mediaKind:'character-pose',
      family:{subjectKey:'keeper',familyKey:'keeper.identity',variantKey:'base',revision:1},consumer:{...secondaryRequirement().consumer,consumerKey:'keeper.base',subjectKey:'keeper',slot:'identity'}}
    const parent=await start(await prepare([requirement(),baseline]));await confirmSources(parent);await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    await chooseImage(parent,'desk.background');const source=await chooseImage(parent,'keeper.base')
    const selected=await prepareAvgGeneratedReferenceImageV1({scope:parent.scope,choiceId:source.id!})
    await configureAvgChosenMediaDraftV2({scope:parent.scope,productionId:parent.productionId,expectedDraftRevision:(await readAvgDraftV1(parent.scope)).revision})
    await confirm(parent,'avg.author.stage');await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    const old=(await db.productBuilds.get(parent.buildId))!,draft=await readAvgDraftV1(parent.scope),workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
    workspace.basePreviewHash=old.previewHash;const saved=await saveAvgAuthorWorkspaceV1(parent.scope,draft.revision,workspace)
    const plan:AvgCharacterFamilyPlanV1={schema:'storyforge.avg.character-family-plan',version:1,familyKey:'keeper.identity',revision:1,subjectKey:'keeper',name:'保管员',
      baseline:{assetKey:selected.asset.assetKey,assetVersion:selected.asset.version,contentHash:selected.asset.contentHash,mimeType:selected.asset.mimeType,byteSize:selected.asset.byteSize,license:selected.asset.license,generatedSource:selected.source},
      stylePrompt:'原创工程人物，同一画布与机位',identityInvariants:['面部与服装不变'],negativePrompt:'',forbiddenDepictions:[],allowedChange:'仅改变表情',width:576,height:324,resolutionTier:'1K',alpha:'not-required',
      variants:[{variantKey:'neutral',name:'平静',mediaKind:'character-expression',changeDescription:'平静表情',sceneKey:'desk',lineKey:'line.desk'},
        {variantKey:'smile',name:'微笑',mediaKind:'character-expression',changeDescription:'轻微微笑',sceneKey:'wait',lineKey:'line.wait'}]}
    const proposal=await prepareAvgCharacterFamilyProposalV1({scope:parent.scope,expectedDraftRevision:saved.revision,plan})
    const approval={proposalHash:proposal.proposalHash,providerInputAllowed:true,derivativeUseAllowed:true,declaration:'本批全部参考外发与衍生授权，仅验证工程链路'}
    await expect(saveAvgCharacterFamilyBatchDraftV1({scope:parent.scope,expectedDraftRevision:saved.revision,proposal,approval:{...approval,derivativeUseAllowed:false}})).rejects.toThrow(/授权/)
    const altered=structuredClone(proposal);altered.plan.variants[0].changeDescription='擅自修改'
    await expect(saveAvgCharacterFamilyBatchDraftV1({scope:parent.scope,expectedDraftRevision:saved.revision,proposal:altered,approval})).rejects.toThrow(/变化/)
    expect(dispatch).toHaveBeenCalledTimes(2)
    const family=await saveAvgCharacterFamilyBatchDraftV1({scope:parent.scope,expectedDraftRevision:saved.revision,proposal,approval})
    const stored=parseAvgAuthorWorkspaceV1(family.editorJson)
    expect(stored.mediaBatch!.characterFamily!.proposal).toEqual(proposal)
    const forged=structuredClone(stored.mediaBatch!);forged.requirements[0].invariants=[]
    await expect(validateAvgVisualProductionBatchSourceV1(forged,stored)).rejects.toThrow(/家族提案/)
    await expect(saveAvgVisualBatchDraftV1({scope:parent.scope,expectedDraftRevision:family.revision,batchKey:'discard.family',revision:1,requirements:[requirement()]})).rejects.toThrow(/家族编辑/)
    const details=await prepareAvgAssemblyBriefV1({scope:parent.scope,expectedDraftRevision:family.revision})
    const child=await start({...parent,details});await confirmSources(child);await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})
    for(const r of stored.mediaBatch!.requirements)await chooseImage(child,r.requirementKey)
    expect(dispatch).toHaveBeenCalledTimes(4)
    for(const call of dispatch.mock.calls.slice(2))expect(JSON.parse(String(call[1]!.body)).extra_body.image).toEqual([`data:image/png;base64,${JSON.parse(body).data[0].b64_json}`])
    await configureAvgChosenMediaDraftV2({scope:child.scope,productionId:child.productionId,expectedDraftRevision:(await readAvgDraftV1(child.scope)).revision})
    await confirm(child,'avg.author.stage')
    const result=await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})
    expect(result.buildStatus,(await db.productBuilds.get(child.buildId))!.failureJson).toBe('preview-ready')
    const next=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(child.scope)).editorJson)
    expect(next.presentation.stage.assets).toHaveLength(3);expect(next.presentation.inheritedImages).toHaveLength(1)
    expect(await db.productBuilds.get(parent.buildId)).toEqual(old);expect(await db.avgDraftMedia.count()).toBe(0)
    // Reviewing another revision does not clear the old family on its own, and
    // changing the saved draft invalidates that exact replacement proposal.
    const replacement=await prepareAvgCharacterFamilyProposalV1({scope:child.scope,expectedDraftRevision:(await readAvgDraftV1(child.scope)).revision,plan})
    const current=await readAvgDraftV1(child.scope);await saveAvgAuthorWorkspaceV1(child.scope,current.revision,next)
    await expect(saveAvgCharacterFamilyBatchDraftV1({scope:child.scope,expectedDraftRevision:current.revision,proposal:replacement,approval:{...approval,proposalHash:replacement.proposalHash}})).rejects.toThrow(/草稿已变化/)
    expect(dispatch).toHaveBeenCalledTimes(4)
  },15_000)

  it('unknown and blocking reviews persist without selecting; a revised exact review enables author choice and survives backup lineage',async()=>{
    const body=await response(),dispatch=vi.fn(async()=>new Response(body,{status:200}));vi.stubGlobal('fetch',dispatch)
    const s=await start(await prepare([requirement()],true));await confirmSources(s);await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const raw=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,'avg.media.raw.desk.background']).first())!
    const select=()=>stageAvgMediaChoiceV2({scope:s.scope,productionId:s.productionId,requirementKey:'desk.background',rawVersion:raw.version,rawContentHash:raw.contentHash,declaration:'准确选图探针'})
    await expect(select()).rejects.toThrow(/未采用/)
    const unknown=avgVisualReviewFixture(requirement(),raw.contentHash);unknown.visualEvidence!.note='尚未观察构图';unknown.unobserved=['未观察构图'];unknown.visualEvidence!.checks.find(c=>c.criterion==='composition')!.result='unknown'
    const recorded=await reviewImage(s,unknown);expect(recorded.status).toBe('accepted')
    await expect(select()).rejects.toThrow(/未观察|blocking/)
    const blocked=avgVisualReviewFixture(requirement(),raw.contentHash);blocked.visualEvidence!.note='记录工程构图控制问题';blocked.visualEvidence!.checks.find(c=>c.criterion==='composition')!.result='fail';blocked.visualEvidence!.checks.find(c=>c.criterion==='composition')!.note='主体被裁断'
    blocked.issues=[{issueKey:'visual.composition',locationKey:requirement().assetKey,evidence:'主体被裁断',severity:'blocking',owner:'media',allowedChange:'保留身份并修订构图',impact:'不可选用',recheck:'重新检查完整主体'}]
    await reviewImage(s,blocked);await expect(select()).rejects.toThrow(/blocking/)
    await reviewImage(s,avgVisualReviewFixture(requirement(),raw.contentHash))
    const forged=avgVisualReviewFixture(requirement(),'f'.repeat(64))
    await expect(reviewImage(s,forged)).rejects.toThrow(/准确原图/)
    const blob=(await db.mediaBlobObjects.get(raw.blobObjectId!))!,damaged=new Uint8Array(blob.data!.slice(0));damaged[0]^=1
    await db.mediaBlobObjects.update(blob.id!,{data:damaged.buffer})
    await expect(select()).rejects.toThrow(/哈希不匹配/)
    await db.mediaBlobObjects.put(blob)
    const choice=await chooseImage(s,'desk.background')
    expect(JSON.parse(choice.metadataJson).candidate.inputs.map((r:{artifactKey:string})=>r.artifactKey)).toEqual(['avg.media.raw.desk.background','avg.review.visual.desk.background'])
    await configureAvgChosenMediaDraftV2({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision});await confirm(s,'avg.author.stage')
    const result=await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    expect(result.buildStatus,(await db.productBuilds.get(s.buildId))!.failureJson).toBe('preview-ready')
    const source=await prepareAvgGeneratedReferenceImageV1({scope:s.scope,choiceId:choice.id!})
    const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
    const scope={projectId,worldId:build.worldId,workId:build.workId}
    expect((await readAvgGeneratedReferenceImageV1({scope,source:source.source})).asset).toEqual(source.asset)
    expect(await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(row=>row.artifactKey==='avg.review.visual.desk.background').count()).toBe(3)
    expect(dispatch).toHaveBeenCalledTimes(1)
  },15_000)

  it('a new blocking review invalidates a selected image and stage, then cannot change a consumed review without a new Build',async()=>{
    const body=await response(),dispatch=vi.fn(async()=>new Response(body,{status:200}));vi.stubGlobal('fetch',dispatch)
    const s=await start(await prepare([requirement()],true));await confirmSources(s);await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const choice=await chooseImage(s,'desk.background')
    await configureAvgChosenMediaDraftV2({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision});await confirm(s,'avg.author.stage')
    const report=avgVisualReviewFixture(requirement(),JSON.parse(choice.payloadJson).raw.contentHash);report.unobserved=['需要再次检查文字安全区'];report.visualEvidence!.checks.find(c=>c.criterion==='composition')!.result='unknown'
    await reviewImage(s,report)
    expect((await db.productBuildArtifacts.get(choice.id!))!.status).toBe('invalid')
    expect(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,'avg.author.stage']).filter(row=>row.status==='accepted').count()).toBe(0)
    expect((await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})).buildStatus).toBe('building')
    await expect(reviewImage(s,avgVisualReviewFixture(requirement(),JSON.parse(choice.payloadJson).raw.contentHash))).rejects.toThrow(/执行消费/)
    await stopProductProductionV1({scope:s.scope,production:(await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).production})
    const beforeRecovery=await readAvgDraftV1(s.scope)
    await expect(keepAvgGeneratedStageDraftV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:beforeRecovery.revision,expectedBuildId:s.buildId})).rejects.toThrow(/没有可保留/)
    expect(await readAvgDraftV1(s.scope)).toEqual(beforeRecovery)
    const child=await recover(s);await confirmSources(child)
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('building')
    await chooseImage(child,'desk.background')
    await configureAvgChosenMediaDraftV2({scope:child.scope,productionId:child.productionId,expectedDraftRevision:(await readAvgDraftV1(child.scope)).revision});await confirm(child,'avg.author.stage')
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('preview-ready')
    expect(dispatch).toHaveBeenCalledTimes(1)
  },15_000)

  it('freezes a separate local recipe, uses a zero-provider processing Run and adopts only its reviewed exact derivative through preview and portable source',async()=>{
    const body=await response(),dispatch=vi.fn(async()=>new Response(body,{status:200}));vi.stubGlobal('fetch',dispatch)
    const output=await deterministicRegionMapPngV1({width:576,height:324,palette:['#230024','#714576','#f0caff']})
    const process=vi.spyOn(imageProcessing,'processAvgImageBytesV1').mockImplementation(async input=>({data:output,
      receipt:await avgImageProcessingReceiptFixture({recipe:input.recipe,source:{...input.source,byteSize:input.data.byteLength},data:output})}))
    const plan:AvgImageProcessingPlanV1={schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:'desk.background',recipe:avgImageProcessingRecipeFixture()}]}
    const s=await start(await prepare([requirement()],true,plan));await confirmSources(s)
    await expect(saveAvgImageProcessingDraftV1({scope:s.scope,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision,plan:null})).rejects.toThrow(/已开始/)
    const result=await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const raw=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,'avg.media.raw.desk.background']).first())!
    const image=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,'avg.media.processed.desk.background']).first())!
    expect(image,(await db.productBuilds.get(s.buildId))!.failureJson).toBeDefined();expect(result.buildStatus).toBe('building')
    expect(image.contentHash).not.toBe(raw.contentHash);expect(image.blobObjectId).not.toBe(raw.blobObjectId)
    expect(image.producerReceiptHash).not.toBe(raw.producerReceiptHash)
    expect((await readAvgAssemblyWorkspaceV1(s.scope)).artifacts.some(row=>row.artifactKey===image.artifactKey)).toBe(true)
    expect(JSON.parse(image.payloadJson)).toMatchObject({raw:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash,producerReceiptHash:raw.producerReceiptHash},recipe:plan.entries[0].recipe})
    const ledger=JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks['avg.media.process.desk.background']
    expect(ledger).toMatchObject({status:'settled',usage:{mediaCalls:0,modelCalls:0,costUsd:0}})
    await expect(stageAvgMediaChoiceV2({scope:s.scope,productionId:s.productionId,requirementKey:'desk.background',rawVersion:raw.version,rawContentHash:raw.contentHash,declaration:'不能跳过已冻结加工'})).rejects.toThrow(/加工图/)
    await expect(reviewImage(s,avgVisualReviewFixture(requirement(),raw.contentHash))).rejects.toThrow(/准确原图/)
    const bytes=await readAvgProcessedImageCandidateBytesV1({scope:s.scope,productionId:s.productionId,requirementKey:'desk.background',version:image.version,contentHash:image.contentHash})
    expect(bytes.data).toEqual(output)
    const choice=await chooseImage(s,'desk.background'),payload=JSON.parse(choice.payloadJson)
    expect(payload).toMatchObject({version:2,raw:{contentHash:raw.contentHash},processed:{artifactKey:image.artifactKey,contentHash:image.contentHash},asset:{source:'storyforge.avg.local-canvas.v1',version:2,contentHash:image.contentHash}})
    expect(JSON.parse(choice.metadataJson).candidate.inputs.map((r:{artifactKey:string})=>r.artifactKey)).toEqual([raw.artifactKey,image.artifactKey,'avg.review.visual.desk.background'])
    await configureAvgChosenMediaDraftV2({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision});await confirm(s,'avg.author.stage')
    expect((await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})).buildStatus).toBe('preview-ready')
    const source=await prepareAvgGeneratedReferenceImageV1({scope:s.scope,choiceId:choice.id!})
    expect(source.source).toMatchObject({raw:{contentHash:raw.contentHash},processing:{contentHash:image.contentHash,producerReceiptHash:image.producerReceiptHash}})
    const oldBuild=(await db.productBuilds.get(s.buildId))!,draft=await readAvgDraftV1(s.scope),workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
    workspace.basePreviewHash=oldBuild.previewHash
    const saved=await saveAvgAuthorWorkspaceV1(s.scope,draft.revision,workspace)
    const kept=await keepAvgGeneratedStageDraftV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:saved.revision,expectedBuildId:s.buildId})
    expect(parseAvgAuthorWorkspaceV1(kept.editorJson).imageProcessing).toBeUndefined()
    expect(parseAvgAuthorWorkspaceV1(kept.editorJson).presentation.inheritedImages![0].source.processing!.contentHash).toBe(image.contentHash)
    useAIConfigStore.getState().setConfig({apiKey:''})
    const details=await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:kept.revision}),child=await start({...s,details})
    await confirmSources(child);await confirm(child,'avg.author.stage')
    expect((await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})).buildStatus).toBe('preview-ready')
    expect(await db.productBuilds.get(s.buildId)).toEqual(oldBuild)
    const importedId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(importedId).first())!
    const scope={projectId:importedId,worldId:build.worldId,workId:build.workId}
    expect((await readAvgGeneratedReferenceImageV1({scope,source:source.source})).data).toEqual(output)
    const damaged=structuredClone(source.source);damaged.processing!.producerReceiptHash='f'.repeat(64)
    await expect(readAvgGeneratedReferenceImageV1({scope,source:damaged})).rejects.toThrow(/证明/)
    const importedImage=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,'avg.media.processed.desk.background']).first())!
    const stored=(await db.mediaBlobObjects.get(importedImage.blobObjectId!))!,corrupt=new Uint8Array(stored.data!.slice(0));corrupt[0]^=1
    await db.mediaBlobObjects.update(stored.id!,{data:corrupt.buffer})
    await expect(readAvgGeneratedReferenceImageV1({scope,source:source.source})).rejects.toThrow(/哈希/)
    await db.mediaBlobObjects.put(stored)
    const sweep=await mediaBlobStore.collectUnreferencedMediaBlobObjects({scope})
    expect(sweep.retained).toContain(importedImage.blobObjectId)
    const importedRaw=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,'avg.media.raw.desk.background']).first())!
    expect(sweep.retained).toContain(importedRaw.blobObjectId)
    await deleteWork(scope.workId)
    expect(await db.productBuildArtifacts.where('workId').equals(scope.workId).count()).toBe(0)
    expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
    expect((await readAvgGeneratedReferenceImageV1({scope:s.scope,source:source.source})).data).toEqual(output)
    expect(dispatch).toHaveBeenCalledTimes(1);expect(process).toHaveBeenCalledTimes(1);expect(await db.avgDraftMedia.count()).toBe(0)
  },20_000)

  it('a rejected derivative can be reprocessed in an explicit child without changing the original request, recharging it or inheriting rejected use',async()=>{
    const body=await response(),dispatch=vi.fn(async()=>new Response(body,{status:200}));vi.stubGlobal('fetch',dispatch)
    const outputA=await deterministicRegionMapPngV1({width:576,height:324,palette:['#230024','#714576','#f0caff']}),outputB=await deterministicRegionMapPngV1({width:576,height:324,palette:['#002430','#457671','#caf0ff']})
    const process=vi.spyOn(imageProcessing,'processAvgImageBytesV1').mockImplementation(async input=>{
      const data=input.recipe.fit==='cover'?outputB:outputA
      return {data,receipt:await avgImageProcessingReceiptFixture({recipe:input.recipe,source:{...input.source,byteSize:input.data.byteLength},data})}
    })
    const plan:AvgImageProcessingPlanV1={schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:'desk.background',recipe:avgImageProcessingRecipeFixture()}]}
    const parent=await start(await prepare([requirement()],true,plan));await confirmSources(parent);await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    const choice=await chooseImage(parent,'desk.background'),oldChoice=JSON.parse(choice.payloadJson)
    await configureAvgChosenMediaDraftV2({scope:parent.scope,productionId:parent.productionId,expectedDraftRevision:(await readAvgDraftV1(parent.scope)).revision});await confirm(parent,'avg.author.stage')
    const unknown=avgVisualReviewFixture(requirement(),oldChoice.asset.contentHash);unknown.unobserved=['构图需要重新核对'];unknown.visualEvidence!.checks.find(c=>c.criterion==='composition')!.result='unknown'
    await reviewImage(parent,unknown);await runAvgAssemblyV1({scope:parent.scope,productionId:parent.productionId})
    await stopProductProductionV1({scope:parent.scope,production:(await readProductProductionDetailsV1(parent.scope,parent.productionId,['avg'])).production})
    const before=await readAvgDraftV1(parent.scope)
    await expect(keepAvgGeneratedStageDraftV1({scope:parent.scope,productionId:parent.productionId,expectedDraftRevision:before.revision,expectedBuildId:parent.buildId})).rejects.toThrow(/没有可保留/)
    const updated=structuredClone(plan);updated.entries[0].recipe.fit='cover';updated.entries[0].recipe.declaration='明确保留原图并在新版本调整适配；旧意见和加工图均保留'
    await saveAvgImageProcessingDraftV1({scope:parent.scope,expectedDraftRevision:before.revision,plan:updated})
    const oldRaw=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([parent.buildId,'avg.media.raw.desk.background']).first())!
    useAIConfigStore.getState().setConfig({apiKey:''})
    const child=await recover(parent);await confirmSources(child)
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('building')
    const newRaw=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([child.buildId,'avg.media.raw.desk.background']).first())!
    expect(newRaw.payloadJson).toBe(oldRaw.payloadJson);expect(newRaw.blobObjectId).toBe(oldRaw.blobObjectId)
    const image=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([child.buildId,'avg.media.processed.desk.background']).first())!
    expect(image.contentHash).not.toBe(oldChoice.asset.contentHash)
    await expect(reviewImage(child,avgVisualReviewFixture(requirement(),oldChoice.asset.contentHash))).rejects.toThrow(/准确原图/)
    await chooseImage(child,'desk.background')
    const draft=await readAvgDraftV1(child.scope),forged=parseAvgAuthorWorkspaceV1(draft.editorJson);forged.presentation.stage.assets[0].license='不同的未授权编辑图片'
    await saveAvgAuthorWorkspaceV1(child.scope,draft.revision,forged)
    await expect(configureAvgChosenMediaDraftV2({scope:child.scope,productionId:child.productionId,expectedDraftRevision:(await readAvgDraftV1(child.scope)).revision})).rejects.toThrow(/同 key/)
    await saveAvgAuthorWorkspaceV1(child.scope,(await readAvgDraftV1(child.scope)).revision,parseAvgAuthorWorkspaceV1(draft.editorJson))
    await configureAvgChosenMediaDraftV2({scope:child.scope,productionId:child.productionId,expectedDraftRevision:(await readAvgDraftV1(child.scope)).revision});await confirm(child,'avg.author.stage')
    expect((await runAvgAssemblyV1({scope:child.scope,productionId:child.productionId})).buildStatus).toBe('preview-ready')
    expect(dispatch).toHaveBeenCalledTimes(1);expect(process).toHaveBeenCalledTimes(2)
    expect((await db.productBuildArtifacts.get(choice.id!))!.status).toBe('invalid');expect(await db.avgDraftMedia.count()).toBe(0)
  },20_000)

  it('a local processing failure retains its original, exposes a blocked zero-call task and never silently reruns it',async()=>{
    const body=await response(),dispatch=vi.fn(async()=>new Response(body,{status:200}));vi.stubGlobal('fetch',dispatch)
    const process=vi.spyOn(imageProcessing,'processAvgImageBytesV1').mockRejectedValue(new Error('controlled local processing failure; original retained'))
    const plan:AvgImageProcessingPlanV1={schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:'desk.background',recipe:avgImageProcessingRecipeFixture()}]}
    const s=await start(await prepare([requirement()],true,plan));await confirmSources(s)
    const result=await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    expect(result.tasks.find(t=>t.taskKey==='avg.media.process.desk.background')?.status).toBe('blocked')
    const view=await readAvgAssemblyWorkspaceV1(s.scope)
    expect(view.processingTasks).toHaveLength(1);expect(view.processingTasks[0].status).toBe('blocked')
    expect(view.artifacts.some(row=>row.artifactKey==='avg.media.raw.desk.background')).toBe(true)
    expect(view.artifacts.some(row=>row.artifactKey==='avg.media.processed.desk.background')).toBe(false)
    const ledger=JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks['avg.media.process.desk.background']
    expect(ledger.usage).toMatchObject({mediaCalls:0,modelCalls:0,costUsd:0})
    await expect(runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})).rejects.toThrow(/不可组装/)
    expect(dispatch).toHaveBeenCalledTimes(1);expect(process).toHaveBeenCalledTimes(1)
  })

  it('known unusable output dimensions and an opaque fill for required alpha reject before any paid start',async()=>{
    const dispatch=vi.fn();vi.stubGlobal('fetch',dispatch)
    const recipe=avgImageProcessingRecipeFixture()
    await expect(prepare([requirement()],true,{schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:'desk.background',recipe:{...recipe,width:32,height:32}}]})).rejects.toThrow(/尺寸或画幅/)
    await expect(prepare([{...requirement(),alpha:'required'}],true,{schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:'desk.background',recipe:{...recipe,background:{red:0,green:0,blue:0,alpha:255}}}]})).rejects.toThrow(/不透明/)
    expect(await db.productBuilds.count()).toBe(0);expect(dispatch).not.toHaveBeenCalled()
  })

  it('route path drift and a disabled start reject before creating a Build or making HTTP requests', async () => {
    const dispatch = vi.fn(); vi.stubGlobal('fetch', dispatch)
    const s = await prepare()
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://apihub.agnes-ai.com/different/v1' })
    await expect(start(s)).rejects.toThrow(/路由已变化/)
    expect(await db.productBuilds.count()).toBe(0)
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://apihub.agnes-ai.com/v1' })
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '0')
    await expect(start(s)).rejects.toThrow(/尚未启用/)
    expect(await db.productBuilds.count()).toBe(0)
    expect(dispatch).not.toHaveBeenCalled()
    // Disabling new production never makes the saved Brief unreadable.
    expect((await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).executionBrief!.avgAssembly!.version).toBe(2)
  })

  it.each([202, 200])('an operation-only %i keeps raw evidence/reservation and never silently reposts after reopen', async status => {
    const dispatch = vi.fn(async () => new Response(JSON.stringify({ task_id: 'engineering.operation.1' }), { status, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', dispatch)
    const s = await start(await prepare()); await confirmSources(s)
    const result = await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    expect(result.buildStatus).toBe('recovery-required')
    const build = (await db.productBuilds.get(s.buildId))!
    const ledger = JSON.parse(build.budgetLedgerJson)
    expect(ledger.tasks['avg.media.generate.desk.background']).toMatchObject({ status: 'failed', errorCode: 'task-result-unknown', usage: null })
    expect(ledger.attempts.find((attempt: { taskKey: string }) => attempt.taskKey === 'avg.media.generate.desk.background')).toMatchObject({ usageKnown: false, usage: { mediaCalls: 1 } })
    expect((await db.agentRunArtifacts.toArray()).some(row => row.artifactKind === 'raw-response' && row.content?.includes('engineering.operation.1'))).toBe(true)
    expect(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background']).count()).toBe(0)
    db.close(); await db.open()
    await expect(runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })).rejects.toThrow(/不可组装/)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('authentication failure is settled as one observed request and does not create a selectable raw image', async () => {
    const dispatch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'engineering authentication failure' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', dispatch)
    const s = await start(await prepare()); await confirmSources(s)
    expect((await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })).buildStatus).toBe('recovery-required')
    const build = (await db.productBuilds.get(s.buildId))!
    expect(JSON.parse(build.budgetLedgerJson).tasks['avg.media.generate.desk.background'].usage.mediaCalls).toBe(1)
    expect(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background']).count()).toBe(0)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('malformed JSON retains the bounded pre-parse response and an unresolved call without resending', async () => {
    const body = '{"data":unfinished'
    const dispatch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', dispatch)
    const s = await start(await prepare()); await confirmSources(s)
    expect((await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })).buildStatus).toBe('recovery-required')
    const evidence = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'raw-response')!
    expect(JSON.parse(evidence.content!).rawText).toBe(body)
    const ledger = JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson)
    expect(ledger.attempts.find((attempt: { taskKey: string }) => attempt.taskKey === 'avg.media.generate.desk.background')).toMatchObject({ usageKnown: false, usage: { mediaCalls: 1 } })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
