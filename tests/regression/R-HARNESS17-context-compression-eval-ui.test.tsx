import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HarnessEvalPanel from '../../src/components/settings/HarnessEvalPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { H17_CONTEXT_COMPRESSION_RESULTS_STORAGE_KEY } from '../../src/lib/evals/context-compression/runner'
import type {
  ContextCompressionEvalAggregateV1,
  ContextCompressionEvalRecordV1,
  ContextCompressionEvalVariant,
} from '../../src/lib/evals/context-compression/types'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  H4_LONG_CONSISTENCY_FIXTURES_V1,
  clearH4LongConsistencyBrowserCheckpointV1,
  importH4LongConsistencyRunCheckpointV1,
  loadH4LongConsistencyBrowserStateV1,
  persistH4LongConsistencyBrowserCheckpointV1,
  runH4LongConsistencyVerifierV1,
  type H4LongConsistencyVerifierCallInputV1,
} from '../../src/lib/evals/long-consistency'
import { useAIConfigStore } from '../../src/stores/ai-config'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
const ORIGINAL_AI_CONFIG = structuredClone(useAIConfigStore.getState().config)
const ORIGINAL_CLIPBOARD = navigator.clipboard

async function flushAsyncEffects(delayMs = 1_000): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, delayMs))
  })
}

async function mountHarness(): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(
    createElement(DialogProvider, null, createElement(HarnessEvalPanel)),
  ))
  return host
}

function clickButton(button: HTMLButtonElement | null | undefined): void {
  button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.trim() === label)
}

function aggregate(inputTokens: number, totalInputTokens: number, calls: number): ContextCompressionEvalAggregateV1 {
  return {
    caseCount: 3,
    requiredFactRecall: 1,
    constraintRecall: 1,
    futureLeakageRate: 0,
    wrongWorldLeakageRate: 0,
    averageSourceOriginalTokens: 2_500,
    averageDeliveredContextTokens: inputTokens,
    generationInputTokens: inputTokens,
    generationOutputTokens: 300,
    compressionInputTokens: totalInputTokens - inputTokens,
    compressionOutputTokens: calls > 3 ? 200 : 0,
    totalInputTokens,
    totalOutputTokens: calls > 3 ? 500 : 300,
    modelCalls: calls,
    fallbackRate: 0,
    latencyMs: 1_000,
  }
}

function record(
  variant: ContextCompressionEvalVariant,
  inputTokens: number,
  totalInputTokens: number,
  calls: number,
): ContextCompressionEvalRecordV1 {
  return {
    schemaVersion: 1,
    runId: variant,
    createdAt: new Date(0).toISOString(),
    provider: 'openai',
    model: 'gpt-4o-mini',
    split: 'development',
    variant,
    contextTargetTokens: 900,
    generationMaxTokens: 1_200,
    fixtureIds: ['a', 'b', 'c'],
    results: [],
    aggregate: aggregate(inputTokens, totalInputTokens, calls),
    recordHash: 'a'.repeat(64),
  }
}

async function signedRecord(
  variant: ContextCompressionEvalVariant,
  inputTokens: number,
  totalInputTokens: number,
  calls: number,
): Promise<ContextCompressionEvalRecordV1> {
  const value = record(variant, inputTokens, totalInputTokens, calls)
  const { recordHash: _recordHash, ...body } = value
  return { ...value, recordHash: await hashCanonicalValue(body) }
}

afterEach(async () => {
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  localStorage.removeItem(H17_CONTEXT_COMPRESSION_RESULTS_STORAGE_KEY)
  clearH4LongConsistencyBrowserCheckpointV1('development')
  clearH4LongConsistencyBrowserCheckpointV1('held-out')
  useAIConfigStore.setState({ config: structuredClone(ORIGINAL_AI_CONFIG) })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: ORIGINAL_CLIPBOARD })
})

