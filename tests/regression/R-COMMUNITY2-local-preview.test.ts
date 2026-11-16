import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { loadSelectedNovelPreview } from '../../src/lib/community-works/local-preview'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, OutlineNode } from '../../src/lib/types/outline'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe('community preview reads the governed local owner scope', () => {
  it('reads only a selected chapter, preserves the DB and rejects another workspace chapter', async () => {
    const first = await createWorkspace({ name: '甲作品', description: '', genres: [], status: 'drafting', targetWordCount: 10000 })
    const second = await createWorkspace({ name: '乙作品', description: '', genres: [], status: 'drafting', targetWordCount: 10000 })
    const addChapter = async (scope: typeof first.scope, title: string, text: string) => {
      const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
        type: 'chapter', parentId: null, title, summary: '', order: 0, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }) as OutlineNode) as number
      return db.chapters.add(stampNewRecord(scope, 'chapters', {
        outlineNodeId, title, content: text, notes: '只在本地保存的笔记', wordCount: 2,
        status: 'final', order: 0, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }) as Chapter) as Promise<number>
    }
    const ownId = await addChapter(first.scope, '甲章', '仅此正文')
    const foreignId = await addChapter(second.scope, '乙章', '不属于甲')
    const before = await db.chapters.toArray()
    const preview = await loadSelectedNovelPreview({ scope: first.scope, selectedChapterIds: [ownId], publicRightsConfirmed: true })
    expect(preview.chapters).toEqual([{ title: '甲章', content: '仅此正文' }])
    expect(JSON.stringify(preview)).not.toContain('只在本地保存的笔记')
    await expect(loadSelectedNovelPreview({ scope: first.scope, selectedChapterIds: [foreignId], publicRightsConfirmed: true })).rejects.toThrow('不存在')
    expect(await db.chapters.toArray()).toEqual(before)
  })
})
