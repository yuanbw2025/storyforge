import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildCreativeCallEvidenceV1, runCreativeExecutionV1 } from '../../src/lib/agent/creative-execution'
import { parseShortNovelModelJsonV1 } from '../../src/lib/agent/run/short-novel-durable'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { addTextOpenWorldTaskUsageV1, readTextOpenWorldObservedTokenPairV1 } from '../../src/lib/open-world/production-usage'
import { parseScreenplayModelJsonV1 } from '../../src/lib/screenplay/model-json'
import type { ChatMessage } from '../../src/lib/types'

const messages: ChatMessage[] = [{ role: 'user', content: 'abcd' }]
const output = 'e\u0301\r\n'
const outputHash = createHash('sha256').update(JSON.stringify(output)).digest('hex')

describe('SFQA009 · 共享模型传输与调用证据边界', () => {
  it.each([
    { name: 'reported zero', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      expected: { usageSource: 'provider', inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 } },
    { name: 'estimated', usage: undefined,
      expected: { usageSource: 'estimated', inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0.14 / 1e6 + 0.28 / 1e6 } },
  ])('keeps $name usage and the original response hash at the real creative entry', async ({ usage, expected }) => {
    const result = await runCreativeExecutionV1({
      initialMessages: messages,
      runRaw: async () => ({ output, durationMs: 0, ...(usage ? { usage } : {}) }),
      parse: raw => ({ status: 'ready', output: raw, editableText: raw,
        validFragments: [], rejectedFragments: [], issues: [], assumptions: [] }),
      buildRepairMessages: () => messages,
      budget: new AgentTeamBudgetTracker('economy'),
      callLabel: 'SFQA009 synthetic response', maxOutputTokens: 100, qualityMode: 'economy',
      modelIdentity: { provider: 'fixture', model: 'deepseek-v4-flash' },
    })
    expect(result.artifact.originalText).toBe(output)
    expect(result.artifact.callEvidence).toEqual([{
      version: 1, callIndex: 1, purpose: 'generate', status: 'succeeded',
      provider: 'fixture', model: 'deepseek-v4-flash', ...expected, latencyMs: 0, outputHash,
    }])
  })

  it('keeps an unknown failed attempt distinct from a real response priced as unknown', async () => {
    const modelIdentity = { provider: 'fixture', model: 'unpriced-fixture-model' }
    const failed = await buildCreativeCallEvidenceV1({ callIndex: 2, purpose: 'repair',
      messages, modelIdentity, failed: true })
    expect(failed).toEqual({
      version: 1, callIndex: 2, purpose: 'repair', status: 'failed', ...modelIdentity,
      usageSource: 'unknown', inputTokens: null, outputTokens: null, totalTokens: null,
      latencyMs: null, estimatedCostUsd: null, outputHash: null,
    })
    const reported = await buildCreativeCallEvidenceV1({ callIndex: 1, purpose: 'generate',
      messages, modelIdentity, result: { output, durationMs: 7, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } } })
    expect(reported).toMatchObject({ usageSource: 'provider', inputTokens: 0, outputTokens: 0,
      totalTokens: 0, latencyMs: 7, estimatedCostUsd: null, outputHash })
  })

  it.each([
    { parse: parseShortNovelModelJsonV1, prefix: '[short-novel-run]' },
    { parse: parseScreenplayModelJsonV1, prefix: '[screenplay-run]' },
  ])('keeps $prefix transport results, bounded repair and exact error text', ({ parse, prefix }) => {
    const text = '她说："现在出发"。\r\n\t\u0000e\u0301🙂'
    expect(parse('\uFEFF前缀\n```json\n{"text":"' + text + '"}\n```')).toEqual({ text })
    expect(parse(JSON.stringify({ text: '\\n and "quoted"' }))).toEqual({ text: '\\n and "quoted"' })
    expect(parse('null')).toBeNull()
    expect(() => parse('{"a":1}\n{"b":2}')).toThrow(new Error(prefix + ' 模型输出无法解析为唯一 JSON'))
    expect(() => parse('{"a":[}')).toThrow(new Error(prefix + ' 模型输出无法解析为唯一 JSON'))
    expect(() => parse(' \n ')).toThrow(new Error(prefix + ' 模型输出为空或过长'))
    const boundary = 'x'.repeat(1_999_998)
    expect(parse(JSON.stringify(boundary))).toBe(boundary)
    expect(() => parse(JSON.stringify(boundary + 'x'))).toThrow(new Error(prefix + ' 模型输出为空或过长'))
  })

  it('retains explicit safe counts and does not infer missing OpenWorld observations', () => {
    expect(readTextOpenWorldObservedTokenPairV1({ inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER, totalTokens: -1 }))
      .toEqual({ inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER })
    for (const invalid of [null, [], { inputTokens: 0 }, { inputTokens: '0', outputTokens: 0 },
      { inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER + 1 }, { inputTokens: -1, outputTokens: 0 },
      { inputTokens: 0.5, outputTokens: 0 }, { inputTokens: Number.NaN, outputTokens: 0 }]) {
      expect(readTextOpenWorldObservedTokenPairV1(invalid)).toBeNull()
    }
  })

  it('adds only recorded OpenWorld task usage and propagates unknown cost without losing explicit zero', () => {
    const first = { modelCalls: 1, inputTokens: 3, outputTokens: 4, mediaCalls: 2, costUsd: 0, durationMs: 7, storageBytes: 11 }
    const second = { modelCalls: 2, inputTokens: 5, outputTokens: 6, mediaCalls: 0, costUsd: 0, durationMs: 13, storageBytes: 17 }
    const expected = { modelCalls: 3, inputTokens: 8, outputTokens: 10, mediaCalls: 2, costUsd: 0, durationMs: 20, storageBytes: 28 }
    expect(addTextOpenWorldTaskUsageV1(first, second)).toEqual(expected)
    expect(addTextOpenWorldTaskUsageV1(first, { ...second, costUsd: 0.25 })).toEqual({ ...expected, costUsd: 0.25 })
    expect(addTextOpenWorldTaskUsageV1({ ...first, costUsd: null }, second)).toEqual({ ...expected, costUsd: null })
    expect(addTextOpenWorldTaskUsageV1(first, { ...second, costUsd: null })).toEqual({ ...expected, costUsd: null })
  })
})
