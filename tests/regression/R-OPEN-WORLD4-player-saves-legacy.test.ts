import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  branchTextOpenWorldPlayerSaveV1,
  createTextOpenWorldManualSaveV1,
  projectTextOpenWorldPlayerSavesV1,
  reconcileTextOpenWorldAutomaticSavesV1,
  repairTextOpenWorldPlayerCheckpointV1,
  type TextOpenWorldSaveOwnerV1,
} from '../../src/lib/open-world/player-saves'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import type { ProductRelease } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import {
  createLegacyTextOpenWorldProductRuntimePackageFixtureV1,
} from '../helpers/text-open-world-product-session'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function legacyFixture() {
  const runtimePackage = createLegacyTextOpenWorldProductRuntimePackageFixtureV1(
    createTextOpenWorldVNextFixture().sourceManifest.contentHash,
  )
  const workspace = await createWorkspace({
    name: `旧版开放世界-${crypto.randomUUID()}`,
    genres: ['open-world'],
    status: 'drafting',
    description: '',
    targetWordCount: 1,
    enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const productionKey = `fixture.text-open-world.legacy.${crypto.randomUUID()}`
  const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage, productionKey })
  const now = Date.now()
  const release: ProductRelease = {
    projectId: workspace.scope.projectId,
    worldId: workspace.scope.worldId,
    workId: workspace.scope.workId,
    productionKey,
    productType: 'text-open-world',
    worldReleaseId: null,
    version: 1,
    label: '旧版盐脊 v1',
    manifestJson: JSON.stringify(manifest),
    contentHash: await hashProductProductionValueV2(manifest),
    createdAt: now,
  }
  release.id = await db.productReleases.add(release) as number
  const session = await createTextOpenWorldInstance({
    scope: workspace.scope,
    productReleaseId: release.id,
    title: '旧版盐脊旅程',
    seed: 'legacy-save-seed',
  })
  const owner: TextOpenWorldSaveOwnerV1 = { scope: workspace.scope, worldGroupId: null }
  return { ...workspace, release, session, owner }
}

describe('Text Open World G4-12B · 旧Release存档兼容', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('以共享Runtime重放/检查点语义列出、手动保存和派生旧Release，不臆造vNext摘要', async () => {
    const created = await legacyFixture()
    const checkpoint = await createTextOpenWorldManualSaveV1({
      owner: created.owner,
      sessionId: created.session.id!,
      name: '旧版旅程起点',
    })

    const projection = await projectTextOpenWorldPlayerSavesV1({
      owner: created.owner,
      currentSessionId: created.session.id,
    })
    expect(projection.groups[0]?.branches[0]).toMatchObject({
      runtimeFormat: 'legacy',
      runtimeHealth: 'available',
      summary: {
        runtimeFormat: 'legacy',
        level: null,
        locationLabel: null,
        regionLabel: null,
        mainlineLabel: expect.stringContaining('港口求援'),
        worldTimeLabel: '运行时钟 0',
      },
      checkpoints: [{
        actionIdentity: { sessionId: created.session.id, checkpointId: checkpoint.id },
        purpose: 'manual',
        health: 'available',
      }],
    })

    await db.productRuntimeCheckpoints.update(checkpoint.id!, { stateHash: 'f'.repeat(64) })
    expect((await projectTextOpenWorldPlayerSavesV1({ owner: created.owner }))
      .groups[0]?.branches[0]?.checkpoints[0]).toMatchObject({ health: 'repairable', repairable: true })
    await expect(repairTextOpenWorldPlayerCheckpointV1({
      owner: created.owner,
      checkpointId: checkpoint.id!,
    })).resolves.toMatchObject({ health: 'available', repairable: false })

    const child = await branchTextOpenWorldPlayerSaveV1({
      owner: created.owner,
      checkpointId: checkpoint.id!,
      title: '旧版Release分支',
      seed: 'legacy-child-seed',
    })
    expect(child).toMatchObject({
      productReleaseId: created.release.id,
      runtimeSourceHash: created.session.runtimeSourceHash,
      parentSessionId: created.session.id,
    })
    await expect(reconcileTextOpenWorldAutomaticSavesV1({
      owner: created.owner,
      sessionId: created.session.id!,
    })).rejects.toThrow('旧版Release不支持vNext自动存档')
  })
})
