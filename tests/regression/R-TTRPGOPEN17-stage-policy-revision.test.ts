/** Normal production commands and explicit synthetic replies; no real provider or human acceptance. */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readTtrpgDraft, saveTtrpgDraft, prepareTtrpgBrief, prepareTtrpgOpenProductionBriefV3 } from '../../src/lib/ttrpg/authoring-service'
import { settingsFromTtrpgDraft } from '../../src/lib/ttrpg/authoring-contract'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { beginProductProductionEvolutionV1, publishProductProductionV1 } from '../../src/lib/product-production/service'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { seedOpenBrowserProductionV1, runOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'
import * as consultation from '../../src/lib/product-production/consultation'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { evaluateTtrpgOpenStageClosureV1 } from '../../src/lib/ttrpg/open-gates'
import { createFreshOpenDraftFixtureV1 } from '../helpers/open-ttrpg-fresh-authoring'

describe('R-TTRPGOPEN17 explicit new-version stage policy', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  async function pending() {
    const f = await seedOpenBrowserProductionV1({ runtimeAIEnabled: true })
    let result = await runOpenBrowserProductionV1(f)
    for (let i = 0; i < 2 && !result.terminal; i++) result = await runOpenBrowserProductionV1(f, true)
    expect(result.terminal).toBe(true)
    await publishProductProductionV1(f)
    await beginProductProductionEvolutionV1({ ...f, userText: '修订阶段收束条件，保留原发布和试玩', affectedLanes: ['runtime'] })
    const production = (await db.productProductions.get(f.productionId))!
    const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, production.currentBriefRevision!]).first())!
    return { ...f, production, row, brief: parseProductProductionBriefV3(row.briefJson) }
  }
  async function edited(f: Awaited<ReturnType<typeof pending>>, unrelated = false) {
    const draft = await readTtrpgDraft(f.scope), settings = settingsFromTtrpgDraft(draft)
    if (settings.runFormat !== 'open') throw Error('fixture format')
    settings.openAuthoring.stageClosurePolicy!.triggers = [{ triggerKey: 'stage.author-review', predicate: { op: 'world-turn-at-least', value: 5 },
      summaryPrompt: '整理本阶段已核实与未解决的事项，交由真人确认下一阶段。' }]
    if (unrelated) settings.openingSituation += ' 另一个开场'
    return saveTtrpgDraft(f.scope, draft.revision, settings, '明确修订新版本阶段条件')
  }
  async function current(f: { productionId: number }) {
    const production = (await db.productProductions.get(f.productionId))!
    const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, production.currentBriefRevision!]).first())!
    return { production, row, brief: parseProductProductionBriefV3(row.briefJson) }
  }
  async function authorize(f: Awaited<ReturnType<typeof pending>>) {
    const p = await current(f)
    const result = await executeProductProductionCommand({ scope: f.scope, productionId: f.productionId, command: { type: 'authorize-start',
      commandId: 'stage-policy.explicit-start', expectedStateRevision: p.production.stateRevision,
      briefRevision: p.row.revision, briefHash: p.row.briefHash, authorizationNonce: 'author.stage-policy.confirmed' } })
    expect(result.ok).toBe(true)
  }
  it('requires the separate stage-policy choice and preserves the old budget-only route and original records', async () => {
    const f = await pending(), draft = await edited(f)
    const before = { releases: await db.productReleases.toArray(), builds: await db.productBuilds.toArray(),
      runs: await db.agentRuns.toArray(), worlds: await db.worldReleases.toArray(), rows: await db.productProductionBriefs.toArray() }
    await expect(prepareTtrpgBrief(f.scope, draft.revision)).rejects.toThrow(/只支持调整/)
    expect(await current(f)).toEqual({ production: f.production, row: f.row, brief: f.brief })
    expect(await prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, stagePolicyRevision: 'revise-pending-stage-policy' })).toBe(f.productionId)
    const revised = await current(f)
    expect(revised.brief.ttrpgOpen!.settings.openAuthoring.stageClosurePolicy!.triggers[0].predicate).toEqual({ op: 'world-turn-at-least', value: 5 })
    expect(revised.brief.evolution!.affectedLanes).toEqual(['runtime', 'content'])
    expect(revised.brief.evolution!.userGoal).toBe(f.brief.evolution!.userGoal)
    expect(revised.brief.productionBudget).toEqual(f.brief.productionBudget)
    expect(revised.brief.ttrpgOpen!.sourcePlan).toEqual(f.brief.ttrpgOpen!.sourcePlan)
    expect(revised.row.parentRevision).toBe(f.row.revision); expect(revised.row.status).toBe('draft'); expect(revised.row.authorizedAt).toBeNull()
    expect(await db.productReleases.toArray()).toEqual(before.releases); expect(await db.productBuilds.toArray()).toEqual(before.builds)
    expect(await db.agentRuns.toArray()).toEqual(before.runs); expect(await db.worldReleases.toArray()).toEqual(before.worlds)
    for (const row of before.rows) expect(await db.productProductionBriefs.get(row.id!)).toEqual(row)
  })
  it('actually compiles the new policy only after a separate start while keeping the previous release immutable', async () => {
    const f = await pending(), draft = await edited(f), releases = await db.productReleases.toArray(), oldArtifacts = await db.productBuildArtifacts.toArray()
    await prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, stagePolicyRevision: 'revise-pending-stage-policy' })
    await authorize(f)
    let result = await runOpenBrowserProductionV1(f)
    for (let i = 0; i < 2 && !result.terminal; i++) result = await runOpenBrowserProductionV1(f, true)
    expect(result.terminal).toBe(true)
    const resolved = await resolveProductRuntimeSource({ scope: f.scope,
      source: { kind: 'build', productBuildId: result.buildId!, expectedPreviewHash: result.previewHash }, ttrpgProtocol: 2 })
    try {
      const campaign = resolved.runtimePackage.ttrpg?.campaign
      if (campaign?.version !== 2) throw Error('new Build must retain open protocol2')
      expect(campaign.stageClosurePolicy.triggers[0].predicate).toEqual({ op: 'world-turn-at-least', value: 5 })
      const context = { frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex, sessionFacts: [],
        effectLedger: { storyFacts: {}, socialBalances: {} }, pressure: { clocks: {}, fronts: {} },
        actors: {}, situations: { active: [], templates: [] }, chaos: 0, worldTurn: 5 }
      expect(evaluateTtrpgOpenStageClosureV1({ stageClosurePolicy: campaign.stageClosurePolicy,
        predicateContext: context, worldTurn: 5 })).toMatchObject({ eligible: true, triggerKey: 'stage.author-review', maximumReached: false })
      expect(evaluateTtrpgOpenStageClosureV1({ stageClosurePolicy: campaign.stageClosurePolicy,
        predicateContext: { ...context, worldTurn: 4 }, worldTurn: 4 }).eligible).toBe(false)
      expect(evaluateTtrpgOpenStageClosureV1({ stageClosurePolicy: f.brief.ttrpgOpen!.settings.openAuthoring.stageClosurePolicy!,
        predicateContext: context, worldTurn: 5 }).eligible).toBe(false)
    }
    finally { resolved.mediaResolver.dispose() }
    expect(await db.productReleases.toArray()).toEqual(releases)
    for (const artifact of oldArtifacts) expect(await db.productBuildArtifacts.get(artifact.id!)).toEqual(artifact)
  })
  it('rejects unrelated content changes and invalid decisions without broadening the new revision boundary', async () => {
    const f = await pending(), draft = await edited(f, true), before = await current(f), rows = await db.productProductionBriefs.toArray()
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, stagePolicyRevision: 'revise-pending-stage-policy' })).rejects.toThrow(/只支持调整/)
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, stagePolicyRevision: 'automatic' as never })).rejects.toThrow(/明确选择/)
    expect(await current(f)).toEqual(before); expect(await db.productProductionBriefs.toArray()).toEqual(rows)
  })
  it('rejects a no-op and an initial-work request without creating a new production, model run or replacement Brief', async () => {
    const f = await pending(), draft = await readTtrpgDraft(f.scope), before = await current(f)
    const rows = await db.productProductionBriefs.toArray(), runs = await db.agentRuns.toArray()
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, stagePolicyRevision: 'revise-pending-stage-policy' })).rejects.toThrow(/未变化/)
    expect(await current(f)).toEqual(before); expect(await db.productProductionBriefs.toArray()).toEqual(rows)
    const fresh = await createFreshOpenDraftFixtureV1()
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: fresh.scope, revision: fresh.draft.revision, stagePolicyRevision: 'revise-pending-stage-policy' })).rejects.toThrow(/发布后新版本/)
    expect(await db.productProductions.count()).toBe(1); expect(await db.productProductionBriefs.toArray()).toEqual(rows)
    expect(await db.agentRuns.toArray()).toEqual(runs)
  })
  it('retains the original CAS basis if author-start races the explicit policy revision', async () => {
    const f = await pending(), draft = await edited(f), original = consultation.draftTtrpgOpenProductionCommonBriefV3
    vi.spyOn(consultation, 'draftTtrpgOpenProductionCommonBriefV3').mockImplementationOnce(async input => {
      const result = await original(input); await authorize(f); return result
    })
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, stagePolicyRevision: 'revise-pending-stage-policy' }))
      .rejects.toThrow(/state|revision|过期|冲突|变化/i)
    expect((await db.productProductions.get(f.productionId))!.status).toBe('producing')
    expect(await db.productProductions.count()).toBe(1)
    expect(await db.productProductionBriefs.where('productionId').equals(f.productionId).count()).toBe(f.row.revision)
  })
})
