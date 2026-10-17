import type {
  RulePackV1, TtrpgCampaignContentV1, TtrpgCampaignClockV1, TtrpgCampaignFrontV1,
  TtrpgDegreeV2, TtrpgEffectAudienceV2, TtrpgEffectPrimitiveV2, TtrpgCharacterTemplateV1,
} from '../types'

export const OPEN_FACT_PREDICATES = [
  'exists', 'located-at', 'owns', 'knows', 'allied-with', 'hostile-to',
  'owes', 'promised', 'damaged', 'destroyed', 'blocked', 'open',
] as const
export type TtrpgOpenFactPredicate = typeof OPEN_FACT_PREDICATES[number]
export type TtrpgOpenAudience = 'gm-only' | 'party' | 'private' | 'public'
export type TtrpgOpenEntityKind = 'actor' | 'location' | 'item'
export type TtrpgOpenFactKind = 'entity' | 'relation' | 'state' | 'event-truth' | 'location' | 'item'
export type TtrpgOpenFactOwner = 'semantic-fact' | 'entity' | 'inventory' | 'social-ledger'
export type TtrpgOpenScalar = string | number | boolean
export interface TtrpgOpenSourceFieldRef {
  resourceKey: string
  fieldPath: string
  contentHash: string
}
export interface TtrpgOpenFactPolicyV1 {
  predicateKey: TtrpgOpenFactPredicate
  valueType: 'boolean' | 'number' | 'string' | 'entity-ref'
  cardinality: 'one' | 'many'
  allowedKinds: TtrpgOpenFactKind[]
  mutuallyExclusiveWith: TtrpgOpenFactPredicate[]
  authority: {
    invariant: TtrpgOpenFactOwner | null
    initialState: TtrpgOpenFactOwner | null
    session: TtrpgOpenFactOwner | null
  }
  allowNewSubjects: boolean
}
export type TtrpgPredicateV1 =
  | { op: 'world-fact' | 'session-fact'; subjectRef: string; predicateKey: TtrpgOpenFactPredicate; objectRef: string | null; value?: TtrpgOpenScalar }
  | { op: 'evidence-known-by'; clueRef: string; actorKey: string }
  | { op: 'clock-at-least'; clockKey: string; value: number }
  | { op: 'story-fact'; factKey: string; expected: TtrpgOpenScalar | null }
  | { op: 'actor-at'; actorKey: string; locationRef: string }
  | { op: 'item-held'; actorKey: string; itemKey: string }
  | { op: 'ability-available'; actorKey: string; abilityKey: string }
  | { op: 'resource-at-least'; actorKey: string; resourceKey: string; value: number }
  | { op: 'social-balance-at-least'; balanceKey: string; value: number }
  | { op: 'chaos-at-least' | 'world-turn-at-least'; value: number }
  | { op: 'situation-active'; templateKey: string }
  | { op: 'front-stage-at-least'; frontKey: string; stageKey: string }
  | { op: 'all' | 'any'; of: TtrpgPredicateV1[] }
  | { op: 'not'; of: TtrpgPredicateV1 }

