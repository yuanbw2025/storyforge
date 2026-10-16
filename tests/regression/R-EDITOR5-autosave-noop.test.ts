import { describe, expect, it, vi } from 'vitest'
import {
  buildChapterStatusPatchV1,
  shouldPersistChapterEditorContentV1,
  createChapterEditorDraftBufferV1,
  type ChapterEditorDraftV1,
} from '../../src/lib/authoring/chapter-editor-save'

describe('R-EDITOR5 · 章节编辑器自动保存版本稳定性', () => {
  it('初始化和切章时的同值同步不写库，避免让生成中的正文候选 stale', () => {
    expect(shouldPersistChapterEditorContentV1({ content: '', wordCount: 0 }, '', 0)).toBe(false)
    expect(shouldPersistChapterEditorContentV1({ content: '<p>潮声。</p>', wordCount: 3 }, '<p>潮声。</p>', 3)).toBe(false)
  })

  it('正文或字数真正变化时仍会保存', () => {
    expect(shouldPersistChapterEditorContentV1({ content: '', wordCount: 0 }, '<p>潮声。</p>', 3)).toBe(true)
    expect(shouldPersistChapterEditorContentV1({ content: '<p>潮声。</p>', wordCount: 0 }, '<p>潮声。</p>', 3)).toBe(true)
    expect(shouldPersistChapterEditorContentV1(null, '<p>潮声。</p>', 3)).toBe(false)
  })

  it('切换章节状态时把尚未自动保存的编辑器正文原子写入同一个 patch', () => {
    expect(buildChapterStatusPatchV1('<p>灯还亮着。</p>', 6, 'final')).toEqual({
      content: '<p>灯还亮着。</p>',
      wordCount: 6,
      status: 'final',
    })
  })
  it('没有作者输入时不创建保存；待保存内容保留原章节身份', async () => {
    const persist = vi.fn(async (_draft: ChapterEditorDraftV1) => undefined)
    const drafts = createChapterEditorDraftBufferV1(persist)
    await drafts.flush()
    expect(persist).not.toHaveBeenCalled()
    drafts.stage({ chapterId: 21, html: '<p>第二章。</p>', plainText: '第二章。' })
    drafts.stage({ chapterId: 11, html: '<p>第一章。</p>', plainText: '第一章。' })
    await drafts.flush()
    expect(persist.mock.calls.map(call => call[0])).toEqual([
      { chapterId: 21, html: '<p>第二章。</p>', plainText: '第二章。' },
      { chapterId: 11, html: '<p>第一章。</p>', plainText: '第一章。' },
    ])
    expect(drafts.hasPending()).toBe(false)
  })
  it('保存中继续输入必须写完新稿；旧回执不能清除更新，重复 flush 等待同一操作', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const writes: string[] = []
    const drafts = createChapterEditorDraftBufferV1(async draft => {
      writes.push(draft.html)
      if (writes.length === 1) await gate
    })
    drafts.stage({ chapterId: 21, html: '旧稿', plainText: '旧稿' })
    const first = drafts.flush()
    expect(drafts.flush()).toBe(first)
    drafts.stage({ chapterId: 21, html: '更新的稿件', plainText: '更新的稿件' })
    release()
    await first
    expect(writes).toEqual(['旧稿', '更新的稿件'])
    expect(drafts.hasPending()).toBe(false)
  })
  it('失败后保留原稿与目标，可显式重试，不能误报已保存', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('保存被拒绝')).mockResolvedValue(undefined)
    const drafts = createChapterEditorDraftBufferV1(persist)
    drafts.stage({ chapterId: 21, html: '<p>不能丢。</p>', plainText: '不能丢。' })
    await expect(drafts.flush()).rejects.toThrow('保存被拒绝')
    expect(drafts.read(21)?.html).toBe('<p>不能丢。</p>')
    expect(drafts.hasPending()).toBe(true)
    await drafts.flush()
    expect(persist).toHaveBeenCalledTimes(2)
    expect(drafts.hasPending()).toBe(false)
  })
})
