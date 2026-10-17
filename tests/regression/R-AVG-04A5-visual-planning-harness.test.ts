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
import { readProductProductionDetailsV1, startProductProductionPreviewV1, recoverImportedProductProductionProofsV1, stopProductProductionV1 } from '../../src/lib/product-production/service'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { stageAvgAuthorArtifactV1, readAvgConfirmedVisualArtifactsV4, readAvgHistoricalVisualArtifactV4 } from '../../src/lib/avg/author-artifacts'
import { acceptProductBuildArtifact, verifyAcceptedProductBuildArtifactV1, verifyHistoricalAvgVisualPlanningArtifactV4, verifyProductBuildTerminalArtifactSetV1 } from '../../src/lib/product-production/artifact-store'
import { readAvgVisualProposalEvidenceV4 } from '../../src/lib/avg/visual-planning-evidence'
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

async function setup(options: { fenced?:boolean; malformed?: boolean; wrongBinding?: boolean; visualShape?: 'combined-schema-key' | 'string-palette' | 'extra-root-fields'; unknown?: boolean; reference?: 'valid' | 'missing' | 'tampered'; image?: 'valid' | 'unknown' | 'malformed' | 'corrupt-json' | 'busy' } = {}) {
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
  const parsed = parseProductProductionBriefV3(brief)
  const saved = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId,
    command: { type: 'save-brief-revision', commandId: 'visual.actual.save', expectedStateRevision: owner.details.production.stateRevision,
      parentRevision: owner.details.brief!.revision, brief: parsed } })
  if (!saved.ok) throw new Error(JSON.stringify(saved))
  const prepared = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
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
  const s = { ...owner, buildId, source, brief: parsed, plan, bible, media, runText, executor, capabilityBindings, imageFetcher, imageBytes }
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
async function generatedImage() {
  vi.spyOn(imageDecoder, 'inspectAvgImageBytesV1').mockResolvedValue({ width: 576, height: 324, hasAlpha: false })
  const s = await setup({ image: 'valid' }); await sources(s); await run(s)
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

  describe('current compiled image author consumption', () => {
    let generated: Awaited<ReturnType<typeof generatedImage>>
    // Keep real production preparation in the bounded setup hook. Each test
    // retains the default five-second author-action limit and all assertions.
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
    })

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

  describe('same-Work explicit V4 replacement Brief',()=>{
    it('prepares and starts a separate version after a received HTTP503 without changing the failed Build or dispatching another request',async()=>{
      const s=await setup({image:'busy'});await sources(s);await run(s)
      await adopt(s,await stage(s,'avg.media.visual-bible',s.bible));await run(s)
      await adopt(s,await stage(s,`avg.media.environment-brief.${s.media.subjectKey}`,s.media));await run(s)
      const parent=await current(s),runs=await db.agentRuns.count(),projects=await db.projects.count()
      expect(parent.status).toBe('recovery-required');expect(parent.failureJson).toContain('503')
      const prepared=await restartAvgVisualPlanningFromDraftV4(await restartInput(s))
      expect(prepared.production.id).toBe(s.productionId);expect(prepared.production.status).toBe('brief-ready')
      expect(prepared.brief!.revision).toBe(parent.briefRevision+1);expect(await current(s)).toEqual(parent)
      expect(await db.productBuilds.count()).toBe(1);expect(await db.agentRuns.count()).toBe(runs)
      expect(s.runText).toHaveBeenCalledTimes(2);expect(s.imageFetcher).toHaveBeenCalledTimes(1)
      db.close();await db.open()
      const refreshed=await readAvgAssemblyWorkspaceV1(s.scope,s.productionId)
      expect(refreshed.details!.build).toEqual(parent);expect(refreshed.details!.production.status).toBe('brief-ready')
      const child=await startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:prepared.brief!.briefHash})
      expect(child.build!.id).not.toBe(parent.id);expect(child.build!.parentBuildNumber).toBe(parent.buildNumber)
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

    it.each(['known','unknown'] as const)('keeps the %s request boundary after a complete backup remaps the stopped Work',async kind=>{
      const s=await setup(kind==='known'?{malformed:true}:{unknown:true});await sources(s);await run(s)
      const original=await current(s),projectId=await importProjectJSON(await exportProjectJSON(s.scope.projectId))
      const build=(await db.productBuilds.where('projectId').equals(projectId).first())!
      const restored={...s,scope:{projectId,worldId:build.worldId,workId:build.workId},productionId:build.productionId,buildId:build.id!}
      const input=await restartInput(restored),runs=await db.agentRuns.count()
      if(kind==='known'){
        const prepared=await restartAvgVisualPlanningFromDraftV4(input)
        expect(prepared.production.id).toBe(build.productionId);expect(prepared.production.status).toBe('brief-ready')
        expect(prepared.brief!.revision).toBeGreaterThan(build.briefRevision)
      }else{
        const briefs=await db.productProductionBriefs.count()
        await expect(restartAvgVisualPlanningFromDraftV4(input)).rejects.toThrow(/未知结果|未完成领取/)
        expect(await db.productProductionBriefs.count()).toBe(briefs)
      }
      expect(await current(restored)).toEqual(build);expect(await current(s)).toEqual(original)
      expect(await db.agentRuns.count()).toBe(runs);expect(s.runText).toHaveBeenCalledTimes(1);expect(s.imageFetcher).not.toHaveBeenCalled()
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
