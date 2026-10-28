import { describe, expect, it } from 'vitest'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { parseAvgAssemblyBrief } from '../../src/lib/avg/assembly-contract'
import { buildAvgVoiceAssemblyPlanV3 } from '../../src/lib/avg/voice-assembly-plan'
import { assertAvgVoiceAssemblyRequestsV3, avgVoiceAssemblyGateIdsV3, parseAvgAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-contract'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'

const identity = { briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 }

describe('AVG BASE-02 private voice and mixed assembly proposal', () => {
  it('compiles a bounded single voice route and refuses an unstored decoded proposal at the shared codec', async () => {
    const { assembly } = await avgVoiceAssemblyFixtureV3()
    const result = await assertAvgVoiceAssemblyRequestsV3(assembly)
    expect(result.requests).toHaveLength(1)
    expect(JSON.parse(result.requests[0]!.requestBodyJson).input).toBe('封口仍在。')
    expect(() => parseAvgAssemblyBrief(assembly)).toThrow()
    expect(() => parseAvgAssemblyBriefV3({ ...assembly, apiKey: 'forbidden' })).toThrow()
  })

  it('requires human audition and choice before stage, without giving a reviewer a provider budget', async () => {
    const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3()
    const plan = buildAvgVoiceAssemblyPlanV3({ ...identity, brief: { avgAssembly: assembly, capabilityRequirements: capabilities } })
    expect(parseProductProductionPlanV3(plan)).toEqual(plan)
    expect(plan.tasks).toHaveLength(8)
    const raw = plan.tasks.find(t => t.kind === 'avg-media-voice-generate')!
    const review = plan.tasks.find(t => t.kind === 'avg-author-voice-review')!
    const choice = plan.tasks.find(t => t.kind === 'avg-author-voice-choice')!
    const stage = plan.tasks.find(t => t.taskKey === 'avg.author.stage')!
    expect(raw.inputArtifactKeys).toEqual(['avg.system.plan', 'avg.content.scene-script.desk'])
    expect(raw.capabilityRequirementKeys).toEqual(['avg.media.voice'])
    expect(raw.budgetReservation.mediaCalls).toBe(1)
    expect(raw.maxAttempts).toBe(1)
    expect(review.executionMode).toBe('human-import'); expect(review.skillId).toBeNull()
    expect(review.budgetReservation.mediaCalls).toBe(0)
    expect(review.inputArtifactKeys).toEqual(raw.outputArtifactKeys)
    expect(choice.inputArtifactKeys).toEqual([...raw.outputArtifactKeys, ...review.outputArtifactKeys])
    expect(stage.inputArtifactKeys).toContain(choice.outputArtifactKeys[0])
    expect(stage.dependsOn).toContain(choice.taskKey)
    expect(plan.tasks.every(t => t.budgetReservation.modelCalls === 0)).toBe(true)
    expect(plan.tasks.at(-1)!.acceptanceGateIds).toEqual(avgVoiceAssemblyGateIdsV3(assembly))
  })

  it('joins image and voice candidates with distinct routes/receipts while preserving one package terminal', async () => {
    const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3(true)
    const plan = buildAvgVoiceAssemblyPlanV3({ ...identity, brief: { avgAssembly: assembly, capabilityRequirements: capabilities } })
    expect(parseProductProductionPlanV3(plan)).toEqual(plan)
    const paid = plan.tasks.filter(t => t.executionMode === 'media-provider')
    expect(paid).toHaveLength(2)
    expect(paid.map(t => t.capabilityRequirementKeys)).toEqual([['avg.media.image'], ['avg.media.voice']])
    expect(paid.reduce((sum, t) => sum + t.budgetReservation.mediaCalls, 0)).toBe(2)
    const stage = plan.tasks.find(t => t.taskKey === 'avg.author.stage')!
    expect(stage.inputArtifactKeys).toContain('avg.media.choice.desk.background')
    expect(stage.inputArtifactKeys).toContain('avg.voice.choice.keeper.line')
    expect(plan.tasks.filter(t => t.taskKey === plan.terminalTaskKey)).toHaveLength(1)
    expect(plan.tasks.at(-1)!.acceptanceGateIds).toContain('avg.media.raw.received.desk.background')
    expect(plan.tasks.at(-1)!.acceptanceGateIds).toContain('avg.voice.review.recorded.keeper.line')
  })

  it('refuses missing/extra capabilities and voice disguised as music or sound effects', async () => {
    const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3()
    for (const capabilityRequirements of [[], [...capabilities, { ...capabilities[0]!, requirementKey: 'extra' }],
      [{ ...capabilities[0]!, mediaClass: 'sfx' as const }], [{ ...capabilities[0]!, required: false }],
      [{ ...capabilities[0]!, allowedDataClasses: ['voice-script', 'private-memory'] }]]) {
      expect(() => buildAvgVoiceAssemblyPlanV3({ ...identity, brief: { avgAssembly: assembly, capabilityRequirements } })).toThrow()
    }
  })

  it('refuses out-of-scope scenes, missing runtime slots and image/voice asset collisions', async () => {
    const { assembly } = await avgVoiceAssemblyFixtureV3(true)
    expect(() => parseAvgAssemblyBriefV3({ ...assembly, mediaAssetKeys: ['desk.background'] })).toThrow(/目录/)
    expect(() => parseAvgAssemblyBriefV3({ ...assembly, sceneKeys: ['elsewhere'] })).toThrow()
    const collision = structuredClone(assembly)
    collision.image!.mediaBatch.requirements[0]!.assetKey = 'voice.desk'
    expect(() => parseAvgAssemblyBriefV3(collision)).toThrow(/同一媒资/)
  })

  it('keeps raw, audition and choice inside the shared task/key bounds rather than omitting confirmation steps', async () => {
    const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3()
    const maximum = { ...assembly, sceneKeys: ['desk', ...Array.from({ length: 92 }, (_, i) => `scene.${i}`)] }
    const plan = buildAvgVoiceAssemblyPlanV3({ ...identity, brief: { avgAssembly: maximum, capabilityRequirements: capabilities } })
    expect(parseProductProductionPlanV3(plan).tasks).toHaveLength(100)
    expect(() => parseAvgAssemblyBriefV3({ ...maximum, sceneKeys: [...maximum.sceneKeys, 'overflow'] })).toThrow(/100 任务/)
    const long = structuredClone(assembly)
    long.voice.batch.requirements[0]!.requirementKey = 'a'.repeat(200)
    expect(() => parseAvgAssemblyBriefV3(long)).toThrow(/文本无效/)
  })

  it('requires the actual protocol and route binding hashes before requests, beyond structural parsing', async () => {
    const { assembly } = await avgVoiceAssemblyFixtureV3()
    const stale = structuredClone(assembly); stale.voice.batch.presets[0]!.capabilityHash = 'f'.repeat(64)
    expect(parseAvgAssemblyBriefV3(stale)).toBeDefined()
    await expect(assertAvgVoiceAssemblyRequestsV3(stale)).rejects.toThrow(/绑定不一致/)
    const rebound = structuredClone(assembly); rebound.voice.binding.bindingHash = 'f'.repeat(64)
    await expect(assertAvgVoiceAssemblyRequestsV3(rebound)).rejects.toThrow(/绑定 hash/)
    const unsupported = structuredClone(assembly)
    unsupported.voice.batch.requirements[0]!.performance.intent = '焦急'
    await expect(assertAvgVoiceAssemblyRequestsV3(unsupported)).rejects.toThrow(/不能静默丢弃/)
  })
})
