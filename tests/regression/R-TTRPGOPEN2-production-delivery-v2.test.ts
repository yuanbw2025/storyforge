import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openProductionFixtureV1 } from '../helpers/open-ttrpg-production'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1,
  ProductProductionResultUnknownErrorV1 } from '../../src/lib/product-production/scheduler'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import * as sources from '../../src/lib/product-production/source-contracts'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import { estimateTtrpgOpenProductionTextV3 } from '../../src/lib/ttrpg/open-production-wire-budget'
import { ttrpgOpenProductionSystemPromptV1, ttrpgOpenProductionSystemPromptV2, ttrpgOpenProductionSystemPromptV3 } from '../../src/lib/ttrpg/open-production-prompts'
import { TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1, type TtrpgOpenProductionTaskKeyV2 } from '../../src/lib/ttrpg/open-production-bindings'

async function authorized(input: { inputPerTask?: number; legacy?: boolean; profile?: 2 | 3 } = {}) {
  const data = await openProductionFixtureV1(), { scope, productionId, brief } = data
  if (input.inputPerTask) brief.productionBudget.maximumInputTokens = input.inputPerTask * 4
  const original = (await db.productProductions.get(productionId))!
  const saved = await executeProductProductionCommand({ scope, productionId, command: { type: 'save-brief-revision',
    commandId: 'wire.v2.save', expectedStateRevision: original.stateRevision,
    parentRevision: original.currentBriefRevision, brief } })
  expect(saved.ok).toBe(true)
  const ready = (await db.productProductions.get(productionId))!
  const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, ready.currentBriefRevision!]).first())!
  const started = await executeProductProductionCommand({ scope, productionId, command: { type: 'authorize-start',
    commandId: 'wire.v2.start', expectedStateRevision: ready.stateRevision, briefRevision: row.revision,
    briefHash: row.briefHash, authorizationNonce: 'author.explicit.wire.v2' } })
  expect(started.ok).toBe(true)
  const production = (await db.productProductions.get(productionId))!
  const build = (await db.productBuilds.where('productionId').equals(productionId).first())!
  const plan = await createProductProductionPlanV3({ brief, briefHash: row.briefHash,
    buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, ttrpgOpenExecutionProfile: input.legacy ? 2 : input.profile ?? 3 })
  if (input.legacy) for (const task of plan.tasks) if (Object.prototype.hasOwnProperty.call(TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1, task.taskKey)) {
    task.skillId = TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1[task.taskKey as TtrpgOpenProductionTaskKeyV2]
  }
  const requirementKey = brief.capabilityRequirements.find(item => item.mediaClass === 'text')!.requirementKey
  return { ...data, production, build, plan,
    capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash: 'a'.repeat(64) }] }
}

