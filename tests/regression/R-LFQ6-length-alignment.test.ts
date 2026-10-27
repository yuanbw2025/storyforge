import { afterEach, describe, expect, it } from 'vitest'
import { usePromptStore } from '../../src/stores/prompt'
import { CORE_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-core'
import { buildChapterContentRequestV1, buildContinueRequestV1 } from '../../src/lib/ai/adapters/chapter-adapter'
import { proseLengthExpectationV1 } from '../../src/lib/prose/length-observation'

const original = usePromptStore.getState()
const seed = (key: 'chapter.content' | 'chapter.continue') => ({ ...CORE_PROMPT_SEEDS.find(item => item.moduleKey === key)!, createdAt: 1, updatedAt: 1 })
const wire = (request: { messages: { content: string }[] }) => request.messages.map(item => item.content).join('\n').replace(/\s/g, '')

describe('LFQ6 · 作者明确篇幅与实际模板一致', () => {
  afterEach(() => usePromptStore.setState(original, true))

  it.each(['chapter.content', 'chapter.continue'] as const)('作者模板不含 userHint 时 %s 仍交付本轮完整要求，不改模板或参数', key => {
    const template = { ...seed(key), continuityMode: 'off' as const, systemPrompt: '作者保留的系统模板。', userPromptTemplate: '作者保留的任务模板。', modelOverride: { temperature: 0, maxTokens: 1900 } }
    const saved = JSON.stringify(template)
    usePromptStore.setState({ getActive: () => template })
    const hint = '只写600字。\n先问同行者意愿，签收后停笔。'
    const request = key === 'chapter.content'
      ? buildChapterContentRequestV1('收店', '', '', '', '', '', hint)
      : buildContinueRequestV1('开始清点。', '', '', hint)
    const content = request.messages.map(item => item.content).join('\n')
    expect(content).toContain(hint)
    expect(content.split(hint)).toHaveLength(2)
    expect(content).toContain('作者保留的任务模板。')
    expect(JSON.stringify(template)).toBe(saved)
    expect(request.modelOverride).toEqual({ temperature: 0, maxTokens: 1900 })
  })

  it('模板已交付的本轮要求不重复，空提示不添加空块', () => {
    const template = { ...seed('chapter.content'), continuityMode: 'off' as const, userPromptTemplate: '{{userHint}}' }
    usePromptStore.setState({ getActive: () => template })
    const hint = '不要增加敌人，签收后停笔。'
    const request = buildChapterContentRequestV1('收店', '', '', '', '', '', hint)
    expect(request.messages.map(item => item.content).join('\n').split(hint)).toHaveLength(2)
    expect(wire(buildChapterContentRequestV1('收店', '', '', '', '', '', '  '))).not.toContain('【本轮作者补充要求】')
  })

  it('600～900 字替代本轮默认 2500，其它默认基调和节奏保留，模板未改写', () => {
    const template = seed('chapter.content')
    usePromptStore.setState({ getActive: () => template })
    const request = buildChapterContentRequestV1('收店', '签收后停笔', '完整资料', '', '', '', '写600至900字。签收后停笔。')
    expect(wire(request)).toContain('字数约600～900字/章')
    expect(wire(request)).not.toContain('字数约2500字/章')
    expect(wire(request)).toContain('严肃风格')
    expect(wire(request)).toContain('节奏中')
    expect(template.parameters!.find(item => item.key === 'chapterLength')!.default).toBe(2500)
  })

  it('显式关闭可选长度保持关闭，不会因作者有范围而重新开启；已有参数对象不变', () => {
    const template = seed('chapter.content')
    usePromptStore.setState({ getActive: () => template })
    const parameterValues = { tone: '轻松', chapterLength: '' }
    const request = buildChapterContentRequestV1('收店', '关灯', '', '', '', '', '写600至900字。', { parameterValues })
    expect(wire(request)).not.toContain('字数约')
    expect(wire(request)).toContain('轻松风格')
    expect(wire(request)).not.toContain('节奏中')
    expect(parameterValues).toEqual({ tone: '轻松', chapterLength: '' })
  })

  it('上下限保留单边语义，自有模板的字面内容和模型参数保留', () => {
    const template = { ...seed('chapter.content'), scope: 'user' as const, systemPrompt: '自有模板：角色回忆2500字的旧信。{{#if usesChapterLength}}篇幅{{chapterLength}}字{{/if}}', userPromptTemplate: '{{userHint}}', modelOverride: { temperature: 0, maxTokens: 4000 } }
    usePromptStore.setState({ getActive: () => template })
    const cap = buildChapterContentRequestV1('收店', '', '', '', '', '', '不要超过600字。')
    expect(wire(cap)).toContain('篇幅≤600字')
    expect(wire(cap)).toContain('角色回忆2500字的旧信')
    expect(cap.modelOverride).toEqual({ temperature: 0, maxTokens: 4000 })
    const floor = buildChapterContentRequestV1('收店', '', '', '', '', '', '至少600字。')
    expect(wire(floor)).toContain('篇幅≥600字')
  })

  it('续写实际采用 continueLength，不再与硬编码 1000～2000 字并存，可明确关闭', () => {
    const template = seed('chapter.continue')
    usePromptStore.setState({ getActive: () => template })
    const request = buildContinueRequestV1('两人开始清点工具。', '关灯即停笔', '完整资料', '续写500字。')
    expect(wire(request)).toContain('续写篇幅500字')
    expect(wire(request)).not.toContain('1000-2000')
    const closed = buildContinueRequestV1('旧稿', '关灯', '', '续写500字。', { parameterValues: {} })
    expect(wire(closed)).not.toContain('续写篇幅')
    expect(template.parameters!.find(item => item.key === 'continueLength')!.default).toBe(1500)
  })

  it('旧章计数、引用与角色写信不变成篇幅控制，明确声明与单独范围可识别', () => {
    for (const narrative of ['上章写了600字，本章顺其自然', '主角写600字的信，放在门口', '写给母亲600字的信', '他说：“最多600字”。', '账单要求600～900字，人物拒绝']) expect(proseLengthExpectationV1(narrative)).toBeNull()
    expect(proseLengthExpectationV1('写600字的信，主角读完关灯')).toBeNull()
    expect(proseLengthExpectationV1('只写400字，主角写600字的信')).toMatchObject({ target: 400 })
    expect(proseLengthExpectationV1('本章字数：600～900字')).toMatchObject({ min: 600, max: 900 })
    expect(proseLengthExpectationV1('600～900字，关灯停笔')).toMatchObject({ min: 600, max: 900 })
    expect(proseLengthExpectationV1('续写正文，篇幅控制在600至900字')).toMatchObject({ min: 600, max: 900 })
  })
})
