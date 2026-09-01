import type {
  NarrativeModuleKind,
  NarrativeNodeKind,
} from "./narrative-blueprint";
import type {
  FrozenNarrativeBeat,
  FrozenNarrativeChoice,
  NarrativeChoiceHistoryEntry,
} from "./text-game";
import type { InteractionRelationshipRule } from "./character-interaction";
import type { SimulationAdventureState } from "./adventure";
import type { SimulationAvgPresentationState } from "./avg";
import type { SimulationNarrativeSimulationState } from "./narrative-simulation";
import type { SimulationOpenWorldState } from "./open-world";
import type {
  TtrpgAbilityRuntimeStateV2,
  TtrpgDegreeV2,
  TtrpgDiceRollTraceV2,
  TtrpgEffectLedgerStateV2,
  TtrpgCharacterSheetV2,
  TtrpgInventoryStateV2,
  TtrpgItemInstanceV2,
  TtrpgResolutionRequestV2,
  TtrpgUsagePoolStateV2,
} from "./ttrpg-product";

export const SIMULATION_SESSION_KINDS = [
  "sandbox",
  "npc-evolution",
  "ttrpg",
  "chatgame",
  "storygame",
  "textadventure",
  "avg",
  "textsimulation",
  "textworld",
] as const;
export type SimulationSessionKind = (typeof SIMULATION_SESSION_KINDS)[number];

export const SIMULATION_SESSION_STATUSES = [
  "active",
  "paused",
  "archived",
] as const;
export type SimulationSessionStatus =
  (typeof SIMULATION_SESSION_STATUSES)[number];

export const RUNTIME_ENTITY_KINDS = [
  "character",
  "npc",
  "player",
  "location",
  "item",
  "faction",
] as const;
export type RuntimeEntityKind = (typeof RUNTIME_ENTITY_KINDS)[number];

export const RUNTIME_LIFECYCLE_STATUSES = [
  "active",
  "inactive",
  "dead",
  "destroyed",
] as const;
export type RuntimeLifecycleStatus =
  (typeof RUNTIME_LIFECYCLE_STATUSES)[number];

export type RuntimeScalar = string | number | boolean | null;
export type RuntimeAttributes = Record<string, RuntimeScalar>;

export const SIMULATION_CANON_SOURCE_KINDS = [
  "world",
  "character",
  "location",
  "item",
  "faction",
  "rule",
] as const;
export type SimulationCanonSourceKind =
  (typeof SIMULATION_CANON_SOURCE_KINDS)[number];

export interface SimulationCanonSource {
  sourceKey: string;
  kind: SimulationCanonSourceKind;
  /** 审计用原始记录 ID；冻结后不再作为可变 Canon 外键读取。 */
  recordId: number | null;
  name: string;
  summary: string;
  fields: Record<string, string>;
  updatedAt: number;
  contentHash: string;
}

export interface SimulationCanonSnapshotV1 {
  schema: "storyforge.simulation-canon";
  version: 1;
  createdAt: number;
  worldGroupId: number | null;
  worldLabel: string;
  sources: SimulationCanonSource[];
  snapshotHash: string;
}

export interface SimulationCanonCandidate {
  sourceKey: string;
  kind: SimulationCanonSourceKind;
  recordId: number | null;
  name: string;
  summary: string;
  fields: Record<string, string>;
  updatedAt: number;
}

export interface RuntimeEntityState {
  entityKey: string;
  kind: RuntimeEntityKind;
  sourceId?: number | null;
  name: string;
  locationKey?: string | null;
  lifecycleStatus: RuntimeLifecycleStatus;
  attributes: RuntimeAttributes;
}

export type RuntimeMemoryStatus = "known" | "mistaken" | "forgotten";

export interface RuntimeMemory {
  id: string;
  subjectKey: string;
  status: RuntimeMemoryStatus;
  content: string;
  sourceEventSequence: number;
}

export interface SimulationNpcEvolutionCandidate {
  /** 生成候选时的运行时序号；确认前若会话已继续追加事件则必须重新生成。 */
  baseSequence: number;
  entityKey: string;
  locationKey: string | null;
  lifecycleStatus: RuntimeLifecycleStatus;
  /** 只允许写入运行时实体的标量属性补丁。 */
  attributes: RuntimeAttributes;
  narrative: string;
  memory: {
    status: RuntimeMemoryStatus;
    content: string;
  } | null;
  rationale: string;
}

export interface SimulationNpcEvolutionProposal extends SimulationNpcEvolutionCandidate {
  proposalSequence: number;
}

export interface SimulationTtrpgScene {
  sceneId: string;
  /** Stable CampaignPack scene key; null for legacy free-form scenes. */
  sceneKey?: string | null;
  title: string;
  description: string;
  locationKey: string | null;
  status: "active" | "resolved";
}

export interface SimulationTtrpgAction {
  eventSequence: number;
  actorKey: string;
  text: string;
}

