import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

describe('LEGACY-MIGRATION · db v61 open-world precursor', () => {
  const name = `storyforge-legacy-v61-open-world-${Date.now()}`
  afterEach(async () => { await Dexie.delete(name) })

  it('v60 升级只新增空区域模块表并保留既有模拟数据', async () => {
    const legacy = new Dexie(name)
    legacy.version(60).stores({ projects: '++id,name', productReleases: '++id,projectId', narrativeSimulationModules: '++id,projectId' })
    await legacy.open()
    const projectId = await legacy.table('projects').add({ name: '旧项目' })
    await legacy.table('productReleases').add({ projectId, contentHash: 'old' })
    await legacy.table('narrativeSimulationModules').add({ projectId, contentJson: '{"version":1}' })
    legacy.close()
    const upgraded = new Dexie(name)
    upgraded.version(60).stores({ projects: '++id,name', productReleases: '++id,projectId', narrativeSimulationModules: '++id,projectId' })
    upgraded.version(61).stores({ openWorldModules: '++id,projectId,worldId,workId,&gameDefinitionId,[workId+gameDefinitionId],updatedAt' })
    await upgraded.open()
    expect(await upgraded.table('productReleases').count()).toBe(1)
    expect(await upgraded.table('narrativeSimulationModules').count()).toBe(1)
    expect(await upgraded.table('openWorldModules').count()).toBe(0)
    upgraded.close()
  })
})
