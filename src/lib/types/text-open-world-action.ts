import type { TextOpenWorldActionModuleV1 } from './text-open-world-modules'
import type { TextOpenWorldObjectiveStatusV1, TextOpenWorldQuestStatusV1 } from './text-open-world-condition'

export type TextOpenWorldActionDefinitionV1 = TextOpenWorldActionModuleV1['actions'][number]
export type TextOpenWorldActionTargetScopeV1 = Exclude<TextOpenWorldActionDefinitionV1['targetScope'], 'none'>

export interface TextOpenWorldActionConsumerRefsV1 {
  fixedChoiceKeys: string[]
  questObjectiveKeys: string[]
  randomEventKeys: string[]
  tutorialKeys: string[]
}

export interface TextOpenWorldActionCatalogEntryV1 {
  action: TextOpenWorldActionDefinitionV1
  consumers: TextOpenWorldActionConsumerRefsV1
}

export interface TextOpenWorldConditionResultV1 {
  satisfied: boolean
  publicReason: string | null
}

export interface TextOpenWorldActionProjectionContextV1 {
  actorKey: 'player' | 'system'
  currentLocationKey: string
  worldMinute: number
  playerHealth: number
  combatStatus: 'active' | 'victory' | 'defeat' | 'escaped' | null
  combatEncounterKey?: string | null
  combatPhase?: 'started' | 'round-start' | 'actor-turn' | 'action-resolved' | 'round-end' | 'terminal' | null
  activeCombatantKey?: string | null
  learnedSkillKeys?: string[]
  skillResource?: number
  combatSkillCooldownRemainingTurnsBySkillKey?: Record<string, number>
  knownRecipeKeys: string[]
  inventoryQuantities: Record<string, number>
  conditionResults: Record<string, TextOpenWorldConditionResultV1>
  openEdgeKeys: string[]
  unlockedFastTravelPointKeys: string[]
  completedOnceActionKeys: string[]
  cooldownUntilWorldMinuteByActionKey: Record<string, number>
  validTargetKeysByScope: Partial<Record<TextOpenWorldActionTargetScopeV1, string[]>>
  questDefinitionKeyByInstanceKey: Record<string, string>
  questStatusByInstanceKey: Record<string, TextOpenWorldQuestStatusV1>
  questStageKeyByInstanceKey: Record<string, string | null>
  questObjectiveStatusByInstanceKey: Record<string, Record<string, TextOpenWorldObjectiveStatusV1>>
  questRewardClaimKeyByInstanceKey: Record<string, string | null>
  questDeadlineWorldMinuteByInstanceKey: Record<string, number | null>
  primaryTrackedQuestInstanceKey: string | null
  pinnedQuestInstanceKeys: string[]
}

export type TextOpenWorldActionUnavailableCodeV1 =
  | 'actor-scope'
  | 'wrong-location'
  | 'condition-unknown'
  | 'condition-failed'
  | 'once-consumed'
  | 'cooldown'
  | 'no-valid-target'
  | 'defeated'
  | 'combat-state'
  | 'skill-unavailable'
  | 'item-unavailable'
  | 'recipe-unavailable'
  | 'materials-insufficient'
  | 'route-closed'
  | 'scene-unavailable'

export interface TextOpenWorldActionUnavailableReasonV1 {
  code: TextOpenWorldActionUnavailableCodeV1
  message: string
  conditionKey: string | null
}

export interface TextOpenWorldActionAvailabilityV1 extends TextOpenWorldActionCatalogEntryV1 {
  available: boolean
  unavailableReasons: TextOpenWorldActionUnavailableReasonV1[]
  targetScope: TextOpenWorldActionDefinitionV1['targetScope']
  validTargetKeys: string[]
  confirmationRequired: boolean
  cooldownRemainingMinutes: number
}

export interface TextOpenWorldResolvedActionV1 {
  entry: TextOpenWorldActionCatalogEntryV1
  targetKey: string | null
  confirmationRequired: boolean
}
