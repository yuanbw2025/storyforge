import { describe, expect, it } from 'vitest'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import {
  createPromptExecutionRequestV1,
  freezePromptExecutionOptionsV1,
  parsePromptExecutionEvidenceV1,
  parsePromptExecutionOptionsV1,
  renderFrozenPromptExecutionV1,
  verifyPromptExecutionOptionsV1,
} from '../../src/lib/agent/prompt-execution'
import { formatWorldviewFieldGenerationRequestV1 } from '../../src/lib/agent/worldview-field-copilot'
import { formatStoryCoreGenerationRequestV1 } from '../../src/lib/agent/story-core-copilot'
import { formatCharacterGenerationRequestV1 } from '../../src/lib/agent/character-copilot'

function template(input: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: 71,
    scope: 'user',
    moduleKey: 'worldview.dimension',
    promptType: 'generate',
    name: '作者模板 A',
    description: 'WEH-0F test',
    systemPrompt: '模板系统：{{tone}} / {{dimension}}',
    userPromptTemplate: '模板用户：{{projectName}} / {{worldContext}}',
    variables: ['tone', 'dimension', 'projectName', 'worldContext'],
    parameters: [{ key: 'tone', label: '基调', type: 'text', default: '严肃' }],
    modelOverride: { temperature: 0.7, maxTokens: 3_000 },
    isActive: true,
    createdAt: 10,
    updatedAt: 20,
    ...input,
  }
}

