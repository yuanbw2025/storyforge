import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { runChapterMemoryTask } from '../../src/lib/ai/chapter-memory/run-chapter-memory'
import { getChapterDerivedMemoryStatus } from '../../src/lib/ai/chapter-memory/text-normalization'

async function seed() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'NS1 T3', genre: 'fantasy', description: '', targetWordCount: 1000,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, parentId: null, type: 'chapter', title: '第一章', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const content = '<p>林砚把青铜铃藏入左袖。</p><p>他答应天亮前抵达雾港。</p>'
  const chapterId = await db.chapters.add({
    projectId, outlineNodeId, title: '第一章', content, wordCount: 22,
    status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  return { projectId, chapterId, content }
}

const validOutput = JSON.stringify({
  summary: '林砚藏好青铜铃，并承诺天亮前抵达雾港。',
  handoff: {
    finalScene: {
      location: '',
      storyTime: '天亮前',
      activeCharacters: ['林砚'],
      lastAction: '答应天亮前抵达雾港',
    },
    stateChanges: ['青铜铃被藏入左袖'],
    knowledgeChanges: [],
    commitments: ['天亮前抵达雾港'],
    openLoops: ['能否按时抵达'],
    immediateNextIntent: '前往雾港',
    evidenceQuotes: [{ quote: '他答应天亮前抵达雾港。' }],
  },
})

describe('NS-1 T3 · single-call chapter memory task', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('calls the model once and atomically persists summary + handoff', async () => {
    const { projectId, chapterId, content } = await seed()
    const call = vi.fn(async () => validOutput)
    const result = await runChapterMemoryTask({
      projectId,
      chapterId,
      chapterTitle: '第一章',
      chapterContent: content,
      call,
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('written')
    const chapter = await db.chapters.get(chapterId)
    expect(chapter?.summary).toContain('青铜铃')
    expect(chapter?.continuityHandoff?.commitments).toEqual(['天亮前抵达雾港'])
    expect(await getChapterDerivedMemoryStatus(chapter!)).toMatchObject({
      summary: 'verified',
      handoff: 'verified',
    })
  })

  it('does not let an old async result overwrite edited prose', async () => {
    const { projectId, chapterId, content } = await seed()
    const call = vi.fn(async () => {
      await db.chapters.update(chapterId, { content: '<p>作者在等待期间改了正文。</p>' })
      return validOutput
    })
    const result = await runChapterMemoryTask({
      projectId,
      chapterId,
      chapterTitle: '第一章',
      chapterContent: content,
      call,
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('stale')
    const chapter = await db.chapters.get(chapterId)
    expect(chapter?.summary).toBeUndefined()
    expect(chapter?.continuityHandoff).toBeUndefined()
  })

  it('fails soft on malformed output without writing partial memory', async () => {
    const { projectId, chapterId, content } = await seed()
    const result = await runChapterMemoryTask({
      projectId,
      chapterId,
      chapterTitle: '第一章',
      chapterContent: content,
      call: async () => 'not-json',
    })
    expect(result.status).toBe('parse-error')
    expect((await db.chapters.get(chapterId))?.summary).toBeUndefined()
  })
})
