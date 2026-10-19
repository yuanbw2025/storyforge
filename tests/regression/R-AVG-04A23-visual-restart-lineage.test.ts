import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { prepareAvgAssemblyBriefV1, restartAvgVisualPlanningFromDraftV4, restartAvgVisualPlanningFromDraftV5, runAvgAssemblyV1, startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { authorizeProductProductionStartV1, readProductProductionDetailsV1, stopProductProductionV1 } from '../../src/lib/product-production/service'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { avgV5WorkbenchPreparationFixture } from '../helpers/avg-v5-workbench-preparation-fixture'

beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1'); vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING', '1')
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://visual-lineage.fixture.invalid/v1', apiKey: 'test-only-no-network', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Lineage preparation cannot dispatch a provider') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); db.close() })

async function nativeThenVisual(version: 4 | 5) {
  const f = version === 4 ? await avgVisualPlanningFixtureV4() : await avgV5WorkbenchPreparationFixture(), owner = f.owner
  const planning = version === 4 ? (() => {
    const { sourceInputHash: _hash, aspectRatio: _ratio, ...scope } = (f as Awaited<ReturnType<typeof avgVisualPlanningFixtureV4>>).planning.scope
    return scope
  })() : (f as Awaited<ReturnType<typeof avgV5WorkbenchPreparationFixture>>).planning
  const native = await startAvgAssemblyV1({ scope: owner.scope, productionId: owner.productionId, expectedBriefHash: owner.details.brief!.briefHash })
  await stopProductProductionV1({ scope: owner.scope, production: native.production })
  const prepared = await prepareAvgAssemblyBriefV1({ scope: owner.scope, expectedDraftRevision: (await readAvgDraftV1(owner.scope)).revision, visualPlanning: planning })
  expect(parseProductProductionBriefV3(prepared.brief!.briefJson).evolution!.base).toMatchObject({ kind: 'recovery-build', buildNumber: native.build!.buildNumber })
  const visual = await startAvgAssemblyV1({ scope: owner.scope, productionId: owner.productionId, expectedBriefHash: prepared.brief!.briefHash })
  await stopProductProductionV1({ scope: owner.scope, production: visual.production })
  return { ...owner, planning, details: await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg']) }
}

describe('AVG public preparation after a native ancestor and stopped professional parent', () => {
  it.each([4, 5] as const)('V%s freezes the immediate professional parent instead of copying its earlier native ancestor', async version => {
    const s = await nativeThenVisual(version), parent = s.details.build!, old = await db.productBuilds.toArray()
    expect(parent.buildNumber).toBe(2)
    const draft = await readAvgDraftV1(s.scope), restart = version === 4 ? restartAvgVisualPlanningFromDraftV4 : restartAvgVisualPlanningFromDraftV5
    const ready = await restart({ scope: s.scope, productionId: s.productionId, expectedBuildId: parent.id!, expectedBuildRevision: parent.stateRevision, expectedDraftRevision: draft.revision })
    expect(parseProductProductionBriefV3(ready.brief!.briefJson).evolution!.base).toMatchObject({ kind: 'recovery-build', buildNumber: parent.buildNumber, briefHash: parent.briefHash, planHash: parent.planHash })
    expect(await db.productBuilds.toArray()).toEqual(old)
    const child = (await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: ready.brief!.briefHash })).build!
    expect(child).toMatchObject({ status: 'building', parentBuildNumber: parent.buildNumber, planRevision: 1 })
    expect(JSON.parse(child.planJson).buildNumber).toBe(child.buildNumber)
    expect(await db.productBuildArtifacts.where('buildId').equals(child.id!).count()).toBe(0)
    expect(await db.productBuilds.get(parent.id!)).toEqual(parent)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('recovers an old authorized/no-Plan rejection by creating a new exact successor, preserving the bad old Brief and empty attempt', async () => {
    const s = await nativeThenVisual(5), original = s.details, prior = parseProductProductionBriefV3(original.brief!.briefJson)
    // Deliberately reproduce the historical bad pending lineage through public
    // commands. No fake Build/Run/producer or positive acceptance is seeded.
    const saved = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: {
      type: 'save-brief-revision', commandId: 'legacy-pending-grandparent', expectedStateRevision: original.production.stateRevision,
      parentRevision: original.brief!.revision, brief: prior,
    } })
    expect(saved.ok).toBe(true)
    const pending = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    await authorizeProductProductionStartV1({ scope: s.scope, details: pending })
    await expect(runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })).rejects.toThrow(/parent Build/)
    const failedStart = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(failedStart.build!).toMatchObject({ buildNumber: 3, status: 'authorized', planRevision: 0, budgetLedgerJson: '{}', startedAt: null })
    await stopProductProductionV1({ scope: s.scope, production: failedStart.production })
    const stopped = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg']), old = await db.productBuilds.toArray(), oldBrief = await db.productProductionBriefs.get(failedStart.brief!.id!)
    const ready = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision, visualPlanning: s.planning })
    expect(parseProductProductionBriefV3(ready.brief!.briefJson).evolution!.base).toMatchObject({ kind: 'recovery-build', buildNumber: 3, briefHash: stopped.build!.briefHash, planHash: stopped.build!.planHash })
    expect(await db.productBuilds.toArray()).toEqual(old)
    const child = (await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: ready.brief!.briefHash })).build!
    expect(child).toMatchObject({ buildNumber: 4, parentBuildNumber: 3, status: 'building', planRevision: 1 })
    expect(await db.productBuilds.get(stopped.build!.id!)).toEqual(stopped.build)
    expect(await db.productProductionBriefs.get(failedStart.brief!.id!)).toEqual({ ...oldBrief, status: 'superseded' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
