import type { ContextResourceKind } from '../registry/types'
import type { TextOpenWorldDirectorTriggerV1 } from '../types'

export const TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_ID_V1 = 'storyforge.text-open-world-runtime-context' as const
export const TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_VERSION_V1 = '1.0.0' as const
export const TEXT_OPEN_WORLD_RUNTIME_CONTEXT_NORMALIZATION_VERSION_V1 = 'text-open-world-runtime-context-json-v1' as const

export const TEXT_OPEN_WORLD_RUNTIME_CONTEXT_RESOURCE_KINDS_V1 = [
  'fact',
  'location',
  'character',
  'character-relation',
  'story-arc',
  'storyline-progress',
  'narrative-blueprint',
  'reference',
] as const satisfies readonly ContextResourceKind[]

export const TEXT_OPEN_WORLD_DIRECTOR_TRIGGERS_V1 = [
  'arrival', 'explore', 'talk', 'rest', 'quest-complete', 'time-batch', 'activity',
] as const satisfies readonly TextOpenWorldDirectorTriggerV1[]
