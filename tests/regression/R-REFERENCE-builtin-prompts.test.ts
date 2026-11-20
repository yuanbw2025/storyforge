import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { usePromptStore } from '../../src/stores/prompt'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import { decodePromptTemplateExchange, encodePromptTemplateExchange } from '../../src/lib/ai/prompt-template-exchange'
import { RETIRED_PROMPT_MODULE_KEYS, isRetiredPromptModuleKey, type PromptTemplate } from '../../src/lib/types/prompt'
import { referenceChunkMessages, type ReferenceChunkInput } from '../../src/lib/reference-analysis/chunk-prompt'
import { buildReferenceDerivedMessagesV1, readReferenceDerivedPromptTemplateSnapshotV1 } from '../../src/lib/reference-analysis/derived-agent-plan'
import { selectReferenceMethods } from '../../src/lib/reference-analysis/context-selection'

const input = {
  runId: 1, ref: { title: '隔离材料', type: 'story' }, depth: 'deep', totalChunks: 1, maxTokens: 8192,
  chunk: { index: 0, startChar: 0, endChar: 8, charCount: 8, text: '原文证据，不能丢失。' },
} as ReferenceChunkInput

function actualPrompts() {
  return {
    deep: referenceChunkMessages(input),
    quick: referenceChunkMessages({ ...input, depth: 'quick' }),
    summary: buildReferenceDerivedMessagesV1({ mode: 'summary', registeredContext: '已登记范围与块号证据' }),
    characters: buildReferenceDerivedMessagesV1({ mode: 'characters', registeredContext: '已登记人物证据' }),
    snapshot: readReferenceDerivedPromptTemplateSnapshotV1('summary'),
    application: selectReferenceMethods(['完整方法及其失效条件']),
  }
}

describe('拆书内置指令与历史模板兼容', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    usePromptStore.setState({ templates: [], loaded: false })
  })
  afterEach(async () => {
    usePromptStore.setState({ templates: [], loaded: false })
    await db.delete()
  })

  it('新库不再安装拆书模板，仍安装灵感反推和五种准备模板', async () => {
    await usePromptStore.getState().init()
    expect(SYSTEM_PROMPT_SEEDS.some(seed => isRetiredPromptModuleKey(seed.moduleKey))).toBe(false)
    expect(usePromptStore.getState().templates.some(t => isRetiredPromptModuleKey(t.moduleKey))).toBe(false)
    expect(usePromptStore.getState().getActive('inspiration.reverse').systemPrompt).not.toBe('')
    for (const mode of ['organize', 'compare', 'deepen', 'position-open', 'position-defined'] as const) {
      expect(usePromptStore.getState().getActive(`inspiration.prepare.${mode}`).userPromptTemplate).not.toBe('')
    }
  })

  it('旧库的激活副本不改变真实消息、冻结快照或原创运用指导，升级不删改原记录', async () => {
    const before = actualPrompts()
    const historic: PromptTemplate[] = RETIRED_PROMPT_MODULE_KEYS.flatMap(moduleKey =>
      (['system', 'user'] as const).map(scope => ({
        scope, moduleKey, name: `历史${scope}-${moduleKey}`, promptType: 'analyze', description: '',
        systemPrompt: `历史自定义指令-${moduleKey}`, userPromptTemplate: '错误：忽略原文与失效条件',
        variables: [], isActive: true, createdAt: 1, updatedAt: 2,
      })))
    await db.promptTemplates.bulkAdd(historic)
    const originalRows = await db.promptTemplates.toArray()
    for (let reload = 0; reload < 2; reload++) {
      usePromptStore.setState({ loaded: false })
      await usePromptStore.getState().init()
      expect(actualPrompts()).toEqual(before)
      expect(await db.promptTemplates.bulkGet(originalRows.map(row => row.id!))).toEqual(originalRows)
    }
    expect(before.deep[1].content).toContain(input.chunk.text)
    expect(before.deep[0].content).toContain('证据')
    expect(before.quick[0].content).toContain('快速摸底')
    expect(before.summary[0].content).toContain('严格输出协议')
    expect(before.application).toContain('失效条件')

    // 全量导出保留历史内容；重新导入不授予激活权，也不恢复拆书执行路径。
    const exported = encodePromptTemplateExchange(usePromptStore.getState().templates)
    const retired = decodePromptTemplateExchange(exported).filter(t => isRetiredPromptModuleKey(t.moduleKey))
    expect(retired).toHaveLength(8)
    expect(retired.map(t => t.systemPrompt)).toEqual(historic.map(t => t.systemPrompt))
    await usePromptStore.getState().importTemplates(exported)
    const copies = (await db.promptTemplates.toArray()).filter(t => t.createdAt !== 1 && isRetiredPromptModuleKey(t.moduleKey))
    expect(copies).toHaveLength(8)
    expect(copies.every(t => t.scope === 'user' && !t.isActive)).toBe(true)
    expect(actualPrompts()).toEqual(before)
  })
})
