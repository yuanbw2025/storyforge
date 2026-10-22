import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createFreshOpenDraftFixtureV1 } from '../helpers/open-ttrpg-fresh-authoring'
import { readTtrpgDraft, saveTtrpgDraft, saveTtrpgSourceSelection, prepareTtrpgOpenProductionBriefV3 } from '../../src/lib/ttrpg/authoring-service'
import { suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { assertTtrpgOpenAuthoringDesignSourceCurrentV1, prepareTtrpgOpenAuthoringDesignSourceV1 } from '../../src/lib/ttrpg/open-authoring-design'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import * as provenance from '../../src/lib/ttrpg/open-source-provenance'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { readTtrpgOpenAuthoringDesignContextV1 } from '../../src/lib/ttrpg/open-authoring-design-context'

async function fixture(options: { select?: boolean; ruleVersion?: 1 | 2 } = {}) {
  const made = await createFreshOpenDraftFixtureV1(options.ruleVersion ?? 2)
  const settings = structuredClone(made.settings)
  settings.openAuthoring = { ...settings.openAuthoring, factPolicy: [], situationTemplates: [], openingSituationKeys: [],
    effectPlanTemplates: [], pressure: { clocks: [], fronts: [] }, dynamicEntityTemplates: [] }
  let draft = await saveTtrpgDraft(made.scope, made.draft.revision, settings, '等待辅助设计的空白作者')
  if (options.select !== false) {
    const starts = await suggestProductStartingPoints({ scope: made.scope, worldReleaseId: draft.worldReleaseId! })
    const choice = starts.suggestions.find(item => item.recommendedProductTypes.includes('ttrpg'))!
    draft = await saveTtrpgSourceSelection(made.scope, draft.revision, choice.suggestionKey, starts.selectionDefaults[choice.suggestionKey])
  }
  return { ...made, settings, draft }
}
async function databaseSnapshot() {
  return Promise.all(db.tables.map(async table => [table.name, JSON.stringify(await table.toArray())]))
}
describe('R-TTRPGOPEN2 real saved S2 assisted-design source boundary', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('freezes actual world/rule/explicit selection for an empty design without writing any table or bypassing the formal Brief gate', async () => {
    const { scope, draft } = await fixture(), before = await databaseSnapshot()
    expect(await db.productProductions.count()).toBe(0)
    const preparedAt = draft.updatedAt + 60_000
    vi.spyOn(Date, 'now').mockReturnValue(preparedAt)
    const prepared = await prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: draft.revision })
    const { basisHash, ...body } = prepared.source
    expect(basisHash).toBe(await hashProductProductionValueV2(body))
    expect(prepared.source.settings.openAuthoring.situationTemplates).toEqual([])
    expect(prepared.source.sourcePlan.worldReference.referenceHash).toBe(prepared.source.worldReference.referenceHash)
    expect(prepared.source.rulePack.version).toBe(2)
    expect(prepared.source.sourcePlan.productInstanceKey).toMatch(/^ttrpg-authoring\./)
    expect(prepared.source.sourcePlan.createdAt).toBe(preparedAt)
    expect(Object.isFrozen(prepared.source.sourcePlan)).toBe(true)
    expect(() => { prepared.source.settings.wizard.savedRulePackId = 999 }).toThrow()
    await prepared.assertCurrent()
    vi.mocked(Date.now).mockReturnValue(preparedAt + 1_000)
    const rebuilt = await prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: draft.revision })
    expect(rebuilt.source.sourcePlan.createdAt).toBe(preparedAt + 1_000)
    expect(rebuilt.source.sourcePlan.planHash).not.toBe(prepared.source.sourcePlan.planHash)
    expect(rebuilt.source.basisHash).not.toBe(prepared.source.basisHash)
    const { createdAt: _firstTime, planHash: _firstHash, ...firstPlan } = prepared.source.sourcePlan
    const { createdAt: _secondTime, planHash: _secondHash, ...secondPlan } = rebuilt.source.sourcePlan
    expect(secondPlan).toEqual(firstPlan)
    expect(rebuilt.source.settingsHash).toBe(prepared.source.settingsHash)
    expect(await databaseSnapshot()).toEqual(before)
    await expect(prepareTtrpgOpenProductionBriefV3({ scope, revision: draft.revision })).rejects.toThrow('openAuthoring 尚未完成')
    expect(await db.productProductions.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
  })
  it('requires the author to save the explicit exit selection, instead of silently reading the whole frozen catalogue', async () => {
    const { scope, draft } = await fixture({ select: false }), before = await databaseSnapshot()
    await expect(prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: draft.revision })).rejects.toThrow('保存出口范围')
    expect(await databaseSnapshot()).toEqual(before)
  })
  it('verifies a serialized original source after time advances, while rejecting changed selection and same-revision row bytes', async () => {
    const { scope, draft } = await fixture()
    const { source } = await prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: draft.revision })
    const retained = JSON.parse(JSON.stringify(source)), before = await databaseSnapshot()
    vi.spyOn(Date, 'now').mockReturnValue(source.sourcePlan.createdAt + 60_000)
    await assertTtrpgOpenAuthoringDesignSourceCurrentV1(retained)
    expect(await databaseSnapshot()).toEqual(before)
    const tampered = structuredClone(retained)
    tampered.sourceSelection.resourceKeys = []
    const { basisHash: _oldHash, ...body } = tampered
    tampered.basisHash = await hashProductProductionValueV2(body)
    await expect(assertTtrpgOpenAuthoringDesignSourceCurrentV1(tampered)).rejects.toThrow('不一致')
    await db.ttrpgAuthoringDrafts.update(draft.id!, { updatedAt: draft.updatedAt + 1 })
    await expect(assertTtrpgOpenAuthoringDesignSourceCurrentV1(retained)).rejects.toThrow('不一致')
  })
  it('assembles the complete registered source at an exact revision, refuses omitted scope and atomic truncation, and writes no table', async () => {
    const { scope, draft } = await fixture(), before = await databaseSnapshot()
    const input = { projectId: scope.projectId, scope, sourceKeys: ['ttrpg.open.authoring-design'], ttrpgAuthoringDesignRevision: draft.revision, inputBudgetTokens: 40_000 }
    const assembled = await assembleContext(input)
    expect(assembled.included).toEqual(['ttrpg.open.authoring-design'])
    expect(assembled.sourceEvidence?.[0]).toMatchObject({ key: 'ttrpg.open.authoring-design', delivery: 'full', status: 'included' })
    const source = JSON.parse(assembled.segments[0].content)
    expect(source.revision).toBe(draft.revision)
    expect(source.sourceSelection.resourceKeys.length).toBeGreaterThan(0)
    await assertTtrpgOpenAuthoringDesignSourceCurrentV1(source)
    await expect(assembleContext({ ...input, inputBudgetTokens: 1 })).rejects.toThrow()
    await expect(assembleContext({ ...input, ttrpgAuthoringDesignRevision: undefined })).resolves.toMatchObject({ included: [] })
    await expect(readTtrpgOpenAuthoringDesignContextV1({ ...input, ttrpgAuthoringDesignRevision: undefined })).rejects.toThrow('明确作品')
    await expect(assembleContext({ ...input, ttrpgAuthoringDesignRevision: draft.revision - 1 })).rejects.toThrow('草稿已变化')
    expect(await databaseSnapshot()).toEqual(before)
  })
  it('rejects an old rule or stale/foreign author scope without creating model or production records', async () => {
    const old = await fixture({ ruleVersion: 1 })
    await expect(prepareTtrpgOpenAuthoringDesignSourceV1({ scope: old.scope, revision: old.draft.revision })).rejects.toThrow('旧格式规则')
    const current = await fixture()
    await expect(prepareTtrpgOpenAuthoringDesignSourceV1({ scope: current.scope, revision: current.draft.revision - 1 })).rejects.toThrow('草稿已变化')
    await expect(prepareTtrpgOpenAuthoringDesignSourceV1({ scope: { ...old.scope, workId: current.scope.workId }, revision: current.draft.revision })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
  })
  it('rejects missing boundaries and unsaved house rules rather than asking a model to invent authority', async () => {
    const { scope, draft, settings } = await fixture()
    settings.openAuthoring.runtimePolicy = null
    const saved = await saveTtrpgDraft(scope, draft.revision, settings, '未配置边界')
    await expect(prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: saved.revision })).rejects.toThrow('本桌边界')
    settings.openAuthoring.runtimePolicy = { enabled: false, maximumCallsPerEpoch: 6, maxAiActions: 0, maximumOutputTokens: 2000,
      maximumEpochTokens: 16000, maximumEpochCostUsd: 1, maximumRepairAttempts: 0, failurePolicy: 'pause', unknownResultPolicy: 'pause-and-reconcile', outputMode: 'text' }
    settings.wizard.actionsPerTurn = 2
    const changed = await saveTtrpgDraft(scope, saved.revision, settings, '未保存的村规')
    await expect(prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: changed.revision })).rejects.toThrow('村规')
  })
  it('detects a later author edit or changed rule bytes from the captured basis', async () => {
    const { scope, draft, settings } = await fixture()
    const prepared = await prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: draft.revision })
    settings.openingSituation = '作者在另一个窗口改变目标'
    await saveTtrpgDraft(scope, draft.revision, settings, '新的作者目标')
    await expect(prepared.assertCurrent()).rejects.toThrow('已变化')
    const latest = await readTtrpgDraft(scope), current = await prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: latest.revision })
    await db.ttrpgRulePacks.update(current.source.rulePackId, { contentHash: 'f'.repeat(64) })
    await expect(current.assertCurrent()).rejects.toThrow()
  })
  it('detects an actual world change and a concurrent draft update during source preparation', async () => {
    const { scope, draft } = await fixture()
    const real = provenance.verifyTtrpgOpenAuthoringSourceProvenanceV1
    vi.spyOn(provenance, 'verifyTtrpgOpenAuthoringSourceProvenanceV1').mockImplementationOnce(async input => {
      const result = await real(input)
      await db.ttrpgAuthoringDrafts.update(draft.id!, { revision: draft.revision + 1 })
      return result
    })
    await expect(prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: draft.revision })).rejects.toThrow('已变化')
    const latest = await readTtrpgDraft(scope), prepared = await prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: latest.revision })
    await db.worldReleases.update(latest.worldReleaseId!, { contentHash: 'f'.repeat(64) })
    await expect(prepared.assertCurrent()).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(0); expect(await db.productProductions.count()).toBe(0)
  })
})
