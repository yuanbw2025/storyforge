import {
  openWorldSemanticResourceCatalogV1,
  readWorldSemanticResourceV1,
  readWorldSemanticResourcesV1,
  type WorldSemanticResourceSnapshotV1,
} from '../context-gateway/world-release-client'
import type {
  ProductProductionSourceOptionsV1,
  ProductProductionSourceSelectionV1,
  ProductWorldSourceSelectionV1,
  WorkspaceScope,
  WorldReferenceV1,
} from '../types'
import { resolveScope } from '../workspace/scope'

export interface ProductProductionWorldSourceItemV2 {
  resourceKey: string
  name: string
  description: string
}

export interface ProductProductionWorldSourceCatalogV2 {
  schema: 'storyforge.product-production-world-source-catalog'
  version: 2
  worldReference: WorldReferenceV1
  world: { code: string; name: string; workTitle: string }
  release: { id: number; version: number; label: string; contentHash: string; createdAt: number }
  storySources: ProductProductionWorldSourceItemV2[]
  characters: ProductProductionWorldSourceItemV2[]
  relationships: Array<{
    resourceKey: string
    fromCharacterResourceKey: string
    toCharacterResourceKey: string
    relationType: string
    label: string
    description: string
    isBidirectional: boolean
  }>
  locations: ProductProductionWorldSourceItemV2[]
  artifacts: ProductProductionWorldSourceItemV2[]
  loreEntries: ProductProductionWorldSourceItemV2[]
  storyArcs: Array<ProductProductionWorldSourceItemV2 & { type: string }>
  /** Neutral resources are retained only in memory for product compilation. */
  resources: WorldSemanticResourceSnapshotV1[]
}

export interface ProductProductionConsultationSourceV2 {
  schema: 'storyforge.product-production-consultation-index'
  version: 2
  worldReference: WorldReferenceV1
  release: { version: number; label: string; contentHash: string }
  opportunities: {
    storySources: ProductProductionSourceOptionsV1['storySources']
    characters: ProductProductionSourceOptionsV1['characters']
    storyArcs: ProductProductionSourceOptionsV1['storyArcs']
    historicalTimelineEvents: ProductProductionSourceOptionsV1['storyArcs']
  }
  selectionOptions: ProductProductionSourceOptionsV1
  selectionRelations: Array<{
    resourceKey: string
    fromCharacterResourceKey: string
    toCharacterResourceKey: string
  }>
  selectionCatalog: ProductProductionSourceSelectionV1
}

type WorldCatalogDescriptorV2 = Awaited<ReturnType<typeof openWorldSemanticResourceCatalogV1>>['resources'][number]

/**
 * Resolve the exact immutable resources consumed by the deterministic product
 * compiler.  Selection remains product-owned; dependency closure is derived
 * only from neutral semantic relations and is shared by the compiler and the
 * Context Gateway evidence path.
 */
