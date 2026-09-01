import {
  openWorldSemanticResourceCatalogV1,
  readWorldSemanticResourcesV1,
} from '../context-gateway/world-release-client'
import type { ContextResourceDescriptorV1 } from '../registry/types'
import type {
  TtrpgWorldSourceCatalogRecordV2,
  TtrpgWorldSourceCatalogV2,
  TtrpgWorldSourceResourceKindV2,
  WorkspaceScope,
} from '../types'
import { TTRPG_WORLD_SOURCE_RESOURCE_KINDS } from '../types'
import { resolveScope } from '../world-engine/scope'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const RESOURCE_KINDS = new Set<string>(TTRPG_WORLD_SOURCE_RESOURCE_KINDS)

function stableKey(value: Record<string, unknown>): string | null {
  const found = [value.key, value.code, value.builtInKey, value.sceneId]
    .find(candidate => typeof candidate === 'string' && STABLE_KEY.test(candidate))
  return typeof found === 'string' ? found : null
}

function numericCoordinate(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function dependencyRecords(
  descriptor: ContextResourceDescriptorV1,
): TtrpgWorldSourceCatalogRecordV2['dependencies'] {
  return descriptor.relations
    .filter(relation => relation.direction === 'outgoing')
    .map(relation => ({
      resourceKey: relation.targetResourceKey,
      relationKind: relation.kind,
    }))
    .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey))
}

function recordFromSnapshot(
  snapshot: Awaited<ReturnType<typeof readWorldSemanticResourcesV1>>[number],
): TtrpgWorldSourceCatalogRecordV2 {
  const semantic = snapshot.descriptor.worldSemantic
  if (!RESOURCE_KINDS.has(semantic.resourceKind)) {
    throw new Error(`[ttrpg-world-source] 未授权世界资源种类:${semantic.resourceKind}`)
  }
  return {
    resourceKey: snapshot.descriptor.resourceKey,
    resourceKind: semantic.resourceKind as TtrpgWorldSourceResourceKindV2,
    area: semantic.area,
    coordinate: semantic.resourceCoordinate,
    exportId: numericCoordinate(semantic.resourceCoordinate),
    stableKey: stableKey(snapshot.value),
    label: snapshot.descriptor.title,
    summary: snapshot.descriptor.shortSummary,
    dependencies: dependencyRecords(snapshot.descriptor),
  }
}

export async function loadTtrpgWorldSourceCatalogV2(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<TtrpgWorldSourceCatalogV2> {
  const scope = await resolveScope({ scope: input.scope })
  const opened = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: input.worldReleaseId,
    expectedProjectId: scope.projectId,
    expectedWorldId: scope.worldId,
    resourceKinds: [...TTRPG_WORLD_SOURCE_RESOURCE_KINDS],
  })
  const snapshots = await readWorldSemanticResourcesV1({
    scope: opened.scope,
    descriptors: opened.resources,
  })
  const resources = snapshots.map(recordFromSnapshot)
    .sort((left, right) => left.resourceKind.localeCompare(right.resourceKind)
      || left.resourceKey.localeCompare(right.resourceKey))
  const present = new Set(resources.map(item => item.resourceKind))
  return {
    schema: 'storyforge.ttrpg-world-source-catalog',
    version: 2,
    productType: 'ttrpg',
    contractVersion: 2,
    worldReferenceHash: opened.description.worldReference.referenceHash,
    worldReleaseId: opened.description.worldReference.localReleaseRecordId,
    sourceWorldCode: opened.description.identity.worldCode,
    worldContentHash: opened.description.identity.releaseHash,
    sourceMappingVersion: 2,
    resources,
    unavailableResourceKinds: TTRPG_WORLD_SOURCE_RESOURCE_KINDS.filter(kind => !present.has(kind)),
  }
}
