import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import {
  CHAPTER_TEXT_NORMALIZATION_VERSION,
  getChapterDerivedMemoryStatus,
  hashChapterText,
  normalizeChapterText,
} from '../../src/lib/ai/chapter-memory/text-normalization'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'

async function seedChapter(content = '<p>第一行&nbsp;文字</p><p>第二行</p>') {
  const now = Date.now()
  const created = await seedCurrentWorkspace('NS1 T1')
  const { scope } = created
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId, parentId: null, type: 'chapter', title: '第一章', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId: scope.projectId, outlineNodeId, title: '第一章', content, wordCount: 7,
    status: 'draft', order: 0, notes: '', summary: '无来源摘要',
    createdAt: now, updatedAt: now,
  }, { owner: 'work' })) as number
  return { projectId: scope.projectId, chapterId, content }
}

describe('NS-1 T1 · chapter memory fields and atomic CAS', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('normalizes HTML without DOM-dependent differences and hashes deterministically', async () => {
    expect(normalizeChapterText('<p>第一行&nbsp;文字</p><p>第二行</p>')).toBe('第一行 文字\n第二行')
    expect(await hashChapterText('<p>第一行&nbsp;文字</p><p>第二行</p>'))
      .toBe(await hashChapterText('第一行 文字\n第二行'))
  })

  it('缺少来源证据的摘要一律标记为 stale', async () => {
    const { chapterId } = await seedChapter()
    const chapter = await db.chapters.get(chapterId)
    const status = await getChapterDerivedMemoryStatus(chapter!)
    expect(status.summary).toBe('stale')
    expect(status.handoff).toBe('missing')
  })

  it('writes summary and handoff atomically when source hash still matches', async () => {
    const { projectId, chapterId, content } = await seedChapter()
    const sourceTextHash = await hashChapterText(content)
    const result = await adopt({
      projectId,
      recordId: chapterId,
      target: 'chapters',
      mode: 'replace',
      compareAndSet: {
        kind: 'chapter-source-text-hash',
        expectedHash: sourceTextHash,
        textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      },
      data: {
        summary: '已验证摘要',
        summarySourceTextHash: sourceTextHash,
        summaryTextNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
        continuityHandoff: {
          chapterId,
          sourceTextHash,
          schemaVersion: 1,
          extractorVersion: 'test',
          textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
          finalScene: { activeCharacters: ['甲'], lastAction: '离开' },
          stateChanges: [],
          knowledgeChanges: [],
          commitments: [],
          openLoops: ['门外是谁'],
          evidenceQuotes: [],
          generatedAt: Date.now(),
        },
      },
    })

    expect(result.written).toHaveLength(1)
    const chapter = await db.chapters.get(chapterId)
    expect(chapter?.summary).toBe('已验证摘要')
    expect(chapter?.continuityHandoff?.openLoops).toEqual(['门外是谁'])
    expect((await getChapterDerivedMemoryStatus(chapter!)).summary).toBe('verified')
  })

  it('drops the whole stale result when content changes before CAS writeback', async () => {
    const { projectId, chapterId, content } = await seedChapter()
    const sourceTextHash = await hashChapterText(content)
    await db.chapters.update(chapterId, { content: '<p>作者已经改稿</p>' })

    const result = await adopt({
      projectId,
      recordId: chapterId,
      target: 'chapters',
      mode: 'replace',
      compareAndSet: {
        kind: 'chapter-source-text-hash',
        expectedHash: sourceTextHash,
        textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      },
      data: {
        summary: '不应写入',
        summarySourceTextHash: sourceTextHash,
        summaryTextNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      },
    })

    expect(result.written).toHaveLength(0)
    expect(result.skipped[0]?.reason).toContain('CAS 失败')
    expect((await db.chapters.get(chapterId))?.summary).toBe('无来源摘要')
  })
})
