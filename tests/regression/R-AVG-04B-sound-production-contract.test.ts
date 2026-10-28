import { describe, expect, it } from 'vitest'
import { avgSoundProductionFixtureV1 } from '../helpers/avg-sound-production-fixture'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3, parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { buildAvgSoundProductionPlanV1 } from '../../src/lib/avg/sound-production-plan'
import { parseAvgSoundPlanningBriefV1, avgSoundProductionExecutionReadyV1 } from '../../src/lib/avg/sound-production-brief'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { assertAvgProfessionalArtifactAdmissionV1 } from '../../src/lib/avg/artifact-admission'
import { createAvgAssemblyExecutorV1 } from '../../src/lib/avg/assembly-executor'

const identity = { briefHash: '0'.repeat(64), buildNumber: 2, controlEpoch: 3 }
describe('AVG sound actual outer Brief and immutable production topology admission', () => {
  it('roundtrips its own full Brief and deterministically freezes separate proposal/adoption/compilation/raw/review/choice/Stage joins', async () => {
    const s = await avgSoundProductionFixtureV1(), briefHash = await hashProductProductionValueV2(s.brief)
    const saved = canonicalProductProductionJsonV2(s.brief)
    expect(canonicalProductProductionJsonV2(parseProductProductionBriefV3(saved))).toBe(saved)
    const plan = await createProductProductionPlanV3({ ...identity, briefHash, brief: saved })
    expect(plan).toEqual(buildAvgSoundProductionPlanV1({ ...identity, briefHash, brief: s.brief }))
    expect(parseProductProductionPlanV3(plan, s.brief, briefHash)).toEqual(plan)
    expect(parseProductProductionPlanV3(plan)).toEqual(plan)
    expect(plan.tasks.filter(t => t.executionMode === 'model').map(t => [t.skillId, t.budgetReservation.modelCalls])).toEqual([['avg.sound-plan.v1', 1]])
    const music = plan.tasks.find(t => t.kind === 'avg-sound-music-generate')!, imported = plan.tasks.find(t => t.kind === 'avg-sound-library-import')!
    expect(music).toMatchObject({ executionMode: 'media-provider', maxAttempts: 1, timeoutMs: 900_000, failurePolicy: 'pause',
      budgetReservation: { mediaCalls: 1, maximumCostUsd: 0 } })
    expect(imported).toMatchObject({ executionMode: 'deterministic', skillId: null, capabilityRequirementKeys: [], budgetReservation: { mediaCalls: 0, maximumCostUsd: 0 } })
    for (const t of [music, imported]) {
      expect(t.dependsOn).toContain('avg.author.sound-plan'); expect(t.dependsOn).toContain('avg.sound.compile.requirements')
      expect(t.inputArtifactKeys).toContain('avg.media.compiled-sound-requirements')
    }
    const stage = plan.tasks.find(t => t.taskKey === 'avg.author.stage')!
    expect(stage.dependsOn).toContain('avg.author.sound-choice.desk.bgm'); expect(stage.dependsOn).toContain('avg.author.sound-choice.desk.sfx')
    expect(stage.executionMode).toBe('human-import')
    const terminal = plan.tasks.find(t => t.taskKey === plan.terminalTaskKey)!
    expect(terminal.acceptanceGateIds).toContain('avg.sound.review.recorded.desk.bgm')
    expect(terminal.acceptanceGateIds).toContain('avg.sound.choice.confirmed.desk.sfx')
    expect(s.brief.productionBudget).toMatchObject({ maximumModelCalls: 1, maximumMediaCalls: 1, maximumOutputTokens: 8_000, maximumCostUsd: null })
  })
  it('gives library-only production no music route or inference reservation', async () => {
    const { brief } = await avgSoundProductionFixtureV1(true), plan = buildAvgSoundProductionPlanV1({ ...identity, brief })
    expect(brief.avgSoundPlanning!.musicBinding).toBeNull()
    expect(brief.capabilityRequirements).toHaveLength(1); expect(brief.productionBudget.maximumMediaCalls).toBe(0)
    expect(plan.tasks.some(t => t.kind === 'avg-sound-music-generate')).toBe(false)
  })
  it('rejects missing/surplus routes, unknown versions and targets outside the frozen assembly', async () => {
    const { brief } = await avgSoundProductionFixtureV1(), input = brief.avgSoundPlanning!
    expect(() => parseAvgSoundPlanningBriefV1({ ...input, musicBinding: null })).toThrow(/路由/)
    expect(() => parseAvgSoundPlanningBriefV1({ ...input, version: 2 })).toThrow(/版本/)
    expect(() => parseAvgSoundPlanningBriefV1({ ...input, assembly: { ...input.assembly, mediaAssetKeys: [] } })).toThrow(/目录/)
    expect(() => parseAvgSoundPlanningBriefV1({ ...input, musicBinding: { ...input.musicBinding, apiKey: 'never-allowed' } })).toThrow()
    const library = await avgSoundProductionFixtureV1(true)
    expect(() => parseAvgSoundPlanningBriefV1({ ...library.brief.avgSoundPlanning, musicBinding: input.musicBinding })).toThrow(/路由/)
  })
  it('rejects mixed legacy ownership, commercial acceptance, extra providers and cross-route music bindings', async () => {
    const s = await avgSoundProductionFixtureV1()
    expect(() => parseProductProductionBriefV3({ ...s.brief, avgAssembly: s.legacy.avgAssembly })).toThrow(/独立 AVG/)
    expect(() => parseProductProductionBriefV3({ ...s.brief, qualityProfile: 'commercial-candidate' })).toThrow(/独立 AVG/)
    const wrong = structuredClone(s.brief); wrong.capabilityRequirements[1].capabilityHash = 'd'.repeat(64)
    expect(() => parseProductProductionBriefV3(wrong)).toThrow(/路由/)
    const extra = structuredClone(s.brief); extra.capabilityRequirements.push({ ...extra.capabilityRequirements[0], requirementKey: 'extra.text' })
    expect(() => parseProductProductionBriefV3(extra)).toThrow(/能力/)
  })
  it('rejects loosened budgets, waivers, procedural fallback, audio counts or foreign data classes', async () => {
    const { brief } = await avgSoundProductionFixtureV1()
    const changes = [
      (b: typeof brief) => { b.productionBudget.maximumModelCalls++ },
      (b: typeof brief) => { b.completionContract.allowSoftWaivers = true },
      (b: typeof brief) => { b.completionContract.requiredGateIds = b.completionContract.requiredGateIds.filter(g => !g.includes('review')) },
      (b: typeof brief) => { b.fallbackPolicy.allowProceduralAudio = true },
      (b: typeof brief) => { b.media.voiceLineCount = 1 },
      (b: typeof brief) => { b.externalDataPolicy.allowedDataClasses.push('voice-script') },
    ]
    for (const change of changes) { const next = structuredClone(brief); change(next); expect(() => parseProductProductionBriefV3(next)).toThrow() }
  })
  it('rejects tampered task inputs, reduced gates, changed call accounting and removed author dependencies even within total budget', async () => {
    const { brief } = await avgSoundProductionFixtureV1(), plan = buildAvgSoundProductionPlanV1({ ...identity, brief })
    const changes = [
      (p: typeof plan) => { p.tasks.find(t => t.kind === 'avg-sound-music-generate')!.budgetReservation.mediaCalls = 0 },
      (p: typeof plan) => { p.tasks.find(t => t.kind === 'avg-sound-plan-propose')!.inputArtifactKeys.reverse() },
      (p: typeof plan) => { p.tasks.find(t => t.taskKey === p.terminalTaskKey)!.acceptanceGateIds.pop() },
      (p: typeof plan) => { const t = p.tasks.find(t => t.taskKey === 'avg.author.stage')!; t.dependsOn.pop(); t.requiredReceipts.pop() },
    ]
    for (const change of changes) { const next = structuredClone(plan); change(next); expect(() => parseProductProductionPlanV3(next, brief, identity.briefHash)).toThrow() }
  })
  it('does not convert or rewrite the legacy outer Brief and cannot fall through to the generic executor', async () => {
    const s = await avgSoundProductionFixtureV1(), oldBytes = canonicalProductProductionJsonV2(s.legacy)
    expect(canonicalProductProductionJsonV2(parseProductProductionBriefV3(oldBytes))).toBe(oldBytes)
    expect(parseProductProductionBriefV3(oldBytes)).not.toHaveProperty('avgSoundPlanning')
    expect(avgSoundProductionExecutionReadyV1()).toBe(false)
    expect(() => createConfiguredProductProductionExecutorV1({ production: s.owner.details.production, brief: s.brief })).toThrow(/声音实际生产/)
    expect(() => createAvgAssemblyExecutorV1({ production: s.owner.details.production, brief: s.brief })).toThrow(/不能借用旧组装/)
  })
  it('rejects public sound preparation and generic writes without creating a Build, replacing the old Brief or changing the author draft', async () => {
    const s = await avgSoundProductionFixtureV1(), before = await readAvgDraftV1(s.owner.scope)
    const result = await executeProductProductionCommand({ scope: s.owner.scope, productionId: s.owner.productionId,
      command: { type: 'save-brief-revision', commandId: 'sound.not-yet-ready', expectedStateRevision: s.owner.details.production.stateRevision,
        parentRevision: s.owner.details.brief!.revision, brief: s.brief } })
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).toContain('声音实际生产、审听和采用闭环尚未接通')
    const after = await readProductProductionDetailsV1(s.owner.scope, s.owner.productionId, ['avg'])
    expect(after.brief!.briefHash).toBe(s.owner.details.brief!.briefHash); expect(after.build).toBeNull()
    expect((await readAvgDraftV1(s.owner.scope)).editorJson).toBe(before.editorJson)
    expect(() => assertAvgProfessionalArtifactAdmissionV1({ productType: 'avg', artifactKey: 'avg.media.sound-plan',
      kind: 'narrative', payload: s.plan, metadata: {} })).toThrow(/尚未就绪/)
  })
})
