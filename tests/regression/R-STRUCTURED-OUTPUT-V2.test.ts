import { describe, expect, it } from 'vitest'
import { renderPrompt } from '../../src/lib/ai/prompt-engine'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import { evaluateStructuredOutputV1, evaluateStructuredOutputV2, parseStructuredOutputV1,
  parseStructuredOutputV2, readStructuredOutputEvidenceV1, StructuredOutputPipelineErrorV1,
  type StructuredOutputContractV1, type StructuredOutputContractV2 } from '../../src/lib/agent/structured-output-pipeline'
const contract: StructuredOutputContractV2 = { version: 2, schemaId: 'worldview-field.text.v2', target: 'worldviews.races', root: 'object', sizePolicy: 'task-content-unbounded', allowedRootFields: ['field', 'value'], requiredRootFields: ['field', 'value'] }
const parse = (value: unknown) => {
  const row = value as { field?: unknown; value?: unknown }
  if (row.field !== 'races' || typeof row.value !== 'string') throw new Error('字段或类型错误')
  return { field: row.field, value: row.value }
}
describe('structured output V2 shares the existing parser and repair evidence', () => {
  it.each([false, true])('retains the author example tail only with explicit content policy (full=%s), preserving old defaults', full => {
    const example = (id: number) => ({ id: String(id), text: `作者样例${id}完整尾部`, source: 'user-marked' as const, createdAt: 1 })
    const template: PromptTemplate = { id: 101, scope: 'user', moduleKey: 'worldview.dimension', promptType: 'generate',
      name: '共享完整样例', description: '', systemPrompt: '作者原系统', userPromptTemplate: '作者原要求',
      variables: [], isActive: true, createdAt: 1, updatedAt: 1,
      examples: { good: [1, 2, 3, 4].map(example), bad: [5, 6, 7].map(example) } }
    const before = structuredClone(template)
    const result = renderPrompt(template, {}, full ? { contentPolicy: 'task-content-unbounded-v2' } : undefined)
    expect(result.messages[0]).toMatchObject({ role: 'system', content: '作者原系统' })
    const user = result.messages.find(message => message.role === 'user')!.content
    expect(user).toContain('作者原要求')
    for (const id of [1, 2, 3, 5, 6]) expect(user).toContain(`作者样例${id}完整尾部`)
    if (full) for (const id of [4, 7]) expect(user).toContain(`作者样例${id}完整尾部`)
    else for (const id of [4, 7]) expect(user).not.toContain(`作者样例${id}完整尾部`)
    expect(template).toEqual(before)
  })

  it('accepts a complete long target and preserves full evidence without a maxChars property', () => {
    const value = '设定'.repeat(120001) + '末尾来源可核'
    const raw = JSON.stringify({ field: 'races', value })
    const result = parseStructuredOutputV2({ raw, contract, parse })
    expect(result.value).toBe(value)
    expect(readStructuredOutputEvidenceV1(result)?.originalText).toBe(raw)
    expect(readStructuredOutputEvidenceV1(result)?.contractShape).toEqual({ root: 'object', allowedRootFields: ['field', 'value'], requiredRootFields: ['field', 'value'] })
  })
  it('retains old V1 forward admission and old legal evidence field shapes', () => {
    const legacy: StructuredOutputContractV1 = { version: 1, schemaId: 'worldview-field.text.v1', target: 'worldviews.races', root: 'object', maxChars: 100, allowedRootFields: ['field', 'value'], requiredRootFields: ['field', 'value'] }
    expect(() => parseStructuredOutputV1({ raw: JSON.stringify({ field: 'races', value: '字'.repeat(101) }), contract: legacy, parse })).toThrow('超过')
    const raw = JSON.stringify({ field: 'races', value: '潮民' })
    const evidence = evaluateStructuredOutputV1({ raw, contract: legacy, parse }).evidence
    expect(evidence).toEqual({ version: 1, schemaId: legacy.schemaId, target: legacy.target,
      contractShape: { root: 'object', allowedRootFields: ['field', 'value'], requiredRootFields: ['field', 'value'] },
      status: 'ready', originalText: raw, normalizedText: raw, normalizationSteps: [], issues: [] })
  })
  it('rejects mixed caps, false V2 policy and malformed roots, fields or target values', () => {
    const raw = JSON.stringify({ field: 'races', value: '潮民' })
    for (const altered of [{ ...contract, maxChars: 999999 }, { ...contract, sizePolicy: 'legacy' }, { ...contract, version: 1 }, { ...contract, unexpected: true }]) {
      expect(() => evaluateStructuredOutputV2({ raw, contract: altered as unknown as StructuredOutputContractV2, parse })).toThrow('合同')
    }
    expect(() => evaluateStructuredOutputV1({ raw, contract: contract as unknown as StructuredOutputContractV1, parse })).toThrow('旧结构化')
    expect(() => parseStructuredOutputV2({ raw: '{"field":"other","value":"潮民"}', contract, parse })).toThrow(StructuredOutputPipelineErrorV1)
    expect(() => parseStructuredOutputV2({ raw: '{"field":"races","value":"潮民","extra":true}', contract, parse })).toThrow(StructuredOutputPipelineErrorV1)
    expect(() => parseStructuredOutputV2({ raw: '{"field":"races","value":', contract, parse })).toThrow(StructuredOutputPipelineErrorV1)
  })
})
