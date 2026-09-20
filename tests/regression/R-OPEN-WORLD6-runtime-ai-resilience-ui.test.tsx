import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldRuntimeAIFailureNotice from '../../src/components/text-game/TextOpenWorldRuntimeAIFailureNotice'
import TextOpenWorldRuntimeAIStatusPanel from '../../src/components/text-game/TextOpenWorldRuntimeAIStatusPanel'
import type { TextOpenWorldRuntimeAIFailureV1 } from '../../src/lib/open-world/runtime-ai-error'
import type { TextOpenWorldRuntimeAIObservabilityV1 } from '../../src/lib/open-world/runtime-ai-observability'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function failure(overrides: Partial<TextOpenWorldRuntimeAIFailureV1> = {}): TextOpenWorldRuntimeAIFailureV1 {
  return {
    version: 1,
    kind: 'unknown-result',
    code: 'provider_result_unknown',
    category: 'unknown',
    action: 'pause-for-author',
    retryable: false,
    unknownResult: true,
    possibleCharge: true,
    message: '模型请求结果未知',
    recovery: '固定选项仍可继续使用；请先核对服务商记录。',
    fingerprint: 'failure.ui.fixture',
    requestPhase: 'request-dispatched',
    responseStatus: null,
    ...overrides,
  }
}

function observability(): TextOpenWorldRuntimeAIObservabilityV1 {
  return {
    version: 1,
    projectId: 7,
    productRuntimeSessionId: 9,
    budgets: [{
      skillId: 'prose.text-open-world-runtime-intent',
      label: '自由输入理解',
      maxInputTokens: 4_000,
      maxOutputTokens: 800,
      maxDurationMs: 30_000,
      maxEstimatedCostUsd: 0.08,
    }],
    successfulCalls: 2,
    inputTokens: 320,
    outputTokens: 80,
    estimatedCostUsd: 0.0042,
    latestUsageAt: 12,
    recentRuns: [{
      runId: 12,
      label: '自由输入理解',
      state: 'paused',
      code: 'provider_result_unknown',
      retryable: false,
      updatedAt: 13,
    }],
    refreshedAt: 14,
  }
}

describe('R-OPEN-WORLD6 · 运行时 AI 失败与费用玩家界面', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('结果未知时明确提示可能计费且不提供重试按钮', async () => {
    const onRetry = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldRuntimeAIFailureNotice, {
      failure: failure(),
      onRetry,
    })))
    expect(host.textContent).toContain('模型请求结果未知')
    expect(host.textContent).toContain('可能已经产生模型费用')
    expect(host.textContent).toContain('不会暗中重发')
    expect(host.querySelector('button')).toBeNull()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('只为可重试失败开放一次显式重试，并把估算与账单边界分开显示', async () => {
    const onRetry = vi.fn()
    await act(async () => root.render(createElement('div', null,
      createElement(TextOpenWorldRuntimeAIFailureNotice, {
        failure: failure({
          kind: 'rate-limit',
          code: 'provider_rate_limited',
          category: 'transient',
          action: 'retry',
          retryable: true,
          unknownResult: false,
          possibleCharge: false,
          message: '模型服务正在限流',
          recovery: '稍后由你明确重试一次。',
          requestPhase: 'response-observed',
          responseStatus: 429,
        }),
        onRetry,
      }),
      createElement(TextOpenWorldRuntimeAIStatusPanel, {
        configured: true,
        loading: false,
        value: observability(),
        onRefresh: vi.fn(),
      }),
    )))
    const retry = [...host.querySelectorAll('button')]
      .find(button => button.textContent?.includes('明确重试一次'))
    expect(retry).toBeDefined()
    await act(async () => retry!.click())
    expect(onRetry).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('2 次')
    expect(host.textContent).toContain('$0.0042')
    expect(host.textContent).toContain('不是服务商账单')
    expect(host.textContent).toContain('合同估算上界')
    expect(host.textContent).toContain('已暂停')
  })
})
