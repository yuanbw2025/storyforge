import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { buildBestChapterByOutlineMap, pickBestChapterForOutline } from '../../src/lib/chapters/selectors'
import { resolveCanonicalChapterSequence } from '../../src/lib/ai/chapter-memory/canonical-chapter-sequence'
import { exportProjectMarkdown, exportProjectTXT } from '../../src/lib/export/text-export'
import type { Chapter, OutlineNode } from '../../src/lib/types'

const now = Date.now()

function outline(id: number, parentId: number | null, type: OutlineNode['type'], order = 0): OutlineNode {
  return {
    id, projectId: 1, parentId, type, title: type === 'volume' ? '第一卷' : '第1章',
    summary: type === 'volume' ? '卷摘要' : '章纲摘要', order,
    createdAt: now, updatedAt: now,
  }
}

function chapter(patch: Partial<Chapter>): Chapter {
  return {
    id: patch.id ?? 1,
    projectId: patch.projectId ?? 1,
    outlineNodeId: patch.outlineNodeId ?? 2,
    title: patch.title ?? '第1章',
    content: patch.content ?? '',
    wordCount: patch.wordCount ?? 0,
    status: patch.status ?? 'draft',
    order: patch.order ?? 0,
    notes: patch.notes ?? '',
    createdAt: patch.createdAt ?? now,
    updatedAt: patch.updatedAt ?? now,
  }
}

describe('CF-20260703-10 · duplicate chapter rows do not hide saved prose', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('picks the chapter row with real prose instead of an empty duplicate row', () => {
    const emptyLatest = chapter({ id: 2, content: '', wordCount: 0, updatedAt: now + 1000 })
    const writtenEarlier = chapter({
      id: 1,
      content: '<p>这一章真正写好的正文。</p>',
      wordCount: 11,
      updatedAt: now,
    })

    expect(pickBestChapterForOutline([emptyLatest, writtenEarlier])?.id).toBe(1)
    expect(buildBestChapterByOutlineMap([emptyLatest, writtenEarlier]).get(2)?.id).toBe(1)
  })

  it('uses the best duplicate row in canonical chapter sequence while still reporting anomaly', () => {
    const volume = outline(1, null, 'volume')
    const chapterNode = outline(2, 1, 'chapter')
    const emptyLatest = chapter({ id: 2, content: '', wordCount: 0, updatedAt: now + 1000 })
    const writtenEarlier = chapter({
      id: 1,
      content: '<p>这一章真正写好的正文。</p>',
      wordCount: 11,
      updatedAt: now,
    })

    const result = resolveCanonicalChapterSequence([volume, chapterNode], [emptyLatest, writtenEarlier])

    expect(result.sequence.map(item => item.chapter.id)).toEqual([1])
    expect(result.anomalies.map(item => item.kind)).toContain('duplicate-chapter-mapping')
  })

  it('exports Markdown/TXT with saved prose when an empty duplicate exists for the same outline node', async () => {
    const projectId = await db.projects.add({
      name: '导出重复章项目',
      genre: 'fantasy',
      description: '',
      targetWordCount: 0,
      enableMultiWorld: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const volumeId = await db.outlineNodes.add({
      projectId,
      parentId: null,
      type: 'volume',
      title: '第一卷',
      summary: '卷摘要',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const outlineNodeId = await db.outlineNodes.add({
      projectId,
      parentId: volumeId,
      type: 'chapter',
      title: '第1章',
      summary: '章纲摘要',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    await db.chapters.add({
      projectId,
      outlineNodeId,
      title: '第1章',
      content: '<p>这一章真正写好的正文。</p>',
      wordCount: 11,
      status: 'draft',
      order: 0,
      notes: '',
      createdAt: now,
      updatedAt: now,
    } as any)
    await db.chapters.add({
      projectId,
      outlineNodeId,
      title: '重复空章',
      content: '',
      wordCount: 0,
      status: 'outline',
      order: 99,
      notes: '',
      createdAt: now + 1000,
      updatedAt: now + 1000,
    } as any)

    const md = await exportProjectMarkdown(projectId)
    const txt = await exportProjectTXT(projectId)

    expect(md).toContain('这一章真正写好的正文')
    expect(md).not.toContain('*（大纲：章纲摘要）*')
    expect(txt).toContain('这一章真正写好的正文')
  })
})
