import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { readyAiKpSession } from '../helpers/ready-ttrpg-session'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseCommunityTtrpgCatalogV1, startCommunityTtrpgGameV1, type CommunityTtrpgGameV1 } from '../../src/lib/ttrpg/community-games'
import { exportProductDistributionBundleV2, verifyProductDistributionBundleV2 } from '../../src/lib/product-platform/distribution-bundle'
import { readProductRuntimeState } from '../../src/lib/ttrpg/runtime-api'

describe('R-TTRPG4C · community release installation', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('仓库内真实雾港发布包可独立安装并无损导出，不携带作者试玩状态', async () => {
    const raw = JSON.parse(readFileSync('public/games/fog-harbor/game.json', 'utf8'))
    const bundle = await verifyProductDistributionBundleV2(raw)
    const game: CommunityTtrpgGameV1 = { key: 'fog-harbor', title: '雾港：最后一盏灯', tagline: '今夜的归航，十年前的真相',
      description: '真实生产发布包安装回归', coverPath: 'games/fog-harbor/cover.png', bundlePath: 'games/fog-harbor/game.json',
      bundleHash: bundle.bundleHash, minutes: 90, playerCount: '1 人 + AI / 本地多人', version: 'community-preview' }
    expect(bundle.productRelease.manifest.productionProvenance?.productionKey).toBe('productprod.mtq3rija.73e1769f')
    expect(bundle.media).toHaveLength(2)
    const id = await startCommunityTtrpgGameV1(game, bundle)
    const session = (await db.productRuntimeSessions.get(id))!
    const state = await readProductRuntimeState(id)
    expect(state.ttrpg!.product!.actionHistory).toHaveLength(0)
    expect(state.ttrpg!.product!.privateGuidance).toHaveLength(0)
    expect(state.ttrpg!.product!.sessionZero.completed).toBe(false)
    expect(await db.worldReleases.count()).toBe(0)
    const exported = await exportProductDistributionBundleV2({ scope: { projectId: session.projectId, worldId: session.worldId!, workId: session.workId! }, productReleaseId: session.productReleaseId! })
    expect((await verifyProductDistributionBundleV2(exported)).bundleHash).toBe(bundle.bundleHash)
  })
  it('分发包独立安装、重复开新团复用来源；不复制世界或原团秘密记录，导出校验往返成立', async () => {
    const fixture = await readyAiKpSession('源游戏')
    const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage: fixture.runtimePackage })
    const body = { schema: 'storyforge.product-distribution-bundle' as const, version: 2 as const,
      productRelease: { manifest, contentHash: await hashProductProductionValueV2(manifest) },
      sourceWorld: { contentHash: manifest.sourceWorldRelease.contentHash }, media: [] }
    const bundle = { ...body, bundleHash: await hashProductProductionValueV2(body) }
    const game: CommunityTtrpgGameV1 = { key: 'test-harbor', title: '测试雾港', tagline: '潮声中的秘密', description: '仅用于导入测试的模组。',
      coverPath: null, bundlePath: 'games/test-harbor.json', bundleHash: bundle.bundleHash, minutes: 45, playerCount: '1 人 + AI', version: '1.0.0' }
    const worldsBefore = await db.worldReleases.count()
    const first = await startCommunityTtrpgGameV1(game, bundle)
    const second = await startCommunityTtrpgGameV1(game, bundle)
    expect(first).not.toBe(second)
    const firstSession = (await db.productRuntimeSessions.get(first))!, secondSession = (await db.productRuntimeSessions.get(second))!
    expect(firstSession.projectId).not.toBe(fixture.scope.projectId)
    expect(secondSession.projectId).toBe(firstSession.projectId)
    expect(secondSession.productReleaseId).toBe(firstSession.productReleaseId)
    expect(await db.worldReleases.count()).toBe(worldsBefore)
    const state = await readProductRuntimeState(first)
    expect(state.ttrpg!.product!.sessionZero.completed).toBe(false)
    expect(state.ttrpg!.product!.actionHistory).toHaveLength(0)
    expect(state.ttrpg!.product!.privateGuidance).toHaveLength(0)
    const imported = (await db.productReleases.get(firstSession.productReleaseId!))!
    expect(imported.distributionProvenance).toMatchObject({ source: 'community-bundle', orderId: null, entitlementId: null })
    expect(imported.worldReleaseId).toBeNull()
    const exported = await exportProductDistributionBundleV2({ scope: { projectId: firstSession.projectId, worldId: firstSession.worldId!, workId: firstSession.workId! }, productReleaseId: imported.id! })
    expect((await verifyProductDistributionBundleV2(exported)).bundleHash).toBe(bundle.bundleHash)
    const count = await db.projects.count()
    await expect(startCommunityTtrpgGameV1({ ...game, bundleHash: 'a'.repeat(64) }, bundle)).rejects.toThrow('不匹配')
    expect(await db.projects.count()).toBe(count)
  })
  it('目录拒绝路径跳转、重复身份和未绑定哈希', () => {
    const game = { key: 'harbor', title: '雾港', tagline: '调查', description: '游戏', coverPath: null, bundlePath: 'games/harbor.json',
      bundleHash: 'a'.repeat(64), minutes: 30, playerCount: '1 人', version: '1.0.0' }
    const catalog = { schema: 'storyforge.community-ttrpg-catalog', version: 1, games: [game] }
    expect(parseCommunityTtrpgCatalogV1(catalog)).toHaveLength(1)
    expect(() => parseCommunityTtrpgCatalogV1({ ...catalog, games: [game, game] })).toThrow()
    expect(() => parseCommunityTtrpgCatalogV1({ ...catalog, games: [{ ...game, bundlePath: 'games/../../settings.json' }] })).toThrow()
    expect(() => parseCommunityTtrpgCatalogV1({ ...catalog, games: [{ ...game, bundleHash: '' }] })).toThrow()
  })
})
