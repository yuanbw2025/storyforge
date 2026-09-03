import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { buildHistoricalContext, formatWorldviewBlock } from '../../src/lib/ai/context-builder'

describe('WORLD-1 · 正式历史上下文', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('多世界严格隔离，只从正式 History 读取历史', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '历史隔离', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: true, createdAt: now, updatedAt: now,
    } as any) as number
    await db.histories.bulkAdd([
      { projectId, worldGroupId: 1, overview: '甲正式历史', eraSystem: '甲历', events: '[]', createdAt: now, updatedAt: now },
      { projectId, worldGroupId: 2, overview: '乙正式历史', eraSystem: '乙历', events: '[]', createdAt: now, updatedAt: now },
    ])
    await db.historicalTimelineEvents.bulkAdd([
      { projectId, worldGroupId: 1, era: 'custom', year: 1, date: '甲元年', title: '甲事件', description: '', isHistorical: false, createdAt: now, updatedAt: now },
      { projectId, worldGroupId: 2, era: 'custom', year: 2, date: '乙元年', title: '乙事件', description: '', isHistorical: false, createdAt: now, updatedAt: now },
      { projectId, worldGroupId: null, era: 'custom', year: 0, date: '默认年', title: '默认事件', description: '', isHistorical: false, createdAt: now, updatedAt: now },
    ])

    const context = await buildHistoricalContext(projectId, 1)
    expect(context).toContain('甲正式历史')
    expect(context).toContain('甲历')
    expect(context).toContain('甲事件')
    expect(context).not.toContain('乙正式历史')
    expect(context).not.toContain('乙事件')
    expect(context).not.toContain('默认事件')
  })

  it('目标世界没有正式历史时返回空上下文，不从其他世界借用', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '历史空态', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: true, createdAt: now, updatedAt: now,
    } as any) as number
    await db.histories.add({
      projectId, worldGroupId: 2, overview: '乙世界正式历史', eraSystem: '', events: '[]',
      createdAt: now, updatedAt: now,
    })

    const context = await buildHistoricalContext(projectId, 1)
    expect(context).toBe('')
  })

  it('世界观块只格式化当前世界基础字段，历史由独立 History 来源负责', () => {
    const block = formatWorldviewBlock({
      worldOrigin: '星海创世',
      politicsOverview: '议政院',
      economyOverview: '星币贸易',
      cultureOverview: '灯塔祭',
    } as any)
    expect(block).toContain('政治制度：议政院')
    expect(block).toContain('经济制度：星币贸易')
    expect(block).toContain('文化制度：灯塔祭')
  })
})
