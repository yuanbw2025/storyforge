import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as soundReadiness from '../../src/lib/avg/sound-production-brief'
import * as audioReadiness from '../../src/lib/avg/audio-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { avgSoundWireFixtureV1, avgSoundLibraryFixtureV1 } from '../helpers/avg-sound-provider-fixture'
import { avgSoundHarnessFixtureV1, adoptAvgSoundSourcesV1, adoptAvgSoundArtifactV1, cycleAvgSoundUntilV1,
  acceptedAvgSoundArtifactV1, confirmAvgSoundCandidateV1 } from '../helpers/avg-sound-harness-fixture'
import { avgSoundAuthorReviewFixtureV3 } from '../helpers/avg-sound-review-fixture'
import { finishAvgSoundRuntimeFixtureV1 } from '../helpers/avg-sound-runtime-fixture'
import { avgSoundProductionBudgetV1, avgSoundProductionGateIdsV1 } from '../../src/lib/avg/sound-production-policy'
import { readAvgRawSoundCandidateV1, readAvgSoundCandidateV1, stageAvgSoundReviewV1, stageAvgSoundChoiceV1 } from '../../src/lib/avg/sound-workbench-service'
import { configureAvgChosenSoundDraftV1, stageAvgWorkspaceInputV1, keepAvgGeneratedSoundStageDraftV1, startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgSoundLocalRepairDraftV1, clearAvgSoundLocalRepairDraftV1 } from '../../src/lib/avg/sound-local-repair-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { readAvgInheritedStageSoundsV1, readAvgAdoptedGeneratedSoundV1 } from '../../src/lib/avg/stage-sound-sources'
import { parseAvgAuthorSoundChoiceV1 } from '../../src/lib/avg/sound-choice-contract'
import { parseAvgProcessedAudioPayloadV1 } from '../../src/lib/avg/processed-audio-contract'
import { assertAvgAudioProcessingWaveBytesV1 } from '../../src/lib/avg/audio-processing'
import { executeAvgAudioGainWorkerRequestV1, type AvgAudioGainWorkerRequestV1 } from '../../src/lib/avg/audio-gain-worker-protocol'
import { hashAvgTaskRuntimeBindingV1 } from '../../src/lib/avg/task-claim'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readMediaBlobObjectData } from '../../src/lib/product-production/media-blob-store'
import { verifyAcceptedProductBuildArtifactV1 } from '../../src/lib/product-production/artifact-store'
import { verifyFrozenAvgAuthorInputsV1 } from '../../src/lib/avg/author-artifacts'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { recoverImportedProductProductionProofsV1 } from '../../src/lib/product-production/service'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

// Only closed capability fences, HTTP, Worker transport and unavailable DOM
// decoding are controlled. Brief/start, registered context, root/child Runs,
// PCM processing, sealed producers, author commands, CAS, Preview and backup
// lifecycle are actual isolated paths. No real inference or hearing is signed.
class WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage(value: AvgAudioGainWorkerRequestV1, transfer: Transferable[]) {
    const request = structuredClone(value, { transfer })
    queueMicrotask(() => this.onmessage?.({ data: executeAvgAudioGainWorkerRequestV1(request) } as MessageEvent<unknown>))
  }
}
const config = { provider: 'agnes' as const, baseUrl: 'https://sound-proposal.fixture.invalid/v1',
  apiKey: 'controlled-engineering-key-no-external-account', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 }
