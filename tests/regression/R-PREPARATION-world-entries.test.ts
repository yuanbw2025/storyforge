import { afterEach, describe, expect, it } from 'vitest'
import { usePromptStore } from '../../src/stores/prompt'
import { TOOL_PROMPT_SEEDS, } from '../../src/lib/ai/prompt-seeds-tools'
import { buildInspirationReversePrompt, buildInspirationReverseMultiWorldPrompt } from '../../src/lib/ai/inspiration-reverse'
import { buildWorldSuggestPromptFromRegisteredContextV1, buildWorldExpandPromptFromRegisteredContextV1 } from '../../src/lib/ai/world-group-ai'
import { buildCodexEnrichPromptFromRegisteredContextV1, buildCodexExtractPromptFromRegisteredContextV1 } from '../../src/lib/ai/adapters/structured-extract-adapter'
import { buildWorldRulesManifest } from '../../src/lib/ai/world-rules-manifest'
import { createEmptyProfile } from '../../src/lib/types/world-rules'
import type { HistoricalTimelineEvent, HistoricalKeyword } from '../../src/lib/types/history'

const original = usePromptStore.getState().templates
afterEach(() => usePromptStore.setState({ templates: original }))
function authorTemplates() {
  const keys = ['inspiration.reverse', 'inspiration.reverse.multiworld', 'world-group.suggest', 'world-group.expand', 'codex.enrich', 'codex.extract']
  usePromptStore.setState({ templates: TOOL_PROMPT_SEEDS.filter(seed => keys.includes(seed.moduleKey)).map((seed, i) => ({ ...seed, id: i + 9000, scope: 'user', name: '作者激活模板', systemPrompt: '作者固定要求：朴素、具体。', createdAt: 1, updatedAt: 1 })) })
}
const text = (messages: Array<{ content: string }>) => messages.map(m => m.content).join('\n')
describe('准备与世界独立入口的方法及资料边界', () => {
  it('完整反推和整组世界路径保留作者模板，使用登记上下文且不在作者模板后强加创作方法', () => {
    authorTemplates()
    const before = JSON.stringify(usePromptStore.getState().templates)
    const builders = [buildInspirationReversePrompt('作品', '', '原创南枝与铃壳'), buildInspirationReverseMultiWorldPrompt('作品', '', '原创南枝与铃壳'), buildWorldSuggestPromptFromRegisteredContextV1('登记材料：仅原世界的物件可保留'), buildWorldExpandPromptFromRegisteredContextV1('登记材料：物件颜色会变但数量不变')]
    builders.forEach(messages => expect(text(messages)).toContain('作者固定要求：朴素、具体。'))
    expect(text(builders[0])).not.toContain('不默认复仇')
    expect(text(builders[1])).not.toContain('记忆、关系和承诺会延续')
    expect(text(builders[2])).not.toContain('不假定单向通道可返程')
    expect(text(builders[3])).not.toContain('六个字段相互支撑')
    expect(text(builders[3])).toContain('物件颜色会变但数量不变')
    expect(JSON.stringify(usePromptStore.getState().templates)).toBe(before)
  })
  it('词条按冻结的内置标识选方法，自定义类目不靠名字猜类型，抽取仍不得补造', () => {
    usePromptStore.setState({ templates: TOOL_PROMPT_SEEDS.filter(seed => seed.moduleKey.startsWith('codex.')).map((seed, i) => ({ ...seed, id: i + 999, createdAt: 1, updatedAt: 1 })) })
    const city = text(buildCodexEnrichPromptFromRegisteredContextV1({ baselineContext: '分类作者改名为“种族”但标识仍是city', categoryBuiltInKey: 'city', worldContext: '登记世界', authorRequest: '补一处街区', supplementTags: false }))
    expect(city).toContain('空间关系、用途、公共活动与居民经验')
    expect(city).not.toContain('共同经验与内部阶层')
    const custom = text(buildCodexExtractPromptFromRegisteredContextV1({ baselineContext: '分类名为物品，作者自定义schema', categoryBuiltInKey: null, sourceText: '小扣只有显色作用', discoveredNames: [], supplementTags: false }))
    expect(custom).toContain('不从分类名字猜定另一种内置类型')
    expect(custom).toContain('本轮是原文抽取')
    expect(custom).toContain('缺少信息就省略')
    expect(custom).toContain('evidenceQuotes 须为原文逐字引文')
    expect(custom).toContain('分类名为物品，作者自定义schema')
  })
  it('作者史实标记不是检索证明，虚构条目不是自动未来计划，细节不在固定字数处裁掉', () => {
    const profile = { ...createEmptyProfile(1), createdAt: 1, updatedAt: 1, entries: { custom: { historicalAnchors: '作者提供的摘录，尚无原件', fictionalAdaptations: '允许局部架空', priority: 'balanced' as const } } }
    const fullEvent = '历史记录的细节'.repeat(40) + '【事件末尾仍须读取】'
    const fullKeyword = '材料的适用范围'.repeat(20) + '【关键词末尾仍须读取】'
    const manifest = buildWorldRulesManifest(profile, { timelineEvents: [{ title: '作者标记事件', date: '1895（作者选定）', year: 1895, isHistorical: true, description: fullEvent }, { title: '本作去年发生的架空事件', date: '本作去年', year: 1, isHistorical: false, description: '虚构世界的过去，不是作者未来打算' }] as HistoricalTimelineEvent[], keywords: [{ keyword: '地方工艺', category: 'custom', description: fullKeyword }] as unknown as HistoricalKeyword[] })
    expect(manifest).toContain('未经过本入口联网核验')
    expect(manifest).toContain('作者标记的现实参照')
    expect(manifest).not.toContain('以下真实事件不可违反')
    expect(manifest).toContain('本作虚构历史条目')
    expect(manifest).toContain(fullEvent)
    expect(manifest).toContain(fullKeyword)
    expect(manifest).toContain('不为调和而编造共同制度')
    expect(buildWorldRulesManifest({ ...createEmptyProfile(1), createdAt: 1, updatedAt: 1 })).toBe('')
  })
})