describe('R-HARNESS17 · 压缩评测面板', () => {
  it('retires the legacy NS-0/NS-1 controls and exposes the H4 40+20 entry', async () => {
    const host = await mountHarness()

    expect(host.querySelector('[data-testid="harness-eval-panel"]')).not.toBeNull()
    expect(host.textContent).toContain('H4 Development')
    expect(host.textContent).toContain('40 例')
    expect(host.textContent).toContain('H4 Held-out')
    expect(host.textContent).toContain('20 例')
    expect(host.textContent).not.toContain('NS-0 长期一致性基线')
    expect(host.textContent).not.toContain('NS-1 最终配对 A/B')
  })

  it('restores an interrupted H4 checkpoint as a resumable run without exposing case output', async () => {
    const fixtures = new Map(H4_LONG_CONSISTENCY_FIXTURES_V1.map(fixture => [fixture.id, fixture] as const))
    const call = async (input: H4LongConsistencyVerifierCallInputV1) => {
      const fixture = fixtures.get(input.fixture.id)!
      return {
        output: JSON.stringify({
          schemaVersion: 1,
          issues: fixture.hiddenLabels.expectedIssues.map(issue => ({
            id: `ui:${issue.id}`,
            subtype: issue.subtype,
            severity: issue.severity,
            intentClassification: issue.intentClassification,
            summary: '界面恢复测试结论。',
            factEvidence: issue.factEvidence,
            contradictionEvidence: issue.contradictionEvidence,
          })),
        }),
        usage: { inputTokens: 1_000, outputTokens: 100, durationMs: 10, costUsd: 0.01 },
      }
    }
    await expect(runH4LongConsistencyVerifierV1({
      runId: 'h4-ui-resume',
      split: 'development',
      codeRevision: 'h4-ui-test',
      fixtureIds: ['h4-dev-01', 'h4-dev-02'],
      execution: {
        generator: { provider: 'fixture', model: 'h4-synthetic-corpus', promptVersion: 'h4-synthetic-zh-60-v1' },
        verifier: { provider: 'independent', model: 'h4-ui-verifier', promptVersion: 'h4-long-consistency-judge-v1' },
      },
      call,
      now: () => 0,
      onCheckpoint: async checkpoint => {
        await persistH4LongConsistencyBrowserCheckpointV1(checkpoint)
        if (checkpoint.completed.length === 1) throw new Error('simulated-ui-refresh')
      },
    })).rejects.toThrow('simulated-ui-refresh')

    useAIConfigStore.setState({
      config: {
        ...ORIGINAL_AI_CONFIG,
        provider: 'openai',
        model: 'different-verifier',
        apiKey: 'test-only',
      },
    })
    const host = await mountHarness()
    await flushAsyncEffects(1_000)

    const section = host.querySelector('[data-testid="h4-development-section"]')
    expect(section?.textContent).toContain('可恢复 · 1/2')
    expect(section?.textContent).toContain('继续')
    expect(section?.textContent).not.toContain('界面恢复测试结论')

    await act(async () => {
      clickButton(section?.querySelector('button'))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(host.textContent).toContain('请先切回 independent/h4-ui-verifier')
  })

  it('keeps or clears an H4 checkpoint according to the shared confirmation dialog', async () => {
    const fixture = H4_LONG_CONSISTENCY_FIXTURES_V1[0]
    const checkpoint = await runH4LongConsistencyVerifierV1({
      runId: 'h4-ui-clear',
      split: 'development',
      codeRevision: 'h4-ui-test',
      fixtureIds: [fixture.id],
      execution: {
        generator: { provider: 'fixture', model: 'h4-synthetic-corpus', promptVersion: 'h4-synthetic-zh-60-v1' },
        verifier: { provider: 'independent', model: 'h4-ui-verifier', promptVersion: 'h4-long-consistency-judge-v1' },
      },
      call: async () => ({
        output: JSON.stringify({ schemaVersion: 1, issues: [] }),
        usage: { inputTokens: 1_000, outputTokens: 100, durationMs: 10, costUsd: 0.01 },
      }),
      now: () => 0,
    })
    await persistH4LongConsistencyBrowserCheckpointV1(checkpoint)

    const host = await mountHarness()
    await flushAsyncEffects()
    const clearButton = () => host.querySelector<HTMLButtonElement>(
      '[aria-label="\u6e05\u9664 H4 Development"]',
    )

    await act(async () => {
      clickButton(clearButton())
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('清除 H4 checkpoint？')
    await act(async () => {
      clickButton(findButton('保留'))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(await loadH4LongConsistencyBrowserStateV1('development')).not.toBeNull()
    expect(host.querySelector('[data-testid="h4-development-section"]')?.textContent).toContain('已完成 · 1/1')

    await act(async () => {
      clickButton(clearButton())
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      clickButton(findButton('清除'))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(await loadH4LongConsistencyBrowserStateV1('development')).toBeNull()
    expect(host.querySelector('[data-testid="h4-development-section"]')?.textContent).toContain('40 例')
  })

  it('surfaces the last H4 provider failure instead of leaving only an aggregate gate failure', async () => {
    const checkpoint = await runH4LongConsistencyVerifierV1({
      runId: 'h4-ui-provider-failure',
      split: 'development',
      codeRevision: 'h4-ui-test',
      fixtureIds: ['h4-dev-01'],
      maxAttemptsPerFixture: 1,
      execution: {
        generator: { provider: 'fixture', model: 'h4-synthetic-corpus', promptVersion: 'h4-synthetic-zh-60-v1' },
        verifier: { provider: 'doubao', model: 'doubao-1-5-pro-32k-250115', promptVersion: 'h4-long-consistency-judge-v1' },
      },
      call: async () => { throw new Error('provider request rejected') },
      now: () => 0,
    })
    await persistH4LongConsistencyBrowserCheckpointV1(checkpoint)

    const host = await mountHarness()
    await flushAsyncEffects()

    const failure = host.querySelector('[data-testid="h4-development-failure"]')
    const section = host.querySelector('[data-testid="h4-development-section"]')
    expect(section?.textContent).toContain('生成 fixture/h4-synthetic-corpus')
    expect(section?.textContent).toContain('验证 doubao/doubao-1-5-pro-32k-250115')
    expect(section?.textContent).toContain(`checkpoint ${checkpoint.checkpointHash}`)
    expect(section?.textContent).toContain('累计延迟 0.0s')
    expect(failure?.textContent).toContain('verifier_error · provider request rejected')
    expect(failure?.textContent).toContain('未取得 provider 用量')
  })

  it('copies an integrity-checked H4 checkpoint when browser downloads are unavailable', async () => {
    const fixture = H4_LONG_CONSISTENCY_FIXTURES_V1[0]
    const checkpoint = await runH4LongConsistencyVerifierV1({
      runId: 'h4-ui-copy',
      split: 'development',
      codeRevision: 'h4-ui-test',
      fixtureIds: [fixture.id],
      execution: {
        generator: { provider: 'fixture', model: 'h4-synthetic-corpus', promptVersion: 'h4-synthetic-zh-60-v1' },
        verifier: { provider: 'independent', model: 'h4-ui-verifier', promptVersion: 'h4-long-consistency-judge-v1' },
      },
      call: async () => ({
        output: JSON.stringify({ schemaVersion: 1, issues: [] }),
        usage: { inputTokens: 1_000, outputTokens: 100, durationMs: 10, costUsd: 0.01 },
      }),
      now: () => 0,
    })
    await persistH4LongConsistencyBrowserCheckpointV1(checkpoint)
    const writeText = vi.fn(async (_raw: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const host = await mountHarness()
    await flushAsyncEffects()
    const copyButton = host.querySelector<HTMLButtonElement>('[aria-label="复制 H4 Development"]')
    expect(copyButton).not.toBeNull()
    await act(async () => {
      clickButton(copyButton)
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(writeText).toHaveBeenCalledTimes(1)
    const raw = writeText.mock.calls[0][0]
    await expect(importH4LongConsistencyRunCheckpointV1(raw)).resolves.toEqual(checkpoint)
  })

  it('恢复三路汇总并同时展示生成输入缩减和总输入倍率', async () => {
    localStorage.setItem(H17_CONTEXT_COMPRESSION_RESULTS_STORAGE_KEY, JSON.stringify(await Promise.all([
      signedRecord('full-source', 9_000, 9_000, 3),
      signedRecord('deterministic-truncation', 3_300, 3_300, 3),
      signedRecord('semantic-compression', 3_000, 11_000, 6),
    ])))
    const host = await mountHarness()
    await flushAsyncEffects()

    expect(host.textContent).toContain('上下文质量对照')
    expect(host.querySelector('[data-testid="h17-context-compression-result"]')).not.toBeNull()
    expect(host.textContent).toContain('全文基线')
    expect(host.textContent).toContain('语义压缩')
    expect(host.textContent).toContain('H17 非劣门：PASS')
    expect(host.textContent).toContain('生成输入下降 66.7%')
    expect(host.textContent).toContain('总输入倍率 1.22x')
  })
})
