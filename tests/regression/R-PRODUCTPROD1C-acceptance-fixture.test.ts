import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import { prepareProductProductionAdoption, publishProductProductionBuild } from '../../src/lib/product-production/adoption'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { verifyProductBuildPreviewManifestV1 } from '../../src/lib/product-production/preview-manifest'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { runCurrentProductProductionAcceptanceFixture } from '../helpers/current-product-production-acceptance-fixture'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

async function authorizedProduction(input: {
  name: string
  productType?: 'avg'
  visualLevel?: 'none' | 'key-scenes'
}) {
  const owned = await seedCurrentProductWorld(input.name)
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const startingPoint = suggestions.suggestions.find(item => item.kind === 'mainline')!
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: startingPoint.suggestionKey,
    productType: input.productType ?? 'avg', scale: 'scene',
    visualLevel: input.visualLevel ?? 'none', audioLevel: 'none',
    requiredFacts: ['世界冻结版本中的历史不可被无理由改写'],
    forbiddenChanges: ['不得把候选内容直接写回世界正式表'],
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: `${input.name}.intent`, productionKey: `${input.name}.production`,
      productType: input.productType ?? 'avg', worldReleaseId: release.id!, userText: `${input.name} 游戏制作`,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: `${input.name}.brief`, expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  const authorized = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: `${input.name}.start`, expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: `${input.name}.click`,
    },
  })
  return {
    ...owned, release, productionId: created.productionId,
    buildId: authorized.result.buildId as number,
  }
}

