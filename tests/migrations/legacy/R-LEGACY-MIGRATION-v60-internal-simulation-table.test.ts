import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

describe('LEGACY-MIGRATION · db v60 evolution precursor', () => {
  const name = `storyforge-legacy-v60-evolution-${Date.now()}`
  afterEach(async () => { await Dexie.delete(name) })

  it('v59 升级只新增空规则表并保留旧 AVG 数据和 ProductRelease', async () => {
    const legacy = new Dexie(name)
    legacy.version(59).stores({
      projects: '++id,name',
      productReleases: '++id,projectId',
      avgPresentationModules: '++id,projectId',
    })
    await legacy.open()
    const projectId = await legacy.table('projects').add({ name: '旧项目' })
    await legacy.table('productReleases').add({ projectId, manifestJson: '{}', contentHash: 'old' })
    await legacy.table('avgPresentationModules').add({ projectId, contentJson: '{"version":1,"cues":[]}' })
    legacy.close()

    const upgraded = new Dexie(name)
    upgraded.version(59).stores({
      projects: '++id,name',
      productReleases: '++id,projectId',
      avgPresentationModules: '++id,projectId',
    })
    upgraded.version(60).stores({
      narrativeSimulationModules: '++id,projectId,worldId,workId,&gameDefinitionId,[workId+gameDefinitionId],updatedAt',
    })
    await upgraded.open()
    expect(await upgraded.table('productReleases').count()).toBe(1)
    expect(await upgraded.table('avgPresentationModules').count()).toBe(1)
    expect(await upgraded.table('narrativeSimulationModules').count()).toBe(0)
    upgraded.close()
  })
})