export interface SimulationTtrpgCheck {
  eventSequence: number;
  actorKey: string;
  skill: string;
  expression: string;
  dice: number[];
  modifier: number;
  total: number;
  dc: number;
  success: boolean;
  /** Defaults to public when replaying a legacy event. */
  visibility?: "public" | "gm-only";
  /** Formal RulePack evidence. Legacy free-form checks omit this block. */
  rule?: {
    actionKey: string;
    checkKey: string;
    attributeKey: string;
    /** Character-sheet skill selected by the action; legacy events omit both fields. */
    skillKey?: string;
    skillValue?: number;
    diceModelKey: string;
    rolledDice: number[];
    keptDice: number[];
    degree: TtrpgDegreeV2;
    /** Omitted only by legacy total-vs-target events. */
    mode?: TtrpgResolutionRequestV2["mode"];
    successes?: number | null;
    winnerRef?: string | null;
    tiedRefs?: string[];
    calculationTrace?: string[];
    /** Opposed-check receipt for the target; null for non-opposed checks. */
    opponent?: {
      contestantRef: string;
      attributeKey: string;
      rolledDice: number[];
      keptDice: number[];
      attributeModifier: number;
      total: number;
      degree: TtrpgDegreeV2;
      rollTrace: TtrpgDiceRollTraceV2;
      proofHash: string;
    } | null;
    /** Null only when replaying a pre-V2 event written before rejection-sampling traces. */
    rollTrace: TtrpgDiceRollTraceV2 | null;
    seedCommitment: string | null;
    nonce: string | null;
    proofHash: string;
    rulePackContentHash: string;
  } | null;
}

export interface SimulationTtrpgState {
  scene: SimulationTtrpgScene | null;
  round: number;
  activeActorKey: string | null;
  turnOrder: string[];
  /** Deterministic RulePack initiative receipt for the active formal scene. */
  initiative?: {
    sceneKey: string;
    diceModelKey: string;
    attributeKey: string;
    entries: Array<{
      actorKey: string;
      rolledDice: number[];
      keptDice: number[];
      modifier: number;
      total: number;
      rollTrace: TtrpgDiceRollTraceV2;
      seedCommitment: string;
      nonce: string;
      proofHash: string;
    }>;
  } | null;
  actions: SimulationTtrpgAction[];
  checks: SimulationTtrpgCheck[];
  attacks: SimulationTtrpgAttackResult[];
  encounter: SimulationTtrpgEncounter | null;
  /** 长期战役资料；旧跑团存档缺失时按空状态处理。 */
  campaign?: SimulationTtrpgCampaignState | null;
  /** Formal GameRelease projection; absent on legacy world-only sessions. */
  product?: SimulationTtrpgProductStateV1 | null;
}

export interface SimulationTtrpgProductStateV1 {
  rulePackContentHash: string;
  campaignKey: string;
  campaignTitle: string;
  openingSceneKey: string;
  sessionZero: {
    completed: boolean;
    requiredItemKeys: string[];
    acceptedItemKeys: string[];
    /** Player character roster frozen by Session Zero for this campaign instance. */
    selectedCharacterKeys: string[];
    completedBy: string | null;
    completedAtSequence: number | null;
  };
  safety: {
    status: "active" | "paused";
    reason: string | null;
    changedBy: string | null;
    changedAtSequence: number | null;
  };
  /** Frozen CampaignPack policy; absent legacy states are treated as never. */
  hiddenDicePolicy?: "never" | "gm-only" | "allowed";
  sceneKeys: string[];
  openedSceneKeys: string[];
  clueCatalog: Array<{
    clueKey: string;
    conclusionKey: string;
    required: boolean;
    sourceVisibility: "gm-only" | "discoverable" | "public";
  }>;
  /** Frozen CampaignPack clocks; absent legacy states retain an empty catalog. */
  clockCatalog?: Array<{
    clockKey: string;
    title: string;
    initialValue: number;
    maximum: number;
    visibility: "gm-only" | "party" | "public";
    onComplete: string;
  }>;
  discoveredClues: Array<{
    clueKey: string;
    actorKey: string;
    visibility: "private" | "party";
    eventSequence: number;
  }>;
  conditions: Record<
    string,
    Array<{
      conditionKey: string;
      stacks: number;
      duration: number | null;
    }>
  >;
  /** V2 action/reaction budget. Null only for pre-V2 replay snapshots. */
  actionEconomy?: SimulationTtrpgActionEconomyV2 | null;
  /** ItemDefinition stays in RulePack; mutable ownership/charges/durability live here. */
  inventory?: TtrpgInventoryStateV2 | null;
  /** Every direct inventory command leaves a replayable before/after receipt. */
  itemHistory?: SimulationTtrpgItemReceiptV2[];
  /** Per actor/action remaining uses and cooldown clocks. */
  abilityStates?: Record<string, TtrpgAbilityRuntimeStateV2> | null;
  /** Shared ability pools, keyed by the frozen RulePack pool key. */
  usagePools?: Record<string, TtrpgUsagePoolStateV2> | null;
  /** Atomic reward/penalty, advancement, social and story-clock receipts. */
  effectLedger?: TtrpgEffectLedgerStateV2 | null;
  /** Per-character spendable growth state; awards remain in the campaign ledger. */
  characterProgression?: Record<
    string,
    {
      model: "numeric-level" | "rank" | "point-buy" | "classless";
      level: number | null;
      rankKey: string | null;
      spentCurrency: number;
      attributeIncreases: Record<string, number>;
      skillIncreases: Record<string, number>;
      history: Array<{
        eventSequence: number;
        kind: "attribute" | "skill" | "level" | "rank";
        targetKey: string;
        before: number | string;
        after: number | string;
        cost: number;
      }>;
    }
  > | null;
  characterCustomizations: Array<{
    characterKey: string;
    name: string;
    description: string;
    attributes: Record<string, number>;
    /** Complete replacement card validated against the frozen template/RulePack. */
    characterSheet?: TtrpgCharacterSheetV2;
    customizedAtSequence: number;
  }>;
  actionHistory: SimulationTtrpgRuleActionResultV1[];
  /** Terminal feedback for submitted intents that did not become a rule action. */
  intentReceipts?: SimulationTtrpgIntentReceiptV2[];
  /** Human-owned responses to prompt-human windows; never authored by GM or AI. */
  humanResponses?: SimulationTtrpgHumanResponseV2[];
  /** Formal rest/reset receipts. Legacy states default to an empty ledger. */
  restHistory?: SimulationTtrpgRestReceiptV2[];
  /** Author-confirmed AI/human GM prose bound to one already-resolved rule action. */
  gmNarrations: SimulationTtrpgGmNarrationV1[];
  questProgress: Array<{
    questKey: string;
    requiredConclusionKeys: string[];
    status: "active" | "completed";
    completedAtSequence: number | null;
  }>;
  endingCatalog: Array<{
    endingKey: string;
    title: string;
    epilogue: string;
    trigger?: {
      sceneKey: string;
      requiredConclusionKeys: string[];
      forbiddenConclusionKeys: string[];
    } | null;
  }>;
  ending: null | {
    endingKey: string;
    eventSequence: number;
  };
  advancement: {
    currencyKey: string;
    currencyName: string;
    totalAwarded: number;
    milestones: Array<{
      milestoneKey: string;
      title: string;
      award: number;
    }>;
    awardedMilestoneKeys: string[];
  };
  /** Durable tabletop authority projected from the frozen CampaignPack. */
  tabletop?: SimulationTtrpgTabletopStateV1 | null;
  /** Playable placeholders and event-bound runtime media; bytes never enter replay state. */
  media?: {
    visualBibleHash: string | null;
    generatedCount: number;
    runtimePolicy: import("./ttrpg-product").TtrpgMediaManifestV1["runtimePolicy"];
    slots: Array<{
      slotKey: string;
      kind: import("./ttrpg-product").TtrpgRuntimeMediaKindV1;
      targetRef: string;
      audience: import("./ttrpg-product").TtrpgRuntimeMediaAudienceV1;
      fallbackText: string;
      altText: string;
      status: "placeholder" | "queued" | "available" | "failed" | "cancelled";
      requestKey: string | null;
      assetKey: string | null;
      mediaAssetId: number | null;
      mediaAssetVersion: number | null;
      mediaContentHash: string | null;
      lastErrorCode: string | null;
      updatedAtSequence: number | null;
    }>;
  } | null;
}

