import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import {
  hashMasterAgentPlanV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY } from '../../src/lib/agent/workflow-catalog'
import { computeCostUsd } from '../../src/lib/ai/usage-log'
import {
  evaluateAgentHarnessWorkflowGateV1,
  H26_WORKFLOW_PAIRED_THRESHOLDS,
  parseAgentHarnessWorkflowPairedRecordV1,
  runAgentHarnessWorkflowPairedEvalV1,
  verifyAgentHarnessWorkflowPairedRecordV1,
} from '../../src/lib/evals/agent-harness/paired-workflow'
import type {
  AgentHarnessWorkflowExecutionResultV1,
  AgentHarnessWorkflowExecutionV1,
  AgentHarnessWorkflowFixtureV1,
  AgentHarnessWorkflowVariantV1,
} from '../../src/lib/evals/agent-harness/types'
import type { WorkspaceScope } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { backfillResourceUidsV1 } from '../../src/lib/context-gateway/resource-identity'
import { generateWorkCode, generateWorkspaceUid } from '../../src/lib/memory/identity'

const EXECUTION: AgentHarnessWorkflowExecutionV1 = {
  generator: {
    provider: 'custom',
    model: 'h26-generator',
    promptVersion: 'master-agent-workflow-eval-v1',
    toolSchemaVersion: 'agent-tools-v1',
  },
  verifier: {
    provider: 'openai',
    model: 'h26-independent-verifier',
    promptVersion: 'h26-workflow-verifier-v1',
  },
}

async function fixtures(count = 6): Promise<AgentHarnessWorkflowFixtureV1[]> {
  return Promise.all(Array.from({ length: count }, async (_, index) => ({
    id: `paired-${index + 1}`,
    split: 'development' as const,
    contentHash: await hashCanonicalValue({ fixture: index, content: 'private' }),
    inputHash: await hashCanonicalValue({ fixture: index, authorRequest: '同时生成世界与灵感' }),
    planHash: await hashCanonicalValue({ fixture: index, plan: 'frozen-plan-v1' }),
  })))
}

async function syntheticExecution(input: {
  fixture: AgentHarnessWorkflowFixtureV1
  variant: AgentHarnessWorkflowVariantV1
}): Promise<AgentHarnessWorkflowExecutionResultV1> {
  const number = Number(input.fixture.id.split('-').at(-1) ?? 0)
  const fanOut = input.variant === 'fan-out'
  return {
    output: `${input.fixture.id}:${input.variant}:候选`,
    contentHash: input.fixture.contentHash,
    inputHash: input.fixture.inputHash,
    planHash: input.fixture.planHash,
    execution: EXECUTION.generator,
    traceHash: await hashCanonicalValue({ trace: input.fixture.id, variant: input.variant }),
    receiptHashes: await Promise.all([0, 1, 2].map(receipt => hashCanonicalValue({
      receipt,
      fixture: input.fixture.id,
      variant: input.variant,
    }))),
    expectedReceiptCount: 3,
    completed: true,
    successfulSteps: 3,
    failedSteps: 0,
    modelCalls: 3,
    toolCalls: 0,
    inputTokens: fanOut ? 1_100 : 1_000,
    outputTokens: fanOut ? 550 : 500,
    latencyMs: (fanOut ? 80 : 100) + number,
    costUsd: fanOut ? 0.011 : 0.01,
  }
}