describe('R-PRODUCTPROD-1C · authorized deterministic acceptance fixture', () => {
  beforeEach(async () => {
    // Coverage forks reuse one process across files. Explicitly close the
    // shared Dexie connection before deleting so a prior suite cannot leave
    // this acceptance fixture waiting on its own stale connection until timeout.
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('从冻结 WorldRelease 生成唯一清单、可玩 AVG 预览与可验证 SVG，并可幂等重入', async () => {
    const owned = await authorizedProduction({ name: 'vertical-avg', productType: 'avg', visualLevel: 'key-scenes' })
    const result = await runCurrentProductProductionAcceptanceFixture({
      scope: owned.scope, productionId: owned.productionId,
    })
    expect(result).toMatchObject({ buildId: owned.buildId, releaseReady: true })
    const build = await db.productBuilds.get(owned.buildId)
    expect(build).toMatchObject({ status: 'release-ready', packageHash: result.packageHash, previewHash: result.previewHash })
    expect(await hashProductProductionValueV2(JSON.parse(build!.manifestJson))).toBe(build!.manifestHash)
    const preview = await verifyProductBuildPreviewManifestV1(build!.previewManifestJson)
    expect(preview).toMatchObject({
      buildManifestHash: build!.manifestHash, packageHash: build!.packageHash, previewHash: build!.previewHash,
    })
    expect(preview.mediaBindings).toHaveLength(1)

    const resolved = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: owned.buildId, expectedPreviewHash: result.previewHash },
    })
    const media = await resolved.mediaResolver.read(preview.runtimePackage.presentation!.assets[0].assetKey)
    expect(media.type).toBe('image/svg+xml')
    const svg = await media.text()
    expect(svg).toContain('<svg')
    expect(svg).not.toMatch(/<script|onload=|javascript:/i)
    resolved.mediaResolver.dispose()

    const session = await createProductRuntimeInstanceFromSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: owned.buildId, expectedPreviewHash: result.previewHash },
      title: 'PRODUCTPROD 验收夹具可玩预览',
    })
    expect(session).toMatchObject({ productBuildId: owned.buildId, runtimeSourceHash: result.packageHash })
    const artifactCount = await db.productBuildArtifacts.where('buildId').equals(owned.buildId).count()
    const replay = await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    expect(replay).toEqual(result)
    expect(await db.productBuildArtifacts.where('buildId').equals(owned.buildId).count()).toBe(artifactCount)
  }, 30_000)

  it('暂停会递增 controlEpoch，旧执行者不能再接受任何 Artifact', async () => {
    const owned = await authorizedProduction({ name: 'vertical-epoch', visualLevel: 'none' })
    const build = await db.productBuilds.get(owned.buildId)
    const inputHash = 'a'.repeat(64)
    await acceptProductBuildArtifact({
      scope: owned.scope, buildId: owned.buildId, controlEpoch: build!.controlEpoch,
      artifactKey: 'candidate.before-pause', kind: 'product-design', payload: { valid: true }, inputHash,
    })
    const paused = await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: { type: 'pause', commandId: 'vertical-epoch.pause', expectedStateRevision: 2, reason: '检查产物' },
    })
    expect(paused).toMatchObject({ ok: true, result: { controlEpoch: 1 } })
    await expect(acceptProductBuildArtifact({
      scope: owned.scope, buildId: owned.buildId, controlEpoch: build!.controlEpoch,
      artifactKey: 'candidate.after-pause', kind: 'product-design', payload: { stale: true }, inputHash,
    })).rejects.toThrow(/epoch 已过期/)
    expect(await db.productBuildArtifacts.where('buildId').equals(owned.buildId).count()).toBe(1)
  })

  it('同一 artifactKey 重新验收时只保留一个 accepted 版本', async () => {
    const owned = await authorizedProduction({ name: 'vertical-artifact-revision', visualLevel: 'none' })
    const build = await db.productBuilds.get(owned.buildId)
    const first = await acceptProductBuildArtifact({
      scope: owned.scope, buildId: owned.buildId, controlEpoch: build!.controlEpoch,
      artifactKey: 'content.revisable', kind: 'narrative', payload: { revision: 1 },
      inputHash: 'a'.repeat(64),
    })
    const second = await acceptProductBuildArtifact({
      scope: owned.scope, buildId: owned.buildId, controlEpoch: build!.controlEpoch,
      artifactKey: 'content.revisable', kind: 'narrative', payload: { revision: 2 },
      inputHash: 'b'.repeat(64),
    })
    expect(second.version).toBe(2)
    expect(await db.productBuildArtifacts.get(first.id!)).toMatchObject({ status: 'invalid' })
    expect(await db.productBuildArtifacts.get(second.id!)).toMatchObject({ status: 'accepted' })
    expect((await db.productBuildArtifacts.where('buildId').equals(owned.buildId).toArray())
      .filter(row => row.artifactKey === 'content.revisable' && row.status === 'accepted')).toHaveLength(1)
  })

  it('篡改最终 manifest 指针后预览被拒绝，且不会创建半成品会话', async () => {
    const owned = await authorizedProduction({ name: 'vertical-tamper', visualLevel: 'none' })
    const result = await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const before = await db.productRuntimeSessions.count()
    await db.productBuilds.update(owned.buildId, { manifestHash: 'f'.repeat(64) })
    await expect(createProductRuntimeInstanceFromSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: owned.buildId, expectedPreviewHash: result.previewHash },
      title: '篡改后的预览',
    })).rejects.toThrow(/Preview 指针或 hash/)
    expect(await db.productRuntimeSessions.count()).toBe(before)
  })

  it('采用意图冻结后原子发布同一个 RuntimePackage，Release 媒资脱离 Preview resolver 仍可读取', async () => {
    const owned = await authorizedProduction({ name: 'vertical-publish', productType: 'avg', visualLevel: 'key-scenes' })
    const built = await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const prepared = await prepareProductProductionAdoption({ scope: owned.scope, productionId: owned.productionId })
    expect(prepared).toMatchObject({
      intent: { buildId: owned.buildId, packageHash: built.packageHash, previewHash: built.previewHash },
      productType: 'avg',
    })
    const command = {
      type: 'publish' as const, commandId: 'vertical-publish.publish',
      expectedStateRevision: prepared.intent.expectedStateRevision,
      buildNumber: prepared.intent.buildNumber, expectedManifestHash: prepared.intent.manifestHash,
      adoptionIntentHash: prepared.adoptionIntentHash,
    }
    const receipt = await publishProductProductionBuild({
      scope: owned.scope, productionId: owned.productionId, command,
    })
    expect(receipt).toMatchObject({ buildId: owned.buildId, packageHash: built.packageHash, replayed: false })
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({
      status: 'released', releasedProductReleaseId: receipt.productReleaseId,
      adoptionIntentHash: prepared.adoptionIntentHash,
    })
    expect(await db.productProductions.get(owned.productionId)).toMatchObject({
      status: 'released', currentProductReleaseId: receipt.productReleaseId,
    })
    const releaseSource = await resolveProductRuntimeSource({
      scope: owned.scope, source: { kind: 'release', productReleaseId: receipt.productReleaseId },
    })
    expect(releaseSource.runtimePackage).toEqual((await verifyProductBuildPreviewManifestV1(
      (await db.productBuilds.get(owned.buildId))!.previewManifestJson,
    )).runtimePackage)
    const asset = releaseSource.runtimePackage.presentation!.assets[0]
    const releasedMedia = await releaseSource.mediaResolver.read(asset.assetKey)
    expect(releasedMedia).toMatchObject({ type: asset.mimeType, size: asset.byteSize })
    releaseSource.mediaResolver.dispose()
    const releaseSession = await createProductRuntimeInstanceFromSource({
      scope: owned.scope, source: { kind: 'release', productReleaseId: receipt.productReleaseId },
      title: '正式版本会话',
    })
    expect(releaseSession).toMatchObject({ productReleaseId: receipt.productReleaseId, runtimeSourceHash: built.packageHash })

    const replay = await publishProductProductionBuild({
      scope: owned.scope, productionId: owned.productionId, command,
    })
    expect(replay).toMatchObject({ productReleaseId: receipt.productReleaseId, replayed: true })
    expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(1)
  }, 30_000)

  it('发布事务在 Release 插入后失败会回滚 Release、正式媒资和 command claim，可安全重试', async () => {
    const owned = await authorizedProduction({ name: 'vertical-rollback', productType: 'avg', visualLevel: 'key-scenes' })
    await runCurrentProductProductionAcceptanceFixture({ scope: owned.scope, productionId: owned.productionId })
    const prepared = await prepareProductProductionAdoption({ scope: owned.scope, productionId: owned.productionId })
    const command = {
      type: 'publish' as const, commandId: 'vertical-rollback.publish',
      expectedStateRevision: prepared.intent.expectedStateRevision,
      buildNumber: prepared.intent.buildNumber, expectedManifestHash: prepared.intent.manifestHash,
      adoptionIntentHash: prepared.adoptionIntentHash,
    }
    const update = vi.spyOn(db.productBuilds, 'update').mockRejectedValueOnce(new Error('injected-after-release'))
    await expect(publishProductProductionBuild({
      scope: owned.scope, productionId: owned.productionId, command,
    })).rejects.toThrow(/injected-after-release/)
    update.mockRestore()
    expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
    expect(await db.productMediaAssets.where('workId').equals(owned.scope.workId).count()).toBe(0)
    expect(await db.productMediaBlobs.where('workId').equals(owned.scope.workId).count()).toBe(0)
    expect(await db.productProductionCommands
      .where('[productionId+commandId]').equals([owned.productionId, command.commandId]).count()).toBe(0)
    expect(await db.productBuilds.get(owned.buildId)).toMatchObject({ status: 'release-ready', releasedProductReleaseId: null })

    const retried = await publishProductProductionBuild({ scope: owned.scope, productionId: owned.productionId, command })
    expect(retried).toMatchObject({ replayed: false, buildId: owned.buildId })
  }, 30_000)
})