const declaration = 'ENGINEERING explicitly confirms this exact candidate for preview; actual hearing and commercial quality remain unknown.'
const ref = (r: { artifactKey: string; version: number; contentHash: string }) => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig(config)
  vi.spyOn(soundReadiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  vi.spyOn(audioReadiness, 'avgAudioProcessingExecutionReadyV1').mockReturnValue(true)
  vi.stubGlobal('Worker', WorkerPort)
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(a => ({ assetKey: a.assetKey, contentHash: a.contentHash, mimeType: a.mimeType, mediaClass: 'audio', status: 'decoded',
      decodedWidth: null, decodedHeight: null, decodedDurationMs: a.mimeType === 'audio/wav' ? 12000 : 500, decodedHasAlpha: null,
      decodedChannelCount: a.mimeType === 'audio/wav' ? 2 : 1, decodedSampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12,
      loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function startProcessedSound(gainMilliDb = -6000) {
  const semantic = await avgSoundPlanningFixtureV1()
  const wire = await avgSoundWireFixtureV1(semantic.compiled.requirements.find(r => r.dispatch.operation === 'generate-music')!)
  const s = await avgSoundHarnessFixtureV1({ audioFetcher: wire.fetcher,
    additionalBindings: [{ requirementKey: 'avg.media.music', adapterId: 'storyforge.avg.local-music.v1', bindingHash: wire.route.bindingHash,
      provider: 'storyforge-local-music', model: wire.capability.model }], configureSource: async source => {
      const sound = source.brief.avgSoundPlanning!
      sound.scope.librarySources = [avgSoundLibraryFixtureV1().source]
      sound.scope.templates.find(t => t.requirementKey === 'desk.bgm')!.cue.loop = true
      Object.assign(sound.musicBinding!, wire.route)
      source.brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.music')!.capabilityHash = wire.route.bindingHash
      source.brief.avgAudioProcessing = audioReadiness.avgAudioProcessingForSoundV1({ schema: 'storyforge.avg.audio-production-processing-plan', version: 1,
        entries: [{ domain: 'sound', requirementKey: 'desk.bgm', recipe: { schema: 'storyforge.avg.audio-processing-recipe', version: 1,
          gainMilliDb, maximumDurationMs: 12000, sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
          declaration: 'ENGINEERING explicit local gain from the exact original; independent observation and author choice remain required.' } }] }, sound)
      source.brief.productionBudget = avgSoundProductionBudgetV1(source.brief)
      source.brief.completionContract.requiredGateIds = avgSoundProductionGateIdsV1(source.brief)
    } })
  await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
  await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)
  await cycleAvgSoundUntilV1(s, 'avg.media.compiled-sound-requirements')
  await cycleAvgSoundUntilV1(s, 'avg.sound.processed.desk.bgm'); await cycleAvgSoundUntilV1(s, 'avg.sound.raw.desk.sfx')
  const raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!
  const processed = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.processed.desk.bgm'))!
  return { ...s, wire, raw, processed, target: { scope: s.scope, productionId: s.productionId, raw: ref(raw), processed: ref(processed) } }
}
type SoundFixture = Awaited<ReturnType<typeof startProcessedSound>>
async function confirm(s: SoundFixture, candidate: Parameters<typeof confirmAvgSoundCandidateV1>[1]) {
  expect((await confirmAvgSoundCandidateV1(s, candidate)).ok).toBe(true)
}
const posts = (s: SoundFixture) => s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').length

describe('AVG processed sound through actual governed author commands', () => {
  it('processes BGM once, independently adopts it beside original library SFX, freezes exact consumers and restores with capabilities closed', async () => {
    const s = await startProcessedSound(), originalPayload = s.raw.payloadJson
    const payload = await parseAvgProcessedAudioPayloadV1(s.processed.payloadJson)
    const source = await readMediaBlobObjectData({ scope: s.scope, blobObjectId: s.raw.blobObjectId! })
    const output = await readMediaBlobObjectData({ scope: s.scope, blobObjectId: s.processed.blobObjectId! })
    expect(new Uint8Array(source)).toEqual(new Uint8Array(s.wire.body))
    expect(new Uint8Array(output)).not.toEqual(new Uint8Array(source))
    await assertAvgAudioProcessingWaveBytesV1({ source, output, recipe: s.brief.avgAudioProcessing!.entries[0]!.recipe, receipt: payload.receipt })
    const sealed = await verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.buildId, ...ref(s.processed) })
    expect(sealed.producerRunId).toBeGreaterThan(0); expect(sealed.producerRunId).not.toBe(s.raw.producerRunId)
    expect(payload.raw.producerReceiptHash).toBe(s.raw.producerReceiptHash)
    const build = (await db.productBuilds.get(s.buildId))!, task = s.plan.tasks.find(t => t.kind === 'avg-audio-process')!
    expect(task.budgetReservation).toMatchObject({ modelCalls: 0, mediaCalls: 0, maximumCostUsd: 0 })
    const run = await readAgentRunV1(s.scope, sealed.producerRunId!)
    expect(run.projection.state).toBe('completed')
    expect(run.contract.runtimeBindingHash).toBe(await hashAvgTaskRuntimeBindingV1({ planHash: build.planHash, task, capabilityBindings: [] }))
    expect(JSON.parse(sealed.qualityJson)).toMatchObject({ noProviderRequest: true, hearing: 'unobserved', authorAdopted: false })
    expect(build.previewHash).toBe(''); expect(await db.productReleases.count()).toBe(0)
    const evidence = async () => JSON.stringify(await Promise.all([db.productBuilds.toArray(), db.productBuildArtifacts.toArray(),
      db.agentRuns.toArray(), db.agentRunEvents.toArray(), db.mediaBlobObjects.toArray()]))
    const beforeComparison = await evidence()
    const comparison = await readAvgRawSoundCandidateV1({ scope: s.scope, productionId: s.productionId, raw: ref(s.raw) })
    expect(comparison.asset.contentHash).toBe(s.raw.contentHash)
    expect(new Uint8Array(comparison.data)).toEqual(new Uint8Array(source))
    expect(comparison.sourceKey).toContain('original-comparison')
    expect(await evidence()).toBe(beforeComparison)
    await expect(readAvgRawSoundCandidateV1({ scope: s.scope, productionId: s.productionId,
      raw: { ...ref(s.raw), contentHash: 'f'.repeat(64) } })).rejects.toThrow()
    await expect(readAvgRawSoundCandidateV1({ scope: { ...s.scope, workId: s.scope.workId! + 1000 },
      productionId: s.productionId, raw: ref(s.raw) })).rejects.toThrow()
    expect(await evidence()).toBe(beforeComparison)
    await expect(readAvgSoundCandidateV1({ ...s.target, processed: undefined })).rejects.toThrow(/加工/)
    const selected = await readAvgSoundCandidateV1(s.target)
    expect(selected.asset.contentHash).toBe(s.processed.contentHash)
    expect(selected.measurement.contentHash).toBe(s.processed.contentHash)
    expect(selected.originalMeasurement.contentHash).toBe(s.raw.contentHash)
    expect(selected.payload.measurement.contentHash).toBe(s.raw.contentHash)
    expect(new Uint8Array(selected.data)).toEqual(new Uint8Array(output))
    const report = avgSoundAuthorReviewFixtureV3(selected.payload)
    await expect(stageAvgSoundReviewV1({ ...s.target, report, declaration })).rejects.toThrow(/准确声音/)
    await expect(stageAvgSoundChoiceV1({ ...s.target, declaration })).rejects.toThrow()
    report.soundEvidence.audioHash = selected.measurement.contentHash
    const review = await stageAvgSoundReviewV1({ ...s.target, report, declaration })
    expect(JSON.parse(review.metadataJson).inputs.map((r: { artifactKey: string }) => r.artifactKey)).toEqual([
      s.raw.artifactKey, 'avg.media.compiled-sound-requirements', s.processed.artifactKey,
    ])
    await confirm(s, review)
    const choice = await stageAvgSoundChoiceV1({ ...s.target, declaration }), choicePayload = JSON.parse(choice.payloadJson)
    expect(choicePayload).toMatchObject({ version: 2, raw: ref(s.raw), processed: ref(s.processed), asset: selected.asset })
    expect(() => parseAvgAuthorSoundChoiceV1(choicePayload)).toThrow()
    expect(JSON.parse(choice.metadataJson)).toMatchObject({ version: 11 })
    expect(JSON.parse(choice.metadataJson).inputs.map((r: { artifactKey: string }) => r.artifactKey)).toEqual([
      s.raw.artifactKey, review.artifactKey, 'avg.media.compiled-sound-requirements', s.processed.artifactKey,
    ])
    await confirm(s, choice)
    const sfx = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.sfx'))!, sfxTarget = { ...s.target, raw: ref(sfx), processed: undefined }
    const sfxSource = await readAvgSoundCandidateV1(sfxTarget)
    const sfxReview = await stageAvgSoundReviewV1({ ...sfxTarget, report: avgSoundAuthorReviewFixtureV3(sfxSource.payload), declaration })
    await confirm(s, sfxReview)
    const sfxChoice = await stageAvgSoundChoiceV1({ ...sfxTarget, declaration })
    expect(JSON.parse(sfxChoice.payloadJson)).toMatchObject({ version: 1, raw: ref(sfx) })
    expect(JSON.parse(sfxChoice.metadataJson).version).toBe(9); await confirm(s, sfxChoice)
    const before = await readAvgDraftV1(s.scope)
    const configured = await configureAvgChosenSoundDraftV1({ ...s, expectedDraftRevision: before.revision })
    const workspace = parseAvgAuthorWorkspaceV1(configured.editorJson)
    expect(workspace.presentation.stage.assets).toEqual(expect.arrayContaining([selected.asset, sfxSource.asset]))
    expect(workspace.presentation.stage.cues).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetKey: selected.asset.assetKey, loop: true, volume: .2 }),
      expect.objectContaining({ assetKey: sfxSource.asset.assetKey, loop: false, volume: .6 }),
    ]))
    await expect(configureAvgChosenSoundDraftV1({ ...s, expectedDraftRevision: before.revision })).rejects.toThrow(/草稿/)
    const stage = await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: configured.revision, artifactKey: 'avg.author.stage', declaration })
    await confirm(s, stage)
    const finished = await finishAvgSoundRuntimeFixtureV1(s), frozen = finished.build!, preview = await verifyStoredProductBuildPreview(frozen)
    expect(frozen.previewHash).toBeTruthy(); expect(frozen.rootTerminalReceiptHash).toBeTruthy()
    expect(preview!.mediaBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetKey: selected.asset.assetKey, blobContentHash: s.processed.contentHash }),
      expect.objectContaining({ assetKey: sfxSource.asset.assetKey, blobContentHash: sfx.contentHash }),
    ]))
    const readyDraft = await readAvgDraftV1(s.scope), baseline = parseAvgAuthorWorkspaceV1(readyDraft.editorJson)
    baseline.basePreviewHash = frozen.previewHash
    baseline.soundProduction = { schema: 'storyforge.avg.sound-production-draft', version: 1, scope: s.brief.avgSoundPlanning!.scope }
    const saved = await saveAvgAuthorWorkspaceV1(s.scope, readyDraft.revision, baseline)
    const kept = await keepAvgGeneratedSoundStageDraftV1({ ...s, expectedDraftRevision: saved.revision, expectedBuildId: s.buildId })
    const inherited = parseAvgAuthorWorkspaceV1(kept.editorJson)
    expect(inherited).not.toHaveProperty('soundProduction')
    expect(inherited.presentation.inheritedSounds).toHaveLength(2)
    const inheritedBgm = inherited.presentation.inheritedSounds!.find(e => e.assetKey === selected.asset.assetKey)!
    expect(inheritedBgm.source.version).toBe(2)
    if (inheritedBgm.source.version !== 2) throw new Error('Expected a distinct retained processed-sound source')
    expect(inheritedBgm.source.raw.contentHash).toBe(s.raw.contentHash)
    expect(inheritedBgm.source.raw.rightsHash).toBe(await hashProductProductionValueV2(JSON.parse(s.raw.rightsJson)))
    expect(inheritedBgm.source.processing).toMatchObject({ noProviderRequest: true, contentHash: s.processed.contentHash,
      producerReceiptHash: sealed.producerReceiptHash })
    expect(inheritedBgm.source.processing.proofHash).toMatch(/^[a-f0-9]{64}$/)
    const inheritedInput = { scope: s.scope, productionKey: finished.production.productionKey, targetBuildNumber: frozen.buildNumber + 1,
      worldContentHash: s.brief.source.worldContentHash, payload: inherited.presentation, scripts: inherited.scripts }
    const retained = await readAvgInheritedStageSoundsV1(inheritedInput)
    expect(retained.size).toBe(2)
    expect(retained.get(selected.asset.assetKey)).toEqual({ asset: selected.asset, blobObjectId: s.processed.blobObjectId })
    // Reuse this completed Preview: saving/cancelling a proposal cannot start
    // another Build, dispatch or silently substitute the previous processing.
    const dispatchState = async () => ({ builds: await db.productBuilds.toArray(), productions: await db.productProductions.toArray(),
      briefs: await db.productProductionBriefs.toArray(), runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.count(),
      artifacts: await db.productBuildArtifacts.count(), blobs: await db.mediaBlobObjects.count(), posts: posts(s), proposals: s.calls.length })
    const idle = await dispatchState(), originalPlan = (await acceptedAvgSoundArtifactV1(s, 'avg.media.sound-plan'))!
    const repairRecipe = { schema: 'storyforge.avg.audio-processing-recipe' as const, version: 1 as const, gainMilliDb: -3000,
      maximumDurationMs: 12000, sampleRatePolicy: 'preserve' as const, channelPolicy: 'preserve' as const, timelinePolicy: 'preserve' as const,
      overflowPolicy: 'reject' as const, declaration: 'ENGINEERING pending repair relative to the original WAV; no new request or adoption.' }
    const repairInput = { scope: s.scope, expectedDraftRevision: kept.revision, expectedBuildId: frozen.id!,
      expectedBuildRevision: frozen.stateRevision, expectedPreviewHash: frozen.previewHash, assetKey: selected.asset.assetKey, recipe: repairRecipe }
    const repairDraft = await saveAvgSoundLocalRepairDraftV1(repairInput), repairWorkspace = parseAvgAuthorWorkspaceV1(repairDraft.editorJson)
    const { soundLocalRepair: savedRepair, ...untouchedWorkspace } = repairWorkspace
    expect(untouchedWorkspace).toEqual(inherited)
    expect(repairWorkspace.presentation).toEqual(inherited.presentation)
    expect(savedRepair).toEqual({ schema: 'storyforge.avg.sound-local-repair', version: 1,
      source: inheritedBgm.source, sourceBuildRevision: frozen.stateRevision, sourceScope: s.brief.avgSoundPlanning!.scope,
      sourcePlan: JSON.parse(originalPlan.payloadJson), sourceAsset: selected.asset,
      parent: { productionKey: finished.production.productionKey, buildNumber: frozen.buildNumber, buildRevision: frozen.stateRevision,
        briefHash: frozen.briefHash, planHash: frozen.planHash, previewHash: frozen.previewHash, manifestHash: frozen.manifestHash },
      recipe: repairRecipe, declaration: repairRecipe.declaration })
    expect(repairWorkspace.soundLocalRepair!.sourceScope.templates).toHaveLength(2)
    expect(repairWorkspace.soundLocalRepair!.sourcePlan.entries).toHaveLength(2)
    expect(repairWorkspace.soundLocalRepair!.source.raw.contentHash).toBe(s.raw.contentHash)
    expect(repairWorkspace.soundLocalRepair!.sourceAsset.contentHash).toBe(s.processed.contentHash)
    expect(repairWorkspace).not.toHaveProperty('soundProduction'); expect(repairWorkspace).not.toHaveProperty('soundProcessing')
    await expect(saveAvgSoundLocalRepairDraftV1(repairInput)).rejects.toThrow(/草稿/)
    await expect(startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: frozen.briefHash })).rejects.toThrow(/返修要求与冻结方案不一致/)
    await expect(clearAvgSoundLocalRepairDraftV1({ scope: s.scope, expectedDraftRevision: kept.revision })).rejects.toThrow(/草稿/)
    expect(await readAvgDraftV1(s.scope)).toEqual(repairDraft)
    expect(await dispatchState()).toEqual(idle)
    const cleared = await clearAvgSoundLocalRepairDraftV1({ scope: s.scope, expectedDraftRevision: repairDraft.revision })
    expect(parseAvgAuthorWorkspaceV1(cleared.editorJson)).toEqual(inherited)
    expect(await dispatchState()).toEqual(idle)
    const badProof = structuredClone(inheritedInput), badSource = badProof.payload.inheritedSounds!.find(e => e.assetKey === selected.asset.assetKey)!.source
    if (badSource.version !== 2) throw new Error('Expected the actual processed source before tampering')
    badSource.processing.proofHash = '0'.repeat(64)
    await expect(readAvgInheritedStageSoundsV1(badProof)).rejects.toThrow()
    const badRights = structuredClone(inheritedInput)
    badRights.payload.inheritedSounds!.find(e => e.assetKey === selected.asset.assetKey)!.source.raw.rightsHash = '0'.repeat(64)
    await expect(readAvgInheritedStageSoundsV1(badRights)).rejects.toThrow()
    expect((await db.productBuildArtifacts.get(s.raw.id!))!.payloadJson).toBe(originalPayload)
    expect(posts(s)).toBe(1); expect(s.calls).toHaveLength(1)
    vi.mocked(soundReadiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    vi.mocked(audioReadiness.avgAudioProcessingExecutionReadyV1).mockReturnValue(false)
    useAIConfigStore.getState().setConfig({ ...config, apiKey: '' })
    const input = { scope: s.scope, buildId: s.buildId, expectedBuildRevision: frozen.stateRevision, controlEpoch: frozen.controlEpoch }
    const original = await verifyFrozenAvgAuthorInputsV1(input)
    expect(original.soundChoices!.find(c => c.payload.requirementKey === 'desk.bgm')!.payload).toEqual(choicePayload)
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const importedOwner = (await db.productBuilds.where('projectId').equals(projectId).first())!
    const scope = { projectId, workId: importedOwner.workId, worldId: importedOwner.worldId }
    await recoverImportedProductProductionProofsV1({ scope, productionId: importedOwner.productionId })
    const importedBuild = (await db.productBuilds.get(importedOwner.id!))!
    const importedInput = { scope, buildId: importedBuild.id!, expectedBuildRevision: importedBuild.stateRevision, controlEpoch: importedBuild.controlEpoch }
    const restored = await verifyFrozenAvgAuthorInputsV1(importedInput)
    const imported = restored.soundChoices!.find(c => c.payload.requirementKey === 'desk.bgm')!
    expect(imported.payload).toEqual(choicePayload)
    expect(imported.validation).toEqual(original.soundChoices!.find(c => c.payload.requirementKey === 'desk.bgm')!.validation)
    expect(imported.blobObjectId).not.toBe(s.processed.blobObjectId)
    expect(new Uint8Array(await readMediaBlobObjectData({ scope, blobObjectId: imported.blobObjectId }))).toEqual(new Uint8Array(output))
    const importedDraft = parseAvgAuthorWorkspaceV1((await readAvgDraftV1(scope)).editorJson)
    expect(importedDraft.presentation.inheritedSounds).toEqual(inherited.presentation.inheritedSounds)
    expect(importedDraft).not.toHaveProperty('soundProduction')
    // The public adopted-source reader remains read-only with capabilities
    // closed, including both independently remapped source2 Blob objects.
    const restoredSource = importedDraft.presentation.inheritedSounds!.find(entry => entry.assetKey === selected.asset.assetKey)!.source
    const restoredAdopted = await readAvgAdoptedGeneratedSoundV1({ scope, source: restoredSource })
    expect(restoredAdopted.source).toEqual(inheritedBgm.source)
    expect(restoredAdopted.asset).toEqual(selected.asset); expect(restoredAdopted.originalAsset.contentHash).toBe(s.raw.contentHash)
    expect(restoredAdopted.blobObjectId).toBe(imported.blobObjectId)
    expect(restoredAdopted.originalBlobObjectId).not.toBe(s.raw.blobObjectId)
    expect(restoredAdopted.raw.workId).toBe(scope.workId); expect(restoredAdopted.raw.workId).not.toBe(s.scope.workId)
    expect(new Uint8Array(restoredAdopted.originalData)).toEqual(new Uint8Array(source))
    expect(new Uint8Array(restoredAdopted.data)).toEqual(new Uint8Array(output))
    const importedInheritedInput = { ...inheritedInput, scope, payload: importedDraft.presentation, scripts: importedDraft.scripts }
    const importedRetained = await readAvgInheritedStageSoundsV1(importedInheritedInput)
    expect(importedRetained.size).toBe(2)
    expect(importedRetained.get(selected.asset.assetKey)).toEqual({ asset: selected.asset, blobObjectId: imported.blobObjectId })
    expect((await verifyStoredProductBuildPreview(importedBuild))!.packageHash).toBe(preview!.packageHash)
    const count = await db.productBuildArtifacts.count()
    await expect(stageAvgSoundChoiceV1({ ...s.target, scope, productionId: importedBuild.productionId, declaration })).rejects.toThrow(/尚未开放/)
    expect(await db.productBuildArtifacts.count()).toBe(count)
    const blob = (await db.mediaBlobObjects.get(imported.blobObjectId))!, bytes = new Uint8Array(blob.data!.slice(0))
    bytes[bytes.length - 1] ^= 1; await db.mediaBlobObjects.update(blob.id!, { data: bytes.buffer })
    await expect(verifyFrozenAvgAuthorInputsV1(importedInput)).rejects.toThrow()
    await expect(readAvgInheritedStageSoundsV1(importedInheritedInput)).rejects.toThrow()
    await db.mediaBlobObjects.put(blob); await deleteWork(scope.workId)
    expect(await db.productBuildArtifacts.where('workId').equals(scope.workId).count()).toBe(0)
    expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
    expect(canonicalProductProductionJsonV2(await db.productBuilds.get(s.buildId))).toBe(canonicalProductProductionJsonV2(frozen))
    expect(new Uint8Array(await readMediaBlobObjectData({ scope: s.scope, blobObjectId: s.processed.blobObjectId! }))).toEqual(new Uint8Array(output))
    expect(posts(s)).toBe(1); expect(s.calls).toHaveLength(1)
    // The full production/adoption/restore slice hit its hosted coverage deadline.
    // No per-operation, model or product performance budget changes.
  }, process.env.CI ? 180_000 : 90_000)

  it('requires the exact processed dependency even when zero gain preserves the original audio hash', async () => {
    const s = await startProcessedSound(0)
    expect(s.processed.contentHash).toBe(s.raw.contentHash)
    expect(s.processed.producerRunId).not.toBe(s.raw.producerRunId)
    const report = avgSoundAuthorReviewFixtureV3(JSON.parse(s.raw.payloadJson))
    await expect(readAvgSoundCandidateV1({ ...s.target, processed: undefined })).rejects.toThrow(/加工/)
    await expect(stageAvgSoundReviewV1({ ...s.target, processed: undefined, report, declaration })).rejects.toThrow(/加工/)
    const review = await stageAvgSoundReviewV1({ ...s.target, report, declaration })
    expect(JSON.parse(review.metadataJson).inputs).toContainEqual(ref(s.processed))
    await confirm(s, review)
    const adopted = (await acceptedAvgSoundArtifactV1(s, review.artifactKey))!, metadata = JSON.parse(adopted.metadataJson)
    // Remove only the derived dependency from an actual adopted review. No
    // producer, candidate hash or adoption receipt is fabricated/re-signed.
    metadata.candidate.inputs = metadata.candidate.inputs.filter((r: { artifactKey: string }) => r.artifactKey !== s.processed.artifactKey)
    await db.productBuildArtifacts.update(adopted.id!, { metadataJson: canonicalProductProductionJsonV2(metadata) })
    const count = await db.productBuildArtifacts.count()
    await expect(stageAvgSoundChoiceV1({ ...s.target, declaration })).rejects.toThrow()
    expect(await db.productBuildArtifacts.count()).toBe(count)
    await db.productBuildArtifacts.put(adopted)
    const choice = await stageAvgSoundChoiceV1({ ...s.target, declaration })
    expect(JSON.parse(choice.payloadJson)).toMatchObject({ version: 2, raw: ref(s.raw), processed: ref(s.processed) })
    await confirm(s, choice)
    expect(posts(s)).toBe(1); expect(s.calls).toHaveLength(1)
    expect((await db.productBuildArtifacts.get(s.raw.id!))!.payloadJson).toBe(s.raw.payloadJson)
  }, 60_000)
})
