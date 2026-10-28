import { avgVisualPlanningBudgetV4,avgVisualPlanningGateIdsV4 } from '../../src/lib/avg/visual-planning-policy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/visual-planning-brief'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { avgProfessionalFamilyScopeFixtureV4 } from '../helpers/avg-professional-family-scope-fixture'
import { resolveConfiguredTextCapabilityV1 } from '../../src/lib/product-production/capabilities'
import { resolveAvgImageExecutionCapabilityV2 } from '../../src/lib/avg/media-capability'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { beginProductProductionEvolutionV1, readProductProductionDetailsV1, startProductProductionPreviewV1, recoverImportedProductProductionProofsV1, stopProductProductionV1 } from '../../src/lib/product-production/service'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { stageAvgAuthorArtifactV1, readAvgConfirmedVisualArtifactsV4, readAvgHistoricalVisualArtifactV4, readAvgHistoricalVisualArtifactsV4 } from '../../src/lib/avg/author-artifacts'
import { acceptProductBuildArtifact, verifyAcceptedProductBuildArtifactV1, verifyHistoricalAvgVisualPlanningArtifactV4, verifyHistoricalAvgVisualImageProducerV4, verifyHistoricalAvgVisualImageProducerV5, verifyHistoricalAvgVisualPlanningArtifactV5, verifyRetainedAvgRawImageArtifactV1, verifyProductBuildTerminalArtifactSetV1 } from '../../src/lib/product-production/artifact-store'
import { readAvgVisualProposalEvidenceV4 } from '../../src/lib/avg/visual-planning-evidence'
import * as visualProposalEvidence from '../../src/lib/avg/visual-planning-evidence'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { readAvgCompiledImageDefinitionV4, prepareAvgCompiledImageRequestV4 } from '../../src/lib/avg/visual-planning-image-definition'
import { readAvgImageConsumptionDefinitionV4 } from '../../src/lib/avg/image-consumption'
import { readAvgVisualPlanningContextV4 } from '../../src/lib/avg/visual-planning-context'
import * as imageDecoder from '../../src/lib/avg/image-decoder'
import * as mediaVerifier from '../../src/lib/product-production/media-runtime-verifier'
import { readAvgRawImageCandidateBytesV2, stageAvgVisualReviewV1, stageAvgMediaChoiceV2,
  confirmAvgWorkspaceInputV1, configureAvgChosenMediaDraftV2, stageAvgWorkspaceInputV1, readAvgAssemblyWorkspaceV1,
  prepareAvgAssemblyBriefV1, startAvgAssemblyV1, runAvgAssemblyV1, restartAvgVisualPlanningFromDraftV4 } from '../../src/lib/avg/assembly-service'
import { prepareAvgVisualProposalReuseV4, readAvgVisualReuseOptionsV4 } from '../../src/lib/avg/visual-planning-reuse-workspace'
import { resolveAvgVisualPlanningExecutionV4 } from '../../src/lib/avg/visual-planning-workspace'
import { readAvgHistoricalRawImageV4,readAvgHistoricalImageCandidatesV4,readAvgHistoricalImageCandidateBytesV4 } from '../../src/lib/avg/visual-image-history'
import { prepareAvgVisualRawReuseSourceV4, readAvgVisualRawReuseSourceV4, inspectAvgVisualRawReuseCompatibilityV4 } from '../../src/lib/avg/visual-image-reuse'
import { parseAvgVisualRawReuseSourceV4 } from '../../src/lib/avg/visual-image-reuse-contract'
import * as rawReuseContract from '../../src/lib/avg/visual-image-reuse-contract'
import { prepareAvgVisualRawReuseV4 } from '../../src/lib/avg/visual-image-reuse-workspace'
import { prepareAvgVisualImageProcessingV4 } from '../../src/lib/avg/visual-processing-workspace'
import * as imageProcessing from '../../src/lib/avg/image-processing'
import { avgImageProcessingRecipeFixture,avgImageProcessingReceiptFixture } from '../helpers/avg-image-processing-fixture'
import { parseAvgGeneratedReferenceSourceV4 } from '../../src/lib/avg/visual-processed-source-contract'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as imageProducerProof from '../../src/lib/product-production/artifact-store'
import * as stageImageSources from '../../src/lib/avg/stage-image-sources'
import { readAvgHeldImageQueueFailureV4 } from '../../src/lib/avg/visual-held-image-failure'
import { ProductProductionDraftRejectedErrorV1 } from '../../src/lib/product-production/scheduler'
import { assertAvgVisualPlanningRestartKnownV4 } from '../../src/lib/avg/visual-planning-restart'
import { prepareAvgVisualImageRouteV4 } from '../../src/lib/avg/visual-image-route-workspace'
import { readAvgAdoptedGeneratedReferenceChoiceV4 } from '../../src/lib/avg/author-artifacts'
import { prepareAvgAdoptedGeneratedImageV2,readAvgAdoptedGeneratedImageV2 } from '../../src/lib/avg/media-generated-reference'
import { prepareAvgGeneratedReferenceImageV2,readAvgGeneratedReferenceBytesV2 } from '../../src/lib/avg/media-generated-reference'
import { parseAvgMediaReferencesV2 } from '../../src/lib/avg/media-reference-contract-v2'
import { avgVersionedReferenceTransportFixture } from '../helpers/avg-versioned-reference-fixture'
import { parseAvgGeneratedReferenceSourceV1,parseAvgGeneratedReferenceSourceV2,parseAvgGeneratedReferenceSourceV3 } from '../../src/lib/avg/media-generated-reference-contract'
import { AVG_IMAGE_REFERENCE_CAPABILITY_V2,parseAvgMediaReferencesV1 } from '../../src/lib/avg/media-reference-contract'
import * as textCapabilities from '../../src/lib/product-production/capabilities'
import { refuseAvgVisualPlanningBatchV4, stageAvgVisualPlanningAuthorInputV4 } from '../../src/lib/avg/visual-planning-workspace'
import { avgVisualReviewFixture } from '../helpers/avg-visual-review-fixture'
import { readAvgDraftV1, createAvgDraftV1, selectAvgWorldV1 } from '../../src/lib/avg/draft-service'
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { importAvgMediaV1, saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { freezeAvgVisualPlanningScopeV1 } from '../../src/lib/avg/media-source'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import type { AvgMediaBriefV1, AvgVisualBibleV1 } from '../../src/lib/avg/visual-planning-contract'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'

const config = { provider: 'agnes' as const, baseUrl: 'https://visual.fixture.invalid/v1',
  apiKey: 'test-only-no-network', model: 'agnes-2.5-flash', temperature: 0.7, maxTokens: 0 }

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig(config)
  // Only the intentionally closed feature fence and external model runner
  // are replaced. Build/start/SourcePlan/Harness/producer/adoption stay real.
  vi.spyOn(readiness, 'avgVisualPlanningExecutionReadyV4').mockReturnValue(true)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); db.close() })

async function setup(options: { processing?:boolean;secondImage?:boolean; fenced?:boolean; malformed?: boolean; wrongBinding?: boolean; visualShape?: 'combined-schema-key' | 'string-palette' | 'extra-root-fields'; unknown?: boolean; reference?: 'valid' | 'missing' | 'tampered'; image?: 'valid' | 'unknown' | 'malformed' | 'corrupt-json' | 'busy' } = {}) {
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
  const imageBytes = await deterministicRegionMapPngV1({ width: 576, height: 324, palette: ['#18213b', '#39506b', '#c8dce8'] })
  const view = new Uint8Array(imageBytes); let binary = ''
  for (let i = 0; i < view.length; i += 16384) binary += String.fromCharCode(...view.subarray(i, i + 16384))
  const imageFetcher = vi.fn(async (target: RequestInfo | URL, _init?: RequestInit) => {
    if (!String(target).endsWith('/images/generations')) throw new Error('Unexpected controlled HTTP route')
    if (options.image === 'unknown') throw new TypeError('Failed to fetch')
    if (options.image === 'busy') return new Response(JSON.stringify({error:{message:'生图队列已满，请稍后重试'}}),{status:503,headers:{'content-type':'application/json'}})
    return new Response(options.image === 'corrupt-json' ? '{broken image response' : JSON.stringify({ data: [{ b64_json: options.image === 'malformed' ? '%%%%' : btoa(binary) }] }),
      { headers: { 'content-type': 'application/json', 'x-request-id': 'controlled-v4-image' } })
  })
  vi.stubGlobal('fetch', imageFetcher)
  const fixture = await avgVisualPlanningFixtureV4(), { owner, source } = fixture
  const brief = structuredClone(fixture.brief)
  if(options.secondImage){
    const old=brief.avgVisualPlanning!.scope,{sourceInputHash:_hash,aspectRatio:_ratio,...draftScope}=old
    const extra=structuredClone(draftScope.templates[0]);extra.parameters.requirementKey+='-reference';extra.parameters.assetKey+='-reference'
    extra.parameters.consumer={...extra.parameters.consumer,domain:'reference',slot:'style',required:false,sceneKey:null,consumerKey:extra.parameters.consumer.consumerKey+'-reference'}
    extra.parameters.triggerBeatKey=null;extra.parameters.family.variantKey='style'
    draftScope.templates.push(extra)
    brief.avgVisualPlanning!.scope=await freezeAvgVisualPlanningScopeV1(draftScope,source)
    brief.media.imageCount=2
  }

  if (options.reference) {
    const data = await deterministicRegionMapPngV1({ width: 32, height: 32, palette: ['#112233', '#445566', '#778899'] })
    const asset = await importAvgMediaV1({ scope: owner.scope, data, mimeType: 'image/png', kind: 'background', name: '原创工程风格参考',
      license: '原创工程参考，仅用于本测试声明用途', altText: '工程色块', characterTag: '' })
    const { sourceInputHash: _hash, aspectRatio: _ratio, ...unhashed } = brief.avgVisualPlanning!.scope
    unhashed.templates[0].allowedReferenceKeys = unhashed.templates[0].requiredReferenceKeys = ['design-reference']
    unhashed.referenceCatalog = [{ referenceKey: 'design-reference', reference: { assetKey: asset.assetKey, assetVersion: asset.version,
      contentHash: asset.contentHash, mimeType: 'image/png', byteSize: asset.byteSize, purpose: 'style', allowedChange: '只参考配色',
      dataClass: 'image-reference', license: asset.license, providerInputAllowed: true, derivativeUseAllowed: true, crop: null, mask: null } }]
    brief.avgVisualPlanning!.scope = await freezeAvgVisualPlanningScopeV1(unhashed, source)
    brief.capabilityRequirements.find(c => c.mediaClass === 'image')!.allowedDataClasses.push('image-reference')
    brief.externalDataPolicy.allowedDataClasses.push('image-reference'); brief.externalDataPolicy.allowReferenceImages = true
    const upload = (await db.avgDraftMedia.where('workId').equals(owner.scope.workId).first())!
    if (options.reference === 'missing') await db.avgDraftMedia.delete(upload.id!)
    if (options.reference === 'tampered') {
      const blob = (await db.mediaBlobObjects.get(upload.blobObjectId))!, corrupt = new Uint8Array(data.slice(0)); corrupt[corrupt.length - 1] ^= 1
      await db.mediaBlobObjects.update(blob.id!, { data: corrupt.buffer })
    }
  }
  const text = await resolveConfiguredTextCapabilityV1({ projectId: owner.scope.projectId,
    category: 'product-production', requirementKey: 'avg.visual.planning.text' })
  brief.capabilityRequirements.find(c => c.mediaClass === 'text')!.capabilityHash = text.receipt.capabilityHash
  const image = await resolveAvgImageExecutionCapabilityV2({ projectId: owner.scope.projectId,
    requirement: brief.capabilityRequirements.find(c => c.mediaClass === 'image')! })
  brief.avgVisualPlanning!.imageBinding = { ...image.binding, endpointRouteHash: image.endpointRouteHash }
  if(options.secondImage){brief.productionBudget=avgVisualPlanningBudgetV4(brief);brief.completionContract.requiredGateIds=avgVisualPlanningGateIdsV4(brief)}
  let parsed = parseProductProductionBriefV3(brief)
  const saved = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId,
    command: { type: 'save-brief-revision', commandId: 'visual.actual.save', expectedStateRevision: owner.details.production.stateRevision,
      parentRevision: owner.details.brief!.revision, brief: parsed } })
  if (!saved.ok) throw new Error(JSON.stringify(saved))
  let prepared = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
  if(options.processing){
    prepared=await prepareAvgVisualImageProcessingV4({scope:owner.scope,productionId:owner.productionId,expectedBriefHash:prepared.brief!.briefHash,
      expectedDraftRevision:(await readAvgDraftV1(owner.scope)).revision,expectedBuild:prepared.build?{id:prepared.build.id!,revision:prepared.build.stateRevision}:null,
      plan:{schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:parsed.avgVisualPlanning!.scope.templates[0].parameters.requirementKey,recipe:avgImageProcessingRecipeFixture()}]}})
    parsed=parseProductProductionBriefV3(prepared.brief!.briefJson)
  }
  const started = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId,
    command: { type: 'authorize-start', commandId: 'visual.actual.start', expectedStateRevision: prepared.production.stateRevision,
      briefRevision: prepared.brief!.revision, briefHash: prepared.brief!.briefHash, authorizationNonce: 'explicit-test-author-start' } })
  if (!started.ok) throw new Error(JSON.stringify(started))
  const details = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
  const buildId = details.build!.id!
  const subjectKey = parsed.avgVisualPlanning!.scope.templates[0].parameters.family.subjectKey
  const bible: AvgVisualBibleV1 = { schema: 'storyforge.avg.visual-bible', version: 1,
    style: { medium: '二维插画', rendering: '清晰轮廓', palette: ['暖灰'], lighting: '左上主光', composition: '保留对白区' },
    subjects: [{ subjectKey, subjectKind: 'environment', identityInvariants: ['门窗位置'], allowedChanges: ['允许的光照'], forbiddenDepictions: ['新增秘密'] }] }
  const media: AvgMediaBriefV1 = { schema: 'storyforge.avg.media-brief', version: 1, subjectKey, subjectKind: 'environment',
    designIntent: '同一地点的准确背景', outputs: parsed.avgVisualPlanning!.scope.templates.map(t => ({ requirementKey: t.parameters.requirementKey,
      prompt: '左上柔光，门窗布局稳定，下方留出对白区域', negativePrompt: '水印', invariants: ['窗框保持'], forbiddenDepictions: ['额外人物'], referenceKeys: [...t.requiredReferenceKeys] })) }
  const runText = vi.fn<ProductionTextRunnerV1>(async input => {
    expect(input.category).toBe('product-production')
    expect(input.expectedCapabilityHash).toBe(text.receipt.capabilityHash)
    if (options.unknown) throw new TypeError('Failed to fetch')
    const { schema: _schema, version: _version, ...body } = bible
    // Reduced shapes actually observed in the first real Agnes direction
    // response. Do not turn these into an implicitly repaired candidate.
    const invalid = options.visualShape === 'combined-schema-key'
      ? { 'storyforge.avg.visual-bible/version': 1, ...body, style: { ...bible.style, palette: '灰绿 / 暖木 / 米白' } }
      : options.visualShape === 'extra-root-fields' ? { ...bible, outputs: [], identityInvariants: [], allowedChanges: [], forbiddenDepictions: [], invariants: [], referenceKeys: ['reference.from-input'] }
      : { ...bible, style: { ...bible.style, palette: '灰绿 / 暖木 / 米白' } }
    const output=options.malformed ? '{broken response' : JSON.stringify(options.visualShape ? invalid : input.system.includes('storyforge.avg.visual-bible') ? bible : media)
    return { output:options.fenced?'```json\n'+output+'\n```':output,
      bindingReceipt: { ...text.receipt, ...(options.wrongBinding ? { capabilityHash: 'f'.repeat(64) } : {}) }, usage: { inputTokens: 300, outputTokens: 300 } }
  })
  const executor = createConfiguredProductProductionExecutorV1({ production: details.production, brief: parsed, runText,
    mediaCapabilities: new Map([['avg.media.image', image.resolved]]), avgImageEndpointRouteHash: image.endpointRouteHash })
  const capabilityBindings = [{ requirementKey: text.receipt.requirementKey, adapterId: text.receipt.adapterId,
    bindingHash: text.receipt.capabilityHash, provider: text.receipt.provider, model: text.receipt.model }, image.binding]
  await runProductProductionUntilBlockedV1({ scope: owner.scope, productionId: owner.productionId, executor, capabilityBindings })
  const initialized = (await db.productBuilds.get(buildId))!
  const plan = parseProductProductionPlanV3(initialized.planJson, parsed, initialized.briefHash)
  const s = { ...owner, buildId, source, brief: parsed, plan, bible, media, runText, executor, capabilityBindings, imageFetcher, imageBytes, imageBase64:btoa(binary) }
  return s
}
type Setup = Awaited<ReturnType<typeof setup>>
async function restartInput(s:Setup){const build=await current(s),draft=await readAvgDraftV1(s.scope);return {scope:s.scope,productionId:s.productionId,expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision,expectedDraftRevision:draft.revision}}

async function current(s: Setup) { return (await db.productBuilds.get(s.buildId))! }
async function cycle(s: Setup) { return runProductProductionSchedulerCycleV1(s) }
async function run(s: Setup) { return runProductProductionUntilBlockedV1(s) }
async function accepted(s: Setup, artifactKey: string) {
  return db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, artifactKey]).filter(r => r.status === 'accepted').first()
}
async function stage(s: Setup, artifactKey: string, payload: unknown) {
  const build = await current(s), task = s.plan.tasks.find(t => t.outputArtifactKeys.includes(artifactKey))!
  return stageAvgAuthorArtifactV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, taskKey: task.taskKey, artifactKey, kind: artifactKey === 'avg.system.plan' ? 'product-module' : 'narrative', payload,
    declaration: '确认这份工程候选；受控输出不作为真实美术或商业验收' })
}
async function adopt(s: Setup, candidate: ProductBuildArtifactRecordV1) {
  const build = await current(s), production = (await db.productProductions.get(s.productionId))!
  const result = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId,
    command: { type: 'adopt-avg-artifact', commandId: `visual.author.${crypto.randomUUID()}`,
      expectedStateRevision: production.stateRevision, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch,
      buildNumber: build.buildNumber, artifactKey: candidate.artifactKey, candidateVersion: candidate.version,
      candidateHash: JSON.parse(candidate.metadataJson).candidateHash } })
  if (!result.ok) throw new Error(JSON.stringify(result))
}
async function sources(s: Setup) {
  await adopt(s, await stage(s, 'avg.system.plan', s.source.systemPlan))
  for (const script of s.source.scripts) await adopt(s, await stage(s, `avg.content.scene-script.${script.sceneKey}`, script))
}

/** Actual producer/adoption chain; only browser image decoding is unavailable
 * in jsdom. Controlled observations below never stand for human art review. */
async function generatedImage(reference?:'valid') {
  vi.spyOn(imageDecoder, 'inspectAvgImageBytesV1').mockResolvedValue({ width: 576, height: 324, hasAlpha: false })
  const s = await setup({ image: 'valid',reference }); await sources(s); await run(s)
  await adopt(s, await stage(s, 'avg.media.visual-bible', s.bible)); await run(s)
  await adopt(s, await stage(s, `avg.media.environment-brief.${s.media.subjectKey}`, s.media))
  await cycle(s); await cycle(s)
  const raw = (await accepted(s, `avg.media.raw.${s.media.outputs[0].requirementKey}`))!
  expect(raw, (await current(s)).failureJson).toBeDefined()
  const requirement = JSON.parse(raw.payloadJson).requirement
  const image = { scope: s.scope, productionId: s.productionId, requirementKey: requirement.requirementKey,
    rawVersion: raw.version, rawContentHash: raw.contentHash }
  const choose = () => stageAvgMediaChoiceV2({ ...image, declaration: '明确选择准确工程图，不签艺术质量' })
  const review = (report = avgVisualReviewFixture(requirement, raw.contentHash)) => stageAvgVisualReviewV1({ ...image, report,
    declaration: '准确记录本次受控工程观察，不冒充专业或真人验收' })
  const confirm = (candidate: ProductBuildArtifactRecordV1) => confirmAvgWorkspaceInputV1({ ...s,
    artifactKey: candidate.artifactKey, candidateVersion: candidate.version, candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
  return { s, raw, requirement, image, choose, review, confirm }
}

function mockStageImageObservation() {
  vi.spyOn(mediaVerifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ environment: input.environment,
    measuredAt: Date.now(), assets: input.assets.map(asset => ({ assetKey: asset.assetKey, contentHash: asset.contentHash,
      mimeType: asset.mimeType, mediaClass: 'image', status: 'decoded', decodedWidth: 576, decodedHeight: 324,
      decodedDurationMs: null, decodedHasAlpha: false, decodedChannelCount: null, decodedSampleRateHz: null,
      integratedLufs: null, truePeakDbtp: null, loopSeamDbfs: null, policyFailures: [], failureCode: null })) }))
}

async function adoptedImageStage(generated: Awaited<ReturnType<typeof generatedImage>>) {
  const {s,review,choose,confirm}=generated
  await confirm(await review());await confirm(await choose())
  const saved=await configureAvgChosenMediaDraftV2({...s,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision})
  mockStageImageObservation()
  await confirm(await stageAvgWorkspaceInputV1({...s,expectedDraftRevision:saved.revision,artifactKey:'avg.author.stage',
    declaration:'确认准确工程图片消费与演出；不签艺术或商业质量'}))
}

async function newFamilyDraft(stem:string){
  const owner=await createAvgDraftV1('专业准备失败恢复工程验证'),world=await createMistHarborWorld(),input=avgProfessionalFamilyScopeFixtureV4(stem)
  const selected=await selectAvgWorldV1(owner.scope,0,world.worldReleaseId),draft=await saveAvgAuthorWorkspaceV1(owner.scope,selected.revision,input.workspace)
  return {owner,input,draft}
}
function failNextConsumerDraftWrite(stem:string){
  const put=db.avgAuthoringDrafts.put.bind(db.avgAuthoringDrafts);let failed=false
  return vi.spyOn(db.avgAuthoringDrafts,'put').mockImplementation((row,...args)=>{
    if(!failed&&row.editorJson.includes(`planned.${stem}.letter.icon`)){failed=true;throw new Error('controlled consumer draft persistence failure')}
    return put(row,...args)
  })
}

