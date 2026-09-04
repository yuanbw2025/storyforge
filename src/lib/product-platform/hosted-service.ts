import {
  CommercialPlatformAuthorityV1,
  type CommercialPlatformSnapshotV1,
  type CommercialPrincipalV1,
} from '../commercial/authority'
import { createCommercialFetchHandlerV1 } from '../commercial/fetch-service'
import {
  createCommercialGatewayV1,
  type CommercialCheckoutProviderV1,
  type CommercialGatewayAuditV1,
  type CommercialIdentityV1,
  type CommercialPaymentSettlementV1,
  type CommercialWebhookSecretProviderV1,
} from '../commercial/gateway'
import {
  CommercialOperationsAuthorityV1,
  type CommercialOperationsSnapshotV1,
} from '../commercial/operations-authority'
import { createCommercialOperationsFetchHandlerV1 } from '../commercial/operations-fetch-service'
import {
  createCommercialOperationsGatewayV1,
  type CommercialOperationsGatewayAuditV1,
} from '../commercial/operations-gateway'
import {
  createCommercialReleaseDeliveryGatewayV1,
} from '../commercial/release-delivery-gateway'
import {
  CommercialReleaseDeliveryServiceV1,
  type CommercialReleaseDeliveryPersistenceV1,
} from '../commercial/release-delivery'
import {
  CommunityPlatformAuthorityV1,
  type CommunityPlatformSnapshotV1,
  type CommunityPrincipalV1,
} from '../community/authority'
import { CommercialCommunityReleasePolicyV1 } from '../community/commercial-release-policy'
import { createCommunityFetchHandlerV1 } from '../community/fetch-service'
import {
  createCommunityGatewayV1,
  type CommunityGatewayAuditV1,
} from '../community/gateway'
import {
  CommunityLfgRoomHandoffServiceV1,
  type CommunityLfgRoomHandoffPersistenceV1,
  type CommunityLfgRoomSecretVaultV1,
} from '../community/lfg-room-handoff'
import { createOnlineRoomFetchHandlerV1 } from '../online/fetch-service'
import {
  OnlineRoomRealtimeHubV1,
  type OnlineRoomRealtimeCoordinatorV1,
} from '../online/realtime-hub'
import { createOnlineRoomGatewayV1, type OnlineRoomGatewayAuditV1 } from '../online/room-gateway'
import { TransactionalOnlineRoomPersistenceV1, type TransactionalKeyValueStorageV1 } from '../online/transactional-persistence'
import {
  HostedFormalTtrpgRoomRegistryV1,
  type HostedOnlineRoomCredentialIssuerV1,
  type HostedOnlineRoomIdentityV1,
  type HostedTtrpgReleaseRecordV1,
  type HostedTtrpgReleaseStoreV1,
} from '../online/ttrpg-room-registry'
import type { OnlineTtrpgAiPlayerServiceV1 } from '../online/ttrpg-ai-player-service'
import type { OnlineTtrpgAiGmServiceV1 } from '../online/ttrpg-ai-gm-service'
import {
  createProductPlatformServiceRouterV1,
  type ProductPlatformRateLimiterV1,
  type ProductPlatformProductionDependencyV1,
  type ProductPlatformRequestAuthorityV1,
  type ProductPlatformRequestGuardV1,
  type ProductPlatformReadinessV1,
} from './service-router'
import {
  createProductPlatformActiveReadinessV1,
  type ProductPlatformProductionDependencyAdapterV1,
  type ProductPlatformProductionDependencyAdaptersV1,
  type ProductPlatformProductionProbeAuditV1,
} from './production-runtime'
import { TransactionalPlatformSnapshotPersistenceV1 } from './transactional-snapshot-persistence'

export interface HostedProductPlatformIdentityV1 {
  /** Verifies one deployment-owned access token and returns commerce permissions. */
  authenticateCommercial(accessToken: string): Promise<CommercialPrincipalV1 | null>
  /** The same account namespace projected into community permissions. */
  authenticateCommunity(accessToken: string): Promise<CommunityPrincipalV1 | null>
  /** Separate account/plan policy; ownership alone must not silently grant room hosting. */
  canHostRooms(userId: string): Promise<boolean>
}

