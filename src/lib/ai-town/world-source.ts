import type {
  AiTownWorldSourceCandidateV1,
  AiTownWorldSourceCatalogV1,
  AiTownWorldSourceSelectionV1,
  WorkspaceScope,
} from '../types'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { loadProductProductionConsultationSourceV2 } from '../product-production/world-source'
import {
  aiTownWorldSourceSelectionHashPayloadV1,
  assertAiTownWorldSourceSelectionHashV1,
} from './contracts'

function fail(message: string): never {
  throw new Error(`[ai-town-world-source] ${message}`)
}

function portableKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.startsWith('world-release:') || /\s/.test(value)) fail(`${label} 不是便携世界资源 key`)
  return value
}

function unique<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  if (new Set(values.map(key)).size !== values.length) fail(`${label} 含重复 key`)
}

function candidates(values: unknown, label: string): AiTownWorldSourceCandidateV1[] {
  if (!Array.isArray(values) || values.length > 1_000) fail(`${label} 必须是有界数组`)
  const parsed = values.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}[${index}] 必须是对象`)
    const row = value as Record<string, unknown>
    const actual = Object.keys(row).sort().join(',')
    if (actual !== ['kind', 'label', 'resourceKey', 'summary'].sort().join(',')) fail(`${label}[${index}] 字段不符合合同`)
    if (typeof row.label !== 'string' || !row.label.trim() || typeof row.summary !== 'string' || typeof row.kind !== 'string') fail(`${label}[${index}] 文本无效`)
    return { resourceKey: portableKey(row.resourceKey, `${label}[${index}]`), label: row.label.trim(), summary: row.summary.trim(), kind: row.kind.trim() }
  })
  unique(parsed, item => item.resourceKey, label)
  return parsed
}

export function aiTownWorldSourceCatalogHashPayloadV1(catalog: AiTownWorldSourceCatalogV1) {
  const { worldReleaseId: _localWorldReleaseId, catalogHash: _catalogHash, ...portable } = catalog
  return portable
}

export function parseAiTownWorldSourceCatalogV1(value: unknown): AiTownWorldSourceCatalogV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('catalog 必须是对象')
  const row = value as Record<string, unknown>
  const expected = [
    'schema', 'version', 'productType', 'worldReleaseId', 'worldReferenceHash', 'worldContentHash',
    'sourceMappingVersion', 'endingCandidates', 'residentCandidates', 'relationEdges',
    'locationCandidates', 'ruleAndLoreCandidates', 'artifactCandidates', 'catalogHash',
  ].sort().join(',')
  if (Object.keys(row).sort().join(',') !== expected) fail('catalog 字段不符合合同')
  if (row.schema !== 'storyforge.ai-town-world-source-catalog' || row.version !== 1
    || row.productType !== 'ai-town' || row.sourceMappingVersion !== 1
    || !Number.isSafeInteger(row.worldReleaseId) || Number(row.worldReleaseId) < 1
    || !/^[a-f0-9]{64}$/.test(String(row.worldReferenceHash))
    || !/^[a-f0-9]{64}$/.test(String(row.worldContentHash))
    || !/^[a-f0-9]{64}$/.test(String(row.catalogHash))) fail('catalog identity/hash 无效')
  const residentCandidates = candidates(row.residentCandidates, 'residentCandidates')
  const residentKeys = new Set(residentCandidates.map(item => item.resourceKey))
  if (!Array.isArray(row.relationEdges) || row.relationEdges.length > 256) fail('relationEdges 必须是有界数组')
  const relationEdges = row.relationEdges.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`relationEdges[${index}] 必须是对象`)
    const edge = value as Record<string, unknown>
    if (Object.keys(edge).sort().join(',') !== ['fromCharacterResourceKey', 'resourceKey', 'toCharacterResourceKey'].sort().join(',')) fail(`relationEdges[${index}] 字段不符合合同`)
    const parsed = {
      resourceKey: portableKey(edge.resourceKey, `relationEdges[${index}].resourceKey`),
      fromCharacterResourceKey: portableKey(edge.fromCharacterResourceKey, `relationEdges[${index}].from`),
      toCharacterResourceKey: portableKey(edge.toCharacterResourceKey, `relationEdges[${index}].to`),
    }
    if (!residentKeys.has(parsed.fromCharacterResourceKey) || !residentKeys.has(parsed.toCharacterResourceKey)) fail(`relationEdges[${index}] 端点不在居民目录`)
    return parsed
  })
  unique(relationEdges, item => item.resourceKey, 'relationEdges')
  return {
    schema: 'storyforge.ai-town-world-source-catalog', version: 1, productType: 'ai-town',
    worldReleaseId: Number(row.worldReleaseId), worldReferenceHash: String(row.worldReferenceHash),
    worldContentHash: String(row.worldContentHash), sourceMappingVersion: 1,
    endingCandidates: candidates(row.endingCandidates, 'endingCandidates'), residentCandidates,
    relationEdges, locationCandidates: candidates(row.locationCandidates, 'locationCandidates'),
    ruleAndLoreCandidates: candidates(row.ruleAndLoreCandidates, 'ruleAndLoreCandidates'),
    artifactCandidates: candidates(row.artifactCandidates, 'artifactCandidates'), catalogHash: String(row.catalogHash),
  }
}

export async function assertAiTownWorldSourceCatalogHashV1(value: unknown): Promise<AiTownWorldSourceCatalogV1> {
  const catalog = parseAiTownWorldSourceCatalogV1(value)
  const expected = await hashProductProductionValueV2(aiTownWorldSourceCatalogHashPayloadV1(catalog))
  if (catalog.catalogHash !== expected) fail('catalogHash 与便携目录内容不一致')
  return catalog
}

function option(item: { resourceKey: string; label: string; summary: string; kind: string | null }, fallbackKind: string): AiTownWorldSourceCandidateV1 {
  return { resourceKey: item.resourceKey, label: item.label, summary: item.summary, kind: item.kind ?? fallbackKind }
}

export async function loadAiTownWorldSourceCatalogV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<AiTownWorldSourceCatalogV1> {
  const source = await loadProductProductionConsultationSourceV2(input)
  const body = {
    schema: 'storyforge.ai-town-world-source-catalog' as const, version: 1 as const, productType: 'ai-town' as const,
    worldReleaseId: input.worldReleaseId, worldReferenceHash: source.worldReference.referenceHash,
    worldContentHash: source.release.contentHash, sourceMappingVersion: 1 as const,
    endingCandidates: [
      ...source.selectionOptions.storySources.map(item => option(item, 'story')),
      ...source.selectionOptions.storyArcs.map(item => option(item, 'story-arc')),
    ],
    residentCandidates: source.selectionOptions.characters.map(item => option(item, 'character')),
    relationEdges: source.selectionRelations.map(edge => ({ ...edge })),
    locationCandidates: source.selectionOptions.importantLocations.map(item => option(item, 'location')),
    ruleAndLoreCandidates: source.selectionOptions.codexEntries.map(item => option(item, 'lore')),
    artifactCandidates: source.selectionOptions.artifacts.map(item => option(item, 'artifact')),
    catalogHash: '0'.repeat(64),
  }
  const catalog = { ...body, catalogHash: await hashProductProductionValueV2(aiTownWorldSourceCatalogHashPayloadV1(body)) }
  return assertAiTownWorldSourceCatalogHashV1(catalog)
}

export async function freezeAiTownWorldSourceSelectionV1(input: {
  catalog: AiTownWorldSourceCatalogV1
  endingResourceKeys: string[]
  residentResourceKeys: string[]
  locationResourceKeys: string[]
  ruleAndLoreResourceKeys: string[]
  artifactResourceKeys: string[]
}): Promise<AiTownWorldSourceSelectionV1> {
  const catalog = await assertAiTownWorldSourceCatalogHashV1(input.catalog)
  const select = (values: readonly string[], allowed: readonly AiTownWorldSourceCandidateV1[], label: string) => {
    const result = [...new Set(values.map(value => portableKey(value, label)))].sort()
    const allowedKeys = new Set(allowed.map(item => item.resourceKey))
    if (result.some(key => !allowedKeys.has(key))) fail(`${label} 含目录外资源`)
    return result
  }
  const endingResourceKeys = select(input.endingResourceKeys, catalog.endingCandidates, 'endingResourceKeys')
  const residentResourceKeys = select(input.residentResourceKeys, catalog.residentCandidates, 'residentResourceKeys')
  if (!endingResourceKeys.length) fail('严格后日谈必须选择至少一个终局资源')
  if (residentResourceKeys.length < 4 || residentResourceKeys.length > 8) fail('居民选择必须是 4..8 人')
  const residents = new Set(residentResourceKeys)
  const relationSubgraphResourceKeys = catalog.relationEdges.filter(edge => (
    residents.has(edge.fromCharacterResourceKey) && residents.has(edge.toCharacterResourceKey)
  )).map(edge => edge.resourceKey).sort()
  const locationResourceKeys = select(input.locationResourceKeys, catalog.locationCandidates, 'locationResourceKeys')
  const ruleAndLoreResourceKeys = select(input.ruleAndLoreResourceKeys, catalog.ruleAndLoreCandidates, 'ruleAndLoreResourceKeys')
  const artifactResourceKeys = select(input.artifactResourceKeys, catalog.artifactCandidates, 'artifactResourceKeys')
  const dependencyClosureResourceKeys = [...new Set([
    ...endingResourceKeys, ...residentResourceKeys, ...relationSubgraphResourceKeys,
    ...locationResourceKeys, ...ruleAndLoreResourceKeys, ...artifactResourceKeys,
  ])].sort()
  const draft: AiTownWorldSourceSelectionV1 = {
    schema: 'storyforge.ai-town-world-source-selection', version: 1, productType: 'ai-town',
    worldReleaseId: catalog.worldReleaseId, worldReferenceHash: catalog.worldReferenceHash,
    worldContentHash: catalog.worldContentHash, sourceMappingVersion: 1,
    endingResourceKeys, residentResourceKeys, relationSubgraphResourceKeys, locationResourceKeys,
    ruleAndLoreResourceKeys, artifactResourceKeys, dependencyClosureResourceKeys,
    selectionHash: '0'.repeat(64),
  }
  draft.selectionHash = await hashProductProductionValueV2(aiTownWorldSourceSelectionHashPayloadV1(draft))
  return assertAiTownWorldSourceSelectionHashV1(draft)
}
