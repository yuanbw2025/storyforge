import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../../../src/lib/db/schema'

class LegacyV42 extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(42).stores({
      projects: '++id, updatedAt',
      worldviews: '++id, projectId, worldGroupId',
      histories: '++id, projectId, worldGroupId',
    })
  }
}

describe('WORLD-1 · v43 历史主入口归并', () => {
  afterEach(async () => {
    db.close()
    await Dexie.delete('storyforge')
  })

  it('逐版升级只归并同世界历史，已有正式历史保留在前且旧字段最终移除', async () => {
    db.close()
    await Dexie.delete('storyforge')
    const old = new LegacyV42('storyforge')
    await old.open()
    const projectId = await old.table('projects').add({ name: '多世界旧项目', updatedAt: 1 }) as number
    await old.table('worldviews').bulkAdd([
      { projectId, worldGroupId: 11, historyLine: '甲世界旧史', worldEvents: '甲世界旧事', createdAt: 1, updatedAt: 1 },
      { projectId, worldGroupId: 22, historyLine: '乙世界旧史', worldEvents: '乙世界旧事', createdAt: 1, updatedAt: 1 },
      { projectId, worldGroupId: 33, historyLine: '丙世界旧史', worldEvents: '', createdAt: 1, updatedAt: 1 },
    ])
    await old.table('histories').bulkAdd([
      { projectId, worldGroupId: 11, overview: '', eraSystem: '甲纪元', events: '[]', createdAt: 1, updatedAt: 1 },
      { projectId, worldGroupId: 22, overview: '乙世界正式历史', eraSystem: '', events: '[]', createdAt: 1, updatedAt: 1 },
    ])
    old.close()

    await db.open()
    const histories = await db.histories.where('projectId').equals(projectId).toArray()
    const byWorld = new Map(histories.map(history => [history.worldGroupId, history]))
    expect(byWorld.get(11)?.overview).toBe('甲世界旧史\n\n【旧版世界大事记】\n甲世界旧事')
    expect(byWorld.get(11)?.eraSystem).toBe('甲纪元')
    expect(byWorld.get(22)?.overview).toBe('乙世界正式历史\n\n乙世界旧史\n\n乙世界旧事')
    expect(byWorld.get(33)?.overview).toBe('丙世界旧史')

    const worldviews = await db.worldviews.where('projectId').equals(projectId).toArray() as Array<Record<string, unknown>>
    expect(worldviews.find(row => row.worldGroupId === 11)).not.toHaveProperty('historyLine')
    expect(worldviews.find(row => row.worldGroupId === 22)).not.toHaveProperty('worldEvents')
  })
})
