import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedAvgAuthorStageInputs } from '../helpers/avg-author-stage-fixture'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { createProductProductionPlanV3, parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { encodeAvgStoredAssemblyBriefV3, assertAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { readAvgSystemPlanForCompilationV1 } from '../../src/lib/avg/author-artifacts'
import { hashAvgVoiceSourceInputV1 } from '../../src/lib/avg/voice-production-source'
import { avgVoiceProductionEnabledV3 } from '../../src/lib/avg/assembly-contract'

beforeEach(async () => { await db.delete(); await db.open(); vi.stubEnv('VITE_STORYFORGE_AVG_VOICE_PRODUCTION', '') })
afterEach(() => { vi.unstubAllEnvs(); db.close() })

/** Real isolated AVG Work and accepted source revisions. This only prepares
 * a readable stored contract; no V3 start, provider, voice or art is accepted. */
async function fixture(withImage = false) {
  const owner = await seedAvgAuthorStageInputs(), build = (await db.productBuilds.get(owner.buildId))!
  const row = (await db.productProductionBriefs.where('productionId').equals(owner.productionId).first())!
  const base = parseProductProductionBriefV3(row.briefJson), policy = await avgVoicePolicyFixtureV3(withImage)
  const source = await readAvgSystemPlanForCompilationV1({ scope: owner.scope, buildId: owner.buildId,
    expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch, includeSceneScripts: true })
  const a = policy.avgAssembly
  a.sceneKeys = source.plan.scenes.map(scene => scene.key)
  a.voice.batch.sourceInputHash = await hashAvgVoiceSourceInputV1({ systemPlan: source.plan, scripts: source.scripts.map(s => s.payload) })
  const r = a.voice.batch.requirements[0]!
  r.script = source.scripts.find(s => s.payload.sceneKey === r.sceneKey)!.artifact
  const stored = await encodeAvgStoredAssemblyBriefV3(a)
  const brief = parseProductProductionBriefV3({ ...base, ...policy, intent: { ...base.intent, ...policy.intent }, avgAssembly: stored })
  return { owner, build, row, brief, policy }
}

describe('AVG V3 shared read codec and fixed Plan; production remains closed', () => {
  it.each([['', '', false], ['1', '', false], ['', '1', false], ['1', '1', true]] as const)(
    'requires both explicit experiments without changing defaults (image=%s voice=%s)', (image, voice, expected) => {
      vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', image); vi.stubEnv('VITE_STORYFORGE_AVG_VOICE_PRODUCTION', voice)
      expect(avgVoiceProductionEnabledV3()).toBe(expected)
    })
  it.each([false, true])('reads the exact stored contract and fixed shared Plan (image=%s) without enabling production', async withImage => {
    const s = await fixture(withImage), briefHash = await hashProductProductionValueV2(s.brief)
    const persisted = parseProductProductionBriefV3(canonicalProductProductionJsonV2(s.brief))
    expect(await hashProductProductionValueV2(persisted)).toBe(briefHash)
    expect(persisted.avgAssembly?.version).toBe(3)
    if (persisted.avgAssembly?.version !== 3) throw new Error('expected stored V3')
    const resolved = await assertAvgStoredAssemblyBriefV3(persisted.avgAssembly)
    expect(resolved.requests[0]!.textHash).toBe(s.policy.avgAssembly.voice.batch.requirements[0]!.textHash)
    const plan = await createProductProductionPlanV3({ brief: persisted, briefHash, buildNumber: 2, controlEpoch: 4 })
    expect(parseProductProductionPlanV3(plan, persisted, briefHash)).toEqual(plan)
    expect(plan.tasks.some(t => t.kind === 'avg-author-voice-review')).toBe(true)
    expect(plan.tasks.find(t => t.taskKey === 'avg.author.stage')!.inputArtifactKeys).toContain('avg.voice.choice.keeper.line')
    const drift = structuredClone(plan)
    drift.tasks.find(t => t.kind === 'avg-author-voice-choice')!.inputArtifactKeys = ['avg.voice.raw.keeper.line']
    expect(() => parseProductProductionPlanV3(drift, persisted, briefHash)).toThrow()
  }, 30_000)

  it('rejects a decoded proposal and altered voice policy at the shared Brief boundary', async () => {
    const s = await fixture()
    expect(() => parseProductProductionBriefV3({ ...s.brief, avgAssembly: s.policy.avgAssembly })).toThrow()
    expect(() => parseProductProductionBriefV3({ ...s.brief, externalDataPolicy: { ...s.brief.externalDataPolicy, allowVoiceScripts: false } })).toThrow(/外发授权/)
    expect(() => parseProductProductionBriefV3({ ...s.brief, productionBudget: { ...s.brief.productionBudget, maximumModelCalls: 1 } })).toThrow(/预算/)
  }, 30_000)

  it('refuses saving a V3 production revision even when the existing image experiment flag is enabled', async () => {
    const s = await fixture(); vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
    const production = (await db.productProductions.get(s.owner.productionId))!
    const before = { briefs: await db.productProductionBriefs.count(), builds: await db.productBuilds.count() }
    const receipt = await executeProductProductionCommand({ scope: s.owner.scope, productionId: s.owner.productionId,
      command: { type: 'save-brief-revision', commandId: 'voice.closed.save', expectedStateRevision: production.stateRevision,
        parentRevision: production.currentBriefRevision, brief: s.brief } })
    expect(receipt.ok).toBe(false); expect(receipt.errorCode).toBe('brief-not-authorized')
    expect(String(receipt.result.message)).toMatch(/配音生产.*尚未开放/)
    expect(await db.productProductionBriefs.count()).toBe(before.briefs); expect(await db.productBuilds.count()).toBe(before.builds)
  }, 30_000)

  it('refuses authorize-start for a manually inserted V3 draft; readable data never grants a new Build', async () => {
    const s = await fixture(); vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
    const briefHash = await hashProductProductionValueV2(s.brief), production = (await db.productProductions.get(s.owner.productionId))!
    await db.productProductionBriefs.update(s.row.id!, { status: 'draft', briefJson: canonicalProductProductionJsonV2(s.brief), briefHash, authorizedAt: null })
    await db.productProductions.update(s.owner.productionId, { status: 'brief-ready' })
    const count = await db.productBuilds.count()
    const receipt = await executeProductProductionCommand({ scope: s.owner.scope, productionId: s.owner.productionId,
      command: { type: 'authorize-start', commandId: 'voice.closed.start', expectedStateRevision: production.stateRevision,
        briefRevision: s.row.revision, briefHash, authorizationNonce: 'voice.closed.author-click' } })
    expect(receipt.ok).toBe(false); expect(receipt.errorCode).toBe('brief-not-authorized')
    expect(String(receipt.result.message)).toMatch(/配音生产.*尚未开放/)
    expect(await db.productBuilds.count()).toBe(count)
  }, 30_000)
})