export interface HostedProductPlatformAuditSinksV1 {
  commercial?(entry: CommercialGatewayAuditV1): void | Promise<void>
  community?(entry: CommunityGatewayAuditV1): void | Promise<void>
  online?(entry: OnlineRoomGatewayAuditV1): void | Promise<void>
  operations?(entry: CommercialOperationsGatewayAuditV1): void | Promise<void>
}

export interface HostedProductPlatformNamespacesV1 {
  commercial: string
  community: string
  operations: string
  online: string
}

export interface HostedProductPlatformServiceV1 {
  fetch(request: Request): Promise<Response>
  readiness: ProductPlatformReadinessV1
  readinessNow(input?: { force?: boolean }): Promise<ProductPlatformReadinessV1>
  commercial: CommercialPlatformAuthorityV1
  community: CommunityPlatformAuthorityV1
  operations: CommercialOperationsAuthorityV1
  releaseDelivery: CommercialReleaseDeliveryServiceV1
  onlineRooms: HostedFormalTtrpgRoomRegistryV1
  realtime: OnlineRoomRealtimeCoordinatorV1
}

export interface HostedProductPlatformBootstrapV1 {
  fetch(request: Request): Promise<Response>
  current(): HostedProductPlatformServiceV1 | null
}

export type HostedProductPlatformProductionStorageV1 = TransactionalKeyValueStorageV1 & {
  dependencyAdapters: {
    'transactional-commercial-store': ProductPlatformProductionDependencyAdapterV1<'transactional-commercial-store'>
    'transactional-community-store': ProductPlatformProductionDependencyAdapterV1<'transactional-community-store'>
    'transactional-online-store': ProductPlatformProductionDependencyAdapterV1<'transactional-online-store'>
    'transactional-operations-store': ProductPlatformProductionDependencyAdapterV1<'transactional-operations-store'>
  }
  lfgHandoffPersistence: CommunityLfgRoomHandoffPersistenceV1
}

export type HostedProductPlatformProductionSecretManagerV1 = CommercialWebhookSecretProviderV1
  & CommunityLfgRoomSecretVaultV1
  & HostedOnlineRoomCredentialIssuerV1
  & ProductPlatformProductionDependencyAdapterV1<'webhook-secret-manager'>

export interface HostedProductPlatformProductionRuntimeV1 {
  identity: HostedProductPlatformIdentityV1
    & ProductPlatformProductionDependencyAdapterV1<'identity-provider'>
  /** The exact transactional storage used by all four authorities and LFG handoff state. */
  storage: HostedProductPlatformProductionStorageV1
  releaseDeliveryPersistence: CommercialReleaseDeliveryPersistenceV1
    & ProductPlatformProductionDependencyAdapterV1<'object-storage'>
  checkoutProvider: CommercialCheckoutProviderV1
    & ProductPlatformProductionDependencyAdapterV1<'payment-provider'>
  /** One deployment-owned secret boundary for webhook, LFG and room credentials. */
  secretManager: HostedProductPlatformProductionSecretManagerV1
  realtime: OnlineRoomRealtimeCoordinatorV1
    & ProductPlatformProductionDependencyAdapterV1<'realtime-fanout'>
  rateLimiter: ProductPlatformRateLimiterV1
    & ProductPlatformProductionDependencyAdapterV1<'rate-limiter'>
  requestAuthority: ProductPlatformRequestAuthorityV1
    & ProductPlatformProductionDependencyAdapterV1<'single-writer-coordination'>
}

