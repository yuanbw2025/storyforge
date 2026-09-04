import type { WorldSemanticResourceSnapshotV1 } from '../context-gateway/world-release-client'
import {
  EMPTY_PRODUCT_RUNTIME_STATE,
  PRODUCT_WORLD_SOURCE_COMPILER_VERSION,
  PRODUCT_RUNTIME_CANON_SOURCE_KINDS,
  type ProductWorldSourceBundleV1,
  type ProductWorldSourceDiagnosticV1,
  type ProductRuntimeCanonCandidate,
  type ProductRuntimeCanonSnapshotV1,
  type ProductRuntimeCanonSource,
  type ProductRuntimeState,
  type RuntimeEntityState,
} from '../types'

const KIND_ORDER = new Map(PRODUCT_RUNTIME_CANON_SOURCE_KINDS.map((kind, index) => [kind, index]))

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function compact(value: string | null | undefined, max = 240): string {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? ''
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

function fields(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => {
    if (value == null) return []
    const text = typeof value === 'string' ? value.trim() : stableJson(value)
    return text ? [[key, text]] : []
  }))
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function sourceHashInput(source: ProductRuntimeCanonCandidate | ProductRuntimeCanonSource) {
  return {
    sourceKey: source.sourceKey,
    kind: source.kind,
    recordId: source.recordId,
    name: source.name,
    summary: source.summary,
    fields: source.fields,
    updatedAt: source.updatedAt,
  }
}

function snapshotHashInput(snapshot: Omit<ProductRuntimeCanonSnapshotV1, 'snapshotHash'>) {
  return {
    schema: snapshot.schema,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    worldGroupId: snapshot.worldGroupId,
    worldLabel: snapshot.worldLabel,
    sources: snapshot.sources,
  }
}

function bundleHashInput(bundle: Omit<ProductWorldSourceBundleV1, 'bundleHash'>) {
  return {
    schema: bundle.schema,
    version: bundle.version,
    compilerVersion: bundle.compilerVersion,
    source: bundle.source,
    createdAt: bundle.createdAt,
    canonSnapshot: bundle.canonSnapshot,
    initialState: bundle.initialState,
    diagnostics: bundle.diagnostics,
  }
}

function sortCandidates(candidates: ProductRuntimeCanonCandidate[]): ProductRuntimeCanonCandidate[] {
  return candidates.sort((left, right) => (
    (KIND_ORDER.get(left.kind) ?? 99) - (KIND_ORDER.get(right.kind) ?? 99)
    || left.name.localeCompare(right.name, 'zh-Hans-CN')
    || left.sourceKey.localeCompare(right.sourceKey)
  ))
}

function resourceUpdatedAt(row: Record<string, unknown>, createdAt: number): number {
  if (Number.isFinite(row.updatedAt)) return Number(row.updatedAt)
  if (Number.isFinite(row.createdAt)) return Number(row.createdAt)
  return createdAt
}

