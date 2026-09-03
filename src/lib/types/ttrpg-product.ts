/**
 * TTRPG-2A product contracts. Rule packs are inert data: every operation is a
 * closed enum interpreted by StoryForge and no field may contain executable
 * JavaScript, URLs, provider credentials, or host capabilities.
 */

export type RuleNumberExpressionV1 =
  | { op: "constant"; value: number }
  | { op: "attribute"; key: string }
  | { op: "add"; values: RuleNumberExpressionV1[] }
  | {
      op: "multiply";
      left: RuleNumberExpressionV1;
      right: RuleNumberExpressionV1;
    }
  | { op: "floor-divide"; value: RuleNumberExpressionV1; divisor: number };

export interface RulePackLicenseV1 {
  licenseId: string;
  name: string;
  attribution: string;
  commercialUse: boolean;
  derivativesAllowed: boolean;
  sourceUrl: string | null;
}

export interface RuleAttributeDefinitionV1 {
  key: string;
  name: string;
  description: string;
  minimum: number;
  maximum: number;
  defaultValue: number;
}

export interface RuleDerivedStatDefinitionV1 {
  key: string;
  name: string;
  description: string;
  formula: RuleNumberExpressionV1;
  minimum: number | null;
  maximum: number | null;
}

export interface RuleDiceModelDefinitionV1 {
  key: string;
  name: string;
  count: number;
  sides: number;
  keep: "all" | "highest" | "lowest";
}

export interface TtrpgDiceExpressionV2 {
  schema: "storyforge.ttrpg-dice-expression";
  version: 2;
  count: number;
  sides: number;
  modifier: number;
  normalized: string;
}

export interface TtrpgDiceRollTraceV2 {
  algorithm: "uint32-rejection-v2";
  sides: number;
  requestedDice: number;
  consumedSamples: number;
  rejectedSamples: number;
}

export type TtrpgDegreeV2 =
  | "critical-success"
  | "extreme-success"
  | "hard-success"
  | "success"
  | "partial-success"
  | "failure"
  | "critical-failure";

export type TtrpgResolutionRequestV2 =
  | {
      mode: "total-vs-target";
      total: number;
      target: number;
      criticalSuccessMargin: number;
      criticalFailureMargin: number;
      partialSuccessWindow: number;
    }
  | {
      mode: "roll-under";
      roll: number;
      successMaximum: number;
      hardSuccessMaximum: number;
      extremeSuccessMaximum: number;
      criticalSuccessMaximum: number;
      criticalFailureMinimum: number;
    }
  | {
      mode: "success-pool";
      dice: number[];
      sides: number;
      successAtOrAbove: number;
      criticalAtOrAbove: number | null;
      criticalBonusSuccesses: number;
      botchAtOrBelow: number | null;
      botchesCancel: boolean;
      requiredSuccesses: number;
      criticalSuccesses: number;
      criticalFailureBotches: number;
    }
  | {
      mode: "opposed";
      contestants: Array<{
        contestantRef: string;
        degree: TtrpgDegreeV2;
        total: number;
        margin: number;
      }>;
      tieBreak: "higher-total" | "higher-margin" | "reroll" | "stalemate";
    }
  | {
      mode: "fixed/no-roll";
      degree: TtrpgDegreeV2;
      reason: string;
    };

export interface TtrpgResolutionOutcomeV2 {
  schema: "storyforge.ttrpg-resolution-outcome";
  version: 2;
  mode: TtrpgResolutionRequestV2["mode"];
  degree: TtrpgDegreeV2;
  succeeded: boolean;
  rolled: boolean;
  total: number | null;
  target: number | null;
  margin: number | null;
  successes: number | null;
  winnerRef: string | null;
  tiedRefs: string[];
  calculationTrace: string[];
}

export type TtrpgEffectAudienceV2 =
  "public" | "party" | "gm" | `actor:${string}`;