export interface SimulationTtrpgTabletopStateV1 {
  currentMapKey: string | null;
  maps: Array<{
    mapKey: string;
    sceneKeys: string[];
    width: number;
    height: number;
    publicLayerKeys: string[];
    gmLayerKeys: string[];
    areaKeys: string[];
    gmAreaKeys: string[];
    fogKeys: string[];
  }>;
  tokens: Array<{
    tokenKey: string;
    entityKey: string;
    mapKey: string;
    x: number;
    y: number;
    size: number;
    controllerKey: string | null;
    hidden: boolean;
  }>;
  visibleLayerKeys: string[];
  revealedFogKeys: string[];
  updatedAtSequence: number | null;
}

export interface SimulationTtrpgGmNarrationV1 {
  eventSequence: number;
  actionSequence: number;
  checkSequence: number | null;
  text: string;
  source: "human-gm" | "ai-confirmed" | "deterministic-fallback";
  /** AI evidence is null for human GM prose and the code-owned fallback. */
  candidateHash: string | null;
  runId: number | null;
  /** Durable cost/latency evidence copied from the verified candidate checkpoint. */
  modelEvidence: SimulationTtrpgModelEvidenceV1 | null;
  modelCalls: SimulationTtrpgModelEvidenceV1[];
  repairApplied: boolean;
  /** Structured, receipt-bound feedback. Legacy narration events omit it. */
  synthesisFrame?: SimulationTtrpgGmSynthesisFrameV2 | null;
}

export interface SimulationTtrpgModelEvidenceV1 {
  provider: string;
  model: string;
  usageSource: "provider" | "estimated";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostUsd: number | null;
}

export type SimulationTtrpgActorControllerV2 =
  "human" | "ai" | "hybrid" | "vacant" | "gm";

export interface SimulationTtrpgActionObserverV2 {
  actorKey: string;
  role: "player" | "npc";
  controller: SimulationTtrpgActorControllerV2;
  relation: "actor" | "target" | "direct-effect" | "scene-witness";
  relevance: "primary" | "relevant" | "ambient";
  /** Only actors in the frozen current scene may appear in this list. */
  present: true;
  responsePolicy:
    | "actor-owned"
    | "prompt-human"
    | "ai-eligible"
    | "gm-eligible"
    | "observe-only";
  reasons: string[];
}

export interface SimulationTtrpgReactionWindowV2 {
  layer:
    | "mechanical-reaction"
    | "immediate-character"
    | "scene-consequence"
    | "campaign-consequence";
  status: "open" | "advisory" | "closed";
  eligibleActorKeys: string[];
  humanConfirmationRequiredActorKeys: string[];
  reason: string;
}

