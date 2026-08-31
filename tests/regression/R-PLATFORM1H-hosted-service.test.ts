import { createServer, request as sendHttpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { createGameReleaseManifestV2 } from '../../src/lib/game-production/runtime-package'
import {
  verifyGameDistributionBundleV1,
  type GameDistributionBundleV1,
} from '../../src/lib/game-platform/distribution-bundle'
import {
  createHostedGamePlatformBootstrapV1,
  createHostedGamePlatformServiceV1,
  type HostedGamePlatformProductionRuntimeV1,
} from '../../src/lib/game-platform/hosted-service'
import type { GamePlatformProductionDependencyAdapterV1 } from '../../src/lib/game-platform/production-runtime'
import {
  GAME_PLATFORM_PRODUCTION_DEPENDENCIES_V1,
  createMemoryGamePlatformRateLimiterV1,
  type GamePlatformProductionDependencyV1,
} from '../../src/lib/game-platform/service-router'
import { CommercialHttpClientV1 } from '../../src/lib/commercial/http-client'
import {
  type CommercialPrincipalV1,
} from '../../src/lib/commercial/authority'
import { InMemoryCommercialReleaseDeliveryPersistenceV1 } from '../../src/lib/commercial/release-delivery'
import type { CommunityPrincipalV1 } from '../../src/lib/community/authority'
import { CommunityHttpClientV1 } from '../../src/lib/community/http-client'
import {
  InMemoryCommunityLfgRoomHandoffPersistenceV1,
  InMemoryCommunityLfgRoomSecretVaultV1,
} from '../../src/lib/community/lfg-room-handoff'
import { HttpOnlineRoomTransportV1 } from '../../src/lib/online/http-transport'
import type { OnlineRoomCommandV1 } from '../../src/lib/online/room-authority'
import { OnlineRoomRealtimeHubV1 } from '../../src/lib/online/realtime-hub'
import type {
  TransactionalKeyValueStorageV1,
  TransactionalKeyValueTransactionV1,
} from '../../src/lib/online/transactional-persistence'
import { compileTtrpgCampaignDraftV1 } from '../../src/lib/ttrpg/campaign'
import { buildTtrpgRuntimePackageV1 } from '../../src/lib/ttrpg/release'
import { createStoryForgeRulePackV1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import { WORLD_CAPABILITY_AREAS } from '../../src/lib/registry/types'
import type {
  PlayableWorldBundleV1,
  WorldReleaseManifestV2,
} from '../../src/lib/types'

const NOW = 1_900_100_000_000
const CREATOR_TOKEN = 'hosted-creator-token-123456'
const PUBLISHER_TOKEN = 'hosted-publisher-token-1234'
const PLAYER_TOKEN = 'hosted-player-token-1234567'

class AtomicMemoryStorageV1 implements TransactionalKeyValueStorageV1 {
  private readonly values = new Map<string, unknown>()
  private tail: Promise<void> = Promise.resolve()
  failNextGet = false

  async get<T>(key: string): Promise<T | undefined> {
    if (this.failNextGet) {
      this.failNextGet = false
      throw new Error('injected boot storage outage with provider-private-detail')
    }
    const value = this.values.get(key)
    return value == null ? undefined : structuredClone(value) as T
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value))
  }

  async transaction<T>(operation: (transaction: TransactionalKeyValueTransactionV1) => Promise<T>): Promise<T> {
    let release!: () => void
    const prior = this.tail
    this.tail = new Promise<void>(resolve => { release = resolve })
    await prior
    const staged = new Map(this.values)
    try {
      const result = await operation({
        get: async <V>(key: string) => {
          const value = staged.get(key)
          return value == null ? undefined : structuredClone(value) as V
        },
        put: async <V>(key: string, value: V) => { staged.set(key, structuredClone(value)) },
      })
      this.values.clear()
      for (const [key, value] of staged) this.values.set(key, value)
      return result
    } finally {
      release()
    }
  }
}

function legacyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${legacyJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function legacyHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacyJson(value)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function playableFixture(worldContentHash: string): PlayableWorldBundleV1 {
  return {
    schema: 'storyforge.playable-world-bundle', version: 1, compilerVersion: 1,
    source: { worldCode: 'hosted-mist', worldName: '托管雾港', worldContentHash }, createdAt: NOW,
    canonSnapshot: {
      schema: 'storyforge.simulation-canon', version: 1, createdAt: NOW,
      worldGroupId: null, worldLabel: '托管雾港', sources: [], snapshotHash: 'c'.repeat(64),
    },
    initialState: {
      version: 1, clock: 0,
      entities: {
        'release-character:0': {
          entityKey: 'release-character:0', kind: 'character', name: '林舟',
          locationKey: 'release-location:0', lifecycleStatus: 'active',
          attributes: { identity: '追查潮汐档案的调查者', roleWeight: 'main' },
        },
        'release-character:1': {
          entityKey: 'release-character:1', kind: 'character', name: '守潮人',
          locationKey: 'release-location:0', lifecycleStatus: 'active',
          attributes: { identity: '掌握旧港秘密的向导', roleWeight: 'npc' },
        },
        'release-location:0': {
          entityKey: 'release-location:0', kind: 'location', name: '退潮旧港',
          locationKey: 'release-location:0', lifecycleStatus: 'active', attributes: {},
        },
      },
      memories: [], narratives: [], ttrpg: null, chat: null, interaction: null,
      narrative: null, adventure: null, presentation: null,
      narrativeSimulation: null, openWorld: null, lastSequence: 0,
    },
    diagnostics: [], bundleHash: 'b'.repeat(64),
  }
}

async function ttrpgBundle(): Promise<{
  bundle: GameDistributionBundleV1
  playerKey: string
  openingSceneKey: string
  releaseHash: string
}> {
  const sourceManifestBase = {
    sourceKind: 'world-draft' as const,
    sourceWorkspaceUid: 'workspace.hosted-mist',
    sourceWorldCode: 'hosted-mist',
    sourceWorkCode: 'work.hosted-platform-acceptance',
    selectedResourceIds: [],
    omittedResourceIds: [],
  }
  const worldManifest: WorldReleaseManifestV2 = {
    schema: 'storyforge.world-package', version: 2, semanticContract: 3,
    worldCode: 'hosted-mist', worldName: '托管雾港', workTitle: '托管平台验收战役',
    selectedTables: [], selectedNarrativeModules: [], dependencies: [], records: {}, portableProject: {},
    capabilityProfile: WORLD_CAPABILITY_AREAS.map(area => ({
      area,
      resourceCount: 0,
      rowCount: 0,
      status: 'missing',
      selectionStatus: 'omitted',
      selectedResourceCount: 0,
      omittedResourceCount: 0,
      confirmedRowCount: 0,
      candidateRowCount: 0,
      conflictRowCount: 0,
      omittedRowCount: 0,
      latestRevision: null,
      originalEvidenceAvailable: false,
      queryableIndexAvailable: false,
    })),
    resourceCatalog: [],
    sourceManifest: {
      ...sourceManifestBase,
      contentHash: await legacyHash(sourceManifestBase),
    },
  }
  const worldContentHash = await legacyHash(worldManifest)
  const rulePack = createStoryForgeRulePackV1()
  const campaign = compileTtrpgCampaignDraftV1({
    playableWorld: playableFixture(worldContentHash), rulePack, fixtureOnly: true, confirmDefaultMappings: true,
  })
  const runtimePackage = await buildTtrpgRuntimePackageV1({
    worldReleaseManifest: worldManifest,
    worldContentHash,
    rulePack,
    rulePackContentHash: await hashGameProductionValueV2(rulePack),
    campaign,
  })
  const manifest = await createGameReleaseManifestV2({ runtimePackage, productionProvenance: null })
  const releaseHash = await hashGameProductionValueV2(manifest)
  const payload = {
    schema: 'storyforge.game-distribution-bundle' as const,
    version: 1 as const,
    gameRelease: { contentHash: releaseHash, manifest },
    worldRelease: { contentHash: worldContentHash, manifest: worldManifest },
    media: [],
  }
  const bundle = await verifyGameDistributionBundleV1({
    ...payload,
    bundleHash: await hashGameProductionValueV2(payload),
  })
  return {
    bundle,
    playerKey: campaign.characterTemplates.find(row => row.role === 'player')!.characterKey,
    openingSceneKey: campaign.scenes[0].sceneKey,
    releaseHash,
  }
}

async function webRequest(request: IncomingMessage, response: ServerResponse, fetchHandler: (request: Request) => Promise<Response>) {
  const chunks: Uint8Array[] = []
  for await (const chunk of request) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  const target = `http://${request.headers.host}${request.url}`
  const webResponse = await fetchHandler(new Request(target, {
    method: request.method,
    headers: request.headers as Record<string, string>,
    body,
    duplex: body ? 'half' : undefined,
  } as RequestInit))
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()))
  response.end(Buffer.from(await webResponse.arrayBuffer()))
}

