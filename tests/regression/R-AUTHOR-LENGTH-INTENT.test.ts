import { describe, expect, it } from 'vitest'
import { authorLengthFromInstructionV1, createAuthorLengthIntentV1, parseAuthorLengthIntentV1,
  describeTaskLengthPlanV1, parseTaskLengthPlanV1, resolveTaskLengthPlanV1 } from '../../src/lib/ai/author-length-intent'

describe('author length intent and automatic task arrangement', () => {
  it('calculates exact 20 percent bounds within safe integers and rejects an unsafe derived ceiling', () => {
    const create = (targetWords: number) => createAuthorLengthIntentV1({ quantifier: 'approximate', targetWords,
      basis: 'final-text', source: 'control' })
    expect(create(7_505_999_378_950_824).acceptance).toEqual({ minWords: 6_004_799_503_160_659, maxWords: 9_007_199_254_740_989 })
    expect(create(100).acceptance).toEqual({ minWords: 80, maxWords: 120 })
    expect(create(200_000).acceptance).toEqual({ minWords: 160_000, maxWords: 240_000 })
    expect(() => create(Number.MAX_SAFE_INTEGER)).toThrow('安全整数')
  })

  it('describes independently arranged components without turning references into required bounds', () => {
    const plan = resolveTaskLengthPlanV1({ taskKind: 'setting-set', operation: 'create', referenceWords: null,
      components: [{ componentKey: '主要分项', taskKind: 'setting-field', referenceWords: 4000 },
        { componentKey: '短分项', taskKind: 'short-field', referenceWords: null }] })
    expect(describeTaskLengthPlanV1(plan)).toContain('主要分项：约4000字作为参考')
    expect(describeTaskLengthPlanV1(plan)).toContain('短分项：按该分项的实际内容安排')
    expect(plan).not.toHaveProperty('intent')
    expect(parseTaskLengthPlanV1(plan)).toEqual(plan)
  })

  it('keeps a 4000 reference automatic with no hidden acceptance range', () => {
    const plan = resolveTaskLengthPlanV1({ taskKind: 'setting-field', operation: 'create' })
    expect(plan).toMatchObject({ mode: 'automatic', referenceWords: 4000, basis: 'final-text' })
    expect(plan).not.toHaveProperty('intent')
    expect(parseTaskLengthPlanV1(JSON.parse(JSON.stringify(plan)))).toEqual(plan)
  })
  it('gives explicit controls precedence, then latest declared instruction, then explicit parameter', () => {
    const plan = resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: 'create', instruction: '只写600字。改为900～1100字。', explicitParameter: 2000 })
    expect(plan).toMatchObject({ mode: 'explicit', intent: { source: 'instruction', acceptance: { minWords: 900, maxWords: 1100 } } })
    const controlled = resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: 'create', instruction: '只写600字',
      control: { mode: 'exact', targetWords: 1000, minWords: null, maxWords: null } })
    expect(controlled).toMatchObject({ intent: { source: 'control', acceptance: { minWords: 1000, maxWords: 1000 } } })
  })
  it('does not turn quoted, historical or narrative numbers into active requirements', () => {
    for (const instruction of ['他说：“至少3000字”。', '上章写了600字，本章顺其自然', '主角写600字的信，放在门口', '> 最多600字\n按场景收尾', '```\n至少5000字\n```']) {
      expect(authorLengthFromInstructionV1(instruction, 'final-text')).toBeNull()
    }
  })
  it('accepts large author limits without the old 200000 gate, and rejects inconsistent frozen bounds', () => {
    const intent = createAuthorLengthIntentV1({ quantifier: 'at-least', minWords: 500000, basis: 'final-text', source: 'control' })
    expect(parseAuthorLengthIntentV1(intent)).toEqual(intent)
    expect(() => parseAuthorLengthIntentV1({ ...intent, acceptance: { minWords: 1, maxWords: null } })).toThrow('界限')
    const auto = resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: 'create' })
    expect(() => parseTaskLengthPlanV1({ ...auto, maxWords: 4000 })).toThrow('字段')
  })
  it('keeps operations and preserves polish, expand and whole-work arrangements', () => {
    expect(resolveTaskLengthPlanV1({ taskKind: 'setting-field', operation: 'polish', originalWords: 5000 })).toMatchObject({ referenceWords: 5000 })
    expect(resolveTaskLengthPlanV1({ taskKind: 'setting-field', operation: 'expand' })).toMatchObject({ basis: 'additional-text', referenceWords: 4000 })
    expect(resolveTaskLengthPlanV1({ taskKind: 'work', operation: 'create' })).toMatchObject({ referenceWords: null })
    expect(resolveTaskLengthPlanV1({ taskKind: 'setting-field', operation: 'expand', instruction: '全文目标恰好8000字' })).toMatchObject({ operation: 'expand', basis: 'final-text' })
  })
})
