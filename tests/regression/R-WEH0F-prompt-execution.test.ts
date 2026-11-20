import { describe, expect, it } from 'vitest'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import {
  createPromptExecutionRequestV1,
  freezePromptExecutionOptionsV1,
  parsePromptExecutionEvidenceV1,
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
})
