import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  CommercialPlatformAuthorityV1,
  type CommercialPlatformPersistenceV1,
  type CommercialPlatformSnapshotV1,
  type CommercialPrincipalV1,
} from '../../src/lib/commercial/authority'
import { createCommercialGatewayV1 } from '../../src/lib/commercial/gateway'
import { createCommercialFetchHandlerV1 } from '../../src/lib/commercial/fetch-service'
import { CommercialHttpClientV1 } from '../../src/lib/commercial/http-client'
import { createCommercialReleaseDeliveryGatewayV1 } from '../../src/lib/commercial/release-delivery-gateway'
import {
  CommercialReleaseDeliveryServiceV1,
  InMemoryCommercialReleaseDeliveryPersistenceV1,
} from '../../src/lib/commercial/release-delivery'
import {
  exportGameDistributionBundleV2,
  importMarketplaceGameDistributionV2,
} from '../../src/lib/game-platform/distribution-bundle'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { createGameReleaseManifestV2 } from '../../src/lib/game-production/runtime-package'
import { assertGameReleaseUnchanged } from '../../src/lib/text-game/releases'
import type { GameRuntimePackageV2, WorkspaceScope } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { CURRENT_PRODUCT_RESOURCE_KEYS, currentProductSelection } from '../helpers/current-product-world'

class CommercialStore implements CommercialPlatformPersistenceV1 {
  snapshot: CommercialPlatformSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommercialPlatformSnapshotV1 }) {
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}

async function workspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    name, genre: 'interactive-fiction', genres: ['interactive-fiction'], status: 'drafting',
    description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as never) as number
  return ensureWorkspaceOwnership(projectId)
}