export interface HostedProductPlatformServiceInputV1 {
  serviceVersion: string
  environment: 'development' | 'production'
  allowedOrigins: string[]
  dependencyEvidence: Partial<Record<ProductPlatformProductionDependencyV1, 'configured' | 'memory'>>
  storage: TransactionalKeyValueStorageV1
  identity: HostedProductPlatformIdentityV1
  credentials: HostedOnlineRoomCredentialIssuerV1
  releaseDeliveryPersistence: CommercialReleaseDeliveryPersistenceV1
  lfgHandoffPersistence: CommunityLfgRoomHandoffPersistenceV1
  lfgSecretVault: CommunityLfgRoomSecretVaultV1
  checkoutProvider: CommercialCheckoutProviderV1
  /** Development/test fallback. Production uses productionRuntime.secretManager. */
  webhookSecret?: string
  requestGuard: ProductPlatformRequestGuardV1
  productionRuntime?: HostedProductPlatformProductionRuntimeV1
  productionProbeTimeoutMs?: number
  productionReadinessCacheTtlMs?: number
  productionProbeAudit?: (entry: ProductPlatformProductionProbeAuditV1) => void | Promise<void>
  namespaces?: Partial<HostedProductPlatformNamespacesV1>
  audits?: HostedProductPlatformAuditSinksV1
  now?: () => number
  maximumCachedRooms?: number
  maximumCommittedRolls?: number
  /** Optional deployment-owned AI player provider; no model key enters room snapshots. */
  onlineAiPlayerService?: OnlineTtrpgAiPlayerServiceV1 | null
  /** Optional deployment-owned AI GM provider; only narration may be returned. */
  onlineAiGmService?: OnlineTtrpgAiGmServiceV1 | null
  createPaymentSettlement?: (input: {
    commercial: CommercialPlatformAuthorityV1
    operations: CommercialOperationsAuthorityV1
  }) => CommercialPaymentSettlementV1
}

const DEFAULT_NAMESPACES: HostedProductPlatformNamespacesV1 = {
  commercial: 'storyforge.hosted.commercial.v1',
  community: 'storyforge.hosted.community.v1',
  operations: 'storyforge.hosted.operations.v1',
  online: 'storyforge.hosted.online.v1',
}

async function openCommercial(
  persistence: TransactionalPlatformSnapshotPersistenceV1<CommercialPlatformSnapshotV1>,
  now: () => number,
): Promise<CommercialPlatformAuthorityV1> {
  if (await persistence.load()) return CommercialPlatformAuthorityV1.restore({ persistence, now })
  try {
    return await CommercialPlatformAuthorityV1.create({ persistence, now })
  } catch (error) {
    if (await persistence.load()) return CommercialPlatformAuthorityV1.restore({ persistence, now })
    throw error
  }
}

async function openOperations(
  persistence: TransactionalPlatformSnapshotPersistenceV1<CommercialOperationsSnapshotV1>,
  now: () => number,
): Promise<CommercialOperationsAuthorityV1> {
  if (await persistence.load()) return CommercialOperationsAuthorityV1.restore({ persistence, now })
  try {
    return await CommercialOperationsAuthorityV1.create({ persistence, now })
  } catch (error) {
    if (await persistence.load()) return CommercialOperationsAuthorityV1.restore({ persistence, now })
    throw error
  }
}

async function openCommunity(
  persistence: TransactionalPlatformSnapshotPersistenceV1<CommunityPlatformSnapshotV1>,
  commercial: CommercialPlatformAuthorityV1,
  now: () => number,
): Promise<CommunityPlatformAuthorityV1> {
  const releasePolicy = new CommercialCommunityReleasePolicyV1(commercial)
  if (await persistence.load()) return CommunityPlatformAuthorityV1.restore({ persistence, releasePolicy, now })
  try {
    return await CommunityPlatformAuthorityV1.create({ persistence, releasePolicy, now })
  } catch (error) {
    if (await persistence.load()) return CommunityPlatformAuthorityV1.restore({ persistence, releasePolicy, now })
    throw error
  }
}

class CatalogTtrpgReleaseStoreV1 implements HostedTtrpgReleaseStoreV1 {
  constructor(
    private readonly commercial: CommercialPlatformAuthorityV1,
    private readonly delivery: CommercialReleaseDeliveryPersistenceV1,
  ) {}