/** GM-only, code-owned proposal for one relevant observer after an action. */
export interface SimulationTtrpgReactionCandidateV2 {
  actorKey: string;
  responsePolicy: SimulationTtrpgActionObserverV2["responsePolicy"];
  visibleFacts: string[];
  /** May contain frozen private motives and therefore is never player-projected. */
  motivation: string;
  reactionType:
    "conceal-or-block" | "assist" | "withdraw" | "observe" | "prompt-human";
  proposedActionKey: string | null;
  targetKey: string | null;
  rulePrerequisites: string[];
  publicReactionText: string | null;
  visibility: "public" | "player-private" | "gm-only";
  reasonIfNoReaction: string | null;
}

export interface SimulationTtrpgActionContextV2 {
  schema: "storyforge.ttrpg-action-context";
  version: 2;
  sceneKey: string;
  /** Frozen environment and GM truth at declaration time; viewer projections never expose it wholesale. */
  sceneSnapshot?: {
    title: string;
    description: string;
    locationKey: string | null;
    failureForward: string;
    gmSecret: string;
  };
  round: number;
  activeActorKey: string;
  actorKey: string;
  actorController: SimulationTtrpgActorControllerV2;
  targetKey: string | null;
  actionKey: string;
  actionPhase: "free" | "action" | "reaction" | "downtime";
  /** Original player declaration bound to this resolved action. Legacy/direct rule actions omit it. */
  declaredIntent?: {
    intentKey: string;
    rawInput: string;
    goal: string | null;
    method: string | null;
  };
  /** Exact rule input used for this action, absent only on automatic/legacy actions. */
  checkSnapshot?: null | {
    checkKey: string;
    attributeKey: string;
    attributeValue: number;
    skillKey?: string;
    skillValue?: number;
    diceModelKey: string;
    difficulty: number;
  };
  criticality: "routine" | "meaningful" | "critical";
  criticalityReasons: string[];
  actorConditionKeys: string[];
  actorInventoryInstanceIds: string[];
  grantingItemInstanceIds: string[];
  abilityStateKey: string;
  abilityUsesBefore: number | null;
  abilityCooldownBefore: number;
  activeQuestKeys: string[];
  discoveredConclusionKeys: string[];
  observers: SimulationTtrpgActionObserverV2[];
  reactionWindows: SimulationTtrpgReactionWindowV2[];
  /** Absent only on legacy receipts. Full candidates remain inside GM/event boundaries. */
  reactionCandidates?: SimulationTtrpgReactionCandidateV2[];
}

/**
 * Code-owned terminal feedback for one committed action. It is created in the
 * same event as the mechanical result, so model failure can never leave an
 * action without a player-visible answer.
 */
export interface SimulationTtrpgActionReceiptV2 {
  schema: "storyforge.ttrpg-action-receipt";
  version: 2;
  receiptKey: string;
  actionSequence: number;
  /** `resolved` is retained only for replaying pre-intent-pipeline events. */
  terminalStatus: "resolved" | "resolved-no-roll" | "resolved-check";
  context: SimulationTtrpgActionContextV2;
  mechanicalSummary: string;
  actorConsequence: string;
  sceneConsequence: string;
  worldConsequence: string;
  failForwardAvailable: boolean;
  changedEntityKeys: string[];
  suggestedNextActionKeys: string[];
  nextActorKey: string | null;
  nextRound: number;
}

export type SimulationTtrpgIntentTerminalStatusV2 =
  | "needs-clarification"
  | "rejected-illegal"
  | "interrupted"
  | "queued/deferred"
  | "cancelled";

/** Code-owned terminal receipt for an intent that did not commit a rule action. */
export interface SimulationTtrpgIntentReceiptV2 {
  schema: "storyforge.ttrpg-intent-receipt";
  version: 2;
  receiptKey: string;
  eventSequence: number;
  intentKey: string;
  actorKey: string;
  rawInput: string;
  proposedActionKey: string | null;
  targetKey: string | null;
  terminalStatus: SimulationTtrpgIntentTerminalStatusV2;
  reason: string;
  suggestedActionKeys: string[];
}

export interface SimulationTtrpgHumanResponseV2 {
  schema: "storyforge.ttrpg-human-response";
  version: 2;
  responseKey: string;
  eventSequence: number;
  actionSequence: number;
  actionReceiptKey: string;
  actorKey: string;
  kind: "speak" | "act-narratively" | "decline";
  text: string;
  audience: "party" | "gm-only";
  viewerKey: string;
}

export interface SimulationTtrpgGmSynthesisReactionV2 {
  actorKey: string;
  responsePolicy: SimulationTtrpgActionObserverV2["responsePolicy"];
  /** Human-controlled characters always use null: the UI prompts their owner. */
  text: string | null;
}

export interface SimulationTtrpgGmSynthesisFrameV2 {
  schema: "storyforge.ttrpg-gm-synthesis-frame";
  version: 2;
  actionSequence: number;
  mechanicalOutcome: string;
  actorFeedback: string;
  reactions: SimulationTtrpgGmSynthesisReactionV2[];
  sceneUpdate: string;
  worldUpdate: string;
  nextPrompts: string[];
}

