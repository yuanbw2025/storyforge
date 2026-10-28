import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { prepareAvgAssemblyBriefV1, startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { deriveAvgAssemblyRecoveryBaseV1 } from '../../src/lib/avg/assembly-recovery'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { authorizeProductProductionStartV1, beginProductProductionEvolutionV1, readProductProductionDetailsV1, stopProductProductionV1 } from '../../src/lib/product-production/service'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { avgV5WorkbenchPreparationFixture } from '../helpers/avg-v5-workbench-preparation-fixture'
import { adoptAvgV5Sources, avgV5RegisteredProposalsFixture, cycleAvgV5Until } from '../helpers/avg-v5-registered-proposals-fixture'
import type { WorkspaceScope } from '../../src/lib/types'

beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
  vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING', '1')
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://v5-proposal.fixture.invalid/v1', apiKey: 'test-only-no-external-network', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external provider allowed') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); db.close() })

async function stoppedVisual(version: 4 | 5, startPlan = true) {
  const fixture = version === 4 ? await avgVisualPlanningFixtureV4() : await avgV5WorkbenchPreparationFixture()
  const scope = fixture.owner.scope
  const planning = version === 4 ? (() => {
    const frozen = (fixture as Awaited<ReturnType<typeof avgVisualPlanningFixtureV4>>).planning.scope
    const { sourceInputHash: _hash, aspectRatio: _ratio, ...authorScope } = frozen
    return authorScope
  })() : (fixture as Awaited<ReturnType<typeof avgV5WorkbenchPreparationFixture>>).planning
  const prepared = await prepareAvgAssemblyBriefV1({ scope, expectedDraftRevision: (await readAvgDraftV1(scope)).revision, visualPlanning: planning })
  if (startPlan) await startAvgAssemblyV1({ scope, productionId: prepared.production.id!, expectedBriefHash: prepared.brief!.briefHash })
  else await authorizeProductProductionStartV1({ scope, details: prepared })
  const started = await readProductProductionDetailsV1(scope, prepared.production.id!, ['avg'])
  await stopProductProductionV1({ scope, production: started.production })
  return { scope, productionId: prepared.production.id!, details: await readProductProductionDetailsV1(scope, prepared.production.id!, ['avg']) }
}

async function retainedEvidence(scope: WorkspaceScope, productionId: number) {
  const details = await readProductProductionDetailsV1(scope, productionId, ['avg'])
  const ids = details.buildHistory.map(build => build.id!)
  return {
    builds: details.buildHistory,
    artifacts: await db.productBuildArtifacts.where('buildId').anyOf(ids).toArray(),
    runs: await db.agentRuns.where('productBuildId').anyOf(ids).toArray(),
    events: await db.agentRunEvents.toArray(),
    blobs: await db.mediaBlobObjects.toArray(),
  }
}

describe('AVG stopped professional visual evolution uses exact frozen recovery provenance', () => {
  it.each([4, 5] as const)('creates a fresh V%s recovery base through the existing command without changing old records or dispatching', async version => {
    const s = await stoppedVisual(version), parent = s.details.build!
    const before = await retainedEvidence(s.scope, s.productionId)
    const result = await beginProductProductionEvolutionV1({ scope: s.scope, productionId: s.productionId,
      expectedStateRevision: s.details.production.stateRevision, userText: '修订本作品专业媒资用途，旧调用保持；重新开始和逐项采用', affectedLanes: ['content', 'product', 'visual', 'audio'] })
    const next = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    const brief = parseProductProductionBriefV3(next.brief!.briefJson)
    expect(next.production.status).toBe('brief-ready')
    expect(next.brief!.revision).toBe(result.briefRevision)
    expect(brief.evolution!.base).toEqual({ kind: 'recovery-build', buildNumber: parent.buildNumber, briefHash: parent.briefHash,
      planHash: parent.planHash, controlEpoch: JSON.parse(parent.planJson).controlEpoch })
    expect(await retainedEvidence(s.scope, s.productionId)).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['active', 'changed-brief', 'changed-plan', 'bad-plan-hash'] as const)('rejects %s instead of accepting a caller-labelled recovery base', async mode => {
    const s = await stoppedVisual(5), build = structuredClone(s.details.build!)
    const brief = parseProductProductionBriefV3(s.details.executionBrief!)
    if (mode === 'active') build.status = 'building'
    if (mode === 'changed-brief') brief.intent.openingSituation += ' changed'
    if (mode === 'changed-plan') build.planJson = '{}'
    if (mode === 'bad-plan-hash') build.planHash = 'b'.repeat(64)
    const before = await retainedEvidence(s.scope, s.productionId)
    await expect(deriveAvgAssemblyRecoveryBaseV1(build, brief, s.scope)).rejects.toThrow()
    expect(await retainedEvidence(s.scope, s.productionId)).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains an authorized but never-executed visual Build as its own exact recovery baseline', async () => {
    const s = await stoppedVisual(5, false), before = await retainedEvidence(s.scope, s.productionId)
    expect(s.details.build!.planRevision).toBe(0)
    expect(s.details.build!.budgetLedgerJson).toBe('{}')
    expect(before.runs).toHaveLength(0)
    await beginProductProductionEvolutionV1({ scope: s.scope, productionId: s.productionId, expectedStateRevision: s.details.production.stateRevision,
      userText: '明确重建未执行版本，保留原授权', affectedLanes: ['content', 'product', 'visual', 'audio'] })
    const next = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(parseProductProductionBriefV3(next.brief!.briefJson).evolution!.base).toEqual({ kind: 'recovery-build', buildNumber: s.details.build!.buildNumber,
      briefHash: s.details.build!.briefHash, planHash: s.details.build!.planHash, controlEpoch: s.details.build!.controlEpoch })
    expect(await retainedEvidence(s.scope, s.productionId)).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps known completed model usage and unknown fees unchanged while creating only a new reviewable Brief', async () => {
    const s = await avgV5RegisteredProposalsFixture()
    await adoptAvgV5Sources(s); await cycleAvgV5Until(s, 'avg.proposal.visual-bible')
    const active = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    await stopProductProductionV1({ scope: s.scope, production: active.production })
    const stopped = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg']), before = await retainedEvidence(s.scope, s.productionId)
    const attempts = JSON.parse(stopped.build!.budgetLedgerJson).attempts
    expect(attempts.some((item: { usageKnown: boolean; usage: { modelCalls: number; costUsd: number | null } }) => item.usageKnown && item.usage.modelCalls === 1 && item.usage.costUsd === null)).toBe(true)
    const calls = s.calls.length
    await beginProductProductionEvolutionV1({ scope: s.scope, productionId: s.productionId, expectedStateRevision: stopped.production.stateRevision,
      userText: '返修已接收方案，保留原响应和未知费用', affectedLanes: ['content', 'product', 'visual', 'audio'] })
    const next = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(parseProductProductionBriefV3(next.brief!.briefJson).evolution!.base).toMatchObject({ kind: 'recovery-build', buildNumber: stopped.build!.buildNumber, planHash: stopped.build!.planHash })
    expect(await retainedEvidence(s.scope, s.productionId)).toEqual(before)
    expect(s.calls).toHaveLength(calls); expect(s.imageCalls).toHaveLength(0)
  })

  it('does not grant a partial-lane or unrelated recovery privilege to the stopped visual product', async () => {
    const s = await stoppedVisual(5), before = await retainedEvidence(s.scope, s.productionId)
    await expect(beginProductProductionEvolutionV1({ scope: s.scope, productionId: s.productionId, userText: '仅视觉不能冒用完整手动重建权限', affectedLanes: ['visual'] })).rejects.toThrow()
    expect(await retainedEvidence(s.scope, s.productionId)).toEqual(before)
    expect((await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).brief!.briefHash).toBe(s.details.brief!.briefHash)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an unresolved actual Harness attempt at the shared evolve command without settling its old hold', async () => {
    const s = await avgV5RegisteredProposalsFixture()
    await adoptAvgV5Sources(s); await cycleAvgV5Until(s, 'avg.proposal.visual-bible')
    const active = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    await stopProductProductionV1({ scope: s.scope, production: active.production })
    const stopped = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    const base = await deriveAvgAssemblyRecoveryBaseV1(stopped.build!, stopped.executionBrief!, s.scope)
    const ledger = JSON.parse(stopped.build!.budgetLedgerJson)
    const attempt = ledger.attempts.find((item: { taskKey: string }) => item.taskKey.startsWith('avg.visual.propose.'))
    expect(attempt).toBeTruthy(); attempt.usageKnown = false; attempt.errorCode = 'provider-result-unknown'
    // Negative corruption only: actual original Run/events/claim remain and
    // cannot be replaced by this changed cached ledger or caller-provided base.
    await db.productBuilds.update(stopped.build!.id!, { budgetLedgerJson: JSON.stringify(ledger) })
    const before = await retainedEvidence(s.scope, s.productionId), calls = s.calls.length
    const result = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: {
      type: 'evolve', commandId: 'reject-unknown-visual-recovery', expectedStateRevision: stopped.production.stateRevision,
      base, userText: '不能以新版本隐藏未知请求', affectedLanes: ['content', 'product', 'visual', 'audio'],
    } })
    expect(result.ok).toBe(false)
    expect(await retainedEvidence(s.scope, s.productionId)).toEqual(before)
    expect(s.calls).toHaveLength(calls); expect(s.imageCalls).toHaveLength(0)
  })
})
