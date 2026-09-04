import { PROJECT_TABLES } from '../registry/project-tables'
import { WORLD_CAPABILITY_AREAS, type WorldCapabilityArea } from '../registry/types'
import type { WorldRelease, WorldReleaseManifestV3 } from '../types'
import { hashWorldReleaseValueV1 } from './release-hash'
import { assertWorldSemanticSnapshotV1 } from './semantic-snapshot'

const HASH = /^[a-f0-9]{64}$/
const WORLD_SEMANTIC_TABLES = new Set(
  PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => spec.name),
)
const WORLD_SEMANTIC_SPECS = PROJECT_TABLES.filter(spec => spec.worldSemantic)
const WORLD_SEMANTIC_BY_TABLE = new Map(WORLD_SEMANTIC_SPECS.map(spec => [spec.name, spec] as const))
const WORLD_RELEASE_MANIFEST_KEYS = new Set([
  'schema', 'version', 'semanticContract', 'worldCode', 'worldName', 'workTitle',
  'selectedTables', 'dependencies', 'records', 'semanticSnapshot',
  'capabilityProfile', 'resourceCatalog', 'sourceManifest',
])

function semanticResourceId(worldCode: string, table: string): string {
  const semantic = WORLD_SEMANTIC_BY_TABLE.get(table)?.worldSemantic
  if (!semantic) fail('ownership', `表 ${table} 未登记 worldSemantic`)
  return `world:${worldCode}:semantic:${semantic.area}:${semantic.resourceKind}`
}

export type PureWorldReleaseManifestV3 = WorldReleaseManifestV3 & {
  semanticContract: 3
  capabilityProfile: NonNullable<WorldReleaseManifestV3['capabilityProfile']>
  resourceCatalog: NonNullable<WorldReleaseManifestV3['resourceCatalog']>
  sourceManifest: NonNullable<WorldReleaseManifestV3['sourceManifest']>
}

