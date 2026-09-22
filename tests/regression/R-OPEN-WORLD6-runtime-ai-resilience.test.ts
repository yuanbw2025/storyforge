import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIError } from '../../src/lib/types'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { db } from '../../src/lib/db/schema'
import { TextOpenWorldRuntimeAIExecutionErrorV1 } from '../../src/lib/open-world/runtime-ai-execution'
import {
  classifyTextOpenWorldRuntimeAIFailureV1,
  TextOpenWorldRuntimeAIPlayerErrorV1,
} from '../../src/lib/open-world/runtime-ai-resilience'
import { projectTextOpenWorldRuntimeAIObservabilityV1 } from '../../src/lib/open-world/runtime-ai-observability'
import { generateTextOpenWorldRuntimeIntentV1 } from '../../src/lib/open-world/runtime-intent'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

async function fixture(label: string) {
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
    runtimeShape: 'vnext-only',
    title: label,
    seed: `g6-resilience-${label}`,
  })
}

describe('R-OPEN-WORLD6 · 运行时 AI 失败、重试与成本证据', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); db.close() })

  it('请求已发出但未确认结果时标记未知、可能计费且禁止自动重试', async () => {
    const failure = await classifyTextOpenWorldRuntimeAIFailureV1({
      error: new TextOpenWorldRuntimeAIExecutionErrorV1(new TypeError('Failed to fetch'), {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o-mini',
        routeCategory: 'runtime.text-open-world.intent',
        startedAt: 1,
        finishedAt: 2,
        timedOut: false,
        requestLifecycle: { phase: 'request-dispatched', responseStatus: null },
        usage: null,
      }),
    })
    expect(failure).toMatchObject({
      kind: 'unknown-result',
      retryable: false,
      unknownResult: true,
      possibleCharge: true,
      action: 'pause-for-author',
    })
  })

  it('合同超时按传输阶段区分安全显式重试与已派发未知结果', async () => {
    const safe = await classifyTextOpenWorldRuntimeAIFailureV1({
      error: new TextOpenWorldRuntimeAIExecutionErrorV1(new DOMException('timeout', 'TimeoutError'), {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o-mini',
        routeCategory: 'runtime.text-open-world.intent',
        startedAt: 1,
        finishedAt: 2,
        timedOut: true,
        requestLifecycle: { phase: 'pre-dispatch', responseStatus: null },
        usage: null,
      }),
    })
    expect(safe).toMatchObject({
      kind: 'provider-unavailable',
      code: 'runtime_ai_timeout',
      retryable: true,
      unknownResult: false,
      possibleCharge: false,
    })

    const unknown = await classifyTextOpenWorldRuntimeAIFailureV1({
      error: new TextOpenWorldRuntimeAIExecutionErrorV1(new DOMException('timeout', 'TimeoutError'), {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o-mini',
        routeCategory: 'runtime.text-open-world.intent',
        startedAt: 1,
        finishedAt: 2,
        timedOut: true,
        requestLifecycle: { phase: 'request-dispatched', responseStatus: null },
        usage: null,
      }),
    })
    expect(unknown).toMatchObject({
      kind: 'unknown-result',
      code: 'provider_timeout_unknown',
      retryable: false,
      unknownResult: true,
      possibleCharge: true,
    })
  })

  it('限流只允许玩家明确重试，并把精确失败写入 Instance Run', async () => {
    const created = await fixture('限流')
    let runId = 0
    await expect(generateTextOpenWorldRuntimeIntentV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.offer.main',
      utterance: '接受任务',
      onRunCreated: value => { runId = value },
      runAI: async () => { throw new AIError(429, 'rate limited') },
    })).rejects.toBeInstanceOf(TextOpenWorldRuntimeAIPlayerErrorV1)
    const run = await readInstanceAgentRunV1(created.scope, runId)
    expect(run.projection.state).toBe('failed')
    const failure = run.events.find(event => event.type === 'step.failed')
    expect(failure?.type === 'step.failed' ? failure.payload : null).toMatchObject({
      code: 'provider_rate_limited',
      retryable: true,
      category: 'transient',
      action: 'retry',
    })
  }, 45_000)

  it('真实网关派发后断网只发出一次请求并把 Run 暂停为结果未知', async () => {
    const created = await fixture('断网')
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', fetchMock)
    let runId = 0
    let caught: unknown
    try {
      await generateTextOpenWorldRuntimeIntentV1({
        scope: created.scope,
        productRuntimeSessionId: created.session.id!,
        selectedSceneKey: 'scene.offer.main',
        utterance: '接受任务',
        aiConfig: {
          provider: 'openai', apiKey: 'test-key', model: 'gpt-4o-mini',
          baseUrl: 'https://runtime-ai.invalid/v1', temperature: 0.2,
          maxTokens: 800, contextWindow: 128_000,
        },
        onRunCreated: value => { runId = value },
      })
    } catch (error) {
      caught = error
    }
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(caught).toBeInstanceOf(TextOpenWorldRuntimeAIPlayerErrorV1)
    expect((caught as TextOpenWorldRuntimeAIPlayerErrorV1).failure).toMatchObject({
      kind: 'unknown-result', retryable: false, possibleCharge: true,
    })
    const run = await readInstanceAgentRunV1(created.scope, runId)
    expect(run.projection.state).toBe('paused')
    const failure = run.events.find(event => event.type === 'step.failed')
    expect(failure?.type === 'step.failed' ? failure.payload : null).toMatchObject({
      code: 'provider_result_unknown', retryable: false, action: 'pause-for-author',
    })
  }, 45_000)

  it('余额或授权失败暂停而不隐藏重发，观测只汇总本项目运行时类别', async () => {
    const created = await fixture('余额')
    let runId = 0
    await expect(generateTextOpenWorldRuntimeIntentV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
      selectedSceneKey: 'scene.offer.main',
      utterance: '接受任务',
      onRunCreated: value => { runId = value },
      runAI: async () => { throw new AIError(402, 'insufficient balance') },
    })).rejects.toBeInstanceOf(TextOpenWorldRuntimeAIPlayerErrorV1)
    expect((await readInstanceAgentRunV1(created.scope, runId)).projection.state).toBe('paused')

    await db.aiUsageLog.bulkAdd([{
      projectId: created.scope.projectId,
      timestamp: 10,
      category: 'runtime.text-open-world.intent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      taskKind: null,
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.001,
    }, {
      projectId: created.scope.projectId,
      timestamp: 11,
      category: 'chapter.content',
      provider: 'openai',
      model: 'gpt-4o-mini',
      taskKind: null,
      inputTokens: 9_999,
      outputTokens: 9_999,
      costUsd: 9,
    }])
    const view = await projectTextOpenWorldRuntimeAIObservabilityV1({
      scope: created.scope,
      productRuntimeSessionId: created.session.id!,
    })
    expect(view).toMatchObject({
      successfulCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      estimatedCostUsd: 0.001,
    })
    expect(view.budgets).toHaveLength(6)
    expect(view.recentRuns[0]).toMatchObject({ runId, state: 'paused', code: 'provider_quota' })
  }, 45_000)
})
