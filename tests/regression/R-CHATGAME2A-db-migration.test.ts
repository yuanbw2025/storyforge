import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const opened: Dexie[] = []
const names: string[] = []

function databaseName(): string {
  const name = `chatgame-v56-${Math.random()}`
  names.push(name)
  return name
}

function track<T extends Dexie>(database: T): T {
  opened.push(database)
  return database
}

class LegacyV55DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(55).stores({
      gameDefinitions: '++id, projectId, worldId, workId, &[workId+gameKey], productType, status, narrativeModuleId, updatedAt',
    })
  }
}

class ChatGameV56DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(55).stores({
      gameDefinitions: '++id, projectId, worldId, workId, &[workId+gameKey], productType, status, narrativeModuleId, updatedAt',
    })
    this.version(56).stores({
      interactionCharacterProfiles: '++id, projectId, worldId, workId, gameDefinitionId, characterId, &[gameDefinitionId+participantKey], [workId+gameDefinitionId], updatedAt',
      interactionSceneTemplates: '++id, projectId, worldId, workId, gameDefinitionId, &[gameDefinitionId+sceneKey], [workId+gameDefinitionId], order, updatedAt',
    })
  }
}

afterEach(async () => {
  for (const database of opened.splice(0)) database.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('R-CHATGAME2A-db-migration · v55 -> v56', () => {
  it('只新增空作者内容表，保留既有 GameDefinition 且稳定 key 唯一', async () => {
    const name = databaseName()
    const legacy = track(new LegacyV55DB(name))
    await legacy.open()
    const definitionId = await legacy.table('gameDefinitions').add({
      projectId: 1,
      worldId: 2,
      workId: 3,
      gameKey: 'legacy-chat',
      productType: 'storygame',
      status: 'draft',
      narrativeModuleId: 4,
      updatedAt: 5,
    })
    legacy.close()

    const upgraded = track(new ChatGameV56DB(name))
    await upgraded.open()
    expect(await upgraded.table('gameDefinitions').get(definitionId)).toMatchObject({ gameKey: 'legacy-chat' })
    expect(await upgraded.table('interactionCharacterProfiles').count()).toBe(0)
    expect(await upgraded.table('interactionSceneTemplates').count()).toBe(0)

    const profile = {
      projectId: 1,
      worldId: 2,
      workId: 3,
      gameDefinitionId: definitionId,
      characterId: 6,
      participantKey: 'keeper',
      updatedAt: 7,
    }
    await upgraded.table('interactionCharacterProfiles').add(profile)
    await expect(upgraded.table('interactionCharacterProfiles').add(profile)).rejects.toBeDefined()
  })
})