async function listen(fetchHandler: (request: Request) => Promise<Response>) {
  const server = createServer((request, response) => {
    void webRequest(request, response, fetchHandler).catch(error => {
      response.statusCode = 500
      response.end(String(error))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server address unavailable')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) reject(error); else resolve() })
    }),
  }
}

function tcpFetch(input: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}): Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }> {
  return new Promise((resolve, reject) => {
    const request = sendHttpRequest(input, {
      method: init.method,
      headers: init.headers,
      signal: init.signal,
    }, response => {
      const chunks: Uint8Array[] = []
      response.on('data', chunk => { chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk) })
      response.on('error', reject)
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        const status = response.statusCode ?? 0
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: async () => raw,
          json: async () => JSON.parse(raw),
        })
      })
    })
    request.on('error', reject)
    request.end(init.body)
  })
}

function accountIdentity() {
  const commercial = new Map<string, CommercialPrincipalV1>([
    [CREATOR_TOKEN, { userId: 'user.creator', permissions: [] }],
    [PUBLISHER_TOKEN, { userId: 'user.publisher', permissions: ['catalog:publish'] }],
    [PLAYER_TOKEN, { userId: 'user.player', permissions: [] }],
  ])
  const community = new Map<string, CommunityPrincipalV1>([
    [CREATOR_TOKEN, { userId: 'user.creator', permissions: [] }],
    [PUBLISHER_TOKEN, { userId: 'user.publisher', permissions: [] }],
    [PLAYER_TOKEN, { userId: 'user.player', permissions: [] }],
  ])
  return {
    authenticateCommercial: async (token: string) => structuredClone(commercial.get(token) ?? null),
    authenticateCommunity: async (token: string) => structuredClone(community.get(token) ?? null),
    canHostRooms: async (userId: string) => userId === 'user.creator' || userId === 'user.player',
  }
}

function commonServiceInput(storage: AtomicMemoryStorageV1, delivery: InMemoryCommercialReleaseDeliveryPersistenceV1) {
  const identity = accountIdentity()
  return {
    serviceVersion: 'test-hosted-1',
    environment: 'development' as const,
    allowedOrigins: ['https://app.storyforge.test', 'http://localhost:3000'],
    dependencyEvidence: {
      'identity-provider': 'memory' as const,
      'transactional-commercial-store': 'memory' as const,
      'transactional-community-store': 'memory' as const,
      'transactional-online-store': 'memory' as const,
      'transactional-operations-store': 'memory' as const,
      'object-storage': 'memory' as const,
      'payment-provider': 'memory' as const,
      'webhook-secret-manager': 'memory' as const,
      'realtime-fanout': 'memory' as const,
      'rate-limiter': 'memory' as const,
      'single-writer-coordination': 'memory' as const,
    },
    storage,
    identity,
    credentials: {
      issueStableGmCredential: async (value: unknown) => `gm.${await hashGameProductionValueV2(value)}`,
      issueStableRoomSessionCredential: async (value: unknown) => `member.${await hashGameProductionValueV2(value)}`,
      issueStableInviteCredential: async (value: unknown) => {
        const hash = await hashGameProductionValueV2(value)
        return { inviteId: `invite.${hash.slice(0, 32)}`, inviteToken: `invite-token.${hash}` }
      },
    },
    releaseDeliveryPersistence: delivery,
    lfgHandoffPersistence: new InMemoryCommunityLfgRoomHandoffPersistenceV1(),
    lfgSecretVault: new InMemoryCommunityLfgRoomSecretVaultV1(),
    checkoutProvider: {
      createOrResumeSession: async (order: { orderId: string }) => ({
        checkoutSessionId: `checkout.${order.orderId}`,
        orderId: order.orderId,
        checkoutUrl: `https://pay.storyforge.test/${order.orderId}`,
        expiresAt: NOW + 60_000,
      }),
    },
    webhookSecret: 'hosted-webhook-secret-at-least-32-characters',
    requestGuard: {
      resolveSubject: async (request: Request) => {
        const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
        const principal = token ? await identity.authenticateCommercial(token) : null
        return principal
          ? { subjectKey: `account:${principal.userId}`, subjectKind: 'account' as const }
          : { subjectKey: `anonymous:${new URL(request.url).pathname}`, subjectKind: 'anonymous' as const }
      },
      rateLimiter: createMemoryGamePlatformRateLimiterV1({ limit: 1_000, windowMs: 60_000 }),
      audit: async () => undefined,
      now: () => NOW,
    },
    now: () => NOW,
  }
}

