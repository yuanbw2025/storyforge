import { describe, expect, it } from 'vitest'
import { runAdaptiveReferenceRequestsV1, type ReferenceCompletedAnswerV1 } from '../../src/lib/reference-analysis/adaptive-requests'
import { referenceServiceInputLimit, referenceServiceOutputLimit } from '../../src/lib/reference-analysis/request-capacity'
import { getModelCapacityV1 } from '../../src/lib/ai/model-capacity'
import type { AIConfig } from '../../src/lib/types'

const messages = (selection: { part: string }) => [{ role: 'user' as const, content: selection.part }]

describe('拆书按实际服务容量完整处理', () => {
  it('没有容量证据时保留未知，完整请求不据内部 fallback 预设分批或输出值', async () => {
    const config = { provider: 'custom', model: 'isolated-unrecognized', baseUrl: 'https://example.invalid/v1', apiKey: '', maxTokens: 4096, temperature: 0 } as AIConfig
    expect(referenceServiceInputLimit(config)).toBeNull()
    expect(referenceServiceOutputLimit(config, messages({ part: '资料'.repeat(50000) }))).toBeNull()
    let calls = 0
    const source = '完整证据'.repeat(30000) + '末段反例'
    const result = await runAdaptiveReferenceRequestsV1({ source, inputLimit: null, messages,
      invoke: async (_messages, range) => { calls++; expect(range.part).toBe(source); return { raw: '{"ok":true}', finishReason: 'stop' } },
    })
    expect(calls).toBe(1)
    expect(result[0].selection.part).toBe(source)
  })

  it('服务明确给出的小窗口触发多批，所有段落、补充证据和Unicode完整覆盖', async () => {
    const source = Array.from({ length: 95 }, (_, i) => `第${i}段：甲先借钥匙，乙后来归还。😀反证：第${i}段并未证实身份一致。`).join('\n')
    const result = await runAdaptiveReferenceRequestsV1({ source, inputLimit: 180, messages,
      invoke: async (_messages, range) => ({ raw: JSON.stringify({ evidence: range.part }), finishReason: 'stop' }),
    })
    expect(result.length).toBeGreaterThan(1)
    expect(result.map(row => row.selection.part).join('')).toBe(source)
    expect(result.map(row => JSON.parse(row.raw).evidence).join('')).toBe(source)
    expect(result.at(-1)!.selection.end).toBe(source.length)
    expect(result.some(row => /[\uD800-\uDBFF]$/.test(row.selection.part))).toBe(false)
  })

  it('明确长度未完的原答不被当作完成，细分后完整处理，不设固定调用或层数', async () => {
    const source = '人物身份、时序因果、跨章联系和末段反证。'.repeat(40)
    const observed: string[] = []
    const result = await runAdaptiveReferenceRequestsV1({ source, inputLimit: null, messages,
      invoke: async (_messages, range) => {
        observed.push(range.part)
        return range.part.length > 67 ? { raw: '{"cut":', finishReason: 'length' }
          : { raw: JSON.stringify({ complete: range.part }), finishReason: 'stop' }
      },
    })
    expect(observed.length).toBeGreaterThan(10)
    expect(result.map(row => row.selection.part).join('')).toBe(source)
    expect(result.every(row => row.finishReason === 'stop')).toBe(true)
  })

  it('明确超窗拒绝才可组织较小的新请求；权限、额度、未知结果与格式失败不自动重发', async () => {
    for (const error of [Object.assign(new Error('context_length_exceeded'), { status: 401 }),
      Object.assign(new Error('insufficient_quota'), { status: 429 }), new TypeError('connection lost')]) {
      let calls = 0
      await expect(runAdaptiveReferenceRequestsV1({ source: '资料'.repeat(100), inputLimit: null, messages,
        invoke: async () => { calls++; throw error },
      })).rejects.toBe(error)
      expect(calls).toBe(1)
    }
    let calls = 0
    const result = await runAdaptiveReferenceRequestsV1({ source: '完整原文'.repeat(100), inputLimit: null, messages,
      invoke: async (_messages, range) => {
        calls++
        if (range.part.length > 90) throw Object.assign(new Error('context_length_exceeded'), { status: 400 })
        return { raw: '{"ok":true}' }
      },
    })
    expect(calls).toBeGreaterThan(1)
    expect(result.map(row => row.selection.part).join('')).toBe('完整原文'.repeat(100))
  })

  it('分批检查点可继续剩余范围，已完成请求不会重新调用', async () => {
    const source = '证据'.repeat(400)
    let progress: ReferenceCompletedAnswerV1[] = []
    const stop = new Error('isolated checkpoint interruption')
    await expect(runAdaptiveReferenceRequestsV1({ source, inputLimit: 110, messages,
      invoke: async (_messages, range) => ({ raw: JSON.stringify({ evidence: range.part }) }),
      onCheckpoint: async completed => { progress = completed; if (completed.length === 2) throw stop },
    })).rejects.toBe(stop)
    const offset = progress.at(-1)!.selection.end
    const result = await runAdaptiveReferenceRequestsV1({ source, completed: progress, inputLimit: 110, messages,
      invoke: async (_messages, range) => { expect(range.start).toBeGreaterThanOrEqual(offset); return { raw: JSON.stringify({ evidence: range.part }) } },
    })
    expect(result.map(row => row.selection.part).join('')).toBe(source)
    await expect(runAdaptiveReferenceRequestsV1({ source: source + '变更', completed: progress, inputLimit: 110, messages,
      invoke: async () => ({ raw: '{}' }),
    })).rejects.toThrow('不匹配')
  })

  it('已证实独立输出限制和共享剩余空间决定实际输出参数，忽略应用旧4096值', () => {
    const config = { provider: 'custom', model: 'verified-test', baseUrl: 'https://example.invalid/v1', apiKey: '', maxTokens: 4096, temperature: 0 } as AIConfig
    const identity = getModelCapacityV1(config)
    const capacity: AIConfig = { ...config, modelCapacity: { ...identity, confidence: 'service', totalWindow: null, inputLimit: 50000,
      outputLimit: 18000, outputLimitSource: 'service' } }
    expect(referenceServiceInputLimit(capacity)).toBe(50000)
    expect(referenceServiceOutputLimit(capacity, messages({ part: '完整材料' }))).toBe(18000)
  })
})
