import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as processingGate from '../../src/lib/avg/audio-production-brief'
import * as soundGate from '../../src/lib/avg/sound-production-brief'
import * as transport from '../../src/lib/avg/sound-transport'
import * as sourceReader from '../../src/lib/avg/sound-source'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { avgSoundCapabilityFixtureV1 } from '../helpers/avg-sound-provider-fixture'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { saveAvgSoundProductionDraftV1, saveAvgSoundProcessingDraftV1, clearAvgSoundProductionDraftV1 } from '../../src/lib/avg/sound-draft-service'
import { assertAvgSoundProcessingDraftV1 } from '../../src/lib/avg/sound-processing-draft-contract'
import { avgLocalMusicRouteV1, AVG_LOCAL_MUSIC_ADAPTER_V1 } from '../../src/lib/avg/sound-provider-contract'
import { AVG_SOUND_MUSIC_CAPABILITY_V1 } from '../../src/lib/avg/sound-production-brief'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { prepareAvgAssemblyBriefV1, startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { avgSoundProductionBudgetV1 } from '../../src/lib/avg/sound-production-policy'
import type { AvgAudioProductionProcessingPlanV1 } from '../../src/lib/avg/audio-production-contract'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-draft.fixture.invalid/v1',
    apiKey: 'test-only-no-network', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(soundGate, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  vi.spyOn(processingGate, 'avgAudioProcessingExecutionReadyV1').mockReturnValue(false)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Saved sound requirements and start must not contact providers') }))
  // Only capability observation is controlled; actual draft, Brief, Plan,
  // authorization commands, CAS and ownership remain on their real paths.
  const capability = avgSoundCapabilityFixtureV1(), route = await avgLocalMusicRouteV1(capability)
  vi.spyOn(transport, 'resolveAvgLocalMusicCapabilityV1').mockResolvedValue({ capability, ...route,
    binding: { requirementKey: AVG_SOUND_MUSIC_CAPABILITY_V1, adapterId: AVG_LOCAL_MUSIC_ADAPTER_V1,
      bindingHash: route.bindingHash, provider: 'storyforge-local-music', model: capability.model } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

function processing(requirementKey = 'desk.bgm', gainMilliDb = -4200): AvgAudioProductionProcessingPlanV1 {
  return { schema: 'storyforge.avg.audio-production-processing-plan', version: 1,
    entries: [{ domain: 'sound', requirementKey, recipe: { schema: 'storyforge.avg.audio-processing-recipe', version: 1,
      gainMilliDb, maximumDurationMs: 12_000, sampleRatePolicy: 'preserve', channelPolicy: 'preserve',
      timelinePolicy: 'preserve', overflowPolicy: 'reject', declaration: '保留原音乐；明确本地调整后另行审听采用。' } }] }
}
async function savedSound() {
  const source = await avgSoundPlanningFixtureV1(), owner = await prepareNativeAvgAssembly(source.workspace)
  const { sourceInputHash: _hash, ...planning } = source.scope
  planning.templates = planning.templates.filter(t => t.source.kind === 'generate-music'); planning.librarySources = []
  const draft = await readAvgDraftV1(owner.scope)
  const saved = await saveAvgSoundProductionDraftV1({ scope: owner.scope, expectedDraftRevision: draft.revision, planning })
  return { ...owner, source, planning, saved }
}
async function saveProcessing(s: Awaited<ReturnType<typeof savedSound>>, plan = processing()) {
  return saveAvgSoundProcessingDraftV1({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision, plan })
}

describe('AVG saved sound processing requirements through actual freeze and start', () => {
  it('preserves absent old bytes and strictly rejects orphaned, cross-domain, unknown, empty and insufficient-duration plans', async () => {
    const s = await savedSound(), old = parseAvgAuthorWorkspaceV1(s.saved.editorJson), encoded = canonicalProductProductionJsonV2(old)
    expect(canonicalProductProductionJsonV2(parseAvgAuthorWorkspaceV1(encoded))).toBe(encoded)
    expect(old).not.toHaveProperty('soundProcessing')
    expect(parseAvgAuthorWorkspaceV1({ ...old, soundProcessing: processing() }).soundProcessing).toEqual(processing())
    const orphan = structuredClone(old); delete orphan.soundProduction
    expect(() => parseAvgAuthorWorkspaceV1({ ...orphan, soundProcessing: processing() })).toThrow(/缺少/)
    for (const mode of ['voice', 'foreign', 'duration', 'empty', 'duplicate'] as const) {
      const plan = processing()
      if (mode === 'voice') plan.entries[0].domain = 'voice'
      if (mode === 'foreign') plan.entries[0].requirementKey = 'foreign.sound'
      if (mode === 'duration') plan.entries[0].recipe.maximumDurationMs = 11_999
      if (mode === 'empty') plan.entries = []
      if (mode === 'duplicate') plan.entries.push(structuredClone(plan.entries[0]))
      expect(() => parseAvgAuthorWorkspaceV1({ ...old, soundProcessing: plan })).toThrow()
    }
    expect(() => parseAvgAuthorWorkspaceV1({ ...old, soundProcessing: null })).toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains OGG on the original path and refuses OGG or mixed allowed-source targets while accepting explicit WAV sound metadata', async () => {
    const s = await avgSoundPlanningFixtureV1(), plan = processing('desk.sfx')
    expect(() => assertAvgSoundProcessingDraftV1(plan, s.scope)).toThrow(/OGG/)
    // Pure target metadata only, never a library/producer/rights proof.
    const wave = structuredClone(s.scope); wave.librarySources[0].memberPath = 'Audio/click_001.wav'
    expect(assertAvgSoundProcessingDraftV1(plan, wave)).toEqual(plan)
    const ambience = structuredClone(wave), template = ambience.templates.find(t => t.requirementKey === 'desk.sfx')!
    template.channel = 'ambience'; template.consumer.slot = 'ambience'
    expect(assertAvgSoundProcessingDraftV1(plan, ambience)).toEqual(plan)
    const mixed = structuredClone(wave), source = { ...s.scope.librarySources[0], sourceKey: 'fixture.ogg' }
    mixed.librarySources.push(source)
    const effect = mixed.templates.find(t => t.requirementKey === 'desk.sfx')!
    if (effect.source.kind !== 'licensed-library') throw new Error('Expected licensed fixture')
    effect.source.allowedSourceKeys.push(source.sourceKey)
    expect(() => assertAvgSoundProcessingDraftV1(plan, mixed)).toThrow(/OGG/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('saves with real CAS while processing is closed, rejects incompatible sound edits, and clears sound plus processing together', async () => {
    const s = await savedSound(), saved = await saveProcessing(s), workspace = parseAvgAuthorWorkspaceV1(saved.editorJson)
    expect(workspace.soundProcessing).toEqual(processing())
    expect((await saveAvgSoundProcessingDraftV1({ scope: s.scope, expectedDraftRevision: saved.revision, plan: processing() })).revision).toBe(saved.revision)
    await expect(saveAvgSoundProcessingDraftV1({ scope: s.scope, expectedDraftRevision: s.saved.revision, plan: null })).rejects.toThrow(/变化/)
    const changed = structuredClone(s.planning); changed.templates[0].requirementKey = 'replacement.sound'
    await expect(saveAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: saved.revision, planning: changed })).rejects.toThrow(/缺失/)
    const longer = structuredClone(s.planning)
    if (longer.templates[0].source.kind !== 'generate-music') throw new Error('Expected music fixture')
    longer.templates[0].source.durationSeconds = 13
    await expect(saveAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: saved.revision, planning: longer })).rejects.toThrow(/时长上限/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(saved.editorJson)
    const removed = await clearAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: saved.revision })
    expect(parseAvgAuthorWorkspaceV1(removed.editorJson)).not.toHaveProperty('soundProduction')
    expect(parseAvgAuthorWorkspaceV1(removed.editorJson)).not.toHaveProperty('soundProcessing')
    expect(await db.productBuilds.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
    expect(await db.mediaBlobObjects.count()).toBe(0); expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves a newer actual draft when it changes during source verification instead of committing a late processing save', async () => {
    const s = await savedSound(), originalRead = sourceReader.validateAvgSoundPlanningSourcesV1
    let kept = ''
    vi.spyOn(sourceReader, 'validateAvgSoundPlanningSourcesV1').mockImplementationOnce(async (value, workspace) => {
      const source = await originalRead(value, workspace), draft = await readAvgDraftV1(s.scope)
      const newer = parseAvgAuthorWorkspaceV1(draft.editorJson); newer.scripts[0].lines[0].text += '作者并发编辑'
      kept = (await saveAvgAuthorWorkspaceV1(s.scope, draft.revision, newer)).editorJson
      return source
    })
    await expect(saveProcessing(s)).rejects.toThrow(/保存音量要求期间草稿已变化/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(kept)
    expect(parseAvgAuthorWorkspaceV1(kept)).not.toHaveProperty('soundProcessing')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves consumed Stage audio and refuses changing or clearing its processing requirements', async () => {
    const s = await savedSound(), saved = await saveProcessing(s), workspace = parseAvgAuthorWorkspaceV1(saved.editorJson)
    workspace.presentation.stage.assets.push(structuredClone(s.source.choices[0].asset))
    const used = await saveAvgAuthorWorkspaceV1(s.scope, saved.revision, workspace)
    await expect(saveAvgSoundProcessingDraftV1({ scope: s.scope, expectedDraftRevision: used.revision, plan: null })).rejects.toThrow(/已进入演出/)
    await expect(clearAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: used.revision })).rejects.toThrow(/已进入演出/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(used.editorJson); expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps saved processing when the factory is closed and refuses preparation before any route or service observation', async () => {
    const s = await savedSound(), saved = await saveProcessing(s)
    vi.mocked(transport.resolveAvgLocalMusicCapabilityV1).mockClear()
    await expect(prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })).rejects.toThrow(/音量加工尚未开放/)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(saved.editorJson)
    expect(transport.resolveAvgLocalMusicCapabilityV1).not.toHaveBeenCalled()
    expect(await db.productBuilds.count()).toBe(0); expect(fetch).not.toHaveBeenCalled()
  })

  it('freezes the exact plan with its zero-provider budget and independent gates, starts the actual graph, then refuses editing', async () => {
    vi.mocked(processingGate.avgAudioProcessingExecutionReadyV1).mockReturnValue(true)
    const s = await savedSound(), saved = await saveProcessing(s)
    const details = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
    const brief = parseProductProductionBriefV3(details.brief!.briefJson)
    expect(brief.avgAudioProcessing).toEqual(processing())
    expect(brief.productionBudget).toEqual(avgSoundProductionBudgetV1(brief))
    expect(brief.completionContract.requiredGateIds).toContain('avg.audio.processed.sound.desk.bgm')
    const { avgAudioProcessing: _processing, ...raw } = brief
    expect(brief.productionBudget.maximumMediaCalls).toBe(avgSoundProductionBudgetV1(raw).maximumMediaCalls)
    expect(brief.productionBudget.maximumModelCalls).toBe(avgSoundProductionBudgetV1(raw).maximumModelCalls)
    const started = await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: details.brief!.briefHash })
    const plan = parseProductProductionPlanV3(started.build!.planJson, started.executionBrief!, started.build!.briefHash)
    expect(plan.tasks.filter(t => t.kind === 'avg-audio-process')).toHaveLength(1)
    expect(plan.tasks.find(t => t.taskKey === 'avg.author.sound-review.desk.bgm')!.inputArtifactKeys).toContain('avg.sound.processed.desk.bgm')
    const current = await readAvgDraftV1(s.scope)
    await expect(saveAvgSoundProcessingDraftV1({ scope: s.scope, expectedDraftRevision: current.revision, plan: null })).rejects.toThrow(/已开始/)
    expect(fetch).not.toHaveBeenCalled()
  }, 90_000)

  it.each(['add', 'change', 'clear'] as const)('refuses a %s processing-plan mismatch before actual start without falling back to raw', async change => {
    vi.mocked(processingGate.avgAudioProcessingExecutionReadyV1).mockReturnValue(true)
    const s = await savedSound()
    if (change !== 'add') await saveProcessing(s)
    const prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const current = await readAvgDraftV1(s.scope)
    await saveAvgSoundProcessingDraftV1({ scope: s.scope, expectedDraftRevision: current.revision,
      plan: change === 'clear' ? null : processing('desk.bgm', -6000) })
    vi.mocked(transport.resolveAvgLocalMusicCapabilityV1).mockClear()
    await expect(startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: prepared.brief!.briefHash })).rejects.toThrow(/音量要求.*不一致/)
    expect(transport.resolveAvgLocalMusicCapabilityV1).not.toHaveBeenCalled()
    expect(await db.productBuilds.count()).toBe(0); expect(fetch).not.toHaveBeenCalled()
  }, 90_000)

  it('removes processing from an explicitly re-prepared raw plan after clearing it, leaving the earlier Brief unchanged', async () => {
    vi.mocked(processingGate.avgAudioProcessingExecutionReadyV1).mockReturnValue(true)
    const s = await savedSound(), saved = await saveProcessing(s)
    const prior = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
    const cleared = await saveAvgSoundProcessingDraftV1({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision, plan: null })
    const next = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: cleared.revision })
    const brief = parseProductProductionBriefV3(next.brief!.briefJson)
    expect(brief).not.toHaveProperty('avgAudioProcessing')
    expect(brief.productionBudget).toEqual(avgSoundProductionBudgetV1(brief))
    expect(brief.completionContract.requiredGateIds).not.toContain('avg.audio.processed.sound.desk.bgm')
    expect((await db.productProductionBriefs.get(prior.brief!.id!))!.briefJson).toBe(prior.brief!.briefJson)
    expect(fetch).not.toHaveBeenCalled()
  }, 90_000)
})