function storyPackage(worldContentHash: string): GameRuntimePackageV2 {
  return {
    schema: 'storyforge.game-runtime-package', version: 2, productType: 'storygame',
    definition: {
      gameKey: 'market.complete-loop', title: '完整市场短篇', description: '',
      enabledCapabilities: ['narrative'], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: {
      contentHash: worldContentHash,
      selection: currentProductSelection('storygame', {
        story: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
      }),
    },
    narrative: {
      moduleKind: 'main', moduleTitle: '市场闭环', entryNodeKey: 'ending.ready',
      nodes: [{
        key: 'ending.ready', kind: 'ending', title: '可玩', summary: '', conditionJson: '{}',
        effectsJson: '[]', successorKeys: [],
      }],
      beats: [{
        beatKey: 'beat.ready', nodeKey: 'ending.ready', kind: 'narration', speakerKey: null,
        text: '购买、下载和导入已经闭环。', order: 0,
      }],
      choices: [],
    },
  }
}

async function releaseBundle(scope: WorkspaceScope) {
  const revision = await createWorldRevision({ scope, label: '发行世界' })
  const worldRelease = await publishWorldRevision(revision.id!)
  const manifest = await createGameReleaseManifestV2({
    runtimePackage: storyPackage(worldRelease.contentHash), productionProvenance: null,
  })
  const id = await db.gameReleases.add({
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    gameDefinitionId: null, worldReleaseId: worldRelease.id!, version: 1, label: '市场闭环 v1',
    manifestJson: JSON.stringify(manifest), contentHash: await hashGameProductionValueV2(manifest),
    createdAt: Date.now(),
  }) as number
  return exportGameDistributionBundleV2({ scope, gameReleaseId: id })
}

const TOKEN_CREATOR = 'token-creator-123456789'
const TOKEN_PUBLISHER = 'token-publisher-12345678'
const TOKEN_BUYER = 'token-buyer-12345678901'
const principals = new Map<string, CommercialPrincipalV1>([
  [TOKEN_CREATOR, { userId: 'user.creator', permissions: [] }],
  [TOKEN_PUBLISHER, { userId: 'user.publisher', permissions: ['catalog:publish'] }],
  [TOKEN_BUYER, { userId: 'user.buyer', permissions: [] }],
])
const identity = { authenticate: async (token: string) => structuredClone(principals.get(token) ?? null) }

function request(path: string, body: unknown, token: string) {
  return {
    method: 'POST', path, contentType: 'application/json',
    headers: { authorization: `Bearer ${token}` }, body,
  }
}

describe('PLATFORM-1D · creator upload to buyer playable local copy', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('未验证发行物不得上架；上传后免费领取、授权下载、导入与游玩来源验证全部走通', async () => {
    const creatorWorkspace = await workspace('创作者')
    const bundle = await releaseBundle(creatorWorkspace.scope)
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: new CommercialStore() })
    const delivery = new CommercialReleaseDeliveryServiceV1(
      authority, new InMemoryCommercialReleaseDeliveryPersistenceV1(),
    )
    const commercial = createCommercialGatewayV1({
      authority, identity, releaseDelivery: delivery, webhookSecret: 'delivery-test-secret-at-least-16',
      checkoutProvider: { createOrResumeSession: async order => ({
        checkoutSessionId: `checkout.${order.orderId}`, orderId: order.orderId,
        checkoutUrl: `https://pay.storyforge.example/checkout/${order.orderId}`,
        expiresAt: Date.now() + 60_000,
      }) },
    })
    const files = createCommercialReleaseDeliveryGatewayV1({ service: delivery, identity })
    const created = await commercial(request('/v1/commercial/listings', {
      requestId: 'create.market', releaseHash: bundle.gameRelease.contentHash,
      productType: 'storygame', title: '完整市场短篇', summary: '可导入并游玩的发行物', contentWarnings: [],
      license: {
        licenseId: 'license.offline', licenseVersion: '1.0.0', allowOfflineExport: true,
        allowRemix: false, commercialReuse: false, requiresAttribution: true,
        termsUrl: 'https://storyforge.example/licenses/offline',
      },
      currency: 'CNY', amountMinor: 0, creatorShareBps: 8_000,
    }, TOKEN_CREATOR))
    const listingId = (created.body as { listingId: string }).listingId

    await expect(commercial(request('/v1/commercial/listings/publish', {
      requestId: 'publish.before-upload', listingId, rightsConfirmed: true,
    }, TOKEN_PUBLISHER))).resolves.toMatchObject({ status: 409, body: { code: 'release_delivery_missing' } })
    await expect(files(request('/v1/commercial/releases/download', {
      releaseHash: bundle.gameRelease.contentHash,
    }, TOKEN_BUYER))).resolves.toMatchObject({ status: 403, body: { code: 'entitlement_required' } })

    await expect(files(request('/v1/commercial/releases/register', {
      requestId: 'upload.market', bundle,
    }, TOKEN_CREATOR))).resolves.toMatchObject({ status: 201, body: { releaseHash: bundle.gameRelease.contentHash } })
    await expect(commercial(request('/v1/commercial/listings/submit', {
      requestId: 'submit.after-upload', listingId, rightsConfirmed: true,
    }, TOKEN_CREATOR))).resolves.toMatchObject({ status: 200, body: { status: 'submitted' } })
    await expect(commercial(request('/v1/commercial/listings/publish', {
      requestId: 'publish.after-upload', listingId, rightsConfirmed: true,
    }, TOKEN_PUBLISHER))).resolves.toMatchObject({ status: 200, body: { status: 'published' } })
    await expect(commercial(request('/v1/commercial/acquisitions', {
      requestId: 'claim.market', listingId,
    }, TOKEN_BUYER))).resolves.toMatchObject({ status: 201, body: { entitlement: { status: 'active' } } })

    const downloaded = await files(request('/v1/commercial/releases/download', {
      releaseHash: bundle.gameRelease.contentHash,
    }, TOKEN_BUYER))
    expect(downloaded.status).toBe(200)
    const payload = downloaded.body as Awaited<ReturnType<typeof delivery.download>>
    const playerWorkspace = await workspace('玩家')
    const { releaseHash: _releaseHash, ...provenance } = payload.authorization
    const imported = await importMarketplaceGameDistributionV2({
      scope: playerWorkspace.scope, bundle: payload.bundle, provenance,
    })
    await expect(assertGameReleaseUnchanged(imported.id!)).resolves.toMatchObject({ id: imported.id })
    expect(imported.distributionProvenance).toMatchObject({
      listingId, entitlementId: expect.stringMatching(/^entitlement\./), localCopyPreserved: true,
    })
  }, 40_000)

  it('真实 Request/Response 适配器与严格浏览器客户端维持同一双账号交付闭环', async () => {
    const creatorWorkspace = await workspace('HTTP 创作者')
    const bundle = await releaseBundle(creatorWorkspace.scope)
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: new CommercialStore() })
    const delivery = new CommercialReleaseDeliveryServiceV1(
      authority, new InMemoryCommercialReleaseDeliveryPersistenceV1(),
    )
    const commercial = createCommercialGatewayV1({
      authority, identity, releaseDelivery: delivery, webhookSecret: 'http-test-secret-at-least-16',
      checkoutProvider: { createOrResumeSession: async order => ({
        checkoutSessionId: `checkout.${order.orderId}`, orderId: order.orderId,
        checkoutUrl: `https://pay.storyforge.example/checkout/${order.orderId}`,
        expiresAt: Date.now() + 60_000,
      }) },
    })
    const files = createCommercialReleaseDeliveryGatewayV1({ service: delivery, identity })
    const fetchHandler = createCommercialFetchHandlerV1({
      commercialGateway: commercial, deliveryGateway: files,
      allowedOrigins: ['https://app.storyforge.test'], serviceVersion: 'test',
    })
    const client = new CommercialHttpClientV1({
      baseUrl: 'https://api.storyforge.test', timeoutMs: 30_000,
      fetch: async (url, init) => fetchHandler(new Request(url, {
        ...init, headers: { ...init.headers, origin: 'https://app.storyforge.test' },
      })),
    })
    const listing = await client.createListing({
      accessToken: TOKEN_CREATOR, requestId: 'http.create', releaseHash: bundle.gameRelease.contentHash,
      productType: 'storygame', title: 'HTTP 完整短篇', summary: 'Web 标准边界', contentWarnings: [],
      license: {
        licenseId: 'license.http', licenseVersion: '1.0.0', allowOfflineExport: true,
        allowRemix: false, commercialReuse: false, requiresAttribution: false,
        termsUrl: 'https://storyforge.example/licenses/http',
      },
      currency: 'CNY', amountMinor: 0, creatorShareBps: 8_000,
    })
    await expect(client.publishListing({
      accessToken: TOKEN_PUBLISHER, requestId: 'http.publish.missing', listingId: listing.listingId,
    })).rejects.toMatchObject({ code: 'release_delivery_missing', status: 409 })
    await client.registerRelease({ accessToken: TOKEN_CREATOR, requestId: 'http.upload', bundle })
    await client.submitListing({
      accessToken: TOKEN_CREATOR, requestId: 'http.submit.ready', listingId: listing.listingId,
    })
    await client.publishListing({
      accessToken: TOKEN_PUBLISHER, requestId: 'http.publish.ready', listingId: listing.listingId,
    })
    await expect(client.discover({ query: 'HTTP' })).resolves.toMatchObject([{ listingId: listing.listingId }])
    await client.acquire({ accessToken: TOKEN_BUYER, requestId: 'http.claim', listingId: listing.listingId })
    const downloaded = await client.downloadRelease({
      accessToken: TOKEN_BUYER, releaseHash: bundle.gameRelease.contentHash,
    })
    const playerWorkspace = await workspace('HTTP 玩家')
    const imported = await importMarketplaceGameDistributionV2({
      scope: playerWorkspace.scope, bundle: downloaded.bundle, provenance: downloaded.provenance,
    })
    await expect(assertGameReleaseUnchanged(imported.id!)).resolves.toMatchObject({ id: imported.id })
  }, 40_000)
})
