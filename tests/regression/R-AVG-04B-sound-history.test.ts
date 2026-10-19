import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDeepStrictEqual } from 'node:util'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import { avgSoundReviewStartFixtureV1 } from '../helpers/avg-sound-review-fixture'
import { adoptAvgSoundSourcesV1, adoptAvgSoundArtifactV1 } from '../helpers/avg-sound-harness-fixture'
import { runAuthorizedProductProductionV1, readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { runProductProductionSchedulerCycleV1, assertProductProductionBudgetLedgerV1 } from '../../src/lib/product-production/scheduler'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { avgSoundProductionBudgetV1, avgSoundProductionGateIdsV1 } from '../../src/lib/avg/sound-production-policy'
import { saveAvgSoundProductionDraftV1 } from '../../src/lib/avg/sound-draft-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { prepareAvgAssemblyBriefV1 } from '../../src/lib/avg/assembly-service'
import { exportProjectJSON } from '../../src/lib/export/json-export'
import { assertAvgSoundOtherRequestsKnownV1 } from '../../src/lib/avg/visual-planning-restart'
import { mockAvgSoundOggDecoderV1 } from '../helpers/avg-sound-decoder-fixture'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'intercepted-engineering-key-no-external-account',
    model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  // Library import runs alongside the deliberately lost music response. Its
  // unavailable Happy DOM decoder must not accidentally stop the whole Build
  // before this test's original unknown-request precondition is established.
  mockAvgSoundOggDecoderV1()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
const backup = async (projectId: number) => ({ ...await exportProjectJSON(projectId), exportedAt: 0 })

async function heldMusic() {
  const s = await avgSoundReviewStartFixtureV1(); await adoptAvgSoundSourcesV1(s); await runAuthorizedProductProductionV1(s)
  await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)
  let posts = 0
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/audio/music') && init?.method === 'POST') { posts++; throw new TypeError('ENGINEERING unknown original dispatch') }
    return s.fetcher(url, init)
  })
  expect((await runAuthorizedProductProductionV1(s)).buildStatus).toBe('recovery-required'); expect(posts).toBe(1)
  return { ...s, posts: () => posts }
}
function renamedBrief(s: Awaited<ReturnType<typeof heldMusic>>) {
  const brief = structuredClone(s.brief), sound = brief.avgSoundPlanning!
  for (const t of sound.scope.templates) {
    t.requirementKey += '.renamed'; t.assetKey += '.renamed'; t.consumer.consumerKey += '.renamed'; t.cue.cueKey += '.renamed'
  }
  sound.assembly.mediaAssetKeys = sound.scope.templates.map(t => t.assetKey)
  brief.productionBudget = avgSoundProductionBudgetV1(brief)
  brief.completionContract.requiredGateIds = avgSoundProductionGateIdsV1(brief)
  return parseProductProductionBriefV3(brief)
}

describe('AVG Sound unknown requests stay governed across saved drafts and actual Productions', () => {
  it('retains a renamed editable scope but refuses a new prepared Brief before probing routes or replaying a request', async () => {
    const s = await heldMusic(), brief = renamedBrief(s), { sourceInputHash: _hash, ...planning } = brief.avgSoundPlanning!.scope
    const draft = await readAvgDraftV1(s.scope)
    const saved = await saveAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: draft.revision, planning })
    const before = await backup(s.scope.projectId)
    await expect(prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })).rejects.toThrow(/未知|未完成领取/)
    expect(isDeepStrictEqual(await backup(s.scope.projectId), before)).toBe(true); expect(s.posts()).toBe(1); expect(s.calls).toHaveLength(1)
  }, 90_000)
  it('rejects a structurally valid cleared accounting cache by reading actual original Run events', async () => {
    const s = await heldMusic(), row = (await db.productBuilds.get(s.buildId))!, ledger = JSON.parse(row.budgetLedgerJson)
    ledger.rootClaim = null; ledger.tasks = {}; ledger.attempts = []
    const json = JSON.stringify(ledger); expect(() => assertProductProductionBudgetLedgerV1(json)).not.toThrow()
    // Explicit negative corruption only. No Run, author or producer proof is seeded.
    await db.productBuilds.update(s.buildId, { budgetLedgerJson: json })
    await expect(assertAvgSoundOtherRequestsKnownV1(s.scope, null)).rejects.toThrow(/Run|请求|记账/)
    expect(s.posts()).toBe(1); expect(s.calls).toHaveLength(1)
  }, 90_000)
  it('fences actual executor dispatch even when another Production is directly authorized through the existing lower-level commands', async () => {
    const s = await heldMusic(), brief = renamedBrief(s), originalBuild = (await db.productBuilds.get(s.buildId))!
    const created = await executeProductProductionCommand({ scope: s.scope, command: { type: 'create-intent', commandId: `sound.other.intent.${crypto.randomUUID()}`,
      productionKey: `avg.sound.other.${crypto.randomUUID()}`, productType: 'avg', worldReleaseId: brief.source.worldReleaseId, userText: 'ENGINEERING explicitly authorized separate production' } })
    expect(created.ok).toBe(true)
    const productionId = created.productionId
    const saved = await executeProductProductionCommand({ scope: s.scope, productionId, command: { type: 'save-brief-revision', commandId: `sound.other.save.${crypto.randomUUID()}`,
      expectedStateRevision: 0, parentRevision: null, brief } })
    expect(saved.ok).toBe(true)
    const d = await readProductProductionDetailsV1(s.scope, productionId, ['avg'])
    const started = await executeProductProductionCommand({ scope: s.scope, productionId, command: { type: 'authorize-start', commandId: `sound.other.start.${crypto.randomUUID()}`,
      expectedStateRevision: d.production.stateRevision, briefRevision: d.brief!.revision, briefHash: d.brief!.briefHash, authorizationNonce: 'explicit-other-production-no-authority-copy' } })
    expect(started.ok).toBe(true)
    const current = await readProductProductionDetailsV1(s.scope, productionId, ['avg']), buildId = current.build!.id!
    const executor = createConfiguredProductProductionExecutorV1({ production: current.production, brief })
    await runProductProductionSchedulerCycleV1({ scope: s.scope, productionId, executor, capabilityBindings: s.capabilityBindings })
    const build = (await db.productBuilds.get(buildId))!, plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
    const other = { ...s, productionId, buildId, plan, brief, executor }
    await adoptAvgSoundSourcesV1(other)
    await runProductProductionSchedulerCycleV1({ ...other, capabilityBindings: s.capabilityBindings })
    expect((await db.productBuilds.get(buildId))!.status).toBe('recovery-required')
    expect(await db.productBuilds.get(s.buildId)).toEqual(originalBuild)
    expect(s.posts()).toBe(1); expect(s.calls).toHaveLength(1)
  }, 90_000)
})
