import { afterEach, describe, expect, it, vi } from 'vitest'
import { planAdaptiveDocumentParseChunksV1, type ChunkPlan } from '../../src/lib/import/chunker'
import { buildDocumentParseFrameV1, assessDocumentParseRequestV1 } from '../../src/lib/import/document-parse-request'
import { getModelCapacityV1, modelInputBudgetV1, resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { estimateTokens, trimMessagesToFit } from '../../src/lib/ai/context-budget'
import { estimateChatRequestOptionsTokens } from '../../src/lib/ai/client'
import type { AIConfig, PromptTemplate } from '../../src/lib/types'
import { seedModelAllocationFixtureV1, syntheticFrozenAllocationV1 } from '../helpers/model-capacity-fixture'

const config = (): AIConfig => ({ provider: 'custom', model: 'same-model-alias', baseUrl: 'https://plan.invalid/v1', apiKey: 'synthetic-only', temperature: 0, maxTokens: 0 })
const template: PromptTemplate = {
  moduleKey: 'import.parse-chunk', scope: 'user', promptType: 'generate', name: 'Frame fixture', description: '',
  systemPrompt: 'SYSTEM {{codexCategoryCatalog}}', userPromptTemplate: '{{chunkIndex}}/{{totalChunks}} {{knownContext}}\n{{rawDocument}}',
  variables: ['codexCategoryCatalog', 'chunkIndex', 'totalChunks', 'knownContext', 'rawDocument'], isActive: false, createdAt: 1, updatedAt: 1,
}
function frame(sourceText: string, knownContext = 'CONTEXT') {
  return buildDocumentParseFrameV1({ template, provider: 'custom', sourceText, knownContext, categories: [], chunkIndex: 0, totalChunks: 1 })
}
function assess(cfg: AIConfig, sourceText: string, knownContext = 'CONTEXT') {
  const actual = frame(sourceText, knownContext)
  return assessDocumentParseRequestV1({ config: cfg, messages: actual.messages, options: actual.options, maxInputTokens: 100_000, maxOutputTokens: 16_384 })
}
function coverage(text: string, chunks: ChunkPlan[]) {
  expect(chunks.map(chunk => chunk.text).join('')).toBe(text)
  let cursor = 0
  chunks.forEach((chunk, index) => {
    expect(chunk.index).toBe(index)
    expect(chunk.startChar).toBe(cursor)
    expect(chunk.endChar).toBeGreaterThan(chunk.startChar)
    expect(chunk.charCount).toBe(chunk.endChar - chunk.startChar)
    expect(chunk.text).toBe(text.slice(chunk.startChar, chunk.endChar))
    if (chunk.endChar < text.length) {
      const before = text.charCodeAt(chunk.endChar - 1), after = text.charCodeAt(chunk.endChar)
      expect(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff).toBe(false)
      expect(before === 13 && after === 10).toBe(false)
    }
    cursor = chunk.endChar
  })
  expect(cursor).toBe(text.length)
}
afterEach(() => { vi.restoreAllMocks(); resetModelCapacityForTestsV1() })

describe('031-F physical complete-request feasibility', () => {
  it('distinguishes unknown small capacity from a finite service on another connection with the same alias', async () => {
    const small = config(), larger = { ...config(), baseUrl: 'https://other-plan.invalid/v1' }
    const source = '海'.repeat(2500)
    expect(assess(small, source).fits).toBe(false)
    const capacity = await seedModelAllocationFixtureV1(larger, 65_536)
    expect(capacity.confidence).toBe('service')
    expect(assess(larger, source).fits).toBe(true)
    expect(assess(small, source).fits).toBe(false)
  })

  it('uses the existing task/provider output clamp and the exact client envelope/options checker', () => {
    const cfg = syntheticFrozenAllocationV1(config(), 32_768, 8000), actual = frame('海'.repeat(300))
    const decision = assessDocumentParseRequestV1({ config: cfg, messages: actual.messages, options: actual.options, maxInputTokens: 100_000, maxOutputTokens: 1200 })
    const capacity = getModelCapacityV1(cfg), budget = modelInputBudgetV1(capacity, 1200)
    const sameClientCheck = trimMessagesToFit(actual.messages, cfg.provider, cfg.model, budget.outputBudget,
      undefined, estimateChatRequestOptionsTokens(actual.options), capacity)
    expect(decision.outputReservation).toBe(budget.outputBudget)
    expect(decision.config.maxTokens).toBe(1200)
    expect(decision.inputBudget).toBe(budget.inputBudget)
    expect(decision.inputTokens).toBe(sameClientCheck.totalInputTokens)
    expect(decision.fits).toBe(true)
    const tinyTask = assessDocumentParseRequestV1({ config: cfg, messages: actual.messages, options: actual.options, maxInputTokens: 20, maxOutputTokens: 1200 })
    expect(tinyTask.fits).toBe(false)
  })

  it('counts current prior context, catalog, system frame and provider options instead of source alone', () => {
    const cfg = config(), source = '短原文'
    expect(estimateTokens(source)).toBeLessThan(assess(cfg, source).inputBudget)
    expect(assess(cfg, source).fits).toBe(true)
    expect(assess(cfg, source, '动态上文'.repeat(1500)).fits).toBe(false)
    const catalog = buildDocumentParseFrameV1({ template, provider: cfg.provider, sourceText: source, knownContext: '', chunkIndex: 0, totalChunks: 1,
      categories: [{ ref: 'category', label: '动态目录'.repeat(1500), fields: [] }] })
    expect(assessDocumentParseRequestV1({ config: cfg, messages: catalog.messages, options: catalog.options, maxInputTokens: 100_000, maxOutputTokens: 16_384 }).fits).toBe(false)
    const hugeSystem = buildDocumentParseFrameV1({ template: { ...template, systemPrompt: '系统'.repeat(5000) }, provider: cfg.provider, sourceText: '', knownContext: '', categories: [], chunkIndex: 0, totalChunks: 1 })
    expect(assessDocumentParseRequestV1({ config: cfg, messages: hugeSystem.messages, options: hugeSystem.options, maxInputTokens: 100_000, maxOutputTokens: 16_384 }).fits).toBe(false)
    expect(assessDocumentParseRequestV1({ config: cfg, messages: frame(source).messages,
      options: { jsonSchema: { name: 'fixture', schema: { description: '原生结构开销'.repeat(1500) } } }, maxInputTokens: 100_000, maxOutputTokens: 16_384 }).fits).toBe(false)
  })

  it('retains exact provider options and complete context in the one shared frame builder', () => {
    for (const provider of ['deepseek', 'custom', 'openai'] as const) {
      const actual = buildDocumentParseFrameV1({ template, provider, sourceText: 'ORIGINAL', knownContext: 'PRIOR', categories: [], chunkIndex: 2, totalChunks: 9 })
      expect(actual.messages[1].content).toBe('3/9 PRIOR\nORIGINAL')
      expect(actual.options).toEqual(provider === 'deepseek' ? { responseFormat: 'json_object', thinkingMode: 'disabled' } : provider === 'custom' ? { responseFormat: 'json_object' } : undefined)
    }
  })
})

describe('031-F opt-in exact UTF-16 range planner', () => {
  it.each([
    '  \r\n第一章 巨章\r\n' + '海'.repeat(3001) + '\r\n第二章 尾声\r\n余音  \r\n',
    '前言'.repeat(500) + '\r\n\r\n' + '段落'.repeat(1000) + '\n\n尾部  ',
    ' \r\n😀𠀀Cafe\u0301'.repeat(60) + ' \r\n',
    '\r\n\r\n   \n\t',
  ])('covers every code unit without a5000-character floor or split CRLF/surrogate', text => {
    let checks = 0
    const chunks = planAdaptiveDocumentParseChunksV1(text, chunk => { checks++; return chunk.charCount <= 37 })
    coverage(text, chunks)
    expect(chunks.every(chunk => chunk.charCount <= 37)).toBe(true)
    expect(checks).toBeLessThan((text.length + 1) * 25)
  })

  it('uses the physical complete frame for every range, and checks final actual total', () => {
    const cfg = config(), text = '长段落需要完整交付。'.repeat(200)
    const totals: number[] = []
    const chunks = planAdaptiveDocumentParseChunksV1(text, (chunk, totalChunks) => {
      totals.push(totalChunks)
      const actual = buildDocumentParseFrameV1({ template, provider: cfg.provider, sourceText: chunk.text, knownContext: '真实上文', categories: [], chunkIndex: chunk.index, totalChunks })
      return assessDocumentParseRequestV1({ config: cfg, messages: actual.messages, options: actual.options, maxInputTokens: 100_000, maxOutputTokens: 16_384 }).fits
    })
    coverage(text, chunks)
    expect(chunks.length).toBeGreaterThan(1)
    expect(totals.slice(-chunks.length)).toEqual(chunks.map(() => chunks.length))
  })

  it('handles nonmonotonic fit conservatively and rejects frame drift rather than sending unverified ranges', () => {
    const text = 'abcdefghijklmno'
    const chunks = planAdaptiveDocumentParseChunksV1(text, chunk => chunk.charCount <= 3 || chunk.charCount === 8)
    coverage(text, chunks)
    expect(chunks.every(chunk => chunk.charCount <= 3 || chunk.charCount === 8)).toBe(true)
    expect(() => planAdaptiveDocumentParseChunksV1(text, (chunk, total) => chunk.charCount <= 3 && total === text.length)).toThrow('最终请求框架已变化')
  })

  it('returns no plan for empty source and fails boundedly for an unfit empty or minimum frame', () => {
    const fits = vi.fn(() => false)
    expect(planAdaptiveDocumentParseChunksV1('', fits)).toEqual([])
    expect(fits).not.toHaveBeenCalled()
    expect(() => planAdaptiveDocumentParseChunksV1('原文', fits)).toThrow('空请求框架')
    expect(() => planAdaptiveDocumentParseChunksV1('😀', chunk => chunk.charCount === 0)).toThrow('最小请求')
  })
})
