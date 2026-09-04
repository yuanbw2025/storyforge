import Dexie, { type ObservabilitySet } from 'dexie'
import { canonicalStringify } from '../agent/run/hash'
import { STORYFORGE_DATABASE_NAME } from '../db/schema'
import type {
  ContextResourceDescriptorV1,
  ContextResourceProviderV1,
  ContextResourceReadV1,
  OriginalEvidenceReadV1,
  ResourcePageV1,
} from '../registry/types'

const STORYFORGE_STORAGE_PREFIX = `idb://${STORYFORGE_DATABASE_NAME}/`
const DEFAULT_MAX_ENTRIES = 512

type CacheValue = ResourcePageV1 | ContextResourceReadV1 | OriginalEvidenceReadV1

interface ProviderCacheStateV1 {
  providerId: string
  entries: Map<string, CacheValue>
  locators: Map<string, string>
  hits: number
  misses: number
  bypasses: number
  invalidations: number
}

export interface ContextGatewayCacheDiagnosticsV1 {
  version: 1
  epoch: number
  reliable: boolean
  reason: string | null
  providers: Array<{
    providerId: string
    entries: number
    locators: number
    hits: number
    misses: number
    bypasses: number
    invalidations: number
  }>
}

let cacheEpoch = 0
let cacheReliable = true
let unreliableReason: string | null = null
const states = new Set<ProviderCacheStateV1>()

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function clearState(state: ProviderCacheStateV1): void {
  state.entries.clear()
  state.locators.clear()
  state.invalidations += 1
}

/**
 * Cache entries are never authoritative. A single uncertain invalidation
 * boundary disables every hit until an explicit recovery after a live read.
 */
export function markContextGatewayCacheUncertainV1(reason: string): void {
  cacheReliable = false
  unreliableReason = reason || 'unknown-cache-invalidation-state'
  cacheEpoch += 1
  for (const state of states) clearState(state)
}

export function restoreContextGatewayCacheReliabilityV1(): void {
  cacheEpoch += 1
  cacheReliable = true
  unreliableReason = null
  for (const state of states) clearState(state)
}

export function invalidateContextGatewayCacheV1(_reason = 'explicit-invalidation'): void {
  cacheEpoch += 1
  for (const state of states) clearState(state)
}

/** Used only to invalidate in-flight catalog cursors; it is not a Canon revision. */
export function contextGatewayCacheEpochV1(): number {
  return cacheEpoch
}

function onStorageMutated(parts: ObservabilitySet): void {
  try {
    if (Object.keys(parts).some(part => part.startsWith(STORYFORGE_STORAGE_PREFIX))) {
      invalidateContextGatewayCacheV1('dexie-storagemutated')
    }
  } catch (error) {
    markContextGatewayCacheUncertainV1(error instanceof Error ? error.message : 'storagemutated-handler-failed')
  }
}

// Dexie propagates this event after local commits and across tabs. Broad
// invalidation is deliberate: correctness wins over retaining a cheap entry.
Dexie.on.storagemutated.subscribe(onStorageMutated)

function descriptorIdentity(descriptor: ContextResourceDescriptorV1): string {
  return [
    descriptor.resourceKey,
    String(descriptor.contentRevision),
    descriptor.contentHash,
    String(descriptor.policyRevision),
    descriptor.policyHash,
  ].join(':')
}

function valueIdentity(value: CacheValue): string {
  if ('items' in value) {
    return value.items.map(descriptorIdentity).join('|') || 'empty-page'
  }
  return `${descriptorIdentity(value.descriptor)}:${value.contentHash}`
}

function scopeIdentity(input: { scope: unknown }): string {
  return canonicalStringify(input.scope)
}

function requestIdentity(provider: ContextResourceProviderV1, operation: string, input: unknown): string {
  return canonicalStringify({
    version: 1,
    providerId: provider.providerId,
    providerVersion: provider.providerVersion,
    normalizationVersion: provider.normalizationVersion,
    operation,
    input,
  })
}

