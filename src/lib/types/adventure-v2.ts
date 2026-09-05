import type {
  AdventureAbilityDefinition,
  AdventureConditionDefinition,
  AdventureContentV1,
  AdventureItemDefinition,
  AdventureLocationDefinition,
  AdventureObjectDefinition,
  AdventureQuestDefinition,
  AdventureQuestObjectiveDefinition,
  AdventureRequirement,
  AdventureResourceDefinition,
} from './adventure'

/**
 * TEXTADV-2 is a product-owned semantic layer over the deterministic
 * TEXTADV-1 action/effect protocol. The low-level protocol intentionally stays
 * generic: specialised genres are capability packs, never core schema fields.
 */

export const ADVENTURE_V2_CORE_CAPABILITIES = [
  'space',
  'character',
  'inventory',
  'equipment',
  'quests',
  'time',
  'storylets',
  'endings',
] as const

export type AdventureV2CoreCapability = typeof ADVENTURE_V2_CORE_CAPABILITIES[number]

export interface AdventureCapabilityBindingV2 {
  key: string
  version: number
  enabled: boolean
  required: boolean
}

export interface AdventureRegionDefinitionV2 {
  key: string
  title: string
  description: string
  areaKeys: string[]
  tags: string[]
}

export interface AdventureAreaDefinitionV2 {
  key: string
  regionKey: string
  title: string
  description: string
  locationKeys: string[]
  tags: string[]
}

export interface AdventureLocationDefinitionV2 extends AdventureLocationDefinition {
  areaKey: string
  sceneKeys: string[]
}

export interface AdventureSceneDefinitionV2 {
  key: string
  locationKey: string
  title: string
  description: string
  actionKeys: string[]
  tags: string[]
}

export interface AdventureObjectDefinitionV2 extends AdventureObjectDefinition {
  sceneKey: string | null
}

export type AdventureAbilityRoleV2 = 'stat' | 'skill'

export interface AdventureAbilityDefinitionV2 extends AdventureAbilityDefinition {
  role: AdventureAbilityRoleV2
  group: string
}

export type AdventureResourceRoleV2 =
  | 'health'
  | 'mana'
  | 'stamina'
  | 'experience'
  | 'skill-points'
  | 'currency'
  | 'clock'
  | 'custom'

export interface AdventureResourceDefinitionV2 extends AdventureResourceDefinition {
  role: AdventureResourceRoleV2
  description: string
}

export interface AdventureConditionDefinitionV2 extends AdventureConditionDefinition {
  tags: string[]
}

export interface AdventureEquipmentModifierV2 {
  abilityKey: string
  delta: number
}

export interface AdventureItemDefinitionV2 extends AdventureItemDefinition {
  category: 'consumable' | 'equipment' | 'quest' | 'material' | 'key' | 'misc'
  equipmentSlotKey: string | null
  modifiers: AdventureEquipmentModifierV2[]
  usableActionKey: string | null
}

export interface AdventureEquipmentSlotDefinitionV2 {
  key: string
  title: string
  acceptsTags: string[]
}

export interface AdventureQuestObjectiveDefinitionV2 extends AdventureQuestObjectiveDefinition {
  stageKey: string
}

export interface AdventureQuestStageDefinitionV2 {
  key: string
  title: string
  objectiveKeys: string[]
}

export interface AdventureQuestDefinitionV2 extends Omit<AdventureQuestDefinition, 'objectives'> {
  category: 'main' | 'side' | 'ambient'
  stages: AdventureQuestStageDefinitionV2[]
  objectives: AdventureQuestObjectiveDefinitionV2[]
}

export interface AdventureProgressionDefinitionV2 {
  levelAbilityKey: string
  experienceResourceKey: string
  skillPointResourceKey: string
  experienceThresholds: number[]
}

export interface AdventureClockDefinitionV2 {
  resourceKey: string
  dayLengthMinutes: number
  startLabel: string
}

export interface AdventureStoryletDefinitionV2 {
  key: string
  title: string
  actionKeys: string[]
  requirements: AdventureRequirement[]
  once: boolean
  priority: number
}

export interface AdventureEndingDefinitionV2 {
  key: string
  title: string
  narrativeNodeKey: string
  requirements: AdventureRequirement[]
  priority: number
}

export interface AdventureMediaPolicyV2 {
  mode: 'text-only' | 'key-illustrations' | 'rich-illustrations'
  fallback: 'text-only'
  assetKeys: string[]
}

export interface AdventureContentV2 extends Omit<
  AdventureContentV1,
  'version' | 'locations' | 'objects' | 'items' | 'abilities' | 'conditions' | 'resources' | 'quests'
> {
  schema: 'storyforge.text-adventure.content'
  version: 2
  playerIdentity: { name: string; description: string }
  recipeKey: string
  capabilities: AdventureCapabilityBindingV2[]
  regions: AdventureRegionDefinitionV2[]
  areas: AdventureAreaDefinitionV2[]
  locations: AdventureLocationDefinitionV2[]
  scenes: AdventureSceneDefinitionV2[]
  objects: AdventureObjectDefinitionV2[]
  items: AdventureItemDefinitionV2[]
  equipmentSlots: AdventureEquipmentSlotDefinitionV2[]
  abilities: AdventureAbilityDefinitionV2[]
  conditions: AdventureConditionDefinitionV2[]
  resources: AdventureResourceDefinitionV2[]
  quests: AdventureQuestDefinitionV2[]
  progression: AdventureProgressionDefinitionV2
  clock: AdventureClockDefinitionV2
  storylets: AdventureStoryletDefinitionV2[]
  endings: AdventureEndingDefinitionV2[]
  media: AdventureMediaPolicyV2
}

export type AdventureContent = AdventureContentV1 | AdventureContentV2

export function isAdventureContentV2(value: AdventureContent): value is AdventureContentV2 {
  return value.version === 2
}
