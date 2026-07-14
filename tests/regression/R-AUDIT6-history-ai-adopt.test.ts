import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'

async function createProject(name: string): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name,
    genre: '',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: true,
    createdAt: now,
    updatedAt: now,
  } as any) as number
}

describe('AUDIT-6 · 历史双 agent 采纳写回', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('通过 FIELD_REGISTRY 定点写入事件考据与关键词风暴，不改其它字段', async () => {
    const projectId = await createProject('历史项目')
    const now = Date.now()
    const eventId = await db.historicalTimelineEvents.add({
      projectId,
      worldGroupId: 3,
      era: 'custom',
      year: 1,
      date: '元年',
      title: '建城',
      description: '原始定稿',
      isHistorical: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const keywordId = await db.historicalKeywords.add({
      projectId,
      worldGroupId: 3,
      keyword: '水车',
      category: 'technology',
      era: 'custom',
      description: '原始说明',
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const eventResult = await adopt({
      projectId,
      worldGroupId: 3,
      target: 'historicalTimelineEvents',
      recordId: eventId,
      mode: 'replace',
      data: { aiConsult: '考据结果' },
    })
    const keywordResult = await adopt({
      projectId,
      worldGroupId: 3,
      target: 'historicalKeywords',
      recordId: keywordId,
      mode: 'replace',
      data: { aiBrainstorm: '风暴结果' },
    })

    expect(eventResult.written[0].fields).toContain('aiConsult')
    expect(keywordResult.written[0].fields).toContain('aiBrainstorm')
    expect(await db.historicalTimelineEvents.get(eventId)).toMatchObject({
      title: '建城', description: '原始定稿', aiConsult: '考据结果',
    })
    expect(await db.historicalKeywords.get(keywordId)).toMatchObject({
      keyword: '水车', description: '原始说明', aiBrainstorm: '风暴结果',
    })
  })

  it('recordId 属于其它项目时拒绝写入', async () => {
    const ownerProjectId = await createProject('所属项目')
    const otherProjectId = await createProject('其它项目')
    const now = Date.now()
    const eventId = await db.historicalTimelineEvents.add({
      projectId: ownerProjectId,
      era: 'custom', year: 1, date: '元年', title: '秘密', description: '',
      isHistorical: false, createdAt: now, updatedAt: now,
    } as any) as number

    const result = await adopt({
      projectId: otherProjectId,
      target: 'historicalTimelineEvents',
      recordId: eventId,
      mode: 'replace',
      data: { aiConsult: '越权写入' },
    })

    expect(result.written).toHaveLength(0)
    expect(result.skipped[0].reason).toContain('不属于当前项目')
    expect((await db.historicalTimelineEvents.get(eventId))?.aiConsult).toBeUndefined()
  })

  it('历史 agent 目标只允许 recordId 定点采纳，不能新增不完整历史行', async () => {
    const projectId = await createProject('历史项目')
    const result = await adopt({
      projectId,
      target: 'historicalTimelineEvents',
      mode: 'add',
      data: { aiConsult: '孤立结果' },
    })

    expect(result.written).toHaveLength(0)
    expect(result.skipped[0].reason).toContain('仅允许 recordId 定点更新')
    expect(await db.historicalTimelineEvents.count()).toBe(0)
  })
})