function trimIfNeeded(state: ProviderCacheStateV1, maxEntries: number): void {
  if (state.entries.size < maxEntries) return
  // The cache is a disposable projection. Clearing is deterministic and avoids
  // a second LRU state machine that could itself become an authority bug.
  state.entries.clear()
  state.locators.clear()
}

async function cached<T extends CacheValue>(input: {
  state: ProviderCacheStateV1
  provider: ContextResourceProviderV1
  operation: string
  request: { scope: unknown }
  maxEntries: number
  load: () => Promise<T>
}): Promise<T> {
  if (!cacheReliable) {
    input.state.bypasses += 1
    return input.load()
  }
  const startedEpoch = cacheEpoch
  const locator = `${startedEpoch}:${scopeIdentity(input.request)}:${requestIdentity(input.provider, input.operation, input.request)}`
  const entryKey = input.state.locators.get(locator)
  if (entryKey) {
    const value = input.state.entries.get(entryKey)
    if (value) {
      try {
        input.state.hits += 1
        return clone(value) as T
      } catch (error) {
        markContextGatewayCacheUncertainV1(error instanceof Error ? error.message : 'cache-clone-failed')
        input.state.bypasses += 1
        return input.load()
      }
    }
    // A dangling locator means the disposable cache is internally inconsistent.
    markContextGatewayCacheUncertainV1('dangling-cache-locator')
    input.state.bypasses += 1
    return input.load()
  }

  input.state.misses += 1
  const value = await input.load()
  if (!cacheReliable || startedEpoch !== cacheEpoch) return value
  trimIfNeeded(input.state, input.maxEntries)
  const versionedKey = `${locator}:${valueIdentity(value)}`
  try {
    input.state.entries.set(versionedKey, clone(value))
    input.state.locators.set(locator, versionedKey)
  } catch (error) {
    markContextGatewayCacheUncertainV1(error instanceof Error ? error.message : 'cache-store-failed')
  }
  return value
}

/** Transparent V1 wrapper. Callers remain coupled only to the provider contract. */
export function createCachedContextResourceProviderV1(
  provider: ContextResourceProviderV1,
  options: { maxEntries?: number } = {},
): ContextResourceProviderV1 {
  const maxEntries = Math.max(16, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES))
  const state: ProviderCacheStateV1 = {
    providerId: provider.providerId,
    entries: new Map(),
    locators: new Map(),
    hits: 0,
    misses: 0,
    bypasses: 0,
    invalidations: 0,
  }
  states.add(state)
  return {
    version: provider.version,
    providerId: provider.providerId,
    providerVersion: provider.providerVersion,
    normalizationVersion: provider.normalizationVersion,
    kinds: provider.kinds,
    listMetadata: request => cached({
      state, provider, operation: 'listMetadata', request, maxEntries,
      load: () => provider.listMetadata(request),
    }),
    searchMetadata: request => cached({
      state, provider, operation: 'searchMetadata', request, maxEntries,
      load: () => provider.searchMetadata(request),
    }),
    read: request => cached({
      state, provider, operation: 'read', request, maxEntries,
      load: () => provider.read(request),
    }),
    readOriginal: request => cached({
      state, provider, operation: 'readOriginal', request, maxEntries,
      load: () => provider.readOriginal(request),
    }),
    // Scope fingerprints are session authority, not a cache data version.
    fingerprint: scope => provider.fingerprint(scope),
  }
}

export function contextGatewayCacheDiagnosticsV1(): ContextGatewayCacheDiagnosticsV1 {
  return {
    version: 1,
    epoch: cacheEpoch,
    reliable: cacheReliable,
    reason: unreliableReason,
    providers: [...states].map(state => ({
      providerId: state.providerId,
      entries: state.entries.size,
      locators: state.locators.size,
      hits: state.hits,
      misses: state.misses,
      bypasses: state.bypasses,
      invalidations: state.invalidations,
    })).sort((left, right) => left.providerId.localeCompare(right.providerId)),
  }
}