export function resolveProductProductionWorldCompilationDescriptorsV2(input: {
  descriptors: readonly WorldCatalogDescriptorV2[]
  selection: ProductWorldSourceSelectionV1
}): WorldCatalogDescriptorV2[] {
  const selectedKeys = new Set(input.selection.resourceKeys)
  if (selectedKeys.size !== input.selection.resourceKeys.length) {
    throw new Error('[product-production-world-source] selection resourceKeys 重复')
  }
  const descriptorByKey = new Map(input.descriptors.map(descriptor => [descriptor.resourceKey, descriptor]))
  if ([...selectedKeys].some(key => !descriptorByKey.has(key))) {
    throw new Error('[product-production-world-source] selection 含冻结世界之外的资源')
  }
  const selectedCharacterKeys = new Set(input.descriptors
    .filter(descriptor => selectedKeys.has(descriptor.resourceKey)
      && descriptor.worldSemantic!.resourceKind === 'character')
    .map(descriptor => descriptor.resourceKey))
  const relationshipDependencies = input.descriptors.filter(descriptor => {
    if (descriptor.worldSemantic!.resourceKind !== 'character-relation') return false
    const from = descriptor.relations.find(relation => (
      relation.kind === 'depends-on' && relation.direction === 'outgoing'
    ))?.targetResourceKey
    const to = descriptor.relations.find(relation => (
      relation.kind === 'depends-on' && relation.direction === 'incoming'
    ))?.targetResourceKey
    return from != null && to != null
      && selectedCharacterKeys.has(from) && selectedCharacterKeys.has(to)
  })
  const selectedCodexCategoryKeys = new Set(input.descriptors
    .filter(descriptor => selectedKeys.has(descriptor.resourceKey)
      && descriptor.worldSemantic!.resourceKind === 'codex-entry')
    .flatMap(descriptor => descriptor.relations
      .filter(relation => relation.kind === 'same-entity' && relation.direction === 'outgoing')
      .map(relation => relation.targetResourceKey)))
  const codexCategoryDependencies = input.descriptors
    .filter(descriptor => selectedCodexCategoryKeys.has(descriptor.resourceKey))
  const requiredKeys = new Set([
    ...selectedKeys,
    ...relationshipDependencies.map(descriptor => descriptor.resourceKey),
    ...codexCategoryDependencies.map(descriptor => descriptor.resourceKey),
  ])
  return [...requiredKeys]
    .sort()
    .map(resourceKey => descriptorByKey.get(resourceKey)!)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function item(
  snapshot: WorldSemanticResourceSnapshotV1,
): ProductProductionWorldSourceItemV2 {
  return {
    resourceKey: snapshot.descriptor.resourceKey,
    name: snapshot.descriptor.title,
    description: snapshot.descriptor.shortSummary,
  }
}

function kind(
  resources: readonly WorldSemanticResourceSnapshotV1[],
  resourceKind: string,
): WorldSemanticResourceSnapshotV1[] {
  return resources.filter(resource => resource.descriptor.worldSemantic.resourceKind === resourceKind)
}

function descriptorOption(
  descriptor: Awaited<ReturnType<typeof openWorldSemanticResourceCatalogV1>>['resources'][number],
  kindLabel: string | null,
) {
  return {
    resourceKey: descriptor.resourceKey,
    label: descriptor.title,
    summary: descriptor.shortSummary,
    kind: kindLabel,
  }
}

/**
 * Metadata-first consultation index.  It never serializes the whole release
 * into a prompt. Only the few resource kinds whose classification depends on
 * semantic fields are opened, while ordinary options use descriptor metadata.
 */
export async function loadProductProductionConsultationSourceV2(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<ProductProductionConsultationSourceV2> {
  const scope = await resolveScope({ scope: input.scope })
  const opened = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: input.worldReleaseId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
  })
  const descriptors = opened.resources
  const byKind = (resourceKind: string) => descriptors
    .filter(item => item.worldSemantic!.resourceKind === resourceKind)
  const characters = byKind('character')
  const locations = byKind('location')
  const storySources = descriptors.filter(resource => [
    'story-core', 'outline-node', 'detailed-outline', 'chapter', 'storyline-progress',
  ].includes(resource.worldSemantic!.resourceKind))
  const storyArcs = byKind('story-arc')
  const historicalEvents = byKind('historical-event')
  const categoryDescriptors = descriptors.filter(resource => (
    resource.worldSemantic!.resourceKind === 'codex-category'
  ))
  const openedCategories = await Promise.all(categoryDescriptors.map(descriptor => (
    readWorldSemanticResourceV1({ scope: opened.scope, descriptor })
  )))
  const artifactCategoryKeys = new Set(openedCategories
    .filter(resource => text(resource.value.builtInKey) === 'artifact')
    .map(resource => resource.descriptor.resourceKey))
  const artifactKeys = new Set(byKind('codex-entry')
    .filter(resource => resource.relations.some(relation => (
      relation.kind === 'same-entity' && relation.direction === 'outgoing'
      && artifactCategoryKeys.has(relation.targetResourceKey)
    )))
    .map(resource => resource.resourceKey))
  const codexDescriptors = new Map(byKind('codex-entry').map(resource => [resource.resourceKey, resource]))
  const artifacts = [...artifactKeys].flatMap(key => {
    const descriptor = codexDescriptors.get(key)
    return descriptor ? [descriptorOption(descriptor, 'artifact')] : []
  })
  const loreEntries = byKind('codex-entry')
    .filter(resource => !artifactKeys.has(resource.resourceKey))
    .map(resource => descriptorOption(resource, 'lore'))
  const relationships = byKind('character-relation').flatMap(resource => {
    const fromCharacterResourceKey = resource.relations.find(relation => (
      relation.kind === 'depends-on' && relation.direction === 'outgoing'
    ))?.targetResourceKey
    const toCharacterResourceKey = resource.relations.find(relation => (
      relation.kind === 'depends-on' && relation.direction === 'incoming'
    ))?.targetResourceKey
    if (!fromCharacterResourceKey || !toCharacterResourceKey) return []
    return [{
      resourceKey: resource.resourceKey,
      fromCharacterResourceKey,
      toCharacterResourceKey,
    }]
  })
  const options: ProductProductionSourceOptionsV1 = {
    storySources: storySources.map(resource => descriptorOption(resource, 'story-source')),
    characters: characters.map(resource => descriptorOption(resource, 'character')),
    importantLocations: locations.map(resource => descriptorOption(resource, 'location')),
    artifacts,
    codexEntries: loreEntries,
    storyArcs: storyArcs.map(resource => descriptorOption(resource, 'story-arc')),
  }
  return {
    schema: 'storyforge.product-production-consultation-index',
    version: 2,
    worldReference: opened.description.worldReference,
    release: {
      version: opened.description.identity.releaseVersion,
      label: opened.description.identity.releaseLabel,
      contentHash: opened.description.identity.releaseHash,
    },
    opportunities: {
      storySources: options.storySources.slice(0, 30),
      characters: options.characters.slice(0, 30),
      storyArcs: options.storyArcs.slice(0, 30),
      historicalTimelineEvents: historicalEvents.slice(0, 30)
        .map(resource => descriptorOption(resource, 'historical-event')),
    },
    selectionOptions: options,
    selectionRelations: relationships,
    selectionCatalog: {
      storyResourceKeys: options.storySources.map(item => item.resourceKey),
      characterResourceKeys: options.characters.map(item => item.resourceKey),
      importantLocationResourceKeys: options.importantLocations.map(item => item.resourceKey),
      artifactResourceKeys: options.artifacts.map(item => item.resourceKey),
      codexEntryResourceKeys: options.codexEntries.map(item => item.resourceKey),
      storyArcResourceKeys: options.storyArcs.map(item => item.resourceKey),
    },
  }
}

