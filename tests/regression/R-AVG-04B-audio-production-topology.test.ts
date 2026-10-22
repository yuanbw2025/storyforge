import { describe, expect, it } from 'vitest'
import { proposeAvgAudioProcessingTopologyV1 } from '../../src/lib/avg/audio-production-topology'
import { buildAvgVoiceAssemblyPlanV3 } from '../../src/lib/avg/voice-assembly-plan'
import { buildAvgSoundProductionPlanV1 } from '../../src/lib/avg/sound-production-plan'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import type { AvgAudioProductionProcessingPlanV1 } from '../../src/lib/avg/audio-production-contract'
import { avgAudioProcessingExecutionReadyV1 } from '../../src/lib/avg/audio-production-brief'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

async function fixture(domain: 'voice' | 'sound') {
  const v = await avgVoiceAssemblyFixtureV3()
  let sourcePlan, key: string
  if (domain === 'voice') {
    sourcePlan = buildAvgVoiceAssemblyPlanV3({ brief: { avgAssembly: v.assembly, capabilityRequirements: v.capabilities },
      briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 })
    key = v.assembly.voice.batch.requirements[0].requirementKey
  } else {
    const s = await avgSoundPlanningFixtureV1(), a = v.assembly
    sourcePlan = buildAvgSoundProductionPlanV1({ brief: { avgSoundPlanning: { schema: 'storyforge.avg.sound-planning-brief', version: 1,
      assembly: { schema: a.schema, version: 1, title: a.title, sceneKeys: a.sceneKeys,
        mediaAssetKeys: s.scope.templates.map(t => t.assetKey), basePackageHash: a.basePackageHash },
      aspectRatio: '16:9', scope: s.scope, musicBinding: { adapterId: 'storyforge.avg.local-music.v1',
        requirementKey: 'avg.media.music', bindingHash: 'b'.repeat(64), endpointRouteHash: 'c'.repeat(64) } },
      capabilityRequirements: [{ ...v.capabilities[0], requirementKey: 'avg.sound.planning.text', mediaClass: 'text' },
        { ...v.capabilities[0], requirementKey: 'avg.media.music', mediaClass: 'music' }] }, briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 })
    key = 'desk.bgm'
  }
  const processing: AvgAudioProductionProcessingPlanV1 = { schema: 'storyforge.avg.audio-production-processing-plan', version: 1,
    entries: [{ domain, requirementKey: key, recipe: { schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb: -4320,
      maximumDurationMs: 120_000, sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
      declaration: '明确冻结的加工需求；仅提案，不签实际Run或采用。' } }] }
  const targets = [{ domain, requirementKey: key, kind: domain === 'voice' ? 'voice' as const : 'bgm' as const, mimeType: 'audio/wav' as const }]
  return { sourcePlan, processing, targets, key }
}

