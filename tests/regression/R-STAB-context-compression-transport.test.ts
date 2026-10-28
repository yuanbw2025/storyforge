import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chat, resolveRequestConfig } from '../../src/lib/ai/client'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import { createAgentContextCompressionSessionV1, extractContextCompressionAnchorsV1 } from '../../src/lib/agent/context-compression'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { AIError, type AIConfig } from '../../src/lib/types'

vi.mock('../../src/lib/ai/client', () => ({ chat: vi.fn(), resolveRequestConfig: vi.fn() }))

const config: AIConfig = { provider: 'agnes', model: 'agnes-2.5-flash', apiKey: 'test', baseUrl: 'https://example.invalid/v1', temperature: 0.2, maxTokens: 8000 }
const content = [
  '【潮门规则】潮门开启必须由守灯人敲钟，其他人不得触碰潮汐钟。',
  '主角在第一章尚未知晓沈灯隐瞒的旧港秘密，后续获知前不能据此行动。',
  '海历3021年，盐城议会只允许每十年开启一次潮门。',
  `背景记录：${'潮汐推移形成盐晶层。'.repeat(1050)}`,
].join('\n')
const targetTokens = 1000
const anchors = extractContextCompressionAnchorsV1({ content, targetTokens })
const payload = (summary = '潮门按固定周期开启，本章维持主角尚未知情的认知边界。') => JSON.stringify({
  version: 1, summary, coveredAnchorIds: anchors.map(anchor => anchor.id),
  evidenceQuotes: anchors.map(anchor => ({ anchorId: anchor.id, quote: anchor.quote })),
})
const sourceInput = { source: { key: 'worldview', label: '世界观', layer: 'L2' as const, budgetTokens: 8000, protectedFromTrim: false }, content, originalTokens: estimateTokens(content), sourceBudgetTokens: targetTokens, inputBudgetTokens: 8000 }
function session(overrides: Partial<AIConfig> = {}, complete?: Parameters<typeof createAgentContextCompressionSessionV1>[0]['runtime']['complete']) {
  return createAgentContextCompressionSessionV1({
    policy: getAgentSkillV1('world-origin.worldview-field', 'world-origin').contextCompression,
    config: { ...config, ...overrides }, projectId: 1, authorRequest: '补全世界来源', routingCategory: 'agent.world-origin',
    runtime: { budget: new AgentTeamBudgetTracker('balanced'), requiredFutureModelCalls: 1, ...(complete ? { complete } : {}) },
  })
}

beforeEach(() => {
  vi.mocked(chat).mockReset(); vi.mocked(chat).mockResolvedValue(payload())
  vi.mocked(resolveRequestConfig).mockReset()
  vi.mocked(resolveRequestConfig).mockImplementation((requested, meta) => ({ config: { ...requested, ...meta?.configOverrides }, taskKind: null, presetId: null }))
})
describe('bounded context compression uses the complete JSON envelope and one accountable transport dispatch', () => {
  it('reserves output for repeated literal anchor quotes as well as the permitted summary', async () => {
    let requested = 0
    let required = 0
    const result = await session({}, async (messages, request) => {
      const target = Number(messages.map(message => message.content).join('\n').match(/summary 不超过约 (\d+)/u)?.[1])
      expect(target).toBeGreaterThan(0)
      let summary = '摘要。'
      while (estimateTokens(`${summary}甲`) <= target) summary += '甲'
      required = estimateTokens(payload(summary))
      requested = request.maxOutputTokens
      return payload()
    }).sourceTransformer(sourceInput)
    expect(result?.compression?.outcome).toBe('verified')
    expect(requested).toBeGreaterThanOrEqual(required)
    expect(requested).toBeLessThanOrEqual(1800)
  })
  it('sends the verified Agnes 2.5 JSON and bounded-thinking options, with hidden transport retries disabled', async () => {
    expect((await session().sourceTransformer(sourceInput))?.compression?.outcome).toBe('verified')
    expect(chat).toHaveBeenCalledTimes(1)
    expect(vi.mocked(chat).mock.calls[0]?.[2]).toMatchObject({ transportRetryPolicy: 'none' })
    expect(vi.mocked(chat).mock.calls[0]?.[5]).toEqual({ responseFormat: 'json_object', thinkingMode: 'disabled' })
  })
  it.each([
    ['openai', 'gpt-4o-mini', { responseFormat: 'json_object' }],
    ['agnes', 'agnes-3.0-flash', {}],
    ['custom', 'unverified-model', {}],
  ] as const)('keeps the verified capability boundary for %s/%s', async (provider, model, options) => {
    await session({ provider, model }).sourceTransformer(sourceInput)
    expect(vi.mocked(chat).mock.calls[0]?.[5]).toEqual(options)
  })
  it('freezes options against the model actually selected by task routing', async () => {
    vi.mocked(resolveRequestConfig).mockImplementation((requested, meta) => ({ config: { ...requested, ...meta?.configOverrides, model: 'agnes-3.0-flash' }, taskKind: null, presetId: null }))
    await session().sourceTransformer(sourceInput)
    expect(vi.mocked(chat).mock.calls[0]?.[5]).toEqual({})
    expect(vi.mocked(chat).mock.calls[0]?.[6]?.config.model).toBe('agnes-3.0-flash')
  })
  it.each([new AIError(400, 'invalid request'), new AIError(401, 'unauthorized'), new Error('unknown transport outcome')])('does not replay a failed/unknown dispatch: %s', async (failure) => {
    vi.mocked(chat).mockRejectedValue(failure)
    const result = await session().sourceTransformer(sourceInput)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(result?.compression).toMatchObject({ attempts: 1, outcome: 'fallback' })
  })
  it('retains the bounded semantic repair after a completed but malformed response', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"version":1}').mockResolvedValueOnce(payload())
    expect((await session().sourceTransformer(sourceInput))?.compression).toMatchObject({ attempts: 2, outcome: 'verified' })
    expect(chat).toHaveBeenCalledTimes(2)
  })
})