  async loadByContentHash(contentHash: string): Promise<HostedTtrpgReleaseRecordV1 | null> {
    const delivered = await this.delivery.load(contentHash)
    if (!delivered || delivered.releaseHash !== contentHash
      || delivered.bundle.productRelease.contentHash !== contentHash) return null
    const published = this.commercial.discover({ productType: 'ttrpg' })
      .some(listing => listing.releaseHash === contentHash && listing.creatorId === delivered.creatorId)
    return {
      contentHash,
      manifestJson: JSON.stringify(delivered.bundle.productRelease.manifest),
      status: published ? 'published' : 'suspended',
    }
  }
}

function identities(input: {
  identity: HostedProductPlatformIdentityV1
  commercial: CommercialPlatformAuthorityV1
}): {
  commercial: CommercialIdentityV1
  online: HostedOnlineRoomIdentityV1
} {
  return {
    commercial: { authenticate: token => input.identity.authenticateCommercial(token) },
    online: {
      async authorizeRoomCreation({ creatorAccessToken, releaseHash }) {
        const principal = await input.identity.authenticateCommercial(creatorAccessToken)
        if (!principal) return null
        return {
          userId: principal.userId,
          entitled: input.commercial.canHostRelease({ principal, releaseHash }),
          allowedToHost: await input.identity.canHostRooms(principal.userId),
        }
      },
      async authenticateRoomMembership({ memberAccessToken }) {
        const principal = await input.identity.authenticateCommercial(memberAccessToken)
        return principal ? { userId: principal.userId } : null
      },
    },
  }
}

/**
 * Production composition root for the StoryForge hosted boundary. It wires
 * identity, catalog, community, operations, authoritative TTRPG rooms, CORS,
 * readiness and the outer request guard into one Web-standard fetch handler.
 *
 * Concrete databases, object/KMS storage, payment checkout and identity remain
 * deployment-owned adapters. Production requests fail closed until every
 * required dependency is configured, bound to the object actually used by the
 * service and passes an active external probe.
 */