function resourceText(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function canonKindForResource(
  resourceKind: string,
  row: Record<string, unknown>,
  codexCategoryKinds: ReadonlyMap<number, string>,
): ProductRuntimeCanonCandidate['kind'] {
  if (resourceKind === 'character' || resourceKind === 'work-character-binding') return 'character'
  if (resourceKind === 'location' || resourceKind === 'world-node') return 'location'
  if (resourceKind === 'power-system' || resourceKind === 'cultivation-system' || resourceKind === 'world-rules') {
    return 'rule'
  }
  if (resourceKind === 'codex-entry') {
    const category = Number(row._categoryExportId)
    const builtInKey = Number.isSafeInteger(category) ? codexCategoryKinds.get(category) : undefined
    if (builtInKey === 'artifact') return 'item'
    if (builtInKey === 'faction') return 'faction'
  }
  if (resourceKind === 'item-event') return 'item'
  return 'world'
}

function canonFieldsForResource(row: Record<string, unknown>): Record<string, string> {
  return fields(Object.fromEntries(Object.entries(row).filter(([key]) => (
    key !== 'id'
    && key !== 'projectId'
    && key !== 'worldId'
    && key !== 'workId'
    && !key.startsWith('_')
  ))))
}

function diagnosticOrder(diagnostic: ProductWorldSourceDiagnosticV1): string {
  const severity = diagnostic.severity === 'error' ? '0' : diagnostic.severity === 'warning' ? '1' : '2'
  return `${severity}:${diagnostic.code}:${diagnostic.sourceKeys.join(',')}:${diagnostic.message}`
}

function releaseRuntimeEntities(
  sources: ProductRuntimeCanonSource[],
  diagnostics: ProductWorldSourceDiagnosticV1[],
): Record<string, RuntimeEntityState> {
  const locations = new Map<string, ProductRuntimeCanonSource[]>()
  for (const source of sources) {
    if (source.kind !== 'location') continue
    const key = source.name.trim().toLocaleLowerCase()
    if (!key) continue
    locations.set(key, [...(locations.get(key) ?? []), source])
  }

  const entities: Record<string, RuntimeEntityState> = {}
  for (const source of sources) {
    if (
      source.kind !== 'character'
      && source.kind !== 'location'
      && source.kind !== 'item'
      && source.kind !== 'faction'
    ) continue
    let locationKey: string | null = source.kind === 'location' ? source.sourceKey : null
    if (source.kind === 'character' && source.fields.location?.trim()) {
      const matches = locations.get(source.fields.location.trim().toLocaleLowerCase()) ?? []
      if (matches.length === 1) {
        locationKey = matches[0].sourceKey
      } else if (matches.length === 0) {
        diagnostics.push({
          code: 'CHARACTER_LOCATION_UNRESOLVED',
          severity: 'warning',
          message: `角色「${source.name}」的地点「${source.fields.location}」未匹配到冻结地点。`,
          sourceKeys: [source.sourceKey],
        })
      } else {
        diagnostics.push({
          code: 'CHARACTER_LOCATION_AMBIGUOUS',
          severity: 'error',
          message: `角色「${source.name}」的地点「${source.fields.location}」匹配到多个同名冻结地点。`,
          sourceKeys: [source.sourceKey, ...matches.map(item => item.sourceKey)],
        })
      }
    }
    entities[source.sourceKey] = {
      entityKey: source.sourceKey,
      kind: source.kind,
      sourceId: null,
      name: source.name,
      locationKey,
      lifecycleStatus: 'active',
      attributes: structuredClone(source.fields),
    }
  }
  return entities
}

/**
 * Compile already-gatewayed semantic resources into a runtime Canon bundle.
 *
 * Product code never receives WorldRelease tables or manifests. The neutral
 * gateway verifies the immutable release and returns independently addressable
 * semantic resources; this compiler only understands their public semantic
 * kind and content.
 */
export interface ProductWorldSemanticSourceV1 {
  world: {
    code: string
    name: string
  }
  release: {
    contentHash: string
    createdAt: number
  }
  resources: WorldSemanticResourceSnapshotV1[]
}

export async function buildProductWorldSourceBundleV1(
  input: ProductWorldSemanticSourceV1,
): Promise<ProductWorldSourceBundleV1> {
  const worldCode = input.world.code.trim()
  const worldName = input.world.name.trim()
  const createdAt = input.release.createdAt
  const worldContentHash = input.release.contentHash
  if (!worldCode || !worldName) throw new Error('[product-world-source] 语义来源缺少世界身份。')
  if (!Number.isFinite(createdAt)) throw new Error('[product-world-source] 语义来源创建时间无效。')
  if (!/^[0-9a-f]{64}$/.test(worldContentHash)) {
    throw new Error('[product-world-source] WorldReference content hash 无效。')
  }

  const diagnostics: ProductWorldSourceDiagnosticV1[] = []
  const candidates: ProductRuntimeCanonCandidate[] = []
  const sourceKeys = new Set<string>()
  const addCandidate = (candidate: ProductRuntimeCanonCandidate) => {
    if (sourceKeys.has(candidate.sourceKey)) {
      diagnostics.push({
        code: 'DUPLICATE_SOURCE_KEY',
        severity: 'error',
        message: `语义资源生成了重复来源 ${candidate.sourceKey}。`,
        sourceKeys: [candidate.sourceKey],
      })
      return
    }
    sourceKeys.add(candidate.sourceKey)
    candidates.push(candidate)
  }

  addCandidate({
    sourceKey: `world:${worldCode}`,
    kind: 'world',
    recordId: null,
    name: worldName,
    summary: '冻结世界语义来源',
    fields: { worldCode, worldContentHash },
    updatedAt: createdAt,
  })

  const codexCategoryKinds = new Map<number, string>()
  for (const snapshot of input.resources) {
    if (snapshot.descriptor.worldSemantic.resourceKind !== 'codex-category') continue
    const coordinate = Number(snapshot.descriptor.worldSemantic.resourceCoordinate)
    const builtInKey = resourceText(snapshot.value, 'builtInKey')
    if (Number.isSafeInteger(coordinate) && builtInKey) codexCategoryKinds.set(coordinate, builtInKey)
  }

  for (const snapshot of [...input.resources].sort((left, right) => (
    left.descriptor.resourceKey.localeCompare(right.descriptor.resourceKey)
  ))) {
    const semantic = snapshot.descriptor.worldSemantic
    if (
      snapshot.descriptor.sourceKey !== 'worldRelease'
      || !semantic?.resourceKind
      || !semantic.resourceCoordinate
    ) {
      diagnostics.push({
        code: 'INVALID_WORLD_RESOURCE_DESCRIPTOR',
        severity: 'error',
        message: `来源不是合法的中立世界语义资源：${snapshot.descriptor.resourceKey}`,
        sourceKeys: [snapshot.descriptor.resourceKey],
      })
      continue
    }
    const row = snapshot.value
    const name = snapshot.descriptor.title.trim()
    if (!name) {
      diagnostics.push({
        code: 'RESOURCE_NAME_MISSING',
        severity: 'warning',
        message: `${snapshot.descriptor.resourceKey} 缺少可显示名称，已使用语义类型代替。`,
        sourceKeys: [snapshot.descriptor.resourceKey],
      })
    }
    addCandidate({
      sourceKey: snapshot.descriptor.resourceKey,
      kind: canonKindForResource(semantic.resourceKind, row, codexCategoryKinds),
      recordId: null,
      name: name || semantic.resourceKind,
      summary: compact(snapshot.descriptor.shortSummary),
      fields: {
        semanticArea: semantic.area,
        semanticKind: semantic.resourceKind,
        semanticCoordinate: semantic.resourceCoordinate,
        ...canonFieldsForResource(row),
      },
      updatedAt: resourceUpdatedAt(row, createdAt),
    })
  }

  const sortedCandidates = sortCandidates(candidates)
  const sources: ProductRuntimeCanonSource[] = []
  for (const candidate of sortedCandidates) {
    sources.push({
      ...candidate,
      fields: structuredClone(candidate.fields),
      contentHash: await sha256(sourceHashInput(candidate)),
    })
  }
  const snapshotBase: Omit<ProductRuntimeCanonSnapshotV1, 'snapshotHash'> = {
    schema: 'storyforge.product-runtime-canon',
    version: 1,
    createdAt,
    worldGroupId: null,
    worldLabel: worldName,
    sources,
  }
  const canonSnapshot: ProductRuntimeCanonSnapshotV1 = {
    ...snapshotBase,
    snapshotHash: await sha256(snapshotHashInput(snapshotBase)),
  }
  const initialState: ProductRuntimeState = {
    ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    entities: releaseRuntimeEntities(sources, diagnostics),
  }
  if (Object.keys(initialState.entities).length === 0) {
    diagnostics.push({
      code: 'NO_RUNTIME_ENTITIES',
      severity: 'info',
      message: '所选世界语义资源未包含角色、地点、人工器物或势力实体。',
      sourceKeys: [`world:${worldCode}`],
    })
  }
  diagnostics.sort((left, right) => diagnosticOrder(left).localeCompare(diagnosticOrder(right), 'zh-Hans-CN'))
  const bundleBase: Omit<ProductWorldSourceBundleV1, 'bundleHash'> = {
    schema: 'storyforge.product-world-source-bundle',
    version: 1,
    compilerVersion: PRODUCT_WORLD_SOURCE_COMPILER_VERSION,
    source: { worldCode, worldName, worldContentHash },
    createdAt,
    canonSnapshot,
    initialState,
    diagnostics,
  }
  return { ...bundleBase, bundleHash: await sha256(bundleHashInput(bundleBase)) }
}

export async function verifyProductWorldSourceBundleV1(bundle: ProductWorldSourceBundleV1): Promise<boolean> {
  if (
    bundle.schema !== 'storyforge.product-world-source-bundle'
    || bundle.version !== 1
    || bundle.compilerVersion !== PRODUCT_WORLD_SOURCE_COMPILER_VERSION
    || !/^[0-9a-f]{64}$/.test(bundle.source.worldContentHash)
    || !/^[0-9a-f]{64}$/.test(bundle.bundleHash)
    || !await verifyProductRuntimeCanonSnapshot(bundle.canonSnapshot)
  ) return false
  const { bundleHash: _bundleHash, ...base } = bundle
  return await sha256(bundleHashInput(base)) === bundle.bundleHash
}

export function assertProductWorldSourceBundleSufficientV1(bundle: ProductWorldSourceBundleV1): void {
  const errors = bundle.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
  if (errors.length === 0) return
  throw new Error(`[product-world-source] 发布世界不能安全进入运行时: ${errors
    .map(diagnostic => `${diagnostic.code}:${diagnostic.message}`)
    .join('；')}`)
}

export function parseProductRuntimeCanonSnapshot(value: string): ProductRuntimeCanonSnapshotV1 | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isObject(parsed)) return null
  const snapshot = parsed as unknown as Partial<ProductRuntimeCanonSnapshotV1>
  if (
    snapshot.schema !== 'storyforge.product-runtime-canon'
    || snapshot.version !== 1
    || !Number.isFinite(snapshot.createdAt)
    || (snapshot.worldGroupId != null && !Number.isInteger(snapshot.worldGroupId))
    || typeof snapshot.worldLabel !== 'string'
    || !Array.isArray(snapshot.sources)
    || typeof snapshot.snapshotHash !== 'string'
    || !/^[0-9a-f]{64}$/.test(snapshot.snapshotHash)
  ) return null
  const sourceKeys = new Set<string>()
  for (const source of snapshot.sources) {
    if (
      !isObject(source)
      || typeof source.sourceKey !== 'string'
      || !source.sourceKey
      || sourceKeys.has(source.sourceKey)
      || !PRODUCT_RUNTIME_CANON_SOURCE_KINDS.includes(source.kind as never)
      || (source.recordId != null && (!Number.isInteger(source.recordId) || source.recordId <= 0))
      || typeof source.name !== 'string'
      || typeof source.summary !== 'string'
      || !isObject(source.fields)
      || Object.values(source.fields).some(field => typeof field !== 'string')
      || !Number.isFinite(source.updatedAt)
      || typeof source.contentHash !== 'string'
      || !/^[0-9a-f]{64}$/.test(source.contentHash)
    ) return null
    sourceKeys.add(source.sourceKey)
  }
  return snapshot as ProductRuntimeCanonSnapshotV1
}

export async function verifyProductRuntimeCanonSnapshot(
  snapshot: ProductRuntimeCanonSnapshotV1,
): Promise<boolean> {
  for (const source of snapshot.sources) {
    const expected = await sha256(sourceHashInput(source))
    if (expected !== source.contentHash) return false
  }
  return await sha256(snapshotHashInput(snapshot))
    === snapshot.snapshotHash
}
