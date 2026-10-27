import { lookupContextResourceMetadataV1 } from './resource-metadata'
import type {
  ContextResourceDescriptorV1,
  FrozenResourceScopeV1,
  WorldCapabilityArea,
} from '../registry/types'
import {
  assertWorldReleaseIdentityCurrentV1,
  WORLD_RELEASE_RESOURCE_PROVIDER_V1,
  listAllWorldReleaseResourceDescriptorsV1,
  openWorldReleaseV1,
  readWorldResourceV1,
  type OpenWorldReleaseV1,
  worldReleaseIdentityTransactionTablesV1,
} from './world-release-provider'
import type { ProductSourcePlan, WorldReferenceV1 } from '../types/world-product-contracts'
import type { WorldQueryAccessV1, WorldReferenceV2 } from '../types/world-query'
import { createWorldReference, resolveWorldReferenceResourceScope } from '../world-engine/world-reference-v2'
import { openProductPreparationWorldQueryV1, openProductPlanWorldQueryV1, bindWorldQueryResourcesV1,
  describeWorldQueryAccessV1, closeWorldQueryAccessV1 } from './world-query-client'

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

/** Neutral release metadata only; avoids projecting every semantic row for a scope identity check. */
export function describeWorldSemanticReleaseV1(input: {
  localReleaseRecordId: number; expectedProjectId: number; expectedWorldId?: number
}): Promise<OpenWorldReleaseV1> {
  return openWorldReleaseV1(input)
}

export interface WorldProductResourceCatalogV2 {
  description: Pick<OpenWorldReleaseV1['description'], 'identity' | 'sourceManifestHash'> & {
    worldReference: WorldReferenceV1 | WorldReferenceV2
  }
  scope: OpenWorldReleaseV1['scope']
  resources: ContextResourceDescriptorV1[]
  worldQueryAccess?: WorldQueryAccessV1
}

/** Same registered provider, explicit version and product dispatch. S2 gets
 * only a preparation catalog; formal reads require the frozen exact plan. */
export async function openProductWorldResourceCatalogV2(input: {
  localReleaseRecordId: number; expectedProjectId: number; expectedWorldId?: number
  productType: string; sourcePlan?: ProductSourcePlan
}): Promise<WorldProductResourceCatalogV2> {
  const reference = input.sourcePlan?.worldReference ?? await createWorldReference(input.localReleaseRecordId)
  if (reference.localReleaseRecordId !== input.localReleaseRecordId) throw new Error('[world-release-client] 计划 locator 不一致')
  if (reference.version === 1) return openWorldSemanticResourceCatalogV1(input)
  if (input.productType !== 'character-interaction' && input.productType !== 'avg') throw new Error('[world-release-client] 此产品尚未登记 v4 来源编译器')
  const scope = await resolveWorldReferenceResourceScope(reference)
  if (scope.projectId !== input.expectedProjectId || scope.worldId === undefined
    || (input.expectedWorldId !== undefined && scope.worldId !== input.expectedWorldId)) throw new Error('[world-release-client] 世界来源越过产品 owner')
  const access = input.sourcePlan?.version === 2
    ? await openProductPlanWorldQueryV1({ scope: { ...scope, worldId: scope.worldId }, sourcePlan: input.sourcePlan })
    : await openProductPreparationWorldQueryV1({ scope: { ...scope, worldId: scope.worldId },
      localReleaseRecordId: reference.localReleaseRecordId, productType: input.productType })
  try {
    const provider = await bindWorldQueryResourcesV1(access), resources: ContextResourceDescriptorV1[] = []
    let cursor: string | undefined
    const cursors = new Set<string>()
    do {
      const page = await provider.listMetadata({ scope: access.scope, limit: 100, cursor })
      resources.push(...page.items)
      if (resources.length > 20000 || (page.nextCursor && cursors.has(page.nextCursor))) throw new Error('[world-release-client] 目录超限或游标未前进')
      cursor = page.nextCursor ?? undefined
      if (cursor) cursors.add(cursor)
    } while (cursor)
    return { description: { ...await describeWorldQueryAccessV1(access), worldReference: access.reference },
      scope: { ...access.scope, worldId: scope.worldId, worldReleaseId: reference.localReleaseRecordId, worldReleaseHash: reference.releaseHash },
      resources: resources.sort((a, b) => a.resourceKey.localeCompare(b.resourceKey)), worldQueryAccess: access }
  } catch (error) { await closeWorldQueryAccessV1(access); throw error }
}

export async function closeProductWorldResourceCatalogV2(catalog: WorldProductResourceCatalogV2): Promise<void> {
  if (catalog.worldQueryAccess) await closeWorldQueryAccessV1(catalog.worldQueryAccess)
}

export async function readProductWorldResourcesV2(input: {
  catalog: WorldProductResourceCatalogV2; descriptors: ContextResourceDescriptorV1[]
}): Promise<WorldSemanticResourceSnapshotV1[]> {
  if (!input.catalog.worldQueryAccess) return readWorldSemanticResourcesV1({ scope: input.catalog.scope, descriptors: input.descriptors })
  const provider = await bindWorldQueryResourcesV1(input.catalog.worldQueryAccess)
  const resources: WorldSemanticResourceSnapshotV1[] = []
  for (const descriptor of input.descriptors) {
    if (!hasWorldSemantic(descriptor)) throw new Error('[world-release-client] 不是世界语义资源')
    const read = await provider.read({ scope: input.catalog.scope, resourceKey: descriptor.resourceKey, depth: 'full', maxTokens: MAX_RESOURCE_READ_TOKENS })
    if (read.descriptor.contentHash !== descriptor.contentHash) throw new Error('[world-release-client] 读取内容身份已变化')
    resources.push({ descriptor: structuredClone(descriptor), value: parseSemanticValue(read.content, descriptor.resourceKey) })
  }
  return resources
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
  const descriptor = (await lookupContextResourceMetadataV1({
    provider: WORLD_RELEASE_RESOURCE_PROVIDER_V1,
    scope: input.scope,
    resourceKeys: [input.resourceKey],
  })).get(input.resourceKey)
  if (!descriptor || !hasWorldSemantic(descriptor)) {
    throw new Error(`[world-release-client] 世界语义资源不可用:${input.resourceKey}`)
  }
  return descriptor
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
export { openWorldReleaseV1, openWorldReleaseAuthorBrowserV1, listWorldReleaseV1, searchWorldReleaseV1, readWorldResourceV1, readWorldOriginalEvidenceV1, type OpenWorldReleaseV1 } from './world-release-provider'
export { openAuthorWorldQueryAccessV1, bindWorldQueryResourcesV1, queryWorldReleaseV1, closeWorldQueryAccessV1, authorWorldQueryV1 } from './world-query-client'
export { WORLD_RELEASE_RESOURCE_KINDS_V1 } from './world-release-provider-contract'
