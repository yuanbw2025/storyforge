import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  assertProductProductionBudgetLedgerV1,
  runProductProductionSchedulerCycleV1,
  runProductProductionUntilBlockedV1,
  ProductProductionDraftRejectedErrorV1,
  type ProductProductionTaskExecutionResultV1,
  type ProductProductionTaskExecutorV1,
} from '../../src/lib/product-production/scheduler'
import type { ProductBuildArtifactKindV1, ProductRuntimePackageV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { resolveProductProductionWorldCompilationDescriptorsV2 } from '../../src/lib/product-production/world-source'
import { AIError } from '../../src/lib/types'
import { AICompletionResponseErrorV1 } from '../../src/lib/ai/completion-response'
import { readProductProductionTaskEvidenceV1 } from '../../src/lib/product-production/service'
import { readProductProductionRepairFeedback } from '../../src/lib/product-production/context'

async function fixture(name: string, extraFacts: string[] = []) {
  const owned = await seedCurrentProductWorld(name)
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'avg', scale: 'scene', visualLevel: 'none', audioLevel: 'none',
    requiredFacts: ['冻结世界事实保持一致', ...extraFacts], forbiddenChanges: ['不得写回世界正式表'],
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: `${name}.intent`, productionKey: `${name}.production`,
      productType: 'avg', worldReleaseId: release.id!, userText: `${name} 自动生产`,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: `${name}.brief`, expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: `${name}.start`, expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: `${name}.click`,
    },
  })
  return { ...owned, productionId: created.productionId, brief }
}

function packageFor(brief: Awaited<ReturnType<typeof fixture>>['brief'], productionKey: string): ProductRuntimePackageV1 {
  return {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'avg',
    definition: {
      productKey: productionKey, title: '耐久调度游戏', description: '自动生产测试',
      enabledCapabilities: ['narrative', 'presentation'], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: { contentHash: brief.source.worldContentHash, selection: brief.source.selection },
    narrative: {
      moduleKind: 'main', moduleTitle: '耐久调度故事', entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', title: '开场', summary: '从这里开始', kind: 'entry', conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending'] },
        { key: 'ending', title: '结束', summary: '完成', kind: 'ending', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '故事开始。', order: 0 },
        { beatKey: 'beat.ending', nodeKey: 'ending', kind: 'narration', speakerKey: null, text: '故事结束。', order: 0 },
      ],
      choices: [{
        choiceKey: 'choice.continue', sourceNodeKey: 'opening', targetNodeKey: 'ending',
        text: '继续', description: '走向结局', unavailableReason: '',
        displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0,
      }],
    },
    presentation: { version: 1, cues: [], assets: [] },
  }
}

