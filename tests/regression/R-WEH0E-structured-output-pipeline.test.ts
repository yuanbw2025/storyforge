import { describe, expect, it } from 'vitest'
import {
  buildStructuredOutputRepairMessagesV1,
  evaluateStructuredOutputV1,
  StructuredOutputPipelineErrorV1,
  type StructuredOutputContractV1,
} from '../../src/lib/agent/structured-output-pipeline'
import { parseWorldviewFieldCandidateDraft } from '../../src/lib/agent/worldview-field-copilot'
import { parseStoryCoreCandidateDraft } from '../../src/lib/agent/story-core-copilot'
import { parseCharacterCandidateDraft } from '../../src/lib/agent/character-copilot'
import { parseDetailedOutlineCopilotDraftV1 } from '../../src/lib/agent/detailed-outline-copilot'

const contract: StructuredOutputContractV1 = {
  version: 1,
  schemaId: 'test.worldview-field.v1',
  target: 'worldviews.races',
  root: 'object',
  maxChars: 10_000,
  allowedRootFields: ['field', 'value'],
  requiredRootFields: ['field', 'value'],
}

function parseField(value: unknown): { field: string; value: string } {
  const source = value as Record<string, unknown>
  if (source.field !== 'races') throw new Error('field 不在允许范围。')
  if (typeof source.value !== 'string') throw new Error('字段 value 必须是字符串。')
  return { field: source.field, value: source.value }
}

function errorOf(raw: string): StructuredOutputPipelineErrorV1 {
  try {
    evaluateStructuredOutputV1({ raw, contract, parse: parseField })
  } catch (error) {
    if (error instanceof StructuredOutputPipelineErrorV1) return error
    throw error
  }
  throw new Error('预期结构化输出失败')
}

