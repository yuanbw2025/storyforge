import { afterEach, describe, expect, it } from 'vitest'
import { usePromptStore } from '../../src/stores/prompt'
import { CORE_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-core'
import { buildChapterTaskRequestV2, buildChapterContentRequestV1 } from '../../src/lib/ai/adapters/chapter-adapter'
import { createAuthorLengthIntentV1, resolveTaskLengthPlanV1 } from '../../src/lib/ai/author-length-intent'

const original = usePromptStore.getState()
const seed = (key: 'chapter.content' | 'chapter.continue') => ({ ...CORE_PROMPT_SEEDS.find(item => item.moduleKey === key)!, createdAt: 1, updatedAt: 1 })
const text = (request: ReturnType<typeof buildChapterTaskRequestV2>) => request.messages.map(message => message.content).join('\n')
const automatic = (operation: 'generate' | 'continue') => resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: operation === 'continue' ? 'continue' : 'create' })

describe('B03 new chapter request consumes the frozen length plan, not template quotas', () => {
  afterEach(() => usePromptStore.setState(original, true))

  it.each(['generate', 'continue'] as const)('%s automatic reference replaces managed 2500/1500 without changing the stored template', operation => {
    const template = { ...seed(operation === 'continue' ? 'chapter.continue' : 'chapter.content'), modelOverride: { temperature: 0, maxTokens: 123 } }
    const before = JSON.stringify(template)
    usePromptStore.setState({ getActive: () => template })
    const context = '原始世界规则与章纲。'.repeat(3000) + '唯一来源尾标：不得预知未来。'
    const draft = '当前正文首标。' + '已经发生且必须保留的事实。'.repeat(500) + '当前正文尾标。'
    const result = buildChapterTaskRequestV2({ operation, lengthPlan: automatic(operation), chapterTitle: '盐门', chapterSummary: '检查盐门后停笔',
      gatewayContext: context, existingContent: draft, userHint: '不要追加新的冲突。' })
    expect(result.lengthPlan).toMatchObject({ mode: 'automatic', referenceWords: 4000 })
    expect(text(result)).toContain('参考不是下限或上限')
    expect(text(result).split(context)).toHaveLength(2)
    expect(text(result)).not.toContain('字数约 2500 字/章')
    expect(text(result)).not.toContain('续写篇幅 1500 字')
    if (operation === 'continue') {
      expect(text(result).split(draft)).toHaveLength(2)
      expect(text(result)).toContain('只统计新增片段')
    }
    expect(result.modelOverride).toEqual({ temperature: 0 })
    expect(JSON.stringify(template)).toBe(before)
  })

  it('explicit range has no additional default ceiling; custom omitted sources and current draft are delivered once and complete', () => {
    const template = { ...seed('chapter.continue'), scope: 'user' as const,
      systemPrompt: '作者字面设定：上一章有一封1500字旧信。', userPromptTemplate: '作者模板只写任务，不插入资料变量。' }
    usePromptStore.setState({ getActive: () => template })
    const intent = createAuthorLengthIntentV1({ quantifier: 'range', minWords: 300_001, maxWords: 400_001, source: 'control', basis: 'additional-text' })
    const lengthPlan = resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: 'continue', intent })
    const context = '完整来源。'.repeat(20000) + '登记来源尾部。', existingContent = '旧稿首部。'.repeat(1000) + '旧稿尾部。'
    const result = buildChapterTaskRequestV2({ operation: 'continue', lengthPlan, chapterTitle: '盐门', chapterSummary: '收店', gatewayContext: context,
      existingContent, userHint: '按作者指令，不添加新人物。' })
    expect(text(result)).toContain('300001～400001')
    expect(text(result)).toContain('上一章有一封1500字旧信')
    expect(text(result)).not.toContain('约4000')
    expect(text(result).split(context)).toHaveLength(2)
    expect(text(result).split(existingContent)).toHaveLength(2)
    expect(text(result)).toContain('按作者指令，不添加新人物。')
    expect(result.lengthPlan).toEqual(lengthPlan)
  })

  it('a confirmed task arrangement without a numeric reference never receives another implicit 4000 target', () => {
    usePromptStore.setState({ getActive: () => seed('chapter.content') })
    const lengthPlan = resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: 'create', referenceWords: null,
      arrangement: { version: 1, basis: 'confirmed-outline', sourceKeys: ['ragSelection'] } })
    const result = buildChapterTaskRequestV2({ operation: 'generate', lengthPlan, chapterTitle: '盐门', chapterSummary: '本章按确认的场景终点安排', gatewayContext: '' })
    expect(text(result)).not.toContain('4000')
    expect(result.lengthPlan).toEqual(lengthPlan)
  })

  it('rejects a plan for another operation rather than counting an entire existing draft as newly generated words', () => {
    expect(() => buildChapterTaskRequestV2({ operation: 'continue', lengthPlan: automatic('generate'), chapterTitle: '盐门', chapterSummary: '收店', gatewayContext: '' }))
      .toThrow('篇幅计划不匹配')
  })

  it('legacy request rendering retains its frozen default and output override', () => {
    const template = { ...seed('chapter.content'), modelOverride: { temperature: 0, maxTokens: 123 } }
    usePromptStore.setState({ getActive: () => template })
    const legacy = buildChapterContentRequestV1('盐门', '收店', '', '', '')
    expect(legacy.messages.map(message => message.content).join('\n')).toContain('2500')
    expect(legacy.modelOverride).toEqual({ temperature: 0, maxTokens: 123 })
  })
})
