import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

const databases: Dexie[] = []
const names: string[] = []

function name(): string {
  const value = `legacy-v70-character-interaction-${Math.random()}`
  names.push(value)
  return value
}

function track<T extends Dexie>(database: T): T {
  databases.push(database)
  return database
}

class LegacyV69DB extends Dexie {
  constructor(databaseName: string) {
    super(databaseName)
    this.version(69).stores({ projects: '++id, name' })
  }
}

class LegacyCharacterInteractionV70DB extends Dexie {
  constructor(databaseName: string) {
    super(databaseName)
    this.version(69).stores({ projects: '++id, name' })
    this.version(70).stores({
      characterInteractionProductions: '++id, projectId, worldId, workId, &[workId+productionKey], [workId+status], activeSourceSelectionId, activeBriefId, updatedAt',
      characterInteractionSourceSelections: '++id, projectId, worldId, workId, productionId, &[productionId+revision], &[productionId+selectionHash], [productionId+status], sourceWorldReleaseId, worldContentHash, createdAt',
      characterInteractionBriefs: '++id, projectId, worldId, workId, productionId, sourceSelectionId, &[productionId+revision], [productionId+briefHash], [productionId+status], createdAt',
    })
  }
}

class LegacyCharacterInteractionV71DB extends Dexie {
  constructor(databaseName: string) {
    super(databaseName)
    this.version(70).stores({
      projects: '++id, name',
      characterInteractionProductions: '++id, projectId, worldId, workId, &[workId+productionKey], [workId+status], activeSourceSelectionId, activeBriefId, updatedAt',
      characterInteractionSourceSelections: '++id, projectId, worldId, workId, productionId, &[productionId+revision], &[productionId+selectionHash], [productionId+status], sourceWorldReleaseId, worldContentHash, createdAt',
      characterInteractionBriefs: '++id, projectId, worldId, workId, productionId, sourceSelectionId, &[productionId+revision], [productionId+briefHash], [productionId+status], createdAt',
    })
    this.version(71).stores({
      characterInteractionProductions: '++id, projectId, worldId, workId, &[workId+productionKey], [workId+status], activeSourceSelectionId, activeBriefId, currentProductReleaseId, updatedAt',
      characterInteractionProductionSteps: '++id, projectId, worldId, workId, productionId, &[productionId+stepKey+attempt], [productionId+status], [productionId+stepKey], candidateArtifactId, confirmedArtifactId, producerRunId, updatedAt',
      characterInteractionArtifacts: '++id, projectId, worldId, workId, productionId, &[productionId+artifactKey+revision], [productionId+status], [productionId+stepKey], kind, producerRunId, sourceSessionId, payloadHash, createdAt',
      characterInteractionMediaAssets: '++id, projectId, worldId, workId, productionId, &[productionId+slotKey+version], [productionId+slotKey], [productionId+status], blobObjectId, contentHash, updatedAt',
      characterInteractionProductReleases: '++id, projectId, worldId, workId, productionId, sourceSelectionId, sourceWorldReleaseId, briefId, productReleaseId, &[productionId+version], &[productionId+contentHash], createdAt',
    }).upgrade(async tx => {
      await tx.table('characterInteractionProductions').toCollection().modify(row => {
        if (!Object.prototype.hasOwnProperty.call(row, 'currentProductReleaseId')) row.currentProductReleaseId = null
      })
    })
  }
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const databaseName of names.splice(0)) await Dexie.delete(databaseName)
})

describe('LEGACY-MIGRATION · v69 -> v70 character-interaction production precursor', () => {
  it('只新增三张空产品表并保留旧项目，唯一 revision 索引拒绝覆盖历史', async () => {
    const databaseName = name()
    const legacy = track(new LegacyV69DB(databaseName))
    await legacy.open()
    const projectId = await legacy.table('projects').add({ name: '旧项目' })
    legacy.close()

    const upgraded = track(new LegacyCharacterInteractionV70DB(databaseName))
    await upgraded.open()
    expect(await upgraded.table('projects').get(projectId)).toMatchObject({ name: '旧项目' })
    expect(await upgraded.table('characterInteractionProductions').count()).toBe(0)
    expect(await upgraded.table('characterInteractionSourceSelections').count()).toBe(0)
    expect(await upgraded.table('characterInteractionBriefs').count()).toBe(0)
    const row = {
      projectId, worldId: 2, workId: 3, productionId: 4, revision: 1,
      selectionHash: 'a'.repeat(64), status: 'frozen', sourceWorldReleaseId: 5,
      worldContentHash: 'b'.repeat(64), createdAt: 6,
    }
    await upgraded.table('characterInteractionSourceSelections').add(row)
    await expect(upgraded.table('characterInteractionSourceSelections').add({ ...row, selectionHash: 'c'.repeat(64) }))
      .rejects.toBeDefined()
  })

  it('v70 -> v71 保留冻结来源与 Brief，只新增空步骤/产物/媒资/发行表和 nullable 指针', async () => {
    const databaseName = name()
    const old = track(new LegacyCharacterInteractionV70DB(databaseName))
    await old.open()
    const projectId = await old.table('projects').add({ name: 'CI-1/2 旧项目' })
    const productionId = await old.table('characterInteractionProductions').add({
      projectId, worldId: 2, workId: 3, productionKey: 'existing', status: 'brief-confirmed',
      activeSourceSelectionId: 4, activeBriefId: 5, createdAt: 6, updatedAt: 7,
    })
    old.close()

    const upgraded = track(new LegacyCharacterInteractionV71DB(databaseName))
    await upgraded.open()
    expect(await upgraded.table('characterInteractionProductions').get(productionId)).toMatchObject({
      productionKey: 'existing', activeSourceSelectionId: 4, activeBriefId: 5, currentProductReleaseId: null,
    })
    for (const table of [
      'characterInteractionProductionSteps', 'characterInteractionArtifacts',
      'characterInteractionMediaAssets', 'characterInteractionProductReleases',
    ]) expect(await upgraded.table(table).count()).toBe(0)
  })
})