export type TtrpgEffectPrimitiveV2 =
  | {
      effectKey: string;
      family: "numeric";
      operation:
        | "resource.gain"
        | "resource.spend"
        | "resource.set"
        | "damage"
        | "healing"
        | "stress"
        | "currency";
      targetRef: string;
      valueKey: string;
      amount: number;
    }
  | {
      effectKey: string;
      family: "condition";
      operation: "condition.apply" | "condition.remove";
      targetRef: string;
      conditionKey: string;
      stacks: number;
      duration: number | null;
    }
  | {
      effectKey: string;
      family: "item";
      operation:
        | "item.grant"
        | "item.remove"
        | "item.transfer"
        | "item.use"
        | "item.damage"
        | "item.repair"
        | "item.equip";
      targetRef: string;
      itemDefinitionRef: string | null;
      itemInstanceRef: string | null;
      destinationRef: string | null;
      amount: number;
    }
  | {
      effectKey: string;
      family: "ability";
      operation:
        | "ability.unlock"
        | "ability.disable"
        | "usage.consume"
        | "usage.restore"
        | "usage.reset"
        | "cooldown.start"
        | "cooldown.clear";
      targetRef: string;
      abilityKey: string;
      amount: number | null;
      clockRef: string | null;
    }
  | {
      effectKey: string;
      family: "advancement";
      operation:
        | "xp"
        | "milestone"
        | "level"
        | "rank"
        | "attribute-points"
        | "skill-points"
        | "advancement.choice";
      targetRef: string;
      advancementKey: string;
      amount: number;
    }
  | {
      effectKey: string;
      family: "social";
      operation: "reputation" | "faction" | "relationship" | "wanted" | "debt";
      targetRef: string;
      socialKey: string;
      amount: number;
    }
  | {
      effectKey: string;
      family: "story";
      operation:
        | "clue.discover"
        | "secret.reveal"
        | "quest.set"
        | "clock.advance"
        | "location.set"
        | "world-fact.candidate";
      targetRef: string;
      storyKey: string;
      value: string | number | boolean | null;
    };

export interface TtrpgEffectPlanV2 {
  schema: "storyforge.ttrpg-effect-plan";
  version: 2;
  planKey: string;
  degree: TtrpgDegreeV2;
  sourceEventId: string;
  ruleRef: string;
  reason: string;
  audience: TtrpgEffectAudienceV2;
  idempotencyKey: string;
  status: "immediate" | "pending-choice";
  effects: TtrpgEffectPrimitiveV2[];
}

export interface TtrpgEffectLedgerTransitionV2 {
  effectKey: string;
  family: TtrpgEffectPrimitiveV2["family"];
  operation: string;
  targetRef: string;
  beforeJson: string;
  afterJson: string;
}

export interface TtrpgEffectLedgerEntryV2 {
  eventSequence: number;
  planKey: string;
  degree: TtrpgDegreeV2;
  sourceEventId: string;
  ruleRef: string;
  reason: string;
  audience: TtrpgEffectAudienceV2;
  idempotencyKey: string;
  transitions: TtrpgEffectLedgerTransitionV2[];
}

/**
 * A GM-authored, mutually-exclusive consequence offer. No effect is applied
 * until the owning human seat (or the GM for an AI-only seat) selects exactly
 * one frozen primitive through a second authoritative command.
 */
export interface TtrpgPendingEffectChoiceV2 {
  choiceKey: string;
  proposedEventSequence: number;
  actionSequence: number;
  ownerActorKey: string;
  plan: TtrpgEffectPlanV2;
}

export interface TtrpgEffectLedgerStateV2 {
  schema: "storyforge.ttrpg-effect-ledger";
  version: 2;
  appliedIdempotencyKeys: string[];
  advancementBalances: Record<string, number>;
  socialBalances: Record<string, number>;
  storyClocks: Record<string, number>;
  storyFacts: Record<string, string | number | boolean | null>;
  pendingChoices: TtrpgPendingEffectChoiceV2[];
  entries: TtrpgEffectLedgerEntryV2[];
}

export type TtrpgResetTriggerV2 =
  | "turn"
  | "round"
  | "scene"
  | "short-rest"
  | "long-rest"
  | "session"
  | "milestone"
  | "manual-gm";

export interface TtrpgAbilityDefinitionV2 {
  abilityKey: string;
  actionDefinitionKey: string;
  usage: {
    mode:
      "unlimited" | "charges" | "resource-cost" | "cooldown" | "shared-pool";
    maximum: number | null;
    resourceKey: string | null;
    cost: number | null;
    sharedPoolKey: string | null;
    cooldownRounds: number | null;
    reset: TtrpgResetTriggerV2[];
  };
}

export interface TtrpgAbilityRuntimeStateV2 {
  actorInstanceId: string;
  abilityKey: string;
  remainingUses: number | null;
  cooldownUntilRound: number | null;
  disabledReasons: string[];
  lastUsedEventId: string | null;
}

