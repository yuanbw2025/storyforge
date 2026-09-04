/**
 * Headless StoryForge platform boundary.
 *
 * This module is intentionally not imported by the browser application. It is
 * the public entrypoint for trusted server adapters, deployment workers,
 * external creator tooling and deterministic evaluation harnesses. Keeping the
 * boundary separate prevents payment webhooks, authoritative rooms and server
 * credentials from being bundled into the pure-frontend product.
 */
import * as capabilityStatus from './capability-status'
import * as distributionBundle from './distribution-bundle'
import * as deploymentConformance from './deployment-conformance'
import * as commercialAuthority from '../commercial/authority'
import * as commercialFetchService from '../commercial/fetch-service'
import * as commercialGateway from '../commercial/gateway'
import * as commercialHttpClient from '../commercial/http-client'
import * as commercialOperationsAuthority from '../commercial/operations-authority'
import * as commercialOperationsGateway from '../commercial/operations-gateway'
import * as commercialOperationsFetchService from '../commercial/operations-fetch-service'
import * as commercialReleaseDeliveryGateway from '../commercial/release-delivery-gateway'
import * as commercialReleaseDelivery from '../commercial/release-delivery'
import * as commercialSettlementCoordinator from '../commercial/settlement-coordinator'
import * as commercialWebhook from '../commercial/webhook'
import * as communityAuthority from '../community/authority'
import * as communityCollaborationAuthority from '../community/collaboration-authority'
import * as communityCommercialReleasePolicy from '../community/commercial-release-policy'
import * as communityFetchService from '../community/fetch-service'
import * as communityGateway from '../community/gateway'
import * as communityHttpClient from '../community/http-client'
import * as onlineFetchService from '../online/fetch-service'
import * as onlineRealtimeHub from '../online/realtime-hub'
import * as onlineRoomGateway from '../online/room-gateway'
import * as onlineTransactionalPersistence from '../online/transactional-persistence'
import * as onlineTtrpgBrowserAdapter from '../online/ttrpg-browser-adapter'
import * as onlineTtrpgDurableAdapter from '../online/ttrpg-durable-adapter'
import * as onlineTtrpgRoomRegistry from '../online/ttrpg-room-registry'
import * as ttrpgCreatorSdk from '../ttrpg/creator-sdk'
import * as ttrpgGmEval from '../ttrpg/gm-eval'
import * as serviceRouter from './service-router'
import * as productionRuntime from './production-runtime'
import * as hostedService from './hosted-service'
import * as transactionalSnapshotPersistence from './transactional-snapshot-persistence'

export {
  capabilityStatus,
  distributionBundle,
  deploymentConformance,
  commercialAuthority,
  commercialFetchService,
  commercialGateway,
  commercialHttpClient,
  commercialOperationsAuthority,
  commercialOperationsGateway,
  commercialOperationsFetchService,
  commercialReleaseDeliveryGateway,
  commercialReleaseDelivery,
  commercialSettlementCoordinator,
  commercialWebhook,
  communityAuthority,
  communityCollaborationAuthority,
  communityCommercialReleasePolicy,
  communityFetchService,
  communityGateway,
  communityHttpClient,
  onlineFetchService,
  onlineRealtimeHub,
  onlineRoomGateway,
  onlineTransactionalPersistence,
  onlineTtrpgBrowserAdapter,
  onlineTtrpgDurableAdapter,
  onlineTtrpgRoomRegistry,
  ttrpgCreatorSdk,
  ttrpgGmEval,
  serviceRouter,
  productionRuntime,
  hostedService,
  transactionalSnapshotPersistence,
}
