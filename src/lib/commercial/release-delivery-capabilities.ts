import type {
  ProductPlatformProductionDependencyAdapterV1,
  ProductPlatformProductionProbeResultV1,
} from '../product-platform/production-runtime'
import type { CommercialReleaseDeliveryPersistenceV1 } from './release-delivery'

export const COMMERCIAL_RELEASE_DELIVERY_CAPABILITIES_V1 = [
  'delivery-record-v1',
  'delivery-head-v1',
  'text-adventure-review-v1',
  'text-adventure-review-attestation-v1',
  'upload-request-idempotency-v1',
] as const

export type CommercialReleaseDeliveryCapabilityV1 =
  typeof COMMERCIAL_RELEASE_DELIVERY_CAPABILITIES_V1[number]

export interface CommercialReleaseDeliveryCapabilityContractV1 {
  schema: 'storyforge.commercial-release-delivery-capabilities'
  version: 1
  storageSchemaVersion: 1
  capabilities: CommercialReleaseDeliveryCapabilityV1[]
}

export type CommercialReleaseDeliveryProductionAdapterV1 =
  CommercialReleaseDeliveryPersistenceV1
  & ProductPlatformProductionDependencyAdapterV1<'object-storage'>
  & {
    /** Must actively verify the bound external store, not return static configuration. */
    probeReleaseDeliveryCapabilities(input: {
      signal: AbortSignal
    }): Promise<unknown>
  }

function exactRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value)
  const expected = ['schema', 'version', 'storageSchemaVersion', 'capabilities']
  return keys.length === expected.length && keys.every(key => expected.includes(key))
    ? value as Record<string, unknown>
    : null
}

export function parseCommercialReleaseDeliveryCapabilityContractV1(
  value: unknown,
): CommercialReleaseDeliveryCapabilityContractV1 | null {
  const row = exactRecord(value)
  if (!row || row.schema !== 'storyforge.commercial-release-delivery-capabilities'
    || row.version !== 1 || row.storageSchemaVersion !== 1
    || !Array.isArray(row.capabilities)
    || row.capabilities.length !== COMMERCIAL_RELEASE_DELIVERY_CAPABILITIES_V1.length
    || row.capabilities.some((item, index) => item !== COMMERCIAL_RELEASE_DELIVERY_CAPABILITIES_V1[index])) {
    return null
  }
  return {
    schema: 'storyforge.commercial-release-delivery-capabilities', version: 1,
    storageSchemaVersion: 1,
    capabilities: [...COMMERCIAL_RELEASE_DELIVERY_CAPABILITIES_V1],
  }
}

/** Adds the versioned release-store contract to the generic production readiness probe. */
export function createCommercialReleaseDeliveryReadinessAdapterV1(
  adapter: CommercialReleaseDeliveryProductionAdapterV1,
): ProductPlatformProductionDependencyAdapterV1<'object-storage'> {
  return {
    dependency: adapter.dependency,
    adapterId: adapter.adapterId,
    deployment: adapter.deployment,
    async probe(input): Promise<ProductPlatformProductionProbeResultV1> {
      const base = await adapter.probe(input)
      if (!base.ok) return base
      try {
        const contract = await adapter.probeReleaseDeliveryCapabilities(input)
        return parseCommercialReleaseDeliveryCapabilityContractV1(contract)
          ? { ok: true, code: 'ok' }
          : { ok: false, code: 'release-store-capability-mismatch' }
      } catch {
        return { ok: false, code: 'release-store-capability-probe-failed' }
      }
    },
  }
}