describe('AVG exact production graph audio processing proposal', () => {
  it('captures the exact graph, recipe and targets before asynchronous shared-parser loading', async () => {
    const f = await fixture('voice'), sourceHash = await hashProductProductionValueV2(f.sourcePlan), originalKey = f.key
    const promise = proposeAvgAudioProcessingTopologyV1(f)
    f.sourcePlan.briefHash = 'f'.repeat(64)
    f.processing.entries[0].recipe.gainMilliDb = -1000
    f.targets[0].requirementKey = 'foreign'
    const result = await promise
    expect(result.sourcePlanHash).toBe(sourceHash)
    expect(result.plan.briefHash).toBe('a'.repeat(64))
    expect(result.processing.entries[0]).toMatchObject({ requirementKey: originalKey, recipe: { gainMilliDb: -4320 } })
  })
  it.each(['voice', 'sound'] as const)('inserts %s processing before independent audition/choice without another original request', async domain => {
    const f = await fixture(domain), before = structuredClone(f.sourcePlan)
    const proposed = await proposeAvgAudioProcessingTopologyV1(f), { plan } = proposed, key = f.key
    const task = plan.tasks.find(t => t.taskKey === `avg.${domain}.process.${key}`)!
    const raw = before.tasks.find(t => t.taskKey === `avg.${domain}.generate.${key}`)!
    expect(task).toMatchObject({ kind: 'avg-audio-process', executionMode: 'deterministic', skillId: null, maxAttempts: 1,
      capabilityRequirementKeys: [], reuse: null, fallbackTaskKey: null, timeoutMs: 90_000,
      budgetReservation: { modelCalls: 0, mediaCalls: 0, maximumCostUsd: 0 } })
    expect(task.inputArtifactKeys).toEqual([...raw.inputArtifactKeys, ...raw.outputArtifactKeys])
    expect(task.dependsOn).toEqual([...raw.dependsOn, raw.taskKey])
    expect(plan.tasks.find(t => t.taskKey === raw.taskKey)).toEqual(raw)
    for (const suffix of ['review', 'choice']) {
      const old = before.tasks.find(t => t.taskKey === `avg.author.${domain}-${suffix}.${key}`)!
      const next = plan.tasks.find(t => t.taskKey === old.taskKey)!
      expect(next.inputArtifactKeys).toEqual([...old.inputArtifactKeys, ...task.outputArtifactKeys])
      expect(next.dependsOn).toEqual([...old.dependsOn, task.taskKey])
      expect(next.requiredReceipts).toEqual([...old.requiredReceipts, { taskKey: task.taskKey, receiptHash: null }])
    }
    const bearing = (p: typeof plan) => p.tasks.filter(t => t.budgetReservation.mediaCalls || t.budgetReservation.modelCalls)
    expect(bearing(plan)).toEqual(bearing(before)); expect(f.sourcePlan).toEqual(before)
    expect(plan.tasks.find(t => t.taskKey === plan.terminalTaskKey)!.acceptanceGateIds).toContain(task.acceptanceGateIds[0])
    // Structural admission is now registered, but still grants no actual
    // producer/start/adoption capability or permission to rewrite an old Brief.
    expect(parseProductProductionPlanV3(plan, undefined, plan.briefHash)).toEqual(plan)
    expect(avgAudioProcessingExecutionReadyV1()).toBe(false)
    expect(() => parseProductProductionPlanV3(proposed)).toThrow()
  })
  it('preserves the original library OGG producer, request and author path when only music is selected', async () => {
    const f = await fixture('sound'), before = structuredClone(f.sourcePlan), { plan } = await proposeAvgAudioProcessingTopologyV1(f)
    for (const task of before.tasks.filter(t => t.taskKey.includes('desk.sfx'))) expect(plan.tasks.find(t => t.taskKey === task.taskKey)).toEqual(task)
    expect(plan.tasks.filter(t => t.kind === 'avg-audio-process')).toHaveLength(1)
  })
  it.each(['model-mode', 'skill', 'capability', 'model-budget', 'media-budget', 'unknown-cost', 'retry', 'profile',
    'raw-input', 'raw-dependency', 'choice-review', 'derived-audition', 'foreign-domain'] as const)('rejects structural %s even without a Brief argument', async invalid => {
    const f = await fixture('voice'), { plan } = await proposeAvgAudioProcessingTopologyV1(f)
    const task = plan.tasks.find(t => t.kind === 'avg-audio-process')!, rawKey = `avg.voice.raw.${f.key}`
    if (invalid === 'model-mode') task.executionMode = 'model'
    if (invalid === 'skill') task.skillId = 'avg.media-request.v1'
    if (invalid === 'capability') task.capabilityRequirementKeys = ['avg.media.voice']
    if (invalid === 'model-budget') task.budgetReservation.modelCalls = 1
    if (invalid === 'media-budget') task.budgetReservation.mediaCalls = 1
    if (invalid === 'unknown-cost') task.budgetReservation.maximumCostUsd = null
    if (invalid === 'retry') task.maxAttempts = 2
    if (invalid === 'profile') task.contextProfile = 'avg-sound-planning-v1'
    if (invalid === 'raw-input') task.inputArtifactKeys = task.inputArtifactKeys.filter(k => k !== rawKey)
    if (invalid === 'raw-dependency') {
      task.dependsOn = task.dependsOn.filter(k => k !== `avg.voice.generate.${f.key}`)
      task.requiredReceipts = task.requiredReceipts.filter(r => r.taskKey !== `avg.voice.generate.${f.key}`)
    }
    if (invalid === 'choice-review') {
      const choice = plan.tasks.find(t => t.kind === 'avg-author-voice-choice')!
      choice.inputArtifactKeys = choice.inputArtifactKeys.filter(k => k !== `avg.review.audio.${f.key}`)
      choice.dependsOn = choice.dependsOn.filter(k => k !== `avg.author.voice-review.${f.key}`)
      choice.requiredReceipts = choice.requiredReceipts.filter(r => r.taskKey !== `avg.author.voice-review.${f.key}`)
    }
    if (invalid === 'derived-audition') {
      const review = plan.tasks.find(t => t.kind === 'avg-author-voice-review')!
      review.inputArtifactKeys = review.inputArtifactKeys.filter(k => !task.outputArtifactKeys.includes(k))
    }
    if (invalid === 'foreign-domain') task.outputArtifactKeys[0] = `avg.sound.processed.${f.key}`
    expect(() => parseProductProductionPlanV3(plan, undefined, plan.briefHash)).toThrow()
  })
  it.each(['missing-producer', 'producer-retry', 'missing-audition-input', 'missing-choice-review', 'foreign-requirement'] as const)('rejects %s instead of adding a parallel unreviewed path', async invalid => {
    const f = await fixture('voice'), raw = f.sourcePlan.tasks.find(t => t.taskKey === `avg.voice.generate.${f.key}`)!
    const review = f.sourcePlan.tasks.find(t => t.kind === 'avg-author-voice-review')!, choice = f.sourcePlan.tasks.find(t => t.kind === 'avg-author-voice-choice')!
    if (invalid === 'missing-producer') raw.kind = 'foreign-producer'
    if (invalid === 'producer-retry') raw.maxAttempts = 2
    if (invalid === 'missing-audition-input') review.inputArtifactKeys = []
    if (invalid === 'missing-choice-review') choice.inputArtifactKeys = [...raw.outputArtifactKeys]
    if (invalid === 'foreign-requirement') f.processing.entries[0].requirementKey = 'foreign'
    const before = structuredClone(f)
    await expect(proposeAvgAudioProcessingTopologyV1(f)).rejects.toThrow(); expect(f).toEqual(before)
  })
})
