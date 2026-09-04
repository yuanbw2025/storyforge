import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { runChapterMemoryTask } from '../../src/lib/ai/chapter-memory/run-chapter-memory'
import { getChapterDerivedMemoryStatus } from '../../src/lib/ai/chapter-memory/text-normalization'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

async function seed() {
  const now = Date.now()
  const projectId = await seedCurrentProject({
    name: 'NS1 T3', genres: ['fantasy'], description: '', targetWordCount: 1000,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, parentId: null, type: 'chapter', title: '第一章', summary: '林砚收好青铜铃后前往雾港。',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const content = '<p>林砚把青铜铃藏入左袖。</p><p>他答应天亮前抵达雾港。</p>'
  const chapterId = await db.chapters.add({
    projectId, outlineNodeId, title: '第一章', content, wordCount: 22,
    status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  await finalizeCurrentFixtureV1(projectId)
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
  planReconciliation: {
    completedGoals: [{
      text: '林砚已收好青铜铃',
      evidenceQuotes: [{ quote: '林砚把青铜铃藏入左袖。' }],
    }],
    unfinishedGoals: [{
      text: '尚未实际抵达雾港',
      evidenceQuotes: [{ quote: '他答应天亮前抵达雾港。' }],
    }],
    deviations: [],
    newConstraints: [{
      text: '必须在天亮前抵达',
      evidenceQuotes: [{ quote: '他答应天亮前抵达雾港。' }],
    }],
    nextChapterImpacts: [{
      text: '下一章应从前往雾港继续',
      evidenceQuotes: [{ quote: '他答应天亮前抵达雾港。' }],
    }],
    proposedOutlineSummary: '林砚收好青铜铃，承诺天亮前抵达雾港。',
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
    expect(chapter?.planReconciliation?.completedGoals[0]?.evidenceQuotes[0]?.quote)
      .toBe('林砚把青铜铃藏入左袖。')
    expect(chapter?.planReconciliation?.unfinishedGoals[0]?.text).toContain('尚未实际抵达')
    expect(await getChapterDerivedMemoryStatus(chapter!)).toMatchObject({
      summary: 'verified',
      handoff: 'verified',
    })
  })

  it('keeps valid summary/handoff but drops reconciliation if the outline changed during the call', async () => {
    const { projectId, chapterId, content } = await seed()
    const chapter = await db.chapters.get(chapterId)
    const call = vi.fn(async () => {
      await db.outlineNodes.update(chapter!.outlineNodeId, { summary: '作者在等待期间改了章纲。' })
      return validOutput
    })
    const result = await runChapterMemoryTask({
      projectId,
      chapterId,
      chapterTitle: '第一章',
      chapterContent: content,
      call,
    })

    expect(result.status).toBe('written')
    const stored = await db.chapters.get(chapterId)
    expect(stored?.summary).toContain('青铜铃')
    expect(stored?.continuityHandoff).toBeTruthy()
    expect(stored?.planReconciliation).toBeUndefined()
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