export interface TtrpgOracleTableV1 {
  oracleKey: string
  title: string
  kind: 'yes-no' | 'meaning' | 'event'
  diceModelKey: string
  audience: 'gm-only' | 'party' | 'public'
  chaosCoupled: boolean
  likelihood: {
    tiers: Array<{ tierKey: string; label: string; yesAtOrAbove: number; yesButBand: number; noButBand: number }>
    defaultTierKey: string
  } | null
  entries: Array<{ entryKey: string; weight: number; text: string; tags: string[] }> | null
  interpretation: {
    mustRespect: string[]
    forbiddenScopes: Array<'world-fact' | 'rule-change' | 'player-decision' | 'retcon'>
    maxNewEntities: number
  }
  tests: Array<{
    testKey: string; seed: string; nonce: string; chaosValue: number | null
    likelihoodTierKey: string | null
    expectedRawResult: 'yes' | 'yes-but' | 'no-but' | 'no' | null
    expectedEntryKey: string | null
  }>
  sourceRefs: string[]
}
export interface TtrpgOpenGenericCheckV1 {
  checkKey: string
  title: string
  actorAttributeKey: string
  diceModelKey: string
  difficulty: number
  preconditions: TtrpgPredicateV1[]
  targetKinds: Array<'self' | TtrpgOpenEntityKind>
  effectPlanByDegree: Record<TtrpgDegreeV2, string | null>
  riskFactRefs: string[]
  resourceCosts: Array<{ resourceKey: string; amount: number }>
  timeCostWorldTurns: number
  audience: TtrpgEffectAudienceV2
  sourceRefs: string[]
}
export interface TtrpgOpenSocialTierMappingV1 {
  mappingKey: string
  balanceKey: string
  oracleKey: string
  ranges: Array<{ minimum: number; maximum: number; minimumInclusive: boolean; maximumInclusive: boolean; tierKey: string }>
  defaultTierKey: string
}
export interface TtrpgOpenTimePolicyV1 {
  existingAction: number
  genericCheck: number
  noRoll: number
  outOfCharacter: 0
  view: 0
  rulesQuestion: 0
  preflight: 0
  oracleConsultation: 0
  actionOverrides: Array<{ actionKey: string; timeCostWorldTurns: number }>
}
export interface TtrpgOpenInteractionBindingV1 {
  interactionKey: string
  kind: 'dialogue' | 'observe' | 'move' | 'assist' | 'retreat'
  title: string
  actionKey: string
  effectPlanRef: string | null
  preconditions: TtrpgPredicateV1[]
  timeCostWorldTurns: number
}
export interface RulePackV2 extends Omit<RulePackV1, 'version'> {
  version: 2
  runFormat: 'open'
  interactionBindings?: TtrpgOpenInteractionBindingV1[]
  oracles: TtrpgOracleTableV1[]
  factPolicy: TtrpgOpenFactPolicyV1[]
  genericChecks: TtrpgOpenGenericCheckV1[]
  socialTierMappings: TtrpgOpenSocialTierMappingV1[]
  timePolicy: TtrpgOpenTimePolicyV1
}

export interface TtrpgOpenFrozenFactV1 {
  factKey: string
  subjectRef: string
  predicateKey: TtrpgOpenFactPredicate
  objectRef: string | null
  canonicalValue: TtrpgOpenScalar
  authority: 'invariant' | 'initial-state'
  owner: TtrpgOpenFactOwner
  audience: TtrpgOpenAudience
  knownByActorKeys: string[]
  sourceResourceRefs: string[]
  sourceFieldRefs: TtrpgOpenSourceFieldRef[]
}
export interface TtrpgFrozenWorldPredicateIndexV1 {
  worldReleaseHash: string
  indexHash: string
  entries: TtrpgOpenFrozenFactV1[]
}
export interface TtrpgOpenEntityBindingV1 {
  bindingKey: string
  sourceResourceRef: string | null
  kind: TtrpgOpenEntityKind
  templateKey: string
  initialLocationRef: string | null
  initialInventoryRefs: string[]
  sourceFieldRefs: TtrpgOpenSourceFieldRef[]
  audience: TtrpgOpenAudience
  knownByActorKeys: string[]
}
export interface TtrpgOpenDynamicEntityTemplateV1 {
  templateKey: string
  kind: TtrpgOpenEntityKind
  characterTemplateKey: string | null
  itemDefinitionKey: string | null
  description: string
  parameters: Array<{ parameterKey: string; allowedValues: string[]; required: boolean }>
  maximumNameLength: number
  maximumInstances: number
  audience: TtrpgOpenAudience
  knownByActorKeys: string[]
  sourceRefs: string[]
}
export interface TtrpgOpenEffectParameterV1 {
  parameterKey: string
  entityKinds: TtrpgOpenEntityKind[]
  allowedRefs: string[]
  allowDynamicFromTemplateKeys: string[]
  required: boolean
}
export type TtrpgOpenEffectPrimitiveV1 = TtrpgEffectPrimitiveV2 | {
  effectKey: string
  family: 'knowledge'
  operation: 'knowledge.discover'
  targetRef: string
  evidenceRef: string
}
export interface TtrpgOpenEffectPlanTemplateV1 {
  planKey: string
  degree: TtrpgDegreeV2
  ruleRef: string
  reason: string
  audience: TtrpgEffectAudienceV2
  parameters: TtrpgOpenEffectParameterV1[]
  effects: TtrpgOpenEffectPrimitiveV1[]
  alternatives: Array<{ alternativeKey: string; title: string; effects: TtrpgOpenEffectPrimitiveV1[] }>
}
export interface TtrpgOpenCampaignClockV1 extends Omit<TtrpgCampaignClockV1, 'advanceTriggers'> {
  advanceTriggers: Array<{
    triggerKey: string; sceneKey: null; actionKey: string | null
    condition: TtrpgPredicateV1 | null; amount: number; reason: string
  }>
  autoAdvance: { onFailedCheck: number; onIdleWorldTurns: number; onOracleNo: number; onStageClose: number }
  onCompleteEffectPlanRef: string | null
}
export interface TtrpgOpenCampaignFrontV1 extends TtrpgCampaignFrontV1 {
  escalationStages: Array<{
    stageKey: string; clockKey: string; atClockValue: number
    effectPlanRef: string | null; newSituationTemplateKey: string | null
  }>
  telegraph: Array<{
    telegraphKey: string; beforeStageKey: string; signalText: string
    audience: 'party' | 'public'; mediaSlotKey: string | null; minLeadWorldTurns: number
  }>
  defeatPredicates: TtrpgPredicateV1[]
}
export type TtrpgOpenDriverBindingV1 =
  | { kind: 'npc'; characterKey: string }
  | { kind: 'front'; frontKey: string }
  | { kind: 'world-event' | 'player-commitment'; factRef: string }
