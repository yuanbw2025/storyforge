import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3, createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { avgSoundProductionFixtureV1 } from '../helpers/avg-sound-production-fixture'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { startNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { avgSoundProductionBudgetV1, avgSoundProductionGateIdsV1 } from '../../src/lib/avg/sound-production-policy'
import { avgVoiceProductionBudgetV3, assertAvgVoiceProductionPolicyV3 } from '../../src/lib/avg/voice-production-policy'
import { buildAvgVoiceAssemblyPlanV3 } from '../../src/lib/avg/voice-assembly-plan'
import { avgVoiceAssemblyGateIdsV3, assertAvgVoiceAssemblyRequestsV3 } from '../../src/lib/avg/voice-assembly-contract'
import { projectAvgTaskRequirementV1 } from '../../src/lib/avg/task-context'
import { avgAudioProcessingExecutionReadyV1, avgAudioProcessingGateIdsV1 } from '../../src/lib/avg/audio-production-brief'
import type { AvgAudioProductionProcessingPlanV1 } from '../../src/lib/avg/audio-production-contract'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import { inspectProductProductionCapabilityReadinessV1, evaluateProductProductionAuthorizationReadinessV1 } from '../../src/lib/product-production/service'

function processing(domain: 'voice' | 'sound', key: string): AvgAudioProductionProcessingPlanV1 {
  return { schema: 'storyforge.avg.audio-production-processing-plan', version: 1, entries: [{ domain, requirementKey: key,
    recipe: { schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb: -4320, maximumDurationMs: 120_000,
      sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
      declaration: '明确降低实际响度，不能代替producer、独立审听、许可或作者采用。' } }] }
}
beforeEach(async () => { await db.delete(); await db.open(); vi.stubEnv('VITE_STORYFORGE_AVG_SOUND_PRODUCTION', '1')
  vi.stubEnv('VITE_STORYFORGE_AVG_AUDIO_PROCESSING', '1'); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external request authorized by contract checks') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); db.close() })

describe('AVG frozen audio processing declaration and closed execution boundary', () => {
  it('roundtrips the explicit outer sound declaration, accounts only local resources and leaves old bytes/hash unchanged', async () => {
    const s = await avgSoundProductionFixtureV1(), old = structuredClone(s.brief), encoded = canonicalProductProductionJsonV2(old)
    const next = { ...s.brief, avgAudioProcessing: processing('sound', 'desk.bgm') }
    next.productionBudget = avgSoundProductionBudgetV1(next)
    next.completionContract = { ...next.completionContract, requiredGateIds: avgSoundProductionGateIdsV1(next) }
    const parsed = parseProductProductionBriefV3(next), hash = await hashProductProductionValueV2(parsed)
    const plan = await createProductProductionPlanV3({ brief: parsed, briefHash: hash, buildNumber: 1, controlEpoch: 0 })
    expect(parseProductProductionPlanV3(plan, parsed, hash)).toEqual(plan)
    expect(parsed.avgSoundPlanning).toEqual(old.avgSoundPlanning)
    expect(parsed.productionBudget).toEqual({ ...old.productionBudget,
      maximumInputTokens: old.productionBudget.maximumInputTokens + 24_000,
      maximumDurationMs: old.productionBudget.maximumDurationMs + 90_000,
      maximumStorageBytes: old.productionBudget.maximumStorageBytes + 36 * 1024 * 1024 })
    expect(plan.tasks.filter(t => t.kind === 'avg-audio-process')).toHaveLength(1)
    expect(() => parseProductProductionPlanV3(plan, old, hash)).toThrow()
    expect(canonicalProductProductionJsonV2(parseProductProductionBriefV3(old))).toBe(encoded)
    expect(await hashProductProductionValueV2(old)).not.toBe(hash); expect(fetch).not.toHaveBeenCalled()
  })
  it('adds the same bounded voice task and completion gate while preserving the original unknown supplier cost', async () => {
    const old = await avgVoicePolicyFixtureV3(), p = processing('voice', old.avgAssembly.voice.batch.requirements[0].requirementKey)
    const next = { ...old, avgAudioProcessing: p, productionBudget: avgVoiceProductionBudgetV3(old.avgAssembly, null, p),
      completionContract: { ...old.completionContract, requiredGateIds: [...avgVoiceAssemblyGateIdsV3(old.avgAssembly), ...avgAudioProcessingGateIdsV1(p)] } }
    expect(() => assertAvgVoiceProductionPolicyV3(next)).not.toThrow()
    const plan = buildAvgVoiceAssemblyPlanV3({ brief: next, briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 })
    expect(parseProductProductionPlanV3(plan, undefined, plan.briefHash)).toEqual(plan)
    expect(next.productionBudget.maximumCostUsd).toBeNull()
    expect(next.productionBudget.maximumMediaCalls).toBe(old.productionBudget.maximumMediaCalls)
    expect(next.productionBudget.maximumModelCalls).toBe(old.productionBudget.maximumModelCalls)
    expect(() => assertAvgVoiceProductionPolicyV3({ ...next, productionBudget: old.productionBudget })).toThrow(/预算/)
    expect(() => assertAvgVoiceProductionPolicyV3({ ...next, completionContract: old.completionContract })).toThrow(/完成/)
  })
  it('projects the frozen voice recipe and original request hashes without re-delivering dialogue or changing the original request projection', async () => {
    const old = await avgVoicePolicyFixtureV3(), p = processing('voice', old.avgAssembly.voice.batch.requirements[0].requirementKey)
    const resolved = await assertAvgVoiceAssemblyRequestsV3(old.avgAssembly)
    const plan = buildAvgVoiceAssemblyPlanV3({ brief: { ...old, avgAudioProcessing: p }, briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 })
    const task = plan.tasks.find(t => t.kind === 'avg-audio-process')!, raw = plan.tasks.find(t => t.kind === 'avg-media-voice-generate')!
    const packet = projectAvgTaskRequirementV1({ ...resolved, task, processing: p })
    expect(packet).toMatchObject({ kind: 'audio-processing', domain: 'voice', processing: p.entries[0], request: {
      identityHash: resolved.requests[0].identityHash, requestBodyHash: resolved.requests[0].requestBodyHash } })
    expect(JSON.stringify(packet)).not.toContain(old.avgAssembly.voice.batch.requirements[0].text)
    expect(JSON.stringify(packet)).not.toContain('requestBodyJson')
    expect(projectAvgTaskRequirementV1({ ...resolved, task: raw, processing: p })).toEqual(projectAvgTaskRequirementV1({ ...resolved, task: raw }))
    expect(() => projectAvgTaskRequirementV1({ ...resolved, task })).toThrow(/冻结配方/)
    const changed = structuredClone(p); changed.entries[0].requirementKey = 'foreign'
    expect(() => projectAvgTaskRequirementV1({ ...resolved, task, processing: changed })).toThrow()
  })
  it.each(['old-budget', 'old-gates', 'foreign-domain', 'foreign-requirement', 'known-duration', 'ogg', 'other-product'] as const)('rejects %s before any dispatch', async invalid => {
    const s = await avgSoundProductionFixtureV1(), next = { ...s.brief, avgAudioProcessing: processing('sound', 'desk.bgm') }
    next.productionBudget = avgSoundProductionBudgetV1(next)
    next.completionContract = { ...next.completionContract, requiredGateIds: avgSoundProductionGateIdsV1(next) }
    if (invalid === 'old-budget') next.productionBudget = s.brief.productionBudget
    if (invalid === 'old-gates') next.completionContract = s.brief.completionContract
    if (invalid === 'foreign-domain') next.avgAudioProcessing.entries[0].domain = 'voice'
    if (invalid === 'foreign-requirement') next.avgAudioProcessing.entries[0].requirementKey = 'foreign'
    if (invalid === 'known-duration') next.avgAudioProcessing.entries[0].recipe.maximumDurationMs = 1000
    if (invalid === 'ogg') next.avgAudioProcessing.entries[0].requirementKey = 'desk.sfx'
    if (invalid === 'other-product') next.intent = { ...next.intent, productType: 'text-adventure' }
    expect(() => parseProductProductionBriefV3(next)).toThrow(); expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps preparation, authorization readiness and executor creation closed while the producer/consumer slice is incomplete', async () => {
    const s = await avgSoundProductionFixtureV1(), next = { ...s.brief, avgAudioProcessing: processing('sound', 'desk.bgm') }
    next.productionBudget = avgSoundProductionBudgetV1(next)
    next.completionContract = { ...next.completionContract, requiredGateIds: avgSoundProductionGateIdsV1(next) }
    const parsed = parseProductProductionBriefV3(next), before = await db.productBuilds.count(), runs = await db.agentRuns.count()
    expect(avgAudioProcessingExecutionReadyV1()).toBe(false)
    const readiness = evaluateProductProductionAuthorizationReadinessV1({ brief: parsed,
      readiness: inspectProductProductionCapabilityReadinessV1({ projectId: s.owner.scope.projectId }) })
    expect(readiness.ready).toBe(false); expect(readiness.blockerMessages.join(' ')).toContain('本地声音加工链')
    const receipt = await executeProductProductionCommand({ scope: s.owner.scope, productionId: s.owner.productionId,
      command: { type: 'save-brief-revision', commandId: `audio.closed.${crypto.randomUUID()}`,
        expectedStateRevision: s.owner.details.production.stateRevision, parentRevision: s.owner.details.brief!.revision, brief: parsed } })
    expect(receipt.ok).toBe(false); expect(String(receipt.result.message)).toContain('本地声音加工链')
    expect(() => createConfiguredProductProductionExecutorV1({ production: s.owner.details.production, brief: parsed })).toThrow(/本地声音加工链/)
    expect(await db.productBuilds.count()).toBe(before); expect(await db.agentRuns.count()).toBe(runs); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['voice', 'sound'] as const)('reserves %s derived audio against the old generic artifact writer', async domain => {
    const s = await avgSoundProductionFixtureV1(), started = await startNativeAvgAssembly(s.owner)
    const before = await db.productBuildArtifacts.count()
    await expect(acceptProductBuildArtifact({ scope: s.owner.scope, buildId: started.buildId,
      controlEpoch: started.details.build!.controlEpoch, artifactKey: `avg.${domain}.processed.fixture`, kind: 'audio', mediaKind: domain === 'voice' ? 'voice' : 'bgm',
      payload: { schema: 'fixture.not-producer-proof', version: 1 }, inputHash: 'f'.repeat(64) })).rejects.toThrow(/专用producer准入/)
    expect(await db.productBuildArtifacts.count()).toBe(before); expect(fetch).not.toHaveBeenCalled()
  })
})
