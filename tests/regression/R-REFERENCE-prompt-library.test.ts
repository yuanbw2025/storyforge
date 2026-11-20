import { afterEach, beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { usePromptStore } from '../../src/stores/prompt'
import { referenceChunkMessages } from '../../src/lib/reference-analysis/chunk-prompt'
import { readReferenceApplicationGuidance } from '../../src/lib/reference-analysis/prompt-library'
import { buildReferenceDerivedMessagesV1, readReferenceDerivedPromptTemplateSnapshotV1 } from '../../src/lib/reference-analysis/derived-agent-plan'

beforeEach(async () => {
  await db.delete(); await db.open()
  usePromptStore.setState({ templates: [], loaded: false })
})
afterEach(() => { usePromptStore.setState({ templates: [], loaded: false }); db.close() })

it('installs four reference templates and refreshes built-ins without overwriting user templates or activation', async () => {
  await usePromptStore.getState().init()
  const builtins = usePromptStore.getState().templates.filter(t => t.moduleKey.startsWith('reference.'))
  expect(builtins).toHaveLength(4)
  const id = await usePromptStore.getState().cloneTemplate(builtins.find(t => t.moduleKey === 'reference.analyze')!.id!, '作者的细读')
  const custom = usePromptStore.getState().templates.find(t => t.id === id)!
  await usePromptStore.getState().saveTemplate({...custom, systemPrompt: '只研究人物互动的作者指令', userPromptTemplate: '作者要求保留静默。'})
  await usePromptStore.getState().setActive(id)
  usePromptStore.setState({loaded: false})
  await usePromptStore.getState().init()
  expect(usePromptStore.getState().getActive('reference.analyze').systemPrompt).toBe('只研究人物互动的作者指令')
  const messages = referenceChunkMessages({runId: 1, ref: {title: '材料', type: 'story'} as any, depth: 'deep', totalChunks: 1, maxTokens: 8192,
    chunk: {index: 0, text: '不可丢掉的完整原文', startChar: 0, endChar: 10, charCount: 10}})
  expect(messages[0].content).toContain('只研究人物互动的作者指令')
  expect(messages.map(m => m.content).join('\n')).not.toContain('重要方法给短原创例和失效例')
  expect(messages[0].content).toContain('固定交付协议')
  expect(messages[1].content).toContain('作者要求保留静默。')
  expect(messages[1].content).toContain('不可丢掉的完整原文')
})

it('renders active summary/character instructions but keeps registered baseline and strict contracts', async () => {
  await usePromptStore.getState().init()
  for (const mode of ['summary','characters'] as const) {
    const base = usePromptStore.getState().getActive(`reference.${mode}`)
    const before = readReferenceDerivedPromptTemplateSnapshotV1(mode)
    const id = await usePromptStore.getState().cloneTemplate(base.id!, `我的${mode}`)
    const cloned = usePromptStore.getState().templates.find(t => t.id === id)!
    await usePromptStore.getState().saveTemplate({...cloned, systemPrompt: '作者的专题指令', userPromptTemplate: '保留每个分歧'})
    await usePromptStore.getState().setActive(id)
    const messages = buildReferenceDerivedMessagesV1({mode, registeredContext: '本次登记的完整基线'})
    expect(messages[0].content).toContain('作者的专题指令')
    expect(messages[0].content).toContain('严格输出协议')
    expect(messages[1].content).toContain('本次登记的完整基线')
    expect(messages[1].content).toContain('保留每个分歧')
    expect(readReferenceDerivedPromptTemplateSnapshotV1(mode)).not.toEqual(before)
  }
})

it('applies the activated original-use template while retaining fixed reference ownership boundary', async () => {
  await usePromptStore.getState().init()
  const base = usePromptStore.getState().getActive('reference.application')
  const id = await usePromptStore.getState().cloneTemplate(base.id!, '我的运用')
  const cloned = usePromptStore.getState().templates.find(t => t.id === id)!
  await usePromptStore.getState().saveTemplate({...cloned, systemPrompt: '只借鉴关系处理', userPromptTemplate: '不沿用场景骨架'})
  await usePromptStore.getState().setActive(id)
  expect(readReferenceApplicationGuidance()).toContain('只借鉴关系处理')
  expect(readReferenceApplicationGuidance()).toContain('不沿用场景骨架')
  expect(readReferenceApplicationGuidance()).toContain('固定参考边界')
})