export class WorldReleaseCodecErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[world-release-codec:${code}] ${message}`)
    this.name = 'WorldReleaseCodecErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new WorldReleaseCodecErrorV1(code, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) }
  catch { return fail('json', 'WorldRelease manifest 不是合法 JSON') }
}

function exactUniqueStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    fail('shape', `${label} 必须是非空字符串数组`)
  }
  const result = value.map(item => String(item))
  if (new Set(result).size !== result.length) fail('duplicate', `${label} 不允许重复`)
  return result
}

/**
 * The only active decoder for immutable semantic WorldRelease payloads.
 *
 * Product modules must never import this codec. They consume the neutral
 * Context Gateway protocol instead.
 */
export function parsePureWorldReleaseManifestV3(
  value: string | unknown,
): PureWorldReleaseManifestV3 {
  const parsed = typeof value === 'string' ? parseJson(value) : value
  if (!isRecord(parsed)) fail('root', 'WorldRelease manifest 根必须是对象')
  const manifest = parsed as unknown as WorldReleaseManifestV3
  const unknownKeys = Object.keys(parsed).filter(key => !WORLD_RELEASE_MANIFEST_KEYS.has(key))
  if (unknownKeys.length > 0) fail('shape', `WorldRelease manifest 包含未知字段:${unknownKeys.join(',')}`)
  if (manifest.schema !== 'storyforge.world-release' || manifest.version !== 3
    || manifest.semanticContract !== 3) {
    fail('contract', '只允许 semanticContract=3 的纯语义 WorldRelease')
  }
  if (typeof manifest.worldCode !== 'string' || !manifest.worldCode.trim()
    || typeof manifest.worldName !== 'string' || !manifest.worldName.trim()
    || typeof manifest.workTitle !== 'string') {
    fail('identity', 'WorldRelease 世界身份不完整')
  }
  const selectedTables = exactUniqueStrings(manifest.selectedTables, 'selectedTables')
  if (selectedTables.some(table => !WORLD_SEMANTIC_TABLES.has(table))) {
    fail('ownership', 'WorldRelease 含非世界语义表')
  }
  if (!isRecord(manifest.records)
    || Object.keys(manifest.records).length !== selectedTables.length
    || Object.keys(manifest.records).some(table => !selectedTables.includes(table))
    || Object.values(manifest.records).some(rows => !Array.isArray(rows))) {
    fail('records', 'records 必须与 selectedTables 精确闭合')
  }
  if (!Array.isArray(manifest.dependencies)
    || manifest.dependencies.length !== selectedTables.length) {
    fail('dependencies', 'dependencies 必须与 selectedTables 精确闭合')
  }
  const dependencies = new Map<string, WorldReleaseManifestV3['dependencies'][number]>()
  for (const dependency of manifest.dependencies) {
    if (!dependency || typeof dependency.table !== 'string'
      || dependencies.has(dependency.table) || !selectedTables.includes(dependency.table)
      || !Number.isSafeInteger(dependency.rowCount) || dependency.rowCount < 0
      || !HASH.test(dependency.contentHash)) {
      fail('dependencies', 'WorldRelease dependency 非法、重复或越界')
    }
    dependencies.set(dependency.table, dependency)
  }
  if (!Array.isArray(manifest.resourceCatalog)
    || manifest.resourceCatalog.length !== selectedTables.length) {
    fail('catalog', 'resourceCatalog 必须与 selectedTables 精确闭合')
  }
  const resourceIds = new Set<string>()
  const catalogTables = new Set<string>()
  for (const resource of manifest.resourceCatalog) {
    if (!resource || typeof resource.resourceId !== 'string' || !resource.resourceId.trim()
      || typeof resource.resourceKind !== 'string' || !resource.resourceKind.trim()
      || !WORLD_CAPABILITY_AREAS.includes(resource.area)
      || typeof resource.table !== 'string' || !selectedTables.includes(resource.table)
      || resourceIds.has(resource.resourceId) || catalogTables.has(resource.table)
      || !Number.isSafeInteger(resource.rowCount) || resource.rowCount < 0
      || !HASH.test(resource.contentHash)) {
      fail('catalog', 'resourceCatalog 项非法、重复或越界')
    }
    const dependency = dependencies.get(resource.table)
    const registered = WORLD_SEMANTIC_BY_TABLE.get(resource.table)?.worldSemantic
    if (!dependency || dependency.rowCount !== resource.rowCount
      || dependency.contentHash !== resource.contentHash
      || !registered || resource.area !== registered.area
      || resource.resourceKind !== registered.resourceKind
      || resource.resourceId !== semanticResourceId(manifest.worldCode, resource.table)) {
      fail('catalog', 'resourceCatalog 与 dependency/PROJECT_TABLES 语义身份不一致')
    }
    resourceIds.add(resource.resourceId)
    catalogTables.add(resource.table)
  }
  if (!Array.isArray(manifest.capabilityProfile)
    || manifest.capabilityProfile.length !== WORLD_CAPABILITY_AREAS.length) {
    fail('capabilities', 'capabilityProfile 必须覆盖全部世界能力域')
  }
  const capabilityAreas = new Set<WorldCapabilityArea>()
  for (const capability of manifest.capabilityProfile) {
    if (!capability || !WORLD_CAPABILITY_AREAS.includes(capability.area)
      || capabilityAreas.has(capability.area)
      || !Number.isSafeInteger(capability.resourceCount) || capability.resourceCount < 0
      || !Number.isSafeInteger(capability.rowCount) || capability.rowCount < 0
      || !['missing', 'partial', 'available'].includes(capability.status)) {
      fail('capabilities', 'capabilityProfile 项非法或重复')
    }
    capabilityAreas.add(capability.area)
  }
  try {
    assertWorldSemanticSnapshotV1(manifest.semanticSnapshot)
  } catch (error) {
    fail('snapshot', error instanceof Error ? error.message : '世界语义快照无效')
  }
  if (!manifest.sourceManifest || !isRecord(manifest.sourceManifest)
    || !['world-draft', 'independent-work-derivation'].includes(manifest.sourceManifest.sourceKind)
    || manifest.sourceManifest.sourceWorldCode !== manifest.worldCode
    || !Array.isArray(manifest.sourceManifest.selectedResourceIds)
    || !Array.isArray(manifest.sourceManifest.omittedResourceIds)
    || !HASH.test(manifest.sourceManifest.contentHash)) {
    fail('source-manifest', 'sourceManifest 身份或来源范围无效')
  }
  if (new Set(manifest.sourceManifest.selectedResourceIds).size !== manifest.sourceManifest.selectedResourceIds.length
    || new Set(manifest.sourceManifest.omittedResourceIds).size !== manifest.sourceManifest.omittedResourceIds.length
    || manifest.sourceManifest.selectedResourceIds.some(id => manifest.sourceManifest!.omittedResourceIds.includes(id))) {
    fail('source-manifest', 'sourceManifest 资源范围重复或相交')
  }
  const expectedSelected = selectedTables.map(table => semanticResourceId(manifest.worldCode, table)).sort()
  const expectedOmitted = WORLD_SEMANTIC_SPECS
    .filter(spec => !selectedTables.includes(spec.name))
    .map(spec => semanticResourceId(manifest.worldCode, spec.name))
    .sort()
  if (JSON.stringify([...manifest.sourceManifest.selectedResourceIds].sort()) !== JSON.stringify(expectedSelected)
    || JSON.stringify([...manifest.sourceManifest.omittedResourceIds].sort()) !== JSON.stringify(expectedOmitted)) {
    fail('source-manifest', 'sourceManifest selected/omitted 未与 PROJECT_TABLES 完整分区')
  }
  return manifest as PureWorldReleaseManifestV3
}

export async function verifyPureWorldReleaseManifestV3(input: {
  manifest: string | unknown
  expectedContentHash?: string
  expectedWorldCode?: string
}): Promise<PureWorldReleaseManifestV3> {
  const manifest = parsePureWorldReleaseManifestV3(input.manifest)
  if (input.expectedWorldCode != null && manifest.worldCode !== input.expectedWorldCode) {
    fail('identity', 'manifest worldCode 与冻结发布身份不一致')
  }
  if (input.expectedContentHash != null) {
    if (!HASH.test(input.expectedContentHash)
      || await hashWorldReleaseValueV1(manifest) !== input.expectedContentHash) {
      fail('content-hash', 'WorldRelease contentHash 不匹配')
    }
  }
  for (const resource of manifest.resourceCatalog) {
    const rows = manifest.records[resource.table]!
    if (rows.length !== resource.rowCount
      || await hashWorldReleaseValueV1(rows) !== resource.contentHash) {
      fail('resource-hash', `世界资源 ${resource.resourceId} 行数或 hash 损坏`)
    }
  }
  for (const area of WORLD_CAPABILITY_AREAS) {
    const capability = manifest.capabilityProfile.find(item => item.area === area)!
    const areaSpecs = WORLD_SEMANTIC_SPECS.filter(spec => spec.worldSemantic?.area === area)
    const resources = manifest.resourceCatalog.filter(resource => resource.area === area)
    const rowCount = resources.reduce((sum, resource) => sum + resource.rowCount, 0)
    const selectedResourceCount = resources.length
    const omittedResourceCount = areaSpecs.length - selectedResourceCount
    const latestRevisions = resources
      .map(resource => resource.latestRevision)
      .filter((value): value is number => value != null)
    const expected = {
      area,
      resourceCount: areaSpecs.length,
      rowCount,
      status: rowCount === 0
        ? 'missing'
        : omittedResourceCount === 0 && resources.every(resource => resource.rowCount > 0)
          ? 'available'
          : 'partial',
      selectionStatus: selectedResourceCount === 0
        ? 'omitted'
        : omittedResourceCount === 0
          ? 'selected'
          : 'partial-selection',
      selectedResourceCount,
      omittedResourceCount,
      confirmedRowCount: resources.reduce((sum, resource) => sum + (resource.confirmedRowCount ?? 0), 0),
      candidateRowCount: resources.reduce((sum, resource) => sum + (resource.candidateRowCount ?? 0), 0),
      conflictRowCount: resources.reduce((sum, resource) => sum + (resource.conflictRowCount ?? 0), 0),
      omittedRowCount: resources.reduce((sum, resource) => sum + (resource.omittedRowCount ?? 0), 0),
      latestRevision: latestRevisions.length ? Math.max(...latestRevisions) : null,
      originalEvidenceAvailable: rowCount > 0,
      queryableIndexAvailable: rowCount > 0,
    }
    if (await hashWorldReleaseValueV1(capability) !== await hashWorldReleaseValueV1(expected)) {
      fail('capabilities', `capabilityProfile 与 catalog/PROJECT_TABLES 不一致:${area}`)
    }
  }
  const { contentHash: _sourceHash, ...sourceManifestBody } = manifest.sourceManifest
  if (await hashWorldReleaseValueV1(sourceManifestBody) !== manifest.sourceManifest.contentHash) {
    fail('source-manifest-hash', 'sourceManifest contentHash 不匹配')
  }
  return manifest
}

export async function verifyPureWorldReleaseRecordV3(
  release: WorldRelease,
): Promise<PureWorldReleaseManifestV3> {
  if (!release.id || !Number.isSafeInteger(release.id)) fail('release-id', 'WorldRelease 缺少本地记录 ID')
  return verifyPureWorldReleaseManifestV3({
    manifest: release.manifestJson,
    expectedContentHash: release.contentHash,
    expectedWorldCode: release.sourceWorldCode,
  })
}