export async function createHostedProductPlatformServiceV1(
  input: HostedProductPlatformServiceInputV1,
): Promise<HostedProductPlatformServiceV1> {
  const now = input.now ?? (() => Date.now())
  const namespaces = { ...DEFAULT_NAMESPACES, ...input.namespaces }
  if (input.environment === 'development' && !input.webhookSecret && !input.productionRuntime) {
    throw new Error('[hosted-product-platform:configuration] 开发环境缺少 webhookSecret')
  }
  const productionAdapters: ProductPlatformProductionDependencyAdaptersV1 | undefined = input.productionRuntime
    ? {
        'identity-provider': input.productionRuntime.identity,
        ...input.productionRuntime.storage.dependencyAdapters,
        'object-storage': input.productionRuntime.releaseDeliveryPersistence,
        'payment-provider': input.productionRuntime.checkoutProvider,
        'webhook-secret-manager': input.productionRuntime.secretManager,
        'realtime-fanout': input.productionRuntime.realtime,
        'rate-limiter': input.productionRuntime.rateLimiter,
        'single-writer-coordination': input.productionRuntime.requestAuthority,
      }
    : undefined
  const activeReadiness = createProductPlatformActiveReadinessV1({
    serviceVersion: input.serviceVersion,
    environment: input.environment,
    dependencyEvidence: input.dependencyEvidence,
    adapters: productionAdapters,
    probeTimeoutMs: input.productionProbeTimeoutMs,
    cacheTtlMs: input.productionReadinessCacheTtlMs,
    now,
    audit: input.productionProbeAudit,
  })
  let readiness = await activeReadiness.read({ force: true })
  const readinessNow = async (options?: { force?: boolean }) => {
    readiness = await activeReadiness.read(options)
    return structuredClone(readiness)
  }
  const storage = input.productionRuntime?.storage ?? input.storage
  const identity = input.productionRuntime?.identity ?? input.identity
  const credentials = input.productionRuntime?.secretManager ?? input.credentials
  const releaseDeliveryPersistence = input.productionRuntime?.releaseDeliveryPersistence
    ?? input.releaseDeliveryPersistence
  const lfgHandoffPersistence = input.productionRuntime?.storage.lfgHandoffPersistence
    ?? input.lfgHandoffPersistence
  const lfgSecretVault = input.productionRuntime?.secretManager ?? input.lfgSecretVault
  const checkoutProvider = input.productionRuntime?.checkoutProvider ?? input.checkoutProvider
  const commercialPersistence = new TransactionalPlatformSnapshotPersistenceV1<CommercialPlatformSnapshotV1>(
    storage, { namespace: namespaces.commercial },
  )
  const operationsPersistence = new TransactionalPlatformSnapshotPersistenceV1<CommercialOperationsSnapshotV1>(
    storage, { namespace: namespaces.operations },
  )
  const communityPersistence = new TransactionalPlatformSnapshotPersistenceV1<CommunityPlatformSnapshotV1>(
    storage, { namespace: namespaces.community },
  )
  const commercial = await openCommercial(commercialPersistence, now)
  const operations = await openOperations(operationsPersistence, now)
  const community = await openCommunity(communityPersistence, commercial, now)
  const hostedIdentity = identities({ identity, commercial })
  const releaseDelivery = new CommercialReleaseDeliveryServiceV1(
    commercial, releaseDeliveryPersistence, now,
  )
  const realtime: OnlineRoomRealtimeCoordinatorV1 = input.productionRuntime?.realtime
    ?? new OnlineRoomRealtimeHubV1()
  const onlineRooms = new HostedFormalTtrpgRoomRegistryV1({
    releases: new CatalogTtrpgReleaseStoreV1(commercial, releaseDeliveryPersistence),
    identity: hostedIdentity.online,
    credentials,
    persistence: {
      forRoom: () => new TransactionalOnlineRoomPersistenceV1(storage, {
        namespace: namespaces.online,
      }),
    },
    maximumCachedRooms: input.maximumCachedRooms,
    maximumCommittedRolls: input.maximumCommittedRolls,
    aiPlayerService: input.onlineAiPlayerService,
    aiGmService: input.onlineAiGmService,
    now,
  })
  const roomHandoff = new CommunityLfgRoomHandoffServiceV1({
    community,
    online: onlineRooms,
    persistence: lfgHandoffPersistence,
    vault: lfgSecretVault,
    now,
  })
  const paymentSettlement = input.createPaymentSettlement?.({ commercial, operations })
  const webhookConfiguration = input.productionRuntime
    ? { webhookSecrets: input.productionRuntime.secretManager }
    : { webhookSecret: input.webhookSecret ?? `unavailable.${crypto.randomUUID()}` }
  const commercialGateway = createCommercialGatewayV1({
    authority: commercial,
    identity: hostedIdentity.commercial,
    releaseDelivery,
    checkoutProvider,
    paymentSettlement,
    ...webhookConfiguration,
    audit: input.audits?.commercial,
    now,
  })
  const deliveryGateway = createCommercialReleaseDeliveryGatewayV1({
    service: releaseDelivery,
    identity: hostedIdentity.commercial,
    audit: input.audits?.commercial,
    now,
  })
  const communityGateway = createCommunityGatewayV1({
    authority: community,
    identity: { authenticate: token => identity.authenticateCommunity(token) },
    roomHandoff,
    audit: input.audits?.community,
    now,
  })
  const operationsGateway = createCommercialOperationsGatewayV1({
    authority: operations,
    identity: hostedIdentity.commercial,
    audit: input.audits?.operations,
    now,
  })
  const onlineGateway = createOnlineRoomGatewayV1({
    rooms: onlineRooms,
    realtime,
    audit: input.audits?.online,
    now,
  })
  const commercialHandler = createCommercialFetchHandlerV1({
    commercialGateway,
    deliveryGateway,
    allowedOrigins: input.allowedOrigins,
    serviceVersion: input.serviceVersion,
  })
  const communityHandler = createCommunityFetchHandlerV1({
    gateway: communityGateway,
    allowedOrigins: input.allowedOrigins,
    serviceVersion: input.serviceVersion,
  })
  const operationsHandler = createCommercialOperationsFetchHandlerV1({
    gateway: operationsGateway,
    allowedOrigins: input.allowedOrigins,
    serviceVersion: input.serviceVersion,
  })
  const onlineHandler = createOnlineRoomFetchHandlerV1({
    gateway: onlineGateway,
    allowedOrigins: input.allowedOrigins,
    serviceVersion: input.serviceVersion,
  })
  const router = createProductPlatformServiceRouterV1({
    commercial: commercialHandler,
    community: communityHandler,
    online: onlineHandler,
    operations: operationsHandler,
    readiness: readinessNow,
    guard: input.productionRuntime
      ? { ...input.requestGuard, rateLimiter: input.productionRuntime.rateLimiter }
      : input.requestGuard,
    requestAuthority: input.productionRuntime?.requestAuthority,
  })
  return {
    fetch: router,
    get readiness() { return structuredClone(readiness) },
    readinessNow,
    commercial,
    community,
    operations,
    releaseDelivery,
    onlineRooms,
    realtime,
  }
}

