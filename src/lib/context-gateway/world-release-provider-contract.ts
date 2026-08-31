import type { ContextResourceKind } from '../registry/types'

/** Lightweight contract shared by CONTEXT_SOURCES and the implementation.
 * Keep this module dependency-free so registry initialization cannot recurse
 * through WorldRelease/export/Skill implementation modules. */
export const WORLD_RELEASE_RESOURCE_KINDS_V1: readonly ContextResourceKind[] = [
  'world', 'worldview-field', 'story-core-field', 'character', 'character-relation',
  'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter',
  'foreshadow', 'location', 'codex-entry', 'world-link', 'fact',
]

export const WORLD_RELEASE_PROVIDER_ID_V1 = 'storyforge.world-release' as const
export const WORLD_RELEASE_PROVIDER_VERSION_V1 = 'world-release-resource-provider-v2' as const
export const WORLD_RELEASE_NORMALIZATION_VERSION_V1 = 'world-release-semantic-row-v1' as const