export interface TtrpgUsagePoolStateV2 {
  poolKey: string;
  maximum: number;
  remaining: number;
  lastChangedEventId: string | null;
}

export interface TtrpgItemDefinitionV2 {
  itemKey: string;
  title: string;
  category: string;
  tags: string[];
  stackPolicy: "unique" | "stackable";
  maxStack: number | null;
  weight: number | null;
  equipSlots: string[];
  requiresAttunement: boolean;
  maximumCharges: number | null;
  maximumDurability: number | null;
  useActions: string[];
  publicDescription: string;
  secretPropertyKeys: string[];
}

export interface TtrpgItemInstanceV2 {
  itemInstanceId: string;
  definitionRef: string;
  ownerRef: string | null;
  containerRef: string | null;
  locationRef: string | null;
  quantity: number;
  charges: number | null;
  durability: number | null;
  equippedSlots: string[];
  attunedToActorRef: string | null;
  identification: "unknown" | "partly-known" | "identified";
  acquiredByEventId: string;
  customName: string | null;
  stateTags: string[];
}

export interface TtrpgInventoryStateV2 {
  schema: "storyforge.ttrpg-inventory";
  version: 2;
  items: Record<string, TtrpgItemInstanceV2>;
  appliedCommandIds: string[];
}

export interface RuleTotalVsTargetCheckDefinitionV1 {
  key: string;
  name: string;
  diceModelKey: string;
  attributeKeys: string[];
  targetMode: "meet-or-beat";
  defaultDifficulty: number;
  criticalSuccessMargin: number;
  criticalFailureMargin: number;
}

export type RuleCheckResolverV2 =
  | {
      mode: "total-vs-target";
      defaultDifficulty: number;
      criticalSuccessMargin: number;
      criticalFailureMargin: number;
      partialSuccessWindow: number;
      /** Optional natural-face overrides for d20-style checks. */
      naturalCriticalSuccessAtOrAbove?: number | null;
      naturalCriticalFailureAtOrBelow?: number | null;
    }
  | {
      mode: "roll-under";
      /** If omitted by the command, the acting attribute is the success threshold. */
      defaultDifficulty: number | null;
      hardDivisor: number;
      extremeDivisor: number;
      criticalSuccessMaximum: number;
      criticalFailureMinimum: number;
    }
  | {
      mode: "success-pool";
      /** Required net successes; a command may override it within parser bounds. */
      defaultDifficulty: number;
      dicePerAttributePoint: number;
      minimumDice: number;
      maximumDice: number;
      successAtOrAbove: number;
      criticalAtOrAbove: number | null;
      criticalBonusSuccesses: number;
      botchAtOrBelow: number | null;
      botchesCancel: boolean;
      criticalSuccesses: number;
      criticalFailureBotches: number;
    }
  | {
      mode: "opposed";
      defaultDifficulty: number;
      criticalSuccessMargin: number;
      criticalFailureMargin: number;
      partialSuccessWindow: number;
      tieBreak: "higher-total" | "higher-margin" | "reroll" | "stalemate";
      naturalCriticalSuccessAtOrAbove?: number | null;
      naturalCriticalFailureAtOrBelow?: number | null;
    };

export interface RuleResolvedCheckDefinitionV2 {
  key: string;
  name: string;
  diceModelKey: string;
  attributeKeys: string[];
  resolver: RuleCheckResolverV2;
}

/** V1 meet-or-beat checks remain byte-for-byte stable in frozen releases. */
export type RuleCheckDefinitionV1 =
  RuleTotalVsTargetCheckDefinitionV1 | RuleResolvedCheckDefinitionV2;

export interface RuleResourceDefinitionV1 {
  key: string;
  name: string;
  description: string;
  maximumFormula: RuleNumberExpressionV1;
  initialMode: "maximum" | "zero";
  minimum: number;
}

export interface RuleConditionDefinitionV1 {
  key: string;
  name: string;
  description: string;
  stacking: "replace" | "stack";
  maximumStacks: number;
  defaultDurationRounds: number | null;
  checkModifier: number;
}

export interface RuleActionEffectApplicationV2 {
  /** Omitted preserves the V1 rule: apply whenever the check succeeds. */
  appliesOnDegrees?: Array<"automatic" | TtrpgDegreeV2>;
  /** Omitted targets the action target (or actor for scene/self actions). */
  targetScope?: "action-target" | "actor";
}