export interface SimulationTtrpgRuleActionResultV1 {
  eventSequence: number;
  actionKey: string;
  actionName: string;
  actorKey: string;
  targetKey: string | null;
  /** Null only for legacy events written before the action-economy ledger. */
  actionPhase: "free" | "action" | "reaction" | "downtime" | null;
  outcome: "automatic" | TtrpgDegreeV2;
  check: SimulationTtrpgCheck | null;
  resourceChanges: Array<{
    entityKey: string;
    resourceKey: string;
    before: number;
    delta: number;
    after: number;
    maximum: number;
    proofHash: string | null;
  }>;
  conditionChanges: Array<{
    entityKey: string;
    conditionKey: string;
    stacks: number;
    duration: number | null;
  }>;
  /** Null only for legacy events written before usage/cooldown enforcement. */
  abilityChange: null | {
    stateKey: string;
    before: TtrpgAbilityRuntimeStateV2;
    after: TtrpgAbilityRuntimeStateV2;
    sharedPoolKey: string | null;
    sharedPoolBefore: TtrpgUsagePoolStateV2 | null;
    sharedPoolAfter: TtrpgUsagePoolStateV2 | null;
  };
  /** Present only when a durable AI-player or AI-GM actor Run authorized the exact intent. */
  actorAuthority?: null | {
    source:
      "ai-player" | "hybrid-confirmed" | "ai-gm-npc" | "hybrid-gm-confirmed";
    viewerKey: string;
    runId: number;
    candidateHash: string;
    contextManifestHash: string;
    approach: string;
    spokenIntent: string | null;
  };
  /** Present on every newly committed formal action; absent only on legacy replay events. */
  receipt?: SimulationTtrpgActionReceiptV2 | null;
  nextActorKey: string | null;
  nextRound: number;
}

export interface SimulationTtrpgRestReceiptV2 {
  schema: "storyforge.ttrpg-rest-receipt";
  version: 2;
  eventSequence: number;
  restKey: string;
  kind: "short-rest" | "long-rest";
  actorKeys: string[];
  completedBy: string;
  reason: string;
  abilityChanges: Array<{
    stateKey: string;
    actorKey: string;
    abilityKey: string;
    before: TtrpgAbilityRuntimeStateV2;
    after: TtrpgAbilityRuntimeStateV2;
  }>;
}

export interface SimulationTtrpgItemReceiptV2 {
  schema: "storyforge.ttrpg-item-receipt";
  version: 2;
  eventSequence: number;
  commandId: string;
  operation:
    | "grant"
    | "remove"
    | "transfer"
    | "use"
    | "equip"
    | "unequip"
    | "attune"
    | "damage"
    | "repair";
  itemInstanceId: string;
  definitionRef: string;
  requestedBy: { role: "gm" | "player"; actorKey: string };
  before: TtrpgItemInstanceV2 | null;
  after: TtrpgItemInstanceV2 | null;
}

export interface SimulationTtrpgActionEconomyV2 {
  schema: "storyforge.ttrpg-action-economy";
  version: 2;
  actionsPerTurn: number;
  reactionsPerRound: number;
  freeActionsPerTurn: number;
  sceneKey: string | null;
  round: number;
  activeActorKey: string | null;
  budgets: Record<
    string,
    {
      actionsRemaining: number;
      reactionsRemaining: number;
      freeActionsRemaining: number;
    }
  >;
}

export interface SimulationTtrpgResource {
  current: number;
  maximum: number;
}

export interface SimulationTtrpgCondition {
  conditionId: string;
  name: string;
  description: string;
  duration: number | null;
  stacks: number;
}

export interface SimulationTtrpgCombatant {
  entityKey: string;
  initiative: number;
  armorClass: number;
  resources: Record<string, SimulationTtrpgResource>;
  conditions: SimulationTtrpgCondition[];
}

export interface SimulationTtrpgEncounter {
  encounterId: string;
  title: string;
  description: string;
  status: "active" | "resolved";
  round: number;
  activeActorKey: string | null;
  turnOrder: string[];
  combatants: Record<string, SimulationTtrpgCombatant>;
}

export interface SimulationTtrpgEncounterCandidate {
  baseSequence: number;
  title: string;
  description: string;
  participantKeys: string[];
}

export interface SimulationTtrpgAttackResult {
  actorKey: string;
  targetKey: string;
  attackExpression: string;
  attackDice: number[];
  attackModifier: number;
  attackTotal: number;
  armorClass: number;
  hit: boolean;
  damageExpression: string | null;
  damageDice: number[];
  damageModifier: number;
  damageTotal: number;
  resourceKey: string;
  resourceDelta: number;
  reason: string;
}

export interface SimulationTtrpgCheckRequest {
  skill: string;
  expression: string;
  dc: number;
  reason: string;
}

export interface SimulationTtrpgTurnCandidate {
  baseSequence: number;
  actorKey: string;
  action: string;
  narrative: string;
  check: SimulationTtrpgCheckRequest | null;
  outcomes: {
    success: string;
    failure: string;
  } | null;
  nextActorKey: string | null;
}

export const SIMULATION_TTRPG_QUEST_STATUSES = [
  "active",
  "paused",
  "completed",
  "failed",
] as const;
export type SimulationTtrpgQuestStatus =
  (typeof SIMULATION_TTRPG_QUEST_STATUSES)[number];

