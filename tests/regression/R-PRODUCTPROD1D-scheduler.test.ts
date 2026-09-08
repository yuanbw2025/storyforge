import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  acceptProductBuildArtifact,
  carryForwardProductBuildArtifactsToEpochV1,
} from '../../src/lib/product-production/artifact-store'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import {
  assertProductProductionBudgetLedgerV1,
  runProductProductionSchedulerCycleV1,
  runProductProductionUntilBlockedV1,
  textAdventureNarrativeRepairPreservesFrozenMediaV1,
  type ProductProductionTaskExecutionResultV1,
  type ProductProductionTaskExecutorV1,
} from '../../src/lib/product-production/scheduler'
import type { ProductBuildArtifactKindV1, ProductRuntimePackageV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { resolveProductProductionWorldCompilationDescriptorsV2 } from '../../src/lib/product-production/world-source'

async function fixture(name: string, options: { retryModelCallHeadroom?: number } = {}) {
  const owned = await seedCurrentProductWorld(name)
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const draftedBrief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'avg', scale: 'scene', visualLevel: 'none', audioLevel: 'none',
    requiredFacts: ['冻结世界事实保持一致'], forbiddenChanges: ['不得写回世界正式表'],
  })
  const brief = options.retryModelCallHeadroom
    ? {
        ...draftedBrief,
        productionBudget: {
          ...draftedBrief.productionBudget,
          maximumModelCalls: draftedBrief.productionBudget.maximumModelCalls
            + options.retryModelCallHeadroom,
        },
      }
    : draftedBrief
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
  it('只有节点、地点与选择衔接修正可以复用冻结媒资，视觉语义改动必须重做媒资链', () => {
    expect(textAdventureNarrativeRepairPreservesFrozenMediaV1([{
      severity: 'blocking', artifactKey: 'content.narrative',
      detail: 'choice.013 的 targetNodeKey 与 scene.008 的 locationOrdinal 错位。',
      recommendation: '修正选择标签与目标节点。',
    }])).toBe(true)
    expect(textAdventureNarrativeRepairPreservesFrozenMediaV1([{
      severity: 'blocking', artifactKey: 'content.narrative',
      detail: 'scene.008 的角色身份与插图视觉锚点不一致。',
      recommendation: '替换图片与服饰。',
    }])).toBe(false)
    expect(textAdventureNarrativeRepairPreservesFrozenMediaV1([{
      severity: 'blocking', artifactKey: 'content.adventure-side-quests',
      detail: '支线地点错位。', recommendation: '重写。',
    }])).toBe(false)
  })

  it('连续恢复中间 epoch 尚未签收时，可按 receipt 与 hash 回溯最近的已验证工件', async () => {
    const f = await fixture('historical-epoch-carry')
    const production = (await db.productProductions.get(f.productionId))!
    const build = (await db.productBuilds.where('[productionId+buildNumber]')
      .equals([f.productionId, production.currentBuildNumber!]).first())!
    const payload = { schema: 'fixture.historical-media', version: 1, value: '已验证媒资需求' }
    const source = await acceptProductBuildArtifact({
      scope: f.scope, buildId: build.id!, controlEpoch: build.controlEpoch,
      artifactKey: 'media.requirements', kind: 'asset-manifest', payload,
      inputHash: 'a'.repeat(64), producerReceiptHash: 'b'.repeat(64),
    })
    await db.productBuildArtifacts.update(source.id!, { status: 'invalid' })
    await db.productBuilds.update(build.id!, { controlEpoch: build.controlEpoch + 2 })

    const carried = await carryForwardProductBuildArtifactsToEpochV1({
      scope: f.scope, buildId: build.id!,
      fromControlEpoch: build.controlEpoch + 1,
      toControlEpoch: build.controlEpoch + 2,
      artifactKeys: ['media.requirements'],
    })
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({
      artifactKey: 'media.requirements', status: 'carried-forward',
      controlEpoch: build.controlEpoch + 2, contentHash: source.contentHash,
      carriedFrom: { version: source.version, contentHash: source.contentHash },
    })
  })

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

  it('任务领取后输入工件丢失会落正式失败回执，不留下永久 running child Run', async () => {
    const owned = await fixture('scheduler-preflight-failure')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    const first = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      capabilityBindings,
    })
    expect(calls.get('content.design')).toBe(1)
    const design = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([first.buildId, 'design.game']).first()
    await db.productBuildArtifacts.delete(design!.id!)
    const designRun = await db.agentRuns
      .where('[parentRunId+parentRelation]')
      .equals([first.rootRunId!, 'task:content.design'])
      .first()
    await db.agentRunCheckpoints.where('runId').equals(designRun!.id!).delete()

    const failed = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      capabilityBindings,
    })
    const narrative = failed.tasks.find(task => task.taskKey === 'content.narrative')
    expect(narrative).toMatchObject({ status: 'blocked', blocker: expect.stringContaining('Artifact 缺失') })
    expect(calls.get('content.narrative')).toBeUndefined()
    const child = await db.agentRuns.get(narrative!.runId!)
    expect(JSON.parse(child!.projectionJson)).toMatchObject({
      state: 'failed',
      steps: { 'content.narrative': { status: 'failed', failureCode: 'task-preflight-failed' } },
    })
    expect((await db.productBuilds.get(first.buildId))!.status).toBe('recovery-required')
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
    const owned = await fixture('scheduler-user-retry', { retryModelCallHeadroom: 2 })
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
    expect(completed.terminal, JSON.stringify({
      status: completed.buildStatus, budget: completed.budget,
      blockers: completed.tasks.filter(task => task.blocker),
    })).toBe(true)
    expect(calls.get('content.design')).toBe(3)
    expect([...calls.entries()].filter(([key]) => key !== 'content.design').every(([, count]) => count === 1)).toBe(true)
    const finalBuild = (await db.productBuilds.get(completed.buildId))!
    const ledger = JSON.parse(finalBuild.budgetLedgerJson) as {
      version: number
      attempts: Array<{ taskKey: string; outcome: string; usageKnown: boolean }>
    }
    expect(ledger.version).toBe(2)
    expect(ledger.attempts.filter(attempt => attempt.taskKey === 'content.design')).toHaveLength(3)
    expect(ledger.attempts.filter(attempt => attempt.taskKey === 'content.design' && !attempt.usageKnown)).toHaveLength(2)
    expect(completed.budget.usage.modelCalls).toBe(6)
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

  it('已付费结果超出单任务预留时记录真实用量并立即暂停，不盲目自动重试', async () => {
    const owned = await fixture('scheduler-task-budget-exceeded')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const basePlan = await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(owned.brief),
      brief: owned.brief,
    })
    const plan = {
      ...basePlan,
      tasks: basePlan.tasks.map(task => task.taskKey === 'content.design'
        ? {
            ...task,
            maxAttempts: 2,
            budgetReservation: { ...task.budgetReservation, outputTokens: 5 },
          }
        : task),
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: executorFor(owned, calls, concurrency),
      suppliedPlan: plan,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(calls.get('content.design')).toBe(1)
    expect(blocked.buildStatus).toBe('recovery-required')
    expect(blocked.tasks.find(task => task.taskKey === 'content.design')).toMatchObject({
      status: 'blocked', attempt: 1, blocker: expect.stringContaining('outputTokens=10/5'),
    })
    expect(blocked.budget.usage).toMatchObject({ modelCalls: 1, inputTokens: 10, outputTokens: 10 })
    expect((await db.productBuilds.get(blocked.buildId))?.failureJson).toContain('task-budget-exceeded')
  }, 30_000)

  it('仅容纳 provider 隐藏推理的微小计费偏差，并仍按真实用量计入 Build 总账', async () => {
    const owned = await fixture('scheduler-provider-accounting-tolerance')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const basePlan = await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(owned.brief),
      brief: owned.brief,
    })
    const plan = {
      ...basePlan,
      tasks: basePlan.tasks.map(task => task.taskKey === 'content.design'
        ? { ...task, budgetReservation: { ...task.budgetReservation, outputTokens: 1_000 } }
        : task),
    }
    const baseExecutor = executorFor(owned, calls, concurrency)
    const executor: ProductProductionTaskExecutorV1 = async request => {
      const result = await baseExecutor(request)
      return request.task.taskKey === 'content.design'
        ? { ...result, usage: { ...result.usage, outputTokens: 1_020 } }
        : result
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      suppliedPlan: plan,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(completed).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(completed.budget.usage.outputTokens).toBeGreaterThanOrEqual(1_020)
    const build = await db.productBuilds.get(completed.buildId)
    expect(() => assertProductProductionBudgetLedgerV1(build!.budgetLedgerJson)).not.toThrow()
  }, 30_000)

  it('即使 provider 忽略 abort 也按任务合同强制结算超时，并保存 task-timeout 恢复证据', async () => {
    const owned = await fixture('scheduler-task-timeout')
    const basePlan = await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(owned.brief),
      brief: owned.brief,
    })
    const plan = {
      ...basePlan,
      tasks: basePlan.tasks.map(task => task.taskKey === 'content.design'
        ? { ...task, maxAttempts: 1, timeoutMs: 10 }
        : task),
    }
    let aborted = false
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey !== 'content.design') throw new Error('超时后不应领取下游任务')
      return await new Promise<ProductProductionTaskExecutionResultV1>(() => {
        request.signal.addEventListener('abort', () => {
          aborted = true
        }, { once: true })
      })
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      suppliedPlan: plan,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(aborted).toBe(true)
    expect(blocked.buildStatus).toBe('recovery-required')
    expect((await db.productBuilds.get(blocked.buildId))?.failureJson).toContain('task-timeout')
  })

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
