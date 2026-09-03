import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

describe('AVG-1 · db v59 migration', () => {
  const name = `storyforge-avg-migration-${Date.now()}`; afterEach(async () => { await Dexie.delete(name) })
  it('v58 升级只新增三张空表并保留旧 ProductRelease', async () => {
    const legacy = new Dexie(name); legacy.version(58).stores({ projects: '++id,name', productReleases: '++id,projectId', adventureModules: '++id,projectId' }); await legacy.open(); const projectId = await legacy.table('projects').add({ name: '旧项目' }); await legacy.table('productReleases').add({ projectId, manifestJson: '{}', contentHash: 'old' }); legacy.close()
    const upgraded = new Dexie(name); upgraded.version(58).stores({ projects: '++id,name', productReleases: '++id,projectId', adventureModules: '++id,projectId' }); upgraded.version(59).stores({ avgMediaAssets: '++id,projectId,worldId,workId,&[workId+assetKey+version]', avgMediaBlobs: '++id,projectId,worldId,workId,&mediaAssetId', avgPresentationModules: '++id,projectId,worldId,workId,&gameDefinitionId' }); await upgraded.open(); expect(await upgraded.table('productReleases').count()).toBe(1); expect(await upgraded.table('avgMediaAssets').count()).toBe(0); expect(await upgraded.table('avgMediaBlobs').count()).toBe(0); expect(await upgraded.table('avgPresentationModules').count()).toBe(0); upgraded.close()
  })
})
