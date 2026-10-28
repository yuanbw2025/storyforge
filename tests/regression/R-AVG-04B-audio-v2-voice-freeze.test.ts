import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as voiceGate from '../../src/lib/avg/assembly-contract'
import * as processingGate from '../../src/lib/avg/audio-production-brief'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'
import { createAvgDraftV1, selectAvgWorldV1, readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { saveAvgVoiceProductionDraftV1, saveAvgVoiceProcessingDraftV1 } from '../../src/lib/avg/voice-draft-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { prepareAvgAssemblyBriefV1, startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { configuredAvgVoiceEndpointHashV1 } from '../../src/lib/avg/voice-transport'
import { hashAvgSpeechProtocolV1 } from '../../src/lib/avg/voice-request-contract'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { parseAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { avgVoiceProductionBudgetV3 } from '../../src/lib/avg/voice-production-policy'
import type { AvgAudioProductionProcessingPlanV2 } from '../../src/lib/avg/audio-production-contract'

const config = { provider: 'agnes' as const, baseUrl: 'https://voice-freeze.fixture.invalid/v1', apiKey: 'fixture-only-no-account',
  model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 }
beforeEach(async () => {
  await db.delete(); await db.open(); useAIConfigStore.getState().setConfig(config)
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
  vi.spyOn(voiceGate, 'avgVoiceProductionEnabledV3').mockReturnValue(true)
  vi.spyOn(processingGate, 'avgAudioProcessingExecutionReadyV1').mockReturnValue(true)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Voice preparation/start may not dispatch speech or processing requests') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); db.close() })

/** Original voice draft fixture and real saves. No Build, provider response,
 * producer, audio or author adoption record is seeded. */
async function savedVoice(explicitRate = false) {
  const { assembly } = await avgVoiceAssemblyFixtureV3(), workspace = avgAuthorWorkspaceFixture()
  workspace.presentation.reading = { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait', voiceFailure: 'pause',
    maximumVoiceWaitMs: 60_000, autoDelayMs: 800, voices: [] }
  const { protocol, batch } = assembly.voice, requirement = batch.requirements[0]!, preset = batch.presets[0]!
  protocol.provider = 'agnes'
  protocol.endpointRouteHash = await configuredAvgVoiceEndpointHashV1({ baseUrl: config.baseUrl, model: protocol.model })
  Object.assign(preset, { provider: protocol.provider, endpointRouteHash: protocol.endpointRouteHash, capabilityHash: await hashAvgSpeechProtocolV1(protocol) })
  const owner = await createAvgDraftV1('明确V2配音加工要求'), world = await createMistHarborWorld()
  const selected = await selectAvgWorldV1(owner.scope, 0, world.worldReleaseId)
  const initial = await saveAvgAuthorWorkspaceV1(owner.scope, selected.revision, workspace)
  const voice = await saveAvgVoiceProductionDraftV1({ scope: owner.scope, expectedDraftRevision: initial.revision, protocol, presets: [preset],
    lines: [{ requirementKey: requirement.requirementKey, assetKey: requirement.assetKey, sceneKey: requirement.sceneKey,
      lineKey: requirement.lineKey, presetKey: requirement.presetKey, maximumDurationMs: requirement.maximumDurationMs, performance: requirement.performance }] })
  const plan: AvgAudioProductionProcessingPlanV2 = { schema: 'storyforge.avg.audio-production-processing-plan', version: 2,
    entries: [{ domain: 'voice', requirementKey: requirement.requirementKey, recipe: { schema: 'storyforge.avg.audio-processing-recipe', version: 2,
      gainMilliDb: -3000, maximumDurationMs: requirement.maximumDurationMs, sampleRatePolicy: explicitRate ? 'explicit' : 'preserve',
      targetSampleRateHz: explicitRate ? 48000 : null, channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
      resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1',
      dynamics: { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 },
      declaration: '明确保留原件后加工；保存和开始不证明实际音频、听感或作者采用。' } }] }
  const saved = await saveAvgVoiceProcessingDraftV1({ scope: owner.scope, expectedDraftRevision: voice.revision, plan })
  expect(parseAvgAuthorWorkspaceV1(saved.editorJson).voiceProcessing).toEqual(plan)
  expect(parseAvgAuthorWorkspaceV1(saved.editorJson).voiceProduction).toEqual(parseAvgAuthorWorkspaceV1(voice.editorJson).voiceProduction)
  expect(await db.productBuilds.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
  expect(await db.productBuildArtifacts.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)
  return { ...owner, saved, plan, key: requirement.requirementKey }
}

describe('AVG V2 voice draft actual prepare/start freezing', () => {
  it.each([false, true])('freezes V2 with explicit sampling %s into the authorized graph without extra provider calls', async explicitRate => {
    const s = await savedVoice(explicitRate)
    const prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: s.saved.revision })
    const brief = parseProductProductionBriefV3(prepared.brief!.briefJson), assembly = parseAvgStoredAssemblyBriefV3(brief.avgAssembly).assembly
    expect(brief.avgAudioProcessing).toEqual(s.plan)
    const base = avgVoiceProductionBudgetV3(assembly)
    expect(brief.productionBudget).toEqual(avgVoiceProductionBudgetV3(assembly, null, s.plan))
    expect(brief.productionBudget).toMatchObject({ maximumModelCalls: base.maximumModelCalls, maximumMediaCalls: base.maximumMediaCalls,
      maximumInputTokens: base.maximumInputTokens + 20_000, maximumDurationMs: base.maximumDurationMs + 90_000,
      maximumStorageBytes: base.maximumStorageBytes + 36 * 1024 * 1024 })
    const gate = `avg.audio.processed.voice.${s.key}`, raw = `avg.voice.raw.${s.key}`, output = `avg.voice.processed.${s.key}`
    expect(brief.completionContract.requiredGateIds).toContain(gate)
    const started = await startAvgAssemblyV1({ scope: s.scope, productionId: prepared.production.id!, expectedBriefHash: prepared.brief!.briefHash })
    expect(started.executionBrief!.avgAudioProcessing).toEqual(s.plan)
    const plan = parseProductProductionPlanV3(started.build!.planJson, started.executionBrief!, started.build!.briefHash)
    const process = plan.tasks.filter(t => t.kind === 'avg-audio-process')
    expect(process).toHaveLength(1)
    expect(process[0]).toMatchObject({ taskKey: `avg.voice.process.${s.key}`, inputArtifactKeys: expect.arrayContaining([raw]),
      outputArtifactKeys: [output], maxAttempts: 1, fallbackTaskKey: null, requirementKeys: [], capabilityRequirementKeys: [], acceptanceGateIds: [gate],
      budgetReservation: { modelCalls: 0, mediaCalls: 0, maximumCostUsd: 0, durationMs: 90_000, storageBytes: 36 * 1024 * 1024 } })
    for (const suffix of ['review', 'choice']) expect(plan.tasks.find(t => t.taskKey === `avg.author.voice-${suffix}.${s.key}`)!.inputArtifactKeys).toContain(output)
    expect(plan.tasks.filter(t => t.kind === 'avg-media-voice-generate')).toHaveLength(1)
    const current = await readAvgDraftV1(s.scope)
    await expect(saveAvgVoiceProcessingDraftV1({ scope: s.scope, expectedDraftRevision: current.revision, plan: null })).rejects.toThrow(/已开始/)
    expect(await db.productBuildArtifacts.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['change', 'clear'] as const)('refuses the old start after a saved V2 %s without silently starting a raw graph', async change => {
    const s = await savedVoice(true), prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: s.saved.revision })
    const changed = structuredClone(s.plan); changed.entries[0].recipe = { ...changed.entries[0].recipe, gainMilliDb: -6000 }
    const current = await readAvgDraftV1(s.scope)
    const latest = await saveAvgVoiceProcessingDraftV1({ scope: s.scope, expectedDraftRevision: current.revision, plan: change === 'clear' ? null : changed })
    await expect(startAvgAssemblyV1({ scope: s.scope, productionId: prepared.production.id!, expectedBriefHash: prepared.brief!.briefHash })).rejects.toThrow(/音量要求.*不一致/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(latest.editorJson)
    expect(await db.productBuilds.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
    expect(await db.productBuildArtifacts.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)
    if (change === 'clear') {
      const next = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: latest.revision })
      const brief = parseProductProductionBriefV3(next.brief!.briefJson)
      expect(brief).not.toHaveProperty('avgAudioProcessing')
      expect(brief.completionContract.requiredGateIds).not.toContain(`avg.audio.processed.voice.${s.key}`)
      expect(brief.productionBudget).toEqual(avgVoiceProductionBudgetV3(parseAvgStoredAssemblyBriefV3(brief.avgAssembly).assembly))
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains a saved V2 draft with the real gate closed and creates no raw fallback production', async () => {
    const s = await savedVoice(true)
    vi.mocked(processingGate.avgAudioProcessingExecutionReadyV1).mockReturnValue(false)
    await expect(prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: s.saved.revision })).rejects.toThrow(/音量加工尚未开放/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(s.saved.editorJson)
    expect(await db.productProductions.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})