function executorFor(
  input: Awaited<ReturnType<typeof fixture>>,
  calls: Map<string, number>,
  concurrency: { active: number; peak: number; proveSiblingOverlap?: boolean; overlapWaiters?: Array<() => void> },
): ProductProductionTaskExecutorV1 {
  return async request => {
    calls.set(request.task.taskKey, (calls.get(request.task.taskKey) ?? 0) + 1)
    concurrency.active++
    concurrency.peak = Math.max(concurrency.peak, concurrency.active)
    // These two sibling tasks must be selected in the same scheduler cycle.
    // A deterministic barrier proves actual overlap without depending on real
    // timers, which unrelated full-suite fake-timer cases can starve.
    if (concurrency.proveSiblingOverlap
      && (request.task.taskKey === 'content.narrative' || request.task.taskKey === 'media.requirements')) {
      await new Promise<void>(resolve => {
        const waiters = concurrency.overlapWaiters ??= []
        waiters.push(resolve)
        if (waiters.length === 2) {
          concurrency.overlapWaiters = []
          waiters.forEach(release => release())
        }
      })
    }
    let payload: unknown = { taskKey: request.task.taskKey, inputs: request.inputArtifacts.map(row => row.contentHash) }
    if (request.task.taskKey === 'integration.package') {
      payload = packageFor(input.brief, `${input.productionId}.scheduler`)
    } else if (request.task.taskKey === 'qa.release') {
      const packageHash = request.inputArtifacts.find(row => row.artifactKey === 'runtime.package')!.contentHash
      payload = {
        schema: 'storyforge.product-build-quality-report', version: 1,
        buildNumber: request.buildNumber, packageHash,
        hardGateResults: input.brief.completionContract.requiredGateIds.map(gateId => ({
          gateId, passed: true, evidence: [`task:${request.task.taskKey}`],
        })),
        softGateResults: [], mediaCoverage: 1, playable: true, releaseReady: true, warnings: [],
      }
    }
    const kindByTask: Record<string, ProductBuildArtifactKindV1> = {
      'content.design': 'product-design', 'content.narrative': 'narrative',
      'content.product-module': 'product-module', 'media.requirements': 'asset-manifest',
      'integration.package': 'presentation', 'qa.release': 'quality-report',
    }
    const result: ProductProductionTaskExecutionResultV1 = {
      artifacts: [{
        artifactKey: request.task.outputArtifactKeys[0], kind: kindByTask[request.task.taskKey],
        payload, rights: { origin: 'test-executor', commercialUse: true, license: 'test' },
      }],
      passedGateIds: [...request.task.acceptanceGateIds],
      usage: {
        modelCalls: request.task.executionMode === 'model' ? 1 : 0,
        inputTokens: request.task.executionMode === 'model' ? 10 : 0,
        outputTokens: request.task.executionMode === 'model' ? 10 : 0,
        mediaCalls: 0, costUsd: 0, durationMs: 1, storageBytes: 0,
      },
    }
    concurrency.active--
    return result
  }
}

