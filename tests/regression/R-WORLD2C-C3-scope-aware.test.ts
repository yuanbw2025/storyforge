import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { readOwnedRows, assertRecordInScope } from '../../src/lib/world-engine/scope'
import type { WorkspaceScope } from '../../src/lib/types/world-ownership'
import { appendAgentEvent, getOrCreateAgentConversation, readAgentEvents } from '../../src/lib/agent/conversations'

async function createGoldenProject(): Promise<{ projectId: number; worldId: number; a: WorkspaceScope; b: WorkspaceScope }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'C3 Golden Project', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '共享世界，隔离作品', targetWordCount: 100000, createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: 'c3-golden-world', name: '共享世界 Canon', description: 'World only',
    currentVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  const workA = await db.works.add({
    projectId, worldId, title: '作品 A', description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 50000, createdAt: now, updatedAt: now,
  }) as number
  const workB = await db.works.add({
    projectId, worldId, title: '作品 B', description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 50000, createdAt: now, updatedAt: now,
  }) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workA, ownershipSchemaVersion: 1 })
  return {
    projectId,
    worldId,
    a: { projectId, worldId, workId: workA },
    b: { projectId, worldId, workId: workB },
  }
}

describe('WORLD-2C C3 · scope-aware world/work chain', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('同一 World 下两部 Work 的故事核心与正文上下文严格隔离', async () => {
    const { a, b } = await createGoldenProject()
    const now = Date.now()
    const outlineA = await db.outlineNodes.add({
      projectId: a.projectId, workId: a.workId, worldId: null, parentId: null,
      type: 'chapter', title: 'A 章纲', summary: 'A only', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const outlineB = await db.outlineNodes.add({
      projectId: b.projectId, workId: b.workId, worldId: null, parentId: null,
      type: 'chapter', title: 'B 章纲', summary: 'B only', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const chapterA = await db.chapters.add({
      projectId: a.projectId, workId: a.workId, outlineNodeId: outlineA, title: 'A 正文',
      content: '<p>A only prose</p>', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    await db.chapters.add({
      projectId: b.projectId, workId: b.workId, outlineNodeId: outlineB, title: 'B 正文',
      content: '<p>B only prose</p>', order: 0, createdAt: now, updatedAt: now,
    } as any)
    await db.storyCores.bulkAdd([
      { projectId: a.projectId, workId: a.workId, worldId: null, theme: 'A theme', createdAt: now, updatedAt: now },
      { projectId: b.projectId, workId: b.workId, worldId: null, theme: 'B theme', createdAt: now, updatedAt: now },
    ] as any)

    const contextA = await assembleContext({
      projectId: a.projectId, scope: a, sourceKeys: ['storyCore', 'chapterContent'], chapterId: chapterA,
    })
    expect(contextA.text).toContain('A theme')
    expect(contextA.text).toContain('A only prose')
    expect(contextA.text).not.toContain('B theme')
    expect(contextA.text).not.toContain('B only prose')

    const contextB = await assembleContext({
      projectId: b.projectId, scope: b, sourceKeys: ['storyCore'],
    })
    expect(contextB.text).toContain('B theme')
    expect(contextB.text).not.toContain('A theme')
  })

  it('结构化写回按 Work owner 定位，不能用另一部作品的 recordId 越界更新', async () => {
    const { a, b } = await createGoldenProject()
    const now = Date.now()
    const [aId, bId] = await db.storyCores.bulkAdd([
      { projectId: a.projectId, workId: a.workId, worldId: null, theme: 'old A', createdAt: now, updatedAt: now },
      { projectId: b.projectId, workId: b.workId, worldId: null, theme: 'old B', createdAt: now, updatedAt: now },
    ] as any, { allKeys: true }) as number[]

    const writtenA = await adopt({
      projectId: a.projectId, scope: a, target: 'storyCores',
      mode: 'replace', data: { theme: 'new A' },
    })
    expect(writtenA.written).toHaveLength(1)
    expect((await db.storyCores.get(aId))?.theme).toBe('new A')
    expect((await db.storyCores.get(bId))?.theme).toBe('old B')

    const crossScope = await adopt({
      projectId: a.projectId, scope: a, target: 'storyCores',
      mode: 'replace', data: { theme: 'must not touch B' },
    })
    expect(crossScope.written).toHaveLength(1)
    expect((await db.storyCores.get(aId))?.theme).toBe('must not touch B')
    expect((await db.storyCores.get(bId))?.theme).toBe('old B')
  })

  it('selector 和 owner gate 只返回当前 scope，互斥 owner 或错 scope 均拒绝', async () => {
    const { a, b } = await createGoldenProject()
    const now = Date.now()
    const row = await db.storyCores.add({
      projectId: a.projectId, workId: a.workId, worldId: null, theme: 'A', createdAt: now, updatedAt: now,
    } as any) as number
    const owned = await readOwnedRows<any>(b, 'storyCores', { owner: 'work' })
    expect(owned).toEqual([])
    expect(await assertRecordInScope(a, 'storyCores', await db.storyCores.get(row), { owner: 'work' })).toBe(true)
    expect(await assertRecordInScope(b, 'storyCores', await db.storyCores.get(row), { owner: 'work' })).toBe(false)
    await expect(adopt({
      projectId: a.projectId, scope: { ...a, workId: 999999 }, target: 'storyCores', mode: 'replace', data: { theme: 'bad' },
    })).rejects.toThrow('WorkspaceScope')
  })

  it('Agent 对话与事件流按 Work 隔离，不能读取另一部作品的运行记录', async () => {
    const { a, b } = await createGoldenProject()
    const conversationA = await getOrCreateAgentConversation({ projectId: a.projectId, worldGroupId: null, scope: a })
    const conversationB = await getOrCreateAgentConversation({ projectId: b.projectId, worldGroupId: null, scope: b })
    await appendAgentEvent({ projectId: a.projectId, scope: a, conversationId: conversationA.id!, kind: 'message', role: 'user', content: 'A event' })
    await appendAgentEvent({ projectId: b.projectId, scope: b, conversationId: conversationB.id!, kind: 'message', role: 'user', content: 'B event' })
    expect((await readAgentEvents(conversationA.id!, a)).map(event => event.content)).toEqual(['A event'])
    expect((await readAgentEvents(conversationB.id!, b)).map(event => event.content)).toEqual(['B event'])
    expect(await readAgentEvents(conversationB.id!, a)).toEqual([])
  })
})
