import { describe, expect, it } from 'vitest'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { assertAvgVoiceProductionPolicyV3, avgVoiceProductionBudgetV3 } from '../../src/lib/avg/voice-production-policy'
import { buildAvgVoiceAssemblyPlanV3 } from '../../src/lib/avg/voice-assembly-plan'
import { AVG_VOICE_NETWORK_TIMEOUT_MS_V1, AVG_VOICE_TASK_TIMEOUT_MS_V1 } from '../../src/lib/avg/voice-request-contract'

describe('AVG private voice/combined production policy', () => {
  it.each([false, true])('closes one voice request and optional image %s against exact finite resource and completion gates', async withImage => {
    const brief = await avgVoicePolicyFixtureV3(withImage)
    expect(() => assertAvgVoiceProductionPolicyV3(brief)).not.toThrow()
    const plan = buildAvgVoiceAssemblyPlanV3({ brief, briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 })
    const sums = plan.tasks.reduce((s,t) => ({ media: s.media+t.budgetReservation.mediaCalls,
      duration: s.duration+t.budgetReservation.durationMs, storage: s.storage+t.budgetReservation.storageBytes,
      input: s.input+t.budgetReservation.inputTokens }), { media: 0, duration: 0, storage: 0, input: 0 })
    expect(sums.media).toBe(withImage ? 2 : 1)
    expect(sums.duration).toBeLessThanOrEqual(brief.productionBudget.maximumDurationMs)
    expect(sums.storage).toBeLessThanOrEqual(brief.productionBudget.maximumStorageBytes)
    expect(sums.input).toBeLessThanOrEqual(brief.productionBudget.maximumInputTokens)
    expect(plan.tasks.filter(t => t.executionMode === 'model')).toEqual([])
    expect(plan.tasks.find(t => t.kind === 'avg-media-voice-generate')!.timeoutMs).toBe(AVG_VOICE_TASK_TIMEOUT_MS_V1)
    expect(AVG_VOICE_NETWORK_TIMEOUT_MS_V1 + 30_000).toBeLessThanOrEqual(AVG_VOICE_TASK_TIMEOUT_MS_V1)
    expect(brief.productionBudget.maximumCostUsd).toBeNull()
  })

  it('refuses extra provider/model calls, undersized storage, inflated calls or a missing audition/choice gate', async () => {
    const base = await avgVoicePolicyFixtureV3()
    for (const mutate of [
      (b: typeof base) => { b.productionBudget.maximumModelCalls = 1 },
      (b: typeof base) => { b.productionBudget.maximumMediaCalls++ },
      (b: typeof base) => { b.productionBudget.maximumStorageBytes-- },
      (b: typeof base) => { b.consultationBudget.maximumModelCalls = 1 },
      (b: typeof base) => { b.completionContract.requiredGateIds = b.completionContract.requiredGateIds.filter(k => !k.startsWith('avg.voice.review.')) },
      (b: typeof base) => { b.completionContract.allowSoftWaivers = true },
      (b: typeof base) => { b.media.voiceLineCount = 0 },
    ]) { const brief = structuredClone(base); mutate(brief); expect(() => assertAvgVoiceProductionPolicyV3(brief)).toThrow() }
  })

  it('rejects missing voice-script consent, unrelated external classes and silent fallback', async () => {
    const base = await avgVoicePolicyFixtureV3()
    for (const mutate of [
      (b: typeof base) => { b.externalDataPolicy.allowVoiceScripts = false },
      (b: typeof base) => { b.externalDataPolicy.allowedDataClasses = [] },
      (b: typeof base) => { b.externalDataPolicy.allowedDataClasses.push('world-private') },
      (b: typeof base) => { b.externalDataPolicy.forbiddenDataClasses.push('voice-script') },
      (b: typeof base) => { b.externalDataPolicy.allowReferenceImages = true },
      (b: typeof base) => { b.fallbackPolicy.allowProceduralAudio = true },
      (b: typeof base) => { b.fallbackPolicy.allowTextOnly = true },
      (b: typeof base) => { b.fallbackPolicy.onRequiredCapabilityMissing = 'fail' },
    ]) { const brief = structuredClone(base); mutate(brief); expect(() => assertAvgVoiceProductionPolicyV3(brief)).toThrow() }
  })

  it('retains the full existing image policy instead of allowing it to borrow voice capability or consent', async () => {
    const base = await avgVoicePolicyFixtureV3(true)
    for (const mutate of [
      (b: typeof base) => { b.capabilityRequirements = b.capabilityRequirements.filter(c => c.mediaClass !== 'image') },
      (b: typeof base) => { b.capabilityRequirements.find(c => c.mediaClass === 'image')!.adapterFamily = 'other' },
      (b: typeof base) => { b.capabilityRequirements.find(c => c.mediaClass === 'image')!.allowedDataClasses = ['voice-script'] },
      (b: typeof base) => { Object.assign(b.avgAssembly.image!.imageBinding, { adapterId: 'other' }) },
    ]) { const brief = structuredClone(base); mutate(brief); expect(() => assertAvgVoiceProductionPolicyV3(brief)).toThrow() }
  })

  it('keeps declared finite cash ceilings consistent without pretending an account quote has been verified', async () => {
    const brief = await avgVoicePolicyFixtureV3()
    brief.productionBudget = avgVoiceProductionBudgetV3(brief.avgAssembly, 1)
    brief.capabilityRequirements[0]!.maximumTotalCost = 1; brief.capabilityRequirements[0]!.maximumRequestCost = 0.25
    expect(() => assertAvgVoiceProductionPolicyV3(brief)).not.toThrow()
    brief.capabilityRequirements[0]!.maximumRequestCost = null
    expect(() => assertAvgVoiceProductionPolicyV3(brief)).toThrow(/费用/)
    for (const cost of [NaN, Infinity, -1]) expect(() => avgVoiceProductionBudgetV3(brief.avgAssembly, cost)).toThrow(/费用/)
  })
})