describe('WEH-0E structured output pipeline', () => {
  it('BOM、围栏和前后说明只做可证明的确定性 salvage', () => {
    const bom = evaluateStructuredOutputV1({
      raw: '\uFEFF {"field":"races","value":"潮民"} ',
      contract,
      parse: parseField,
    })
    expect(bom.output.value).toBe('潮民')
    expect(bom.evidence.normalizationSteps).toEqual(['remove-bom', 'trim-outer-whitespace'])

    const fenced = evaluateStructuredOutputV1({
      raw: '```json\n{"field":"races","value":"潮民"}\n```',
      contract,
      parse: parseField,
    })
    expect(fenced.evidence.normalizationSteps).toEqual(['remove-single-json-fence'])

    const explained = evaluateStructuredOutputV1({
      raw: '生成结果如下：\n{"field":"races","value":"潮民"}\n请确认。',
      contract,
      parse: parseField,
    })
    expect(explained.output.value).toBe('潮民')
    expect(explained.evidence.normalizationSteps).toContain('extract-first-balanced-json')
    expect(explained.evidence.status).toBe('usable-with-warnings')
  })

  it('只补相邻数组字符串缺失的逗号，不推断对象成员分隔符', () => {
    const arrayContract: StructuredOutputContractV1 = {
      ...contract,
      allowedRootFields: ['field', 'value', 'temporaryAssumptions'],
    }
    const repaired = evaluateStructuredOutputV1({
      raw: '{"field":"races","value":"潮民","temporaryAssumptions":["成年礼新增""港务共治新增""迁移历史新增"]}',
      contract: arrayContract,
      parse: value => value as Record<string, unknown>,
    })
    expect(repaired.output.temporaryAssumptions).toEqual(['成年礼新增', '港务共治新增', '迁移历史新增'])
    expect(repaired.evidence.normalizationSteps).toContain('insert-missing-array-commas')

    expect(() => evaluateStructuredOutputV1({
      raw: '{"field":"races""value":"潮民"}',
      contract,
      parse: parseField,
    })).toThrow(StructuredOutputPipelineErrorV1)
  })

  it('只合并一个注册允许且不重复的尾字段，不接受未知或重复尾字段', () => {
    const tailContract: StructuredOutputContractV1 = {
      ...contract,
      allowedRootFields: ['field', 'value', 'temporaryAssumptions'],
    }
    const repaired = evaluateStructuredOutputV1({
      raw: '{"field":"races","value":"潮民"},"temporaryAssumptions":["港务组织为临时假设"]}',
      contract: tailContract,
      parse: value => value as Record<string, unknown>,
    })
    expect(repaired.output.temporaryAssumptions).toEqual(['港务组织为临时假设'])
    expect(repaired.evidence.normalizationSteps).toContain('merge-single-allowed-object-tail')

    for (const raw of [
      '{"field":"races","value":"潮民"},"writeOtherField":true}',
      '{"field":"races","value":"潮民"},"value":"覆盖"}',
    ]) {
      expect(() => evaluateStructuredOutputV1({ raw, contract: tailContract, parse: parseField }))
        .toThrow(StructuredOutputPipelineErrorV1)
    }
  })

  it('只去除注册根字段名的多余转义，不接纳未知结构字段', () => {
    const escapedKeyContract: StructuredOutputContractV1 = {
      ...contract,
      allowedRootFields: ['field', 'value', 'temporaryAssumptions'],
    }
    const repaired = evaluateStructuredOutputV1({
      raw: '{"field":"races","value":"潮民",\\"temporaryAssumptions\\":["港务组织为临时假设"]}',
      contract: escapedKeyContract,
      parse: value => value as Record<string, unknown>,
    })
    expect(repaired.output.temporaryAssumptions).toEqual(['港务组织为临时假设'])
    expect(repaired.evidence.normalizationSteps).toContain('unescape-allowed-root-field')

    expect(() => evaluateStructuredOutputV1({
      raw: '{"field":"races","value":"潮民",\\"writeOtherField\\":true}',
      contract: escapedKeyContract,
      parse: parseField,
    })).toThrow(StructuredOutputPipelineErrorV1)
  })

  it('jsonrepair 失效时只转义明显属于正文的多处引号', () => {
    const repaired = evaluateStructuredOutputV1({
      raw: '{"field":"races","value":"潮裔以"船城"迁徙，信奉"潮约"。泊户流传："潮起时找舵母，潮落时找泊户。"\\n随后继续交易。"}',
      contract,
      parse: parseField,
    })
    expect(repaired.output.value).toContain('"船城"')
    expect(repaired.output.value).toContain('"潮起时找舵母，潮落时找泊户。"')
    expect(repaired.evidence.normalizationSteps).toContain('escape-unescaped-json-quotes')

    expect(() => evaluateStructuredOutputV1({
      raw: '{"field":"races","value":"潮民""钟民"}',
      contract,
      parse: parseField,
    })).toThrow(StructuredOutputPipelineErrorV1)
  })

  it('错误字段名和未知字段均 fail closed，不自动改写为正式字段', () => {
    const wrongField = errorOf('{"field":"races","content":"潮民"}')
    expect(wrongField.evidence.issues[0]).toMatchObject({
      code: 'structured-output-unknown-field',
      path: '$.content',
    })
    const unknown = errorOf('{"field":"races","value":"A","writeOtherField":true}')
    expect(unknown.evidence.issues[0]).toMatchObject({
      code: 'structured-output-unknown-field',
      path: '$.writeOtherField',
    })
  })

  it('截断 JSON、多个竞争根、JSON5、缺字段和错误枚举得到稳定机器分类', () => {
    expect(errorOf('{"field":"races","value":"未结束"').evidence.issues[0].code)
      .toBe('structured-output-invalid-json')
    expect(errorOf('{"field":"races","value":"甲"}\n{"field":"races","value":"乙"}').evidence.issues[0].code)
      .toBe('structured-output-ambiguous-root')
    expect(errorOf("{'field':'races','value':'JSON5'}").evidence.issues[0].code)
      .toBe('structured-output-invalid-json')
    expect(errorOf('{"field":"races"}').evidence.issues[0]).toMatchObject({
      code: 'structured-output-missing-field',
      path: '$.value',
    })
    expect(errorOf('{"field":"wrong","value":"A"}').evidence.issues[0].code)
      .toBe('structured-output-invalid-enum')
  })

  it('超长属于 blocked 且不可自动 repair', () => {
    const tiny = { ...contract, maxChars: 20 }
    let caught: StructuredOutputPipelineErrorV1 | null = null
    try {
      evaluateStructuredOutputV1({
        raw: '{"field":"races","value":"内容超过上限"}',
        contract: tiny,
        parse: parseField,
      })
    } catch (error) {
      caught = error as StructuredOutputPipelineErrorV1
    }
    expect(caught?.evidence.status).toBe('blocked')
    expect(caught?.evidence.issues[0].category).toBe('length')
    expect(caught?.retryable).toBe(false)
  })

  it('世界观、故事、角色和细纲对同一种非法 JSON 使用同一 parse 分类', () => {
    const parsers: Array<() => unknown> = [
      () => parseWorldviewFieldCandidateDraft('{"field":'),
      () => parseStoryCoreCandidateDraft('{"field":'),
      () => parseCharacterCandidateDraft('{"name":'),
      () => parseDetailedOutlineCopilotDraftV1('{"scenes":', 'scenes'),
    ]
    for (const parse of parsers) {
      try {
        parse()
        throw new Error('预期结构化输出失败')
      } catch (error) {
        expect(error).toBeInstanceOf(StructuredOutputPipelineErrorV1)
        expect((error as StructuredOutputPipelineErrorV1).evidence.issues[0]).toMatchObject({
          code: 'structured-output-invalid-json',
          category: 'parse',
          path: '$',
        })
      }
    }
  })

  it('repair Prompt 只包含 schema、target、问题和原 raw', () => {
    const parseError = errorOf('{"field":"races"}')
    const messages = buildStructuredOutputRepairMessagesV1({ evidence: parseError.evidence })
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toContain('schema=test.worldview-field.v1')
    expect(messages[0].content).toContain('target=worldviews.races')
    expect(messages[1].content).toContain('{"field":"races"}')
    expect(messages.map(item => item.content).join('\n')).not.toContain('正式上下文')
  })
})