describe('WEH-0F Prompt execution contract', () => {
  it('冻结实际模板、参数和覆盖项，system/user override 落入正确 role 且硬约束不可覆盖', async () => {
    const options = await freezePromptExecutionOptionsV1({
      request: createPromptExecutionRequestV1({
        moduleKey: 'worldview.dimension',
        parameterValues: { tone: '冷峻' },
        systemOverride: '作者 system override：{{tone}}',
        userOverride: '作者 user override：{{projectName}}',
        temperature: 0.4,
        maxTokens: 2_500,
      }),
      template: template(),
    })
    const longInstruction = `保留多层事实：${'潮民、雾港与旧钟塔。'.repeat(130)}`
    const rendered = await renderFrozenPromptExecutionV1({
      options,
      context: { projectName: '雾港', dimension: '种族与民族', worldContext: '正式事实' },
      hardSystem: 'HARNESS_HARD_JSON_SCOPE_PERMISSION',
      authorInstruction: longInstruction,
      additionalUserMessages: ['REGISTERED_CONTEXT_ONLY'],
    })

    expect(rendered.messages[0]).toEqual({
      role: 'system',
      content: '作者 system override：冷峻\n\nHARNESS_HARD_JSON_SCOPE_PERMISSION',
    })
    expect(rendered.messages.filter(message => message.role === 'system')).toHaveLength(1)
    expect(rendered.messages[1]).toEqual({ role: 'user', content: '作者 user override：雾港' })
    expect(rendered.messages[2].role).toBe('user')
    expect(rendered.messages[2].content).toContain(longInstruction)
    expect(rendered.messages.at(-1)?.content).toBe('REGISTERED_CONTEXT_ONLY')
    expect(rendered.generationOverrides).toEqual({ temperature: 0.4, maxTokens: 2_500 })
    expect(parsePromptExecutionEvidenceV1(rendered.evidence)).toEqual(rendered.evidence)
  })

  it('修改激活模板内容会改变模板 hash 和实际消息 hash', async () => {
    const request = createPromptExecutionRequestV1({ moduleKey: 'worldview.dimension' })
    const first = await freezePromptExecutionOptionsV1({ request, template: template() })
    const second = await freezePromptExecutionOptionsV1({
      request,
      template: template({ id: 72, name: '作者模板 B', systemPrompt: '完全不同的模板系统' }),
    })
    const base = {
      context: { projectName: '雾港', dimension: '种族与民族', worldContext: '正式事实' },
      hardSystem: 'HARNESS HARD',
      authorInstruction: '生成种族与民族',
    }
    const firstRun = await renderFrozenPromptExecutionV1({ options: first, ...base })
    const secondRun = await renderFrozenPromptExecutionV1({ options: second, ...base })
    expect(first.templateHash).not.toBe(second.templateHash)
    expect(firstRun.evidence.renderedPromptHash).not.toBe(secondRun.evidence.renderedPromptHash)
    expect(firstRun.messages).not.toEqual(secondRun.messages)
  })

  it('历史 1000 字静默截断已删除；超过明确 8000 字上限时调用前报错', () => {
    const inRange = '设定'.repeat(700)
    expect(formatWorldviewFieldGenerationRequestV1({ field: 'races', mode: 'expand', hint: inRange }))
      .toContain(inRange)
    expect(formatStoryCoreGenerationRequestV1({ field: 'theme', mode: 'rewrite', hint: inRange }))
      .toContain(inRange)
    expect(formatCharacterGenerationRequestV1({ hint: inRange })).toContain(inRange)

    const overLimit = '超长'.repeat(4_100)
    expect(() => formatWorldviewFieldGenerationRequestV1({ field: 'races', mode: 'expand', hint: overLimit }))
      .toThrow('没有截断')
    expect(formatStoryCoreGenerationRequestV1({ field: 'theme', mode: 'expand', hint: overLimit })).toContain(overLimit)
    expect(() => formatCharacterGenerationRequestV1({ hint: overLimit })).toThrow('没有截断')
  })

  it('冻结内容被篡改或参数未在模板声明时 fail closed', async () => {
    const options = await freezePromptExecutionOptionsV1({
      request: createPromptExecutionRequestV1({
        moduleKey: 'worldview.dimension',
        parameterValues: { tone: '冷峻' },
      }),
      template: template(),
    })
    await expect(verifyPromptExecutionOptionsV1({
      ...options,
      template: { ...options.template, systemPrompt: '被篡改' },
    })).rejects.toThrow('冻结内容与 hash 不一致')
    await expect(freezePromptExecutionOptionsV1({
      request: createPromptExecutionRequestV1({
        moduleKey: 'worldview.dimension',
        parameterValues: { undeclared: '越权参数' },
      }),
      template: template(),
    })).rejects.toThrow('未在冻结模板中声明')
  })

  it('author selection overrides the current template and is consumed without changing legacy frozen bytes', async () => {
    for (const moduleKey of ['inspiration.reverse', 'inspiration.reverse.multiworld'] as const) {
      const selected = template({ moduleKey })
      const request = createPromptExecutionRequestV1({ moduleKey, parameterValues: { tone: 'BOUND_TONE' } })
      const legacy = await freezePromptExecutionOptionsV1({ request, template: selected })
      const bound = await freezePromptExecutionOptionsV1({
        request: createPromptExecutionRequestV1({ ...request, selection: { template: legacy.template, templateHash: legacy.templateHash } }),
        template: template({ moduleKey, id: 999, systemPrompt: 'UNRELATED_GLOBAL_CONTENT' }),
      })
      expect(JSON.stringify(bound)).toBe(JSON.stringify(legacy))
      expect(bound).not.toHaveProperty('selection')
      expect(parsePromptExecutionOptionsV1(JSON.parse(JSON.stringify(bound)), moduleKey)).toEqual(legacy)
      const renderInput = { context: { projectName: 'Owned work', dimension: 'D', worldContext: 'W' }, hardSystem: 'HARD_BOUNDARY', authorInstruction: 'Author request' }
      const actual = await renderFrozenPromptExecutionV1({ options: bound, ...renderInput })
      expect(actual).toEqual(await renderFrozenPromptExecutionV1({ options: legacy, ...renderInput }))
      expect(actual.messages[0].content).toContain('BOUND_TONE')
      expect(JSON.stringify(actual.messages)).not.toContain('UNRELATED_GLOBAL_CONTENT')
      expect(await freezePromptExecutionOptionsV1({ request: { ...request, selection: { template: legacy.template, templateHash: legacy.templateHash } } })).toEqual(legacy)
    }
  })

  it('rejects malformed, cross-module, undeclared-parameter and tampered selections before execution', async () => {
    const options = await freezePromptExecutionOptionsV1({ request: { version: 1, moduleKey: 'inspiration.reverse' }, template: template({ moduleKey: 'inspiration.reverse' }) })
    const selection = { template: options.template, templateHash: options.templateHash }
    expect(() => createPromptExecutionRequestV1({ moduleKey: 'inspiration.reverse.multiworld', selection })).toThrow('moduleKey')
    expect(() => createPromptExecutionRequestV1({ moduleKey: 'inspiration.reverse', selection: { ...selection, templateHash: 'invalid' } })).toThrow('hash')
    expect(() => createPromptExecutionRequestV1({ moduleKey: 'inspiration.reverse', selection, parameterValues: { undeclared: true } })).toThrow('未在冻结模板中声明')
    await expect(freezePromptExecutionOptionsV1({ request: { version: 1, moduleKey: 'inspiration.reverse', selection: { ...selection, template: { ...selection.template, systemPrompt: 'TAMPERED' } } } })).rejects.toThrow('hash')
    await expect(freezePromptExecutionOptionsV1({ request: { version: 1, moduleKey: 'inspiration.reverse' } })).rejects.toThrow('缺少冻结模板')
    expect(() => parsePromptExecutionOptionsV1({ ...options, selection })).toThrow('未声明字段')
  })


  it('keeps the pre-selection V1 frozen bytes, hashes and actual default messages unchanged', async () => {
    const options = await freezePromptExecutionOptionsV1({ request: { version: 1, moduleKey: 'worldview.dimension' }, template: template() })
    const baselineBytes = "{\"version\":1,\"moduleKey\":\"worldview.dimension\",\"template\":{\"id\":71,\"scope\":\"user\",\"moduleKey\":\"worldview.dimension\",\"promptType\":\"generate\",\"name\":\"作者模板 A\",\"description\":\"WEH-0F test\",\"systemPrompt\":\"模板系统：{{tone}} / {{dimension}}\",\"userPromptTemplate\":\"模板用户：{{projectName}} / {{worldContext}}\",\"variables\":[\"tone\",\"dimension\",\"projectName\",\"worldContext\"],\"modelOverride\":{\"temperature\":0.7,\"maxTokens\":3000},\"parameters\":[{\"key\":\"tone\",\"label\":\"基调\",\"type\":\"text\",\"default\":\"严肃\"}],\"createdAt\":10,\"updatedAt\":20},\"templateHash\":\"9d2ccc06e422cdf25159615471c36bf834cf346c9165972312d6ef6488eaacef\",\"parameterValuesHash\":\"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a\",\"overridesHash\":\"78cdd5d5524a835ba92738f324d9a397736eb7a8337c069c7450c53ef6147813\"}"
    expect(JSON.stringify(options)).toBe(baselineBytes)
    const rendered = await renderFrozenPromptExecutionV1({ options,
      context: { dimension: '维度', projectName: '雾港', worldContext: '正式事实' }, hardSystem: 'HARD', authorInstruction: '作者请求' })
    expect(rendered.messages).toEqual([
      { role: 'system', content: '模板系统：严肃 / 维度\n\nHARD' },
      { role: 'user', content: '模板用户：雾港 / 正式事实' },
      { role: 'user', content: '【作者本轮明确要求】\n作者请求' },
    ])
    expect(rendered.generationOverrides).toEqual({ temperature: 0.7, maxTokens: 3000 })
  })

})
