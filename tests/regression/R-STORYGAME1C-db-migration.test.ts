import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const opened: Dexie[] = []
const names: string[] = []

function databaseName(): string {
  const name = `storygame-v55-${Math.random()}`
  names.push(name)
  return name
}

function track<T extends Dexie>(database: T): T {
  opened.push(database)
  return database
}

class LegacyV54DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(54).stores({
      works: '++id, projectId, worldId, [projectId+worldId], [worldId+updatedAt], status',
    })
  }
}

class StoryGameV55DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(54).stores({
      works: '++id, projectId, worldId, [projectId+worldId], [worldId+updatedAt], status',
    })
    this.version(55).stores({
      works: '++id, projectId, worldId, [projectId+worldId], [worldId+updatedAt], status, activeNarrativeModuleId',
    })
  }
}

afterEach(async () => {
  for (const database of opened.splice(0)) database.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('R-STORYGAME1C-db-migration · v54 -> v55', () => {
  it('只增加当前叙事模块索引，保留 Work 数据和空值语义', async () => {
    const name = databaseName()
    const legacy = track(new LegacyV54DB(name))
    await legacy.open()
    const linkedId = await legacy.table('works').add({
      projectId: 1,
      worldId: 2,
      title: '已有作品',
      status: 'drafting',
      activeNarrativeModuleId: 7,
      updatedAt: 3,
    })
    const emptyId = await legacy.table('works').add({
      projectId: 1,
      worldId: 2,
      title: '未选叙事',
      status: 'drafting',
      activeNarrativeModuleId: null,
      updatedAt: 4,
    })
    legacy.close()

    const upgraded = track(new StoryGameV55DB(name))
    await upgraded.open()
    expect(await upgraded.table('works').get(linkedId)).toMatchObject({ title: '已有作品', activeNarrativeModuleId: 7 })
    expect(await upgraded.table('works').get(emptyId)).toMatchObject({ title: '未选叙事', activeNarrativeModuleId: null })
    expect(await upgraded.table('works').where('activeNarrativeModuleId').equals(7).primaryKeys()).toEqual([linkedId])
  })
})
