import { beforeEach, describe, expect, it, vi } from 'vitest'

const complete = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/agent/formal-ai-entry', () => ({ executeRegisteredAIEntryV1: complete }))

import { applySelectedChapterReviewChanges, ChapterReviewError, reviewChapterOutlines, rewriteChapterOutline, toReviewChapters } from '../../src/lib/outline/chapter-reviewer'

const chapters = [{ index: 0, title: '旧信', summary: '保留开头。\n带走旧信。\n保留结尾。' }]
const issue = { id: 'issue-1', issueType: 'logic' as const, severity: 'high' as const, description: '信应当留下', affectedChapters: [0], suggestion: '留下旧信' }

beforeEach(() => { complete.mockReset() })

describe('SFQA-098 · 诊断失败不得投影为成功空报告', () => {
  it.each(['', 'not json', '{', '{}', '[]', '{"summary":"完成","issues":null}', '{"summary":"完成","issues":[{}]}'])('rejects malformed report %j and retains the received response', async raw => {
    complete.mockResolvedValue(raw)
    await expect(reviewChapterOutlines(chapters)).rejects.toMatchObject({ rawOutput: raw })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it.each(['HTTP 401', 'HTTP 402', '结果未知', '已取消'])('preserves %s without implicit retry', async message => {
    const cause = new Error(message)
    complete.mockRejectedValue(cause)
    const failure = await reviewChapterOutlines(chapters).catch(error => error)
    expect(failure).toBeInstanceOf(ChapterReviewError)
    expect(failure.message).toContain(message)
    expect(failure.cause).toBe(cause)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('accepts an explicit empty report without inventing issues', async () => {
    complete.mockResolvedValue('{"summary":"本次未定位到问题","issues":[]}')
    expect(await reviewChapterOutlines(chapters)).toEqual({ summary: '本次未定位到问题', issues: [], rawOutput: '{"summary":"本次未定位到问题","issues":[]}' })
  })
})

describe('SFQA-099 · 模型复述不能替换系统原稿', () => {
  it.each(['带走旧信。', '伪造开头。\n带走旧信。\n保留结尾。', chapters[0].summary + '保留结尾。'])('rejects a missing, forged or repeated original while retaining raw evidence', async originalSummary => {
    const raw = JSON.stringify({ originalSummary, revisedSummary: '留下旧信。', changes: [{ id: 'change-1', chapterIndex: 0, before: '带走旧信。', after: '留下旧信。', reason: '保留线索' }], summary: '留下线索' })
    complete.mockResolvedValue(raw)
    await expect(rewriteChapterOutline(chapters, issue)).rejects.toMatchObject({ rawOutput: raw, message: expect.stringContaining('原摘要') })
    expect(chapters[0].summary).toBe('保留开头。\n带走旧信。\n保留结尾。')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  function response(changes: unknown[], originalSummary = chapters[0].summary) {
    return JSON.stringify({ originalSummary, revisedSummary: '模型漏写的完整摘要不参与采纳', changes, summary: '仅替换选中文字' })
  }
  const patch = { id: 'change-1', chapterIndex: 0, before: '带走旧信。', after: '留下旧信。\n交给林。', reason: '保留线索' }

  it('keeps all unselected bytes and handles multiline patches by source position', async () => {
    complete.mockResolvedValue(response([{ ...patch, id: 'change-2', before: '保留结尾。', after: '新的结尾。' }, patch]))
    const candidate = await rewriteChapterOutline(chapters, issue)
    expect(candidate.baseline).toEqual(chapters[0])
    expect(applySelectedChapterReviewChanges(candidate, new Set(['change-1']))).toBe('保留开头。\n留下旧信。\n交给林。\n保留结尾。')
    expect(applySelectedChapterReviewChanges(candidate, new Set())).toBe(chapters[0].summary)
    expect(() => applySelectedChapterReviewChanges(candidate, new Set(['unknown']))).toThrow('不属于')
  })

  it.each([
    [{ ...patch, before: '不存在的句子。' }],
    [patch, patch],
    [patch, { ...patch, id: 'overlap', before: '带走旧信' }],
    [{ ...patch, chapterIndex: 1 }],
    [{ ...patch, before: '' }],
  ])('rejects missing, duplicate, overlapping and out-of-scope patch sets', async (...changes) => {
    complete.mockResolvedValue(response(changes))
    await expect(rewriteChapterOutline(chapters, issue)).rejects.toBeInstanceOf(ChapterReviewError)
  })

  it.each(['重复。重复。', 'aaa'])('rejects even overlapping repeated before text in %s', async summary => {
    const before = summary === 'aaa' ? 'aa' : '重复。'
    complete.mockResolvedValue(response([{ ...patch, before }], summary))
    await expect(rewriteChapterOutline([{ ...chapters[0], summary }], issue)).rejects.toThrow('唯一')
  })

  it('does not reinterpret new replacement text as another source patch', async () => {
    complete.mockResolvedValue(response([patch, { ...patch, id: 'change-2', before: '保留开头。', after: '带走旧信。' }]))
    const candidate = await rewriteChapterOutline(chapters, issue)
    expect(applySelectedChapterReviewChanges(candidate, new Set(['change-1', 'change-2']))).toBe('带走旧信。\n留下旧信。\n交给林。\n保留结尾。')
  })

  it('does not turn an empty saved summary into placeholder canon', () => {
    expect(toReviewChapters([{ projectId: 1, parentId: null, type: 'chapter', title: '空章', order: 0, summary: '', createdAt: 1, updatedAt: 1 }])[0].summary).toBe('')
  })
})
