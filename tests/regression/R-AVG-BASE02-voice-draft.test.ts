import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as gates from '../../src/lib/avg/assembly-contract'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { assertAvgVoiceDraftV1, prepareAvgVoiceDraftV1, readAvgVoiceDraftV1, validateAvgVoiceDraftSourcesV1 } from '../../src/lib/avg/voice-draft-contract'
import { clearAvgVoiceProductionDraftV1, saveAvgVoiceProductionDraftV1, saveAvgVoiceProcessingDraftV1 } from '../../src/lib/avg/voice-draft-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { createAvgDraftV1, readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { prepareAvgAssemblyBriefV1, startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { configuredAvgVoiceEndpointHashV1 } from '../../src/lib/avg/voice-transport'
import { hashAvgSpeechProtocolV1 } from '../../src/lib/avg/voice-request-contract'
import * as processingGate from '../../src/lib/avg/audio-production-brief'
import type { AvgAudioProductionProcessingPlanV1 } from '../../src/lib/avg/audio-production-contract'
import { parseAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { avgVoiceProductionBudgetV3 } from '../../src/lib/avg/voice-production-policy'

const config = { provider: 'agnes' as const, baseUrl: 'https://speech.fixture.invalid/v1', apiKey: 'test-only-no-network',
  model: 'agnes-2.5-flash', temperature: 0.7, maxTokens: 0 }
beforeEach(async () => { await db.delete(); await db.open(); vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1'); vi.stubEnv('VITE_STORYFORGE_AVG_VOICE_PRODUCTION', ''); useAIConfigStore.getState().setConfig(config) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); db.close() })

async function inputFixture() {
  const { assembly } = await avgVoiceAssemblyFixtureV3(), workspace = avgAuthorWorkspaceFixture()
  workspace.presentation.reading = { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait', voiceFailure: 'pause',
    maximumVoiceWaitMs: 60000, autoDelayMs: 800, voices: [] }
  const { protocol, batch } = assembly.voice
  protocol.provider = 'agnes'; protocol.endpointRouteHash = await configuredAvgVoiceEndpointHashV1({ baseUrl: config.baseUrl, model: protocol.model })
  const preset = batch.presets[0]!
  Object.assign(preset, { provider: protocol.provider, endpointRouteHash: protocol.endpointRouteHash, capabilityHash: await hashAvgSpeechProtocolV1(protocol) })
  preset.rights.declaration = '仅工程声明，保留 e\u0301 的准确写法；不是商用许可或账号证据。'
  const requirement = batch.requirements[0]!
  return { workspace, protocol, presets: [preset], lines: [{ requirementKey: requirement.requirementKey, assetKey: requirement.assetKey,
    sceneKey: requirement.sceneKey, lineKey: requirement.lineKey, presetKey: requirement.presetKey,
    maximumDurationMs: requirement.maximumDurationMs, performance: requirement.performance }] }
}

function processing(requirementKey: string, gainMilliDb = -4200): AvgAudioProductionProcessingPlanV1 {
  return { schema: 'storyforge.avg.audio-production-processing-plan', version: 1, entries: [{ domain: 'voice', requirementKey,
    recipe: { schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb, maximumDurationMs: 120_000,
      sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
      declaration: '明确调整本句音量，原音频保留并另行试听采用。' } }] }
}

describe('AVG voice exact editable batch and actual prepare/start boundary', () => {
  it('keeps old workspace bytes and rejects orphaned, cross-domain and insufficient-duration local processing drafts', async () => {
    const input = await inputFixture(), packet = await prepareAvgVoiceDraftV1(input), old = { ...input.workspace, voiceProduction: packet }
    const encoded = canonicalProductProductionJsonV2(old)
    expect(canonicalProductProductionJsonV2(parseAvgAuthorWorkspaceV1(encoded))).toBe(encoded)
    expect(parseAvgAuthorWorkspaceV1(encoded)).not.toHaveProperty('voiceProcessing')
    const plan = processing(input.lines[0].requirementKey), next = { ...old, voiceProcessing: plan }
    expect(parseAvgAuthorWorkspaceV1(canonicalProductProductionJsonV2(next)).voiceProcessing).toEqual(plan)
    expect(() => parseAvgAuthorWorkspaceV1({ ...input.workspace, voiceProcessing: plan })).toThrow(/缺少/)
    for (const invalid of ['foreign', 'sound', 'duration', 'empty'] as const) {
      const changed = structuredClone(plan)
      if (invalid === 'foreign') changed.entries[0].requirementKey = 'foreign'
      if (invalid === 'sound') changed.entries[0].domain = 'sound'
      if (invalid === 'duration') changed.entries[0].recipe.maximumDurationMs = input.lines[0].maximumDurationMs - 1
      if (invalid === 'empty') changed.entries = []
      expect(() => parseAvgAuthorWorkspaceV1({ ...old, voiceProcessing: changed })).toThrow()
    }
    expect(() => parseAvgAuthorWorkspaceV1({ ...old, voiceProcessing: null })).toThrow()
  })

  it('saves and clears local requirements with real draft CAS, preserves exact voice and refuses orphaning them during voice edits', async () => {
    const input = await inputFixture(), owner = await createAvgDraftV1('逐句音量要求')
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local draft saving must not contact providers') }))
    const initial = await saveAvgAuthorWorkspaceV1(owner.scope, 0, input.workspace)
    const voice = await saveAvgVoiceProductionDraftV1({ ...input, scope: owner.scope, expectedDraftRevision: initial.revision })
    const packet = parseAvgAuthorWorkspaceV1(voice.editorJson).voiceProduction
    const plan = processing(input.lines[0].requirementKey)
    const saved = await saveAvgVoiceProcessingDraftV1({ scope: owner.scope, expectedDraftRevision: voice.revision, plan })
    expect(parseAvgAuthorWorkspaceV1(saved.editorJson)).toMatchObject({ voiceProduction: packet, voiceProcessing: plan })
    expect((await saveAvgVoiceProcessingDraftV1({ scope: owner.scope, expectedDraftRevision: saved.revision, plan })).revision).toBe(saved.revision)
    await expect(saveAvgVoiceProcessingDraftV1({ scope: owner.scope, expectedDraftRevision: voice.revision, plan: null })).rejects.toThrow(/变化/)
    const changed = structuredClone(input); changed.lines[0].requirementKey = 'replacement.voice'
    await expect(saveAvgVoiceProductionDraftV1({ ...changed, scope: owner.scope, expectedDraftRevision: saved.revision })).rejects.toThrow(/缺失/)
    expect((await readAvgDraftV1(owner.scope)).editorJson).toBe(saved.editorJson)
    const cleared = await saveAvgVoiceProcessingDraftV1({ scope: owner.scope, expectedDraftRevision: saved.revision, plan: null })
    expect(parseAvgAuthorWorkspaceV1(cleared.editorJson).voiceProduction).toEqual(packet)
    expect(parseAvgAuthorWorkspaceV1(cleared.editorJson)).not.toHaveProperty('voiceProcessing')
    const restored = await saveAvgVoiceProcessingDraftV1({ scope: owner.scope, expectedDraftRevision: cleared.revision, plan })
    const removed = await clearAvgVoiceProductionDraftV1({ scope: owner.scope, expectedDraftRevision: restored.revision })
    expect(parseAvgAuthorWorkspaceV1(removed.editorJson)).not.toHaveProperty('voiceProduction')
    expect(parseAvgAuthorWorkspaceV1(removed.editorJson)).not.toHaveProperty('voiceProcessing')
    expect(await db.productBuilds.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
    expect(await db.productBuildArtifacts.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('freezes saved local requirements into the actual Brief/Plan and refuses editing after explicit start', async () => {
    vi.spyOn(gates, 'avgVoiceProductionEnabledV3').mockReturnValue(true)
    vi.spyOn(processingGate, 'avgAudioProcessingExecutionReadyV1').mockReturnValue(true)
    const input = await inputFixture(); input.workspace.voiceProduction = await prepareAvgVoiceDraftV1(input)
    input.workspace.voiceProcessing = processing(input.lines[0].requirementKey)
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Preparation/start must not deliver audio') }))
    const owner = await prepareNativeAvgAssembly(input.workspace), brief = parseProductProductionBriefV3(owner.details.brief!.briefJson)
    const assembly = parseAvgStoredAssemblyBriefV3(brief.avgAssembly).assembly
    expect(brief.avgAudioProcessing).toEqual(input.workspace.voiceProcessing)
    expect(brief.productionBudget).toEqual(avgVoiceProductionBudgetV3(assembly, null, input.workspace.voiceProcessing))
    expect(brief.completionContract.requiredGateIds).toContain(`avg.audio.processed.voice.${input.lines[0].requirementKey}`)
    const started = await startAvgAssemblyV1({ ...owner, expectedBriefHash: owner.details.brief!.briefHash })
    const plan = JSON.parse(started.build!.planJson)
    expect(plan.tasks.filter((t: { kind: string }) => t.kind === 'avg-audio-process')).toHaveLength(1)
    const draft = await readAvgDraftV1(owner.scope)
    await expect(saveAvgVoiceProcessingDraftV1({ scope: owner.scope, expectedDraftRevision: draft.revision, plan: null })).rejects.toThrow(/已开始/)
    expect((await readAvgDraftV1(owner.scope)).editorJson).toBe(draft.editorJson)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects starting a stale saved gain and removes prior processing from a newly prepared raw-only Brief', async () => {
    vi.spyOn(gates, 'avgVoiceProductionEnabledV3').mockReturnValue(true)
    vi.spyOn(processingGate, 'avgAudioProcessingExecutionReadyV1').mockReturnValue(true)
    const input = await inputFixture(); input.workspace.voiceProduction = await prepareAvgVoiceDraftV1(input)
    input.workspace.voiceProcessing = processing(input.lines[0].requirementKey)
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Stale preparation must not call a provider') }))
    const owner = await prepareNativeAvgAssembly(input.workspace), draft = await readAvgDraftV1(owner.scope)
    const changed = await saveAvgVoiceProcessingDraftV1({ scope: owner.scope, expectedDraftRevision: draft.revision,
      plan: processing(input.lines[0].requirementKey, -6000) })
    await expect(startAvgAssemblyV1({ ...owner, expectedBriefHash: owner.details.brief!.briefHash })).rejects.toThrow(/音量要求.*不一致/)
    expect(await db.productBuilds.count()).toBe(0)
    const cleared = await saveAvgVoiceProcessingDraftV1({ scope: owner.scope, expectedDraftRevision: changed.revision, plan: null })
    const next = await prepareAvgAssemblyBriefV1({ scope: owner.scope, expectedDraftRevision: cleared.revision })
    const brief = parseProductProductionBriefV3(next.brief!.briefJson)
    expect(brief).not.toHaveProperty('avgAudioProcessing')
    expect(brief.productionBudget).toEqual(avgVoiceProductionBudgetV3(parseAvgStoredAssemblyBriefV3(brief.avgAssembly).assembly))
    expect(fetch).not.toHaveBeenCalled()
  })
  it('derives exact words, speaker and first planned script revision from saved sources; old workspace bytes stay compatible', async () => {
    const input = await inputFixture(), old = canonicalProductProductionJsonV2(input.workspace)
    expect(canonicalProductProductionJsonV2(parseAvgAuthorWorkspaceV1(old))).toBe(old)
    expect(parseAvgAuthorWorkspaceV1(old)).not.toHaveProperty('voiceProduction')
    const packet = await prepareAvgVoiceDraftV1(input), roundtrip = parseAvgAuthorWorkspaceV1(canonicalProductProductionJsonV2({ ...input.workspace, voiceProduction: packet }))
    expect(roundtrip.voiceProduction).toEqual(packet)
    const { voice } = await assertAvgVoiceDraftV1(roundtrip.voiceProduction), r = voice.batch.requirements[0]!
    expect(r.text).toBe(input.workspace.scripts.find(s => s.sceneKey === r.sceneKey)!.lines.find(l => l.lineKey === r.lineKey)!.text)
    expect(r.script.version).toBe(1); expect(r.textRevision).toBe(1); expect(r.presetRevision).toBe(input.presets[0]!.revision)
    expect(voice.batch.presets[0]!.rights.declaration).toContain('e\u0301')
  })

  it('invalidates a draft when exact words, speaker or canonical rules change; presentation changes do not alter source identity', async () => {
    const input = await inputFixture(), packet = await prepareAvgVoiceDraftV1(input)
    for (const mutate of [
      (w: typeof input.workspace) => { w.scripts[0]!.lines[0]!.text += ' 修订' },
      (w: typeof input.workspace) => { w.scripts[0]!.lines[0]!.speakerKey = null },
      (w: typeof input.workspace) => { w.systemPlan.title += ' 新版' },
    ]) {
      const workspace = structuredClone(input.workspace); mutate(workspace)
      await expect(validateAvgVoiceDraftSourcesV1(packet, workspace)).rejects.toThrow()
    }
    const view = structuredClone(input.workspace); view.presentation.reading!.autoDelayMs += 100
    await expect(validateAvgVoiceDraftSourcesV1(packet, view)).resolves.toBeDefined()
  })

  it('refuses missing lines, duplicate consumers, oversized batches, unsupported options and an insufficient reading wait', async () => {
    const base = await inputFixture()
    for (const mutate of [
      (i: typeof base) => { i.lines[0]!.lineKey = 'missing' },
      (i: typeof base) => { i.lines.push(structuredClone(i.lines[0]!)) },
      (i: typeof base) => { i.lines = Array.from({ length: 9 }, () => structuredClone(i.lines[0]!)) },
      (i: typeof base) => { i.lines[0]!.performance.instructions = '不支持的演法参数' },
      (i: typeof base) => { i.workspace.presentation.reading!.maximumVoiceWaitMs = i.lines[0]!.maximumDurationMs },
      (i: typeof base) => { delete i.workspace.presentation.reading },
    ]) { const input = structuredClone(base); mutate(input); await expect(prepareAvgVoiceDraftV1(input)).rejects.toThrow() }
  })

  it('rejects a changed packet hash even when the inert structural reader can still decode it', async () => {
    const packet = await prepareAvgVoiceDraftV1(await inputFixture()); packet.contentHash = '0'.repeat(64)
    expect(readAvgVoiceDraftV1(packet).voice.batch.requirements).toHaveLength(1)
    await expect(assertAvgVoiceDraftV1(packet)).rejects.toThrow(/hash/)
  })

  it('saves/clears through the real Work draft CAS without any call, candidate, Build or Blob', async () => {
    const input = await inputFixture(), owner = await createAvgDraftV1('配音批次工程验证')
    const fetcher = vi.fn(() => { throw new Error('Draft save must not contact a provider') }); vi.stubGlobal('fetch', fetcher)
    const initial = await saveAvgAuthorWorkspaceV1(owner.scope, 0, input.workspace)
    const saved = await saveAvgVoiceProductionDraftV1({ ...input, scope: owner.scope, expectedDraftRevision: initial.revision })
    expect(parseAvgAuthorWorkspaceV1(saved.editorJson).voiceProduction).toBeDefined()
    await expect(saveAvgVoiceProductionDraftV1({ ...input, scope: owner.scope, expectedDraftRevision: initial.revision })).rejects.toThrow(/变化/)
    expect((await saveAvgVoiceProductionDraftV1({ ...input, scope: owner.scope, expectedDraftRevision: saved.revision })).revision).toBe(saved.revision)
    const cleared = await clearAvgVoiceProductionDraftV1({ scope: owner.scope, expectedDraftRevision: saved.revision })
    expect(parseAvgAuthorWorkspaceV1(cleared.editorJson)).not.toHaveProperty('voiceProduction')
    expect(await db.productBuilds.count()).toBe(0); expect(await db.productBuildArtifacts.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps the default gate closed before creating a new production or silently falling back to zero-call assembly', async () => {
    const input = await inputFixture(); input.workspace.voiceProduction = await prepareAvgVoiceDraftV1(input)
    const owner = await createAvgDraftV1('关闭配音准入')
    const draft = await saveAvgAuthorWorkspaceV1(owner.scope, 0, input.workspace)
    await expect(prepareAvgAssemblyBriefV1({ scope: owner.scope, expectedDraftRevision: draft.revision })).rejects.toThrow(/尚未开放/)
    expect(await db.productProductions.count()).toBe(0)
  })

  it('uses actual public preparation/start/SourcePlan/Root and waits for author inputs with zero provider requests', async () => {
    vi.spyOn(gates, 'avgVoiceProductionEnabledV3').mockReturnValue(true)
    const input = await inputFixture(); input.workspace.voiceProduction = await prepareAvgVoiceDraftV1(input)
    const fetcher = vi.fn(() => { throw new Error('Start must wait for adopted sources') }); vi.stubGlobal('fetch', fetcher)
    const owner = await prepareNativeAvgAssembly(input.workspace), brief = parseProductProductionBriefV3(owner.details.brief!.briefJson)
    expect(brief.avgAssembly?.version).toBe(3); expect(brief.media.voiceLineCount).toBe(1)
    const started = await startAvgAssemblyV1({ ...owner, expectedBriefHash: owner.details.brief!.briefHash })
    expect(started.build!.planRevision).toBe(1)
    const rootRunId = JSON.parse(started.build!.budgetLedgerJson).rootRunId
    expect(rootRunId).toBeGreaterThan(0)
    expect((await db.agentRuns.get(rootRunId))!.productBuildId).toBe(started.build!.id)
    const plan = JSON.parse(started.build!.planJson)
    expect(plan.tasks.filter((t: { kind: string }) => t.kind === 'avg-media-voice-generate')).toHaveLength(1)
    expect(fetcher).not.toHaveBeenCalled()
    await expect(clearAvgVoiceProductionDraftV1({ scope: owner.scope, expectedDraftRevision: (await readAvgDraftV1(owner.scope)).revision })).rejects.toThrow(/已开始/)
  })
})