export type RuleActionEffectV1 =
  | { kind: "check"; checkKey: string; attributeKey: string }
  | (RuleActionEffectApplicationV2 & {
      kind: "resource";
      resourceKey: string;
      delta: number;
    })
  | (RuleActionEffectApplicationV2 & {
      kind: "damage";
      resourceKey: string;
      diceModelKey: string;
      modifierAttributeKey: string | null;
    })
  | (RuleActionEffectApplicationV2 & {
      kind: "condition";
      conditionKey: string;
      stacks: number;
    });

/**
 * Data-only legality predicates evaluated before dice, costs and turn budgets.
 * Multiple requirements are conjunctive. The field stays optional so existing
 * immutable V1 packs keep their byte-for-byte shape and content hash.
 */
export type RuleActionRequirementV2 =
  | {
      kind: "resource";
      resourceKey: string;
      operator: "at-most" | "at-least";
      value: number;
    }
  | {
      kind: "condition";
      conditionKey: string;
      operator: "present" | "absent";
      /** present means at least this many stacks; absent requires zero. */
      stacks: number;
    };

export interface RuleActionDefinitionV1 {
  key: string;
  name: string;
  description: string;
  phase: "free" | "action" | "reaction" | "downtime";
  target: "self" | "single-ally" | "single-enemy" | "scene";
  costResourceKey: string | null;
  costAmount: number;
  /** Deterministic per-character usage policy; enforced before effects commit. */
  usage: TtrpgAbilityDefinitionV2["usage"];
  requirements?: RuleActionRequirementV2[];
  effects: RuleActionEffectV1[];
}

export interface RuleTurnStructureV1 {
  initiativeDiceModelKey: string;
  initiativeAttributeKey: string;
  phases: Array<"start" | "action" | "end">;
  actionsPerTurn: number;
  reactionsPerRound: number;
}

export interface RuleItemDefinitionV1 {
  key: string;
  name: string;
  description: string;
  tags: string[];
  grantedActionKeys: string[];
  /** Optional complete inventory behavior. Absence preserves legacy persistent unique-item semantics. */
  mechanics?: {
    category: string;
    stackPolicy: "unique" | "stackable";
    maxStack: number | null;
    weight: number | null;
    equipSlots: string[];
    requiresAttunement: boolean;
    maximumCharges: number | null;
    maximumDurability: number | null;
  };
}

export interface RuleAdvancementDefinitionV1 {
  currencyKey: string;
  currencyName: string;
  awardPerMilestone: number;
  attributeIncreaseCost: number;
  maximumAttributeValue: number;
  /** Optional only for legacy packs; built-in/current packs declare a complete growth model. */
  progressionModel?: TtrpgCharacterProgressionModelV2;
  skillIncreaseCost?: number;
  maximumSkillValue?: number;
  levelIncreaseCost?: number;
  maximumLevel?: number;
  rankOrder?: string[];
  rankIncreaseCost?: number;
}

export interface RuleCharacterSheetSchemaV1 {
  sections: Array<{
    key: string;
    title: string;
    fieldKeys: string[];
  }>;
}

export type TtrpgCharacterAuthoringModeV2 =
  "manual" | "guided" | "ai" | "world-conversion";
export type TtrpgCharacterProgressionModelV2 =
  "numeric-level" | "rank" | "point-buy" | "classless";

export interface TtrpgCharacterRelationshipV2 {
  targetRef: string;
  label: string;
  bond: string;
  visibility: "public" | "private" | "gm-only";
}

export interface TtrpgCharacterWorldBindingV2 {
  kind:
    | "character"
    | "location"
    | "faction"
    | "artifact"
    | "event"
    | "lore"
    | "custom";
  key: string;
  label: string;
  sourceRefs: string[];
}

/**
 * Complete, frozen character card. Narrative identity and mechanical build are
 * deliberately separated: world material can ground identity, but only the
 * RulePack-validated build grants mechanical authority.
 */