export interface SimulationTtrpgQuest {
  questId: string;
  title: string;
  description: string;
  status: SimulationTtrpgQuestStatus;
  priority: number;
  /** 运行时时钟截止点；null 表示没有期限。 */
  dueClock: number | null;
  updatedSequence: number;
}

export interface SimulationTtrpgNpcSchedule {
  scheduleId: string;
  entityKey: string;
  startClock: number;
  endClock: number | null;
  locationKey: string | null;
  activity: string;
  recurrence: "once" | "daily" | "weekly";
  updatedSequence: number;
}

export interface SimulationTtrpgCampaignSessionV2 {
  sessionKey: string;
  ordinal: number;
  title: string;
  status: "active" | "completed" | "cancelled";
  participantKeys: string[];
  startedSequence: number;
  completedSequence: number | null;
  summary: string;
  rulePackContentHash: string;
  campaignKey: string;
}

export interface SimulationTtrpgRosterEntryV2 {
  characterKey: string;
  status: "active" | "reserve" | "retired";
  joinedSessionKey: string | null;
  leftSessionKey: string | null;
  replacementFor: string | null;
  reason: string;
  updatedSequence: number;
}

export interface SimulationTtrpgCampaignMemoryV2 {
  memoryKey: string;
  subjectKey: string;
  summary: string;
  audience: "party" | "gm-only" | `actor:${string}`;
  sourceSessionKey: string;
  updatedSequence: number;
}

export interface SimulationTtrpgSupplementReceiptV2 {
  supplementKey: string;
  title: string;
  contentHash: string;
  compatibility: "same-release" | "next-release";
  sourceRef: string;
  activatedSessionKey: string | null;
  approvedBy: string;
  updatedSequence: number;
}

export interface SimulationTtrpgWorldEvolutionV2 {
  candidateKey: string;
  category:
    "character" | "location" | "faction" | "artifact" | "event" | "lore";
  summary: string;
  sourceSessionKey: string;
  status: "proposed" | "approved-for-world-review" | "rejected";
  targetWorldRef: string | null;
  reviewedBy: string | null;
  updatedSequence: number;
}

export interface SimulationTtrpgVersionTransitionV2 {
  transitionKey: string;
  fromRulePackContentHash: string;
  toRulePackContentHash: string;
  fromCampaignKey: string;
  toCampaignKey: string;
  compatibility:
    "same-content" | "compatible" | "manual-migration" | "breaking";
  status: "planned" | "activated" | "rejected";
  notes: string;
  approvedBy: string;
  updatedSequence: number;
}

export interface SimulationTtrpgCampaignState {
  summary: string;
  quests: SimulationTtrpgQuest[];
  npcSchedules: SimulationTtrpgNpcSchedule[];
  activeSessionKey: string | null;
  playSessions: SimulationTtrpgCampaignSessionV2[];
  roster: SimulationTtrpgRosterEntryV2[];
  memories: SimulationTtrpgCampaignMemoryV2[];
  supplements: SimulationTtrpgSupplementReceiptV2[];
  worldEvolution: SimulationTtrpgWorldEvolutionV2[];
  versionTransitions: SimulationTtrpgVersionTransitionV2[];
}

export type InteractionSceneStatus = "active" | "ended";
export type InteractionMemoryStatus =
  "proposed" | "accepted" | "rejected" | "superseded";
export type InteractionMemoryKind =
  | "scene-summary"
  | "key-memory"
  | "commitment"
  | "secret"
  | "conflict"
  | "gift";

export interface InteractionRuntimeProfile {
  participantKey: string;
  characterKey: string;
  name: string;
  roleLabel: string;
  voiceRules: string;
  maxMemoryEntries: number;
}

export interface InteractionRuntimeSceneTemplate {
  sceneKey: string;
  title: string;
  purpose: string;
  location: string;
  timeLabel: string;
  participantKeys: string[];
  publicKnowledgeKeys: string[];
  goals: string[];
  endingConditions: string[];
  safetyBoundaries: string[];
  relationshipRules: InteractionRelationshipRule[];
  openingNodeKey: string | null;
  endingNodeKey: string | null;
  maxTurns: number;
  directorBudget: number;
}

export interface InteractionRuntimeScene extends InteractionRuntimeSceneTemplate {
  sceneId: string;
  status: InteractionSceneStatus;
  activeParticipantKeys: string[];
  startedAtSequence: number;
  endedAtSequence: number | null;
  playerTurns: number;
}

export interface InteractionRuntimeMessage {
  messageId: string;
  eventSequence: number;
  role: "player" | "character" | "system";
  speakerKey: string;
  /** null means everyone in the scene can hear the message. */
  audienceKeys: string[] | null;
  text: string;
  replyToSequence: number | null;
  supersededBySequence: number | null;
}

export interface InteractionRuntimeKnowledge {
  knowledgeKey: string;
  participantKey: string;
  content: string;
  status: RuntimeMemoryStatus;
  importance: number;
  sourceEventSequence: number;
}

export interface InteractionRuntimeMemory {
  memoryId: string;
  participantKey: string;
  kind: InteractionMemoryKind;
  content: string;
  importance: number;
  sourceEventSequences: number[];
  evidenceExcerpt: string;
  status: InteractionMemoryStatus;
  proposalSequence: number;
  decisionSequence: number | null;
  supersededByMemoryId: string | null;
}

