import {
  openWorldSemanticResourceCatalogV1,
  readWorldSemanticResourcesV1,
  type WorldSemanticResourceSnapshotV1,
} from '../context-gateway/world-release-client'
import type { WorkspaceScope, WorldReferenceV1 } from '../types'
import { resolveScope } from '../world-engine/scope'

export interface GameProductionWorldSourceItemV2 {
  resourceKey: string
  name: string
  description: string
}

export interface GameProductionWorldSourceCatalogV2 {
  schema: 'storyforge.game-production-world-source-catalog'
  version: 2
  worldReference: WorldReferenceV1
  world: { code: string; name: string; workTitle: string }
  release: { id: number; version: number; label: string; contentHash: string; createdAt: number }
  storySources: GameProductionWorldSourceItemV2[]
  characters: GameProductionWorldSourceItemV2[]
  relationships: Array<{
    resourceKey: string
    fromCharacterResourceKey: string
    toCharacterResourceKey: string
    relationType: string
    label: string
    description: string
    isBidirectional: boolean
  }>
  locations: GameProductionWorldSourceItemV2[]
  artifacts: GameProductionWorldSourceItemV2[]
  loreEntries: GameProductionWorldSourceItemV2[]
  storyArcs: Array<GameProductionWorldSourceItemV2 & { type: string }>
  /** Neutral resources are retained only in memory for product compilation. */
  resources: WorldSemanticResourceSnapshotV1[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function item(
  snapshot: WorldSemanticResourceSnapshotV1,
): GameProductionWorldSourceItemV2 {
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

export async function loadGameProductionWorldSourceCatalogV2(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<GameProductionWorldSourceCatalogV2> {
  const scope = await resolveScope({ scope: input.scope })
  const opened = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: input.worldReleaseId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
  })
  const resources = await readWorldSemanticResourcesV1({
    scope: opened.scope,
    descriptors: opened.resources,
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
  const categoryKinds = new Map(kind(resources, 'codex-category').map(resource => [
    resource.descriptor.worldSemantic.resourceCoordinate,
    text(resource.value.builtInKey),
  ]))
  const codex = kind(resources, 'codex-entry')
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
    schema: 'storyforge.game-production-world-source-catalog',
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
