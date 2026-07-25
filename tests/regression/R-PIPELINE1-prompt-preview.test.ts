import { beforeEach, describe, expect, it } from 'vitest'
import {
  isPreviewDraftDirty,
  messagesToPreviewDraft,
  previewDraftToMessages,
  readPromptPreviewEnabled,
  summarizePreviewDraft,
  writePromptPreviewEnabled,
  PROMPT_PREVIEW_STORAGE_KEY,
} from '../../src/lib/ai/prompt-preview'
import { maybePreviewMessages, usePromptPreviewStore } from '../../src/stores/prompt-preview'
import type { ChatMessage } from '../../src/lib/types'

const sample: ChatMessage[] = [
  { role: 'system', content: '你是小说作者。' },
  { role: 'user', content: '请写第一章。\n\n【世界观】\n有月亮潮汐。' },
]

describe('PIPELINE-1 · 发送前提示词预览', () => {
  beforeEach(() => {
    localStorage.removeItem(PROMPT_PREVIEW_STORAGE_KEY)
    usePromptPreviewStore.setState({ pending: null, enabled: false })
  })

  it('messages ↔ draft 往返保持 system/user 内容', () => {
    const draft = messagesToPreviewDraft(sample)
    expect(draft.system).toBe('你是小说作者。')
    expect(draft.user).toContain('月亮潮汐')
    expect(previewDraftToMessages(draft)).toEqual(sample)
  })

  it('编辑草稿可检测 dirty，并产出覆盖后的 messages', () => {
    const draft = messagesToPreviewDraft(sample)
    expect(isPreviewDraftDirty(sample, draft)).toBe(false)
    draft.user = '请写第一章。\n\n【世界观】\n改为血脉觉醒。'
    expect(isPreviewDraftDirty(sample, draft)).toBe(true)
    const edited = previewDraftToMessages(draft)
    expect(edited.find(m => m.role === 'user')?.content).toContain('血脉觉醒')
    expect(edited.find(m => m.role === 'system')?.content).toBe('你是小说作者。')
  })

  it('token 统计对空草稿为 0', () => {
    expect(summarizePreviewDraft({ system: '', user: '', trailing: [] }).totalTokens).toBe(0)
  })

  it('开关默认关：maybePreviewMessages 原样返回，不弹门闩', async () => {
    writePromptPreviewEnabled(false)
    usePromptPreviewStore.setState({ enabled: false, pending: null })
    const result = await maybePreviewMessages(sample)
    expect(result).toEqual(sample)
    expect(usePromptPreviewStore.getState().pending).toBeNull()
  })

  it('开关开启后：编辑确认 → ai.start 应收到编辑后 messages；取消 → null', async () => {
    writePromptPreviewEnabled(true)
    usePromptPreviewStore.setState({ enabled: true, pending: null })

    const pendingPromise = maybePreviewMessages(sample, { title: '正文生成' })
    // 门闩应已挂起
    expect(usePromptPreviewStore.getState().pending?.title).toBe('正文生成')

    const editedDraft = messagesToPreviewDraft(sample)
    editedDraft.system = '你是冷静的近现代异世界作者。'
    usePromptPreviewStore.getState().settle(previewDraftToMessages(editedDraft))
    await expect(pendingPromise).resolves.toEqual([
      { role: 'system', content: '你是冷静的近现代异世界作者。' },
      { role: 'user', content: sample[1]!.content },
    ])

    const cancelPromise = maybePreviewMessages(sample)
    expect(usePromptPreviewStore.getState().pending).not.toBeNull()
    usePromptPreviewStore.getState().settle(null)
    await expect(cancelPromise).resolves.toBeNull()
  })

  it('覆盖不写回 localStorage 里的开关以外任何模板键；开关读写稳定', () => {
    expect(readPromptPreviewEnabled()).toBe(false)
    writePromptPreviewEnabled(true)
    expect(readPromptPreviewEnabled()).toBe(true)
    usePromptPreviewStore.getState().setEnabled(false)
    expect(readPromptPreviewEnabled()).toBe(false)
    expect(localStorage.getItem('storyforge-ai-config')).toBeNull()
  })

  it('force 可在开关关闭时仍弹出（供测试/一次性入口）', async () => {
    usePromptPreviewStore.setState({ enabled: false, pending: null })
    const p = maybePreviewMessages(sample, { force: true })
    expect(usePromptPreviewStore.getState().pending).not.toBeNull()
    usePromptPreviewStore.getState().settle(sample)
    await expect(p).resolves.toEqual(sample)
  })
})

describe('PIPELINE-1 · ChapterEditor 接线', () => {
  it('正文生成/续写路径会调用 maybePreviewMessages', async () => {
    const src = await import('node:fs').then(fs =>
      fs.readFileSync('src/components/editor/ChapterEditor.tsx', 'utf8'),
    )
    expect(src).toContain('maybePreviewMessages')
    expect(src).toContain("category: 'chapter.content'")
    expect(src).toContain("category: 'chapter.continue'")
    // 取消时不 start
    expect(src).toMatch(/if \(!toSend\) return/)
  })
})
