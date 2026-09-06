import { describe, expect, it } from 'vitest'
import {
  buildChapterStatusPatchV1,
  shouldPersistChapterEditorContentV1,
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
})