export interface InteractionRuntimeRelationship {
  fromParticipantKey: string;
  toParticipantKey: string;
  dimensionKey: string;
  label: string;
  minimum: number;
  maximum: number;
  value: number;
  largeChangeThreshold: number;
  lastChangedSequence: number;
}

export interface InteractionRelationshipChange {
  eventSequence: number;
  fromParticipantKey: string;
  toParticipantKey: string;
  dimensionKey: string;
  before: number;
  after: number;
  delta: number;
  reason: string;
  ruleKey: string;
  sourceEventSequence: number;
  significantEventKey: string | null;
}

export interface InteractionRuntimeThread {
  threadKey: string;
  title: string;
  status: "open" | "resolved";
  openedSequence: number;
  resolvedSequence: number | null;
}

export interface SimulationInteractionState {
  schema: "storyforge.character-interaction";
  version: 1;
  playerKey: string;
  profiles: InteractionRuntimeProfile[];
  sceneTemplates: InteractionRuntimeSceneTemplate[];
  activeScene: InteractionRuntimeScene | null;
  sceneHistory: InteractionRuntimeScene[];
  messages: InteractionRuntimeMessage[];
  knowledge: InteractionRuntimeKnowledge[];
  memories: InteractionRuntimeMemory[];
  relationships: InteractionRuntimeRelationship[];
  relationshipHistory: InteractionRelationshipChange[];
  threads: InteractionRuntimeThread[];
  totalPlayerTurns: number;
  remainingDirectorBudget: number;
}

export interface SimulationNarrativeNodeSnapshot {
  key: string;
  kind: NarrativeNodeKind;
  title: string;
  summary: string;
  conditionJson: string;
  effectsJson: string;
  successorKeys: string[];
}

export interface SimulationNarrativeState {
  schema: "storyforge.simulation-narrative";
  version: 2;
  moduleKind: NarrativeModuleKind;
  moduleTitle: string;
  sourceHash: string;
  nodes: SimulationNarrativeNodeSnapshot[];
  currentNodeKey: string | null;
  visitedNodeKeys: string[];
  availableNodeKeys: string[];
  variables: Record<string, unknown>;
  completed: boolean;
  contentHash: string;
  beats: FrozenNarrativeBeat[];
  choices: FrozenNarrativeChoice[];
  visibleChoiceKeys: string[];
  availableChoiceKeys: string[];
  choiceHistory: NarrativeChoiceHistoryEntry[];
  endingKey: string | null;
  completedAtSequence: number | null;
  /** Last emitted node-entered event, used to validate the explicit event protocol. */
  lastEnteredNodeSequence: number | null;
}

export interface SimulationRuntimeState {
  version: 1;
  clock: number;
  entities: Record<string, RuntimeEntityState>;
  memories: RuntimeMemory[];
  narratives: Array<{
    eventSequence: number;
    text: string;
  }>;
  /** 旧存档缺少该字段时按 null 处理。 */
  ttrpg?: SimulationTtrpgState | null;
  /** Governed character-interaction state. */
  interaction?: SimulationInteractionState | null;
  /** WORLD-2F: frozen executable narrative; legacy sessions default to null. */
  narrative?: SimulationNarrativeState | null;
  /** TEXTADV-1 governed state; absent on all earlier sessions. */
  adventure?: SimulationAdventureState | null;
  /** AVG-1 presentation cursor and deterministic stage snapshot. */
  presentation?: SimulationAvgPresentationState | null;
  /** TEXTSIM-1 governed turn/resource/issue projection. */
  narrativeSimulation?: SimulationNarrativeSimulationState | null;
  /** TEXTWORLD-1 governed regional, travel and dynamic quest projection. */
  openWorld?: SimulationOpenWorldState | null;
  lastSequence: number;
}

export interface SimulationSession {
  id?: number;
  projectId: number;
  worldGroupId?: number | null;
  worldId?: number | null;
  workId?: number | null;
  gameReleaseId?: number | null;
  /** GAMEPROD-1 preview source; mutually exclusive with a formal gameReleaseId. */
  gameBuildId?: number | null;
  /** Hash of the exact preview or release runtime source used to create this session. */
  runtimeSourceHash?: string | null;
  kind: SimulationSessionKind;
  title: string;
  status: SimulationSessionStatus;
  rulesetVersion: number;
  seed: string;
  canonSnapshotJson: string;
  initialStateJson: string;
  /**
   * Derived current-state head. The event log remains canonical: readers only
   * use this cache when its sequence matches the latest persisted event and
   * its content hash verifies. Legacy/imported sessions may omit all fields.
   */
  runtimeHeadSequence?: number | null;
  runtimeHeadStateJson?: string | null;
  runtimeHeadStateHash?: string | null;
  parentSessionId?: number | null;
  parentThroughSequence?: number | null;
  createdAt: number;
  updatedAt: number;
}