export interface TtrpgSituationTemplateV1 {
  templateKey: string
  title: string
  motive: 'knowledge' | 'protection' | 'reputation' | 'wealth' | 'ability' | 'equipment' | 'conquest' | 'serenity' | 'comfort'
  driverBinding: TtrpgOpenDriverBindingV1
  driverGoal: string
  driverBeliefs: Array<{ factRef: string | null; belief: string; isMistaken: boolean }>
  preconditions: TtrpgPredicateV1[]
  obstacles: Array<{
    obstacleKey: string; kind: 'physical' | 'social' | 'informational' | 'resource' | 'legal'
    ref: string | null; predicate: TtrpgPredicateV1; dependsOn: string[]
  }>
  interventionPoints: Array<{
    pointKey: string; visibleTo: 'party' | 'private' | 'public'; knownByActorKeys: string[]
    affordanceHint: string; requiresPredicate: TtrpgPredicateV1 | null
    suggestedActionKeys: string[]; targetsObstacleKeys: string[]
  }>
  evidence: Array<{
    clueRef: string; title: string; description: string
    sourceFactRefs: string[]; sourceResourceRefs: string[]
    discoverableBy: string[]; coversObstacleKeys: string[]
    audience: 'gm-only' | 'party' | 'private'; knownByActorKeys: string[]; isRequired: boolean
    discoveryPolicy: {
      preconditions: TtrpgPredicateV1[]
      paths: Array<{ kind: 'action' | 'generic-check'; key: string; interventionPointKey: string }>
      failForwardEffectPlanRef: string | null
      costEffectPlanRef: string | null
      allowedAudience: TtrpgOpenAudience
      recipientActorKeys: string[]
      requiresPlayerConfirmation: boolean
    }
  }>
  whyNowRefs: string[]
  noInterventionOutcome: { afterWorldTurns: number; description: string; effectPlanRef: string | null; advancesClockKeys: string[] }
  consequences: Array<{
    scope: 'actor' | 'faction' | 'location' | 'world-state' | 'party-identity'
    ref: string; effectPlanRef: string; nextSituationTemplateKey: string | null
    audience: 'gm-only' | 'party' | 'public'
  }>
  sourceRefs: string[]
}
export interface TtrpgOpenCompanionPolicyV1 {
  minimumCompanions: number
  maximumCompanions: number
  preauthorizedActionKinds: Array<'observe' | 'talk' | 'assist' | 'move' | 'low-risk-check'>
  confirmationRequiredKinds: Array<'irreversible' | 'resource-spend' | 'party-relation-change' | 'secret-reveal'>
  /** Required even in drafts; [] is incomplete authoring, never a publishable authorization. */
  approvalBindings: Array<{
    companionActorKey: string
    approverSeatKeys: string[]
    /** Party resources only; never authorizes another actor's secrets or personal resources. */
    partyResourceApprovalAllowed: boolean
  }>
}
/** V2 alone admits hybrid controllers; the V1 character contract stays unchanged. */
export interface TtrpgCharacterTemplateV2 extends Omit<TtrpgCharacterTemplateV1, 'controller'> {
  controller: TtrpgCharacterTemplateV1['controller'] | 'hybrid'
}
/** Identity fields from the actual V2 template, without claimed/accepted/revision state. */
export type TtrpgOpenApprovalActorV1 = Pick<TtrpgCharacterTemplateV2,
  'characterKey' | 'seatKey' | 'role' | 'controller'>
