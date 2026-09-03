import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const opened: Dexie[] = []
const names: string[] = []

function databaseName(): string {
  const name = `legacy-v58-adventure-table-${Math.random()}`
  names.push(name)
  return name
}

function track<T extends Dexie>(database: T): T {
  opened.push(database)
  return database
}

class LegacyV57DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(57).stores({
      gameDefinitions: '++id, projectId, worldId, workId, &[workId+productKey], productType, status, narrativeModuleId, updatedAt',
      agentRuns: '++id, projectId, workId, simulationSessionId, worldGroupId, conversationId, parentRunId, &[parentRunId+parentRelation], status, updatedAt',
    })
  }
}

class LegacyAdventureV58DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(57).stores({
      gameDefinitions: '++id, projectId, worldId, workId, &[workId+productKey], productType, status, narrativeModuleId, updatedAt',
      agentRuns: '++id, projectId, workId, simulationSessionId, worldGroupId, conversationId, parentRunId, &[parentRunId+parentRelation], status, updatedAt',
    })
    this.version(58).stores({
      adventureModules: '++id, projectId, worldId, workId, &gameDefinitionId, [workId+gameDefinitionId], updatedAt',
    })
  }
}

afterEach(async () => {
  for (const database of opened.splice(0)) database.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('LEGACY-MIGRATION · v57 -> v58 adventure-table precursor', () => {
  it('只新增空作者内容表，保留旧定义并约束每个定义只有一个冒险模块', async () => {
    const name = databaseName()
    const legacy = track(new LegacyV57DB(name))
    await legacy.open()
    const definitionId = await legacy.table('gameDefinitions').add({
      projectId: 1, worldId: 2, workId: 3, productKey: 'legacy-story',
      productType: 'storygame', status: 'draft', narrativeModuleId: 4, updatedAt: 5,
    })
    legacy.close()

    const upgraded = track(new LegacyAdventureV58DB(name))
    await upgraded.open()
    expect(await upgraded.table('gameDefinitions').get(definitionId)).toMatchObject({ productKey: 'legacy-story' })
    expect(await upgraded.table('adventureModules').count()).toBe(0)
    const row = { projectId: 1, worldId: 2, workId: 3, gameDefinitionId: definitionId, contentJson: '{}', updatedAt: 7 }
    await upgraded.table('adventureModules').add(row)
    await expect(upgraded.table('adventureModules').add(row)).rejects.toBeDefined()
  })
})