describe('R-PRODUCTPROD-1D · durable bounded DAG scheduler', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  beforeEach(async () => {
    // Repeated versionchange/delete cycles can leave fake-indexeddb waiting on
    // an old Dexie connection under the full coverage run. These tests only
    // require row isolation, so clear the already-open schema atomically.
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map(table => table.clear()))
    })
  })
  afterAll(() => db.close())

  it('结构校验失败前保留模型原文证据，失败候选不成为正式产物', async () => {
    const owned = await fixture('scheduler-rejected-output')
    const raw = '{"scene":"未完成的候选"'
    let calls = 0
    const result = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: async request => {
        calls++
        await request.onModelOutput?.(raw)
        throw new ProductProductionDraftRejectedErrorV1('JSON 不完整', {
          modelCalls: 1, inputTokens: 100, outputTokens: 10, mediaCalls: 0,
          costUsd: null, durationMs: 100, storageBytes: 0,
        })
      },
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }],
    })
    expect(result.tasks.find(item => item.taskKey === 'content.design')?.status).toBe('blocked')
    expect((await db.agentRunArtifacts.toArray()).some(item => item.artifactKind === 'raw-response' && item.content === raw)).toBe(true)
    expect(await db.productBuildArtifacts.count()).toBe(0)
    expect(calls).toBe(1)
    expect(result.budget.usage.modelCalls).toBe(1)
    expect(result.budget.usage.costUsd).toBeNull()
    const evidence = await readProductProductionTaskEvidenceV1({
      scope: owned.scope, productionId: owned.productionId, taskKey: 'content.design',
    })
    expect(evidence.some(item => item.kind === 'raw-response' && item.content === raw)).toBe(true)
    expect(evidence.some(item => item.kind === 'tool-result' && item.content.includes('JSON 不完整'))).toBe(true)
    const repair = JSON.parse(await readProductProductionRepairFeedback({
      projectId: owned.scope.projectId, scope: owned.scope, productProductionId: owned.productionId,
      productBuildId: result.buildId, productProductionTaskKey: 'content.design',
    }))
    expect(repair.previous.evidence.some((item: { content: string }) => item.content === raw)).toBe(true)
    const other = await fixture('scheduler-other-owner')
    await expect(readProductProductionTaskEvidenceV1({
      scope: other.scope, productionId: owned.productionId, taskKey: 'content.design',
    })).rejects.toThrow()
  })

  it.each([
    new AIError(401, 'invalid token'),
    new AICompletionResponseErrorV1('empty', 'content=0; finish=length'),
  ])('授权拒绝与空响应不隐藏重试: %s', async error => {
    const owned = await fixture('scheduler-nonretryable')
    let calls = 0
    const input = { scope: owned.scope, productionId: owned.productionId,
      executor: async () => { calls++; throw error },
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }] }
    const result = await runProductProductionUntilBlockedV1(input)
    expect(calls).toBe(1)
    expect(result.tasks.find(item => item.taskKey === 'content.design')?.status).toBe('blocked')
    await runProductProductionUntilBlockedV1(input)
    expect(calls).toBe(1)
  })

  it('长 Brief 超过单源软上限仍全文交付；尾部约束与 V3 证据一致', async () => {
    const owned = await fixture('scheduler-long-contract', Array.from({ length: 6 }, (_, i) => `${i}：${'潮'.repeat(800)}`))
    const calls = new Map<string, number>()
    const executor = executorFor(owned, calls, { active: 0, peak: 0 })
    const projection = await runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: async request => {
        expect(request.contextText).toContain('不得写回世界正式表')
        expect(request.contextText).not.toContain('…（上下文已截断）')
        for (const fact of owned.brief.intent.requiredFacts) expect(request.contextText).toContain(fact)
        return executor(request)
      },
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }],
    })
    const task = projection.tasks.find(item => item.taskKey === 'content.design')!
    expect(task.status).toBe('completed')
    expect(calls.get('content.design')).toBe(1)
    const evidence = await readContextGatewayManifestV3ForAttemptV1({ scope: owned.scope,
      runId: task.runId!, stepId: 'content.design', attempt: 1 })
    const source = evidence.manifest.sources.find(item => item.key === 'product-production.brief')!
    expect(source.delivery).toBe('full')
    expect(source.originalTokens).toBeGreaterThan(8000)
    expect(source.tokens).toBe(source.originalTokens)
  })

  it('超过任务总预算在调用前持久化阻塞；重新调度不自动花费模型调用', async () => {
    const owned = await fixture('scheduler-oversized-contract', Array.from({ length: 20 }, (_, i) => `${i}：${'潮'.repeat(1900)}`))
    const calls = new Map<string, number>()
    const input = { scope: owned.scope, productionId: owned.productionId,
      executor: executorFor(owned, calls, { active: 0, peak: 0 }),
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }] }
    const projection = await runProductProductionUntilBlockedV1(input)
    expect(calls.size).toBe(0)
    expect(projection.tasks.find(item => item.taskKey === 'content.design')?.status).toBe('blocked')
    const build = await db.productBuilds.get(projection.buildId)
    expect(build?.status).toBe('recovery-required')
    expect(build?.failureJson).toContain('task-context-budget-exceeded')
    await runProductProductionUntilBlockedV1(input)
    expect(calls.size).toBe(0)
  })

  it('从授权 Brief 自主并行执行 DAG、冻结 child receipts、编译 Preview 并完成 root join', async () => {
    const owned = await fixture('scheduler-parallel')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0, proveSiblingOverlap: true }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: executorFor(owned, calls, concurrency),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(projection.terminal).toBe(true)
    expect(projection.tasks.every(task => task.status === 'completed')).toBe(true)
    expect(projection.budget.usage.modelCalls).toBeGreaterThan(0)
    expect(projection.budget.usage.modelCalls).toBeLessThanOrEqual(projection.budget.limits.maximumModelCalls)
    expect(projection.budget.usage.storageBytes).toBeLessThanOrEqual(projection.budget.limits.maximumStorageBytes)
    expect(concurrency.peak).toBeGreaterThanOrEqual(2)
    expect([...calls.values()].every(count => count === 1)).toBe(true)
    const build = await db.productBuilds.get(projection.buildId)
    expect(build).toMatchObject({ status: 'release-ready' })
    expect(build!.rootTerminalReceiptHash).toBe((await db.agentRuns.get(projection.rootRunId))!.terminalReceiptHash)
    const children = await db.agentRuns.where('productBuildId').equals(projection.buildId).toArray()
    expect(children.filter(row => row.parentRunId === projection.rootRunId)).toHaveLength(projection.tasks.length)
    expect(new Set(children.filter(row => row.parentRunId === projection.rootRunId).map(row => row.parentRelation)).size)
      .toBe(projection.tasks.length)
    const integrationRun = children.find(row => row.parentRelation === 'task:integration.package')!
    const evidence = await readContextGatewayManifestV3ForAttemptV1({
      scope: owned.scope,
      runId: integrationRun.id!,
      stepId: 'integration.package',
      attempt: 1,
    })
    const catalog = await openWorldSemanticResourceCatalogV1({
      localReleaseRecordId: owned.release.id!,
      expectedProjectId: owned.scope.projectId,
      expectedWorldId: owned.scope.worldId,
    })
    const compilationKeys = resolveProductProductionWorldCompilationDescriptorsV2({
      descriptors: catalog.resources,
      selection: owned.brief.source.selection,
    }).map(descriptor => descriptor.resourceKey)
    const traced = [
      ...evidence.manifest.gateway.retrievalTrace.mandatory,
      ...evidence.manifest.gateway.retrievalTrace.autoSelected,
    ]
    expect(compilationKeys.every(resourceKey => traced.some(decision => (
      decision.resourceKey === resourceKey && decision.depth === 'original'
    )))).toBe(true)
  }, 30_000)

  it('候选检查点后崩溃会从 durable payload 恢复，不重复调用已计费 executor', async () => {
    const owned = await fixture('scheduler-recovery')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    let injected = false
    await expect(runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
      onDurableBoundary(boundary, snapshot) {
        if (!injected && boundary === 'candidate.checkpoint'
          && snapshot.contract.scope.productProduction?.taskKey === 'content.design') {
          injected = true
          throw new Error('injected-process-crash')
        }
      },
    })).rejects.toThrow('injected-process-crash')
    expect(calls.get('content.design')).toBe(1)

    const recovered = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(recovered.terminal).toBe(true)
    expect(calls.get('content.design')).toBe(1)
    expect(await db.agentRunCheckpoints.count()).toBeGreaterThan(0)
    expect((await db.productBuildArtifacts.where('buildId').equals(recovered.buildId).toArray())
      .filter(row => row.artifactKey === 'design.game' && row.status === 'accepted')).toHaveLength(1)
  }, 30_000)

  it('作者暂停并恢复后复用已验收产物，只为新 epoch 补签收据而不重复调用 executor', async () => {
    const owned = await fixture('scheduler-pause-resume')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]

    const partial = await runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(partial.terminal).toBe(false)
    expect(calls.get('content.design')).toBe(1)
    expect([...calls.entries()].filter(([taskKey]) => taskKey !== 'content.design')).toHaveLength(0)

    const beforePause = await db.productProductions.get(owned.productionId)
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'pause', commandId: 'scheduler-pause-resume.pause',
        expectedStateRevision: beforePause!.stateRevision, reason: '作者主动暂停检查进度',
      },
    })
    const paused = await db.productProductions.get(owned.productionId)
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resume', commandId: 'scheduler-pause-resume.resume',
        expectedStateRevision: paused!.stateRevision,
      },
    })

    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(completed.terminal).toBe(true)
    expect([...calls.values()].every(count => count === 1)).toBe(true)
    expect(calls.get('content.design')).toBe(1)

    const designRows = (await db.productBuildArtifacts.where('buildId').equals(completed.buildId).toArray())
      .filter(row => row.artifactKey === 'design.game')
      .sort((left, right) => left.controlEpoch - right.controlEpoch)
    expect(designRows).toHaveLength(2)
    expect(designRows[0]).toMatchObject({ controlEpoch: 0, status: 'invalid' })
    expect(designRows[1]).toMatchObject({
      controlEpoch: 2, status: 'carried-forward', parentArtifactHash: designRows[0].contentHash,
    })
    expect(designRows[1].producerRunId).not.toBeNull()
    expect(designRows[1].producerReceiptHash).not.toBe(designRows[0].producerReceiptHash)
  }, 30_000)

  it('供应商连续失败停在用户 blocker，作者重试后新 epoch 继续且错误信息不泄露密钥', async () => {
    const owned = await fixture('scheduler-user-retry')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const successExecutor = executorFor(owned, calls, concurrency)
    let injectedFailures = 0
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey === 'content.design' && injectedFailures < 2) {
        injectedFailures++
        calls.set(request.task.taskKey, (calls.get(request.task.taskKey) ?? 0) + 1)
        throw new Error('provider 503 api-key=sk-proj-supersecret123')
      }
      return successExecutor(request)
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(blocked.buildStatus).toBe('recovery-required')
    const blockedBuild = (await db.productBuilds.get(blocked.buildId))!
    expect(blockedBuild.failureJson).toContain('[redacted]')
    expect(blockedBuild.failureJson).not.toContain('supersecret')

    const production = (await db.productProductions.get(owned.productionId))!
    const resolved = await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'scheduler-user-retry.resolve',
        expectedStateRevision: production.stateRevision, blockerKey: 'content.design',
        resolution: { action: 'retry', note: '作者确认重试' },
      },
    })
    expect(resolved).toMatchObject({ ok: true, result: { controlEpoch: 1, action: 'retry' } })
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(completed.terminal).toBe(true)
    expect(calls.get('content.design')).toBe(3)
    expect([...calls.entries()].filter(([key]) => key !== 'content.design').every(([, count]) => count === 1)).toBe(true)
  }, 30_000)

  it('provider safety refusal 不自动改写或重试，第一次即暂停等待用户决定', async () => {
    const owned = await fixture('scheduler-safety-refusal')
    let calls = 0
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey === 'content.design') {
        calls += 1
        throw new Error('[product-media-adapter] provider-safety-refusal')
      }
      throw new Error('safety refusal 后不应继续其他任务')
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(calls).toBe(1)
    expect(blocked.buildStatus).toBe('recovery-required')
    expect(blocked.tasks.find(task => task.taskKey === 'content.design')).toMatchObject({ status: 'blocked' })
    expect((await db.productBuilds.get(blocked.buildId))?.failureJson).toContain('provider-safety-refusal')
  }, 30_000)

  it('拒绝带未知字段或伪造结算数据的 budget ledger', () => {
    const emptyLedger = {
      schema: 'storyforge.product-production-budget-ledger', version: 1,
      rootRunId: null, rootClaim: null, tasks: {},
    }
    expect(() => assertProductProductionBudgetLedgerV1(JSON.stringify({
      ...emptyLedger, forgedSettlement: true,
    }))).toThrow('budget ledger 字段不精确')
    expect(() => assertProductProductionBudgetLedgerV1(JSON.stringify({
      ...emptyLedger,
      tasks: {
        'content.design': {
          runId: 1, attempt: 1, status: 'settled', idempotencyKey: '',
          candidateHash: null, terminalReceiptHash: null, passedGateIds: [],
          usage: {
            modelCalls: 1, inputTokens: 10, outputTokens: 10, mediaCalls: 0,
            costUsd: -100, durationMs: 1, storageBytes: 0,
          },
          errorCode: null,
        },
      },
    }))).toThrow('costUsd 无效')
  })
})
