import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { branchTextOpenWorldSessionFromCheckpointV1, createTextOpenWorldCheckpointV1 } from '../../src/lib/open-world/checkpoints'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { verifyTextOpenWorldVNextSessionBindingV1 } from '../../src/lib/open-world/session-binding'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  parseProductRuntimePackageV1,
  verifyProductReleaseManifestV1,
} from '../../src/lib/product-production/runtime-package'
import { assertProductReleaseUnchanged } from '../../src/lib/product/releases'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import {
  hashProductRuntimeStateV1,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from '../../src/lib/product/runtime-core'
import type { ProductRelease } from '../../src/lib/types'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import {
  createGovernedTextOpenWorldSessionFixtureV1,
  createTextOpenWorldProductRuntimePackageFixtureV1,
} from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

describe('TEXTWORLD-2 · ProductBuild/ProductRelease、InitialState和Session绑定', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('vNext 15模块作为共享ProductRuntimePackage字段逐层校验', async () => {
    const textOpenWorldVNext = createTextOpenWorldVNextFixture()
    const runtimePackage = createTextOpenWorldProductRuntimePackageFixtureV1(textOpenWorldVNext)
    expect(parseProductRuntimePackageV1(runtimePackage).textOpenWorldVNext).toEqual(textOpenWorldVNext)

    const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage })
    await expect(verifyProductReleaseManifestV1(manifest)).resolves.toEqual(manifest)
    await expect(verifyProductReleaseManifestV1({
      ...manifest,
      runtimePackage: {
        ...manifest.runtimePackage,
        textOpenWorldVNext: {
          ...manifest.runtimePackage.textOpenWorldVNext!,
          metadata: { ...manifest.runtimePackage.textOpenWorldVNext!.metadata, title: '被改写' },
        },
      },
    })).rejects.toThrow(/packageHash/)

    expect(() => parseProductRuntimePackageV1({
      ...runtimePackage,
      textOpenWorldVNext: {
        ...textOpenWorldVNext,
        sourceManifest: { ...textOpenWorldVNext.sourceManifest, contentHash: 'f'.repeat(64) },
      },
    })).toThrow(/来源或规则版本不一致/)
  })

  it('正式Session由ProductRelease确定性开局，Release被篡改后fail-closed', async () => {
    const textOpenWorldVNext = createTextOpenWorldVNextFixture()
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: 'TEXTWORLD Release绑定验收', textOpenWorldVNext,
      title: '盐脊新游戏', seed: 'release-seed',
    })
    const state = await readProductRuntimeState(created.session.id!)
    expect(created.session).toMatchObject({
      kind: 'text-open-world', productReleaseId: created.release.id,
      productBuildId: null, runtimeSourceHash: created.manifest.packageHash,
    })
    expect(state.textOpenWorld).toEqual(createInitialTextOpenWorldSessionProjectionV1(textOpenWorldVNext))
    await expect(verifyTextOpenWorldVNextSessionBindingV1(created.session)).resolves.toMatchObject({
      runtimePackage: textOpenWorldVNext,
    })

    await db.productReleases.update(created.release.id!, {
      manifestJson: created.release.manifestJson.replace('首个纵向验收世界', '被改写的世界'),
    })
    await expect(assertProductReleaseUnchanged(created.release.id!)).rejects.toThrow(/packageHash|已被篡改/)
  })

  it('新ProductRelease不迁移旧存档，投影不能混用另一Release的vNext包', async () => {
    const firstPackage = createTextOpenWorldVNextFixture()
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: 'TEXTWORLD 多版本验收', textOpenWorldVNext: firstPackage,
      title: 'v1存档', seed: 'release-v1',
    })
    const secondPackage = structuredClone(firstPackage)
    secondPackage.metadata.description = '第二版盐脊运行包。'
    const secondRuntime = createTextOpenWorldProductRuntimePackageFixtureV1(secondPackage)
    const secondManifest = await createFixtureProductReleaseManifestV1({
      runtimePackage: secondRuntime,
      productionKey: created.manifest.productionProvenance.productionKey,
      releaseVersion: 2,
      parentRelease: {
        releaseUid: created.manifest.lineage.releaseUid,
        releaseHash: created.manifest.lineage.releaseHash,
      },
    })
    const now = Date.now()
    const secondRelease: ProductRelease = {
      projectId: created.scope.projectId, worldId: created.scope.worldId, workId: created.scope.workId,
      productionKey: secondManifest.productionProvenance.productionKey,
      productType: 'text-open-world', worldReleaseId: null, version: 2, label: '盐脊 v2',
      manifestJson: JSON.stringify(secondManifest),
      contentHash: await hashProductProductionValueV2(secondManifest), createdAt: now,
    }
    secondRelease.id = await db.productReleases.add(secondRelease) as number
    const secondSession = await createTextOpenWorldInstance({
      scope: created.scope, productReleaseId: secondRelease.id,
      title: 'v2存档', seed: 'release-v2',
    })
    expect((await db.productRuntimeSessions.get(created.session.id!))?.productReleaseId).toBe(created.release.id)
    expect(secondSession.productReleaseId).toBe(secondRelease.id)

    const firstRow = await db.productRuntimeSessions.get(created.session.id!)
    const firstInitial = JSON.parse(firstRow!.initialStateJson)
    firstInitial.textOpenWorld = createInitialTextOpenWorldSessionProjectionV1(secondPackage)
    await db.productRuntimeSessions.update(created.session.id!, { initialStateJson: JSON.stringify(firstInitial) })
    await expect(verifyTextOpenWorldVNextSessionBindingV1((await db.productRuntimeSessions.get(created.session.id!))!))
      .rejects.toThrow(/vNext RuntimePackage与ProductRelease\/Build不一致/)
  })

  it('命令边界重新核验冻结来源，检查点子分支继续固定父ProductRelease', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: 'TEXTWORLD 命令绑定验收', textOpenWorldVNext: createTextOpenWorldVNextFixture(),
      title: '绑定测试', seed: 'binding-seed',
    })
    const base = await readProductRuntimeStateVersion(created.session.id!)
    const command = {
      schema: 'storyforge.text-open-world.command' as const, version: 1 as const,
      commandId: 'command.binding.1', sessionId: created.session.id!, actorKey: 'player',
      actionKey: 'action.investigate-channel', payload: { targetKey: 'location.salt-port' },
      baseSequence: base.sequence, baseStateHash: base.stateHash,
      source: 'system-action' as const, requestedAt: 1_000,
    }
    await db.productRuntimeSessions.update(created.session.id!, { runtimeSourceHash: 'f'.repeat(64) })
    await expect(commitTextOpenWorldCommandV1(command)).rejects.toThrow(/冻结运行包 hash|冻结 Product Release/)
    await db.productRuntimeSessions.update(created.session.id!, { runtimeSourceHash: created.manifest.packageHash })

    const checkpoint = await createTextOpenWorldCheckpointV1({ sessionId: created.session.id!, name: 'Release起点' })
    const child = await branchTextOpenWorldSessionFromCheckpointV1({ checkpointId: checkpoint.id!, title: 'Release分支' })
    expect(child).toMatchObject({
      productReleaseId: created.release.id, productBuildId: null,
      runtimeSourceHash: created.manifest.packageHash, parentSessionId: created.session.id,
    })
    expect(await hashProductRuntimeStateV1(await readProductRuntimeState(child.id!))).toMatch(/^[a-f0-9]{64}$/)
  })
})
