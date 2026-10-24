import type {ContextResourceDescriptorV1} from '../registry/types'
import type {WorkspaceScope} from '../types'
import {upperProductAllowedAreasV1, upperProductAllowedContextKindsV1} from '../product/world-requirement-adapters'

/** Metadata only. No cross-world read or whole-release content fallback. */
export function isChatBackgroundDescriptorV1(descriptor: ContextResourceDescriptorV1): boolean {
  const semantic = descriptor.worldSemantic
  return descriptor.sourceKey === 'worldRelease' && !!semantic
    && !['character', 'codex-category', 'world', 'world-link'].includes(semantic.resourceKind)
    && semantic.area !== 'multi-world'
    && upperProductAllowedAreasV1('character-interaction').includes(semantic.area)
    && upperProductAllowedContextKindsV1('character-interaction').includes(descriptor.kind)
}

export async function loadChatBackgroundOptionsV1(scope: WorkspaceScope, worldReleaseId: number) {
  // Contract validation also runs outside the browser; open storage only for an actual catalog read.
  const {openWorldSemanticResourceCatalogV1} = await import('../context-gateway/world-release-client')
  const opened = await openWorldSemanticResourceCatalogV1({localReleaseRecordId: worldReleaseId,
    expectedProjectId: scope.projectId, expectedWorldId: scope.worldId})
  return opened.resources.filter(isChatBackgroundDescriptorV1).map(resource => ({
    resourceKey: resource.resourceKey, label: resource.title, resourceKind: resource.worldSemantic!.resourceKind,
  }))
}

export function assertChatBackgroundSelectionV1(keys: readonly string[], descriptors: readonly ContextResourceDescriptorV1[]) {
  if (keys.length > 128 || new Set(keys).size !== keys.length) throw new Error('背景资料范围或重复选择无效')
  const allowed = new Set(descriptors.filter(isChatBackgroundDescriptorV1).map(d => d.resourceKey))
  if (keys.some(key => !allowed.has(key))) throw new Error('背景资料不属于当前冻结世界或角色聊天获准的资源类型')
}