export interface TtrpgCharacterSheetV2 {
  schema: "storyforge.ttrpg-character-sheet";
  version: 2;
  characterKey: string;
  identity: {
    name: string;
    pronouns: string;
    gender: string;
    age: string;
    ancestry: string;
    occupation: string;
    appearance: string;
    origin: string;
    background: string;
    personalityTraits: string[];
    beliefs: string[];
    flaws: string[];
    fears: string[];
    desires: string[];
    boundaries: string[];
    shortTermGoal: string;
    longTermGoal: string;
    publicKnowledge: string[];
    privateKnowledge: string[];
    safetyNotes: string[];
    portrayal: string;
    voice: string;
    sampleLines: string[];
    relationships: TtrpgCharacterRelationshipV2[];
    worldBindings: TtrpgCharacterWorldBindingV2[];
  };
  rules: {
    progression: {
      model: TtrpgCharacterProgressionModelV2;
      level: number | null;
      rankKey: string | null;
      experience: number;
      unspentPoints: number;
    };
    attributes: Record<string, number>;
    skills: Record<string, number>;
    resourceKeys: string[];
    defenseKeys: string[];
    proficiencyKeys: string[];
    abilityKeys: string[];
    itemKeys: string[];
    currency: Record<string, number>;
  };
  authoring: {
    mode: TtrpgCharacterAuthoringModeV2;
    rationale: string;
    sourceRefs: string[];
    license: string;
    lockedFields: string[];
  };
  gates: {
    characterComplete: boolean;
    ruleLegal: boolean;
    playableRole: boolean;
    secretScope: boolean;
    validatedAgainst: string;
  };
}

export interface TtrpgCharacterSheetDraftV2 {
  characterKey: string;
  identity: Omit<
    TtrpgCharacterSheetV2["identity"],
    "relationships" | "worldBindings"
  >;
  attributes: Record<string, number>;
}

export interface RuleCompendiumEntryV1 {
  key: string;
  title: string;
  category:
    | "core"
    | "check"
    | "combat"
    | "condition"
    | "item"
    | "advancement"
    | "safety";
  body: string;
  relatedKeys: string[];
}

export interface RulePackMigrationV1 {
  fromVersion: string;
  toVersion: string;
  compatibility: "compatible" | "migration-required" | "breaking";
  notes: string;
}

export interface RulePackFixtureV1 {
  fixtureKey: string;
  attributes: Record<string, number>;
  expectedDerivedStats: Record<string, number>;
  expectedResourceMaximums: Record<string, number>;
}

export interface RulePackV1 {
  schema: "storyforge.rule-pack";
  version: 1;
  ruleSystemId: string;
  ruleSystemVersion: string;
  title: string;
  description: string;
  license: RulePackLicenseV1;
  attributes: RuleAttributeDefinitionV1[];
  derivedStats: RuleDerivedStatDefinitionV1[];
  diceModels: RuleDiceModelDefinitionV1[];
  checks: RuleCheckDefinitionV1[];
  resources: RuleResourceDefinitionV1[];
  conditions: RuleConditionDefinitionV1[];
  actions: RuleActionDefinitionV1[];
  turnStructure: RuleTurnStructureV1;
  items: RuleItemDefinitionV1[];
  advancement: RuleAdvancementDefinitionV1;
  characterSheetUi: RuleCharacterSheetSchemaV1;
  compendium: RuleCompendiumEntryV1[];
  migrations: RulePackMigrationV1[];
  tests: RulePackFixtureV1[];
}

export interface FrozenRulePackV1 {
  content: RulePackV1;
  contentHash: string;
}

export interface TtrpgHouseRulePatchV2 {
  patchKey: string;
  operation: "replace";
  path: string;
  value: string | number;
  reason: string;
}

/**
 * A house-rule overlay is always bound to an exact immutable RulePack hash.
 * It can only touch the closed, data-only whitelist enforced by the parser.
 */
export interface TtrpgHouseRuleOverlayV2 {
  schema: "storyforge.ttrpg-house-rule-overlay";
  version: 2;
  overlayKey: string;
  title: string;
  author: string;
  baseRuleSystemId: string;
  baseRuleSystemVersion: string;
  baseContentHash: string;
  patches: TtrpgHouseRulePatchV2[];
}

export interface TtrpgHouseRuleDiffV2 {
  patchKey: string;
  path: string;
  before: string | number;
  after: string | number;
  reason: string;
}

