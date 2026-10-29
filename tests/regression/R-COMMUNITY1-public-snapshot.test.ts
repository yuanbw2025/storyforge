import { describe, expect, it } from 'vitest'
import { projectSelectedBookAnalysisV1, projectSelectedNovelV1 } from '../../src/lib/community-works/public-snapshot'
import type { Work } from '../../src/lib/types/world-ownership'
import type { Chapter } from '../../src/lib/types/outline'
import type { Reference, ReferenceAnalysisRun, ReferenceChunkAnalysis } from '../../src/lib/types/reference'

const work = {
  id: 10, projectId: 1, kind: 'novel', title: '灯塔', description: '海边的故事', genres: ['悬疑'],
  code: 'private-work-code', coverImage: 'private-cover', writingStyleId: 'private-style',
} as Work
const chapters = [
  { id: 11, projectId: 1, outlineNodeId: 101, title: '第一章', content: '开端', notes: '私人笔记' },
  { id: 12, projectId: 1, outlineNodeId: 102, title: '第二章', content: '结局', notes: '不要公开' },
] as Chapter[]

const reference = {
  id: 21, projectId: 1, workId: 10, title: '原书', author: '某作者', genre: '悬疑',
  importedData: { sourceFilename: 'private.txt' }, fileHash: 'private-source-hash',
} as Reference
const run = {
  id: 31, projectId: 1, workId: 10, referenceId: 21, version: 2, depth: 'deep', status: 'active',
  sourceFilename: 'private.txt', fileHash: 'private-source-hash', analysisSummary: '私人总评',
} as ReferenceAnalysisRun
const chunks = [
  { referenceId: 21, analysisRunId: 31, chunkIndex: 0, label: '开篇', openingTechnique: '以倒叙制造悬念', rawExcerpt: '原书原文不能自动公开' },
  { referenceId: 21, analysisRunId: 31, chunkIndex: 1, label: '结尾', openingTechnique: '结尾技法', rawExcerpt: '第二段原文' },
] as ReferenceChunkAnalysis[]

describe('community publication snapshot privacy boundary', () => {
  it('publishes exactly the selected chapters in author order, without private Work/Chapter fields', () => {
    const snapshot = projectSelectedNovelV1({
      work, chapters, ownedOutlineNodeIds: new Set([101, 102]), selectedChapterIds: [12, 11], publicRightsConfirmed: true,
    })
    expect(snapshot.chapters).toEqual([
      { title: '第二章', content: '结局' }, { title: '第一章', content: '开端' },
    ])
    const json = JSON.stringify(snapshot)
    for (const secret of ['私人笔记', '不要公开', 'private-work-code', 'private-style', 'private-cover']) {
      expect(json).not.toContain(secret)
    }
  })

  it('rejects missing consent, a foreign outline node and unselected/missing chapter', () => {
    const input = { work, chapters, ownedOutlineNodeIds: new Set([101, 102]), selectedChapterIds: [11], publicRightsConfirmed: true }
    expect(() => projectSelectedNovelV1({ ...input, publicRightsConfirmed: false })).toThrow('单独确认')
    expect(() => projectSelectedNovelV1({ ...input, ownedOutlineNodeIds: new Set([101]) })).toThrow('归属')
    expect(() => projectSelectedNovelV1({ ...input, selectedChapterIds: [999] })).toThrow('不存在')
    expect(() => projectSelectedNovelV1({ ...input, selectedChapterIds: [] })).toThrow('非空')
  })

  it('publishes selected analysis dimensions only and never raw source excerpts or local identities', () => {
    const snapshot = projectSelectedBookAnalysisV1({
      reference, run, chunks, selectedChunkIndices: [0], selectedDimensions: ['openingTechnique'],
      authorCommentary: '我学到的技法', publicRightsConfirmed: true,
    })
    expect(snapshot.dimensions).toHaveLength(13)
    expect(snapshot.dimensions.find(item => item.key === 'openingTechnique')?.entries).toEqual([
      { label: '开篇', text: '以倒叙制造悬念' },
    ])
    expect(snapshot.dimensions.find(item => item.key === 'characterCraft')).toEqual({ key: 'characterCraft', selected: false, entries: [] })
    const json = JSON.stringify(snapshot)
    for (const secret of ['原书原文', '第二段原文', 'private.txt', 'private-source-hash', '私人总评', '结尾技法']) {
      expect(json).not.toContain(secret)
    }
  })

  it('rejects cross-version analysis, unfinished runs and a selection without actual analysis', () => {
    const input = { reference, run, chunks, selectedChunkIndices: [0], selectedDimensions: ['openingTechnique'] as const, authorCommentary: '', publicRightsConfirmed: true }
    expect(() => projectSelectedBookAnalysisV1({ ...input, run: { ...run, id: 32 } })).toThrow('归属')
    expect(() => projectSelectedBookAnalysisV1({ ...input, run: { ...run, status: 'analyzing' } })).toThrow('尚未完成')
    expect(() => projectSelectedBookAnalysisV1({ ...input, selectedDimensions: ['characterCraft'] })).toThrow('没有可公开')
    expect(() => projectSelectedBookAnalysisV1({ ...input, publicRightsConfirmed: false })).toThrow('单独确认')
  })
})