export interface TtrpgOpenStageClosurePolicyV1 {
  triggers: Array<{ triggerKey: string; predicate: TtrpgPredicateV1; summaryPrompt: string }>
  maximumWorldTurns: number
  continuation: 'author-confirmed-opening'
}
export interface TtrpgOpenRuntimePolicyV1 {
  enabled: boolean
  maximumCallsPerEpoch: number
  maxAiActions: number
  maximumOutputTokens: number
  maximumEpochTokens: number
  maximumEpochCostUsd: number
  maximumRepairAttempts: number
  failurePolicy: 'pause'
  unknownResultPolicy: 'pause-and-reconcile'
  outputMode: 'text'
}
export interface TtrpgOpenAuthoringV1 {
  contextPolicy?: import('./open-context-policy').TtrpgOpenContextPolicyV1
  factPolicy: Array<{ fact: TtrpgOpenFrozenFactV1; authorConfirmed: boolean }>
  situationTemplates: TtrpgSituationTemplateV1[]
  openingSituationKeys: string[]
  effectPlanTemplates: TtrpgOpenEffectPlanTemplateV1[]
  pressure: { clocks: TtrpgOpenCampaignClockV1[]; fronts: TtrpgOpenCampaignFrontV1[] }
  companionPolicy: TtrpgOpenCompanionPolicyV1 | null
  stageClosurePolicy: TtrpgOpenStageClosurePolicyV1 | null
  dynamicEntityTemplates: TtrpgOpenDynamicEntityTemplateV1[]
  runtimePolicy: TtrpgOpenRuntimePolicyV1 | null
}
export interface TtrpgOpenDesignProvenanceV1 {
  schema: 'storyforge.ttrpg-open-design-provenance'
  version: 1
  briefHash: string
  sourcePlanHash: string
  sourceFactsArtifactHash: string
  ruleSystemArtifactHash: string
  situationLayerArtifactHash: string
}
export interface TtrpgCampaignContentV2 extends Omit<TtrpgCampaignContentV1,
  'version' | 'openingSceneKey' | 'clocks' | 'fronts' | 'characterTemplates' | 'designProvenance'> {
  version: 2
  runFormat: 'open'
  contextPolicy?: import('./open-context-policy').TtrpgOpenContextPolicyV1
  characterTemplates: TtrpgCharacterTemplateV2[]
  openingSceneKey: string | null
  clocks: TtrpgOpenCampaignClockV1[]
  fronts: TtrpgOpenCampaignFrontV1[]
  frozenWorldPredicateIndex: TtrpgFrozenWorldPredicateIndexV1
  canonInvariantPredicates: TtrpgPredicateV1[]
  situationTemplates: TtrpgSituationTemplateV1[]
  openingSituationKeys: string[]
  effectPlanTemplates: TtrpgOpenEffectPlanTemplateV1[]
  companionPolicy: TtrpgOpenCompanionPolicyV1
  stageClosurePolicy: TtrpgOpenStageClosurePolicyV1
  dynamicEntityTemplates: TtrpgOpenDynamicEntityTemplateV1[]
  entityBindings: TtrpgOpenEntityBindingV1[]
  runtimePolicy: TtrpgOpenRuntimePolicyV1
  designProvenance: TtrpgCampaignContentV1['designProvenance'] | TtrpgOpenDesignProvenanceV1
}