describe('R-TTRPGOPEN2 actual delivery rejects unsafe input before POST and preserves old uncertainty', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it.each([2, 3] as const)('counts the complete static schema inside the original frozen input ceiling and never dispatches on refresh (profile=%s)', async profile => {
    const schemaTokens = profile === 3 ? estimateTtrpgOpenProductionTextV3(ttrpgOpenProductionSystemPromptV3('ttrpg.open.source-facts'))
      : estimateTokens(ttrpgOpenProductionSystemPromptV2('ttrpg.open.source-facts'))
    const data = await authorized({ inputPerTask: schemaTokens - 1, profile })
    const executor = vi.fn(async () => { throw new Error('must not dispatch') })
    const input = { scope: data.scope, productionId: data.productionId, capabilityBindings: data.capabilityBindings, executor, suppliedPlan: data.plan }
    const first = await runProductProductionUntilBlockedV1(input)
    expect(first.buildStatus).toBe('recovery-required'); expect(executor).not.toHaveBeenCalled()
    const build = (await db.productBuilds.get(data.build.id!))!
    expect(build.failureJson).toContain('task-context-budget-exceeded')
    expect(build.failureJson).toContain('完整格式说明已超过原任务剩余输入预算')
    expect(JSON.parse(build.planJson).tasks[0].budgetReservation.inputTokens).toBe(schemaTokens - 1)
    const rows = await db.agentRuns.where('productBuildId').equals(build.id!).toArray()
    for (const row of rows) expect((await readAgentRunV1(data.scope, row.id!)).events.some(event => event.type === 'model.requested')).toBe(false)
    const ledger = build.budgetLedgerJson
    await runProductProductionUntilBlockedV1(input)
    expect(executor).not.toHaveBeenCalled()
    expect((await db.productBuilds.get(build.id!))!.budgetLedgerJson).toBe(ledger)
  })

  it.each(([2, 3] as const).flatMap(profile => (['body', 'duplicate', 'missing', 'hash'] as const).map(kind => ({ profile, kind }))))('refuses a damaged actual Gateway read before the provider boundary: $kind profile=$profile', async ({ profile, kind }) => {
    const data = await authorized({ profile }), original = sources.executeProductProductionWorldGatewayV1
    vi.spyOn(sources, 'executeProductProductionWorldGatewayV1').mockImplementationOnce(async input => {
      const result = await original(input)
      const decisions = [...result.retrievalTrace.mandatory, ...result.retrievalTrace.autoSelected, ...result.retrievalTrace.agentReads]
      const read = decisions.find(item => item.depth === 'full' || item.depth === 'original')!
      expect(read).toBeDefined()
      const snapshot = result.sourceSnapshots.find(item => item.resourceKey === read.resourceKey)!
      if (kind === 'body') snapshot.content = `${snapshot.content}tampered`
      if (kind === 'duplicate') result.sourceSnapshots.push(snapshot)
      if (kind === 'missing') result.sourceSnapshots = result.sourceSnapshots.filter(item => item !== snapshot)
      if (kind === 'hash') read.contentHash = 'f'.repeat(64)
      return result
    })
    const executor = vi.fn(async () => { throw new Error('must not dispatch') })
    const result = await runProductProductionUntilBlockedV1({ scope: data.scope, productionId: data.productionId,
      capabilityBindings: data.capabilityBindings, executor, suppliedPlan: data.plan })
    expect(result.buildStatus).toBe('recovery-required'); expect(executor).not.toHaveBeenCalled()
    const build = (await db.productBuilds.get(data.build.id!))!
    expect(build.failureJson).toContain('世界读取正文与逐资源来源锚点不一致')
    const child = result.tasks.find(task => task.taskKey === 'ttrpg.open.source-facts')!
    expect((await readAgentRunV1(data.scope, child.runId!)).events.some(event => event.type === 'model.requested')).toBe(false)
  })

  it('keeps an old unknown provider result, prompt, Plan and budget hold unchanged across repeated scheduling', async () => {
    const data = await authorized({ legacy: true }), calls: string[] = []
    const execute = createConfiguredProductProductionExecutorV1({ production: data.production, brief: data.brief,
      runText: async request => {
        calls.push(request.system)
        expect(request.system).toBe(ttrpgOpenProductionSystemPromptV1('ttrpg.open.source-facts'))
        expect(request.contextText).not.toContain('storyforge.ttrpg-open-production-world-reads')
        throw new ProductProductionResultUnknownErrorV1()
      } })
    const input = { scope: data.scope, productionId: data.productionId, executor: execute, capabilityBindings: data.capabilityBindings }
    await runProductProductionUntilBlockedV1({ ...input, suppliedPlan: data.plan })
    const before = (await db.productBuilds.get(data.build.id!))!
    expect(before.failureJson).toContain('task-result-unknown'); expect(calls).toHaveLength(1)
    expect(JSON.parse(before.budgetLedgerJson).attempts.some((entry: { usageKnown: boolean }) => entry.usageKnown === false)).toBe(true)
    await runProductProductionUntilBlockedV1(input)
    const after = (await db.productBuilds.get(data.build.id!))!
    expect(calls).toHaveLength(1); expect(after.planJson).toBe(before.planJson)
    expect(after.budgetLedgerJson).toBe(before.budgetLedgerJson)
    expect(JSON.parse(after.planJson).tasks[0].skillId).toBe('product-production.ttrpg-open-source-facts.v1')
  })

  it('does not reconstruct a corrupted frozen old Plan or dispatch a replacement after interruption', async () => {
    const data = await authorized({ legacy: true }), executor = vi.fn(async () => { throw new Error('must not dispatch') })
    await expect(runProductProductionSchedulerCycleV1({ scope: data.scope, productionId: data.productionId,
      executor, suppliedPlan: data.plan, capabilityBindings: data.capabilityBindings,
      onDurableBoundary: boundary => { if (boundary === 'provider.requested') throw new Error('fixture process interruption') },
    })).rejects.toThrow()
    const frozen = (await db.productBuilds.get(data.build.id!))!
    expect(frozen.planRevision).toBeGreaterThan(0); expect(executor).not.toHaveBeenCalled()
    await db.productBuilds.update(frozen.id!, { planJson: '{damaged frozen plan' })
    await expect(runProductProductionSchedulerCycleV1({ scope: data.scope, productionId: data.productionId,
      executor, capabilityBindings: data.capabilityBindings })).rejects.toThrow('冻结 Plan 缺失或损坏')
    const retained = (await db.productBuilds.get(frozen.id!))!
    expect(executor).not.toHaveBeenCalled(); expect(retained.planJson).toBe('{damaged frozen plan')
    expect(retained.planHash).toBe(frozen.planHash); expect(retained.budgetLedgerJson).toBe(frozen.budgetLedgerJson)
  })
})
