/** Normal authoring/production services with explicit synthetic model replies;
 * no real provider, browser owner data, runtime action or human acceptance. */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import * as consultation from '../../src/lib/product-production/consultation'
import { db } from '../../src/lib/db/schema'
import { readTtrpgDraft, saveTtrpgDraft, prepareTtrpgBrief, prepareTtrpgOpenProductionBriefV3 } from '../../src/lib/ttrpg/authoring-service'
import { settingsFromTtrpgDraft } from '../../src/lib/ttrpg/authoring-contract'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { beginProductProductionEvolutionV1, publishProductProductionV1 } from '../../src/lib/product-production/service'
import { seedOpenBrowserProductionV1, runOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'
import { createFreshOpenDraftFixtureV1 } from '../helpers/open-ttrpg-fresh-authoring'
import { reviseTtrpgOpenPendingRuntimeBriefV1 } from '../../src/lib/ttrpg/open-pending-runtime-brief'

describe('R-TTRPGOPEN2 pending released-version runtime budget', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  async function pending() {
    const f = await seedOpenBrowserProductionV1({ runtimeAIEnabled: true })
    let result = await runOpenBrowserProductionV1(f)
    for (let i = 0; i < 2 && !result.terminal; i++) result = await runOpenBrowserProductionV1(f, true)
    expect(result.terminal).toBe(true)
    await publishProductProductionV1(f)
    await beginProductProductionEvolutionV1({ ...f, userText: '核对新版本的局势完成条件', affectedLanes: ['content'] })
    const production = (await db.productProductions.get(f.productionId))!
    const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, production.currentBriefRevision!]).first())!
    return { ...f, production, row, brief: parseProductProductionBriefV3(row.briefJson) }
  }
  async function saved(f: Awaited<ReturnType<typeof pending>>, edit?: (settings: ReturnType<typeof settingsFromTtrpgDraft>) => void) {
    const draft = await readTtrpgDraft(f.scope), settings = settingsFromTtrpgDraft(draft)
    if (settings.runFormat !== 'open' || !settings.openAuthoring.runtimePolicy) throw Error('fixture open policy missing')
    settings.openAuthoring.runtimePolicy.maximumEpochTokens = 200000
    edit?.(settings)
    return saveTtrpgDraft(f.scope, draft.revision, settings, '新版本配置')
  }
  async function authorize(f: { scope: Awaited<ReturnType<typeof pending>>['scope']; productionId: number }) {
    const production = (await db.productProductions.get(f.productionId))!
    const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, production.currentBriefRevision!]).first())!
    const result = await executeProductProductionCommand({ ...f, command: { type: 'authorize-start',
      commandId: 'pending.budget.explicit.start', expectedStateRevision: production.stateRevision,
      briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'author.separate.start' } })
    expect(result.ok).toBe(true)
  }
  it('saves the actual Work revision in the same pending Production, preserves caps/source/goal/history, and starts separately', async () => {
    const f = await pending(), oldBuilds = await db.productBuilds.toArray(), releases = await db.productReleases.toArray()
    const runs = await db.agentRuns.toArray(), worlds = await db.worldReleases.toArray(), rows = await db.productProductionBriefs.toArray()
    const draft = await saved(f)
    expect(await prepareTtrpgBrief(f.scope, draft.revision)).toBe(f.productionId)
    const production = (await db.productProductions.get(f.productionId))!, row = (await db.productProductionBriefs.where('[productionId+revision]')
      .equals([f.productionId, production.currentBriefRevision!]).first())!, brief = parseProductProductionBriefV3(row.briefJson)
    expect(await db.productProductions.count()).toBe(1)
    expect(production.status).toBe('brief-ready'); expect(production.currentBuildNumber).toBe(f.production.currentBuildNumber)
    expect(brief).toEqual({ ...f.brief, ttrpgOpen: { ...f.brief.ttrpgOpen!, settingsRevision: draft.revision,
      settings: { ...f.brief.ttrpgOpen!.settings, openAuthoring: { ...f.brief.ttrpgOpen!.settings.openAuthoring,
        runtimePolicy: { ...f.brief.ttrpgOpen!.settings.openAuthoring.runtimePolicy!, maximumEpochTokens: 200000 } } } },
      evolution: { ...f.brief.evolution!, affectedLanes: ['content', 'runtime'] } })
    expect(row.status).toBe('draft'); expect(row.authorizedAt).toBeNull(); expect(row.parentRevision).toBe(f.row.revision)
    expect(await db.productBuilds.toArray()).toEqual(oldBuilds); expect(await db.productReleases.toArray()).toEqual(releases)
    expect(await db.agentRuns.toArray()).toEqual(runs); expect(await db.worldReleases.toArray()).toEqual(worlds)
    for (const old of rows) expect(await db.productProductionBriefs.get(old.id!)).toEqual(old)
    expect(await readTtrpgDraft(f.scope)).toMatchObject({ productionId: f.productionId, preparedRevision: draft.revision + 1 })
    await authorize(f)
    const started = (await db.productProductions.get(f.productionId))!, build = (await db.productBuilds.where('[productionId+buildNumber]')
      .equals([f.productionId, started.currentBuildNumber!]).first())!
    expect(build.briefRevision).toBe(row.revision); expect(build.briefHash).toBe(row.briefHash)
    expect(started.currentBuildNumber).toBe(f.production.currentBuildNumber! + 1)
    expect(await db.productReleases.toArray()).toEqual(releases)
  })
  it.each(['opening', 'stage', 'situation'] as const)('refuses unrelated %s changes without replacing the pending lineage', async field => {
    const f = await pending(), draft = await saved(f, settings => {
      if (field === 'opening') settings.openingSituation += ' 改成另一个开场'
      else if (settings.runFormat === 'open' && field === 'stage') settings.openAuthoring.stageClosurePolicy!.maximumWorldTurns++
      else if (settings.runFormat === 'open') settings.openAuthoring.situationTemplates[0].title += ' 另一局势'
    })
    const rows = await db.productProductionBriefs.toArray(), builds = await db.productBuilds.toArray()
    await expect(prepareTtrpgBrief(f.scope, draft.revision)).rejects.toThrow(/只支持调整/)
    expect(await db.productProductions.count()).toBe(1); expect(await db.productProductions.get(f.productionId)).toEqual(f.production)
    expect(await db.productProductionBriefs.toArray()).toEqual(rows); expect(await db.productBuilds.toArray()).toEqual(builds)
    expect((await readTtrpgDraft(f.scope)).revision).toBe(draft.revision)
  })
  it('freezes all existing visible runtime controls from the saved Work while retaining failure and output policies', async () => {
    const f = await pending(), draft = await saved(f, settings => {
      if (settings.runFormat !== 'open') throw Error('fixture format')
      Object.assign(settings.openAuthoring.runtimePolicy!, { enabled: false, maximumCallsPerEpoch: 5,
        maxAiActions: 1, maximumOutputTokens: 3000, maximumEpochCostUsd: 2, maximumRepairAttempts: 1 })
    })
    expect(await prepareTtrpgBrief(f.scope, draft.revision)).toBe(f.productionId)
    const p = (await db.productProductions.get(f.productionId))!, row = (await db.productProductionBriefs
      .where('[productionId+revision]').equals([f.productionId, p.currentBriefRevision!]).first())!
    const brief = parseProductProductionBriefV3(row.briefJson)
    expect(brief.ttrpgOpen!.settings.openAuthoring.runtimePolicy).toEqual({
      ...f.brief.ttrpgOpen!.settings.openAuthoring.runtimePolicy!, enabled: false, maximumCallsPerEpoch: 5,
      maxAiActions: 1, maximumOutputTokens: 3000, maximumEpochTokens: 200000, maximumEpochCostUsd: 2, maximumRepairAttempts: 1,
    })
    expect(brief.productionBudget).toEqual(f.brief.productionBudget)
    expect(brief.evolution!.affectedLanes).toEqual(['content', 'runtime'])
    expect(await db.productBuilds.count()).toBe(1)
  })
  it('rejects an already started evolution instead of creating another Production', async () => {
    const f = await pending(), draft = await saved(f)
    await authorize(f)
    const rows = await db.productProductionBriefs.toArray(), production = await db.productProductions.get(f.productionId)
    await expect(prepareTtrpgBrief(f.scope, draft.revision)).rejects.toThrow(/已开始|尚未开始/)
    expect(await db.productProductions.count()).toBe(1); expect(await db.productProductionBriefs.toArray()).toEqual(rows)
    expect(await db.productProductions.get(f.productionId)).toEqual(production)
  })
  it('never borrows a newer Production state when author-start races source preparation', async () => {
    const f = await pending(), draft = await saved(f), original = consultation.draftTtrpgOpenProductionCommonBriefV3
    vi.spyOn(consultation, 'draftTtrpgOpenProductionCommonBriefV3').mockImplementationOnce(async input => {
      const result = await original(input); await authorize(f); return result
    })
    await expect(prepareTtrpgOpenProductionBriefV3({ scope: f.scope, revision: draft.revision, commandId: 'pending.race.save' }))
      .rejects.toThrow(/state|revision|过期|冲突|变化/i)
    expect(await db.productProductions.count()).toBe(1)
    expect((await db.productProductions.get(f.productionId))!.status).toBe('producing')
    expect(await db.productProductionBriefs.where('productionId').equals(f.productionId).count()).toBe(f.row.revision)
    expect((await readTtrpgDraft(f.scope)).revision).toBe(draft.revision)
  })
  it('protects the same captured state on an initial unstarted Brief too', async () => {
    const f = await createFreshOpenDraftFixtureV1(), productionId = await prepareTtrpgBrief(f.scope, f.draft.revision)
    const draft = await readTtrpgDraft(f.scope), original = consultation.draftTtrpgOpenProductionCommonBriefV3
    vi.spyOn(consultation, 'draftTtrpgOpenProductionCommonBriefV3').mockImplementationOnce(async input => {
      const result = await original(input); await authorize({ scope: f.scope, productionId }); return result
    })
    await expect(prepareTtrpgBrief(f.scope, draft.revision)).rejects.toThrow(/state|revision|过期|冲突|变化/i)
    expect(await db.productProductions.count()).toBe(1); expect(await db.productProductionBriefs.count()).toBe(1)
    expect((await db.productProductions.get(productionId))!.status).toBe('producing')
  })
  it('refuses S2 recompilation of an already active initial Build without forking the Work into another Production', async () => {
    const f = await createFreshOpenDraftFixtureV1(), productionId = await prepareTtrpgBrief(f.scope, f.draft.revision)
    const draft = await readTtrpgDraft(f.scope)
    await authorize({ scope: f.scope, productionId })
    const builds = await db.productBuilds.toArray()
    await expect(prepareTtrpgBrief(f.scope, draft.revision)).rejects.toThrow(/已开始制作/)
    expect(await db.productProductions.count()).toBe(1); expect(await db.productProductionBriefs.count()).toBe(1)
    expect(await db.productBuilds.toArray()).toEqual(builds)
  })
  it('rejects foreign owners, forged baseline hashes and different source selections', async () => {
    const f = await pending(), draft = await saved(f), { ttrpgOpen, ttrpg: _legacy, ...common } = f.brief
    expect(_legacy).toBeUndefined()
    const settings = settingsFromTtrpgDraft(draft)
    if (settings.runFormat !== 'open') throw Error('fixture format')
    const input = { scope: f.scope, production: f.production, row: f.row,
      build: (await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, f.production.currentBuildNumber!]).first())!,
      release: (await db.productReleases.get(f.production.currentProductReleaseId!))!, settingsRevision: draft.revision, settings,
      rulePack: ttrpgOpen!.rulePack, worldReference: ttrpgOpen!.worldReference, common }
    await expect(reviseTtrpgOpenPendingRuntimeBriefV1({ ...input, scope: { ...f.scope, workId: f.scope.workId + 1 } })).rejects.toThrow(/新版本/)
    await expect(reviseTtrpgOpenPendingRuntimeBriefV1({ ...input, row: { ...f.row, briefHash: '0'.repeat(64) } })).rejects.toThrow(/基线|来源/)
    await expect(reviseTtrpgOpenPendingRuntimeBriefV1({ ...input, common: { ...common,
      source: { ...common.source, selection: { ...common.source.selection, resourceKeys: [] } } } })).rejects.toThrow(/只支持调整/)
    expect(await db.productProductions.count()).toBe(1); expect(await db.productProductions.get(f.productionId)).toEqual(f.production)
  })
})
