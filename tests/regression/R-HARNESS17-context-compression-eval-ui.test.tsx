import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import NS0EvalPanel from '../../src/components/settings/NS0EvalPanel'
import { H17_CONTEXT_COMPRESSION_RESULTS_STORAGE_KEY } from '../../src/lib/evals/context-compression/runner'
import type {
  ContextCompressionEvalAggregateV1,
  ContextCompressionEvalRecordV1,
  ContextCompressionEvalVariant,
} from '../../src/lib/evals/context-compression/types'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

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
})

describe('R-HARNESS17 · 压缩评测面板', () => {
  it('恢复三路汇总并同时展示生成输入缩减和总输入倍率', async () => {
    localStorage.setItem(H17_CONTEXT_COMPRESSION_RESULTS_STORAGE_KEY, JSON.stringify(await Promise.all([
      signedRecord('full-source', 9_000, 9_000, 3),
      signedRecord('deterministic-truncation', 3_300, 3_300, 3),
      signedRecord('semantic-compression', 3_000, 11_000, 6),
    ])))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    await act(async () => root.render(createElement(NS0EvalPanel)))

    expect(host.textContent).toContain('上下文质量对照')
    expect(host.querySelector('[data-testid="h17-context-compression-result"]')).not.toBeNull()
    expect(host.textContent).toContain('全文基线')
    expect(host.textContent).toContain('语义压缩')
    expect(host.textContent).toContain('H17 非劣门：PASS')
    expect(host.textContent).toContain('生成输入下降 66.7%')
    expect(host.textContent).toContain('总输入倍率 1.22x')
  })
})