export const SIMULATION_EVENT_TYPES = [
  "time.advanced",
  "entity.upserted",
  "entity.patched",
  "entity.removed",
  "memory.recorded",
  "random.resolved",
  "narrative.recorded",
  "narrative.started",
  "narrative.node.entered",
  "narrative.choice.committed",
  "narrative.ending.reached",
  "npc.evolution.proposed",
  "npc.evolution.accepted",
  "npc.evolution.rejected",
  "ttrpg.scene.opened",
  "ttrpg.action.recorded",
  "ttrpg.check.resolved",
  "ttrpg.gm.response.recorded",
  "ttrpg.turn.advanced",
  "ttrpg.encounter.started",
  "ttrpg.encounter.resolved",
  "ttrpg.combat.attack.resolved",
  "ttrpg.combat.resource.changed",
  "ttrpg.combat.condition.applied",
  "ttrpg.combat.condition.removed",
  "ttrpg.combat.turn.advanced",
  "ttrpg.campaign.summary.updated",
  "ttrpg.campaign.quest.upserted",
  "ttrpg.campaign.schedule.upserted",
  "ttrpg.campaign.session.started",
  "ttrpg.campaign.session.completed",
  "ttrpg.campaign.roster.changed",
  "ttrpg.campaign.supplement.activated",
  "ttrpg.campaign.world-evolution.recorded",
  "ttrpg.campaign.version-transition.recorded",
  "ttrpg.character.customized",
  "ttrpg.character.advanced",
  "ttrpg.session-zero.completed",
  "ttrpg.safety.changed",
  "ttrpg.clue.discovered",
  "ttrpg.intent.receipted",
  "ttrpg.human-response.recorded",
  "ttrpg.rule.action.resolved",
  "ttrpg.rest.completed",
  "ttrpg.item.changed",
  "ttrpg.effects.choice.proposed",
  "ttrpg.effects.applied",
  "ttrpg.campaign.ended",
  "ttrpg.tabletop.updated",
  "ttrpg.media.requested",
  "ttrpg.media.available",
  "ttrpg.media.failed",
  "ttrpg.media.cancelled",
  "interaction.scene.started",
  "interaction.scene.ended",
  "interaction.participant.joined",
  "interaction.participant.left",
  "interaction.player.message.committed",
  "interaction.character.reply.committed",
  "interaction.memory.proposed",
  "interaction.memory.accepted",
  "interaction.memory.rejected",
  "interaction.memory.superseded",
  "interaction.knowledge.shared",
  "interaction.relationship.changed",
  "interaction.thread.opened",
  "interaction.thread.resolved",
  "adventure.location.entered",
  "adventure.location.left",
  "adventure.item.gained",
  "adventure.item.transferred",
  "adventure.item.used",
  "adventure.item.state-changed",
  "adventure.resource.changed",
  "adventure.ability.changed",
  "adventure.condition.applied",
  "adventure.condition.removed",
  "adventure.check.resolved",
  "adventure.quest.accepted",
  "adventure.quest.objective-updated",
  "adventure.quest.completed",
  "adventure.quest.failed",
  "adventure.narrative.synced",
  "adventure.action.committed",
  "adventure.action.rejected",
  "presentation.beat.reached",
  "presentation.media.failed",
  "simulation.turn.started",
  "simulation.decision.committed",
  "simulation.decision.rejected",
  "simulation.resource.changed",
  "simulation.metric.changed",
  "simulation.modifier.applied",
  "simulation.modifier.ticked",
  "simulation.modifier.expired",
  "simulation.modifier.removed",
  "simulation.effect.scheduled",
  "simulation.effect.settled",
  "simulation.actor.action-resolved",
  "simulation.issue.created",
  "simulation.issue.stage-changed",
  "simulation.issue.resolved",
  "simulation.report.created",
  "simulation.ending.qualified",
  "simulation.narrative.synced",
  "simulation.turn.ended",
  "world.travel.started",
  "world.travel.progressed",
  "world.travel.completed",
  "world.travel.interrupted",
  "world.region.discovered",
  "world.region.attention-changed",
  "world.region.projection-updated",
  "world.actor.remote-action-resolved",
  "world.issue.propagated",
  "world.issue.localized",
  "world.quest-card.considered",
  "world.quest-card.dealt",
  "world.quest.blank-dealt",
  "world.quest.instance-created",
  "world.quest.revealed",
  "world.quest.declined",
  "world.quest.expired",
  "world.quest.superseded",
  "world.tick.completed",
  "world.narrative.synced",
] as const;
export type SimulationEventType = (typeof SIMULATION_EVENT_TYPES)[number];

export interface SimulationEvent {
  id?: number;
  projectId: number;
  worldGroupId?: number | null;
  sessionId: number;
  sequence: number;
  type: SimulationEventType;
  actorKey?: string | null;
  targetKey?: string | null;
  /** Idempotent command envelope identity for governed player writes. */
  commandId?: string | null;
  baseSequence?: number | null;
  baseStateHash?: string | null;
  payloadJson: string;
  createdAt: number;
}

export interface SimulationCheckpoint {
  id?: number;
  projectId: number;
  worldGroupId?: number | null;
  sessionId: number;
  throughSequence: number;
  name: string;
  stateJson: string;
  stateHash: string;
  createdAt: number;
}

export const EMPTY_SIMULATION_STATE: SimulationRuntimeState = {
  version: 1,
  clock: 0,
  entities: {},
  memories: [],
  narratives: [],
  ttrpg: null,
  interaction: null,
  narrative: null,
  adventure: null,
  presentation: null,
  narrativeSimulation: null,
  openWorld: null,
  lastSequence: 0,
};