function configuredEvidence() {
  return Object.fromEntries(GAME_PLATFORM_PRODUCTION_DEPENDENCIES_V1.map(dependency => [
    dependency, 'configured' as const,
  ]))
}

function productionRuntime(input: {
  health: Partial<Record<GamePlatformProductionDependencyV1, boolean>>
  authorityAllowed: () => boolean
  storage: AtomicMemoryStorageV1
  delivery: InMemoryCommercialReleaseDeliveryPersistenceV1
}): HostedGamePlatformProductionRuntimeV1 {
  const probe = <Dependency extends GamePlatformProductionDependencyV1>(
    dependency: Dependency,
  ): GamePlatformProductionDependencyAdapterV1<Dependency> => ({
    dependency,
    adapterId: `integration.external.${dependency}`,
    deployment: 'external',
    probe: async () => ({
      ok: input.health[dependency] ?? true,
      code: input.health[dependency] === false ? 'dependency-down' : 'ok',
    }),
  })
  const localRealtime = new OnlineRoomRealtimeHubV1()
  const vault = new InMemoryCommunityLfgRoomSecretVaultV1()
  return {
    identity: { ...accountIdentity(), ...probe('identity-provider') },
    storage: Object.assign(input.storage, {
      dependencyAdapters: {
        'transactional-commercial-store': probe('transactional-commercial-store'),
        'transactional-community-store': probe('transactional-community-store'),
        'transactional-online-store': probe('transactional-online-store'),
        'transactional-operations-store': probe('transactional-operations-store'),
      },
      lfgHandoffPersistence: new InMemoryCommunityLfgRoomHandoffPersistenceV1(),
    }),
    releaseDeliveryPersistence: Object.assign(input.delivery, probe('object-storage')),
    checkoutProvider: {
      ...probe('payment-provider'),
      createOrResumeSession: async order => ({
        checkoutSessionId: `production.${order.orderId}`,
        orderId: order.orderId,
        checkoutUrl: `https://pay.storyforge.test/${order.orderId}`,
        expiresAt: NOW + 60_000,
      }),
    },
    secretManager: {
      ...probe('webhook-secret-manager'),
      resolveVerificationKeys: async () => [{
        keyId: 'integration.current', role: 'current',
        secret: 'integration-production-webhook-secret', activeFrom: NOW - 1_000, expiresAt: null,
      }],
      issueStableGmCredential: async value => `gm.${await hashGameProductionValueV2(value)}`,
      issueStableRoomSessionCredential: async value => `member.${await hashGameProductionValueV2(value)}`,
      issueStableInviteCredential: async value => {
        const hash = await hashGameProductionValueV2(value)
        return { inviteId: `invite.${hash.slice(0, 32)}`, inviteToken: `invite-token.${hash}` }
      },
      putIfAbsent: value => vault.putIfAbsent(value),
      read: value => vault.read(value),
    },
    realtime: {
      ...probe('realtime-fanout'),
      notify: (roomId, cursor) => localRealtime.notify(roomId, cursor),
      waitForAdvance: value => localRealtime.waitForAdvance(value),
    },
    rateLimiter: {
      ...probe('rate-limiter'),
      consume: async () => ({ allowed: true, limit: 10_000, remaining: 9_999, retryAfterMs: 0 }),
    },
    requestAuthority: {
      ...probe('single-writer-coordination'),
      assertAuthority: async () => input.authorityAllowed(),
    },
  }
}