describe('AVG V4 actual visual planning Harness and explicit author boundary', () => {
  it('keeps lazy registered reader loading inside sealed admission without replaying the model',async()=>{
    const s=await setup({reference:'valid'});await sources(s)
    const NativePromise=Promise,runner=s.runText.getMockImplementation()!
    s.runText.mockImplementationOnce(async input=>{
      const result=await runner(input)
      // The browser import can yield even for an already evaluated module.
      // Delay the next registered import only after the actual model response.
      vi.doMock('../../src/lib/avg/visual-planning-context',async()=>{
        await new NativePromise<void>(resolve=>setTimeout(resolve,10))
        return vi.importActual('../../src/lib/avg/visual-planning-context')
      })
      return result
    })
    try{
      await run(s)
      expect(s.runText).toHaveBeenCalledTimes(1)
      const proposal=await accepted(s,'avg.proposal.visual-bible')
      expect(proposal,(await current(s)).failureJson).toBeDefined()
      db.close();await db.open()
      const evidence=await readAvgVisualProposalEvidenceV4(s.scope,proposal!)
      expect(evidence.rawText).toBe((await s.runText.mock.results[0].value).output)
      expect(JSON.parse((await current(s)).budgetLedgerJson).tasks['avg.visual.propose.direction']).toMatchObject({status:'settled',usage:{modelCalls:1,mediaCalls:0,costUsd:null}})
      expect(s.runText).toHaveBeenCalledTimes(1)
    }finally{vi.doUnmock('../../src/lib/avg/visual-planning-context');await vi.dynamicImportSettled()}
  },60_000)

  it('keeps sealed professional proposal admission alive across delayed WebCrypto without replaying the model',async()=>{
    const s=await setup({reference:'valid'});await sources(s)
    const digest=crypto.subtle.digest.bind(crypto.subtle)
    const NativePromise=Promise
    vi.spyOn(crypto.subtle,'digest').mockImplementation((algorithm,data)=>{
      if(!s.runText.mock.calls.length)return digest(algorithm,data)
      return new NativePromise<void>(resolve=>setTimeout(resolve,10)).then(()=>digest(algorithm,data))
    })
    await run(s)
    expect(s.runText).toHaveBeenCalledTimes(1)
    const proposal=await accepted(s,'avg.proposal.visual-bible')
    expect(proposal,(await current(s)).failureJson).toBeDefined()
    await readAvgVisualProposalEvidenceV4(s.scope,proposal!)
    const ledger=JSON.parse((await current(s)).budgetLedgerJson)
    expect(ledger.tasks['avg.visual.propose.direction']).toMatchObject({status:'settled',usage:{modelCalls:1,mediaCalls:0,costUsd:null}})
  },60_000)

  it('does not strand prospective item fields when the reviewable Brief write fails and a fresh scope is prepared',async()=>{
    const {owner,input,draft}=await newFamilyDraft('failed-brief')
    vi.spyOn(db.productProductionBriefs,'add').mockRejectedValueOnce(new Error('controlled Brief persistence failure'))
    await expect(prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:draft.revision,visualPlanning:input.planning})).rejects.toThrow()
    const current=await readAvgDraftV1(owner.scope)
    expect(current.editorJson).toBe(draft.editorJson)
    const retried=await prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:current.revision,visualPlanning:avgProfessionalFamilyScopeFixtureV4('retry-brief').planning})
    expect(parseProductProductionBriefV3(retried.brief!.briefJson).avgVisualPlanning).toBeDefined()
    expect(await db.agentRuns.count()).toBe(0)
  },30_000)

  it('retains a reviewable scope when consumer draft persistence fails and completes only that exact proposal on explicit start',async()=>{
    const {owner,input,draft}=await newFamilyDraft('deferred')
    failNextConsumerDraftWrite('deferred')
    await expect(prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:draft.revision,visualPlanning:input.planning})).rejects.toThrow()
    const current=await readAvgDraftV1(owner.scope),details=await readProductProductionDetailsV1(owner.scope,current.productionId!,['avg'])
    expect(current.editorJson).toBe(draft.editorJson);expect(details.brief).not.toBeNull()
    await startAvgAssemblyV1({scope:owner.scope,productionId:details.production.id!,expectedBriefHash:details.brief!.briefHash})
    const saved=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(owner.scope)).editorJson)
    if(saved.systemPlan.version!==2)throw new Error('Expected actual inventory source')
    expect(saved.systemPlan.inventory.items[0].iconAssetKey).toBe('planned.deferred.letter.icon')
    expect((await readAvgAssemblyWorkspaceV1(owner.scope)).visualProgress!.budget.usage).toMatchObject({modelCalls:0,mediaCalls:0})
  },30_000)

  it('does not overwrite changed author source while completing a deferred consumer proposal',async()=>{
    const {owner,input,draft}=await newFamilyDraft('stale-deferred')
    failNextConsumerDraftWrite('stale-deferred')
    await expect(prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:draft.revision,visualPlanning:input.planning})).rejects.toThrow()
    const current=await readAvgDraftV1(owner.scope),details=await readProductProductionDetailsV1(owner.scope,current.productionId!,['avg'])
    expect(details.brief).not.toBeNull()
    const changed=parseAvgAuthorWorkspaceV1(current.editorJson);changed.scripts[0].lines[0].text+='作者此时已另行改稿'
    const saved=await saveAvgAuthorWorkspaceV1(owner.scope,current.revision,changed)
    await expect(startAvgAssemblyV1({scope:owner.scope,productionId:details.production.id!,expectedBriefHash:details.brief!.briefHash})).rejects.toThrow(/已变化|重新/)
    expect((await readAvgDraftV1(owner.scope)).editorJson).toBe(saved.editorJson)
    expect(await db.agentRuns.count()).toBe(0)
  },30_000)

  it('can replace a deferred revision without stranding slots from an earlier saved intent',async()=>{
    const {owner,input,draft}=await newFamilyDraft('first-history')
    await prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:draft.revision,visualPlanning:input.planning})
    const first=await readAvgDraftV1(owner.scope)
    failNextConsumerDraftWrite('second-history')
    await expect(prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:first.revision,visualPlanning:avgProfessionalFamilyScopeFixtureV4('second-history').planning})).rejects.toThrow(/方案已保存/)
    const deferred=await readAvgDraftV1(owner.scope)
    expect(deferred.editorJson).toBe(first.editorJson)
    const latest=await prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:deferred.revision,visualPlanning:avgProfessionalFamilyScopeFixtureV4('third-history').planning})
    expect(latest.briefHistory).toHaveLength(3)
    const saved=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(owner.scope)).editorJson)
    if(saved.systemPlan.version!==2)throw new Error('Expected actual inventory source')
    expect(saved.systemPlan.inventory.items[0].iconAssetKey).toBe('planned.third-history.letter.icon')
    expect(saved.systemPlan.inventory.items[0].detailAssetKey).toBe('planned.third-history.letter.detail')
    await startAvgAssemblyV1({scope:owner.scope,productionId:latest.production.id!,expectedBriefHash:latest.brief!.briefHash})
    expect((await readAvgAssemblyWorkspaceV1(owner.scope)).visualProgress!.budget.usage).toMatchObject({modelCalls:0,mediaCalls:0})
  },30_000)

  it('does not save deferred consumer fields or authorize a Run when the frozen provider is unavailable',async()=>{
    const {owner,input,draft}=await newFamilyDraft('missing-deferred-route')
    failNextConsumerDraftWrite('missing-deferred-route')
    await expect(prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:draft.revision,visualPlanning:input.planning})).rejects.toThrow(/方案已保存/)
    const current=await readAvgDraftV1(owner.scope),details=await readProductProductionDetailsV1(owner.scope,current.productionId!,['avg'])
    useAIConfigStore.getState().setConfig({...config,apiKey:''})
    await expect(startAvgAssemblyV1({scope:owner.scope,productionId:details.production.id!,expectedBriefHash:details.brief!.briefHash})).rejects.toThrow()
    expect((await readAvgDraftV1(owner.scope)).editorJson).toBe(current.editorJson)
    expect(await db.agentRuns.count()).toBe(0)
  },30_000)

  it('saves reviewable professional family intent and prospective item icon/detail slots before actual start',async()=>{
    const owner=await createAvgDraftV1('专业家族来源工程验证'),world=await createMistHarborWorld(),input=avgProfessionalFamilyScopeFixtureV4()
    const selected=await selectAvgWorldV1(owner.scope,0,world.worldReleaseId)
    const draft=await saveAvgAuthorWorkspaceV1(owner.scope,selected.revision,input.workspace)
    const prepared=await prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:draft.revision,visualPlanning:input.planning})
    const saved=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(owner.scope)).editorJson)
    if(saved.systemPlan.version!==2)throw new Error('Expected actual inventory source')
    expect(saved.systemPlan.inventory.items[0].iconAssetKey).toBe('planned.family.letter.icon')
    expect(saved.systemPlan.inventory.items[0].detailAssetKey).toBe('planned.family.letter.detail')
    expect(saved.systemPlan.inventory.items[0].variants).toEqual(input.workspace.systemPlan.version===2?input.workspace.systemPlan.inventory.items[0].variants:[])
    const latest=await readAvgDraftV1(owner.scope),revision=avgProfessionalFamilyScopeFixtureV4('revised').planning
    const revised=await prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:latest.revision,visualPlanning:revision})
    const currentDraft=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(owner.scope)).editorJson)
    if(currentDraft.systemPlan.version!==2)throw new Error('Expected actual inventory source')
    expect(currentDraft.systemPlan.inventory.items[0].iconAssetKey).toBe('planned.revised.letter.icon')
    expect(currentDraft.systemPlan.inventory.items[0].detailAssetKey).toBe('planned.revised.letter.detail')
    const productionId=revised.production.id!,brief=parseProductProductionBriefV3(revised.brief!.briefJson)
    await expect(startAvgAssemblyV1({scope:owner.scope,productionId,expectedBriefHash:prepared.brief!.briefHash})).rejects.toThrow(/已变化/)
    await startAvgAssemblyV1({scope:owner.scope,productionId,expectedBriefHash:revised.brief!.briefHash})
    const view=await readAvgAssemblyWorkspaceV1(owner.scope),plan=parseProductProductionPlanV3(view.details!.build!.planJson,brief,view.details!.build!.briefHash)
    expect(plan.tasks.filter(t=>t.executionMode==='model').map(t=>t.skillId)).toEqual(['avg.visual-bible.v1','avg.environment-assets.v1','avg.character-assets.v1','avg.prop-assets.v1'])
    expect(plan.tasks.filter(t=>t.kind==='avg-media-image-generate')).toHaveLength(5)
    expect(view.visualProgress!.budget.usage).toMatchObject({modelCalls:0,mediaCalls:0})
    expect(await db.mediaBlobObjects.count()).toBe(0)
  },30_000)

  it('does not persist prospective family item fields or create a Production when configuration preflight fails',async()=>{
    const owner=await createAvgDraftV1('专业家族配置失败工程验证'),world=await createMistHarborWorld(),input=avgProfessionalFamilyScopeFixtureV4()
    const selected=await selectAvgWorldV1(owner.scope,0,world.worldReleaseId),draft=await saveAvgAuthorWorkspaceV1(owner.scope,selected.revision,input.workspace)
    useAIConfigStore.getState().setConfig({apiKey:''})
    await expect(prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:draft.revision,visualPlanning:input.planning})).rejects.toThrow(/API|配置/)
    expect((await readAvgDraftV1(owner.scope)).editorJson).toBe(draft.editorJson)
    expect(await db.productProductions.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0)
  },30_000)

  it('runs all four registered professional roles and five exact image tasks through the public family flow only after explicit author decisions',async()=>{
    vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1')
    const owner=await createAvgDraftV1('专业家族真实 Harness 工程验证'),world=await createMistHarborWorld(),input=avgProfessionalFamilyScopeFixtureV4()
    const selected=await selectAvgWorldV1(owner.scope,0,world.worldReleaseId),draft=await saveAvgAuthorWorkspaceV1(owner.scope,selected.revision,input.workspace)
    const prepared=await prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:draft.revision,visualPlanning:input.planning}),productionId=prepared.production.id!
    const images=await Promise.all(input.planning.templates.map(t=>deterministicRegionMapPngV1({width:t.parameters.width,height:t.parameters.height,palette:['#102030','#526374','#d4e5f6']})))
    let modelCalls=0,imageCalls=0
    const fetcher=vi.fn(async(target:RequestInfo|URL,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body))
      if(String(target).endsWith('/chat/completions')){
        modelCalls+=1
        const context=String(body.messages.find((m:{role:string})=>m.role==='user').content)
        const packet=JSON.parse(context.slice(context.indexOf('{'),context.lastIndexOf('}')+1))
        expect(packet.schema).toBe('storyforge.avg.visual-planning-inputs')
        expect(context).not.toContain(input.workspace.scripts[0].lines[0].text)
        const direction=String(body.messages.find((m:{role:string})=>m.role==='system').content).includes('storyforge.avg.visual-bible')
        const payload=direction?{schema:'storyforge.avg.visual-bible',version:1,style:{medium:'二维插画',rendering:'统一轮廓',palette:['灰蓝'],lighting:'左上主光',composition:'下方留白'},
          subjects:packet.subjects.map((s:{subjectKey:string;subjectKind:string})=>({subjectKey:s.subjectKey,subjectKind:s.subjectKind,identityInvariants:['保持公开主体身份与比例'],allowedChanges:['仅改变已确认姿态与显示尺度'],forbiddenDepictions:['新增剧情秘密']}))}
          :{schema:'storyforge.avg.media-brief',version:1,subjectKey:packet.subjects[0].subjectKey,subjectKind:packet.subjects[0].subjectKind,designIntent:'保持同主体家族一致性；工程替身不签艺术',
            outputs:packet.requirements.map((r:{requirementKey:string;requiredReferenceKeys:string[]})=>({requirementKey:r.requirementKey,prompt:'准确主体、共同配色与已确认变化',negativePrompt:'水印',invariants:['主体身份与比例不变'],forbiddenDepictions:['新增秘密'],referenceKeys:r.requiredReferenceKeys}))}
        return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(payload)}}],usage:{prompt_tokens:200,completion_tokens:200}}),{headers:{'content-type':'application/json'}})
      }
      if(!String(target).endsWith('/images/generations'))throw new Error('Unexpected controlled family route')
      const bytes=new Uint8Array(images[imageCalls++]);let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384))
      return new Response(JSON.stringify({data:[{b64_json:btoa(binary)}]}),{headers:{'content-type':'application/json'}})
    })
    vi.stubGlobal('fetch',fetcher)
    await startAvgAssemblyV1({scope:owner.scope,productionId,expectedBriefHash:prepared.brief!.briefHash})
    const confirm=async(candidate:ProductBuildArtifactRecordV1)=>confirmAvgWorkspaceInputV1({scope:owner.scope,productionId,artifactKey:candidate.artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
    for(const key of ['avg.system.plan',...input.workspace.scripts.map(s=>`avg.content.scene-script.${s.sceneKey}`)]){
      const current=await readAvgDraftV1(owner.scope)
      await confirm(await stageAvgWorkspaceInputV1({scope:owner.scope,productionId,expectedDraftRevision:current.revision,artifactKey:key,declaration:'确认固定工程来源与准确消费槽；不代表艺术或商业验收'}))
    }
    expect(modelCalls).toBe(0);expect(imageCalls).toBe(0)
    await runAvgAssemblyV1({scope:owner.scope,productionId})
    let view=await readAvgAssemblyWorkspaceV1(owner.scope)
    expect(modelCalls).toBe(1);expect(imageCalls).toBe(0)
    expect(view.artifacts.find(r=>r.artifactKey==='avg.proposal.visual-bible'),view.details!.build!.failureJson).toBeDefined()
    const adoptProposal=async(row:ProductBuildArtifactRecordV1)=>{
      const latest=await readAvgAssemblyWorkspaceV1(owner.scope),payload=JSON.parse(row.payloadJson)
      const candidate=await stageAvgVisualPlanningAuthorInputV4({scope:owner.scope,productionId,expectedBuildId:latest.details!.build!.id!,expectedBuildRevision:latest.details!.build!.stateRevision,
        artifactKey:payload.targetArtifactKey,proposal:{artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash},payload:payload.payload,declaration:'确认该准确工程方案，原响应保留，不代签美术/人类接受'})
      await confirm(candidate)
    }
    await adoptProposal(view.artifacts.find(r=>r.artifactKey==='avg.proposal.visual-bible')!)
    await runAvgAssemblyV1({scope:owner.scope,productionId});view=await readAvgAssemblyWorkspaceV1(owner.scope)
    expect(modelCalls).toBe(4);expect(imageCalls).toBe(0)
    for(const row of view.artifacts.filter(r=>r.artifactKey.startsWith('avg.proposal.')&&r.artifactKey!=='avg.proposal.visual-bible'))await adoptProposal(row)
    await runAvgAssemblyV1({scope:owner.scope,productionId});view=await readAvgAssemblyWorkspaceV1(owner.scope)
    expect(view.artifacts.filter(r=>r.artifactKey.startsWith('avg.media.raw.'))).toHaveLength(5)
    expect(view.imageDefinition!.mediaBatch.requirements).toHaveLength(5)
    expect(view.visualProgress!.budget.usage).toMatchObject({modelCalls:4,mediaCalls:5,costUsd:null})
    expect(modelCalls).toBe(4);expect(imageCalls).toBe(5)
    expect(view.details!.build!.previewHash).toBe('')
    // Opaque engineering pixels prove receipt flow only; actor alpha, review,
    // choices/stage, real references, native playback and art remain separate.
    expect(view.artifacts.some(r=>r.artifactKey==='avg.author.stage'&&r.status==='accepted')).toBe(false)
  },60_000)
  it('prepares and starts the actual V4 workbench through public services without a provider call or synthetic stored Brief', async () => {
    const {owner,planning}=await avgVisualPlanningFixtureV4('linear'),draft=await readAvgDraftV1(owner.scope)
    const {sourceInputHash:_hash,aspectRatio:_ratio,...visualPlanning}=planning.scope
    const prepared=await prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:draft.revision,visualPlanning})
    const brief=parseProductProductionBriefV3(prepared.brief!.briefJson)
    expect(brief.avgAssembly).toBeUndefined();expect(brief.avgVisualPlanning!.scope).toEqual(planning.scope)
    expect(prepared.production.currentBuildNumber).toBeNull()
    expect((await readAvgAssemblyWorkspaceV1(owner.scope)).imageDefinition).toBeNull()
    const revisedScope=structuredClone(visualPlanning);revisedScope.revision+=1;revisedScope.templates[0].requiredDetails.push('作者重新核对了尚未开始的背景布局')
    const latestDraft=await readAvgDraftV1(owner.scope)
    const revised=await prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:latestDraft.revision,visualPlanning:revisedScope})
    expect(parseProductProductionBriefV3(revised.brief!.briefJson).avgVisualPlanning!.scope.templates[0].requiredDetails).toContain('作者重新核对了尚未开始的背景布局')
    expect(revised.brief!.briefHash).not.toBe(prepared.brief!.briefHash)
    await expect(startAvgAssemblyV1({scope:owner.scope,productionId:owner.productionId,expectedBriefHash:prepared.brief!.briefHash})).rejects.toThrow(/已变化/)
    await startAvgAssemblyV1({scope:owner.scope,productionId:owner.productionId,expectedBriefHash:revised.brief!.briefHash})
    const view=await readAvgAssemblyWorkspaceV1(owner.scope)
    expect(view.details!.build!.planRevision).toBe(1);expect(view.details!.production.status).toBe('producing')
    expect(view.visualProgress!.budget.usage).toMatchObject({modelCalls:0,mediaCalls:0})
    expect(await db.agentRunArtifacts.count()).toBe(0);expect(await db.mediaBlobObjects.count()).toBe(0)
    const revisions=await db.productProductionBriefs.where('productionId').equals(owner.productionId).toArray()
    expect(revisions.filter(r=>JSON.parse(r.briefJson).avgVisualPlanning)).toHaveLength(2)
    expect(revisions.filter(r=>r.revision>owner.details.brief!.revision).every(r=>!JSON.parse(r.briefJson).avgAssembly)).toBe(true)
  },30_000)

  it('rejects changed saved source before public V4 start and retains the prepared Brief without creating a Build', async () => {
    const {owner,planning}=await avgVisualPlanningFixtureV4('linear'),draft=await readAvgDraftV1(owner.scope)
    const {sourceInputHash:_hash,aspectRatio:_ratio,...visualPlanning}=planning.scope
    const prepared=await prepareAvgAssemblyBriefV1({scope:owner.scope,expectedDraftRevision:draft.revision,visualPlanning})
    const latest=await readAvgDraftV1(owner.scope),workspace=parseAvgAuthorWorkspaceV1(latest.editorJson)
    workspace.scripts[0].lines[0].text+='作者已经改稿'
    await saveAvgAuthorWorkspaceV1(owner.scope,latest.revision,workspace)
    await expect(startAvgAssemblyV1({scope:owner.scope,productionId:owner.productionId,expectedBriefHash:prepared.brief!.briefHash})).rejects.toThrow(/已变化/)
    expect((await readProductProductionDetailsV1(owner.scope,owner.productionId,['avg'])).brief!.briefHash).toBe(prepared.brief!.briefHash)
    expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0)
  },30_000)

  it('records an exact author refusal and stops the visual batch while retaining original model evidence and making no retry', async () => {
    const s=await setup();await sources(s);await run(s)
    const build=await current(s),proposal=(await accepted(s,'avg.proposal.visual-bible'))!
    const input={scope:s.scope,productionId:s.productionId,expectedBuildId:s.buildId,expectedBuildRevision:build.stateRevision,
      artifactKey:'avg.media.visual-bible',proposal:{artifactKey:proposal.artifactKey,version:proposal.version,contentHash:proposal.contentHash},reason:'作者退回：当前构图不符合已确认方向，停止本批并保留原始证据'}
    const count=await db.agentRunArtifacts.count()
    await expect(refuseAvgVisualPlanningBatchV4({...input,proposal:{...input.proposal,contentHash:'f'.repeat(64)}})).rejects.toThrow()
    expect((await db.productProductions.get(s.productionId))!.status).toBe('producing')
    await refuseAvgVisualPlanningBatchV4(input)
    expect((await current(s)).status).toBe('cancelled')
    const receipts=await db.productProductionCommands.where('productionId').equals(s.productionId).toArray()
    expect(receipts.some(r=>r.type==='pause'&&r.status==='succeeded')).toBe(true)
    const stoppedFailure=(await current(s)).failureJson
    expect(stoppedFailure).toContain('author-refused-visual-batch');expect(stoppedFailure).toContain(proposal.contentHash);expect(stoppedFailure).toContain(input.reason)
    expect(await db.agentRunArtifacts.count()).toBe(count)
    expect((await readAvgAssemblyWorkspaceV1(s.scope)).artifacts.some(r=>r.contentHash===proposal.contentHash)).toBe(true)
    expect(s.runText).toHaveBeenCalledTimes(1);expect(s.imageFetcher).not.toHaveBeenCalled()
  },30_000)

  it('does not reuse a received role binding to dispatch a pending role after the configured route changes', async () => {
    const s=await setup();await sources(s);await run(s);await adopt(s,await stage(s,'avg.media.visual-bible',s.bible))
    useAIConfigStore.getState().setConfig({...config,provider:'deepseek',model:'deepseek-chat',baseUrl:'https://different.fixture.invalid/v1'})
    await expect(runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})).rejects.toThrow(/capability|binding/)
    expect(s.runText).toHaveBeenCalledTimes(1);expect(s.imageFetcher).not.toHaveBeenCalled()
  },30_000)

  it('runs registered roles only after actual source adoption and compiles only author-adopted direction', async () => {
    const s = await setup()
    await run(s); expect(s.runText).not.toHaveBeenCalled()
    await sources(s)
    await run(s)
    expect(s.runText, (await current(s)).failureJson).toHaveBeenCalledTimes(1)
    const raw = await accepted(s, 'avg.proposal.visual-bible')
    expect(raw, (await current(s)).failureJson).toBeDefined()
    const original = await readAvgVisualProposalEvidenceV4(s.scope, raw!)
    expect(JSON.parse(original.rawText)).toEqual(s.bible)
    expect(original.request.systemPrompt).toContain('反例')
    expect(original.request.contextText).not.toContain(s.source.scripts[0].lines[0].text)
    expect(await accepted(s, 'avg.media.visual-bible')).toBeUndefined()
    await run(s); expect(s.runText).toHaveBeenCalledTimes(1)
    const candidate = await stage(s, 'avg.media.visual-bible', s.bible)
    expect(JSON.parse(candidate.metadataJson)).toMatchObject({ version: 6, origin: 'model-proposal', visualProposalValidation: { authorEdited: false } })
    await run(s); expect(s.runText).toHaveBeenCalledTimes(1)
    await adopt(s, candidate)
    await run(s)
    expect(s.runText).toHaveBeenCalledTimes(2)
    const subjectRaw = await accepted(s, `avg.proposal.environment-brief.${s.media.subjectKey}`)
    expect(subjectRaw, (await current(s)).failureJson).toBeDefined()
    const revised = structuredClone(s.media); revised.outputs[0].prompt += '，作者修订：墙面保持灰色'
    const edited = await stage(s, `avg.media.environment-brief.${s.media.subjectKey}`, revised)
    expect(JSON.parse(edited.metadataJson).visualProposalValidation.authorEdited).toBe(true)
    await adopt(s, edited)
    // One scheduler cycle deliberately stops before the unwired image consumer.
    await cycle(s)
    const compiled = await accepted(s, 'avg.media.compiled-visual-requirements')
    expect(compiled, (await current(s)).failureJson).toBeDefined()
    const proved = await verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.buildId,
      artifactKey: compiled!.artifactKey, version: compiled!.version, contentHash: compiled!.contentHash })
    expect(proved.producerRunId).not.toBeNull()
    expect(proved.payloadJson).toContain('作者修订：墙面保持灰色')
    const build = await current(s)
    const authority = { scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch, expectedBrief: s.brief }
    const image = await prepareAvgCompiledImageRequestV4({ ...authority, requirementKey: revised.outputs[0].requirementKey, idempotencyKey: 'a'.repeat(64) })
    expect(image.resolved.brief).toEqual(s.brief)
    expect(image.resolved.brief.avgAssembly).toBeUndefined()
    expect(image.resolved.definition.compilation.contentHash).toBe(compiled!.contentHash)
    expect(image.frozen.request.prompt).toContain('作者修订：墙面保持灰色')
    const imageTask = s.plan.tasks.find(t => t.kind === 'avg-media-image-generate')!
    const packet = JSON.parse(await readAvgVisualPlanningContextV4({ projectId: s.scope.projectId, scope: s.scope,
      productProductionId: s.productionId, productBuildId: s.buildId, productProductionTaskKey: imageTask.taskKey,
      productArtifactKeys: imageTask.inputArtifactKeys }))
    expect(packet.operation).toBe('produce-compiled-image')
    expect(packet.compilation.contentHash).toBe(compiled!.contentHash)
    expect(packet.requirement.prompt).toContain('作者修订：墙面保持灰色')
    await expect(readAvgCompiledImageDefinitionV4({ ...authority, expectedBuildRevision: build.stateRevision - 1 })).rejects.toThrow(/stale/)
    expect(s.runText).toHaveBeenCalledTimes(2)
    expect((await db.mediaBlobObjects.toArray())).toHaveLength(0)
    await expect(stage(s, 'avg.media.visual-bible', s.bible)).rejects.toThrow(/下游执行消费/)
  })

  it.each(['malformed', 'wrongBinding'] as const)('retains the actual %s response, blocks author adoption and never automatically resends', async mode => {
    const s = await setup({ [mode]: true }); await sources(s); await run(s)
    expect(s.runText, (await current(s)).failureJson).toHaveBeenCalledTimes(1)
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeUndefined()
    expect(await db.agentRunArtifacts.filter(r => r.artifactKind === 'raw-response').count()).toBe(1)
    await run(s); expect(s.runText).toHaveBeenCalledTimes(1)
    await expect(stage(s, 'avg.media.visual-bible', s.bible)).rejects.toThrow()
  })

  it.each(['combined-schema-key', 'string-palette', 'extra-root-fields'] as const)('retains a real-provider-shaped %s failure, exact bytes and one charged failed call after reopen without silently fixing or resending', async visualShape => {
    const s = await setup({ visualShape }); await sources(s); await run(s)
    expect(s.runText).toHaveBeenCalledTimes(1); expect(s.imageFetcher).not.toHaveBeenCalled()
    const original = (await s.runText.mock.results[0].value).output
    const row = (await db.agentRunArtifacts.filter(r => r.artifactKind === 'raw-response').first())!
    expect(await readAgentRunArtifactExactV1({ projectId: s.scope.projectId, artifactKind: 'raw-response', contentHash: row.contentHash })).toBe(original)
    expect((await current(s)).status).toBe('recovery-required')
    expect(JSON.parse((await current(s)).budgetLedgerJson).tasks['avg.visual.propose.direction']).toMatchObject({ status: 'failed', usage: { modelCalls: 1, mediaCalls: 0, costUsd: null } })
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeUndefined()
    db.close(); await db.open(); await run(s)
    expect(s.runText).toHaveBeenCalledTimes(1); expect(s.imageFetcher).not.toHaveBeenCalled()
    expect(await readAgentRunArtifactExactV1({ projectId: s.scope.projectId, artifactKind: 'raw-response', contentHash: row.contentHash })).toBe(original)
    await expect(stage(s, 'avg.media.visual-bible', s.bible)).rejects.toThrow()
  })

  it('refuses adopted visual reads after original response evidence disappears', async () => {
    const s = await setup(); await sources(s); await run(s)
    await adopt(s, await stage(s, 'avg.media.visual-bible', s.bible))
    const raw = await accepted(s, 'avg.proposal.visual-bible')!, proof = await readAvgVisualProposalEvidenceV4(s.scope, raw!)
    const row = await db.agentRunArtifacts.where('contentHash').equals(String(proof.quality.rawResponseHash)).first()
    await db.agentRunArtifacts.delete(row!.id!)
    const build = await current(s)
    await expect(readAvgConfirmedVisualArtifactsV4({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision,
      controlEpoch: build.controlEpoch, artifactKeys: ['avg.media.visual-bible'] })).rejects.toThrow()
  })

  it('preserves original request/response, author provenance and compiled producer through actual backup/remap and Work deletion', async () => {
    const s = await setup(); await sources(s); await run(s)
    await adopt(s, await stage(s, 'avg.media.visual-bible', s.bible)); await run(s)
    await adopt(s, await stage(s, `avg.media.environment-brief.${s.media.subjectKey}`, s.media)); await cycle(s)
    const original = (await accepted(s, 'avg.proposal.visual-bible'))!
    const evidence = await readAvgVisualProposalEvidenceV4(s.scope, original)
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(projectId).first())!
    const scope = { projectId, worldId: build.worldId, workId: build.workId }
    const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    for (const artifactKey of ['avg.proposal.visual-bible', 'avg.media.compiled-visual-requirements']) {
      const row = rows.find(r => r.artifactKey === artifactKey && r.status === 'accepted')!
      expect(row).toBeDefined()
      await verifyHistoricalAvgVisualPlanningArtifactV4({ scope, buildId: build.id!, artifactKey, version: row.version, contentHash: row.contentHash,
        expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash, sourceControlEpoch: row.controlEpoch })
    }
    const importedRaw = rows.find(r => r.artifactKey === original.artifactKey && r.status === 'accepted')!
    expect(importedRaw.producerRunId).not.toBe(original.producerRunId)
    const importedEvidence = await readAvgVisualProposalEvidenceV4(scope, importedRaw)
    expect(importedEvidence.rawText).toBe(evidence.rawText)
    expect(importedEvidence.requestText).toBe(evidence.requestText)
    const adoptedBible = rows.find(r => r.artifactKey === 'avg.media.visual-bible' && r.status === 'accepted')!
    expect(JSON.parse(adoptedBible.metadataJson).candidate).toMatchObject({ version: 6, origin: 'model-proposal', visualProposalValidation: { authorEdited: false } })
    await expect(stageAvgAuthorArtifactV1({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
      controlEpoch: build.controlEpoch, taskKey: 'avg.author.visual-bible', artifactKey: 'avg.media.visual-bible', kind: 'narrative',
      payload: s.bible, declaration: '导入历史不授权新采用' })).rejects.toThrow()
    await deleteWork(scope.workId)
    expect(await db.productBuildArtifacts.where('buildId').equals(build.id!).count()).toBe(0)
    expect(await db.agentRuns.where('workId').equals(scope.workId).count()).toBe(0)
    expect(await accepted(s, original.artifactKey)).toBeDefined()
    expect(s.runText).toHaveBeenCalledTimes(2)
  })

  it('verifies actual Work-owned reference bytes while delivering only permitted metadata to the visual text role', async () => {
    const s = await setup({ reference: 'valid' }); await sources(s); await run(s)
    expect(s.runText).toHaveBeenCalledTimes(1)
    const packet = s.runText.mock.calls[0][0].contextText
    expect(packet).toContain('design-reference'); expect(packet).toContain('metadata-only')
    expect(packet).not.toContain('data:image'); expect(packet).not.toContain(s.source.scripts[0].lines[0].text)
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeDefined()
  })

  it.each(['missing', 'tampered'] as const)('rejects %s reference evidence before any text or image request', async reference => {
    const s = await setup({ reference }); await sources(s); await run(s)
    expect(s.runText).not.toHaveBeenCalled()
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeUndefined()
  })

  it('keeps unknown transport usage reserved and does not replay after DB reopen', async () => {
    const s = await setup({ unknown: true }); await sources(s); await run(s)
    expect(s.runText).toHaveBeenCalledTimes(1)
    const build = await current(s), ledger = JSON.parse(build.budgetLedgerJson)
    expect(build.failureJson).toContain('task-result-unknown')
    expect(ledger.attempts).toContainEqual(expect.objectContaining({ taskKey: 'avg.visual.propose.direction', usageKnown: false }))
    db.close(); await db.open(); await run(s)
    expect(s.runText).toHaveBeenCalledTimes(1)
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeUndefined()
  })

  it('blocks changed adopted source bytes before a model request', async () => {
    const s = await setup(); await sources(s)
    const script = (await accepted(s, `avg.content.scene-script.${s.source.scripts[0].sceneKey}`))!
    const payload = JSON.parse(script.payloadJson); payload.lines[0].text += '篡改已采用字节'
    await db.productBuildArtifacts.update(script.id!, { payloadJson: JSON.stringify(payload) })
    await run(s); expect(s.runText).not.toHaveBeenCalled()
    expect(await accepted(s, 'avg.proposal.visual-bible')).toBeUndefined()
  })

  it('rejects a caller-supplied route that differs from the actual frozen child Run before dispatch', async () => {
    const s = await setup(); await sources(s)
    await runProductProductionUntilBlockedV1({ ...s, executor: input => s.executor({ ...input,
      capabilityBindings: input.capabilityBindings.map(b => ({ ...b, bindingHash: 'f'.repeat(64) })) }) })
    expect(s.runText).not.toHaveBeenCalled()
    expect((await current(s)).failureJson).toContain('Harness claim')
  })

  describe('actual compiled image dispatch after explicit source and design preparation',()=>{
    let s:Awaited<ReturnType<typeof setup>>
    beforeEach(async()=>{
      s=await setup({ image: 'valid' }); await sources(s); await run(s)
      expect(s.imageFetcher).not.toHaveBeenCalled()
      await adopt(s, await stage(s, 'avg.media.visual-bible', s.bible)); await run(s)
      const revised = structuredClone(s.media); revised.outputs[0].prompt += '，由作者确认的灰色墙面'
      await adopt(s, await stage(s, `avg.media.environment-brief.${s.media.subjectKey}`, revised))
      await cycle(s); expect(s.imageFetcher).not.toHaveBeenCalled()
    },30_000)
    it('sends the author-adopted compiled prompt once through the real image adapter and seals original PNG bytes', async () => {
    await cycle(s)
    expect(s.imageFetcher, (await current(s)).failureJson).toHaveBeenCalledTimes(1)
    const request = JSON.parse(String(s.imageFetcher.mock.calls[0][1]!.body))
    expect(request.prompt).toContain('由作者确认的灰色墙面')
    const raw = await accepted(s, `avg.media.raw.${s.media.outputs[0].requirementKey}`)
    expect(raw, (await current(s)).failureJson).toBeDefined()
    await verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.buildId, artifactKey: raw!.artifactKey,
      version: raw!.version, contentHash: raw!.contentHash })
    expect(JSON.parse(raw!.qualityJson)).toMatchObject({ sourceCompilation: { artifactKey: 'avg.media.compiled-visual-requirements' }, decoderVerified: false })
    const blob = (await db.mediaBlobObjects.get(raw!.blobObjectId!))!
    expect(blob.data).toEqual(s.imageBytes)
    await run(s); expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    expect(s.runText).toHaveBeenCalledTimes(2)
    })
  })

  it.each(['unknown', 'malformed', 'corrupt-json'] as const)('preserves %s image outcome and never records a dispatched image as zero calls or silently resends', async image => {
    const s = await setup({ image }); await sources(s); await run(s)
    await adopt(s, await stage(s, 'avg.media.visual-bible', s.bible)); await run(s)
    await adopt(s, await stage(s, `avg.media.environment-brief.${s.media.subjectKey}`, s.media)); await cycle(s); await cycle(s)
    expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    expect(await accepted(s, `avg.media.raw.${s.media.outputs[0].requirementKey}`)).toBeUndefined()
    const build = await current(s), ledger = JSON.parse(build.budgetLedgerJson)
    const attempt = ledger.attempts.find((a: { taskKey: string }) => a.taskKey === `avg.media.generate.${s.media.outputs[0].requirementKey}`)
    expect(attempt).toBeDefined()
    if (image === 'unknown' || image === 'corrupt-json') {
      expect(build.failureJson).toContain('task-result-unknown'); expect(attempt.usageKnown).toBe(false)
      // This is the conservative reservation, never measured free usage.
      expect(attempt.usage).toMatchObject({ mediaCalls: 1, costUsd: null })
    }
    else { expect(attempt.usageKnown).toBe(true); expect(attempt.usage.mediaCalls).toBe(1); expect(attempt.usage.costUsd).toBeNull() }
    db.close(); await db.open(); await run(s); expect(s.imageFetcher).toHaveBeenCalledTimes(1)
  })

  it('sends the exact authorized Work reference bytes with the adopted compiled prompt', async () => {
    // jsdom has no native decoder; owner, actual PNG bytes/header/hash,
    // provider serialization and full producer/Harness remain real.
    const decoder = vi.spyOn(imageDecoder, 'inspectAvgImageBytesV1').mockResolvedValue({ width: 32, height: 32, hasAlpha: false })
    const s = await setup({ reference: 'valid', image: 'valid' }); await sources(s); await run(s)
    await adopt(s, await stage(s, 'avg.media.visual-bible', s.bible)); await run(s)
    await adopt(s, await stage(s, `avg.media.environment-brief.${s.media.subjectKey}`, s.media)); await cycle(s); await cycle(s)
    expect(s.imageFetcher, (await current(s)).failureJson).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(s.imageFetcher.mock.calls[0][1]!.body)), uri = body.extra_body.image[0] as string
    expect(uri).toMatch(/^data:image\/png;base64,/)
    const binary = atob(uri.split(',')[1]), bytes = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer
    const ref = s.brief.avgVisualPlanning!.scope.referenceCatalog[0].reference
    expect(await sha256MediaData(bytes)).toBe(ref.contentHash)
    expect(decoder).toHaveBeenCalledWith(expect.objectContaining({ contentHash: ref.contentHash, data: bytes }))
    const raw = await accepted(s, `avg.media.raw.${s.media.outputs[0].requirementKey}`)
    expect(raw, (await current(s)).failureJson).toBeDefined()
    expect(JSON.parse(raw!.payloadJson).request.references[0]).toEqual(ref)
  })

  it('rejects a self-rehashed direct read and lets shared recovery use only the original approved producer evidence', async () => {
    const s = await setup({ image: 'valid' }); await sources(s); await run(s)
    await adopt(s, await stage(s, 'avg.media.visual-bible', s.bible)); await run(s)
    await adopt(s, await stage(s, `avg.media.environment-brief.${s.media.subjectKey}`, s.media)); await cycle(s)
    const compiled = (await accepted(s, 'avg.media.compiled-visual-requirements'))!, payload = JSON.parse(compiled.payloadJson)
    payload.batch.requirements[0].prompt += '未经作者采用的替换提示词'
    await db.productBuildArtifacts.update(compiled.id!, { payloadJson: JSON.stringify(payload), contentHash: await hashProductProductionValueV2(payload) })
    const build = await current(s)
    await expect(readAvgCompiledImageDefinitionV4({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision,
      controlEpoch: build.controlEpoch, expectedBrief: s.brief })).rejects.toThrow(/producer|不一致/)
    expect(s.imageFetcher.mock.calls.length).toBe(0)
    // Existing shared checkpoint recovery can restore the exact approved
    // compiler output before the authorized image task; it must not consume
    // the rehashed edit or request replacement text-model output.
    await cycle(s)
    expect(s.imageFetcher.mock.calls.length).toBe(1)
    const request = JSON.parse(String(s.imageFetcher.mock.calls[0][1]!.body))
    expect(request.prompt).not.toContain('未经作者采用的替换提示词')
    expect((await accepted(s, compiled.artifactKey))!.contentHash).toBe(compiled.contentHash)
    expect(s.runText).toHaveBeenCalledTimes(2)
  })

  it('rejects a reference changed after compilation before image dispatch', async () => {
    const s = await setup({ reference: 'valid', image: 'valid' }); await sources(s); await run(s)
    await adopt(s, await stage(s, 'avg.media.visual-bible', s.bible)); await run(s)
    await adopt(s, await stage(s, `avg.media.environment-brief.${s.media.subjectKey}`, s.media)); await cycle(s)
    const upload = (await db.avgDraftMedia.where('workId').equals(s.scope.workId).first())!, blob = (await db.mediaBlobObjects.get(upload.blobObjectId))!
    const corrupted = new Uint8Array(blob.data!.slice(0)); corrupted[corrupted.length - 1] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: corrupted.buffer })
    await expect(cycle(s)).rejects.toThrow(/哈希/)
    expect(s.imageFetcher.mock.calls.length).toBe(0)
    expect(await accepted(s, `avg.media.raw.${s.media.outputs[0].requirementKey}`)).toBeUndefined()
  })

  describe('historical original V4 image producer evidence',()=>{
    let generated:Awaited<ReturnType<typeof generatedImage>>
    beforeEach(async()=>{generated=await generatedImage()})
    async function input(){
      const {s,raw}=generated,build=await current(s)
      return {scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
        expectedPlanHash:build.planHash,sourceControlEpoch:s.plan.controlEpoch,artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}
    }
    it('reads exact original image/HTTP/producer bytes without credentials or writes, including after the source is stopped',async()=>{
      const {s,raw}=generated
      useAIConfigStore.getState().setConfig({apiKey:''})
      const before=await exportProjectJSON(s.scope.projectId),proof=await verifyHistoricalAvgVisualImageProducerV4(await input())
      expect(proof.artifact).toEqual(raw)
      await expect(verifyHistoricalAvgVisualImageProducerV5(await input())).rejects.toThrow(/原始视觉版本/)
      const compilation=(await accepted(s,'avg.media.compiled-visual-requirements'))!
      await expect(verifyHistoricalAvgVisualPlanningArtifactV5({...await input(),artifactKey:compilation.artifactKey,version:compilation.version,contentHash:compilation.contentHash})).rejects.toThrow(/原始视觉版本/)
      const {proofHash,...body}=proof.provenance
      expect(proofHash).toBe(await hashProductProductionValueV2(body))
      expect(body).toMatchObject({schema:'storyforge.avg.visual-image-producer-proof',version:4,buildNumber:1,
        artifactKey:raw.artifactKey,contentHash:raw.contentHash,producerReceiptHash:raw.producerReceiptHash,
        responseEvidenceHash:JSON.parse(raw.qualityJson).responseEvidenceHash})
      for(const key of ['runId','producerRunId','buildId','blobObjectId'])expect(body).not.toHaveProperty(key)
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
      const stopped=await exportProjectJSON(s.scope.projectId),stoppedProof=await verifyHistoricalAvgVisualImageProducerV4(await input())
      expect(stoppedProof).toEqual(proof)
      await expect(verifyHistoricalAvgVisualPlanningArtifactV4(await input())).rejects.toThrow()
      await expect(verifyRetainedAvgRawImageArtifactV1(await input())).rejects.toThrow()
      await expect(imageProducerProof.verifyHistoricalAvgImageRevalidationProducerV1(await input())).rejects.toThrow(/零调用图片复验/)
      await expect(generated.choose()).rejects.toThrow()
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...stopped,exportedAt:0})
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it.each(['revision','scope','epoch','payload','rights','blob','response','checkpoint','ledger','kind'] as const)('rejects stale or damaged %s evidence without dispatch',async mode=>{
      const {s,raw}=generated,next=await input()
      if(mode==='revision')next.expectedBuildRevision++
      if(mode==='scope')next.scope={...next.scope,projectId:next.scope.projectId+1000}
      if(mode==='epoch')next.sourceControlEpoch++
      if(mode==='payload'){const payload=JSON.parse(raw.payloadJson);payload.sourceInputHash='f'.repeat(64);await db.productBuildArtifacts.update(raw.id!,{payloadJson:JSON.stringify(payload)})}
      if(mode==='rights')await db.productBuildArtifacts.update(raw.id!,{rightsJson:'{}'})
      if(mode==='blob'){const data=new Uint8Array(s.imageBytes.slice(0));data[data.length-1]^=1;await db.mediaBlobObjects.update(raw.blobObjectId!,{data:data.buffer})}
      if(mode==='response')await db.agentRunArtifacts.filter(r=>r.projectId===s.scope.projectId&&r.artifactKind==='raw-response'&&r.contentHash===JSON.parse(raw.qualityJson).responseEvidenceHash).delete()
      if(mode==='checkpoint')await db.agentRunCheckpoints.where('runId').equals(raw.producerRunId!).delete()
      if(mode==='ledger'){const build=await current(s),ledger=JSON.parse(build.budgetLedgerJson);ledger.tasks[`avg.media.generate.${s.media.outputs[0].requirementKey}`].status='claimed';await db.productBuilds.update(build.id!,{budgetLedgerJson:JSON.stringify(ledger)})}
      if(mode==='kind')await db.productBuildArtifacts.update(raw.id!,{kind:'narrative'})
      const before=await Promise.all(db.tables.map(table=>table.toArray()))
      await expect(verifyHistoricalAvgVisualImageProducerV4(next)).rejects.toThrow()
      expect(await Promise.all(db.tables.map(table=>table.toArray()))).toEqual(before)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('keeps imported completed image prefixes read-only and deletes only the imported owner',async()=>{
      const {s,raw}=generated
      await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
      const original=await verifyHistoricalAvgVisualImageProducerV4(await input())
      const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
      const scope={projectId,worldId:build.worldId,workId:build.workId},next={...await input(),scope,buildId:build.id!,expectedBuildRevision:build.stateRevision}
      useAIConfigStore.getState().setConfig({apiKey:''})
      const before=await exportProjectJSON(projectId),imported=await verifyHistoricalAvgVisualImageProducerV4(next)
      expect(imported.provenance).toEqual(original.provenance);expect(imported.artifact.blobObjectId).not.toBe(raw.blobObjectId)
      expect((await db.mediaBlobObjects.get(imported.artifact.blobObjectId!))!.data).toEqual(s.imageBytes)
      expect({...await exportProjectJSON(projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      await expect(stageAvgMediaChoiceV2({...generated.image,scope,productionId:build.productionId,declaration:'历史读取不授权重新采用'})).rejects.toThrow()
      await deleteWork(scope.workId)
      expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
      expect((await db.mediaBlobObjects.get(raw.blobObjectId!))!.data).toEqual(s.imageBytes)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it('keeps delayed module loading inside the original transaction for commit and rollback',async()=>{
      const {s,raw}=generated,request=await input(),NativePromise=(async()=>{})().constructor as PromiseConstructor
      const actual=await vi.importActual('../../src/lib/avg/media-response-proof')
      vi.doMock('../../src/lib/avg/media-response-proof',async()=>{await new NativePromise<void>(resolve=>setTimeout(resolve,10));return actual})
      const read=(abort:boolean)=>db.transaction('rw',scopeTransactionTables(db.productProductions,db.productProductionBriefs,db.productProductionCommands,
        db.productBuilds,db.productBuildArtifacts,db.avgDraftMedia,db.mediaBlobObjects,db.agentRuns,db.agentRunEvents,db.agentRunCheckpoints,db.agentRunArtifacts),async()=>{
          const proof=await verifyHistoricalAvgVisualImageProducerV4(request)
          await db.productBuildArtifacts.update(raw.id!,{updatedAt:raw.updatedAt+1})
          if(abort)throw new Error('controlled image proof rollback')
          return proof
        })
      try{
        await expect(read(true)).rejects.toThrow('controlled image proof rollback')
        expect((await db.productBuildArtifacts.get(raw.id!))!.updatedAt).toBe(raw.updatedAt)
        expect((await read(false)).artifact.contentHash).toBe(raw.contentHash)
        expect((await db.productBuildArtifacts.get(raw.id!))!.updatedAt).toBe(raw.updatedAt+1)
        expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
      }finally{vi.doUnmock('../../src/lib/avg/media-response-proof');await vi.dynamicImportSettled()}
    },30_000)
  })

  describe('V4 adopted image source for explicit current stage retention',()=>{
    let generated:Awaited<ReturnType<typeof generatedImage>>,choice:ProductBuildArtifactRecordV1
    beforeEach(async()=>{
      generated=await generatedImage('valid')
      await generated.confirm(await generated.review());choice=await generated.choose();await generated.confirm(choice)
      await stopProductProductionV1({scope:generated.s.scope,production:(await db.productProductions.get(generated.s.productionId))!})
      useAIConfigStore.getState().setConfig({apiKey:''})
    })
    const input=()=>({scope:generated.s.scope,buildId:generated.s.buildId,controlEpoch:choice.controlEpoch,
      artifactKey:choice.artifactKey,version:choice.version,contentHash:choice.contentHash})
    it('reproves the exact original compiled input, author review, choice and pixels without Stage, credentials or writes',async()=>{
      const {s,raw}=generated,{exportedAt:_beforeAt,...before}=await exportProjectJSON(s.scope.projectId)
      const proof=await readAvgAdoptedGeneratedReferenceChoiceV4(input())
      expect(proof.raw).toEqual(raw);expect(proof.rawProof.version).toBe(4);expect(proof.compilation.artifactKey).toBe('avg.media.compiled-visual-requirements')
      const selected=await prepareAvgAdoptedGeneratedImageV2({scope:s.scope,choiceId:choice.id!})
      expect(selected.source.version).toBe(2);expect(parseAvgGeneratedReferenceSourceV2(selected.source)).toEqual(selected.source)
      expect(()=>parseAvgGeneratedReferenceSourceV1(selected.source)).toThrow()
      expect(()=>parseAvgMediaReferencesV1([{...generated.requirement.references[0],assetKey:proof.choice.asset.assetKey,
        assetVersion:proof.choice.asset.version,contentHash:proof.choice.asset.contentHash,mimeType:proof.choice.asset.mimeType,
        byteSize:proof.choice.asset.byteSize,license:proof.choice.asset.license,generatedSource:selected.source}])).toThrow(/generated reference source/)
      expect(JSON.stringify(selected.source)).not.toMatch(/"(?:runId|buildId|blobObjectId|rootRunId)"/)
      const image=await readAvgAdoptedGeneratedImageV2({scope:s.scope,source:selected.source})
      expect(image.data).toEqual(s.imageBytes);expect(image.sourceWorldContentHash).toBe(s.brief.source.worldContentHash)
      expect(image.blobObjectId).toBe(raw.blobObjectId);expect(JSON.parse(raw.payloadJson).provider.costUsd).toBeNull()
      const {exportedAt:_afterAt,...after}=await exportProjectJSON(s.scope.projectId);expect(after).toEqual(before)
      const outbound=await avgVersionedReferenceTransportFixture({scope:s.scope,...selected})
      expect(outbound.projectUnchanged).toBe(true);expect(outbound.dispatch).toHaveBeenCalledTimes(1);expect(outbound.compiled.batch.requirements).toHaveLength(5);expect(outbound.frozen.targetFamily).toEqual(outbound.compiled.batch.requirements[0].family)
      expect(outbound.candidate.metadata.avgReferenceTransmission).toMatchObject({version:2,references:[{generatedSource:selected.source}]})
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it.each(['source','bytes','license','identity','grant','work'] as const)('versioned outbound refuses %s without a same-key import fallback or any write',async mode=>{
      const {s}=generated,selected=await prepareAvgGeneratedReferenceImageV2({scope:s.scope,choiceId:choice.id!}),a=selected.asset
      const reference=parseAvgMediaReferencesV2([{schema:'storyforge.avg.media-reference',version:2,assetKey:a.assetKey,assetVersion:a.version,
        contentHash:a.contentHash,mimeType:a.mimeType,byteSize:a.byteSize,purpose:mode==='identity'?'identity':'style',allowedChange:'只保留准确主体；不扩大权限。',
        dataClass:'avg-authorized-reference',license:a.license,providerInputAllowed:true,derivativeUseAllowed:true,crop:null,mask:null,generatedSource:selected.source,
        contentPolicy:{permittedFeatures:['配色'],excludedFeatures:['剧情信息']} }])[0]!
      if(mode==='source')reference.generatedSource!.choice.authorReceiptHash='f'.repeat(64)
      if(mode==='license')reference.license='replacement license'
      if(mode==='grant')(reference as unknown as {providerInputAllowed:boolean}).providerInputAllowed=false
      if(mode==='bytes'){
        const blob=(await db.mediaBlobObjects.get(generated.raw.blobObjectId!))!,bad=new Uint8Array(blob.data.slice(0));bad[bad.length-1]^=1
        await db.mediaBlobObjects.update(blob.id!,{data:bad.buffer})
      }
      const snapshot=()=>Promise.all(db.tables.map(table=>table.toArray())),before=await snapshot()
      await expect(readAvgGeneratedReferenceBytesV2(mode==='work'?{...s.scope,workId:s.scope.workId+900}:s.scope,reference,
        {...generated.requirement.family,...(mode==='identity'?{subjectKey:'other-subject'}:{})})).rejects.toThrow()
      expect(await snapshot()).toEqual(before)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it.each(['pending-choice','missing-review','missing-choice-command','unknown-review-schema','changed-decoder','wrong-version','wrong-owner'] as const)('rejects %s before any stage-retention permission',async failure=>{
      const {s}=generated
      if(failure==='pending-choice')await db.productBuildArtifacts.update(choice.id!,{status:'pending'})
      if(failure==='missing-review')await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,`avg.review.visual.${generated.requirement.requirementKey}`]).delete()
      if(failure==='missing-choice-command'){
        const row=(await db.productBuildArtifacts.get(choice.id!))!,metadata=JSON.parse(row.metadataJson)
        await db.productProductionCommands.where('[productionId+commandId]').equals([s.productionId,metadata.commandId]).delete()
      }
      if(failure==='unknown-review-schema'){
        const row=(await accepted(s,`avg.review.visual.${generated.requirement.requirementKey}`))!,metadata=JSON.parse(row.metadataJson)
        const {candidateHash:_candidateHash,...body}=metadata.candidate;body.version=99
        metadata.candidate={...body,candidateHash:await hashProductProductionValueV2(body)}
        const {receiptHash:_receiptHash,...receipt}=metadata;metadata.receiptHash=await hashProductProductionValueV2(receipt)
        await db.productBuildArtifacts.update(row.id!,{metadataJson:canonicalProductProductionJsonV2(metadata),inputHash:await hashProductProductionValueV2({...body,payloadHash:null})})
        const command=(await db.productProductionCommands.where('[productionId+commandId]').equals([s.productionId,metadata.commandId]).first())!,result=JSON.parse(command.resultJson)
        result.authorReceiptHash=metadata.receiptHash;await db.productProductionCommands.update(command.id!,{resultJson:canonicalProductProductionJsonV2(result)})
      }
      if(failure==='changed-decoder')vi.mocked(imageDecoder.inspectAvgImageBytesV1).mockResolvedValue({width:1152,height:648,hasAlpha:false})
      await expect(readAvgAdoptedGeneratedReferenceChoiceV4({...input(),...(failure==='wrong-version'?{version:choice.version+1}:{}),...(failure==='wrong-owner'?{scope:{...s.scope,workId:s.scope.workId+900}}:{})})).rejects.toThrow()
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it('rejects changed portable compilation, review, producer and author hashes',async()=>{
      const selected=await prepareAvgAdoptedGeneratedImageV2({scope:generated.s.scope,choiceId:choice.id!})
      expect(selected.source.version).toBe(2);if(selected.source.version!==2)throw new Error('Expected V4 source')
      for(const field of ['compilation','review','raw','choice'] as const){
        const changed=structuredClone(selected.source);changed[field].contentHash='f'.repeat(64)
        await expect(readAvgAdoptedGeneratedImageV2({scope:generated.s.scope,source:changed})).rejects.toThrow()
      }
      expect(()=>parseAvgGeneratedReferenceSourceV2({...selected.source,processing:{}})).toThrow()
      expect(()=>parseAvgGeneratedReferenceSourceV2({...selected.source,buildId:generated.s.buildId})).toThrow()
    })
    it('reads the same portable author/pixel proof after full backup remap and preserves the original after copied Work deletion',async()=>{
      const {s}=generated,selected=await prepareAvgAdoptedGeneratedImageV2({scope:s.scope,choiceId:choice.id!})
      const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
      const scope={projectId,workId:build.workId!,worldId:build.worldId!}
      const copy=await readAvgAdoptedGeneratedImageV2({scope,source:selected.source})
      expect(copy.data).toEqual(s.imageBytes);expect(copy.source).toEqual(selected.source)
      const outbound=await avgVersionedReferenceTransportFixture({scope,...selected})
      expect(outbound.projectUnchanged).toBe(true);expect(outbound.dispatch).toHaveBeenCalledTimes(1);expect(outbound.compiled.batch.requirements).toHaveLength(5);expect(outbound.frozen.targetFamily).toEqual(outbound.compiled.batch.requirements[0].family)
      await deleteWork(scope.workId)
      expect((await readAvgAdoptedGeneratedImageV2({scope:s.scope,source:selected.source})).data).toEqual(s.imageBytes)
      await expect(readAvgAdoptedGeneratedImageV2({scope,source:selected.source})).rejects.toThrow()
    })
    it('keeps original proof reads inside the caller transaction and rolls back the caller write on failure',async()=>{
      const {s}=generated,selected=await prepareAvgAdoptedGeneratedImageV2({scope:s.scope,choiceId:choice.id!}),draft=await readAvgDraftV1(s.scope)
      await expect(db.transaction('rw',db.tables,async()=>{
        expect((await readAvgAdoptedGeneratedImageV2({scope:s.scope,source:selected.source})).data).toEqual(s.imageBytes)
        await db.avgAuthoringDrafts.update(draft.id!,{updatedAt:draft.updatedAt+1})
        throw new Error('deliberate-retention-rollback')
      })).rejects.toThrow('deliberate-retention-rollback')
      expect(await readAvgDraftV1(s.scope)).toEqual(draft)
    })
  })

  describe('explicit V4 image to new zero-provider author-stage handoff',()=>{
    let generated:Awaited<ReturnType<typeof generatedImage>>
    beforeEach(async()=>{generated=await generatedImage('valid');await adoptedImageStage(generated)})
    async function continuation(frozen=false){
      const {s}=generated
      if(frozen)await run(s)
      else await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
      let draft=await readAvgDraftV1(s.scope);const build=await current(s)
      if(frozen){const workspace=parseAvgAuthorWorkspaceV1(draft.editorJson);workspace.basePreviewHash=build.previewHash;draft=await saveAvgAuthorWorkspaceV1(s.scope,draft.revision,workspace)}
      useAIConfigStore.getState().setConfig({apiKey:''})
      return {scope:s.scope,expectedDraftRevision:draft.revision,visualStageContinuation:{expectedBuildId:s.buildId,expectedBuildRevision:build.stateRevision}}
    }
    it.each([false,true])('keeps an earlier chosen image after stopping a later empty visual batch, unresolved ancestor=%s',async unresolved=>{
      const {s,raw}=generated
      const ordinary=await prepareAvgAssemblyBriefV1(await continuation())
      const second=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:ordinary.brief!.briefHash})
      await stopProductProductionV1({scope:s.scope,production:second.production})
      vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1');useAIConfigStore.getState().setConfig(config)
      const {sourceInputHash:_hash,aspectRatio:_ratio,...planning}=structuredClone(s.brief.avgVisualPlanning!.scope)
      const scene=s.source.systemPlan.scenes[1],script=s.source.scripts.find(row=>row.sceneKey===scene.key)!
      planning.batchKey+='.later';planning.revision++
      const template=planning.templates[0];template.parameters.assetKey+='.later';template.parameters.requirementKey+='.later'
      template.parameters.consumer={...template.parameters.consumer,consumerKey:template.parameters.consumer.consumerKey+'.later',sceneKey:scene.key,subjectKey:scene.key}
      template.parameters.family={...template.parameters.family,familyKey:template.parameters.family.familyKey+'.later',subjectKey:scene.key}
      template.parameters.triggerBeatKey=script.lines[0].lineKey
      // A stopped later batch may have declared physical item slots before
      // it produced any image. Explicit retention must retire these too.
      const itemTemplates=structuredClone(avgProfessionalFamilyScopeFixtureV4('later.unconsumed').planning.templates.filter(t=>t.subjectKind==='prop'))
      if(s.source.systemPlan.version!==2)throw new Error('Expected native inventory source')
      itemTemplates[1].parameters.itemVariantKey=s.source.systemPlan.inventory.items[0].variants[0].key
      planning.templates.push(...itemTemplates)
      const ready=await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision,visualPlanning:planning})
      const started=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:ready.brief!.briefHash})
      expect(started.build).toMatchObject({buildNumber:3,status:'building',planRevision:1})
      await stopProductProductionV1({scope:s.scope,production:started.production})
      const stopped=await readProductProductionDetailsV1(s.scope,s.productionId,['avg']),parent=stopped.build!
      expect(await db.productBuildArtifacts.where('buildId').equals(parent.id!).filter(row=>row.artifactKey.startsWith('avg.media.raw.')).count()).toBe(0)
      useAIConfigStore.getState().setConfig({apiKey:''})
      if(unresolved){const old=await current(s),ledger=JSON.parse(old.budgetLedgerJson);ledger.attempts.find((attempt:{taskKey:string})=>attempt.taskKey.startsWith('avg.media.generate.')).usageKnown=false;await db.productBuilds.update(old.id!,{budgetLedgerJson:JSON.stringify(ledger)})}
      const draft=await readAvgDraftV1(s.scope),workspace=parseAvgAuthorWorkspaceV1(draft.editorJson)
      expect(workspace.presentation.inheritedImages![0].source.raw.buildNumber).toBe(1)
      const beforeBuilds=await db.productBuilds.toArray(),beforeRuns=await db.agentRuns.toArray(),beforeArtifacts=await db.productBuildArtifacts.toArray()
      const input={scope:s.scope,expectedDraftRevision:draft.revision,visualStageContinuation:{expectedBuildId:parent.id!,expectedBuildRevision:parent.stateRevision}}
      if(unresolved){
        await expect(prepareAvgAssemblyBriefV1(input)).rejects.toThrow(/未知结果/)
        expect(await readAvgDraftV1(s.scope)).toEqual(draft)
        expect((await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).brief!.id).toBe(stopped.brief!.id)
      }else{
        const prepared=await prepareAvgAssemblyBriefV1(input),brief=parseProductProductionBriefV3(prepared.brief!.briefJson)
        expect(brief.avgVisualPlanning).toBeUndefined();expect(brief.avgAssembly!.version).toBe(1)
        expect(brief.evolution!.base).toMatchObject({kind:'recovery-build',buildNumber:3,briefHash:parent.briefHash,planHash:parent.planHash})
        expect(brief.capabilityRequirements).toEqual([]);expect(brief.productionBudget).toMatchObject({maximumMediaCalls:0,maximumModelCalls:0})
        expect(brief.media.imageCount).toBe(1)
        const cleared=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(s.scope)).editorJson)
        if(cleared.systemPlan.version!==2)throw new Error('Expected native inventory source')
        expect(cleared.systemPlan.inventory.items[0].iconAssetKey).toBeNull()
        expect(cleared.systemPlan.inventory.items[0].variants[0].detailAssetKey).toBeNull()
        expect(await db.productBuilds.toArray()).toEqual(beforeBuilds);expect(await db.agentRuns.toArray()).toEqual(beforeRuns)
        const next=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:prepared.brief!.briefHash})
        expect(next.build).toMatchObject({buildNumber:4,parentBuildNumber:3,status:'building',planRevision:1})
        const currentDraft=await readAvgDraftV1(s.scope)
        for(const artifactKey of ['avg.system.plan',...workspace.systemPlan.scenes.map(scene=>`avg.content.scene-script.${scene.key}`),'avg.author.stage']){
          const candidate=await stageAvgWorkspaceInputV1({...s,expectedDraftRevision:currentDraft.revision,artifactKey,declaration:'独立核对当前规则、对白和更早已选图；不签新图或艺术质量'})
          await confirmAvgWorkspaceInputV1({...s,artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
        }
        await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
        const completed=(await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).build!
        expect(completed.status).toBe('preview-ready')
        const preview=await verifyStoredProductBuildPreview(completed)
        expect(preview!.runtimePackage.modules[0].stage.assets[0].contentHash).toBe(raw.contentHash)
        expect(await db.productBuildArtifacts.where('buildId').equals(completed.id!).filter(row=>row.artifactKey.startsWith('avg.media.raw.')).count()).toBe(0)
        const copyId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),copy=(await db.productBuilds.where('projectId').equals(copyId).sortBy('buildNumber')).at(-1)!
        const copyScope={projectId:copyId,worldId:copy.worldId!,workId:copy.workId!},copyWorkspace=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(copyScope)).editorJson)
        expect((await verifyStoredProductBuildPreview(copy))!.previewHash).toBe(preview!.previewHash)
        expect((await readAvgAdoptedGeneratedImageV2({scope:copyScope,source:copyWorkspace.presentation.inheritedImages![0].source})).data).toEqual(s.imageBytes)
        await deleteWork(copy.workId!)
        expect((await verifyStoredProductBuildPreview(completed))!.previewHash).toBe(preview!.previewHash)
      }
      expect(await db.productBuilds.bulkGet(beforeBuilds.map(row=>row.id!))).toEqual(beforeBuilds)
      expect(await db.agentRuns.bulkGet(beforeRuns.map(row=>row.id!))).toEqual(beforeRuns)
      expect(await db.productBuildArtifacts.bulkGet(beforeArtifacts.map(row=>row.id!))).toEqual(beforeArtifacts)
      expect((await db.productBuildArtifacts.get(raw.id!))!.contentHash).toBe(raw.contentHash)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)
    it.each([false,true])('explicitly prepares, starts and adopts a new offline image-preserving Preview after frozen=%s',async frozen=>{
      const {s,raw}=generated,input=await continuation(frozen),old=await current(s),oldRaw=await db.productBuildArtifacts.get(raw.id!)
      const beforeRuns=await db.agentRuns.where('productBuildId').equals(s.buildId).count(),details=await prepareAvgAssemblyBriefV1(input)
      expect(details.production.status).toBe('brief-ready');expect(details.build!.id).toBe(s.buildId)
      expect(details.brief!.status).toBe('draft')
      const brief=parseProductProductionBriefV3(details.brief!.briefJson)
      expect(brief.avgVisualPlanning).toBeUndefined();expect(brief.avgAssembly!.version).toBe(1)
      expect(brief.productionBudget.maximumMediaCalls).toBe(0);expect(brief.capabilityRequirements).toEqual([])
      const workspace=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(s.scope)).editorJson)
      expect(workspace.presentation.inheritedImages).toHaveLength(1);expect(workspace.presentation.inheritedImages![0].source.version).toBe(2)
      expect(await db.agentRuns.where('productBuildId').equals(s.buildId).count()).toBe(beforeRuns)
      expect(await db.productBuildArtifacts.get(raw.id!)).toEqual(oldRaw)
      await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:details.brief!.briefHash})
      const currentDraft=await readAvgDraftV1(s.scope),build=(await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).build!
      expect(build.buildNumber).toBe(old.buildNumber+1);expect(build.parentBuildNumber).toBe(old.buildNumber)
      for(const artifactKey of ['avg.system.plan',...workspace.systemPlan.scenes.map(scene=>`avg.content.scene-script.${scene.key}`),'avg.author.stage']){
        const candidate=await stageAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:currentDraft.revision,artifactKey,declaration:'重新确认本版本准确系统、对白及旧图用途和演出'})
        await confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
      }
      await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
      const next=(await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).build!
      expect(next.status).toBe('preview-ready');const preview=await verifyStoredProductBuildPreview(next)
      expect(preview!.runtimePackage.modules[0].stage.assets[0].contentHash).toBe(raw.contentHash)
      expect(await db.productBuildArtifacts.where('buildId').equals(next.id!).filter(r=>r.artifactKey.startsWith('avg.media.raw.')).count()).toBe(0)
      expect(await db.avgDraftMedia.where('workId').equals(s.scope.workId).count()).toBe(1) // Original reference only; no image import alias.
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
      expect((await db.productBuilds.get(s.buildId))!.previewHash).toBe(old.previewHash)
      await verifyProductBuildTerminalArtifactSetV1({scope:s.scope,productionId:s.productionId,buildId:next.id!,expectedControlEpoch:next.controlEpoch,expectedPlanHash:next.planHash})
      const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),copied=(await db.productBuilds.where('projectId').equals(projectId).sortBy('buildNumber')).at(-1)!
      const scope={projectId,workId:copied.workId!,worldId:copied.worldId!}
      // Existing V1 restore permits frozen Preview/source reads; it does not
      // rebind old producer Runs or grant current author/publication authority.
      await expect(recoverImportedProductProductionProofsV1({scope,productionId:copied.productionId})).rejects.toThrow(/不支持导入生产证明复验/)
      const copiedWorkspace=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(scope)).editorJson)
      expect((await readAvgAdoptedGeneratedImageV2({scope,source:copiedWorkspace.presentation.inheritedImages![0].source})).data).toEqual(s.imageBytes)
      const session=await startProductProductionPreviewV1({scope,productionId:copied.productionId,expectedBuildId:copied.id!,expectedPreviewHash:copied.previewHash!})
      expect((await db.productRuntimeSessions.get(session.sessionId))!.productBuildId).toBe(copied.id)
      const restored=(await db.productBuilds.get(copied.id!))!,restoredPreview=await verifyStoredProductBuildPreview(restored)
      expect(restoredPreview!.runtimePackage.modules[0].stage.assets[0].contentHash).toBe(raw.contentHash)
      await deleteWork(scope.workId)
      expect(await verifyStoredProductBuildPreview(next)).not.toBeNull()
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)
    it.each(['draft-save','brief-save','brief-save-remap'] as const)('preserves evidence after %s failure and explicitly completes the same offline continuation on retry',async failure=>{
      const {s,raw}=generated,input=await continuation(true),before=await readAvgDraftV1(s.scope),original=await current(s)
      const add=db.productProductionBriefs.add.bind(db.productProductionBriefs)
      const spy=failure==='draft-save'?vi.spyOn(db.avgAuthoringDrafts,'put').mockImplementationOnce(()=>{throw new Error('controlled-retention-draft-save')})
        :vi.spyOn(db.productProductionBriefs,'add').mockImplementation((row,...args)=>{if(JSON.parse(row.briefJson).avgAssembly?.version===1)throw new Error('controlled-retention-brief-save');return add(row,...args)})
      await expect(prepareAvgAssemblyBriefV1(input)).rejects.toThrow(/controlled-retention/);spy.mockRestore()
      if(failure==='draft-save')expect(await readAvgDraftV1(s.scope)).toEqual(before)
      else expect(parseAvgAuthorWorkspaceV1((await readAvgDraftV1(s.scope)).editorJson).presentation.inheritedImages).toHaveLength(1)
      if(failure!=='draft-save'){
        const refreshed=await readAvgAssemblyWorkspaceV1(s.scope,s.productionId)
        expect(refreshed.imageDefinition).toBeNull();expect(refreshed.visualProgress).toBeNull()
        expect(refreshed.details!.brief!.revision).toBeGreaterThan(original.briefRevision)
      }
      expect(await current(s)).toEqual(original);expect((await db.productBuildArtifacts.get(raw.id!))!.contentHash).toBe(raw.contentHash)
      expect(await db.productBuilds.where('workId').equals(s.scope.workId).count()).toBe(1)
      if(failure==='brief-save-remap'){
        const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
        const scope={projectId,worldId:build.worldId!,workId:build.workId!}
        const runs=await db.agentRuns.where('productBuildId').equals(build.id!).toArray()
        const events=await db.agentRunEvents.where('projectId').equals(projectId).toArray()
        await expect(assertAvgVisualPlanningRestartKnownV4(scope,build)).resolves.toBeUndefined()
        expect((await readAvgAssemblyWorkspaceV1(scope,build.productionId)).imageDefinition).toBeNull()
        const restored=await prepareAvgAssemblyBriefV1({scope,expectedDraftRevision:(await readAvgDraftV1(scope)).revision,
          visualStageContinuation:{expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision}})
        expect(parseProductProductionBriefV3(restored.brief!.briefJson).avgAssembly!.version).toBe(1)
        expect(await db.productProductionCommands.where('productionId').equals(build.productionId).filter(row=>row.type==='evolve'&&row.status==='succeeded').count()).toBe(1)
        expect(await db.agentRuns.where('productBuildId').equals(build.id!).toArray()).toEqual(runs)
        expect(await db.agentRunEvents.where('projectId').equals(projectId).toArray()).toEqual(events)
        await expect(assertAvgVisualPlanningRestartKnownV4(scope,build)).resolves.toBeUndefined()
        await deleteWork(scope.workId)
      }
      const next=await prepareAvgAssemblyBriefV1({...input,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision})
      expect(parseProductProductionBriefV3(next.brief!.briefJson).avgAssembly!.version).toBe(1)
      expect((await readAvgAssemblyWorkspaceV1(s.scope,s.productionId)).imageDefinition).toBeNull()
      expect(next.production.status).toBe('brief-ready');expect(s.imageFetcher).toHaveBeenCalledTimes(1);expect(s.runText).toHaveBeenCalledTimes(2)
      // The existing command ledger owns retry identity; no second evolution.
      expect(await db.productProductionCommands.where('productionId').equals(s.productionId).filter(row=>row.type==='evolve'&&row.status==='succeeded').count()).toBe(1)
    },30_000)
    it('rejects a concurrent pending Brief saved after image-source verification before it can overwrite the other author or draft',async()=>{
      const {s}=generated,input=await continuation(),before=await readAvgDraftV1(s.scope)
      const inherit=stageImageSources.prepareAvgInheritedStageDraftV1
      let otherRevision=0
      vi.spyOn(stageImageSources,'prepareAvgInheritedStageDraftV1').mockImplementationOnce(async args=>{
        const result=await inherit(args),details=await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])
        const brief=parseProductProductionBriefV3({...s.brief,intent:{...s.brief.intent,openingSituation:'另一编辑器明确保存的待开始方案'}})
        const saved=await executeProductProductionCommand({scope:s.scope,productionId:s.productionId,command:{type:'save-brief-revision',commandId:'concurrent-pending-author',
          expectedStateRevision:details.production.stateRevision,parentRevision:details.brief!.revision,brief}})
        expect(saved.ok).toBe(true);otherRevision=Number(saved.result.briefRevision);return result
      })
      await expect(prepareAvgAssemblyBriefV1(input)).rejects.toThrow(/变化/)
      expect(await readAvgDraftV1(s.scope)).toEqual(before)
      const current=await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])
      expect(current.brief!.revision).toBe(otherRevision);expect(parseProductProductionBriefV3(current.brief!.briefJson).intent.openingSituation).toBe('另一编辑器明确保存的待开始方案')
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it('preserves an unrelated pending professional Brief instead of overwriting it as an offline continuation',async()=>{
      const {s}=generated,input=await continuation(),details=await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])
      const saved=await executeProductProductionCommand({scope:s.scope,productionId:s.productionId,command:{type:'save-brief-revision',commandId:'other-explicit-pending',
        expectedStateRevision:details.production.stateRevision,parentRevision:details.brief!.revision,brief:s.brief}})
      expect(saved.ok).toBe(true);const before=await readAvgDraftV1(s.scope)
      await expect(prepareAvgAssemblyBriefV1(input)).rejects.toThrow(/其他待开始方案/)
      expect(await readAvgDraftV1(s.scope)).toEqual(before)
      expect((await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).brief!.revision).toBe(details.brief!.revision+1)
    })
    it.each(['stale-build','stale-draft','missing-choice','missing-source-proof','unknown-call','world-drift','disabled-feature'] as const)('rejects %s without preparing a new Brief or changing original pixels',async failure=>{
      const {s,raw}=generated,input=await continuation(),details=await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])
      if(failure==='stale-build')input.visualStageContinuation.expectedBuildRevision++
      if(failure==='stale-draft')input.expectedDraftRevision++
      if(failure==='disabled-feature')vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','0')
      if(failure==='missing-choice')await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(r=>r.artifactKey.startsWith('avg.media.choice.')).delete()
      if(failure==='missing-source-proof'){const c=(await accepted(s,'avg.media.compiled-visual-requirements'))!;await db.productBuildArtifacts.update(c.id!,{qualityJson:'{}'})}
      if(failure==='unknown-call'){const build=await current(s),ledger=JSON.parse(build.budgetLedgerJson);ledger.attempts[0].usageKnown=false;await db.productBuilds.update(build.id!,{budgetLedgerJson:JSON.stringify(ledger)})}
      if(failure==='world-drift'){const draft=await readAvgDraftV1(s.scope);await db.avgAuthoringDrafts.update(draft.id!,{worldReleaseId:999999})}
      await expect(prepareAvgAssemblyBriefV1(input)).rejects.toThrow()
      if(failure==='disabled-feature'){
        const choice=(await accepted(s,`avg.media.choice.${generated.requirement.requirementKey}`))!
        const source=await prepareAvgAdoptedGeneratedImageV2({scope:s.scope,choiceId:choice.id!})
        expect((await readAvgAdoptedGeneratedImageV2({scope:s.scope,source:source.source})).data).toEqual(s.imageBytes)
      }
      expect((await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).brief!.id).toBe(details.brief!.id)
      expect((await db.productBuildArtifacts.get(raw.id!))!.contentHash).toBe(raw.contentHash)
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
  })


  describe('current V4 raw revalidation producer',()=>{
    async function prepareRetained(s:Setup,raw:ProductBuildArtifactRecordV1,adapterId?:typeof AVG_IMAGE_REFERENCE_CAPABILITY_V2.adapterId){
      const parent=await current(s),origin=await prepareAvgVisualRawReuseSourceV4({scope:s.scope,buildId:s.buildId,expectedBuildRevision:parent.stateRevision,
        controlEpoch:s.plan.controlEpoch,expectedBriefHash:parent.briefHash,expectedPlanHash:parent.planHash,
        artifact:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})
      const pending=await restartAvgVisualPlanningFromDraftV4(await restartInput(s))
      const options=await readAvgVisualReuseOptionsV4({scope:s.scope,productionId:s.productionId,buildNumber:parent.buildNumber,expectedBuildRevision:parent.stateRevision})
      const draft=await readAvgDraftV1(s.scope)
      const roles=await prepareAvgVisualProposalReuseV4({scope:s.scope,productionId:s.productionId,expectedBriefHash:pending.brief!.briefHash,
        expectedDraftRevision:draft.revision,expectedBuildId:parent.id!,expectedBuildRevision:parent.stateRevision,
        selections:options.options.flatMap(o=>o.available?[o.selection]:[])})
      const selectedRoute=adapterId?await prepareAvgVisualImageRouteV4({scope:s.scope,productionId:s.productionId,expectedBriefHash:roles.brief!.briefHash,expectedDraftRevision:draft.revision,
        expectedBuild:{id:parent.id!,revision:parent.stateRevision},adapterId}):roles
      const ready=await prepareAvgVisualRawReuseV4({scope:s.scope,productionId:s.productionId,expectedBriefHash:selectedRoute.brief!.briefHash,
        expectedDraftRevision:draft.revision,expectedBuildId:parent.id!,expectedBuildRevision:parent.stateRevision,sources:[origin]})
      return {ready,origin,parent}
    }
    async function startRetained(s:Setup,ready:Awaited<ReturnType<typeof prepareRetained>>['ready']){
      const brief=parseProductProductionBriefV3(ready.brief!.briefJson)
      useAIConfigStore.getState().setConfig({apiKey:''})
      const details=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:ready.brief!.briefHash}),build=details.build!
      const execution=await resolveAvgVisualPlanningExecutionV4(s.scope,brief,build.id!),executor=createConfiguredProductProductionExecutorV1({production:details.production,brief,runText:s.runText,...execution})
      return {...s,brief,buildId:build.id!,plan:parseProductProductionPlanV3(build.planJson,brief,build.briefHash),executor,capabilityBindings:execution.capabilityBindings}
    }
    async function adoptRetainedRoles(child:Setup,changePrompt=false){
      await sources(child);await run(child)
      const direction=(await accepted(child,'avg.proposal.visual-bible'))!
      await adopt(child,await stage(child,'avg.media.visual-bible',JSON.parse(direction.payloadJson).payload));await run(child)
      const subject=(await accepted(child,`avg.proposal.environment-brief.${child.media.subjectKey}`))!,payload=JSON.parse(subject.payloadJson).payload
      if(changePrompt)payload.outputs[0].prompt+='；本版作者改为另一种窗户构图'
      await adopt(child,await stage(child,`avg.media.environment-brief.${child.media.subjectKey}`,payload))
    }
    async function preparedOriginal(){
      const generated=await generatedImage('valid'),{s,raw}=generated
      await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
      return {...generated,...await prepareRetained(s,raw)}
    }
    it('uses a real zero-capability Harness with no Key, keeps unselected original bytes and requires current author review and choice',async()=>{
      const generated=await generatedImage('valid'),{s,raw}=generated
      await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
      const {ready,origin}=await prepareRetained(s,raw)
      const brief=parseProductProductionBriefV3(ready.brief!.briefJson)
      expect(brief.productionBudget).toMatchObject({maximumModelCalls:0,maximumMediaCalls:0,maximumCostUsd:0})
      const originalRows=await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()
      useAIConfigStore.getState().setConfig({apiKey:''})
      const details=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:ready.brief!.briefHash})
      const build=details.build!,execution=await resolveAvgVisualPlanningExecutionV4(s.scope,brief,build.id!)
      const executor=createConfiguredProductProductionExecutorV1({production:details.production,brief,runText:s.runText,...execution})
      const child={...s,buildId:build.id!,brief,plan:parseProductProductionPlanV3(build.planJson,brief,build.briefHash),executor,capabilityBindings:execution.capabilityBindings}
      await sources(child);await run(child)
      const direction=(await accepted(child,'avg.proposal.visual-bible'))!
      await adopt(child,await stage(child,'avg.media.visual-bible',JSON.parse(direction.payloadJson).payload));await run(child)
      const subject=(await accepted(child,`avg.proposal.environment-brief.${s.media.subjectKey}`))!
      await adopt(child,await stage(child,`avg.media.environment-brief.${s.media.subjectKey}`,JSON.parse(subject.payloadJson).payload))
      await cycle(child);await cycle(child)
      const currentRaw=await accepted(child,raw.artifactKey)
      expect(currentRaw,(await current(child)).failureJson).toBeDefined()
      expect(currentRaw!.requirementKey).toBeNull();expect(currentRaw!.payloadJson).toBe(raw.payloadJson)
      expect(currentRaw!.metadataJson).toBe(raw.metadataJson);expect(currentRaw!.rightsJson).toBe(raw.rightsJson)
      expect(currentRaw!.contentHash).toBe(raw.contentHash)
      expect(currentRaw!.producerRunId).not.toBe(raw.producerRunId)
      const runProof=await readAgentRunV1(s.scope,currentRaw!.producerRunId!)
      expect(runProof.events.some(e=>e.type==='model.requested'||e.type==='tool.called'||e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='raw-response')).toBe(false)
      const ledger=JSON.parse((await current(child)).budgetLedgerJson)
      expect(ledger.attempts.every((a:{usage:{modelCalls:number;mediaCalls:number;costUsd:number}|null})=>a.usage&&a.usage.modelCalls===0&&a.usage.mediaCalls===0&&a.usage.costUsd===0)).toBe(true)
      expect(await accepted(child,`avg.review.visual.${origin.requirementKey}`)).toBeUndefined()
      const choose=()=>stageAvgMediaChoiceV2({scope:s.scope,productionId:s.productionId,requirementKey:origin.requirementKey,
        rawVersion:currentRaw!.version,rawContentHash:currentRaw!.contentHash,declaration:'明确选用本版复验图，仅工程观察'})
      await expect(choose()).rejects.toThrow()
      const definition=await readAvgImageConsumptionDefinitionV4({scope:s.scope,buildId:child.buildId,brief})
      const report=avgVisualReviewFixture(definition.mediaBatch.requirements[0],currentRaw!.contentHash)
      const review=await stageAvgVisualReviewV1({scope:s.scope,productionId:s.productionId,requirementKey:origin.requirementKey,
        rawVersion:currentRaw!.version,rawContentHash:currentRaw!.contentHash,report,declaration:'本版重新观察工程原图；非艺术或真人验收'})
      await adopt(child,review);await adopt(child,await choose())
      expect(await accepted(child,`avg.media.choice.${origin.requirementKey}`)).toBeTruthy()
      const currentDraft=await readAvgDraftV1(s.scope),configured=await configureAvgChosenMediaDraftV2({scope:s.scope,productionId:s.productionId,expectedDraftRevision:currentDraft.revision})
      mockStageImageObservation()
      await adopt(child,await stageAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:configured.revision,
        artifactKey:'avg.author.stage',declaration:'确认本版原图复验后的准确演出；仅工程验收'}))
      const finished=await run(child),frozen=await current(child)
      expect(finished.buildStatus,frozen.failureJson).toBe('preview-ready')
      const preview=await verifyStoredProductBuildPreview(frozen),module=preview.runtimePackage.modules[0]
      if(module.version!==2)throw new Error('Expected native V2 module')
      expect(module.stage.assets[0].contentHash).toBe(raw.contentHash)
      const zeroProof=await imageProducerProof.verifyHistoricalAvgImageRevalidationProducerV1({scope:s.scope,buildId:frozen.id!,
        expectedBuildRevision:frozen.stateRevision,expectedBriefHash:frozen.briefHash,expectedPlanHash:frozen.planHash,sourceControlEpoch:frozen.controlEpoch,
        artifactKey:currentRaw!.artifactKey,version:currentRaw!.version,contentHash:currentRaw!.contentHash})
      expect(zeroProof.provenance).toMatchObject({schema:'storyforge.avg.image-revalidation-producer-proof',version:1,noProviderRequest:true})
      const currentChoice=(await accepted(child,`avg.media.choice.${origin.requirementKey}`))!
      const selected=await prepareAvgAdoptedGeneratedImageV2({scope:s.scope,choiceId:currentChoice.id!})
      expect(selected.source.version).toBe(3)
      if(selected.source.version!==3)throw new Error('Expected distinct local source3')
      expect(selected.source.raw.schema).toBe('storyforge.avg.image-revalidation-producer-proof')
      expect(selected.source.original).toEqual(origin)
      expect(parseAvgGeneratedReferenceSourceV3(selected.source)).toEqual(selected.source)
      expect(()=>parseAvgGeneratedReferenceSourceV1(selected.source)).toThrow()
      expect(()=>parseAvgGeneratedReferenceSourceV2(selected.source)).toThrow()
      expect((await readAvgAdoptedGeneratedImageV2({scope:s.scope,source:selected.source})).data).toEqual(s.imageBytes)
      await expect(readAvgAdoptedGeneratedImageV2({scope:s.scope,source:{...selected.source,raw:{...selected.source.raw,revalidationEvidenceHash:'f'.repeat(64)}}})).rejects.toThrow()
      const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),copy=(await db.productBuilds.where('projectId').equals(projectId).filter(b=>b.buildNumber===frozen.buildNumber).first())!
      const copyScope={projectId,worldId:copy.worldId,workId:copy.workId}
      expect((await verifyStoredProductBuildPreview(copy)).previewHash).toBe(frozen.previewHash)
      expect((await readAvgAdoptedGeneratedImageV2({scope:copyScope,source:selected.source})).data).toEqual(s.imageBytes)
      const outbound=await avgVersionedReferenceTransportFixture({scope:copyScope,...selected})
      expect(outbound.projectUnchanged).toBe(true);expect(outbound.dispatch).toHaveBeenCalledTimes(1);expect(outbound.compiled.batch.requirements).toHaveLength(5);expect(outbound.frozen.targetFamily).toEqual(outbound.compiled.batch.requirements[0].family)
      expect(outbound.reference.generatedSource?.version).toBe(3)
      await recoverImportedProductProductionProofsV1({scope:copyScope,productionId:copy.productionId})
      await verifyProductBuildTerminalArtifactSetV1({scope:copyScope,productionId:copy.productionId,buildId:copy.id!,expectedControlEpoch:copy.controlEpoch,expectedPlanHash:copy.planHash})
      await deleteWork(copyScope.workId!,copyScope)
      expect(await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()).toEqual(originalRows)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },120_000)
    it('retains the successful original Image2.1 and dispatches only the failed slot through the explicitly selected Image2.5 model',async()=>{
      const s=await setup({image:'valid',secondImage:true})
      s.imageFetcher.mockImplementationOnce(async()=>new Response(JSON.stringify({data:[{b64_json:s.imageBase64}]}),{headers:{'content-type':'application/json'}}))
        .mockImplementationOnce(async()=>new Response(JSON.stringify({error:{message:'known 503'}}),{status:503,headers:{'content-type':'application/json'}}))
      await sources(s);await run(s);await adopt(s,await stage(s,'avg.media.visual-bible',s.bible));await run(s)
      await adopt(s,await stage(s,`avg.media.environment-brief.${s.media.subjectKey}`,s.media));await run(s)
      const raw=(await accepted(s,`avg.media.raw.${s.media.outputs[0].requirementKey}`))!
      expect(raw).toBeDefined();expect(await accepted(s,`avg.media.raw.${s.media.outputs[1].requirementKey}`)).toBeUndefined()
      expect(s.imageFetcher).toHaveBeenCalledTimes(2)
      const {ready}=await prepareRetained(s,raw,AVG_IMAGE_REFERENCE_CAPABILITY_V2.adapterId),brief=parseProductProductionBriefV3(ready.brief!.briefJson)
      expect(brief.productionBudget).toMatchObject({maximumModelCalls:0,maximumMediaCalls:1})
      const details=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:ready.brief!.briefHash}),build=details.build!
      const execution=await resolveAvgVisualPlanningExecutionV4(s.scope,brief,build.id!),executor=createConfiguredProductProductionExecutorV1({production:details.production,brief,runText:s.runText,...execution})
      const child={...s,brief,buildId:build.id!,plan:parseProductProductionPlanV3(build.planJson,brief,build.briefHash),executor,capabilityBindings:execution.capabilityBindings}
      await sources(child);await run(child)
      const direction=(await accepted(child,'avg.proposal.visual-bible'))!;await adopt(child,await stage(child,'avg.media.visual-bible',JSON.parse(direction.payloadJson).payload));await run(child)
      const subject=(await accepted(child,`avg.proposal.environment-brief.${s.media.subjectKey}`))!
      await adopt(child,await stage(child,`avg.media.environment-brief.${s.media.subjectKey}`,JSON.parse(subject.payloadJson).payload));await run(child)
      const kept=(await accepted(child,raw.artifactKey))!,fresh=(await accepted(child,`avg.media.raw.${s.media.outputs[1].requirementKey}`))!
      expect(kept,(await current(child)).failureJson).toBeDefined();expect(fresh,(await current(child)).failureJson).toBeDefined()
      expect(kept.payloadJson).toBe(raw.payloadJson);expect(JSON.parse(kept.metadataJson).source).toBe('agnes.image-2.1-flash.v1')
      expect(JSON.parse(fresh.metadataJson).source).toBe('agnes.image-2.5-flash.v1')
      expect(JSON.parse(String(s.imageFetcher.mock.calls[2][1]!.body)).model).toBe('agnes-image-2.5-flash')
      expect(s.imageFetcher).toHaveBeenCalledTimes(3);expect(s.runText).toHaveBeenCalledTimes(2)
      const ledger=JSON.parse((await current(child)).budgetLedgerJson)
      expect(ledger.attempts.reduce((n:number,a:{usage:{mediaCalls:number}|null})=>n+(a.usage?.mediaCalls??0),0)).toBe(1)
    },60_000)
    it('rejects an incompatible current adopted design without generating a replacement',async()=>{
      const {s,raw,ready}=await preparedOriginal(),child=await startRetained(s,ready)
      await adoptRetainedRoles(child,true);await run(child)
      expect(await accepted(child,raw.artifactKey)).toBeUndefined();expect((await current(child)).failureJson).toContain('不兼容')
      expect((await db.productBuildArtifacts.get(raw.id!))!.payloadJson).toBe(raw.payloadJson)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)
    it.each(['provider-envelope','asset-origin','compiled-origin'] as const)('rejects a replaced %s at actual sealed admission with no paid fallback',async mode=>{
      const {s,raw,ready}=await preparedOriginal(),child=await startRetained(s,ready),execute=child.executor
      child.executor=async input=>{
        const result=await execute(input)
        if(input.task.kind!=='avg-media-image-reuse')return result
        return {...result,artifacts:result.artifacts.map(a=>mode==='provider-envelope'?{...a,requirementKey:'avg.media.image'}
          :mode==='asset-origin'?{...a,metadata:{...(a.metadata as Record<string,unknown>),source:'agnes.image-2.5-flash.v1'}}
          :{...a,quality:{...(a.quality as Record<string,unknown>),sourceCompilation:{artifactKey:'avg.media.compiled-visual-requirements',version:1,contentHash:'f'.repeat(64)}}})}
      }
      await adoptRetainedRoles(child);await expect(run(child)).rejects.toThrow()
      expect(await accepted(child,raw.artifactKey)).toBeUndefined()
      expect((await db.productBuildArtifacts.get(raw.id!))!.payloadJson).toBe(raw.payloadJson)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)
    it('rechecks damaged selected bytes at explicit start before creating another Build or Run',async()=>{
      const {s,raw,ready}=await preparedOriginal(),blob=(await db.mediaBlobObjects.get(raw.blobObjectId!))!,bytes=new Uint8Array(blob.data!.slice(0))
      bytes[bytes.length-1]^=1;await db.mediaBlobObjects.update(blob.id!,{data:bytes.buffer})
      const runs=await db.agentRuns.count()
      useAIConfigStore.getState().setConfig({apiKey:''})
      await expect(startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:ready.brief!.briefHash})).rejects.toThrow()
      expect(await db.productBuilds.count()).toBe(1);expect(await db.agentRuns.count()).toBe(runs)
      expect((await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).brief!.briefHash).toBe(ready.brief!.briefHash)
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)
    it('idempotently keeps the exact source and explicitly clears it back to a finite paid requirement without dispatch',async()=>{
      const {s,ready,origin,parent}=await preparedOriginal(),draft=await readAvgDraftV1(s.scope)
      const input={scope:s.scope,productionId:s.productionId,expectedBriefHash:ready.brief!.briefHash,expectedDraftRevision:draft.revision,
        expectedBuildId:parent.id!,expectedBuildRevision:parent.stateRevision,sources:[origin]}
      const before=await exportProjectJSON(s.scope.projectId)
      await prepareAvgVisualRawReuseV4(input)
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      useAIConfigStore.getState().setConfig({apiKey:''})
      const cleared=await prepareAvgVisualRawReuseV4({...input,sources:[]}),brief=parseProductProductionBriefV3(cleared.brief!.briefJson)
      expect(brief.avgVisualPlanning!.rawReuse).toBeUndefined();expect(brief.productionBudget).toMatchObject({maximumModelCalls:0,maximumMediaCalls:1})
      expect(brief.capabilityRequirements.find(c=>c.mediaClass==='image')!.required).toBe(true)
      await expect(startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:cleared.brief!.briefHash})).rejects.toThrow()
      expect(await db.productBuilds.count()).toBe(1);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)
  })

    // These cases use the public recipe command and actual scheduler. The
    // native canvas is controlled here; separate browser tests prove pixels.
  describe('V4 processing from direct and revalidated originals',()=>{
    it.each(['kernel-failure','damaged-original','swapped-recipe','swapped-compiler'] as const)('rejects %s without replacing original records or retrying image generation',async mode=>{
      const output=await deterministicRegionMapPngV1({width:576,height:324,palette:['#293021','#857456','#f1d390']})
      const process=vi.spyOn(imageProcessing,'processAvgImageBytesV1').mockImplementation(async input=>{
        if(mode==='kernel-failure')throw new Error('controlled native processor unavailable')
        return {data:output,receipt:await avgImageProcessingReceiptFixture({recipe:input.recipe,source:{...input.source,byteSize:input.data.byteLength},data:output})}
      })
      vi.spyOn(imageDecoder,'inspectAvgImageBytesV1').mockResolvedValue({width:576,height:324,hasAlpha:false})
      const s=await setup({image:'valid',processing:true});await sources(s);await run(s)
      await adopt(s,await stage(s,'avg.media.visual-bible',s.bible));await run(s)
      await adopt(s,await stage(s,`avg.media.environment-brief.${s.media.subjectKey}`,s.media))
      await cycle(s);await cycle(s)
      const key=s.media.outputs[0].requirementKey,raw=(await accepted(s,`avg.media.raw.${key}`))!
      expect(raw,(await current(s)).failureJson).toBeDefined();expect(process).not.toHaveBeenCalled()
      const original=await db.mediaBlobObjects.get(raw.blobObjectId!),originalBytes=original!.data.slice(0)
      const before=await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])
      await expect(prepareAvgVisualImageProcessingV4({scope:s.scope,productionId:s.productionId,expectedBriefHash:before.brief!.briefHash,
        expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision,expectedBuild:{id:s.buildId,revision:before.build!.stateRevision},plan:null})).rejects.toThrow(/已变化/)
      let expectedStoredHash=raw.contentHash
      if(mode==='damaged-original'){
        const broken=new Uint8Array(originalBytes.slice(0));broken[broken.length-1]^=1
        expectedStoredHash=await sha256MediaData(broken.buffer)
        await db.mediaBlobObjects.update(original!.id!,{data:broken.buffer})
      }
      const executor:typeof s.executor=async input=>{
        const result=await s.executor(input)
        if(input.task.kind==='avg-media-image-process'){
          const artifact=result.artifacts[0]
          if(mode==='swapped-recipe')artifact.payload={...artifact.payload as object,recipe:{...avgImageProcessingRecipeFixture(),declaration:'not the frozen recipe'}}
          if(mode==='swapped-compiler')artifact.quality={...artifact.quality as object,sourceCompilation:{artifactKey:'avg.media.compiled-visual-requirements',version:1,contentHash:'f'.repeat(64)}}
        }
        return result
      }
      const sealedTamper=mode==='swapped-recipe'||mode==='swapped-compiler'
      if(sealedTamper)await expect(runProductProductionUntilBlockedV1({...s,executor})).rejects.toThrow(/加工/)
      else{await runProductProductionUntilBlockedV1({...s,executor});expect((await current(s)).status).toBe('recovery-required')}
      expect(await accepted(s,`avg.media.processed.${key}`)).toBeUndefined()
      expect(await db.productBuildArtifacts.get(raw.id!)).toEqual(raw)
      expect(process).toHaveBeenCalledTimes(mode==='damaged-original'?0:1)
      expect(await sha256MediaData((await db.mediaBlobObjects.get(raw.blobObjectId!))!.data)).toBe(expectedStoredHash)
      if(!sealedTamper){
        const ledger=JSON.parse((await current(s)).budgetLedgerJson).tasks[`avg.media.process.${key}`]
        expect(ledger).toMatchObject(mode==='damaged-original'
          // Damaged bytes fail before executor/provider dispatch: observed usage
          // is exactly zero; null is reserved for a requested but unknown result.
          ?{status:'failed',errorCode:'task-preflight-failed',usage:{costUsd:0,durationMs:0,inputTokens:0,mediaCalls:0,modelCalls:0,outputTokens:0,storageBytes:0}}
          :{status:'failed',errorCode:'task-draft-rejected',usage:{modelCalls:0,mediaCalls:0,costUsd:0}})
      }
      db.close();await db.open()
      if(sealedTamper)await expect(runProductProductionUntilBlockedV1({...s,executor})).rejects.toThrow(/加工/)
      else await runProductProductionUntilBlockedV1({...s,executor})
      expect(process).toHaveBeenCalledTimes(mode==='damaged-original'?0:1)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)
    it.each(['direct','revalidated'] as const)('processes an exact %s raw, requires current derivative review and choice and restores Source4',async mode=>{
      const output=await deterministicRegionMapPngV1({width:576,height:324,palette:['#293021','#857456','#f1d390']})
      const process=vi.spyOn(imageProcessing,'processAvgImageBytesV1').mockImplementation(async input=>({data:output,
        receipt:await avgImageProcessingReceiptFixture({recipe:input.recipe,source:{...input.source,byteSize:input.data.byteLength},data:output})}))
      let child:Setup
      if(mode==='revalidated'){
        const generated=await generatedImage('valid'),{s,raw}=generated
        await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
        const parent=await current(s),origin=await prepareAvgVisualRawReuseSourceV4({scope:s.scope,buildId:s.buildId,expectedBuildRevision:parent.stateRevision,
          controlEpoch:s.plan.controlEpoch,expectedBriefHash:parent.briefHash,expectedPlanHash:parent.planHash,artifact:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})
        const pending=await restartAvgVisualPlanningFromDraftV4(await restartInput(s)),draft=await readAvgDraftV1(s.scope)
        const options=await readAvgVisualReuseOptionsV4({scope:s.scope,productionId:s.productionId,buildNumber:parent.buildNumber,expectedBuildRevision:parent.stateRevision})
        const roles=await prepareAvgVisualProposalReuseV4({scope:s.scope,productionId:s.productionId,expectedBriefHash:pending.brief!.briefHash,
          expectedDraftRevision:draft.revision,expectedBuildId:parent.id!,expectedBuildRevision:parent.stateRevision,selections:options.options.flatMap(o=>o.available?[o.selection]:[])})
        const retained=await prepareAvgVisualRawReuseV4({scope:s.scope,productionId:s.productionId,expectedBriefHash:roles.brief!.briefHash,
          expectedDraftRevision:draft.revision,expectedBuildId:parent.id!,expectedBuildRevision:parent.stateRevision,sources:[origin]})
        const ready=await prepareAvgVisualImageProcessingV4({scope:s.scope,productionId:s.productionId,expectedBriefHash:retained.brief!.briefHash,
          expectedDraftRevision:draft.revision,expectedBuild:{id:parent.id!,revision:parent.stateRevision},
          plan:{schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:origin.requirementKey,recipe:avgImageProcessingRecipeFixture()}]}})
        const pendingView=await readAvgAssemblyWorkspaceV1(s.scope)
        expect(pendingView.processingTasks).toEqual([]);expect(pendingView.details!.brief!.briefHash).toBe(ready.brief!.briefHash)
        const brief=parseProductProductionBriefV3(ready.brief!.briefJson);useAIConfigStore.getState().setConfig({apiKey:''})
        const details=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:ready.brief!.briefHash}),build=details.build!
        const execution=await resolveAvgVisualPlanningExecutionV4(s.scope,brief,build.id!)
        child={...s,brief,buildId:build.id!,plan:parseProductProductionPlanV3(build.planJson,brief,build.briefHash),capabilityBindings:execution.capabilityBindings,
          executor:createConfiguredProductProductionExecutorV1({production:details.production,brief,runText:s.runText,...execution})}
        expect(brief.productionBudget).toMatchObject({maximumModelCalls:0,maximumMediaCalls:0,maximumCostUsd:0})
      }else child=await setup({image:'valid',processing:true})
      vi.spyOn(imageDecoder,'inspectAvgImageBytesV1').mockResolvedValue({width:576,height:324,hasAlpha:false})
      await sources(child);await run(child)
      const direction=(await accepted(child,'avg.proposal.visual-bible'))!
      await adopt(child,await stage(child,'avg.media.visual-bible',JSON.parse(direction.payloadJson).payload));await run(child)
      const subject=(await accepted(child,`avg.proposal.environment-brief.${child.media.subjectKey}`))!
      await adopt(child,await stage(child,`avg.media.environment-brief.${child.media.subjectKey}`,JSON.parse(subject.payloadJson).payload));await run(child)
      const key=child.media.outputs[0].requirementKey,raw=(await accepted(child,`avg.media.raw.${key}`))!,processed=await accepted(child,`avg.media.processed.${key}`)
      expect(processed,(await current(child)).failureJson).toBeDefined();expect(processed!.contentHash).not.toBe(raw.contentHash)
      expect(processed!.requirementKey).toBeNull();expect(JSON.parse(processed!.qualityJson)).toMatchObject({schema:'storyforge.avg.visual-image-processing-evidence',noProviderRequest:true,decoderVerified:true})
      const ledger=JSON.parse((await current(child)).budgetLedgerJson).tasks[`avg.media.process.${key}`]
      expect(ledger).toMatchObject({status:'settled',usage:{modelCalls:0,mediaCalls:0,costUsd:0}})
      const base={scope:child.scope,productionId:child.productionId,requirementKey:key,rawVersion:raw.version,rawContentHash:raw.contentHash}
      await expect(stageAvgMediaChoiceV2({...base,declaration:'不能跳过当前加工'})).rejects.toThrow()
      const definition=await readAvgImageConsumptionDefinitionV4({scope:child.scope,buildId:child.buildId,brief:child.brief}),requirement=definition.mediaBatch.requirements[0]
      await expect(stageAvgVisualReviewV1({...base,report:avgVisualReviewFixture(requirement,raw.contentHash),declaration:'原图评审不能代签新加工图'})).rejects.toThrow()
      await adopt(child,await stageAvgVisualReviewV1({...base,report:avgVisualReviewFixture(requirement,processed!.contentHash),declaration:'本版重新观察加工结果；工程回执不代表真实艺术验收'}))
      await adopt(child,await stageAvgMediaChoiceV2({...base,processed:{version:processed!.version,contentHash:processed!.contentHash},declaration:'明确采用当前配方与加工图，保留原图和账单'}))
      const configured=await configureAvgChosenMediaDraftV2({scope:child.scope,productionId:child.productionId,expectedDraftRevision:(await readAvgDraftV1(child.scope)).revision})
      expect(parseAvgAuthorWorkspaceV1(configured.editorJson).imageProcessing).toBeUndefined()
      mockStageImageObservation()
      await adopt(child,await stageAvgWorkspaceInputV1({scope:child.scope,productionId:child.productionId,expectedDraftRevision:configured.revision,
        artifactKey:'avg.author.stage',declaration:'本版加工图的准确演出确认；仅工程材料'}))
      const result=await run(child),frozen=await current(child);expect(result.buildStatus,frozen.failureJson).toBe('preview-ready')
      const choice=(await accepted(child,`avg.media.choice.${key}`))!,selected=await prepareAvgAdoptedGeneratedImageV2({scope:child.scope,choiceId:choice.id!})
      expect(selected.source.version).toBe(4);if(selected.source.version!==4)throw new Error('Expected distinct local Source4')
      expect(parseAvgGeneratedReferenceSourceV4(selected.source)).toEqual(selected.source)
      for(const parse of [parseAvgGeneratedReferenceSourceV1,parseAvgGeneratedReferenceSourceV2,parseAvgGeneratedReferenceSourceV3])expect(()=>parse(selected.source)).toThrow()
      expect(selected.source.raw.contentHash).toBe(raw.contentHash);expect(selected.source.processing.contentHash).toBe(processed!.contentHash)
      expect(selected.source.raw.schema).toBe(mode==='direct'?'storyforge.avg.visual-image-producer-proof':'storyforge.avg.image-revalidation-producer-proof')
      expect((await readAvgAdoptedGeneratedImageV2({scope:child.scope,source:selected.source})).data).toEqual(output)
      const tampered=[{...selected.source,processing:{...selected.source.processing,proofHash:'f'.repeat(64)}},
        {...selected.source,raw:{...selected.source.raw,producerReceiptHash:'f'.repeat(64)}},
        {...selected.source,compilation:{...selected.source.compilation,contentHash:'f'.repeat(64)}},
        {...selected.source,review:{...selected.source.review,authorReceiptHash:'f'.repeat(64)}},
        {...selected.source,choice:{...selected.source.choice,contentHash:'f'.repeat(64)}}]
      for(const source of tampered)await expect(readAvgAdoptedGeneratedImageV2({scope:child.scope,source})).rejects.toThrow()
      expect(()=>parseAvgGeneratedReferenceSourceV4({...selected.source,processing:{...selected.source.processing,noProviderRequest:false}})).toThrow()
      expect(()=>parseAvgGeneratedReferenceSourceV4({...selected.source,original:selected.source})).toThrow()
      const derivativeBlob=(await db.mediaBlobObjects.get(processed!.blobObjectId!))!,damaged=new Uint8Array(derivativeBlob.data.slice(0));damaged[damaged.length-1]^=1
      await db.mediaBlobObjects.update(derivativeBlob.id!,{data:damaged.buffer})
      await expect(readAvgAdoptedGeneratedImageV2({scope:child.scope,source:selected.source})).rejects.toThrow()
      await db.mediaBlobObjects.update(derivativeBlob.id!,{data:derivativeBlob.data})
      await expect(readAvgAdoptedGeneratedImageV2({scope:{...child.scope,workId:child.scope.workId+999999},source:selected.source})).rejects.toThrow()
      const projectId=await importProjectJSON(await exportProjectJSON(child.scope.projectId)),copy=(await db.productBuilds.where('projectId').equals(projectId).filter(b=>b.buildNumber===frozen.buildNumber).first())!
      const scope={projectId,worldId:copy.worldId,workId:copy.workId}
      expect((await readAvgAdoptedGeneratedImageV2({scope,source:selected.source})).data).toEqual(output)
      const outbound=await avgVersionedReferenceTransportFixture({scope,...selected})
      expect(outbound.projectUnchanged).toBe(true);expect(outbound.dispatch).toHaveBeenCalledTimes(1);expect(outbound.compiled.batch.requirements).toHaveLength(5);expect(outbound.frozen.targetFamily).toEqual(outbound.compiled.batch.requirements[0].family)
      expect(outbound.reference.contentHash).toBe(processed!.contentHash)
      expect(outbound.reference.generatedSource?.version).toBe(4)
      await recoverImportedProductProductionProofsV1({scope,productionId:copy.productionId})
      await verifyProductBuildTerminalArtifactSetV1({scope,productionId:copy.productionId,buildId:copy.id!,expectedControlEpoch:copy.controlEpoch,expectedPlanHash:copy.planHash})
      await deleteWork(scope.workId);expect((await readAvgAdoptedGeneratedImageV2({scope:child.scope,source:selected.source})).data).toEqual(output)
      expect(child.runText).toHaveBeenCalledTimes(2);expect(child.imageFetcher).toHaveBeenCalledTimes(1);expect(process).toHaveBeenCalledTimes(1)
    },120_000)
  })

  describe('unselected V4 raw reuse compatibility',()=>{
    let generated:Awaited<ReturnType<typeof generatedImage>>
    beforeEach(async()=>{generated=await generatedImage('valid')})
    async function original(){
      const {s,raw}=generated
      await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
      const build=await current(s)
      return prepareAvgVisualRawReuseSourceV4({scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,
        controlEpoch:s.plan.controlEpoch,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,
        artifact:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})
    }
    it('proves unselected original pixels without credentials, author choice or writes and keeps old source codecs strict',async()=>{
      const {s,raw}=generated,source=await original()
      useAIConfigStore.getState().setConfig({apiKey:''})
      const before=await exportProjectJSON(s.scope.projectId),history=await readAvgVisualRawReuseSourceV4({scope:s.scope,source})
      expect(history.raw).toEqual(await db.productBuildArtifacts.get(raw.id!));expect(history.raw.payloadJson).toBe(raw.payloadJson)
      expect(history.raw.rightsJson).toBe(raw.rightsJson);expect(history.asset.contentHash).toBe(raw.contentHash)
      expect(await accepted(s,`avg.media.choice.${source.requirementKey}`)).toBeUndefined()
      expect(await accepted(s,`avg.review.visual.${source.requirementKey}`)).toBeUndefined()
      const build=await current(s),boundary={scope:s.scope,productionId:s.productionId,buildId:s.buildId,
        expectedBuildRevision:build.stateRevision,controlEpoch:s.plan.controlEpoch,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash}
      const candidates=await readAvgHistoricalImageCandidatesV4(boundary),candidate=candidates.candidates.find(c=>c.available)
      if(!candidate?.available)throw new Error('missing proved unselected candidate')
      expect(candidate.reuseSource).toEqual(source)
      const preview={...boundary,requirementKey:source.requirementKey,version:raw.version,contentHash:raw.contentHash,source:candidate.reuseSource}
      expect((await readAvgHistoricalImageCandidateBytesV4(preview)).data).toEqual(s.imageBytes)
      await expect(readAvgHistoricalImageCandidateBytesV4({...preview,expectedBuildRevision:build.stateRevision+1})).rejects.toThrow()
      await expect(readAvgHistoricalImageCandidateBytesV4({...preview,requirementKey:'another.requirement'})).rejects.toThrow()
      expect(parseAvgVisualRawReuseSourceV4(source)).toEqual(source)
      expect(()=>parseAvgVisualRawReuseSourceV4({...source,buildId:s.buildId})).toThrow()
      expect(()=>parseAvgVisualRawReuseSourceV4({...source,version:2})).toThrow()
      expect(()=>parseAvgGeneratedReferenceSourceV1(source)).toThrow();expect(()=>parseAvgGeneratedReferenceSourceV2(source)).toThrow()
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it('accepts only a logical requirement revision change while preserving the original request, physical version and fees',async()=>{
      const {s,raw,requirement}=generated,source=await original(),next={...requirement,revision:requirement.revision+1}
      const before=await exportProjectJSON(s.scope.projectId)
      const history=await inspectAvgVisualRawReuseCompatibilityV4({scope:s.scope,source,productionKey:source.productionKey,
        buildNumber:source.raw.buildNumber+1,sourceWorldContentHash:source.sourceWorldContentHash,requirement:next})
      expect(history.currentRequirement).toEqual(next);expect(history.currentRequirementHash).not.toBe(source.requirementHash)
      expect(history.raw.payloadJson).toBe(raw.payloadJson);expect(history.payload.requirement.revision).toBe(requirement.revision)
      expect(history.payload.provider).toEqual(JSON.parse(raw.payloadJson).provider)
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it('rejects changed visual semantics, reference permissions, consumer, world and ancestry without paid fallback',async()=>{
      const {s,requirement}=generated,source=await original()
      const input={scope:s.scope,source,productionKey:source.productionKey,buildNumber:source.raw.buildNumber+1,
        sourceWorldContentHash:source.sourceWorldContentHash,requirement}
      const alternatives=[{...requirement,prompt:requirement.prompt+' changed'}, {...requirement,negativePrompt:'changed'},
        {...requirement,family:{...requirement.family,revision:requirement.family.revision+1}},
        {...requirement,consumer:{...requirement.consumer,consumerKey:'another.consumer'}},
        {...requirement,width:requirement.width+16},{...requirement,alpha:'required'},
        {...requirement,references:[]},
        {...requirement,references:requirement.references.map((r:typeof requirement.references[number])=>({...r,allowedChange:'changed reference permission'}))},
        {...requirement,unexpectedFutureField:'must not disappear'}]
      for(const next of alternatives)await expect(inspectAvgVisualRawReuseCompatibilityV4({...input,requirement:next})).rejects.toThrow()
      await expect(inspectAvgVisualRawReuseCompatibilityV4({...input,sourceWorldContentHash:'f'.repeat(64)})).rejects.toThrow()
      await expect(inspectAvgVisualRawReuseCompatibilityV4({...input,productionKey:'another.production'})).rejects.toThrow()
      await expect(inspectAvgVisualRawReuseCompatibilityV4({...input,buildNumber:source.raw.buildNumber})).rejects.toThrow()
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it('rejects modified portable origin, compilation, requirement or HTTP proofs instead of trusting parsed hashes',async()=>{
      const {s}=generated,source=await original(),before=await exportProjectJSON(s.scope.projectId)
      for(const altered of [{...source,requirementHash:'f'.repeat(64)},{...source,semanticRequirementHash:'f'.repeat(64)},
        {...source,sourceWorldContentHash:'f'.repeat(64)},{...source,compilation:{...source.compilation,contentHash:'f'.repeat(64)}},
        ...(['proofHash','responseEvidenceHash','producerReceiptHash','candidateHash'] as const).map(key=>({...source,raw:{...source.raw,[key]:'f'.repeat(64)}}))]){
        await expect(readAvgVisualRawReuseSourceV4({scope:s.scope,source:altered})).rejects.toThrow()
      }
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it('rechecks original records after asynchronous descriptor hashes before returning reuse evidence',async()=>{
      const {s,raw}=generated,source=await original(),describe=rawReuseContract.avgVisualRawReuseDescriptorV4
      vi.spyOn(rawReuseContract,'avgVisualRawReuseDescriptorV4').mockImplementationOnce(async history=>{
        const result=await describe(history)
        await db.productBuildArtifacts.update(raw.id!,{qualityJson:'{}'})
        return result
      })
      await expect(readAvgVisualRawReuseSourceV4({scope:s.scope,source})).rejects.toThrow(/读取期间变化/)
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it('detects corrupt retained pixels and preserves the failure without retrying',async()=>{
      const {s,raw}=generated,source=await original(),blob=(await db.mediaBlobObjects.get(raw.blobObjectId!))!
      const bytes=new Uint8Array(blob.data!.slice(0));bytes[bytes.length-1]^=1
      await db.mediaBlobObjects.update(blob.id!,{data:bytes.buffer})
      await expect(readAvgVisualRawReuseSourceV4({scope:s.scope,source})).rejects.toThrow()
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it('resolves the same portable unselected source after full remap and deletes only the imported Work',async()=>{
      const {s,raw}=generated,source=await original(),before=await exportProjectJSON(s.scope.projectId)
      const projectId=await importProjectJSON(before),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
      const scope={projectId,worldId:build.worldId,workId:build.workId},copy=await readAvgVisualRawReuseSourceV4({scope,source})
      expect(copy.reuseSource).toEqual(source);expect(copy.raw.id).not.toBe(raw.id);expect(copy.raw.payloadJson).toBe(raw.payloadJson)
      expect(copy.raw.rightsJson).toBe(raw.rightsJson)
      await deleteWork(scope.workId!,scope)
      await expect(readAvgVisualRawReuseSourceV4({scope,source})).rejects.toThrow()
      expect((await readAvgVisualRawReuseSourceV4({scope:s.scope,source})).raw.payloadJson).toBe(raw.payloadJson)
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
    it('keeps the original proof inside a caller transaction and rolls back a later author write',async()=>{
      const {s,raw}=generated,source=await original()
      await expect(db.transaction('rw',scopeTransactionTables(db.productProductions,db.productProductionBriefs,
        db.productProductionCommands,db.productBuilds,db.productBuildArtifacts,db.avgDraftMedia,db.mediaBlobObjects,
        db.agentRuns,db.agentRunEvents,db.agentRunCheckpoints,db.agentRunArtifacts),async()=>{
        await readAvgVisualRawReuseSourceV4({scope:s.scope,source})
        await db.productBuildArtifacts.update(raw.id!,{updatedAt:raw.updatedAt+1})
        throw new Error('controlled unselected raw transaction rollback')
      })).rejects.toThrow('controlled unselected raw transaction rollback')
      expect((await db.productBuildArtifacts.get(raw.id!))!.updatedAt).toBe(raw.updatedAt)
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })
  })

  describe('full historical V4 compiled image definition',()=>{
    let generated:Awaited<ReturnType<typeof generatedImage>>
    beforeEach(async()=>{generated=await generatedImage('valid')})
    async function boundary(stop=true){
      const {s}=generated
      if(stop)await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
      const build=await current(s)
      return {scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:s.plan.controlEpoch,
        expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash}
    }
    it('proves original author/model/compiler/reference inputs after stop without a Stage, credentials, writes or new adoption',async()=>{
      const {s,raw}=generated,input=await boundary()
      useAIConfigStore.getState().setConfig({apiKey:''})
      const before=await exportProjectJSON(s.scope.projectId)
      const history=await readAvgHistoricalRawImageV4({...input,artifact:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})
      expect(history.brief).toEqual(s.brief);expect(history.brief.avgAssembly).toBeUndefined()
      expect(history.definition.version).toBe(4);expect(history.source.plan).toEqual(s.source.systemPlan)
      expect(history.raw).toEqual(raw);expect(history.asset.source).toBe('agnes.image-2.1-flash.v1')
      expect(history.payload.provider.costUsd).toBeNull();expect(history.definition.mediaBatch.requirements[0].references).toHaveLength(1)
      const snapshot=await readAvgHistoricalImageCandidatesV4({...input,productionId:s.productionId})
      expect(snapshot.candidates).toHaveLength(1);expect(snapshot.candidates[0]).toMatchObject({available:true,asset:history.asset,costUsd:null})
      const bytes=await readAvgHistoricalImageCandidateBytesV4({...input,productionId:s.productionId,requirementKey:s.media.outputs[0].requirementKey,version:raw.version,contentHash:raw.contentHash})
      expect(bytes.asset).toEqual(history.asset);expect(bytes.data).toEqual(s.imageBytes)
      await expect(readAvgHistoricalImageCandidateBytesV4({...input,productionId:s.productionId+1,requirementKey:s.media.outputs[0].requirementKey,version:raw.version,contentHash:raw.contentHash})).rejects.toThrow(/制作记录/)
      expect(await accepted(s,'avg.author.stage')).toBeUndefined()
      await expect(readAvgCompiledImageDefinitionV4(input)).rejects.toThrow()
      await expect(generated.choose()).rejects.toThrow()
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it.each(['compilation','visual-author','rule-author','script-author','reference','compilation-witness','plan','epoch','active'] as const)('rejects damaged or inappropriate %s history before any current use',async mode=>{
      const {s,raw}=generated,input=await boundary(mode!=='active')
      const compiled=(await accepted(s,'avg.media.compiled-visual-requirements'))!
      if(mode==='compilation'){const payload=JSON.parse(compiled.payloadJson);payload.batch.requirements[0].prompt+='未经原作者确认';await db.productBuildArtifacts.update(compiled.id!,{payloadJson:canonicalProductProductionJsonV2(payload),contentHash:await hashProductProductionValueV2(payload)})}
      if(mode==='visual-author'){const row=(await accepted(s,'avg.media.visual-bible'))!,meta=JSON.parse(row.metadataJson);meta.receiptHash='f'.repeat(64);await db.productBuildArtifacts.update(row.id!,{metadataJson:JSON.stringify(meta)})}
      if(mode==='rule-author'){const row=(await accepted(s,'avg.system.plan'))!,payload=JSON.parse(row.payloadJson);payload.scenes[0].title+='未采用';await db.productBuildArtifacts.update(row.id!,{payloadJson:canonicalProductProductionJsonV2(payload),contentHash:await hashProductProductionValueV2(payload)})}
      if(mode==='script-author'){const row=(await accepted(s,`avg.content.scene-script.${s.source.scripts[0].sceneKey}`))!;await db.productBuildArtifacts.update(row.id!,{metadataJson:'{}'})}
      if(mode==='reference'){const row=(await db.avgDraftMedia.where('workId').equals(s.scope.workId).first())!,blob=(await db.mediaBlobObjects.get(row.blobObjectId))!,data=new Uint8Array(blob.data!.slice(0));data[data.length-1]^=1;await db.mediaBlobObjects.update(blob.id!,{data:data.buffer})}
      if(mode==='compilation-witness'){const quality=JSON.parse(compiled.qualityJson);quality.inputs[0].contentHash='f'.repeat(64);await db.productBuildArtifacts.update(compiled.id!,{qualityJson:JSON.stringify(quality)})}
      if(mode==='plan')input.expectedPlanHash='f'.repeat(64)
      if(mode==='epoch')input.controlEpoch++
      const before=await Promise.all(db.tables.map(table=>table.toArray()))
      await expect(readAvgHistoricalRawImageV4({...input,artifact:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})).rejects.toThrow()
      expect(await Promise.all(db.tables.map(table=>table.toArray()))).toEqual(before)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('restores original compiled image history through complete backup/remap without author or dispatch authority',async()=>{
      const {s,raw}=generated,input=await boundary(),original=await readAvgHistoricalRawImageV4({...input,artifact:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})
      const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
      const scope={projectId,worldId:build.worldId,workId:build.workId}
      useAIConfigStore.getState().setConfig({apiKey:''})
      const before=await exportProjectJSON(projectId),imported=await readAvgHistoricalRawImageV4({...input,scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,
        artifact:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})
      expect(imported.provenance).toEqual(original.provenance);expect(imported.definition).toEqual(original.definition)
      expect(imported.raw.blobObjectId).not.toBe(raw.blobObjectId)
      expect({...await exportProjectJSON(projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      await expect(stageAvgMediaChoiceV2({...generated.image,scope,productionId:build.productionId,declaration:'只读恢复不授予采用'})).rejects.toThrow()
      await deleteWork(scope.workId);expect((await db.mediaBlobObjects.get(raw.blobObjectId!))!.data).toEqual(s.imageBytes)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it('keeps a damaged raw slot visible as unavailable and rejects its pixel preview without dispatch',async()=>{
      const {s,raw}=generated,input=await boundary(),data=new Uint8Array(s.imageBytes.slice(0));data[data.length-1]^=1
      await db.mediaBlobObjects.update(raw.blobObjectId!,{data:data.buffer})
      const snapshot=await readAvgHistoricalImageCandidatesV4({...input,productionId:s.productionId})
      expect(snapshot.candidates).toHaveLength(1);expect(snapshot.candidates[0]).toMatchObject({available:false,requirement:{requirementKey:s.media.outputs[0].requirementKey}})
      await expect(readAvgHistoricalImageCandidateBytesV4({...input,productionId:s.productionId,requirementKey:s.media.outputs[0].requirementKey,version:raw.version,contentHash:raw.contentHash})).rejects.toThrow()
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('rechecks the original author inputs after the intrinsic image proof finishes',async()=>{
      const {s,raw}=generated,input=await boundary(),rule=(await accepted(s,'avg.system.plan'))!
      const actual=imageProducerProof.verifyHistoricalAvgVisualImageProducerV4
      vi.spyOn(imageProducerProof,'verifyHistoricalAvgVisualImageProducerV4').mockImplementationOnce(async request=>{
        const proof=await actual(request)
        await db.productBuildArtifacts.update(rule.id!,{updatedAt:rule.updatedAt+1})
        return proof
      })
      await expect(readAvgHistoricalRawImageV4({...input,artifact:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})).rejects.toThrow(/作者或编译输入.*变化/)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)
  })

  describe('current compiled image author consumption', () => {
    let generated: Awaited<ReturnType<typeof generatedImage>>
    // Keep real production preparation in the bounded setup hook. Each test
    // keeps its functional assertions and an appropriate finite time bound.
    beforeEach(async () => { generated = await generatedImage() })

    it('keeps lazy compiled image reads in an atomic snapshot and rolls back mutations without replay',async()=>{
      const {s,raw,requirement}=generated,NativePromise=(async()=>{})().constructor as PromiseConstructor
      const actual=await vi.importActual('../../src/lib/avg/visual-planning-image-definition')
      vi.doMock('../../src/lib/avg/visual-planning-image-definition',async()=>{
        await new NativePromise<void>(resolve=>setTimeout(resolve,10))
        return actual
      })
      const admit=(abort:boolean)=>db.transaction('rw',scopeTransactionTables(db.productProductions,db.productProductionBriefs,
        db.productProductionCommands,db.productBuilds,db.productBuildArtifacts,db.avgDraftMedia,db.mediaBlobObjects,
        db.agentRuns,db.agentRunEvents,db.agentRunCheckpoints,db.agentRunArtifacts),async()=>{
        const definition=await readAvgImageConsumptionDefinitionV4({scope:s.scope,buildId:s.buildId,brief:s.brief})
        await db.productBuildArtifacts.update(raw.id!,{updatedAt:raw.updatedAt+1})
        if(abort)throw new Error('controlled author transaction rollback')
        return definition
      })
      try{
        await expect(admit(true)).rejects.toThrow('controlled author transaction rollback')
        expect((await db.productBuildArtifacts.get(raw.id!))!.updatedAt).toBe(raw.updatedAt)
        const definition=await admit(false)
        expect(definition.mediaBatch.requirements.map(r=>r.requirementKey)).toEqual([requirement.requirementKey])
        expect((await db.productBuildArtifacts.get(raw.id!))!.updatedAt).toBe(raw.updatedAt+1)
        expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
      }finally{vi.doUnmock('../../src/lib/avg/visual-planning-image-definition');await vi.dynamicImportSettled()}
    })

    it('reads original V4 bytes, requires adopted review/choice and configures only the frozen stage consumer', async () => {
      const { s, raw, requirement, image, choose, review, confirm } = generated
      const bytes = await readAvgRawImageCandidateBytesV2({ ...image, version: raw.version, contentHash: raw.contentHash })
      expect(bytes.data).toEqual(s.imageBytes)
      const candidate = await review()
      expect(candidate.status).toBe('pending')
      await expect(choose()).rejects.toThrow(/上游未采用/)
      await confirm(candidate)
      const choice = await choose()
      const configure = async () => configureAvgChosenMediaDraftV2({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
      await expect(configure()).rejects.toThrow(/上游未采用/)
      await confirm(choice)
      db.close(); await db.open()
      const saved = await configure(), workspace = parseAvgAuthorWorkspaceV1(saved.editorJson)
      expect(workspace.mediaBatch).toBeUndefined()
      expect(workspace.presentation.stage.assets).toEqual([bytes.asset])
      expect(workspace.presentation.stage.cues).toContainEqual(expect.objectContaining({ type: 'set-background',
        assetKey: requirement.assetKey, beatKey: requirement.triggerBeatKey }))
      // Stage byte decoding is a separate browser observation, not the provider's
      // raw receipt. Keep it controlled here and require native evidence later.
      mockStageImageObservation()
      const stageCandidate = await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: saved.revision,
        artifactKey: 'avg.author.stage', declaration: '确认工程图及准确演出消费者；未签 Preview 或商业通过' })
      await confirm(stageCandidate)
      expect(JSON.parse((await accepted(s, 'avg.author.stage'))!.metadataJson).candidate.version).toBe(3)
      expect((await db.productProductionBriefs.where('[productionId+revision]').equals([s.productionId, (await current(s)).briefRevision]).first())!.briefJson)
        .toBe(canonicalProductProductionJsonV2(s.brief))
      expect((await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).executionBrief).toEqual(s.brief)
      expect(s.imageFetcher).toHaveBeenCalledTimes(1); expect(s.runText).toHaveBeenCalledTimes(2)
      expect((await current(s)).previewHash).toBe('')
    // Multiple durable transactions, DB reopen and independent stage adoption
    // are an integration path. This bound is not a product latency assertion.
    },15_000)

    it('retains unknown visual observations, blocks selection and requires a new observation note to clear them', async () => {
      const { raw, requirement, choose, review, confirm } = generated
      const unknown = avgVisualReviewFixture(requirement, raw.contentHash)
      unknown.unobserved = ['尚未观察对白安全区']; unknown.visualEvidence!.note = '本次尚未观察对白安全区'
      unknown.visualEvidence!.checks.find(c => c.criterion === 'composition')!.result = 'unknown'
      await confirm(await review(unknown))
      await expect(choose()).rejects.toThrow(/未观察|blocking/)
      const next = avgVisualReviewFixture(requirement, raw.contentHash); next.visualEvidence!.note = unknown.visualEvidence!.note
      await expect(review(next)).rejects.toThrow(/重新观察/)
      next.visualEvidence!.note = '重新查看准确工程字节并核对安全区；仍不是艺术验收'
      await confirm(await review(next))
      expect((await choose()).status).toBe('pending')
    })

    it.each(['missing-review', 'wrong-image', 'wrong-target', 'changed-bytes', 'missing-compilation'] as const)('rejects %s in the actual V4 author consumption path', async failure => {
      const { s, raw, requirement, choose, review, confirm, image } = generated
      if (failure === 'missing-review') { await expect(choose()).rejects.toThrow(/上游未采用/); return }
      if (failure === 'wrong-image' || failure === 'wrong-target') {
        const report = avgVisualReviewFixture(requirement, failure === 'wrong-image' ? 'f'.repeat(64) : raw.contentHash)
        if (failure === 'wrong-target') report.targetKey = 'another.background'
        await expect(review(report)).rejects.toThrow(/准确|批次/); return
      }
      await confirm(await review())
      if (failure === 'changed-bytes') {
        const blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!, bytes = new Uint8Array(blob.data!.slice(0)); bytes[bytes.length - 1] ^= 1
        await db.mediaBlobObjects.update(blob.id!, { data: bytes.buffer })
        await expect(choose()).rejects.toThrow(/hash|哈希|producer/)
        await expect(readAvgRawImageCandidateBytesV2({ ...image, version: raw.version, contentHash: raw.contentHash })).rejects.toThrow()
      } else {
        const compiler = (await accepted(s, 'avg.media.compiled-visual-requirements'))!
        await db.productBuildArtifacts.update(compiler.id!, { status: 'rejected' })
        await expect(choose()).rejects.toThrow(/编译|接收/)
      }
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })

    it.each(['decode-failure', 'wrong-dimensions'] as const)('does not turn %s into an author visual pass', async failure => {
      const { s, review } = generated
      const decoder = vi.mocked(imageDecoder.inspectAvgImageBytesV1)
      if (failure === 'decode-failure') decoder.mockRejectedValueOnce(new Error('受控浏览器解码失败'))
      else decoder.mockResolvedValueOnce({ width: 20, height: 20, hasAlpha: false })
      await expect(review()).rejects.toThrow(/解码失败|尺寸/)
      expect(await accepted(s, `avg.review.visual.${s.media.outputs[0].requirementKey}`)).toBeUndefined()
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })

    it('rechecks real image bytes at author confirmation instead of accepting a previously staged choice', async () => {
      const { s, raw, choose, review, confirm } = generated
      await confirm(await review()); const pending = await choose()
      const blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!, bytes = new Uint8Array(blob.data!.slice(0)); bytes[bytes.length - 1] ^= 1
      await db.mediaBlobObjects.update(blob.id!, { data: bytes.buffer })
      await expect(confirm(pending)).rejects.toThrow(/hash|哈希|producer/)
      expect(await accepted(s, pending.artifactKey)).toBeUndefined()
      expect((await db.productBuildArtifacts.get(pending.id!))!.status).toBe('pending')
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })

    it('preserves V4 raw bytes and author review/choice through backup/remap without reauthorizing imported production', async () => {
      const { s, raw, choose, review, confirm } = generated
      await confirm(await review()); const pending = await choose(); await confirm(pending)
      const choice = (await accepted(s, pending.artifactKey))!
      const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
      const build = (await db.productBuilds.where('projectId').equals(projectId).first())!
      const scope = { projectId, worldId: build.worldId, workId: build.workId }
      const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
      const importedRaw = rows.find(r => r.artifactKey === raw.artifactKey && r.status === 'accepted')!
      expect(importedRaw.blobObjectId).not.toBe(raw.blobObjectId)
      const blob = (await db.mediaBlobObjects.get(importedRaw.blobObjectId!))!
      expect(blob.workId).toBe(scope.workId); expect(blob.data).toEqual(s.imageBytes)
      expect(await sha256MediaData(blob.data!)).toBe(raw.contentHash)
      for (const original of [choice, (await accepted(s, `avg.review.visual.${s.media.outputs[0].requirementKey}`))!]) {
        const imported = rows.find(r => r.artifactKey === original.artifactKey && r.status === 'accepted')!
        expect(imported.payloadJson).toBe(original.payloadJson); expect(imported.contentHash).toBe(original.contentHash)
      }
      await expect(stageAvgMediaChoiceV2({ scope, productionId: build.productionId,
        requirementKey: s.media.outputs[0].requirementKey, rawVersion: importedRaw.version,
        rawContentHash: importedRaw.contentHash, declaration: '导入历史不能变成新采用授权' })).rejects.toThrow()
      await deleteWork(scope.workId)
      expect(await db.productBuildArtifacts.where('buildId').equals(build.id!).count()).toBe(0)
      expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
      expect((await db.mediaBlobObjects.get(raw.blobObjectId!))!.data).toEqual(s.imageBytes)
      expect(await accepted(s, choice.artifactKey)).toBeDefined()
      expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })

    it('joins adopted V4 images through the shared integrator into an immutable actual Preview without another provider call', async () => {
      const {s,raw,requirement,choose,review}=generated
      await adoptedImageStage(generated)
      useAIConfigStore.getState().setConfig({apiKey:''})
      const finished=await run(s),build=await current(s)
      expect(finished.buildStatus,build.failureJson).toBe('preview-ready')
      const preview=await verifyStoredProductBuildPreview(build)
      await verifyProductBuildTerminalArtifactSetV1({...s,expectedControlEpoch:build.controlEpoch,expectedPlanHash:build.planHash})
      expect(preview.runtimePackage.version).toBe(2)
      const module=preview.runtimePackage.modules[0]
      if(module.version!==2)throw new Error('Expected actual native module')
      expect(module.stage.assets[0].contentHash).toBe(raw.contentHash)
      expect(module.stage.cues).toContainEqual(expect.objectContaining({type:'set-background',assetKey:requirement.assetKey,beatKey:requirement.triggerBeatKey}))
      const quality=JSON.parse(build.qualityReportJson)
      expect(quality.hardGateResults).toContainEqual(expect.objectContaining({gateId:'avg.visual.requirements.compiled',passed:true}))
      expect(quality.releaseReady).toBe(false)
      const session=await startProductProductionPreviewV1({...s,expectedBuildId:build.id!,expectedPreviewHash:build.previewHash})
      expect((await db.productRuntimeSessions.get(session.sessionId))!.productBuildId).toBe(s.buildId)
      const boundary={scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,expectedBrief:s.brief}
      const frozen=await readAvgCompiledImageDefinitionV4({...boundary,purpose:'frozen-verification'})
      expect(frozen.brief.avgAssembly).toBeUndefined()
      await expect(readAvgCompiledImageDefinitionV4(boundary)).rejects.toThrow()
      await expect(readAvgCompiledImageDefinitionV4({...boundary,purpose:'assembly'})).rejects.toThrow()
      await expect(prepareAvgCompiledImageRequestV4({...boundary,purpose:'frozen-verification',requirementKey:requirement.requirementKey,idempotencyKey:'d'.repeat(64)})).rejects.toThrow(/不能授予/)
      await expect(choose()).rejects.toThrow()
      await expect(review()).rejects.toThrow()
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('projects the compiled V4 workbench and finishes public deterministic assembly without current credentials', async () => {
      const {s}=generated
      const view=await readAvgAssemblyWorkspaceV1(s.scope)
      expect(view.imageDefinition!.mediaBatch.requirements).toHaveLength(1)
      expect(view.artifacts.filter(r=>r.artifactKey.startsWith('avg.proposal.'))).toHaveLength(2)
      await adoptedImageStage(generated);useAIConfigStore.getState().setConfig({apiKey:''})
      expect((await runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})).buildStatus).toBe('preview-ready')
      const frozen=await readAvgAssemblyWorkspaceV1(s.scope)
      expect(frozen.imageDefinition!.mediaBatch.requirements[0].assetKey).toBe(view.imageDefinition!.mediaBatch.requirements[0].assetKey)
      expect(frozen.visualProgress!.budget.usage).toMatchObject({modelCalls:2,mediaCalls:1,costUsd:null})
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('revisits only exact already accepted V4 checkpoints during integration and cannot use the read branch for new writes', async () => {
      const {s,raw}=generated;await adoptedImageStage(generated);await cycle(s)
      const build=await current(s);expect(build.status,build.failureJson).toBe('integrating')
      const compiled=(await accepted(s,'avg.media.compiled-visual-requirements'))!
      const input=(row:ProductBuildArtifactRecordV1)=>({scope:s.scope,buildId:s.buildId,controlEpoch:build.controlEpoch,
        artifactKey:row.artifactKey,requirementKey:row.requirementKey,kind:row.kind,mediaKind:row.mediaKind,payload:JSON.parse(row.payloadJson),metadata:JSON.parse(row.metadataJson),
        quality:JSON.parse(row.qualityJson),rights:JSON.parse(row.rightsJson),contentHash:row.contentHash,blobObjectId:row.blobObjectId,
        mimeType:row.mimeType,byteSize:row.byteSize,producerRunId:row.producerRunId,producerReceiptHash:row.producerReceiptHash,inputHash:row.inputHash})
      const count=await db.productBuildArtifacts.where('buildId').equals(s.buildId).count()
      expect(await acceptProductBuildArtifact(input(compiled))).toEqual(compiled)
      expect(await acceptProductBuildArtifact(input(raw))).toEqual(raw)
      const changed=input(compiled);changed.payload.batch.requirements[0].prompt+='未经采用的替换'
      changed.contentHash=await hashProductProductionValueV2(changed.payload)
      await expect(acceptProductBuildArtifact(changed)).rejects.toThrow(/只能复核/)
      await expect(acceptProductBuildArtifact({...input(raw),quality:{...JSON.parse(raw.qualityJson),decoderVerified:true}})).rejects.toThrow(/只能复核/)
      await expect(acceptProductBuildArtifact({...input(raw),artifactKey:raw.artifactKey.replace('avg.media.raw.','avg.media.processed.')})).rejects.toThrow(/只能复核/)
      await expect(acceptProductBuildArtifact({...input(compiled),artifactKey:'avg.proposal.unapproved'})).rejects.toThrow(/只能复核/)
      await expect(acceptProductBuildArtifact({...input(compiled),producerRunId:raw.producerRunId})).rejects.toThrow(/只能复核/)
      expect(await db.productBuildArtifacts.where('buildId').equals(s.buildId).count()).toBe(count)
      expect(await db.productBuildArtifacts.get(compiled.id!)).toEqual(compiled)
      await run(s);expect((await current(s)).status).toBe('preview-ready')
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it.each(['compiled-bytes','raw-bytes','original-response'] as const)('rejects changed %s in the full frozen V4 terminal proof', async failure => {
      const {s,raw}=generated;await adoptedImageStage(generated);await run(s)
      const build=await current(s);expect(build.previewHash,build.failureJson).not.toBe('')
      if(failure==='compiled-bytes'){
        const row=(await accepted(s,'avg.media.compiled-visual-requirements'))!,payload=JSON.parse(row.payloadJson)
        payload.batch.requirements[0].prompt+='冻结后伪造并重算 hash'
        await db.productBuildArtifacts.update(row.id!,{payloadJson:canonicalProductProductionJsonV2(payload),contentHash:await hashProductProductionValueV2(payload)})
      }else if(failure==='raw-bytes'){
        const row=(await db.mediaBlobObjects.get(raw.blobObjectId!))!,bytes=new Uint8Array(row.data!.slice(0));bytes[bytes.length-1]^=1
        await db.mediaBlobObjects.update(row.id!,{data:bytes.buffer})
      }else{
        const proposal=(await accepted(s,'avg.proposal.visual-bible'))!,hash=JSON.parse(proposal.qualityJson).rawResponseHash
        const row=(await db.agentRunArtifacts.filter(r=>r.projectId===s.scope.projectId&&r.artifactKind==='raw-response'&&r.contentHash===hash).first())!
        await db.agentRunArtifacts.delete(row.id!)
      }
      await expect(verifyProductBuildTerminalArtifactSetV1({...s,expectedControlEpoch:build.controlEpoch,expectedPlanHash:build.planHash})).rejects.toThrow()
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('restores the V4 frozen Preview and original image evidence through real backup/remap and deletes only the imported Work', async () => {
      const {s,raw}=generated;await adoptedImageStage(generated);await run(s)
      const original=await current(s);expect(original.previewHash,original.failureJson).not.toBe('')
      const importedProject=await importProjectJSON(await exportProjectJSON(s.scope.projectId))
      const imported=(await db.productBuilds.where('projectId').equals(importedProject).first())!
      const scope={projectId:importedProject,worldId:imported.worldId,workId:imported.workId}
      const preview=await verifyStoredProductBuildPreview(imported)
      expect(preview.previewHash).toBe(original.previewHash)
      // Import deliberately stales Run verification. Explicit zero-provider
      // revalidation preserves the original package, receipts and authority.
      await expect(verifyProductBuildTerminalArtifactSetV1({scope,productionId:imported.productionId,buildId:imported.id!,
        expectedControlEpoch:imported.controlEpoch,expectedPlanHash:imported.planHash})).rejects.toThrow()
      useAIConfigStore.getState().setConfig({apiKey:''})
      await recoverImportedProductProductionProofsV1({scope,productionId:imported.productionId})
      await verifyProductBuildTerminalArtifactSetV1({scope,productionId:imported.productionId,buildId:imported.id!,
        expectedControlEpoch:imported.controlEpoch,expectedPlanHash:imported.planHash})
      await expect(stageAvgMediaChoiceV2({scope,productionId:imported.productionId,requirementKey:s.media.outputs[0].requirementKey,
        rawVersion:raw.version,rawContentHash:raw.contentHash,declaration:'复验不授权采用或重发'})).rejects.toThrow()
      await expect(runProductProductionUntilBlockedV1({...s,scope,productionId:imported.productionId})).rejects.toThrow()
      const image=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([imported.id!,raw.artifactKey]).first())!
      expect((await db.mediaBlobObjects.get(image.blobObjectId!))!.data).toEqual(s.imageBytes)
      const session=await startProductProductionPreviewV1({scope,productionId:imported.productionId,expectedBuildId:imported.id!,expectedPreviewHash:imported.previewHash})
      expect((await db.productRuntimeSessions.get(session.sessionId))!.workId).toBe(scope.workId)
      await deleteWork(scope.workId)
      expect(await db.productBuilds.get(imported.id!)).toBeUndefined()
      expect((await db.mediaBlobObjects.get(raw.blobObjectId!))!.data).toEqual(s.imageBytes)
      expect((await current(s)).previewHash).toBe(original.previewHash)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it.each(['raw-bytes','original-response','unapproved-compilation'] as const)('cannot re-seal an imported V4 root with changed %s or create another provider attempt', async failure => {
      const {s,raw}=generated;await adoptedImageStage(generated);await run(s)
      const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId))
      const imported=(await db.productBuilds.where('projectId').equals(projectId).first())!,scope={projectId,worldId:imported.worldId,workId:imported.workId}
      const ledger=JSON.parse(imported.budgetLedgerJson),rootBefore=await db.agentRuns.get(ledger.rootRunId)
      if(failure==='raw-bytes'){
        const image=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([imported.id!,raw.artifactKey]).first())!
        const blob=(await db.mediaBlobObjects.get(image.blobObjectId!))!,bytes=new Uint8Array(blob.data!.slice(0));bytes[bytes.length-1]^=1
        await db.mediaBlobObjects.update(blob.id!,{data:bytes.buffer})
      }else if(failure==='original-response'){
        const proposal=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([imported.id!,'avg.proposal.visual-bible']).first())!
        const hash=JSON.parse(proposal.qualityJson).rawResponseHash,row=(await db.agentRunArtifacts.filter(r=>r.projectId===projectId&&r.artifactKind==='raw-response'&&r.contentHash===hash).first())!
        await db.agentRunArtifacts.delete(row.id!)
      }else{
        const row=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([imported.id!,'avg.media.compiled-visual-requirements']).first())!,payload=JSON.parse(row.payloadJson)
        payload.batch.requirements[0].prompt+='导入后未采用替换'
        await db.productBuildArtifacts.update(row.id!,{payloadJson:canonicalProductProductionJsonV2(payload),contentHash:await hashProductProductionValueV2(payload)})
      }
      useAIConfigStore.getState().setConfig({apiKey:''})
      await expect(recoverImportedProductProductionProofsV1({scope,productionId:imported.productionId})).rejects.toThrow()
      expect(await db.agentRuns.get(ledger.rootRunId)).toEqual(rootBefore)
      expect((await db.productBuilds.get(imported.id!))!.budgetLedgerJson).toBe(imported.budgetLedgerJson)
      expect((await db.mediaBlobObjects.get(raw.blobObjectId!))!.data).toEqual(s.imageBytes)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)
  })
  describe('historical canonical professional evidence',()=>{
    async function fixture(mode:'busy'|'unknown'|'cancel'='busy'){
      const s=await setup({image:mode==='unknown'?'unknown':'busy'});await sources(s);await run(s)
      const bible=structuredClone(s.bible);bible.style.lighting+='；作者明确保留机械开关关闭且不发光'
      await adopt(s,await stage(s,'avg.media.visual-bible',bible));await run(s)
      const media=structuredClone(s.media);media.outputs[0].prompt+='；作者要求对白区域保持自然延续'
      await adopt(s,await stage(s,`avg.media.environment-brief.${media.subjectKey}`,media))
      if(mode==='cancel')await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
      else await run(s)
      return {s,bible,media}
    }
    async function selection(s:Setup,key='avg.media.visual-bible'){
      const build=await current(s),row=(await accepted(s,key))!
      return {scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:row.controlEpoch,
        expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,
        artifact:{artifactKey:key,version:row.version,contentHash:row.contentHash}}
    }

    it('historical batch shares the exact dependency graph while matching independent proofs and keeping no cross-call cache',async()=>{
      const {s,media}=await fixture('cancel'),selections=[await selection(s),await selection(s,`avg.media.environment-brief.${media.subjectKey}`)]
      useAIConfigStore.getState().setConfig({apiKey:''})
      const before=await exportProjectJSON(s.scope.projectId),spy=vi.spyOn(visualProposalEvidence,'readAvgVisualProposalEvidenceV4')
      const single=[];for(const input of selections)single.push(await readAvgHistoricalVisualArtifactV4(input))
      expect(spy).toHaveBeenCalledTimes(3)
      spy.mockClear()
      const {artifact:_artifact,...boundary}=selections[0],input={...boundary,artifacts:selections.map(s=>s.artifact)}
      const batch=await readAvgHistoricalVisualArtifactsV4(input)
      expect(batch).toEqual(single);expect(spy).toHaveBeenCalledTimes(2)
      expect(new Set(spy.mock.calls.map(([,row])=>row.artifactKey)).size).toBe(2)
      batch[0].original.rawText='caller-local mutation'
      expect(await readAvgHistoricalVisualArtifactsV4(input)).toEqual(single)
      expect(spy).toHaveBeenCalledTimes(4)
      expect(await readAvgHistoricalVisualArtifactsV4({...input,artifacts:[...input.artifacts].reverse()})).toEqual([...single].reverse())
      expect(spy).toHaveBeenCalledTimes(6)
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).not.toHaveBeenCalled()
    },30_000)

    it('historical batch preserves independent proofs and rollback in a caller write transaction',async()=>{
      const {s,media}=await fixture('cancel'),selections=[await selection(s),await selection(s,`avg.media.environment-brief.${media.subjectKey}`)]
      const {artifact:_artifact,...boundary}=selections[0],input={...boundary,artifacts:selections.map(s=>s.artifact)}
      const single=[];for(const item of selections)single.push(await readAvgHistoricalVisualArtifactV4(item))
      const before=await exportProjectJSON(s.scope.projectId),spy=vi.spyOn(visualProposalEvidence,'readAvgVisualProposalEvidenceV4')
      await expect(db.transaction('rw',db.tables,async()=>{
        expect(await readAvgHistoricalVisualArtifactsV4(input)).toEqual(single)
        expect(spy).toHaveBeenCalledTimes(3)
        const draft=await readAvgDraftV1(s.scope)
        await db.avgAuthoringDrafts.update(draft.id!,{worldReleaseId:999999})
        throw new Error('controlled historical batch caller rollback')
      })).rejects.toThrow('controlled historical batch caller rollback')
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).not.toHaveBeenCalled()
    },30_000)

    it.each(['empty','oversize','duplicate','wrong-version','wrong-hash','wrong-domain','cross-work','stale-build','missing-checkpoint'] as const)('historical batch refuses %s atomically without writes or a partial authority result',async mode=>{
      const {s,media}=await fixture('cancel'),first=await selection(s),second=await selection(s,`avg.media.environment-brief.${media.subjectKey}`)
      const {artifact:_artifact,...boundary}=first,input={...boundary,artifacts:[first.artifact,second.artifact]}
      if(mode==='empty')input.artifacts=[]
      if(mode==='oversize')input.artifacts=Array.from({length:101},(_,i)=>({...first.artifact,artifactKey:`avg.media.environment-brief.overflow-${i}`}))
      if(mode==='duplicate')input.artifacts=[first.artifact,{...first.artifact,version:first.artifact.version+1}]
      if(mode==='wrong-version')input.artifacts[1]={...second.artifact,version:second.artifact.version+1}
      if(mode==='wrong-hash')input.artifacts[1]={...second.artifact,contentHash:'f'.repeat(64)}
      if(mode==='wrong-domain')input.artifacts[1]={...second.artifact,artifactKey:'avg.system.plan'}
      if(mode==='cross-work')input.scope={...s.scope,workId:s.scope.workId+900}
      if(mode==='stale-build')input.expectedBuildRevision++
      if(mode==='missing-checkpoint'){
        const original=(await accepted(s,`avg.proposal.environment-brief.${media.subjectKey}`))!
        await db.agentRunCheckpoints.where('runId').equals(original.producerRunId!).delete()
      }
      const snapshot=()=>Promise.all(db.tables.map(t=>t.toArray())),before=await snapshot()
      await expect(readAvgHistoricalVisualArtifactsV4(input)).rejects.toThrow()
      expect(await snapshot()).toEqual(before);expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).not.toHaveBeenCalled()
    },30_000)

    it('reads both original model bytes and separately edited adopted designs after failure and a prepared successor without writes or credentials',async()=>{
      const {s,bible,media}=await fixture();await restartAvgVisualPlanningFromDraftV4(await restartInput(s))
      useAIConfigStore.getState().setConfig({apiKey:''})
      const {exportedAt:_before,...before}=await exportProjectJSON(s.scope.projectId)
      for(const [key,payload] of [['avg.media.visual-bible',bible],[`avg.media.environment-brief.${media.subjectKey}`,media]] as const){
        const result=await readAvgHistoricalVisualArtifactV4(await selection(s,key))
        expect(result.payload).toEqual(payload);expect(result.candidate).toMatchObject({version:6,origin:'model-proposal',visualProposalValidation:{authorEdited:true}})
        const original=JSON.parse(result.original.rawText)
        expect(original).toEqual(key==='avg.media.visual-bible'?s.bible:s.media);expect(original).not.toEqual(payload)
        expect(result.original.requestText).toContain('storyforge.avg.visual-model-input');expect(result.authorReceiptHash).toMatch(/^[a-f0-9]{64}$/)
        expect(result.original.rights).toEqual({origin:'model-proposal',commercialUse:null});expect(result.rights.origin).toBe('model-proposal')
        expect(result.source.buildNumber).toBe(1);expect(result.source.planning).toEqual(s.brief.avgVisualPlanning!.scope)
        await expect(stage(s,key,payload)).rejects.toThrow(/不可采用/)
      }
      const {exportedAt:_after,...after}=await exportProjectJSON(s.scope.projectId)
      expect(after).toEqual(before);expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('uses the original author epoch after an explicit stop without granting current adoption',async()=>{
      const {s,media}=await fixture('cancel'),input=await selection(s,`avg.media.environment-brief.${media.subjectKey}`),build=await current(s)
      expect(build.controlEpoch).toBeGreaterThan(input.controlEpoch)
      const result=await readAvgHistoricalVisualArtifactV4(input)
      expect(result.payload).toEqual(media);expect(result.source.controlEpoch).toBe(input.controlEpoch)
      await expect(stage(s,input.artifact.artifactKey,media)).rejects.toThrow(/不可采用/)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).not.toHaveBeenCalled()
    },30_000)

    it.each(['request-byte','response-byte','author-candidate','author-rights','raw-rights','author-command','upstream-author-command','producer-checkpoint'] as const)('refuses changed %s in a stopped canonical design without a provider fallback',async failure=>{
      const {s,media}=await fixture(),input=await selection(s,`avg.media.environment-brief.${media.subjectKey}`)
      const row=(await accepted(s,input.artifact.artifactKey))!,original=(await accepted(s,`avg.proposal.environment-brief.${media.subjectKey}`))!
      if(failure==='request-byte'||failure==='response-byte'){
        const proof=await readAvgVisualProposalEvidenceV4(s.scope,original)
        const hash=String(failure==='request-byte'?proof.quality.requestSnapshotHash:proof.quality.rawResponseHash)
        const artifact=(await db.agentRunArtifacts.where('contentHash').equals(hash).first())!
        await db.agentRunArtifacts.delete(artifact.id!)
      }else if(failure==='author-candidate'){
        const metadata=JSON.parse(row.metadataJson);metadata.candidate.visualProposalValidation.authorEdited=false
        await db.productBuildArtifacts.update(row.id!,{metadataJson:canonicalProductProductionJsonV2(metadata)})
      }else if(failure==='producer-checkpoint'){
        const checkpoint=(await db.agentRunCheckpoints.where('runId').equals(original.producerRunId!).first())!
        await db.agentRunCheckpoints.delete(checkpoint.id!)
      }else if(failure==='author-rights'||failure==='raw-rights'){
        const source=failure==='author-rights'?row:original
        await db.productBuildArtifacts.update(source.id!,{rightsJson:canonicalProductProductionJsonV2({...JSON.parse(source.rightsJson),commercialUse:true})})
      }else{
        const source=failure==='upstream-author-command'?(await accepted(s,'avg.media.visual-bible'))!:row
        const commandId=JSON.parse(source.metadataJson).commandId
        const command=(await db.productProductionCommands.where('[productionId+commandId]').equals([s.productionId,commandId]).first())!
        await db.productProductionCommands.delete(command.id!)
      }
      await expect(readAvgHistoricalVisualArtifactV4(input)).rejects.toThrow()
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('rejects stale identities, noncanonical targets and cross-Work reads',async()=>{
      const {s}=await fixture(),input=await selection(s),other=await createAvgDraftV1('另一作者隔离作品')
      for(const changed of [{expectedBuildRevision:input.expectedBuildRevision+1},{controlEpoch:input.controlEpoch+1},
        {expectedBriefHash:'0'.repeat(64)},{expectedPlanHash:'0'.repeat(64)},{scope:other.scope},
        {artifact:{...input.artifact,version:input.artifact.version+1}},{artifact:{...input.artifact,contentHash:'0'.repeat(64)}},
        {artifact:{...input.artifact,artifactKey:'avg.proposal.visual-bible'}}]){
        await expect(readAvgHistoricalVisualArtifactV4({...input,...changed})).rejects.toThrow()
      }
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('restores exact old model and author evidence through portable remapping and deletes only the restored owner',async()=>{
      const {s,media}=await fixture(),key=`avg.media.environment-brief.${media.subjectKey}`
      const original=await readAvgHistoricalVisualArtifactV4(await selection(s,key))
      const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
      const restored={...s,scope:{projectId,worldId:build.worldId,workId:build.workId},productionId:build.productionId,buildId:build.id!}
      useAIConfigStore.getState().setConfig({apiKey:''})
      const input=await selection(restored,key),read=await readAvgHistoricalVisualArtifactV4(input)
      expect(read.payload).toEqual(original.payload);expect(read.original.rawText).toBe(original.original.rawText);expect(read.original.requestText).toBe(original.original.requestText)
      expect(read.original.producerRunId).not.toBe(original.original.producerRunId);expect(read.candidate.visualProposalValidation).toEqual(original.candidate.visualProposalValidation)
      await expect(stage(restored,key,media)).rejects.toThrow(/不可采用/)
      await deleteWork(restored.scope.workId);await expect(readAvgHistoricalVisualArtifactV4(input)).rejects.toThrow()
      expect((await readAvgHistoricalVisualArtifactV4(await selection(s,key))).payload).toEqual(media)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('permits reading a valid earlier design while an unknown image result still prohibits restart',async()=>{
      const {s,bible}=await fixture('unknown')
      expect((await readAvgHistoricalVisualArtifactV4(await selection(s))).payload).toEqual(bible)
      await expect(restartAvgVisualPlanningFromDraftV4(await restartInput(s))).rejects.toThrow(/未知结果/)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('does not turn a pending author candidate into historical adoption',async()=>{
      const s=await setup();await sources(s);await run(s)
      const candidate=await stage(s,'avg.media.visual-bible',s.bible)
      await stopProductProductionV1({scope:s.scope,production:(await db.productProductions.get(s.productionId))!})
      const build=await current(s)
      await expect(readAvgHistoricalVisualArtifactV4({scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,
        controlEpoch:candidate.controlEpoch,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,
        artifact:{artifactKey:candidate.artifactKey,version:candidate.version,contentHash:candidate.contentHash}})).rejects.toThrow()
      expect(s.runText).toHaveBeenCalledTimes(1);expect(s.imageFetcher).not.toHaveBeenCalled()
    })

    it('keeps the active reader separate while a Build is still executing',async()=>{
      const s=await setup();await sources(s);await run(s);await adopt(s,await stage(s,'avg.media.visual-bible',s.bible))
      await expect(readAvgHistoricalVisualArtifactV4(await selection(s))).rejects.toThrow(/仍在执行/)
      expect((await readAvgConfirmedVisualArtifactsV4({...await selection(s),artifactKeys:['avg.media.visual-bible']}))[0].payload).toEqual(s.bible)
      expect(s.runText).toHaveBeenCalledTimes(1);expect(s.imageFetcher).not.toHaveBeenCalled()
    })
  })

  describe('held observed image failure read-only knowledge',()=>{
    async function heldFailure(duplicateRaw=false){
      vi.spyOn(imageDecoder,'inspectAvgImageBytesV1').mockResolvedValue({width:32,height:32,hasAlpha:false})
      const s=await setup({image:'busy',reference:'valid'}),original=s.executor
      s.executor=async input=>{
        try{return await original(duplicateRaw&&input.task.kind==='avg-media-image-generate'?{...input,onMediaOutput:async text=>{
          const result=await input.onMediaOutput!(text);await input.onMediaOutput!(text+' ');return result
        }}:input)}catch(error){
          if(input.task.kind==='avg-media-image-generate'&&error instanceof ProductProductionDraftRejectedErrorV1){
            // Actual pre-attachment foreign error shape. The original executor
            // already recorded its controlled HTTP/raw response on this Run.
            throw Object.assign(new Error(error.message),{name:error.name,usage:error.usage})
          }
          throw error
        }
      }
      await sources(s);await run(s);await adopt(s,await stage(s,'avg.media.visual-bible',s.bible));await run(s)
      await adopt(s,await stage(s,`avg.media.environment-brief.${s.media.subjectKey}`,s.media));await run(s)
      expect((await current(s)).status).toBe('recovery-required')
      return s
    }
    async function proofInput(s:Setup){
      const build=await current(s),plan=parseProductProductionPlanV3(build.planJson,s.brief,build.briefHash),task=plan.tasks.find(t=>t.kind==='avg-media-image-generate')!
      const ledger=JSON.parse(build.budgetLedgerJson),attempt=ledger.attempts.find((a:{taskKey:string})=>a.taskKey===task.taskKey)
      expect(attempt.usageKnown).toBe(false);expect(attempt.errorCode).toBe('task-executor-nonretryable')
      return {scope:s.scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,controlEpoch:plan.controlEpoch,
        expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,taskKey:task.taskKey,runId:attempt.runId,attempt:attempt.attempt}
    }
    it.each([false,true])('evolves an exact held reference after import=%s inside the command transaction without settling or dispatching',async imported=>{
      let s=await heldFailure()
      if(imported){
        const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
        s={...s,scope:{projectId,worldId:build.worldId,workId:build.workId},buildId:build.id!,productionId:build.productionId}
      }
      const details=await readProductProductionDetailsV1(s.scope,s.productionId,['avg']),old=await current(s),runs=await db.agentRuns.toArray(),events=await db.agentRunEvents.toArray(),references=await db.avgDraftMedia.toArray()
      await expect(readAvgHeldImageQueueFailureV4(await proofInput(s))).resolves.toMatchObject({resultKnown:true,usageKnown:false,status:503})
      await beginProductProductionEvolutionV1({scope:s.scope,productionId:s.productionId,expectedStateRevision:details.production.stateRevision,
        userText:'已接收的准确503响应允许准备新版本，未知费用和原预留保持',affectedLanes:['content','product','visual','audio']})
      const next=await readProductProductionDetailsV1(s.scope,s.productionId,['avg'])
      expect(next.production.status).toBe('brief-ready')
      expect(parseProductProductionBriefV3(next.brief!.briefJson).evolution!.base).toMatchObject({kind:'recovery-build',buildNumber:old.buildNumber,briefHash:old.briefHash,planHash:old.planHash})
      expect(await current(s)).toEqual(old);expect(await db.agentRuns.toArray()).toEqual(runs);expect(await db.agentRunEvents.toArray()).toEqual(events)
      expect(await db.avgDraftMedia.toArray()).toEqual(references);expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)
    it.each([false,true])('proves an observed old failure after import=%s without changing its hold and prepares only a fresh explicitly started version',async imported=>{
      let s=await heldFailure()
      const original=await current(s)
      if(imported){
        const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
        s={...s,scope:{projectId,worldId:build.worldId,workId:build.workId},buildId:build.id!,productionId:build.productionId}
      }
      const input=await proofInput(s),before=await exportProjectJSON(s.scope.projectId),old=await current(s),runs=await db.agentRuns.where('productBuildId').equals(s.buildId).toArray()
      const proof=await readAvgHeldImageQueueFailureV4(input)
      expect(proof).toMatchObject({resultKnown:true,usageKnown:false,status:503,runId:input.runId,heldUsage:{mediaCalls:1,costUsd:null}})
      await assertAvgVisualPlanningRestartKnownV4(s.scope,old)
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      const pending=await restartAvgVisualPlanningFromDraftV4(await restartInput(s))
      expect(await current(s)).toEqual(old);expect(await db.agentRuns.where('productBuildId').equals(s.buildId).toArray()).toEqual(runs)
      expect(s.imageFetcher).toHaveBeenCalledTimes(1);expect(s.runText).toHaveBeenCalledTimes(2)
      const started=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:pending.brief!.briefHash})
      expect(started.build!.id).not.toBe(old.id);expect(started.build!.parentBuildNumber).toBe(old.buildNumber)
      expect(await current(s)).toEqual(old);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
      if(imported){await deleteWork(s.scope.workId);expect(await db.productBuilds.get(original.id!)).toEqual(original)}
    },30_000)
    it.each(['missing-raw','corrupt-raw','missing-compiler','missing-run','wrong-epoch','changed-reservation','unknown-code','claimed-task','wrong-root','duplicate-raw','terminal-unknown','cross-work'] as const)('rejects %s without a write, waived hold or new provider request',async mode=>{
      const s=await heldFailure(mode==='duplicate-raw'),input=await proofInput(s),build=await current(s),ledger=JSON.parse(build.budgetLedgerJson)
      const snapshot=await readAgentRunV1(s.scope,input.runId),event=snapshot.events.find(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='raw-response')!
      if(event.type!=='evidence.artifact.recorded')throw new Error('Expected actual raw event')
      const raw=(await db.agentRunArtifacts.where('projectId').equals(s.scope.projectId).filter(r=>r.contentHash===event.payload.contentHash&&r.artifactKind==='raw-response').first())!
      if(mode==='missing-raw')await db.agentRunArtifacts.delete(raw.id!)
      if(mode==='corrupt-raw')await db.agentRunArtifacts.update(raw.id!,{content:'tampered original response'})
      if(mode==='missing-compiler')await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,'avg.media.compiled-visual-requirements']).delete()
      if(mode==='missing-run')await db.agentRuns.delete(input.runId)
      if(mode==='terminal-unknown'){
        const terminal=snapshot.events.find(e=>e.type==='run.failed')!
        const row=await db.agentRunEvents.where('runId').equals(input.runId).filter(e=>e.sequence===terminal.sequence).first()
        await db.agentRunEvents.update(row!.id!,{payloadJson:JSON.stringify({...terminal.payload,code:'task-result-unknown'})})
      }
      const proofScope=mode==='cross-work'?(await createAvgDraftV1('隔离失败证据反例')).scope:s.scope
      if(mode==='wrong-epoch')ledger.attempts.find((a:{runId:number})=>a.runId===input.runId).controlEpoch++
      if(mode==='changed-reservation')ledger.attempts.find((a:{runId:number})=>a.runId===input.runId).usage.mediaCalls=0
      if(mode==='unknown-code')ledger.attempts.find((a:{runId:number})=>a.runId===input.runId).errorCode='task-result-unknown'
      if(mode==='claimed-task')ledger.tasks[input.taskKey].status='claimed'
      if(mode==='wrong-root')ledger.rootRunId=input.runId
      if(['wrong-epoch','changed-reservation','unknown-code','claimed-task','wrong-root'].includes(mode))await db.productBuilds.update(s.buildId,{budgetLedgerJson:JSON.stringify(ledger)})
      const rows=await db.productBuilds.toArray(),briefs=await db.productProductionBriefs.toArray(),commands=await db.productProductionCommands.toArray(),events=await db.agentRunEvents.toArray()
      await expect(readAvgHeldImageQueueFailureV4({...input,scope:proofScope})).rejects.toThrow()
      await expect(assertAvgVisualPlanningRestartKnownV4(proofScope,(await current(s)))).rejects.toThrow()
      expect(await db.productBuilds.toArray()).toEqual(rows);expect(await db.productProductionBriefs.toArray()).toEqual(briefs)
      expect(await db.productProductionCommands.toArray()).toEqual(commands);expect(await db.agentRunEvents.toArray()).toEqual(events)
      expect(s.imageFetcher).toHaveBeenCalledTimes(1);expect(s.runText).toHaveBeenCalledTimes(2)
    },30_000)
  })

  describe('same-Work explicit V4 replacement Brief',()=>{
    it('prepares and starts a separate version after a received HTTP503 without changing the failed Build or dispatching another request',async()=>{
      const s=await setup({image:'busy'});await sources(s);await run(s)
      await adopt(s,await stage(s,'avg.media.visual-bible',s.bible));await run(s)
      await adopt(s,await stage(s,`avg.media.environment-brief.${s.media.subjectKey}`,s.media));await run(s)
      const parent=await current(s),runs=await db.agentRuns.count(),projects=await db.projects.count()
      expect(parent.status).toBe('recovery-required');expect(parent.failureJson).toContain('503')
      const prepared=await restartAvgVisualPlanningFromDraftV4(await restartInput(s))
      expect(prepared.production.id).toBe(s.productionId);expect(prepared.production.status).toBe('brief-ready')
      // The existing evolve command first records the exact parent impact;
      // the next explicit save freezes the reviewable professional intent.
      const evolution=prepared.briefHistory.find(row=>row.revision===parent.briefRevision+1)!
      expect(evolution.parentRevision).toBe(parent.briefRevision)
      const intermediate=parseProductProductionBriefV3(evolution.briefJson).evolution!
      expect(intermediate.base).toEqual({kind:'recovery-build',buildNumber:parent.buildNumber,briefHash:parent.briefHash,
        planHash:parent.planHash,controlEpoch:JSON.parse(parent.planJson).controlEpoch})
      expect(prepared.brief!.revision).toBe(parent.briefRevision+2);expect(prepared.brief!.parentRevision).toBe(evolution.revision)
      expect(parseProductProductionBriefV3(prepared.brief!.briefJson).evolution).toEqual(intermediate)
      expect(await current(s)).toEqual(parent)
      expect(await db.productBuilds.count()).toBe(1);expect(await db.agentRuns.count()).toBe(runs)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
      db.close();await db.open()
      const refreshed=await readAvgAssemblyWorkspaceV1(s.scope,s.productionId)
      expect(refreshed.details!.build).toEqual(parent);expect(refreshed.details!.production.status).toBe('brief-ready')
      const child=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:prepared.brief!.briefHash})
      expect(child.build!.id).not.toBe(parent.id);expect(child.build!.parentBuildNumber).toBe(parent.buildNumber)
      expect(child.build).toMatchObject({status:'building',planRevision:1})
      expect(await current(s)).toEqual(parent);expect(await db.projects.count()).toBe(projects)
      expect(await db.productBuildArtifacts.where('buildId').equals(child.build!.id!).count()).toBe(0)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it.each(['text','image'] as const)('holds an unknown %s result before preparing or renaming a replacement request',async kind=>{
      const s=await setup(kind==='text'?{unknown:true}:{image:'unknown'});await sources(s);await run(s)
      if(kind==='image'){
        await adopt(s,await stage(s,'avg.media.visual-bible',s.bible));await run(s)
        await adopt(s,await stage(s,`avg.media.environment-brief.${s.media.subjectKey}`,s.media));await run(s)
      }
      const input=await restartInput(s),parent=await current(s),commands=await db.productProductionCommands.count(),briefs=await db.productProductionBriefs.count()
      await expect(restartAvgVisualPlanningFromDraftV4(input)).rejects.toThrow(/未知结果|未完成领取/)
      const {sourceInputHash:_hash,aspectRatio:_ratio,...planning}=s.brief.avgVisualPlanning!.scope
      const renamed=structuredClone(planning);renamed.templates[0].parameters.requirementKey+='.renamed';renamed.templates[0].parameters.assetKey+='.renamed'
      await expect(prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:input.expectedDraftRevision,visualPlanning:renamed})).rejects.toThrow(/未知结果|未完成领取/)
      expect(await current(s)).toEqual(parent);expect(await db.productProductionCommands.count()).toBe(commands);expect(await db.productProductionBriefs.count()).toBe(briefs)
      expect(s.runText).toHaveBeenCalledTimes(kind==='text'?1:2);expect(s.imageFetcher).toHaveBeenCalledTimes(kind==='text'?0:1)
    },30_000)

    it('does not infer a vanished paid request from an emptied but structurally valid cached ledger',async()=>{
      const s=await setup({malformed:true});await sources(s);await run(s)
      const build=await current(s),ledger=JSON.parse(build.budgetLedgerJson)
      ledger.tasks={};ledger.attempts=[];ledger.rootRunId=null
      await db.productBuilds.update(build.id!,{budgetLedgerJson:JSON.stringify(ledger)})
      const briefs=await db.productProductionBriefs.count()
      await expect(restartAvgVisualPlanningFromDraftV4(await restartInput(s))).rejects.toThrow(/已发送请求缺少准确终态记账/)
      expect(await db.productProductionBriefs.count()).toBe(briefs);expect(s.runText).toHaveBeenCalledTimes(1)
    })

    it('preserves an immutable unknown Run even if its cached attempt is falsely marked settled',async()=>{
      const s=await setup({unknown:true});await sources(s);await run(s)
      const build=await current(s),ledger=JSON.parse(build.budgetLedgerJson)
      for(const attempt of ledger.attempts){attempt.usageKnown=true;attempt.errorCode=null;delete attempt.resolution}
      for(const task of Object.values(ledger.tasks) as Array<{errorCode:string|null}>){task.errorCode=null}
      await db.productBuilds.update(build.id!,{budgetLedgerJson:JSON.stringify(ledger)})
      const briefs=await db.productProductionBriefs.count(),runs=await db.agentRuns.count()
      await expect(restartAvgVisualPlanningFromDraftV4(await restartInput(s))).rejects.toThrow(/Run 保留未知结果/)
      expect(await db.productProductionBriefs.count()).toBe(briefs);expect(await db.agentRuns.count()).toBe(runs)
      expect(s.runText).toHaveBeenCalledTimes(1);expect(s.imageFetcher).not.toHaveBeenCalled()
    })

    it.each(['same-production','new-production'] as const)('blocks %s shared-command bypass before a second provider dispatch in this Work',async mode=>{
      const s=await setup({unknown:true});await sources(s);await run(s)
      let productionId=s.productionId
      if(mode==='new-production'){
        const created=await executeProductProductionCommand({scope:s.scope,command:{type:'create-intent',commandId:'visual.bypass.intent',productionKey:'visual.bypass.production',productType:'avg',worldReleaseId:s.brief.source.worldReleaseId,userText:'独立治理绕过反例'}})
        if(!created.ok)throw new Error(JSON.stringify(created));productionId=created.productionId
      }
      const previous=await readProductProductionDetailsV1(s.scope,productionId,['avg'])
      const saved=await executeProductProductionCommand({scope:s.scope,productionId,command:{type:'save-brief-revision',commandId:'visual.bypass.brief',expectedStateRevision:previous.production.stateRevision,parentRevision:previous.brief?.revision??null,brief:s.brief}})
      if(!saved.ok)throw new Error(JSON.stringify(saved))
      const prepared=await readProductProductionDetailsV1(s.scope,productionId,['avg'])
      const started=await executeProductProductionCommand({scope:s.scope,productionId,command:{type:'authorize-start',commandId:'visual.bypass.start',expectedStateRevision:prepared.production.stateRevision,briefRevision:prepared.brief!.revision,briefHash:prepared.brief!.briefHash,authorizationNonce:'explicit-bypass-test-start'}})
      if(!started.ok)throw new Error(JSON.stringify(started))
      const details=await readProductProductionDetailsV1(s.scope,productionId,['avg'])
      const second={...s,productionId,buildId:details.build!.id!,executor:createConfiguredProductProductionExecutorV1({production:details.production,brief:s.brief,runText:s.runText,mediaCapabilities:new Map()})}
      await run(second);second.plan=parseProductProductionPlanV3((await current(second)).planJson,s.brief,(await current(second)).briefHash)
      await sources(second);await run(second)
      expect((await current(second)).failureJson).toContain('未知结果');expect(s.runText).toHaveBeenCalledTimes(1);expect(s.imageFetcher).not.toHaveBeenCalled()
    },30_000)

    it('rechecks the old request boundary at explicit start after a reviewable replacement was prepared',async()=>{
      const s=await setup({malformed:true});await sources(s);await run(s)
      const prepared=await restartAvgVisualPlanningFromDraftV4(await restartInput(s)),parent=await current(s),ledger=JSON.parse(parent.budgetLedgerJson)
      ledger.attempts.find((a:{taskKey:string})=>a.taskKey==='avg.visual.propose.direction').usageKnown=false
      await db.productBuilds.update(parent.id!,{budgetLedgerJson:JSON.stringify(ledger)})
      await expect(startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:prepared.brief!.briefHash})).rejects.toThrow(/未知结果|未完成领取/)
      expect(await db.productBuilds.count()).toBe(1);expect(s.runText).toHaveBeenCalledTimes(1);expect(s.imageFetcher).not.toHaveBeenCalled()
    })

    it.each(['missing','cycle'] as const)('refuses a %s ancestor instead of ignoring its possible requests',async kind=>{
      const s=await setup({malformed:true});await sources(s);await run(s)
      const build=await current(s);await db.productBuilds.update(build.id!,{parentBuildNumber:kind==='cycle'?build.buildNumber:999})
      const briefs=await db.productProductionBriefs.count()
      await expect(restartAvgVisualPlanningFromDraftV4(await restartInput(s))).rejects.toThrow(/谱系|祖先/)
      expect(await db.productProductionBriefs.count()).toBe(briefs);expect(s.runText).toHaveBeenCalledTimes(1)
    })

    it.each(['known','unknown','known-image','unknown-image'] as const)('keeps the %s request boundary after a complete backup remaps the stopped Work',async kind=>{
      const s=await setup(kind==='known'?{malformed:true}:kind==='unknown'?{unknown:true}:{image:kind==='known-image'?'busy':'unknown'});await sources(s);await run(s)
      if(kind.endsWith('-image')){
        await adopt(s,await stage(s,'avg.media.visual-bible',s.bible));await run(s)
        await adopt(s,await stage(s,`avg.media.environment-brief.${s.media.subjectKey}`,s.media));await run(s)
      }
      const original=await current(s),projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId))
      const build=(await db.productBuilds.where('projectId').equals(projectId).first())!
      const restored={...s,scope:{projectId,worldId:build.worldId,workId:build.workId},productionId:build.productionId,buildId:build.id!}
      const input=await restartInput(restored),runs=await db.agentRuns.count()
      const oldEvents=await db.agentRunEvents.where('projectId').equals(projectId).toArray()
      const oldRuns=await db.agentRuns.where('productBuildId').equals(build.id!).toArray()
      if(kind==='known'||kind==='known-image'){
        const prepared=await restartAvgVisualPlanningFromDraftV4(input)
        expect(prepared.production.id).toBe(build.productionId);expect(prepared.production.status).toBe('brief-ready')
        expect(prepared.brief!.revision).toBeGreaterThan(build.briefRevision)
      }else{
        const briefs=await db.productProductionBriefs.count()
        await expect(restartAvgVisualPlanningFromDraftV4(input)).rejects.toThrow(/未知结果|未完成领取/)
        expect(await db.productProductionBriefs.count()).toBe(briefs)
      }
      expect(await current(restored)).toEqual(build);expect(await current(s)).toEqual(original)
      expect(await db.agentRuns.count()).toBe(runs)
      expect(await db.agentRuns.where('productBuildId').equals(build.id!).toArray()).toEqual(oldRuns)
      expect(await db.agentRunEvents.where('projectId').equals(projectId).toArray()).toEqual(oldEvents)
      expect(s.runText).toHaveBeenCalledTimes(kind.endsWith('-image')?2:1)
      expect(s.imageFetcher).toHaveBeenCalledTimes(kind.endsWith('-image')?1:0)
    },30_000)

    it('rejects stale Build/draft and live-source replacements without mutation',async()=>{
      const s=await setup({malformed:true});await sources(s);await run(s)
      const input=await restartInput(s),parent=await current(s),briefs=await db.productProductionBriefs.count()
      await expect(restartAvgVisualPlanningFromDraftV4({...input,expectedBuildRevision:input.expectedBuildRevision+1})).rejects.toThrow(/已变化/)
      await expect(restartAvgVisualPlanningFromDraftV4({...input,expectedDraftRevision:input.expectedDraftRevision+1})).rejects.toThrow(/已变化/)
      expect(await current(s)).toEqual(parent);expect(await db.productProductionBriefs.count()).toBe(briefs)
      const other=await createAvgDraftV1('隔离作品')
      await expect(restartAvgVisualPlanningFromDraftV4({...input,scope:other.scope})).rejects.toThrow()
      expect(await db.productProductionBriefs.count()).toBe(briefs)
      const live=await setup(),liveBriefs=await db.productProductionBriefs.count()
      await expect(restartAvgVisualPlanningFromDraftV4(await restartInput(live))).rejects.toThrow(/已变化/)
      expect(await db.productProductionBriefs.count()).toBe(liveBriefs);expect(live.runText).not.toHaveBeenCalled()
    })
  })


  describe('explicit zero-call historical proposal reuse',()=>{
    async function failedWithEdits(fenced=false){
      const s=await setup({image:'busy',fenced});await sources(s);await run(s)
      const bible=structuredClone(s.bible);bible.style.lighting+='；作者保留机械开关关闭且不发光'
      await adopt(s,await stage(s,'avg.media.visual-bible',bible));await run(s)
      const media=structuredClone(s.media);media.outputs[0].prompt+='；作者要求对白区域自然延续'
      await adopt(s,await stage(s,`avg.media.environment-brief.${media.subjectKey}`,media));await run(s)
      return {s,bible,media}
    }
    async function prepareReuse(s:Setup,onlyDirection=false){
      const parent=await current(s)
      const pending=await restartAvgVisualPlanningFromDraftV4(await restartInput(s))
      const options=await readAvgVisualReuseOptionsV4({scope:s.scope,productionId:s.productionId,buildNumber:parent.buildNumber,expectedBuildRevision:parent.stateRevision})
      expect(options.options.filter(o=>o.available)).toHaveLength(2)
      const selections=options.options.flatMap(o=>o.available&&(!onlyDirection||o.artifactKey==='avg.media.visual-bible')?[o.selection]:[])
      const draft=await readAvgDraftV1(s.scope)
      const input={scope:s.scope,productionId:s.productionId,expectedBriefHash:pending.brief!.briefHash,expectedDraftRevision:draft.revision,
        expectedBuildId:parent.id!,expectedBuildRevision:parent.stateRevision,selections}
      const prepared=await prepareAvgVisualProposalReuseV4(input)
      return {prepared,input,options,parent}
    }
    async function startReuse(s:Setup,prepared:Awaited<ReturnType<typeof prepareAvgVisualProposalReuseV4>>){
      const details=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:prepared.brief!.briefHash})
      const brief=parseProductProductionBriefV3(prepared.brief!.briefJson),build=details.build!
      const execution=await resolveAvgVisualPlanningExecutionV4(s.scope,brief,build.id!)
      const executor=createConfiguredProductProductionExecutorV1({production:details.production,brief,runText:s.runText,...execution})
      return {...s,buildId:build.id!,brief,plan:parseProductProductionPlanV3(build.planJson,brief,build.briefHash),executor,capabilityBindings:execution.capabilityBindings}
    }
    async function imageRouteInput(s:Setup,prepared:Awaited<ReturnType<typeof prepareAvgVisualProposalReuseV4>>){
      const draft=await readAvgDraftV1(s.scope),parent=await current(s)
      return {scope:s.scope,productionId:s.productionId,expectedBriefHash:prepared.brief!.briefHash,expectedDraftRevision:draft.revision,
        expectedBuild:{id:parent.id!,revision:parent.stateRevision},adapterId:AVG_IMAGE_REFERENCE_CAPABILITY_V2.adapterId}
    }

    it.each(['none','stopped','pending'] as const)('explicitly freezes Image 2.5 after import=%s, reuses author edits without text calls and consumes the single new image in a frozen Preview',async importStage=>{
      vi.spyOn(imageDecoder,'inspectAvgImageBytesV1').mockResolvedValue({width:576,height:324,hasAlpha:false})
      const failed=await failedWithEdits(),{bible,media}=failed
      let s=failed.s
      if(importStage==='stopped'){
        const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
        s={...s,scope:{projectId,worldId:build.worldId,workId:build.workId},productionId:build.productionId,buildId:build.id!}
      }
      let {prepared,parent}=await prepareReuse(s)
      if(importStage==='pending'){
        const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
        s={...s,scope:{projectId,worldId:build.worldId,workId:build.workId},productionId:build.productionId,buildId:build.id!}
        prepared=await readProductProductionDetailsV1(s.scope,s.productionId,['avg']);parent=await current(s)
        expect(parseProductProductionBriefV3(prepared.brief!.briefJson).source.worldReleaseId).not.toBe(prepared.brief!.sourceWorldReleaseId)
      }
      const oldArtifacts=await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray(),oldRuns=await db.agentRuns.toArray()
      const revised=await prepareAvgVisualImageRouteV4(await imageRouteInput(s,prepared)),brief=parseProductProductionBriefV3(revised.brief!.briefJson)
      expect(brief.avgVisualPlanning!.imageBinding.adapterId).toBe('agnes.image-2.5-flash.v1')
      expect(brief.source.worldReleaseId).toBe(revised.brief!.sourceWorldReleaseId)
      expect(brief.source.worldContentHash).toBe(prepared.brief!.sourceWorldContentHash)
      expect(brief.capabilityRequirements.find(c=>c.requirementKey==='avg.media.image')!.capabilityHash).toBe(await hashProductProductionValueV2(AVG_IMAGE_REFERENCE_CAPABILITY_V2))
      expect(brief.avgVisualPlanning!.proposalReuse).toEqual(parseProductProductionBriefV3(prepared.brief!.briefJson).avgVisualPlanning!.proposalReuse)
      expect(brief.productionBudget).toMatchObject({maximumModelCalls:0,maximumMediaCalls:1})
      expect(await db.productBuilds.where('workId').equals(s.scope.workId).count()).toBe(1);expect(await db.agentRuns.toArray()).toEqual(oldRuns)
      const noChange=await exportProjectJSON(s.scope.projectId)
      await prepareAvgVisualImageRouteV4(await imageRouteInput(s,revised))
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...noChange,exportedAt:0})
      const child=await startReuse(s,revised)
      await sources(child);await run(child);await adopt(child,await stage(child,'avg.media.visual-bible',bible));await run(child)
      await adopt(child,await stage(child,`avg.media.environment-brief.${media.subjectKey}`,media));await cycle(child)
      s.imageFetcher.mockImplementationOnce(async()=>new Response(JSON.stringify({data:[{b64_json:s.imageBase64}]}),{headers:{'content-type':'application/json'}}))
      await cycle(child)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(2)
      expect(JSON.parse(String(s.imageFetcher.mock.calls[0][1]!.body)).model).toBe('agnes-image-2.1-flash')
      const body=JSON.parse(String(s.imageFetcher.mock.calls[1][1]!.body))
      expect(body.model).toBe('agnes-image-2.5-flash');expect(body.prompt).toContain(media.outputs[0].prompt)
      const raw=(await accepted(child,`avg.media.raw.${media.outputs[0].requirementKey}`))!
      expect(raw,(await current(child)).failureJson).toBeDefined()
      expect((await db.mediaBlobObjects.get(raw.blobObjectId!))!.data).toEqual(s.imageBytes)
      expect((await verifyHistoricalAvgVisualImageProducerV4({scope:child.scope,buildId:child.buildId,
        expectedBuildRevision:(await current(child)).stateRevision,expectedBriefHash:(await current(child)).briefHash,expectedPlanHash:(await current(child)).planHash,
        sourceControlEpoch:child.plan.controlEpoch,artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash})).artifact.metadataJson).toBe(raw.metadataJson)
      const requirement=JSON.parse(raw.payloadJson).requirement,image={scope:child.scope,productionId:child.productionId,
        requirementKey:requirement.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash}
      const confirm=(candidate:ProductBuildArtifactRecordV1)=>confirmAvgWorkspaceInputV1({...child,artifactKey:candidate.artifactKey,
        candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
      const generated={s:child,raw,requirement,image,confirm,
        review:()=>stageAvgVisualReviewV1({...image,report:avgVisualReviewFixture(requirement,raw.contentHash),declaration:'受控工程观察，不签艺术质量'}),
        choose:()=>stageAvgMediaChoiceV2({...image,declaration:'明确选择当前模型的原图'})}
      await adoptedImageStage(generated);await run(child)
      expect((await current(child)).status,(await current(child)).failureJson).toBe('preview-ready');expect((await current(child)).previewHash).toBeTruthy()
      await verifyStoredProductBuildPreview(await current(child))
      const currentBuild=await current(child),imageHistory=await readAvgHistoricalRawImageV4({scope:child.scope,buildId:child.buildId,
        expectedBuildRevision:currentBuild.stateRevision,controlEpoch:child.plan.controlEpoch,expectedBriefHash:currentBuild.briefHash,
        expectedPlanHash:currentBuild.planHash,artifact:{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}})
      expect(imageHistory.asset.source).toBe('agnes.image-2.5-flash.v1');expect(imageHistory.brief).toEqual(child.brief)
      expect(await current(s)).toEqual(parent);expect(await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()).toEqual(oldArtifacts)
      const importedProject=await importProjectJSON(await exportProjectJSON(child.scope.projectId))
      const imported=(await db.productBuilds.where('projectId').equals(importedProject).filter(b=>b.buildNumber===(parent.buildNumber+1)).first())!
      const scope={projectId:importedProject,worldId:imported.worldId,workId:imported.workId}
      expect((await verifyStoredProductBuildPreview(imported)).previewHash).toBe((await current(child)).previewHash)
      useAIConfigStore.getState().setConfig({apiKey:''})
      await recoverImportedProductProductionProofsV1({scope,productionId:imported.productionId})
      await verifyProductBuildTerminalArtifactSetV1({scope,productionId:imported.productionId,buildId:imported.id!,
        expectedControlEpoch:imported.controlEpoch,expectedPlanHash:imported.planHash})
      await deleteWork(scope.workId)
      expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
      expect((await db.mediaBlobObjects.get(raw.blobObjectId!))!.data).toEqual(s.imageBytes)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(2)
    },90_000)

    it.each(['reuse','raw','processing'] as const)('saves an explicit %s edit of a remapped pending Brief with its registered world locator and preserves all old Runs',async operation=>{
      const {s:original}=await failedWithEdits(),pending=await prepareReuse(original)
      const projectId=await importProjectJSON(await exportProjectJSON(original.scope.projectId)),build=(await db.productBuilds.where('projectId').equals(projectId).first())!
      const scope={projectId,worldId:build.worldId,workId:build.workId},details=await readProductProductionDetailsV1(scope,build.productionId,['avg']),draft=await readAvgDraftV1(scope)
      const before={builds:await db.productBuilds.toArray(),runs:await db.agentRuns.toArray(),events:await db.agentRunEvents.toArray(),brief:details.brief}
      const common={scope,productionId:build.productionId,expectedBriefHash:details.brief!.briefHash,expectedDraftRevision:draft.revision}
      const result=operation==='reuse'?await prepareAvgVisualProposalReuseV4({...common,expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision,selections:pending.input.selections})
        :operation==='raw'?await prepareAvgVisualRawReuseV4({...common,expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision,sources:[]})
        :await prepareAvgVisualImageProcessingV4({...common,expectedBuild:{id:build.id!,revision:build.stateRevision},plan:null})
      expect(result.brief!.revision).toBe(details.brief!.revision+1)
      expect(parseProductProductionBriefV3(result.brief!.briefJson).source.worldReleaseId).toBe(draft.worldReleaseId)
      expect(result.brief!.sourceWorldContentHash).toBe(details.brief!.sourceWorldContentHash)
      expect(await db.productProductionBriefs.get(before.brief!.id!)).toEqual(before.brief)
      expect(await db.productBuilds.toArray()).toEqual(before.builds);expect(await db.agentRuns.toArray()).toEqual(before.runs);expect(await db.agentRunEvents.toArray()).toEqual(before.events)
      expect(original.runText).toHaveBeenCalledTimes(2);expect(original.imageFetcher).toHaveBeenCalledTimes(1)
    },30_000)

    it('rejects a pending registered world hash that contradicts its immutable Brief before saving or dispatching',async()=>{
      const {s}=await failedWithEdits(),{prepared}=await prepareReuse(s),input=await imageRouteInput(s,prepared)
      await db.productProductionBriefs.update(prepared.brief!.id!,{sourceWorldContentHash:'f'.repeat(64)})
      const briefs=await db.productProductionBriefs.toArray(),commands=await db.productProductionCommands.toArray(),runs=await db.agentRuns.toArray()
      await expect(prepareAvgVisualImageRouteV4(input)).rejects.toThrow(/世界|来源/)
      expect(await db.productProductionBriefs.toArray()).toEqual(briefs);expect(await db.productProductionCommands.toArray()).toEqual(commands);expect(await db.agentRuns.toArray()).toEqual(runs)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    })

    it.each(['brief','draft','parent'] as const)('rejects a stale %s while selecting Image 2.5 before saving or dispatching',async mode=>{
      const {s}=await failedWithEdits(),{prepared}=await prepareReuse(s),input=await imageRouteInput(s,prepared)
      if(mode==='brief')input.expectedBriefHash='f'.repeat(64)
      if(mode==='draft')input.expectedDraftRevision++
      if(mode==='parent')input.expectedBuild.revision++
      const before=await exportProjectJSON(s.scope.projectId)
      await expect(prepareAvgVisualImageRouteV4(input)).rejects.toThrow(/变化/)
      expect({...await exportProjectJSON(s.scope.projectId),exportedAt:0}).toEqual({...before,exportedAt:0})
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it('rejects a changed route after Image 2.5 preparation before another Build or provider call',async()=>{
      const {s}=await failedWithEdits(),{prepared}=await prepareReuse(s)
      const revised=await prepareAvgVisualImageRouteV4(await imageRouteInput(s,prepared))
      useAIConfigStore.getState().setConfig({...config,baseUrl:'https://changed.fixture.invalid/v1'})
      await expect(startReuse(s,revised)).rejects.toThrow()
      expect(await db.productBuilds.count()).toBe(1);expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it('preserves the explicit Image 2.5 selection when the unstarted professional scope is edited',async()=>{
      const {s}=await failedWithEdits(),{prepared}=await prepareReuse(s)
      const revised=await prepareAvgVisualImageRouteV4(await imageRouteInput(s,prepared))
      const {sourceInputHash:_hash,aspectRatio:_ratio,...visualPlanning}=parseProductProductionBriefV3(revised.brief!.briefJson).avgVisualPlanning!.scope
      visualPlanning.templates[0].requiredDetails.push('新方案明确保留书桌轮廓')
      const details=await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:(await readAvgDraftV1(s.scope)).revision,visualPlanning})
      const brief=parseProductProductionBriefV3(details.brief!.briefJson)
      expect(brief.avgVisualPlanning!.imageBinding.adapterId).toBe('agnes.image-2.5-flash.v1')
      expect(brief.capabilityRequirements.find(c=>c.requirementKey==='avg.media.image')!.capabilityHash).toBe(await hashProductProductionValueV2(AVG_IMAGE_REFERENCE_CAPABILITY_V2))
      expect(brief.avgVisualPlanning!.scope.templates[0].requiredDetails).toContain('新方案明确保留书桌轮廓')
      expect(await db.productBuilds.count()).toBe(1);expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)
    it('preserves edited drafts and original raw bytes in separate zero-call current producers and requires current adoption',async()=>{
      const {s,bible,media}=await failedWithEdits(),oldRows=await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()
      const {prepared,parent}=await prepareReuse(s)
      expect(parseProductProductionBriefV3(prepared.brief!.briefJson).productionBudget.maximumModelCalls).toBe(0)
      expect(await db.productBuilds.count()).toBe(1);expect(await current(s)).toEqual(parent)
      const noText=vi.spyOn(textCapabilities,'resolveConfiguredTextCapabilityV1').mockRejectedValue(new Error('Text route must not resolve for all reused'))
      const child=await startReuse(s,prepared)
      expect(noText).not.toHaveBeenCalled();expect(child.plan.tasks.filter(t=>t.executionMode==='model')).toHaveLength(0)
      expect(child.capabilityBindings.every(b=>b.requirementKey!=='avg.visual.planning.text')).toBe(true)
      await sources(child);await run(child)
      const direction=(await accepted(child,'avg.proposal.visual-bible'))!
      expect(direction).toBeTruthy();expect(await accepted(child,'avg.media.visual-bible')).toBeUndefined()
      const proposal=JSON.parse(direction.payloadJson)
      expect(proposal).toMatchObject({version:2,payload:bible,modelPayload:s.bible})
      const proof=await readAvgVisualProposalEvidenceV4(child.scope,direction)
      expect(proof.reused).toBe(true);expect(proof.rawText).toBe(JSON.stringify(s.bible))
      expect(proof.snapshot.run.id).not.toBe(proof.modelRun.run.id)
      expect(proof.snapshot.events.some(e=>e.type==='model.requested'||e.type==='tool.called')).toBe(false)
      const candidate=await stage(child,'avg.media.visual-bible',proposal.payload)
      expect(JSON.parse(candidate.metadataJson)).toMatchObject({version:7,origin:'history-reuse',visualProposalValidation:{authorEdited:true}})
      await adopt(child,candidate);await run(child)
      const subject=(await accepted(child,`avg.proposal.environment-brief.${media.subjectKey}`))!
      expect(JSON.parse(subject.payloadJson)).toMatchObject({version:2,payload:media,modelPayload:s.media})
      await adopt(child,await stage(child,`avg.media.environment-brief.${media.subjectKey}`,JSON.parse(subject.payloadJson).payload))
      await cycle(child)
      expect(await accepted(child,'avg.media.compiled-visual-requirements')).toBeTruthy()
      const ledger=JSON.parse((await current(child)).budgetLedgerJson)
      expect(ledger.attempts.reduce((n:number,a:{usage:{modelCalls:number;mediaCalls:number}|null})=>n+(a.usage?.modelCalls??0),0)).toBe(0)
      expect(ledger.attempts.reduce((n:number,a:{usage:{mediaCalls:number}|null})=>n+(a.usage?.mediaCalls??0),0)).toBe(0)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
      expect(await current(s)).toEqual(parent);expect(await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()).toEqual(oldRows)
      expect(noText).not.toHaveBeenCalled()
    },60_000)

    it('keeps one finite model request when only the direction is reused',async()=>{
      const {s,bible}=await failedWithEdits(),{prepared}=await prepareReuse(s,true),child=await startReuse(s,prepared)
      expect(child.brief.productionBudget.maximumModelCalls).toBe(1)
      expect(child.plan.tasks.filter(t=>t.executionMode==='model')).toHaveLength(1)
      await sources(child);await run(child)
      expect(s.runText).toHaveBeenCalledTimes(2)
      await adopt(child,await stage(child,'avg.media.visual-bible',bible));await run(child)
      expect(s.runText).toHaveBeenCalledTimes(3);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
      const raw=(await accepted(child,`avg.proposal.environment-brief.${s.media.subjectKey}`))!
      expect(JSON.parse(raw.payloadJson).version).toBe(1)
      expect((await readAvgVisualProposalEvidenceV4(child.scope,raw)).reused).toBe(false)
    },60_000)

    it('stops subject reuse when the current author changes the visual direction without a paid fallback',async()=>{
      const {s,bible}=await failedWithEdits(),{prepared}=await prepareReuse(s),child=await startReuse(s,prepared)
      await sources(child);await run(child)
      const changed=structuredClone(bible);changed.style.lighting+='；当前作者改为右侧硬光'
      await adopt(child,await stage(child,'avg.media.visual-bible',changed));await run(child)
      expect(await accepted(child,`avg.proposal.environment-brief.${s.media.subjectKey}`)).toBeUndefined()
      expect((await current(child)).failureJson).toContain('视觉基准')
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
      db.close();await db.open();await run(child)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it.each(['draft','brief','build','source-revision','source-hash','duplicate'] as const)('rejects stale or forged %s selections before another Brief, Build or call',async mode=>{
      const {s}=await failedWithEdits(),{prepared,input}=await prepareReuse(s)
      const draft=await readAvgDraftV1(s.scope),before=await exportProjectJSON(s.scope.projectId)
      const next={...input,expectedBriefHash:prepared.brief!.briefHash,expectedDraftRevision:draft.revision,selections:structuredClone(input.selections)}
      if(mode==='draft')next.expectedDraftRevision++
      if(mode==='brief')next.expectedBriefHash='f'.repeat(64)
      if(mode==='build')next.expectedBuildRevision++
      if(mode==='source-revision')next.selections[0].buildRevision++
      if(mode==='source-hash')next.selections[0].artifact.contentHash='f'.repeat(64)
      if(mode==='duplicate')next.selections.push(next.selections[0])
      await expect(prepareAvgVisualProposalReuseV4(next)).rejects.toThrow()
      const after=await exportProjectJSON(s.scope.projectId)
      expect({...after,exportedAt:0}).toEqual({...before,exportedAt:0})
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it('explicitly clears all selected roles and restores the finite fresh-model budget without starting',async()=>{
      const {s}=await failedWithEdits(),{prepared,input}=await prepareReuse(s)
      const cleared=await prepareAvgVisualProposalReuseV4({...input,expectedBriefHash:prepared.brief!.briefHash,selections:[]})
      const brief=parseProductProductionBriefV3(cleared.brief!.briefJson)
      expect(brief.avgVisualPlanning!.proposalReuse).toBeUndefined();expect(brief.productionBudget.maximumModelCalls).toBe(2)
      expect(brief.capabilityRequirements.find(c=>c.mediaClass==='text')!.required).toBe(true)
      expect(await db.productBuilds.count()).toBe(1);expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it('rechecks damaged original model evidence at explicit start before creating a current Build',async()=>{
      const {s}=await failedWithEdits(),{prepared}=await prepareReuse(s)
      const original=(await accepted(s,'avg.proposal.visual-bible'))!,quality=JSON.parse(original.qualityJson)
      const raw=(await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.scope.projectId,'raw-response',quality.rawResponseHash]).first())!
      await db.agentRunArtifacts.update(raw.id!,{content:'damaged original raw bytes'})
      await expect(startReuse(s,prepared)).rejects.toThrow()
      expect(await db.productBuilds.count()).toBe(1);expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it('retains original model lineage through a reused source, backup import/remap, and source Work deletion',async()=>{
      const {s,bible,media}=await failedWithEdits(),{prepared}=await prepareReuse(s),child=await startReuse(s,prepared)
      await sources(child);await run(child);await adopt(child,await stage(child,'avg.media.visual-bible',bible));await run(child)
      await adopt(child,await stage(child,`avg.media.environment-brief.${media.subjectKey}`,media));await cycle(child)
      await stopProductProductionV1({scope:child.scope,production:(await db.productProductions.get(child.productionId))!})
      const parent=await current(child),canonical=(await accepted(child,`avg.media.environment-brief.${media.subjectKey}`))!
      const historical={scope:child.scope,buildId:child.buildId,expectedBuildRevision:parent.stateRevision,controlEpoch:canonical.controlEpoch,
        expectedBriefHash:parent.briefHash,expectedPlanHash:parent.planHash,artifact:{artifactKey:canonical.artifactKey,version:canonical.version,contentHash:canonical.contentHash}}
      const before=await readAvgHistoricalVisualArtifactV4(historical)
      expect(before.candidate.version).toBe(7);expect(before.original.reused).toBe(true);expect(before.original.rawText).toBe(JSON.stringify(s.media))
      const originalModelRunId=before.original.modelRun.run.id
      expect(before.original.producerRunId).not.toBe(originalModelRunId)
      const projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId))
      const restored=(await db.productBuilds.where('projectId').equals(projectId).filter(b=>b.buildNumber===parent.buildNumber).first())!
      const scope={projectId,worldId:restored.worldId,workId:restored.workId}
      const after=await readAvgHistoricalVisualArtifactV4({...historical,scope,buildId:restored.id!})
      expect(after.payload).toEqual(media);expect(after.original.rawText).toBe(before.original.rawText)
      expect(after.original.modelRun.run.id).not.toBe(originalModelRunId)
      expect(after.original.modelRequestText).toBe(before.original.modelRequestText)
      await deleteWork(scope.workId)
      await expect(readAvgHistoricalVisualArtifactV4({...historical,scope,buildId:restored.id!})).rejects.toThrow()
      expect((await readAvgHistoricalVisualArtifactV4(historical)).payload).toEqual(media)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it('reads accepted fenced model JSON with the original strict parser while retaining exact original bytes',async()=>{
      const {s,bible}=await failedWithEdits(true),{prepared,options}=await prepareReuse(s)
      expect(options.options.find(o=>o.available&&o.artifactKey==='avg.media.visual-bible')).toMatchObject({available:true,modelPayload:s.bible,payload:bible})
      const child=await startReuse(s,prepared);await sources(child);await run(child)
      const raw=(await accepted(child,'avg.proposal.visual-bible'))!,proof=await readAvgVisualProposalEvidenceV4(child.scope,raw)
      expect(proof.rawText).toBe('```json\n'+JSON.stringify(s.bible)+'\n```')
      expect(JSON.parse(raw.payloadJson)).toMatchObject({payload:bible,modelPayload:s.bible})
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it.each(['before-start','before-dispatch'] as const)('holds newly unknown ancestor usage %s without paid fallback',async point=>{
      const {s}=await failedWithEdits(),{prepared}=await prepareReuse(s)
      const child=point==='before-dispatch'?await startReuse(s,prepared):null
      const old=await current(s),ledger=JSON.parse(old.budgetLedgerJson)
      ledger.attempts.find((a:{taskKey:string})=>a.taskKey.startsWith('avg.media.generate.')).usageKnown=false
      await db.productBuilds.update(old.id!,{budgetLedgerJson:canonicalProductProductionJsonV2(ledger)})
      if(child){await sources(child);await run(child);expect(await accepted(child,'avg.proposal.visual-bible')).toBeUndefined()}
      else {await expect(startReuse(s,prepared)).rejects.toThrow(/未知|未完成/);expect(await db.productBuilds.count()).toBe(1)}
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)

    it('reuses a separately re-adopted second generation while keeping the first actual model Run and bounded history',async()=>{
      const {s,bible,media}=await failedWithEdits(),first=await prepareReuse(s),child=await startReuse(s,first.prepared)
      await sources(child);await run(child);await adopt(child,await stage(child,'avg.media.visual-bible',bible));await run(child)
      await adopt(child,await stage(child,`avg.media.environment-brief.${media.subjectKey}`,media));await cycle(child)
      await stopProductProductionV1({scope:child.scope,production:(await db.productProductions.get(child.productionId))!})
      const second=await prepareReuse(child),third=await startReuse(child,second.prepared)
      expect(third.brief.avgVisualPlanning!.proposalReuse!.every(r=>r.buildNumber===2)).toBe(true)
      await sources(third);await run(third);await adopt(third,await stage(third,'avg.media.visual-bible',bible));await run(third)
      const raw=(await accepted(third,`avg.proposal.environment-brief.${media.subjectKey}`))!
      expect(raw,(await current(third)).failureJson).toBeTruthy()
      const proof=await readAvgVisualProposalEvidenceV4(third.scope,raw)
      expect(proof.modelRun.contract.scope.productProduction!.buildNumber).toBe(1)
      expect(proof.rawText).toBe(JSON.stringify(s.media));expect(JSON.parse(raw.payloadJson).payload).toEqual(media)
      await expect(readAvgVisualProposalEvidenceV4(third.scope,raw,Array(32).fill('bounded'))).rejects.toThrow(/超界/)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
    },60_000)
  })
})