export interface TtrpgCharacterTemplateV1 {
  characterKey: string;
  /** Production seat identity; legacy releases derive player.N by roster order. */
  seatKey?: string;
  name: string;
  description: string;
  sourceRefs: string[];
  role: "player" | "npc";
  /**
   * Frozen seat authority. Legacy releases omit this field and are interpreted
   * as human-controlled players / GM-controlled NPCs. New production builds
   * persist it so reaction orchestration cannot make an AI act for a human.
   */
  controller?: "human" | "ai" | "open" | "gm";
  attributes: Record<string, number>;
  attributeMappings: Record<
    string,
    {
      value: number;
      derivationRule: string;
      sourceRefs: string[];
      authorConfirmed: boolean;
    }
  >;
  skills: Record<string, number>;
  resources: Record<string, number>;
  itemKeys: string[];
  actionKeys: string[];
  portraitAssetKey: string | null;
  /** Optional only for legacy releases. Every new production build freezes it. */
  characterSheet?: TtrpgCharacterSheetV2;
  /** Private player intent is only projected to that seat and the GM. */
  playerProfile?: {
    privateGoal: string;
    secret: string;
    portrayal: string;
  };
  /** Optional for legacy releases; new NPC templates freeze this GM-only prep card. */
  gmProfile?: {
    objective: string;
    leverage: string;
    secret: string;
    portrayal: string;
    escalation: string;
  };
}

export interface TtrpgClueV1 {
  clueKey: string;
  title: string;
  description: string;
  conclusionKey: string;
  required: boolean;
  discoveryPaths: Array<{
    pathKey: string;
    sceneKey: string;
    actionKey: string;
    failForward: string;
  }>;
  visibility: "gm-only" | "discoverable" | "public";
  sourceRefs: string[];
}

export interface TtrpgSceneV1 {
  sceneKey: string;
  title: string;
  description: string;
  locationKey: string | null;
  participantKeys: string[];
  clueKeys: string[];
  actionKeys: string[];
  nextSceneKeys: string[];
  failureForward: string;
  gmSecret: string;
  sourceRefs: string[];
  /** Optional for legacy CampaignPacks; new campaigns bind a frozen tabletop map. */
  tabletopMapKey?: string | null;
}

/** Frozen campaign truth bible. These values are GM-authority facts, not prose hints. */
export interface TtrpgCampaignBibleV1 {
  premise: string;
  background: string;
  coreConflict: string;
  themes: string[];
  canonInvariants: string[];
  sourceRefs: string[];
}

/** A bounded pressure track used by the GM and deterministic effect ledger. */
export interface TtrpgCampaignClockV1 {
  clockKey: string;
  title: string;
  description: string;
  initialValue: number;
  maximum: number;
  advanceTriggers: Array<{
    triggerKey: string;
    sceneKey: string | null;
    actionKey: string | null;
    amount: number;
    reason: string;
  }>;
  onComplete: string;
  visibility: "gm-only" | "party" | "public";
  sourceRefs: string[];
}

/** A threat with an explicit goal, cast and one or more deterministic clocks. */
export interface TtrpgCampaignFrontV1 {
  frontKey: string;
  title: string;
  goal: string;
  participantKeys: string[];
  clockKeys: string[];
  escalation: string[];
  defeatConditions: string[];
  sourceRefs: string[];
}

/** Structured secret whose reveal path can be audited against the clue graph. */
export interface TtrpgCampaignSecretV1 {
  secretKey: string;
  title: string;
  truth: string;
  holderKeys: string[];
  relatedClueKeys: string[];
  revealRule: string;
  visibility: "gm-only" | "character-private";
  sourceRefs: string[];
}

export interface TtrpgCampaignEndingV1 {
  endingKey: string;
  title: string;
  requirements: string[];
  epilogue: string;
  /** Optional only for legacy packs; every production campaign freezes a machine-checkable trigger. */
  trigger?: {
    sceneKey: string;
    requiredConclusionKeys: string[];
    forbiddenConclusionKeys: string[];
  };
}

