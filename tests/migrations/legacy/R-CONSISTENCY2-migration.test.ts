import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const opened: Dexie[] = []
const names: string[] = []

class OldV38DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(38).stores({
      projects: '++id, name',
      temporalFacts: '++id, projectId, characterId, predicate, status, sourceChapterId',
    })
  }
}

class UpgradedV39DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(38).stores({
      projects: '++id, name',
      temporalFacts: '++id, projectId, characterId, predicate, status, sourceChapterId',
    })
    this.version(39).stores({
      knowledgeLedger: '++id, projectId, worldGroupId, characterId, knowledgeKey, factId, sourceChapterId, status',
    })
  }
}

afterEach(async () => {
  for (const database of opened.splice(0)) database.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('CONSISTENCY-2 · v39 knowledgeLedger 迁移', () => {
  it('新增空认知账本且不改写既有项目和 Canon 事实', async () => {
    const name = `consistency2-v39-${Math.random()}`
    names.push(name)

    const old = new OldV38DB(name)
    opened.push(old)
    await old.open()
    await old.table('projects').add({ name: '旧项目' })
    await old.table('temporalFacts').add({
      projectId: 1,
      characterId: 7,
      subjectName: '林飞',
      predicate: 'location',
      value: '洛阳',
      status: 'confirmed',
    })
    old.close()

    const upgraded = new UpgradedV39DB(name)
    opened.push(upgraded)
    await upgraded.open()

    expect(upgraded.verno).toBe(39)
    expect(await upgraded.table('projects').count()).toBe(1)
    expect(await upgraded.table('temporalFacts').count()).toBe(1)
    expect(await upgraded.table('knowledgeLedger').count()).toBe(0)
  })
})
