/** Real scheduler/executor and isolated IndexedDB. All text transports below
 * are explicit fixtures; no remote provider or author browser is exercised. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'

describe('R-PROD exact pre-entry abort usage', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  async function fixture() {
    const f = await seedOpenBrowserProductionV1(), details = await readProductProductionDetailsV1(f.scope, f.productionId)
    const brief = parseProductProductionBriefV3(details.executionBrief ?? details.brief!.briefJson)
    return { ...f, brief, production: details.production, buildId: details.build!.id! }
  }
  async function run(f: Awaited<ReturnType<typeof fixture>>, beforeEntry: boolean) {
    const controller = new AbortController(), boundaries: string[] = []
    let calls = 0
    const runText: ProductionTextRunnerV1 = async () => {
      calls++
      // The entry guard has already passed. No trusted result proves whether
      // an external operation was accepted; keep the existing unknown hold.
      throw new DOMException('fixture observing transport aborted', 'AbortError')
    }
    const requirement = f.brief.capabilityRequirements.find(r => r.mediaClass === 'text')!
    const result = await runProductProductionUntilBlockedV1({ scope: f.scope, productionId: f.productionId,
      signal: controller.signal, executor: createConfiguredProductProductionExecutorV1({ production: f.production, brief: f.brief, runText }),
      capabilityBindings: [{ requirementKey: requirement.requirementKey, adapterId: 'configured-text.v1', bindingHash: 'a'.repeat(64) }],
      onDurableBoundary: async boundary => {
        boundaries.push(boundary)
        // This is a logical scheduler boundary, not evidence of a physical
        // provider send. The exact configured-executor entry comes afterward.
        if (beforeEntry && boundary === 'provider.requested') controller.abort('fixture-owned-cancel-before-executor')
      },
    })
    const build = (await db.productBuilds.get(f.buildId))!, ledger = JSON.parse(build.budgetLedgerJson)
    const attempts = ledger.attempts.filter((a: { taskKey: string; attempt: number }) => a.taskKey === 'ttrpg.open.source-facts' && a.attempt > 0)
    return { result, build, attempts, calls, boundaries }
  }
  it('settles a new cancellation at the exact entry guard as known zero without a transport call or hidden retry', async () => {
    const f = await fixture(), result = await run(f, true)
    expect(result.boundaries).toContain('provider.requested'); expect(result.calls).toBe(0)
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0]).toMatchObject({ usageKnown: true, errorCode: 'task-aborted', usage: {
      modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: 0, storageBytes: 0,
    } })
    expect(JSON.parse(result.build.failureJson).code).toBe('task-aborted')
    expect(result.build.status).toBe('recovery-required')
  })
  it('continues preserving unknown usage when cancellation occurs inside an already entered transport', async () => {
    const f = await fixture(), result = await run(f, false)
    expect(result.calls).toBe(1); expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0].usageKnown).toBe(false)
    expect(result.build.status).toBe('recovery-required')
  })
  it('does not rewrite an earlier unknown attempt when another Work gets a proven zero-call cancellation', async () => {
    const old = await fixture(), unknown = await run(old, false)
    expect(unknown.calls).toBe(1); expect(unknown.attempts[0].usageKnown).toBe(false)
    const oldRuns = await db.agentRuns.where('productBuildId').equals(old.buildId).toArray()
    const oldRaw = await db.agentRunArtifacts.where('projectId').equals(old.scope.projectId).toArray()
    const next = await fixture(), zero = await run(next, true)
    expect(zero.calls).toBe(0); expect(zero.attempts[0].usageKnown).toBe(true)
    expect(await db.productBuilds.get(old.buildId)).toEqual(unknown.build)
    expect(await db.agentRuns.where('productBuildId').equals(old.buildId).toArray()).toEqual(oldRuns)
    expect(await db.agentRunArtifacts.where('projectId').equals(old.scope.projectId).toArray()).toEqual(oldRaw)
  })
})
