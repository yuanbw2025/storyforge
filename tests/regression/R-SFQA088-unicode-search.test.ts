import { describe, expect, it, vi } from 'vitest'
import { findChapterMatches, replaceChapterContent } from '../../src/lib/editor/find-replace'
import { countPlannedReplacements } from '../../src/lib/editor/find-replace-operation'

const target = { id: 1, outlineNodeId: 1, title: 'Unicode', content: '' }

// Bound the old synchronous loop without relying on Vitest's timer interrupting
// a blocked worker. Every real exec and its original result remain unchanged.
function boundedEmptySearch(text: string) {
  const exec = RegExp.prototype.exec
  let calls = 0
  const guard = vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (this: RegExp, input: string) {
    if (this.source === '(?=.)' && input === text && ++calls > 2 * (text.length + 2)) {
      throw new Error('Unicode zero-width search did not advance')
    }
    return exec.call(this, input)
  })
  try {
    const content = `<p>${text}</p>`
    expect(findChapterMatches({ ...target, content }, { query: '(?=.)', useRegex: true })).toBeNull()
    expect(replaceChapterContent(content, { query: '(?=.)', useRegex: true, replacement: 'X' }))
      .toMatchObject({ html: content, count: 0 })
  } finally {
    guard.mockRestore()
  }
}

describe('SFQA-088 · Unicode regex search progress', () => {
  it.each(['😀', '普通 BMP 文本', 'e\u0301😀𠮷终点'])('零宽 Unicode 查找和替换有限终止：%s', boundedEmptySearch)

  it('ordinary emoji matches and capture replacements retain code points and HTML', () => {
    const content = '<p>😀e\u0301 😀e\u0301</p>'
    expect(findChapterMatches({ ...target, content }, { query: '😀', useRegex: true })?.count).toBe(2)
    expect(replaceChapterContent(content, { query: '(😀)(e\u0301)', useRegex: true, replacement: '$2$1' }))
      .toMatchObject({ html: '<p>e\u0301😀 e\u0301😀</p>', count: 2 })
  })

  it('one occurrence and whole-book planning use the same matcher', () => {
    const content = '<p>😀 😀</p>'
    expect(replaceChapterContent(content, { query: '😀', useRegex: true, replacement: '🌍' }, { onlyOccurrenceIndex: 1 }))
      .toMatchObject({ html: '<p>😀 🌍</p>', count: 1 })
    expect(countPlannedReplacements([{ ...target, content }, { ...target, id: 2, content: '<p>🌍</p>' }], { query: '😀', useRegex: true }, 'book'))
      .toEqual({ count: 2, affectedChapters: 1 })
  })

  it('protected names and invalid regex feedback remain intact', () => {
    const content = '<p>李明 李明轩 😀</p>'
    expect(replaceChapterContent(content, { query: '李明', replacement: '林照', wholeWord: true, protectedTerms: ['李明轩'] }))
      .toMatchObject({ html: '<p>林照 李明轩 😀</p>', count: 1 })
    expect(() => findChapterMatches({ ...target, content }, { query: '[', useRegex: true })).toThrow()
  })

  it('excessive iterative matches fail explicitly in preview and replacement', () => {
    const content = `<p>${'a'.repeat(100_001)}</p>`
    for (const query of ['a', '(?=.)']) {
      const options = { query, useRegex: true }
      expect(() => findChapterMatches({ ...target, content }, options)).toThrow('单章查找超过 100000 次匹配')
      expect(() => replaceChapterContent(content, { ...options, replacement: 'b' })).toThrow('单章查找超过 100000 次匹配')
    }
  })
})
