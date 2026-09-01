import { estimateTokens } from '../ai/context-budget'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import type {
  ContextResourceDescriptorV1,
  ContextResourceKind,
  ContextResourceProviderV1,
  ContextResourceReadV1,
  ContextSourceRefV1,
  FrozenResourceScopeV1,
  OriginalEvidenceReadInputV1,
  OriginalEvidenceReadV1,
  ResourceListInputV1,
  ResourcePageV1,
  ResourceReadInputV1,
  ResourceSearchInputV1,
  WorldCapabilityArea,
} from '../registry/types'
import type { WorldRelease } from '../types'
import {
  type PureWorldReleaseManifestV3,
  verifyPureWorldReleaseRecordV3,
} from '../world-engine/release-codec'
import { createWorldReferenceV1, ensureWorldReleaseUidV1 } from '../world-engine/world-reference'
import {
  WORLD_RELEASE_NORMALIZATION_VERSION_V1,
  WORLD_RELEASE_PROVIDER_ID_V1,
  WORLD_RELEASE_PROVIDER_VERSION_V1,
  WORLD_RELEASE_RESOURCE_KINDS_V1,
} from './world-release-provider-contract'

export { WORLD_RELEASE_RESOURCE_KINDS_V1 } from './world-release-provider-contract'

const SOURCE_KEY = 'worldRelease'
const PROVIDER_VERSION = WORLD_RELEASE_PROVIDER_VERSION_V1
const NORMALIZATION_VERSION = WORLD_RELEASE_NORMALIZATION_VERSION_V1
const HASH = /^[a-f0-9]{64}$/
const MAX_PAGE = 100
const MAX_READ_TOKENS = 100_000
// A release may contain a novel-sized semantic corpus. Keep only a very small
// hot set and never cache a second copy of row payloads/projections.
const RELEASE_CACHE_LIMIT = 3

const validatedReleaseCache = new Map<number, LoadedReleaseV1>()
const projectedReleaseCache = new Map<string, Promise<ProjectedReleaseResourceV1[]>>()

function rememberBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > RELEASE_CACHE_LIMIT) map.delete(map.keys().next().value!)
}

interface LoadedReleaseV1 {
  release: WorldRelease & { id: number }
  releaseUid: string
  manifest: PureWorldReleaseManifestV3
  fingerprint: string
}

interface ProjectedReleaseResourceV1 {
  descriptor: ContextResourceDescriptorV1
  table: string
  coordinate: string
  rowIndex: number
}

interface CursorV1 {
  version: 1
  offset: number
  requestHash: string
  fingerprint: string
}

export interface WorldReleaseDescriptionV1 {
  schema: 'storyforge.world-release-description'
  version: 1
  worldReference: Awaited<ReturnType<typeof createWorldReferenceV1>>
  sourceManifestHash: string
  identity: {
    worldCode: string
    worldName: string
    workTitle: string
    releaseVersion: number
    releaseLabel: string
    releaseHash: string
    releasedAt: number
  }
  capabilities: PureWorldReleaseManifestV3['capabilityProfile']
  resources: Array<{
    resourceId: string
    area: WorldCapabilityArea
    resourceKind: string
    rowCount: number
    contentHash: string
  }>
  scopeFingerprint: string
}

export interface OpenWorldReleaseV1 {
  description: WorldReleaseDescriptionV1
  scope: FrozenResourceScopeV1 & {
    worldId: number
    worldReleaseId: number
    worldReleaseHash: string
  }
}

export class WorldReleaseResourceProviderErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[world-release-provider:${code}] ${message}`)
    this.name = 'WorldReleaseResourceProviderErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new WorldReleaseResourceProviderErrorV1(code, message)
}

function assertScope(scope: FrozenResourceScopeV1): { releaseId: number; releaseHash: string } {
  if (!Number.isSafeInteger(scope.worldReleaseId) || Number(scope.worldReleaseId) < 1) {
    fail('scope', '冻结 scope 缺少 worldReleaseId')
  }
  if (typeof scope.worldReleaseHash !== 'string' || !HASH.test(scope.worldReleaseHash)) {
    fail('scope', '冻结 scope 缺少合法 worldReleaseHash')
  }
  return { releaseId: Number(scope.worldReleaseId), releaseHash: scope.worldReleaseHash }
}

async function load(scope: FrozenResourceScopeV1): Promise<LoadedReleaseV1> {
  const frozen = assertScope(scope)
  const release = await db.worldReleases.get(frozen.releaseId)
  if (!release?.id || release.contentHash !== frozen.releaseHash) {
    fail('reference', 'WorldRelease 本地 ID 与冻结 hash 不同时匹配')
  }
  if (scope.projectId !== release.projectId || (scope.worldId != null && scope.worldId !== release.worldId)) {
    fail('scope', 'WorldRelease 不属于冻结来源 scope')
  }
  const cached = validatedReleaseCache.get(frozen.releaseId)
  if (cached
    && cached.release.projectId === release.projectId
    && cached.release.worldId === release.worldId
    && cached.release.sourceWorldCode === release.sourceWorldCode
    && cached.release.version === release.version
    && cached.release.manifestJson === release.manifestJson
    && cached.release.contentHash === release.contentHash
    && (release.releaseUid == null || cached.releaseUid === release.releaseUid)) {
    rememberBounded(validatedReleaseCache, frozen.releaseId, cached)
    return cached
  }
  const manifest = await verifyPureWorldReleaseRecordV3(release as WorldRelease & { id: number })
  const releaseUid = await ensureWorldReleaseUidV1(release as WorldRelease & { id: number })
  const loaded: LoadedReleaseV1 = {
    release: { ...release, releaseUid } as WorldRelease & { id: number },
    releaseUid,
    manifest,
    fingerprint: await hashCanonicalValue({
      provider: PROVIDER_VERSION,
      releaseUid,
      releaseHash: release.contentHash,
      localScope: {
        projectId: release.projectId,
        worldId: release.worldId,
        worldReleaseId: release.id,
      },
    }),
  }
  rememberBounded(validatedReleaseCache, release.id, loaded)
  return loaded
}

function contextKind(area: WorldCapabilityArea, resourceKind: string): ContextResourceKind {
  if (resourceKind === 'character' || resourceKind === 'work-character-binding') return 'character'
  if (resourceKind === 'character-relation' || resourceKind === 'knowledge-event') return 'character-relation'
  if (resourceKind === 'story-arc') return 'story-arc'
  if (resourceKind === 'storyline-progress' || resourceKind === 'storyline-crossing') return 'storyline-progress'
  if (resourceKind === 'outline-node') return 'outline-node'
  if (resourceKind === 'detailed-outline') return 'detailed-outline'
  if (resourceKind === 'chapter') return 'chapter'
  if (resourceKind === 'foreshadow') return 'foreshadow'
  if (resourceKind === 'location' || resourceKind === 'world-node') return 'location'
  if (resourceKind === 'codex-entry' || resourceKind === 'codex-category' || area === 'entities') return 'codex-entry'
  if (resourceKind === 'world-link') return 'world-link'
  if (area === 'story') return 'story-core-field'
  if (area === 'multi-world') return 'world'
  return area === 'foundation' ? 'worldview-field' : 'fact'
}

function coordinate(row: unknown, index: number): string {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const value = (row as Record<string, unknown>)._exportId
      ?? (row as Record<string, unknown>).stableKey
      ?? (row as Record<string, unknown>).key
      ?? (row as Record<string, unknown>).code
    if (typeof value === 'string' || typeof value === 'number') return String(value)
  }
  return String(index)
}

function titleFor(row: unknown, resourceKind: string, index: number): string {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const record = row as Record<string, unknown>
    const value = [record.name, record.title, record.label, record.theme, record.role, record.summary]
      .find(item => typeof item === 'string' && item.trim())
    if (typeof value === 'string') return value.trim().slice(0, 300)
  }
  return `${resourceKind} ${index + 1}`
}

function summaryFor(row: unknown): string {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return String(row ?? '').slice(0, 800)
  const record = row as Record<string, unknown>
  const values = [
    record.summary, record.description, record.shortDescription, record.overview,
    record.centralConflict, record.outcome, record.significance, record.globalNote,
  ].filter(item => typeof item === 'string' && item.trim()) as string[]
  return values.join('；').slice(0, 800)
}

function focusedFor(row: unknown): string {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return canonicalStringify(row)
  return canonicalStringify(Object.fromEntries(Object.entries(row as Record<string, unknown>)
    .filter(([key, value]) => !key.startsWith('_') && key !== 'id'
      && !key.endsWith('Id') && !key.endsWith('Ids')
      && value != null && value !== '' && value !== '[]' && value !== '{}')))
}

function addRelation(
  source: ContextResourceDescriptorV1,
  targetResourceKey: string,
  direction: 'outgoing' | 'incoming',
  kind: ContextResourceDescriptorV1['relations'][number]['kind'],
): void {
  if (source.relations.some(item => item.kind === kind
    && item.targetResourceKey === targetResourceKey && item.direction === direction)) return
  source.relations.push({ kind, targetResourceKey, direction })
}

async function mapWithConcurrencyV1<T, R>(
  values: readonly T[],
  concurrency: number,
  project: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await project(values[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}

async function buildProjections(loaded: LoadedReleaseV1): Promise<ProjectedReleaseResourceV1[]> {
  const catalogs = [...loaded.manifest.resourceCatalog]
    .sort((left, right) => left.area.localeCompare(right.area) || left.resourceKind.localeCompare(right.resourceKind))
  const grouped = await Promise.all(catalogs.map(async catalog => {
    const rows = loaded.manifest.records[catalog.table] ?? []
    const coordinates = rows.map((row, index) => coordinate(row, index))
    if (new Set(coordinates).size !== coordinates.length) {
      fail('resource-coordinate', `WorldRelease 资源坐标重复:${catalog.resourceId}`)
    }
    const policyHash = await hashCanonicalValue({
      provider: PROVIDER_VERSION,
      normalization: NORMALIZATION_VERSION,
      area: catalog.area,
      resourceKind: catalog.resourceKind,
    })
    return mapWithConcurrencyV1(rows, 32, async (row, index) => {
      const original = canonicalStringify(row)
      const rowHash = await sha256Text(original)
      const coord = coordinate(row, index)
      const coordinateHash = await hashCanonicalValue({ resourceId: catalog.resourceId, coordinate: coord })
      const resourceKey = `world-release:${loaded.release.contentHash}:${catalog.area}:${catalog.resourceKind}:${coordinateHash}`
      const title = titleFor(row, catalog.resourceKind, index)
      const summary = summaryFor(row)
      const focused = focusedFor(row)
      const kind = contextKind(catalog.area, catalog.resourceKind)
      const indexTokens = estimateTokens(`${title}\n${summary}`)
      const summaryTokens = estimateTokens(summary)
      const focusedTokens = estimateTokens(focused)
      const originalTokens = estimateTokens(original)
      const sourceRef: ContextSourceRefV1 = {
        table: 'worldReleases',
        recordId: loaded.release.id,
        field: `records.${catalog.resourceKind}.${encodeURIComponent(coord)}`,
        revision: loaded.releaseUid,
        contentHash: rowHash,
      }
      const descriptor: ContextResourceDescriptorV1 = {
        version: 1,
        resourceKey,
        sourceKey: SOURCE_KEY,
        kind,
        title,
        shortSummary: summary,
        authority: 'author-canon',
        contentRevision: loaded.releaseUid,
        contentHash: rowHash,
        policyRevision: 1,
        policyHash,
        scope: {
          projectId: loaded.release.projectId,
          worldId: loaded.release.worldId,
          worldReleaseId: loaded.release.id,
          worldReleaseHash: loaded.release.contentHash,
        },
        worldSemantic: { area: catalog.area, resourceKind: catalog.resourceKind, resourceCoordinate: coord },
        relations: [],
        sourceRefs: [sourceRef],
        tokenEstimate: {
          index: indexTokens,
          summary: summaryTokens,
          focused: focusedTokens,
          full: originalTokens,
          original: originalTokens,
        },
        availableDepths: ['index', 'summary', 'focused', 'full', 'original'],
        priority: 'normal',
        retrievalWeight: 1,
        tokenCap: Math.min(50_000, Math.max(100, originalTokens)),
      }
      return { descriptor, table: catalog.table, coordinate: coord, rowIndex: index }
    })
  }))
  const result = grouped.flat()
  if (new Set(result.map(item => item.descriptor.resourceKey)).size !== result.length) {
    fail('resource-key', 'WorldRelease 资源键发生碰撞')
  }
  const byTableCoordinate = new Map(result.map(item => [`${item.table}:${item.coordinate}`, item] as const))
  for (const entry of result.filter(item => item.table === 'codexEntries')) {
    const row = loaded.manifest.records[entry.table]?.[entry.rowIndex]
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const categoryCoordinate = (row as Record<string, unknown>)._categoryExportId
    if (typeof categoryCoordinate !== 'number' && typeof categoryCoordinate !== 'string') continue
    const category = byTableCoordinate.get(`codexCategories:${String(categoryCoordinate)}`)
    if (!category) continue
    addRelation(entry.descriptor, category.descriptor.resourceKey, 'outgoing', 'same-entity')
    addRelation(category.descriptor, entry.descriptor.resourceKey, 'incoming', 'same-entity')
  }
  for (const relation of result.filter(item => item.table === 'characterRelations')) {
    const row = loaded.manifest.records[relation.table]?.[relation.rowIndex]
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const record = row as Record<string, unknown>
    const from = typeof record._fromCharacterIndex === 'number' || typeof record._fromCharacterIndex === 'string'
      ? byTableCoordinate.get(`characters:${String(record._fromCharacterIndex)}`) : undefined
    const to = typeof record._toCharacterIndex === 'number' || typeof record._toCharacterIndex === 'string'
      ? byTableCoordinate.get(`characters:${String(record._toCharacterIndex)}`) : undefined
    if (!from || !to) continue
    // Direction on the relation descriptor encodes its semantic endpoints:
    // outgoing = from, incoming = to. Endpoint back-links are undirected
    // membership and are not used to infer direction.
    addRelation(relation.descriptor, from.descriptor.resourceKey, 'outgoing', 'depends-on')
    addRelation(relation.descriptor, to.descriptor.resourceKey, 'incoming', 'depends-on')
    addRelation(from.descriptor, relation.descriptor.resourceKey, 'outgoing', 'appears-in')
    addRelation(to.descriptor, relation.descriptor.resourceKey, 'incoming', 'appears-in')
  }
  for (const link of result.filter(item => item.table === 'worldGroupLinks')) {
    const row = loaded.manifest.records[link.table]?.[link.rowIndex]
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const record = row as Record<string, unknown>
    for (const rawEndpoint of [record._fromGroupExportId, record._toGroupExportId]) {
      if (typeof rawEndpoint !== 'number' && typeof rawEndpoint !== 'string') continue
      const endpoint = byTableCoordinate.get(`worldGroups:${String(rawEndpoint)}`)
      if (!endpoint) continue
      addRelation(link.descriptor, endpoint.descriptor.resourceKey, 'outgoing', 'world-link')
      addRelation(endpoint.descriptor, link.descriptor.resourceKey, 'incoming', 'world-link')
    }
  }
  for (const item of result) {
    item.descriptor.relations.sort((left, right) => left.targetResourceKey.localeCompare(right.targetResourceKey)
      || left.direction.localeCompare(right.direction))
  }
  return result.sort((left, right) => left.descriptor.resourceKey.localeCompare(right.descriptor.resourceKey))
}

async function projections(loaded: LoadedReleaseV1): Promise<ProjectedReleaseResourceV1[]> {
  const existing = projectedReleaseCache.get(loaded.fingerprint)
  if (existing) {
    rememberBounded(projectedReleaseCache, loaded.fingerprint, existing)
    return existing
  }
  const created = buildProjections(loaded)
  rememberBounded(projectedReleaseCache, loaded.fingerprint, created)
  try { return await created } catch (reason) {
    projectedReleaseCache.delete(loaded.fingerprint)
    throw reason
  }
}

async function requestHash(input: ResourceListInputV1 | ResourceSearchInputV1, fingerprint: string): Promise<string> {
  return hashCanonicalValue({
    fingerprint,
    kinds: [...(input.kinds ?? [])].sort(),
    query: 'query' in input ? input.query.trim().toLocaleLowerCase('zh-CN') : null,
    entityKeys: 'entityKeys' in input ? [...(input.entityKeys ?? [])].sort() : [],
    storyArcKeys: 'storyArcKeys' in input ? [...(input.storyArcKeys ?? [])].sort() : [],
    timeRange: 'timeRange' in input ? input.timeRange ?? null : null,
  })
}

function encodeCursor(cursor: CursorV1): string {
  return encodeURIComponent(JSON.stringify(cursor))
}

function decodeCursor(value: string | undefined): CursorV1 | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as CursorV1
    if (parsed.version !== 1 || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0
      || !HASH.test(parsed.requestHash) || !HASH.test(parsed.fingerprint)) throw new Error('invalid')
    return parsed
  } catch { return fail('cursor', '世界资源 cursor 非法') }
}

async function page(input: ResourceListInputV1 | ResourceSearchInputV1): Promise<ResourcePageV1> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_PAGE) fail('page', `limit 必须在 1..${MAX_PAGE}`)
  const loaded = await load(input.scope)
  const expectedRequestHash = await requestHash(input, loaded.fingerprint)
  const cursor = decodeCursor(input.cursor)
  if (cursor && (cursor.requestHash !== expectedRequestHash || cursor.fingerprint !== loaded.fingerprint)) {
    fail('cursor', '世界资源 cursor 不属于当前 release/filter')
  }
  const kinds = new Set(input.kinds ?? WORLD_RELEASE_RESOURCE_PROVIDER_V1.kinds)
  const query = 'query' in input ? input.query.trim().toLocaleLowerCase('zh-CN') : ''
  if ('query' in input && !query) fail('query', '搜索 query 不能为空')
  const all = (await projections(loaded)).filter(item => {
    if (!kinds.has(item.descriptor.kind)) return false
    if (!query) return true
    const searchable = [
      item.descriptor.resourceKey,
      item.descriptor.title,
      item.descriptor.shortSummary,
      item.descriptor.worldSemantic?.area,
      item.descriptor.worldSemantic?.resourceKind,
    ].join('\n').toLocaleLowerCase('zh-CN')
    return searchable.includes(query)
  })
  const offset = cursor?.offset ?? 0
  const items = all.slice(offset, offset + input.limit).map(item => structuredClone(item.descriptor))
  const nextOffset = offset + items.length
  return {
    version: 1,
    items,
    nextCursor: nextOffset < all.length
      ? encodeCursor({ version: 1, offset: nextOffset, requestHash: expectedRequestHash, fingerprint: loaded.fingerprint })
      : null,
    scopeFingerprint: loaded.fingerprint,
  }
}

function rowFor(loaded: LoadedReleaseV1, projected: ProjectedReleaseResourceV1): unknown {
  const row = loaded.manifest.records[projected.table]?.[projected.rowIndex]
  if (row == null || coordinate(row, projected.rowIndex) !== projected.coordinate) {
    fail('resource-drift', `冻结世界资源坐标已漂移:${projected.descriptor.resourceKey}`)
  }
  return row
}

function capped(content: string, maxTokens: number): string {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_READ_TOKENS) fail('budget', 'maxTokens 非法')
  if (estimateTokens(content) <= maxTokens) return content
  const marker = '\n…（WorldRelease resource 已按显式预算截断；可提高预算或读取 original）'
  let low = 0
  let high = content.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTokens(`${content.slice(0, middle)}${marker}`) <= maxTokens) low = middle
    else high = middle - 1
  }
  return `${content.slice(0, low)}${marker}`
}

async function read(input: ResourceReadInputV1): Promise<ContextResourceReadV1> {
  const loaded = await load(input.scope)
  const projected = (await projections(loaded)).find(item => item.descriptor.resourceKey === input.resourceKey)
    ?? fail('not-found', `世界资源不存在:${input.resourceKey}`)
  const row = rowFor(loaded, projected)
  const source = input.depth === 'index'
    ? `${projected.descriptor.title}\n${projected.descriptor.shortSummary}`
    : input.depth === 'summary'
      ? projected.descriptor.shortSummary
      : input.depth === 'focused'
        ? focusedFor(row)
        : canonicalStringify(row)
  const content = capped(source, input.maxTokens)
  return {
    version: 1,
    descriptor: structuredClone(projected.descriptor),
    depth: input.depth,
    content,
    contentHash: await sha256Text(content),
    tokenCount: estimateTokens(content),
    sourceRefs: projected.descriptor.sourceRefs,
  }
}

function sameRef(left: ContextSourceRefV1, right: ContextSourceRefV1): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

async function readOriginal(input: OriginalEvidenceReadInputV1): Promise<OriginalEvidenceReadV1> {
  const loaded = await load(input.scope)
  const projected = (await projections(loaded)).find(item => item.descriptor.resourceKey === input.resourceKey)
    ?? fail('not-found', `世界资源不存在:${input.resourceKey}`)
  const original = canonicalStringify(rowFor(loaded, projected))
  const sourceRef = projected.descriptor.sourceRefs.find(ref => sameRef(ref, input.sourceRef))
    ?? fail('source-ref', 'source ref 不属于冻结世界资源')
  if (sourceRef.contentHash !== await sha256Text(original)) fail('source-ref', '世界原文证据 hash 损坏')
  if (estimateTokens(original) > input.maxTokens) {
    fail('original-budget', '世界原文超过显式预算；拒绝把截断内容伪装成 original')
  }
  return {
    version: 1,
    descriptor: structuredClone(projected.descriptor),
    sourceRef: structuredClone(sourceRef),
    content: original,
    contentHash: sourceRef.contentHash,
    tokenCount: estimateTokens(original),
  }
}

export const WORLD_RELEASE_RESOURCE_PROVIDER_V1: ContextResourceProviderV1 = {
  version: 'context-resource-provider-v1',
  providerId: WORLD_RELEASE_PROVIDER_ID_V1,
  providerVersion: PROVIDER_VERSION,
  normalizationVersion: NORMALIZATION_VERSION,
  kinds: WORLD_RELEASE_RESOURCE_KINDS_V1,
  listMetadata: page,
  searchMetadata: page,
  read,
  readOriginal,
  fingerprint: async scope => (await load(scope)).fingerprint,
}

/** Stable neutral protocol names used by product adapters and non-Agent tools. */
export async function searchWorldReleaseV1(input: ResourceSearchInputV1): Promise<ResourcePageV1> {
  return WORLD_RELEASE_RESOURCE_PROVIDER_V1.searchMetadata(input)
}

export async function readWorldResourceV1(input: ResourceReadInputV1): Promise<ContextResourceReadV1> {
  return WORLD_RELEASE_RESOURCE_PROVIDER_V1.read(input)
}

export async function readWorldOriginalEvidenceV1(input: OriginalEvidenceReadInputV1): Promise<OriginalEvidenceReadV1> {
  return WORLD_RELEASE_RESOURCE_PROVIDER_V1.readOriginal(input)
}

export async function listAllWorldReleaseResourceDescriptorsV1(
  scope: FrozenResourceScopeV1,
): Promise<ContextResourceDescriptorV1[]> {
  return (await projections(await load(scope))).map(item => structuredClone(item.descriptor))
}

/** Metadata-only neutral handoff. No physical table or row payload crosses
 * this boundary; products discover details through the registered provider. */
export async function describeWorldReleaseV1(
  scope: FrozenResourceScopeV1,
): Promise<WorldReleaseDescriptionV1> {
  const loaded = await load(scope)
  return {
    schema: 'storyforge.world-release-description',
    version: 1,
    worldReference: await createWorldReferenceV1(loaded.release.id),
    sourceManifestHash: loaded.manifest.sourceManifest?.contentHash
      ?? await hashCanonicalValue(loaded.manifest.sourceManifest ?? null),
    identity: {
      worldCode: loaded.manifest.worldCode,
      worldName: loaded.manifest.worldName,
      workTitle: loaded.manifest.workTitle,
      releaseVersion: loaded.release.version,
      releaseLabel: loaded.release.label,
      releaseHash: loaded.release.contentHash,
      releasedAt: loaded.release.createdAt,
    },
    capabilities: loaded.manifest.capabilityProfile
      .map(item => ({ ...item }))
      .sort((left, right) => left.area.localeCompare(right.area)),
    resources: loaded.manifest.resourceCatalog
      .map(({ table: _internalTable, ...resource }) => resource)
      .sort((left, right) => left.area.localeCompare(right.area)
        || left.resourceKind.localeCompare(right.resourceKind)),
    scopeFingerprint: loaded.fingerprint,
  }
}

/**
 * Product-facing entry for resolving a user-selected local WorldRelease.
 * The database row and physical manifest stay behind the provider boundary;
 * callers receive only a frozen scope, WorldReference and semantic metadata.
 */
export async function openWorldReleaseV1(input: {
  localReleaseRecordId: number
  expectedProjectId: number
  expectedWorldId?: number
}): Promise<OpenWorldReleaseV1> {
  if (!Number.isSafeInteger(input.localReleaseRecordId) || input.localReleaseRecordId < 1
    || !Number.isSafeInteger(input.expectedProjectId) || input.expectedProjectId < 1
    || (input.expectedWorldId != null
      && (!Number.isSafeInteger(input.expectedWorldId) || input.expectedWorldId < 1))) {
    fail('open-input', '打开 WorldRelease 的 ID/scope 非法')
  }
  const release = await db.worldReleases.get(input.localReleaseRecordId)
  if (!release?.id || release.projectId !== input.expectedProjectId
    || (input.expectedWorldId != null && release.worldId !== input.expectedWorldId)) {
    fail('open-scope', 'WorldRelease 不存在或不属于请求的世界作用域')
  }
  const scope = {
    projectId: release.projectId,
    worldId: release.worldId,
    worldReleaseId: release.id,
    worldReleaseHash: release.contentHash,
  }
  return {
    scope,
    description: await describeWorldReleaseV1(scope),
  }
}