export interface TtrpgTabletopMapV1 {
  mapKey: string;
  title: string;
  width: number;
  height: number;
  backgroundAssetKey: string | null;
  fallbackDescription: string;
  grid: {
    kind: "square" | "zone";
    cellSize: number;
    distancePerCell: number;
    unit: string;
  };
  layers: Array<{
    layerKey: string;
    title: string;
    kind: "terrain" | "objects" | "annotation";
    zIndex: number;
    opacity: number;
    gmOnly: boolean;
  }>;
  areas: Array<{
    areaKey: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    gmOnly: boolean;
  }>;
  tokens: Array<{
    tokenKey: string;
    entityKey: string;
    x: number;
    y: number;
    size: number;
    controllerKey: string | null;
    hidden: boolean;
  }>;
  fog: Array<{
    fogKey: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface TtrpgTabletopPresentationV1 {
  maps: TtrpgTabletopMapV1[];
}

export const TTRPG_RUNTIME_MEDIA_KINDS_V1 = [
  "scene",
  "map",
  "character-portrait",
  "character-expression",
  "token",
  "item-icon",
  "handout",
] as const;
export type TtrpgRuntimeMediaKindV1 =
  (typeof TTRPG_RUNTIME_MEDIA_KINDS_V1)[number];

export type TtrpgRuntimeMediaAudienceV1 =
  "public" | "party" | "private" | "gm-only";

/** Frozen visual identity used by both production-time and runtime generation. */
export interface TtrpgVisualBibleV1 {
  schema: "storyforge.ttrpg-visual-bible";
  version: 1;
  style: {
    description: string;
    medium: string;
    composition: string;
    colorPalette: string[];
    era: string;
    prohibitedElements: string[];
    referenceLicense: string;
  };
  characters: Array<{
    characterKey: string;
    identityPrompt: string;
    silhouette: string;
    attire: string;
    markers: string[];
    colorPalette: string[];
    expressionBaselines: Array<{ expressionKey: string; prompt: string }>;
    referenceAssetKeys: string[];
  }>;
  locations: Array<{
    locationKey: string;
    identityPrompt: string;
    architecture: string;
    weather: string;
    timeOfDay: string;
    lighting: string;
    anchors: string[];
    referenceAssetKeys: string[];
  }>;
  provenancePolicy: {
    rightsPolicyVersion: string;
    allowedSources: string[];
    requirePromptReceipt: boolean;
    requireHumanAdoptionForRelease: boolean;
  };
}

/** A stable presentation slot. Missing bytes always retain a playable text fallback. */
export interface TtrpgMediaManifestV1 {
  schema: "storyforge.ttrpg-media-manifest";
  version: 1;
  slots: Array<{
    slotKey: string;
    kind: TtrpgRuntimeMediaKindV1;
    targetRef: string;
    audience: TtrpgRuntimeMediaAudienceV1;
    productionRequired: boolean;
    assetKey: string | null;
    fallbackText: string;
    altText: string;
    promptTemplate: string;
    width: number | null;
    height: number | null;
  }>;
  runtimePolicy: {
    enabled: boolean;
    networkPolicy: "any" | "wifi-only" | "disabled";
    maximumSessionCostUsd: number;
    maximumConcurrentRequests: number;
    maximumAttempts: number;
    maximumGeneratedAssets: number;
    allowProviderFallback: boolean;
  };
}

export interface TtrpgCampaignContentV1 {
  schema: "storyforge.ttrpg-campaign";
  version: 1;
  campaignKey: string;
  /** Formal table authority for the GM seat; legacy releases default to human. */
  gmMode?: "human" | "ai" | "hybrid";
  title: string;
  pitch: string;
  playerCount: { minimum: number; maximum: number };
  estimatedMinutes: number;
  tags: string[];
  difficulty: "introductory" | "standard" | "challenging";
  contentWarnings: string[];
  sessionZero: {
    premise: string;
    consentChecklist: string[];
    lines: string[];
    veils: string[];
    pauseSignal: string;
    openDoor: boolean;
  };
  /** Optional only for legacy packs; new production campaigns freeze these authoring structures. */
  bible?: TtrpgCampaignBibleV1;
  clocks?: TtrpgCampaignClockV1[];
  fronts?: TtrpgCampaignFrontV1[];
  secrets?: TtrpgCampaignSecretV1[];
  /** Proposal/mixing provenance copied from the frozen Production Brief. */
  designProvenance?: {
    origin: "author-guided" | "ai-candidate";
    proposalKeys: string[];
    baseProposalKey: string;
    sectionSources: Record<"background" | "coreConflict" | "opening" | "fronts" | "secrets" | "endings", string>;
    lockedSections: Array<"background" | "coreConflict" | "opening" | "fronts" | "secrets" | "endings">;
    candidateHash: string | null;
  };
  /** Frozen table-information policy. Legacy CampaignPacks default to public dice. */
  informationPolicy?: {
    characterPrivateChannels: boolean;
    gmSecrets: boolean;
    hiddenNpcState: boolean;
    hiddenDice: "never" | "gm-only" | "allowed";
    interPlayerWhispers: boolean;
    revealAuditTrail: boolean;
  };
  openingSceneKey: string;
  characterTemplates: TtrpgCharacterTemplateV1[];
  scenes: TtrpgSceneV1[];
  clues: TtrpgClueV1[];
  quests: Array<{
    questKey: string;
    title: string;
    objective: string;
    requiredConclusionKeys: string[];
    failureForward: string;
  }>;
  endings: TtrpgCampaignEndingV1[];
  handouts: Array<{
    handoutKey: string;
    title: string;
    body: string;
    revealClueKey: string | null;
    assetKey: string | null;
    fallbackText: string;
  }>;
  advancementMilestones: Array<{
    milestoneKey: string;
    title: string;
    award: number;
  }>;
  /** Optional for legacy CampaignPacks; generated campaigns include a data-only tabletop. */
  tabletop?: TtrpgTabletopPresentationV1;
  /** Optional for legacy releases; new production campaigns freeze continuity and runtime slots. */
  visualBible?: TtrpgVisualBibleV1;
  mediaManifest?: TtrpgMediaManifestV1;
  sourceWorld: {
    contentHash: string;
    bundleHash: string;
  };
}

export interface TtrpgSessionConsentPolicyV2 {
  safetyBoundariesAccepted: boolean;
  aiIdentityDisclosed: boolean;
  aiAdviceAllowed: boolean;
  aiSubstitutionAllowed: boolean;
  pvpAllowed: boolean;
  characterDeathAllowed: boolean;
  sessionLoggingAllowed: boolean;
  generatedPortraitAllowed: boolean;
  publicSharingAllowed: boolean;
}

/**
 * Instance-owned table authority for one GM/player/spectator seat. It contains
 * no account token or contact PII; online identity providers bind their own
 * opaque principal to viewerKey at the service boundary.
 */
export interface TtrpgSessionParticipantRecordV2 {
  id?: number;
  projectId: number;
  worldGroupId: number | null;
  worldId: number;
  workId: number;
  sessionId: number;
  seatKey: string;
  role: "gm" | "player" | "spectator";
  controller: "human" | "ai" | "hybrid" | "vacant";
  actorKey: string | null;
  viewerKey: string;
  assignmentState: "assigned" | "claimed" | "vacant" | "left";
  humanAssignmentPolicy: "owner" | "invite" | "claim-at-session-zero" | null;
  activation: "manual" | "initiative" | "natural" | "pooled";
  substitutionPolicy:
    "never" | "with-owner-consent" | "automatic-after-timeout";
  aiProfile: null | {
    agency: "reactive" | "balanced" | "proactive";
    riskTolerance: "safe" | "balanced" | "bold";
    latencyBudgetMs: number;
    costBudgetPerSessionUsd: number;
  };
  consent: TtrpgSessionConsentPolicyV2;
  sessionZeroAcceptedAtSequence: number | null;
  revision: number;
  lastCommandId: string;
  lastCommandFingerprint: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Instance-owned durable runtime-media job. Provider credentials and raw bytes
 * are deliberately absent: bytes live in the shared governed media tables.
 */
export interface TtrpgRuntimeAssetRequestRecordV1 {
  id?: number;
  projectId: number;
  worldGroupId: number | null;
  worldId: number;
  workId: number;
  sessionId: number;
  requestKey: string;
  slotKey: string;
  kind: TtrpgRuntimeMediaKindV1;
  targetRef: string;
  audience: TtrpgRuntimeMediaAudienceV1;
  requesterViewerKey: string;
  prompt: string;
  negativePrompt: string;
  fallbackText: string;
  altText: string;
  styleBibleHash: string;
  inputHash: string;
  adapterId: string;
  status: "queued" | "generating" | "available" | "failed" | "cancelled";
  priority: number;
  attemptCount: number;
  maximumAttempts: number;
  maximumSessionCostUsd: number;
  estimatedCostUsd: number | null;
  costReservationUsd: number;
  actualCostUsd: number | null;
  estimatedStorageBytes: number | null;
  mediaAssetId: number | null;
  mediaAssetVersion: number | null;
  mediaContentHash: string | null;
  processorLeaseId: string | null;
  processorLeaseExpiresAt: number | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  requestedAtSequence: number;
  terminalEventSequence: number | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface TtrpgRuntimeContentV1 {
  rulePack: FrozenRulePackV1;
  campaign: TtrpgCampaignContentV1;
  compatibility: {
    runtimeProtocol: 1;
    minimumPlayerVersion: 1;
  };
}

export interface TtrpgRulePackRecordV1 {
  id?: number;
  projectId: number;
  worldId: number;
  workId: number;
  ruleSystemId: string;
  ruleSystemVersion: string;
  title: string;
  status: "draft" | "validated" | "archived";
  rulePackJson: string;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}