export async function loadProductProductionWorldSourceCatalogV2(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  /** Exact author-confirmed, product-owned selection. There is deliberately
   * no "read the whole release" fallback: diagnostics and tests must traverse
   * the same consultation -> adapter -> selection boundary as production. */
  selection: ProductWorldSourceSelectionV1
}): Promise<ProductProductionWorldSourceCatalogV2> {
  const scope = await resolveScope({ scope: input.scope })
  const opened = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: input.worldReleaseId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
  })
  if (input.selection.worldReferenceHash !== opened.description.worldReference.referenceHash) {
    throw new Error('[product-production-world-source] selection 与冻结 WorldReference 不一致')
  }
  const descriptors = resolveProductProductionWorldCompilationDescriptorsV2({
    descriptors: opened.resources,
    selection: input.selection,
  })
  const resources = await readWorldSemanticResourcesV1({
    scope: opened.scope,
    descriptors,
  })
  const characters = kind(resources, 'character').map(item)
  const locations = kind(resources, 'location').map(item)
  const storySources = resources.filter(resource => [
    'story-core', 'outline-node', 'detailed-outline', 'chapter', 'storyline-progress',
  ].includes(resource.descriptor.worldSemantic.resourceKind)).map(item)
  const characterByCoordinate = new Map(kind(resources, 'character').map(resource => [
    resource.descriptor.worldSemantic.resourceCoordinate,
    resource.descriptor.resourceKey,
  ]))
  const codex = kind(resources, 'codex-entry')
  const categoryKinds = new Map(kind(resources, 'codex-category').map(resource => [
    resource.descriptor.worldSemantic.resourceCoordinate,
    text(resource.value.builtInKey),
  ]))
  const artifacts = codex.filter(resource => {
    const category = resource.value._categoryExportId
    return (typeof category === 'number' || typeof category === 'string')
      && categoryKinds.get(String(category)) === 'artifact'
  }).map(item)
  const loreEntries = codex.filter(resource => !artifacts.some(artifact => artifact.resourceKey === resource.descriptor.resourceKey))
    .map(item)
  const relationships = kind(resources, 'character-relation').flatMap(resource => {
    const from = resource.value._fromCharacterIndex
    const to = resource.value._toCharacterIndex
    const fromCharacterResourceKey = characterByCoordinate.get(String(from))
    const toCharacterResourceKey = characterByCoordinate.get(String(to))
    if (!fromCharacterResourceKey || !toCharacterResourceKey) return []
    return [{
      resourceKey: resource.descriptor.resourceKey,
      fromCharacterResourceKey,
      toCharacterResourceKey,
      relationType: text(resource.value.relationType) || 'other',
      label: text(resource.value.label),
      description: text(resource.value.description),
      isBidirectional: resource.value.isBidirectional === true,
    }]
  })
  const storyArcs = kind(resources, 'story-arc').map(resource => ({
    ...item(resource),
    type: text(resource.value.type),
  }))
  return {
    schema: 'storyforge.product-production-world-source-catalog',
    version: 2,
    worldReference: opened.description.worldReference,
    world: {
      code: opened.description.identity.worldCode,
      name: opened.description.identity.worldName,
      workTitle: opened.description.identity.workTitle,
    },
    release: {
      id: opened.description.worldReference.localReleaseRecordId,
      version: opened.description.identity.releaseVersion,
      label: opened.description.identity.releaseLabel,
      contentHash: opened.description.identity.releaseHash,
      createdAt: opened.description.identity.releasedAt,
    },
    storySources, characters,
    relationships,
    locations,
    artifacts,
    loreEntries,
    storyArcs,
    resources,
  }
}