describe('PLATFORM-1H · unified hosted service composition', () => {
  it('启动时外部存储短暂不可用仍保留脱敏 503 健康端点，退避后并发请求只重建一次', async () => {
    let clock = NOW
    const storage = new AtomicMemoryStorageV1()
    storage.failNextGet = true
    const bootstrap = createHostedGamePlatformBootstrapV1({
      ...commonServiceInput(storage, new InMemoryCommercialReleaseDeliveryPersistenceV1()),
      bootstrapRetryBackoffMs: 100,
      now: () => clock,
    })
    const failed = await bootstrap.fetch(new Request('https://api.storyforge.test/healthz/platform'))
    expect(failed.status).toBe(503)
    expect(failed.headers.get('retry-after')).toBe('1')
    expect(JSON.stringify(await failed.json())).not.toContain('provider-private-detail')
    expect(bootstrap.current()).toBeNull()

    const withinBackoff = await bootstrap.fetch(new Request('https://api.storyforge.test/v1/commercial/discover', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }))
    expect(withinBackoff.status).toBe(503)
    await expect(withinBackoff.json()).resolves.toMatchObject({ code: 'platform_bootstrap_unavailable' })
    clock += 100
    const [first, second] = await Promise.all([
      bootstrap.fetch(new Request('https://api.storyforge.test/healthz/platform')),
      bootstrap.fetch(new Request('https://api.storyforge.test/healthz/platform')),
    ])
    expect([first.status, second.status]).toEqual([200, 200])
    expect(bootstrap.current()).not.toBeNull()
    expect(await storage.get('storyforge.hosted.commercial.v1/current')).toMatchObject({ revision: 1 })
  })

  it('生产依赖没有全部声明 configured 时，健康检查和所有领域请求都 fail-closed', async () => {
    const storage = new AtomicMemoryStorageV1()
    const service = await createHostedGamePlatformServiceV1({
      ...commonServiceInput(storage, new InMemoryCommercialReleaseDeliveryPersistenceV1()),
      environment: 'production',
    })
    expect(service.readiness.ready).toBe(false)
    const health = await service.fetch(new Request('https://api.storyforge.test/healthz/platform'))
    expect(health.status).toBe(503)
    await expect(health.json()).resolves.toMatchObject({
      checks: { 'identity-provider': 'development-only', 'object-storage': 'development-only' },
    })
    const endpoint = await service.fetch(new Request('https://api.storyforge.test/v1/commercial/discover', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }))
    expect(endpoint.status).toBe(503)
  })

  it('十一项即使全声明 configured，没有活的生产适配器仍不能伪装就绪', async () => {
    const storage = new AtomicMemoryStorageV1()
    const service = await createHostedGamePlatformServiceV1({
      ...commonServiceInput(storage, new InMemoryCommercialReleaseDeliveryPersistenceV1()),
      environment: 'production',
      dependencyEvidence: configuredEvidence(),
    })
    expect(service.readiness).toMatchObject({
      ready: false,
      checks: { 'identity-provider': 'missing', 'realtime-fanout': 'missing' },
    })
    const health = await service.fetch(new Request('https://api.storyforge.test/healthz/platform'))
    expect(health.status).toBe(503)
  })

  it('生产活探针、分布式限流和请求权威与同一组合根绑定，租约或依赖失效立即 fail-closed', async () => {
    const baseStorage = new AtomicMemoryStorageV1()
    const runtimeStorage = new AtomicMemoryStorageV1()
    const baseDelivery = new InMemoryCommercialReleaseDeliveryPersistenceV1()
    const runtimeDelivery = new InMemoryCommercialReleaseDeliveryPersistenceV1()
    const health: Partial<Record<GamePlatformProductionDependencyV1, boolean>> = {}
    let authorityAllowed = false
    const service = await createHostedGamePlatformServiceV1({
      ...commonServiceInput(baseStorage, baseDelivery),
      environment: 'production',
      dependencyEvidence: configuredEvidence(),
      productionRuntime: productionRuntime({
        health, authorityAllowed: () => authorityAllowed,
        storage: runtimeStorage, delivery: runtimeDelivery,
      }),
    })
    expect(service.readiness.ready).toBe(true)
    expect(await baseStorage.get('storyforge.hosted.commercial.v1/current')).toBeUndefined()
    expect(await runtimeStorage.get('storyforge.hosted.commercial.v1/current')).toMatchObject({ revision: 1 })
    expect((await service.fetch(new Request('https://api.storyforge.test/healthz/platform'))).status).toBe(200)

    const discover = () => service.fetch(new Request('https://api.storyforge.test/v1/commercial/discover', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }))
    const denied = await discover()
    expect(denied.status).toBe(503)
    await expect(denied.json()).resolves.toMatchObject({ code: 'platform_authority_unavailable' })
    authorityAllowed = true
    expect((await discover()).status).toBe(200)

    health['payment-provider'] = false
    const degraded = await service.fetch(new Request('https://api.storyforge.test/healthz/platform'))
    expect(degraded.status).toBe(503)
    await expect(degraded.json()).resolves.toMatchObject({
      ready: false, checks: { 'payment-provider': 'unhealthy' },
    })
    expect(service.readiness.ready).toBe(false)
    const blocked = await discover()
    expect(blocked.status).toBe(503)
    await expect(blocked.json()).resolves.toMatchObject({ code: 'platform_not_ready' })
  })

  it('三个账号经真实 TCP HTTP 完成发布、领取、验证评论、正式房间加入，并在服务重启后恢复', async () => {
    const storage = new AtomicMemoryStorageV1()
    const delivery = new InMemoryCommercialReleaseDeliveryPersistenceV1()
    const fixture = await ttrpgBundle()
    const firstService = await createHostedGamePlatformServiceV1(commonServiceInput(storage, delivery))
    const firstServer = await listen(firstService.fetch)
    const commercial = new CommercialHttpClientV1({ baseUrl: firstServer.baseUrl, fetch: tcpFetch })
    const community = new CommunityHttpClientV1({ baseUrl: firstServer.baseUrl, fetch: tcpFetch })
    const online = new HttpOnlineRoomTransportV1({ baseUrl: firstServer.baseUrl, fetch: tcpFetch })

    const listing = await commercial.createListing({
      accessToken: CREATOR_TOKEN,
      requestId: 'listing.hosted.create',
      releaseHash: fixture.releaseHash,
      productType: 'ttrpg',
      title: '托管雾港战役',
      summary: '从发行、社区到在线房间的真实服务闭环。',
      contentWarnings: ['悬疑'],
      license: {
        licenseId: 'license.hosted-v1', licenseVersion: '1.0.0',
        allowOfflineExport: true, allowRemix: true, commercialReuse: false,
        requiresAttribution: true, termsUrl: 'https://storyforge.test/licenses/hosted-v1',
      },
      currency: 'CNY', amountMinor: 0, creatorShareBps: 8_000,
    })
    await commercial.registerRelease({
      accessToken: CREATOR_TOKEN, requestId: 'release.hosted.register', bundle: fixture.bundle,
    })
    await commercial.submitListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.hosted.submit', listingId: listing.listingId,
    })
    await commercial.publishListing({
      accessToken: PUBLISHER_TOKEN, requestId: 'listing.hosted.publish', listingId: listing.listingId,
    })
    const acquisition = await commercial.acquire({
      accessToken: PLAYER_TOKEN, requestId: 'order.hosted.claim', listingId: listing.listingId,
    })
    expect(acquisition).toMatchObject({ order: { status: 'paid' }, entitlement: { status: 'active' }, checkout: null })

    for (const [accessToken, handle, displayName] of [
      [CREATOR_TOKEN, 'hosted-creator', '托管创作者'],
      [PLAYER_TOKEN, 'hosted-player', '托管玩家'],
    ] as const) {
      await community.upsertProfile({
        accessToken, requestId: `profile.${handle}`, handle, displayName, bio: '',
        locale: 'zh-CN', timeZone: 'Asia/Shanghai', ageBand: 'adult',
      })
    }
    await community.upsertReview({
      accessToken: PLAYER_TOKEN,
      requestId: 'review.hosted.verified',
      subjectType: 'release',
      releaseHash: fixture.releaseHash,
      postId: null,
      rating: 5,
      title: '完整托管闭环',
      body: '领取后能够直接进入正式在线房间。',
      tags: ['在线可玩'],
      containsSpoilers: false,
    })
    await expect(community.listReviews({ subjectType: 'release', releaseHash: fixture.releaseHash }))
      .resolves.toMatchObject({ reviews: [{ verification: 'entitlement', authorId: 'user.player' }] })
    await expect(community.reviewCapabilities({
      accessToken: CREATOR_TOKEN, subjectType: 'release', releaseHash: fixture.releaseHash,
    })).resolves.toMatchObject({ respondableReviewIds: [expect.stringMatching(/^review\./)] })

    const room = await online.createRoom({
      requestId: 'room.hosted.create',
      roomId: 'room.hosted.integration',
      releaseHash: fixture.releaseHash,
      selectedCharacterKeys: [fixture.playerKey],
      creatorAccessToken: CREATOR_TOKEN,
      gmDisplayName: '托管主持人',
    })
    await online.submit({
      protocolVersion: 1,
      roomId: room.roomId,
      releaseHash: fixture.releaseHash,
      requestId: 'room.hosted.scene-open',
      memberId: room.member.memberId,
      authToken: room.authToken,
      expectedSequence: 0,
      kind: 'scene.open',
      actorKey: null,
      payload: { sceneKey: fixture.openingSceneKey },
    })
    const invite = await online.issueInvite({
      roomId: room.roomId,
      gmMemberId: room.member.memberId,
      gmAuthToken: room.authToken,
      role: 'player',
      actorKey: fixture.playerKey,
      expiresAt: NOW + 86_400_000,
      maximumUses: 1,
    })
    const joined = await online.joinAuthenticatedRoom({
      requestId: 'room.hosted.join',
      roomId: room.roomId,
      inviteId: invite.inviteId,
      inviteToken: invite.inviteToken,
      memberAccessToken: PLAYER_TOKEN,
      displayName: '托管玩家',
    })
    const gmProjection = await online.reconnect({
      roomId: room.roomId,
      memberId: room.member.memberId,
      authToken: room.authToken,
      afterSequence: 0,
    })
    const activeActorKey = ((gmProjection.projection as {
      campaign?: { turn?: { activeActorKey?: unknown } }
    }).campaign?.turn?.activeActorKey)
    let expectedSequence = joined.cursor
    if (typeof activeActorKey !== 'string') throw new Error('托管房间缺少当前行动者投影')
    if (activeActorKey !== fixture.playerKey) {
      await expect(online.submit({
        protocolVersion: 1,
        roomId: room.roomId,
        releaseHash: fixture.releaseHash,
        requestId: 'room.hosted.gm-npc-action',
        memberId: room.member.memberId,
        authToken: room.authToken,
        expectedSequence,
        kind: 'rule.action',
        actorKey: activeActorKey,
        payload: { actionKey: 'investigate', targetKey: null, difficulty: 8, situationalModifier: 0 },
      })).resolves.toMatchObject({ acceptedSequence: expectedSequence + 1, duplicate: false })
      expectedSequence += 1
    }
    const action: OnlineRoomCommandV1 = {
      protocolVersion: 1,
      roomId: room.roomId,
      releaseHash: fixture.releaseHash,
      requestId: 'room.hosted.action',
      memberId: joined.member.memberId,
      authToken: joined.authToken,
      expectedSequence,
      kind: 'rule.action',
      actorKey: fixture.playerKey,
      payload: { actionKey: 'investigate', targetKey: null, difficulty: 8, situationalModifier: 0 },
    }
    await expect(online.submit(action)).resolves.toMatchObject({ acceptedSequence: expectedSequence + 1, duplicate: false })
    const finalSequence = expectedSequence + 1
    await firstServer.close()

    const restoredService = await createHostedGamePlatformServiceV1(commonServiceInput(storage, delivery))
    const restoredServer = await listen(restoredService.fetch)
    try {
      const restoredOnline = new HttpOnlineRoomTransportV1({ baseUrl: restoredServer.baseUrl, fetch: tcpFetch })
      const resumed = await restoredOnline.resumeAuthenticatedRoom({
        roomId: room.roomId, memberAccessToken: PLAYER_TOKEN,
      })
      expect(resumed).toMatchObject({
        roomId: room.roomId,
        releaseHash: fixture.releaseHash,
        member: { memberId: joined.member.memberId, role: 'player', actorKey: fixture.playerKey },
        cursor: finalSequence,
      })
      const events = await restoredOnline.reconnect({
        roomId: room.roomId,
        memberId: resumed.member.memberId,
        authToken: resumed.authToken,
        afterSequence: 0,
      })
      expect(events.events[0]).toMatchObject({ sequence: 1, eventType: 'ttrpg.scene.open' })
      expect(events.events.at(-1)).toMatchObject({ sequence: finalSequence, eventType: 'ttrpg.rule.action' })
      const restoredCommercial = new CommercialHttpClientV1({ baseUrl: restoredServer.baseUrl, fetch: tcpFetch })
      await expect(restoredCommercial.discover({ query: '托管雾港' }))
        .resolves.toMatchObject([{ listingId: listing.listingId, releaseHash: fixture.releaseHash }])
    } finally {
      await restoredServer.close()
    }
  }, 40_000)
})
