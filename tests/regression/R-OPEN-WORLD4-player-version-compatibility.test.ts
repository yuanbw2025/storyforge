import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  projectTextOpenWorldPlayerVersionCompatibilityV1,
} from '../../src/lib/open-world/player-version-compatibility'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type {
  ProductRelease,
  ProductReleaseLineageV1,
  ProductRuntimePackageV1,
  ProductRuntimeSession,
  WorkspaceScope,
} from '../../src/lib/types'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function fixture(name: string) {
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `${name}-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextFixture(),
    runtimeShape: 'vnext-only',
    title: '盐脊旧版旅程',
    seed: 'g4-12c-version-projection',
  })
}

async function addRelease(input: {
  scope: WorkspaceScope
  productionKey: string
  runtimePackage: ProductRuntimePackageV1
  version: number
  label: string
  createdAt: number
  parentRelease?: ProductReleaseLineageV1['parentRelease']
}): Promise<{ release: ProductRelease & { id: number }; manifest: Awaited<ReturnType<typeof createFixtureProductReleaseManifestV1>> }> {
  const manifest = await createFixtureProductReleaseManifestV1({
    runtimePackage: input.runtimePackage,
    productionKey: input.productionKey,
    releaseVersion: input.version,
    parentRelease: input.parentRelease,
  })
  const release: ProductRelease = {
    ...input.scope,
    productionKey: input.productionKey,
    productType: 'text-open-world',
    worldReleaseId: null,
    version: input.version,
    label: input.label,
    manifestJson: JSON.stringify(manifest),
    contentHash: await hashProductProductionValueV2(manifest),
    createdAt: input.createdAt,
  }
  const id = await db.productReleases.add(release) as number
  return { release: { ...release, id }, manifest }
}

function parentOf(input: {
  manifest: Awaited<ReturnType<typeof createFixtureProductReleaseManifestV1>>
}): ProductReleaseLineageV1['parentRelease'] {
  return {
    releaseUid: input.manifest.lineage.releaseUid,
    releaseHash: input.manifest.releaseIdentityHash,
  }
}

function vNextRuntimePackage(
  source: ProductRuntimePackageV1,
  compatiblePreviousPackageHashes: string[],
  descriptionSuffix = '',
): ProductRuntimePackageV1 {
  const result = structuredClone(source)
  if (!result.textOpenWorldVNext) throw new Error('测试夹具缺少 vNext RuntimePackage')
  result.textOpenWorldVNext.compatibility.compatiblePreviousPackageHashes = compatiblePreviousPackageHashes
  result.textOpenWorldVNext.metadata.description += descriptionSuffix
  return result
}

describe('Text Open World G4-12C · 玩家版本兼容投影', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('从当前Session固定版列出同productionKey已核验版本，并区分两类兼容声明但绝不提供迁移', async () => {
    const created = await fixture('版本族')
    const baseTime = created.release.createdAt
    const direct = await addRelease({
      scope: created.scope,
      productionKey: created.release.productionKey,
      runtimePackage: created.runtimePackage,
      version: 2,
      label: '盐脊 v2',
      createdAt: baseTime + 1_000,
      parentRelease: parentOf(created),
    })
    const hashDeclaredRuntime = vNextRuntimePackage(
      created.runtimePackage,
      [created.manifest.packageHash],
      '（仅声明与固定版运行包兼容）',
    )
    const hashDeclared = await addRelease({
      scope: created.scope,
      productionKey: created.release.productionKey,
      runtimePackage: hashDeclaredRuntime,
      version: 3,
      label: '盐脊 v3',
      createdAt: baseTime + 2_000,
      parentRelease: parentOf(direct),
    })
    const undeclaredRuntime = vNextRuntimePackage(created.runtimePackage, [], '（未声明跨版本兼容）')
    await addRelease({
      scope: created.scope,
      productionKey: created.release.productionKey,
      runtimePackage: undeclaredRuntime,
      version: 4,
      label: '盐脊 v4',
      createdAt: baseTime + 3_000,
      parentRelease: parentOf(hashDeclared),
    })
    await addRelease({
      scope: created.scope,
      productionKey: `${created.release.productionKey}.other`,
      runtimePackage: created.runtimePackage,
      version: 1,
      label: '不相干产品 v1',
      createdAt: baseTime + 99_000,
    })
    const foreign = await fixture('另一作品')
    await addRelease({
      scope: foreign.scope,
      productionKey: created.release.productionKey,
      runtimePackage: foreign.runtimePackage,
      version: 2,
      label: '跨作品同键 v2',
      createdAt: baseTime + 88_000,
      parentRelease: parentOf(foreign),
    })
    await db.productReleases.add({
      ...created.scope,
      productionKey: created.release.productionKey,
      productType: 'text-open-world',
      worldReleaseId: null,
      version: 5,
      label: '损坏版本中的秘密标题',
      manifestJson: JSON.stringify({ secretFutureQuest: '绝不能泄漏的终局任务' }),
      contentHash: 'f'.repeat(64),
      createdAt: baseTime + 4_000,
    })

    const before = {
      sessions: await db.productRuntimeSessions.toArray(),
      releases: await db.productReleases.toArray(),
    }
    const projection = await projectTextOpenWorldPlayerVersionCompatibilityV1({
      scope: created.scope,
      currentSessionId: created.session.id!,
    })

    expect(projection).toMatchObject({
      version: 1,
      availability: 'ready',
      productionKey: created.release.productionKey,
      pinnedRelease: {
        version: 1,
        isLatestVerifiedRelease: false,
        canContinueWithoutUpgrade: true,
      },
      migration: {
        available: false,
        reason: 'versioned-migrator-not-implemented',
      },
      diagnostics: [{ code: 'release-damaged', releaseVersion: 5 }],
    })
    expect(projection.releases.map(release => release.version)).toEqual([4, 3, 2, 1])
    expect(projection.releases.find(release => release.version === 4)).toMatchObject({
      relationToPinned: 'newer',
      declaredCompatibleWithPinnedRelease: false,
      compatibilityDeclaration: 'not-declared',
      canMigratePinnedSession: false,
    })
    expect(projection.releases.find(release => release.version === 3)).toMatchObject({
      relationToPinned: 'newer',
      declaredCompatibleWithPinnedRelease: true,
      compatibilityDeclaration: 'runtime-package-hash',
      canMigratePinnedSession: false,
    })
    expect(projection.releases.find(release => release.version === 2)).toMatchObject({
      relationToPinned: 'newer',
      declaredCompatibleWithPinnedRelease: true,
      compatibilityDeclaration: 'direct-release-lineage',
      canMigratePinnedSession: false,
    })
    expect(projection.releases.find(release => release.version === 1)).toMatchObject({
      relationToPinned: 'pinned',
      declaredCompatibleWithPinnedRelease: null,
      compatibilityDeclaration: null,
    })
    const publicBytes = JSON.stringify(projection)
    expect(publicBytes).not.toContain('绝不能泄漏的终局任务')
    expect(publicBytes).not.toContain('损坏版本中的秘密标题')
    expect(publicBytes).not.toContain('有人看见断脊渠口附近有野兽')
    expect(publicBytes).not.toContain('runtimePackage')
    expect(publicBytes).not.toContain('manifestJson')
    expect(publicBytes).not.toContain('contentHash')
    expect(await db.productRuntimeSessions.toArray()).toEqual(before.sessions)
    expect(await db.productReleases.toArray()).toEqual(before.releases)
  }, 30_000)

  it('Build Preview当前Session显式排除，不能借同Work正式Release混入版本目录', async () => {
    const created = await fixture('预览隔离')
    const { id: _releaseSessionId, ...releaseSession } = created.session
    const previewSession = {
      ...releaseSession,
      productReleaseId: null,
      productBuildId: 987_654,
      title: '制作端明确交接的预览',
    } as ProductRuntimeSession
    previewSession.id = await db.productRuntimeSessions.add(previewSession) as number

    const projection = await projectTextOpenWorldPlayerVersionCompatibilityV1({
      scope: created.scope,
      currentSessionId: previewSession.id,
    })

    expect(projection).toEqual({
      version: 1,
      availability: 'build-preview-excluded',
      productionKey: null,
      pinnedRelease: null,
      releases: [],
      diagnostics: [{
        code: 'build-preview-excluded',
        releaseVersion: null,
        message: '制作预览不属于正式版本目录。',
      }],
      migration: { available: false, reason: 'versioned-migrator-not-implemented' },
    })
  })

  it('owner scope由当前Session强制驱动，跨Work读取不返回任何版本信息', async () => {
    const owned = await fixture('归属A')
    const foreign = await fixture('归属B')

    await expect(projectTextOpenWorldPlayerVersionCompatibilityV1({
      scope: foreign.scope,
      currentSessionId: owned.session.id!,
    })).rejects.toThrow('Session 不存在或跨 Work')
  })

  it('当前Release或Session绑定损坏时返回固定诊断，不回显解析错误或候选版本', async () => {
    const damagedRelease = await fixture('当前发布损坏')
    await db.productReleases.update(damagedRelease.release.id!, {
      manifestJson: JSON.stringify({ secret: '当前发布的隐藏内容' }),
    })

    const releaseProjection = await projectTextOpenWorldPlayerVersionCompatibilityV1({
      scope: damagedRelease.scope,
      currentSessionId: damagedRelease.session.id!,
    })
    expect(releaseProjection).toMatchObject({
      availability: 'unavailable',
      productionKey: null,
      pinnedRelease: null,
      releases: [],
      diagnostics: [{ code: 'current-release-damaged', releaseVersion: 1 }],
      migration: { available: false },
    })
    expect(JSON.stringify(releaseProjection)).not.toContain('当前发布的隐藏内容')

    await db.delete()
    await db.open()
    const damagedBinding = await fixture('Session绑定损坏')
    await db.productRuntimeSessions.update(damagedBinding.session.id!, {
      runtimeSourceHash: '0'.repeat(64),
    })
    const bindingProjection = await projectTextOpenWorldPlayerVersionCompatibilityV1({
      scope: damagedBinding.scope,
      currentSessionId: damagedBinding.session.id!,
    })
    expect(bindingProjection).toMatchObject({
      availability: 'unavailable',
      releases: [],
      diagnostics: [{ code: 'session-release-binding-damaged', releaseVersion: 1 }],
      migration: { available: false },
    })
  }, 30_000)
})
