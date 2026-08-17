import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const opened: Dexie[] = []
const names: string[] = []

function databaseName(): string {
  const name = `storygame-v54-${Math.random()}`
  names.push(name)
  return name
}

function track<T extends Dexie>(database: T): T {
  opened.push(database)
  return database
}

class LegacyV53DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(53).stores({
      simulationSessions: '++id, projectId, worldGroupId, worldId, workId, worldReleaseId, narrativeModuleId, kind, status, parentSessionId, updatedAt',
    })
  }
}

class StoryGameV54DB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(53).stores({
      simulationSessions: '++id, projectId, worldGroupId, worldId, workId, worldReleaseId, narrativeModuleId, kind, status, parentSessionId, updatedAt',
    })
    this.version(54).stores({
      gameDefinitions: '++id, projectId, worldId, workId, &[workId+gameKey], productType, status, narrativeModuleId, updatedAt',
      gameReleases: '++id, projectId, worldId, workId, gameDefinitionId, worldReleaseId, &[gameDefinitionId+version], contentHash, createdAt',
      narrativeBeats: '++id, projectId, moduleId, nodeKey, &[moduleId+beatKey], [moduleId+nodeKey], speakerCharacterId, order',
      narrativeChoices: '++id, projectId, moduleId, sourceNodeKey, &[moduleId+choiceKey], [moduleId+sourceNodeKey], targetNodeKey, order',
      simulationSessions: '++id, projectId, worldGroupId, worldId, workId, worldReleaseId, gameReleaseId, narrativeModuleId, kind, status, parentSessionId, updatedAt',
      simulationEvents: '++id, projectId, worldGroupId, sessionId, &[sessionId+sequence], &[sessionId+commandId], type, createdAt',
    })
  }
}

afterEach(async () => {
  for (const database of opened.splice(0)) database.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('R-STORYGAME1A-db-migration · v53 -> v54', () => {
  it('只新增空内容/发布表并保留旧 SIM 会话', async () => {
    const name = databaseName()
    const legacy = track(new LegacyV53DB(name))
    await legacy.open()
    const sessionId = await legacy.table('simulationSessions').add({
      projectId: 1,
      worldId: 2,
      workId: 3,
      worldReleaseId: 4,
      narrativeModuleId: null,
      kind: 'storygame',
      status: 'active',
      title: '旧发布存档',
      initialStateJson: '{"version":1,"lastSequence":0}',
      updatedAt: 5,
    })
    legacy.close()

    const upgraded = track(new StoryGameV54DB(name))
    await upgraded.open()

    expect(await upgraded.table('simulationSessions').get(sessionId)).toMatchObject({
      title: '旧发布存档',
      worldReleaseId: 4,
    })
    expect(await upgraded.table('gameDefinitions').count()).toBe(0)
    expect(await upgraded.table('gameReleases').count()).toBe(0)
    expect(await upgraded.table('narrativeBeats').count()).toBe(0)
    expect(await upgraded.table('narrativeChoices').count()).toBe(0)

    const gameReleaseId = await upgraded.table('gameReleases').add({
      projectId: 1,
      worldId: 2,
      workId: 3,
      gameDefinitionId: 8,
      worldReleaseId: 4,
      version: 1,
      contentHash: 'frozen',
      createdAt: 6,
    })
    await upgraded.table('simulationSessions').update(sessionId, { gameReleaseId })
    expect(await upgraded.table('simulationSessions').where('gameReleaseId').equals(gameReleaseId).count()).toBe(1)
  })

  it('新内容稳定 key 的唯一索引拒绝同模块重复记录', async () => {
    const database = track(new StoryGameV54DB(databaseName()))
    await database.open()
    const beat = {
      projectId: 1,
      moduleId: 2,
      nodeKey: 'entry',
      beatKey: 'intro',
      kind: 'narration',
      text: '开场',
      order: 0,
    }
    await database.table('narrativeBeats').add(beat)
    await expect(database.table('narrativeBeats').add(beat)).rejects.toBeDefined()

    const release = {
      projectId: 1,
      worldId: 2,
      workId: 3,
      gameDefinitionId: 8,
      worldReleaseId: 4,
      version: 1,
      contentHash: 'frozen',
      createdAt: 6,
    }
    await database.table('gameReleases').add(release)
    await expect(database.table('gameReleases').add({
      ...release,
      contentHash: 'different',
    })).rejects.toBeDefined()
  })
})