function bootstrapJson(status: number, body: unknown, retryAfterMs?: number): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  if (retryAfterMs != null) headers.set('retry-after', String(Math.max(1, Math.ceil(retryAfterMs / 1_000))))
  return new Response(JSON.stringify(body), { status, headers })
}

/**
 * Synchronous deploy entrypoint around the async composition root. A transient
 * boot dependency outage no longer removes the health endpoint: initialization
 * is coalesced, failures are reduced to a non-sensitive 503, and a later
 * request retries after a bounded backoff. Once constructed, dynamic readiness
 * and lease checks remain owned by the hosted service itself.
 */
export function createHostedProductPlatformBootstrapV1(input: HostedProductPlatformServiceInputV1 & {
  bootstrapRetryBackoffMs?: number
}): HostedProductPlatformBootstrapV1 {
  const retryBackoffMs = input.bootstrapRetryBackoffMs ?? 5_000
  if (!Number.isInteger(retryBackoffMs) || retryBackoffMs < 100 || retryBackoffMs > 60_000) {
    throw new Error('[hosted-product-platform:configuration] bootstrapRetryBackoffMs 无效')
  }
  if (!input.serviceVersion.trim() || input.serviceVersion.length > 100 || /[\r\n]/.test(input.serviceVersion)) {
    throw new Error('[hosted-product-platform:configuration] serviceVersion 无效')
  }
  const now = input.now ?? (() => Date.now())
  let service: HostedProductPlatformServiceV1 | null = null
  let initializing: Promise<HostedProductPlatformServiceV1 | null> | null = null
  let lastFailureAt: number | null = null

  const ensure = async (): Promise<HostedProductPlatformServiceV1 | null> => {
    if (service) return service
    if (initializing) return initializing
    const observedAt = now()
    if (lastFailureAt != null && observedAt - lastFailureAt < retryBackoffMs) return null
    initializing = createHostedProductPlatformServiceV1(input)
      .then(created => {
        service = created
        lastFailureAt = null
        return created
      })
      .catch(() => {
        lastFailureAt = now()
        return null
      })
      .finally(() => { initializing = null })
    return initializing
  }

  return {
    async fetch(request: Request) {
      const resolved = await ensure()
      if (resolved) return resolved.fetch(request)
      const url = new URL(request.url)
      if (url.pathname === '/healthz/platform' && request.method.toUpperCase() !== 'GET') {
        return bootstrapJson(405, { code: 'method_not_allowed', message: '平台健康检查只支持 GET' })
      }
      if (url.pathname === '/healthz/platform') {
        return bootstrapJson(503, {
          ready: false,
          serviceVersion: input.serviceVersion,
          checks: { bootstrap: 'unhealthy' },
          checkedAt: now(),
        }, retryBackoffMs)
      }
      return bootstrapJson(503, {
        code: 'platform_bootstrap_unavailable',
        message: '平台托管服务正在等待生产依赖',
      }, retryBackoffMs)
    },
    current: () => service,
  }
}
