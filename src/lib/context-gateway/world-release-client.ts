import type {
  ContextResourceDescriptorV1,
  FrozenResourceScopeV1,
  WorldCapabilityArea,
} from '../registry/types'
import {
  assertWorldReleaseIdentityCurrentV1,
  listAllWorldReleaseResourceDescriptorsV1,
  openWorldReleaseV1,
  readWorldResourceV1,
  type OpenWorldReleaseV1,
  worldReleaseIdentityTransactionTablesV1,
} from './world-release-provider'

const MAX_RESOURCE_READ_TOKENS = 100_000

export interface WorldSemanticResourceSnapshotV1 {
  descriptor: ContextResourceDescriptorV1 & {
    worldSemantic: NonNullable<ContextResourceDescriptorV1['worldSemantic']>
  }
  /** Canonical semantic row returned by the provider, never a table envelope. */
  value: Record<string, unknown>
}

export interface WorldSemanticResourceCatalogV1 extends OpenWorldReleaseV1 {
  resources: ContextResourceDescriptorV1[]
}

function hasWorldSemantic(
  descriptor: ContextResourceDescriptorV1,
): descriptor is ContextResourceDescriptorV1 & {
  worldSemantic: NonNullable<ContextResourceDescriptorV1['worldSemantic']>
} {
  return descriptor.sourceKey === 'worldRelease' && descriptor.worldSemantic != null
}

/** Neutral, transaction-safe compare-and-swap. No physical WorldRelease row
 * or manifest crosses this client boundary. */
export async function assertWorldSemanticReleaseCurrentV1(input: {
  localReleaseRecordId: number
  expectedProjectId: number
  expectedWorldId?: number
  expectedReleaseHash: string
}): Promise<void> {
  await assertWorldReleaseIdentityCurrentV1(input)
}

/** Opaque transaction capability for the identity CAS above. */
export function worldSemanticReleaseTransactionTablesV1() {
  return worldReleaseIdentityTransactionTablesV1()
}

/** Neutral descriptor boundary for product requirement resolution. Physical
 * WorldRelease decoding remains private to the provider behind this client. */
export async function listWorldSemanticResourceDescriptorsV1(
  scope: FrozenResourceScopeV1,
): Promise<Array<ContextResourceDescriptorV1 & {
  worldSemantic: NonNullable<ContextResourceDescriptorV1['worldSemantic']>
}>> {
  return (await listAllWorldReleaseResourceDescriptorsV1(scope))
    .filter(hasWorldSemantic)
    .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey))
}

/** Resolve one immutable resource descriptor without exposing provider APIs to
 * an upper product. */
export async function describeWorldSemanticResourceV1(input: {
  scope: FrozenResourceScopeV1
  resourceKey: string
}): Promise<ContextResourceDescriptorV1 & {
  worldSemantic: NonNullable<ContextResourceDescriptorV1['worldSemantic']>
}> {
  const read = await readWorldResourceV1({
    scope: input.scope,
    resourceKey: input.resourceKey,
    depth: 'index',
    maxTokens: 1,
  })
  if (!hasWorldSemantic(read.descriptor)) {
    throw new Error(`[world-release-client] 资源不是世界语义资源:${input.resourceKey}`)
  }
  return read.descriptor
}

function parseSemanticValue(content: string, resourceKey: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(content) }
  catch { throw new Error(`[world-release-client] 世界资源不是完整 JSON:${resourceKey}`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[world-release-client] 世界资源不是语义对象:${resourceKey}`)
  }
  return value as Record<string, unknown>
}

export async function openWorldSemanticResourceCatalogV1(input: {
  localReleaseRecordId: number
  expectedProjectId: number
  expectedWorldId?: number
  areas?: WorldCapabilityArea[]
  resourceKinds?: string[]
}): Promise<WorldSemanticResourceCatalogV1> {
  const opened = await openWorldReleaseV1(input)
  const areaFilter = new Set(input.areas ?? [])
  const kindFilter = new Set(input.resourceKinds ?? [])
  const resources = (await listWorldSemanticResourceDescriptorsV1(opened.scope))
    .filter(descriptor => areaFilter.size === 0 || areaFilter.has(descriptor.worldSemantic.area))
    .filter(descriptor => kindFilter.size === 0 || kindFilter.has(descriptor.worldSemantic.resourceKind))
    .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey))
  return { ...opened, resources }
}

export async function readWorldSemanticResourceV1(input: {
  scope: FrozenResourceScopeV1
  descriptor: ContextResourceDescriptorV1
}): Promise<WorldSemanticResourceSnapshotV1> {
  if (!hasWorldSemantic(input.descriptor)) {
    throw new Error('[world-release-client] descriptor 不是世界语义资源')
  }
  const requiredTokens = Math.max(1, input.descriptor.tokenEstimate.full ?? 1)
  if (requiredTokens > MAX_RESOURCE_READ_TOKENS) {
    throw new Error(`[world-release-client] 世界资源超过单资源显式读取预算:${input.descriptor.resourceKey}`)
  }
  const read = await readWorldResourceV1({
    scope: input.scope,
    resourceKey: input.descriptor.resourceKey,
    depth: 'full',
    maxTokens: requiredTokens,
  })
  if (read.descriptor.contentHash !== input.descriptor.contentHash) {
    throw new Error(`[world-release-client] 世界资源在读取期间发生漂移:${input.descriptor.resourceKey}`)
  }
  return {
    descriptor: structuredClone(input.descriptor),
    value: parseSemanticValue(read.content, input.descriptor.resourceKey),
  }
}

export async function readWorldSemanticResourcesV1(input: {
  scope: FrozenResourceScopeV1
  descriptors: ContextResourceDescriptorV1[]
  maximumResources?: number
}): Promise<WorldSemanticResourceSnapshotV1[]> {
  const maximum = input.maximumResources ?? 20_000
  if (!Number.isSafeInteger(maximum) || maximum < 1 || input.descriptors.length > maximum) {
    throw new Error('[world-release-client] 世界资源批量读取数量超限')
  }
  const results = new Array<WorldSemanticResourceSnapshotV1>(input.descriptors.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(8, input.descriptors.length) }, async () => {
    while (nextIndex < input.descriptors.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await readWorldSemanticResourceV1({
        scope: input.scope,
        descriptor: input.descriptors[index]!,
      })
    }
  })
  await Promise.all(workers)
  return results
}

/** Paginated author-facing browsing uses the same neutral frozen protocol as
 * product readers. It never exposes a physical release manifest. */
export { openWorldReleaseV1, searchWorldReleaseV1, readWorldResourceV1, readWorldOriginalEvidenceV1, type OpenWorldReleaseV1 } from './world-release-provider'
export { WORLD_RELEASE_RESOURCE_KINDS_V1 } from './world-release-provider-contract'