describe.sequential('R-HARNESS26 · 顺序/fan-out 配对评测与发布门', { timeout: 20_000 }, () => {
  const originalConfig = useAIConfigStore.getState().config

  beforeEach(async () => {
    await db.delete()
    await db.open()
    globalThis.localStorage?.removeItem(MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY)
    useAIConfigStore.setState({
      config: {
        ...originalConfig,
        provider: 'custom',
        apiKey: '',
        model: EXECUTION.generator.model,
        baseUrl: 'https://h26.invalid/v1',
        maxTokens: 8_000,
        contextWindow: 64_000,
      },
      presets: [],
      taskRoutes: {},
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    globalThis.localStorage?.removeItem(MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY)
    useAIConfigStore.setState({ config: originalConfig, presets: [], taskRoutes: {} })
    db.close()
  })

  it('六组同输入对照交叉执行，质量非劣且 p95、token、cost 达标后才放行', async () => {
    const calls: string[] = []
    const record = await runAgentHarnessWorkflowPairedEvalV1({
      fixtures: await fixtures(),
      split: 'development',
      codeRevision: 'h26-test',
      execution: EXECUTION,
      execute: async input => {
        calls.push(`execute:${input.fixture.id}:${input.variant}`)
        expect(input.generator).toEqual(EXECUTION.generator)
        return syntheticExecution(input)
      },
      verify: async input => {
        calls.push(`verify:${input.fixture.id}:${input.variant}`)
        expect(input.outputHash).toBe(await hashCanonicalValue(input.output))
        expect(input.verifier).toEqual(EXECUTION.verifier)
        return {
          semanticScore: input.variant === 'fan-out' ? 0.89 : 0.9,
          evidenceCoverage: 0.94,
          futureLeakage: false,
          wrongWorldLeakage: false,
        }
      },
      now: () => 1_786_200_000_000,
    })

    expect(calls.slice(0, 4)).toEqual([
      'execute:paired-1:sequential',
      'execute:paired-1:fan-out',
      'verify:paired-1:sequential',
      'verify:paired-1:fan-out',
    ])
    expect(record.gate).toEqual({ passed: true, failures: [] })
    expect(record.aggregate.comparison).toMatchObject({
      semanticQualityRegression: expect.closeTo(0.01),
      evidenceRegression: 0,
      tokenMultiplier: 1.1,
      costMultiplier: expect.closeTo(1.1),
    })
    expect(record.aggregate.comparison.p95LatencyRatio).toBeLessThan(0.9)
    expect(record.artifacts.sequential.metrics.runs).toBe(6)
    expect(record.artifacts.fanOut.fixture.contentHash).toBe(record.fixtureSetHash)
    expect(await verifyAgentHarnessWorkflowPairedRecordV1(record)).toBe(true)
    expect(JSON.stringify(record)).not.toContain('候选')
    expect(JSON.stringify(record)).not.toContain('private')
  })

  it('记录和内嵌 artifact 必须可重算，额外正文、隐藏标签和聚合篡改均被拒绝', async () => {
    const record = await runAgentHarnessWorkflowPairedEvalV1({
      fixtures: await fixtures(),
      split: 'development',
      codeRevision: 'h26-integrity',
      execution: EXECUTION,
      execute: syntheticExecution,
      verify: async () => ({
        semanticScore: 0.9,
        evidenceCoverage: 0.9,
        futureLeakage: false,
        wrongWorldLeakage: false,
      }),
    })

    expect(await verifyAgentHarnessWorkflowPairedRecordV1({
      ...record,
      aggregate: {
        ...record.aggregate,
        fanOut: { ...record.aggregate.fanOut, modelCalls: 999 },
      },
    })).toBe(false)
    expect(await verifyAgentHarnessWorkflowPairedRecordV1({
      ...record,
      artifacts: {
        ...record.artifacts,
        fanOut: {
          ...record.artifacts.fanOut,
          metrics: { ...record.artifacts.fanOut.metrics, latencyMs: 1 },
        },
      },
    })).toBe(false)
    expect(() => parseAgentHarnessWorkflowPairedRecordV1({
      ...record,
      fixtures: [{ ...record.fixtures[0], content: '完整手稿' }, ...record.fixtures.slice(1)],
    })).toThrow('pairedRecord.fixtures[0].content: 未知字段')
    expect(() => parseAgentHarnessWorkflowPairedRecordV1({
      ...record,
      cases: [{ ...record.cases[0], hiddenLabel: '预埋答案' }, ...record.cases.slice(1)],
    })).toThrow('pairedRecord.cases[0].hiddenLabel: 未知字段')
    expect(() => parseAgentHarnessWorkflowPairedRecordV1({
      ...record,
      cases: [{
        ...record.cases[0],
        fanOut: { ...record.cases[0].fanOut, output: '完整生成正文' },
      }, ...record.cases.slice(1)],
    })).toThrow('pairedRecord.cases[0].fanOut.output: 未知字段')
  })

  it('样本、完成、回执、质量、泄漏、延迟、token 和成本任一不足都会阻止发布', async () => {
    const record = await runAgentHarnessWorkflowPairedEvalV1({
      fixtures: await fixtures(),
      split: 'development',
      codeRevision: 'h26-gate',
      execution: EXECUTION,
      execute: syntheticExecution,
      verify: async () => ({
        semanticScore: 0.9,
        evidenceCoverage: 0.9,
        futureLeakage: false,
        wrongWorldLeakage: false,
      }),
    })
    const failedAggregate = structuredClone(record.aggregate)
    failedAggregate.sequential.caseCount = 1
    failedAggregate.fanOut.caseCount = 1
    failedAggregate.sequential.completionRate = 0
    failedAggregate.fanOut.completionRate = 0
    failedAggregate.sequential.receiptCoverage = 0
    failedAggregate.fanOut.receiptCoverage = 0
    failedAggregate.comparison.semanticQualityRegression = 0.03
    failedAggregate.comparison.evidenceRegression = 0.03
    failedAggregate.fanOut.futureLeakageRate = 0.1
    failedAggregate.fanOut.wrongWorldLeakageRate = 0.1
    failedAggregate.comparison.p95LatencyRatio = 1
    failedAggregate.comparison.tokenMultiplier = 1.2
    failedAggregate.sequential.costUsd = 0
    failedAggregate.fanOut.costUsd = 0
    failedAggregate.comparison.costMultiplier = null

    expect(evaluateAgentHarnessWorkflowGateV1({ aggregate: failedAggregate }).failures).toEqual([
      'minimum-paired-cases',
      'sequential-completion',
      'fan-out-completion',
      'sequential-receipt-coverage',
      'fan-out-receipt-coverage',
      'semantic-quality-noninferiority',
      'evidence-noninferiority',
      'fan-out-future-leakage',
      'fan-out-wrong-world-leakage',
      'p95-latency-benefit',
      'token-budget',
      'cost-evidence-missing',
    ])
  })

  it('生成器与评审器身份相同时在任何模型调用前失败', async () => {
    const execute = vi.fn(syntheticExecution)
    await expect(runAgentHarnessWorkflowPairedEvalV1({
      fixtures: await fixtures(1),
      split: 'development',
      codeRevision: 'h26-verifier-independence',
      execution: {
        generator: EXECUTION.generator,
        verifier: {
          provider: EXECUTION.generator.provider,
          model: EXECUTION.generator.model,
          promptVersion: 'judge-v1',
        },
      },
      execute,
      verify: async () => ({
        semanticScore: 1,
        evidenceCoverage: 1,
        futureLeakage: false,
        wrongWorldLeakage: false,
      }),
    })).rejects.toThrow('不同 provider/model 身份')
    expect(execute).not.toHaveBeenCalled()
  })

  it('执行回传的 fixture、input、plan 或生成版本与冻结契约不一致时不产生可比较记录', async () => {
    const [fixture] = await fixtures(1)
    for (const mutation of [
      { inputHash: 'a'.repeat(64) },
      { planHash: 'b'.repeat(64) },
      { contentHash: 'c'.repeat(64) },
      { execution: { ...EXECUTION.generator, promptVersion: 'changed-after-freeze' } },
    ]) {
      await expect(runAgentHarnessWorkflowPairedEvalV1({
        fixtures: [fixture],
        split: 'development',
        codeRevision: 'h26-binding-mismatch',
        execution: EXECUTION,
        execute: async input => ({ ...await syntheticExecution(input), ...mutation }),
        verify: async () => ({
          semanticScore: 1,
          evidenceCoverage: 1,
          futureLeakage: false,
          wrongWorldLeakage: false,
        }),
      })).rejects.toThrow('冻结')
    }
  })

  it('发布阈值只能收紧，且两个变体的预期回执数必须一致后才进入评分', async () => {
    const [fixture] = await fixtures(1)
    expect(() => evaluateAgentHarnessWorkflowGateV1({
      aggregate: {
        sequential: {} as any,
        fanOut: {} as any,
        comparison: {} as any,
      },
      thresholds: { ...H26_WORKFLOW_PAIRED_THRESHOLDS, minimumPairedCases: 1 },
    })).toThrow('不得弱于')

    const verify = vi.fn(async () => ({
      semanticScore: 1,
      evidenceCoverage: 1,
      futureLeakage: false,
      wrongWorldLeakage: false,
    }))
    await expect(runAgentHarnessWorkflowPairedEvalV1({
      fixtures: [fixture],
      split: 'development',
      codeRevision: 'h26-receipt-contract',
      execution: EXECUTION,
      execute: async input => {
        const result = await syntheticExecution(input)
        return input.variant === 'fan-out'
          ? {
              ...result,
              receiptHashes: result.receiptHashes.slice(0, 2),
              expectedReceiptCount: 2,
              successfulSteps: 2,
            }
          : result
      },
      verify,
    })).rejects.toThrow('预期回执数不一致')
    expect(verify).not.toHaveBeenCalled()
  })

  it('真实 durable 主 Agent 以同一冻结计划走顺序与 fan-out，并把逐步回执和 trace 纳入记录', async () => {
    const plan = fanOutPlan()
    const planHash = await hashMasterAgentPlanV1(plan)
    const fixture: AgentHarnessWorkflowFixtureV1 = {
      id: 'durable-master-real-path',
      split: 'development',
      contentHash: await hashCanonicalValue({ world: 'salt-city', inspiration: 'rain-memory' }),
      inputHash: await hashCanonicalValue({ request: '同时建立世界来源并反推灵感，再汇合角色' }),
      planHash,
    }
    const concurrency = new Map<AgentHarnessWorkflowVariantV1, number>()
    let activeVariant: AgentHarnessWorkflowVariantV1 = 'sequential'
    let activeCalls = 0
    let maxActiveCalls = 0
    const usage = new Map<AgentHarnessWorkflowVariantV1, { input: number; output: number }>()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> }
      const prompt = body.messages?.map(message => message.content ?? '').join('\n') ?? ''
      activeCalls += 1
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
      await new Promise(resolve => setTimeout(resolve, 20))
      activeCalls -= 1
      const totals = usage.get(activeVariant) ?? { input: 0, output: 0 }
      totals.input += 100
      totals.output += 40
      usage.set(activeVariant, totals)
      return new Response(JSON.stringify({
        choices: [{ message: { content: modelContent(prompt) } }],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const record = await runAgentHarnessWorkflowPairedEvalV1({
      fixtures: [fixture],
      split: 'development',
      codeRevision: 'h26-real-durable-path',
      execution: EXECUTION,
      execute: async ({ fixture: frozen, variant, generator }) => {
        activeVariant = variant
        maxActiveCalls = 0
        if (variant === 'sequential') {
          globalThis.localStorage?.setItem(MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY, 'disabled')
        } else {
          globalThis.localStorage?.removeItem(MASTER_WORKFLOW_FAN_OUT_STORAGE_KEY)
        }
        const workspace = await createWorkspace(variant)
        const conversation = await getOrCreateAgentConversation({
          projectId: workspace.scope.projectId,
          worldGroupId: workspace.worldGroupId,
          scope: workspace.scope,
        })
        const result = await runDurableMasterAgentPlanV1({
          scope: workspace.scope,
          worldGroupId: workspace.worldGroupId,
          conversationId: conversation.id,
          plan,
          budget: new AgentTeamBudgetTracker('balanced'),
        })
        concurrency.set(variant, maxActiveCalls)
        const snapshot = await readAgentRunV1(workspace.scope, result.runId)
        const receipts = Object.values(result.projection.steps)
          .map(step => step.verificationReceiptHash)
          .filter((hash): hash is string => Boolean(hash))
        const tokens = usage.get(variant) ?? { input: 1, output: 1 }
        return {
          output: [...result.candidates]
            .sort((left, right) => left.payload.taskId.localeCompare(right.payload.taskId))
            .map(candidate => candidate.draft)
            .join('\n\n'),
          contentHash: frozen.contentHash,
          inputHash: frozen.inputHash,
          planHash: frozen.planHash,
          execution: generator,
          traceHash: await hashCanonicalValue(snapshot.events),
          receiptHashes: receipts,
          expectedReceiptCount: plan.tasks.length,
          completed: result.candidates.length === plan.tasks.length && receipts.length === plan.tasks.length,
          successfulSteps: result.candidates.length,
          failedSteps: 0,
          modelCalls: result.budgetEvidence.calls,
          toolCalls: 0,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          // The mocked provider has a fixed 20 ms service delay per call.
          // Report its deterministic critical path; host test-runner load is
          // unrelated to the workflow release metric under test.
          latencyMs: variant === 'fan-out' ? 40 : 60,
          costUsd: computeCostUsd(generator.model, tokens.input, tokens.output),
        }
      },
      verify: async ({ output }) => ({
        semanticScore: output.includes('守忆者') ? 1 : 0,
        evidenceCoverage: output.includes('潮汐') && output.includes('记忆') ? 1 : 0,
        futureLeakage: false,
        wrongWorldLeakage: false,
      }),
    })

    expect(concurrency.get('sequential')).toBe(1)
    expect(concurrency.get('fan-out')).toBe(2)
    expect(record.cases[0].sequential.receiptHashes).toHaveLength(3)
    expect(record.cases[0].fanOut.receiptHashes).toHaveLength(3)
    expect(record.cases[0].sequential.outputHash).toBe(record.cases[0].fanOut.outputHash)
    expect(record.gate).toMatchObject({ passed: false, failures: ['minimum-paired-cases'] })
    expect(await verifyAgentHarnessWorkflowPairedRecordV1(record)).toBe(true)
    expect(await db.worldviews.count()).toBe(0)
    expect(await db.characters.count()).toBe(0)
  })
})

const inspirationResult = {
  worldview: {
    worldOrigin: '旧城由一场遗忘诞生',
    powerHierarchy: '',
    continentLayout: '',
    climateByRegion: '',
    races: '',
    factionLayout: '',
  },
  history: { overview: '' },
  storyCore: {
    logline: '守塔人追查被雨抹去的名字',
    theme: '记忆',
    centralConflict: '保存与遗忘',
    plotPattern: '探索',
    mainPlot: '寻找旧城失忆的源头',
  },
  characters: [],
}

function modelContent(prompt: string): string {
  if (prompt.includes('反推灵感中的记忆冲突')) return JSON.stringify(inspirationResult)
  if (prompt.includes('根据两个上游候选设计守忆者角色')) {
    return JSON.stringify({
      name: '守忆者',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'lawful',
      relationships: '守护盐城记忆',
      shortDescription: '负责记录被雨抹去之名的人。',
    })
  }
  return '潮汐退去之后，第一座盐城从海床苏醒，并以月轮记录文明纪年。'
}

function fanOutPlan(): MasterAgentPlan {
  return {
    summary: '并行生成彼此独立的世界来源和灵感反推候选。',
    tasks: [
      {
        id: 'world-1',
        agentId: 'world-origin',
        skillId: 'world-origin.complete',
        instruction: '建立潮汐退去后盐城苏醒的世界来源。',
        dependsOn: [],
      },
      {
        id: 'inspiration-1',
        agentId: 'inspiration',
        skillId: 'inspiration.reverse',
        instruction: '反推灵感中的记忆冲突。',
        dependsOn: [],
      },
      {
        id: 'character-1',
        agentId: 'character',
        skillId: 'character.create',
        instruction: '根据两个上游候选设计守忆者角色。',
        dependsOn: ['world-1', 'inspiration-1'],
      },
    ],
    workflow: {
      version: 1,
      workflowId: 'multi-domain-fan-out',
      reasonCodes: ['explicit-independent-fan-out', 'multiple-explicit-domains'],
    },
  }
}

async function createWorkspace(variant: AgentHarnessWorkflowVariantV1): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(),
    name: `HARNESS-26 ${variant}`,
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,


    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: `h26-${variant}`,
    name: '盐城世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '盐城作品',
    code: generateWorkCode(),
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  const worldGroupId = await db.worldGroups.add({
    projectId,
    worldId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  await db.inspirationWorkspaces.add({
    projectId,
    worldId,
    workId,
    fragments: JSON.stringify([{
      id: 'rain-memory',
      text: '旧城每次下雨都会忘记一个人',
      label: '城市规则',
      sourceKind: 'author',
      createdAt: now,
    }]),
    versions: '[]',
    createdAt: now,
    updatedAt: now,
  } as any)
  await backfillResourceUidsV1(projectId)
  return { scope: { projectId, worldId, workId }, worldGroupId }
}
