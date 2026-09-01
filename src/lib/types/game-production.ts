import type { GameRuntimePackageV2 } from "./text-game";
import type { ProductMediaKind } from "./product-media";
import type {
  TtrpgHouseRuleDiffV2,
  TtrpgHouseRuleOverlayV2,
} from "./ttrpg-product";

export const STORYFORGE_CANONICAL_JSON_VERSION = 2 as const;

export interface WorldGameProductionHandoffV2 {
  schema: "storyforge.world-game-production-handoff";
  version: 2;
  productType:
    | "ttrpg"
    | "storygame"
    | "text-adventure"
    | "avg"
    | "chatgame"
    | "textsimulation"
    | "textworld";
  worldReleaseId: number;
  worldContentHash: string;
}

export interface GameBuildPreviewManifestV1 {
  schema: "storyforge.game-build-preview";
  version: 1;
  productionKey: string;
  buildNumber: number;
  buildManifestHash: string;
  runtimePackage: GameRuntimePackageV2;
  packageHash: string;
  mediaBindings: Array<{
    assetKey: string;
    artifactKey: string;
    blobContentHash: string;
  }>;
  fallbackSummary: string[];
  previewHash: string;
}

export type PlayableGameSourceV1 =
  | { kind: "release"; gameReleaseId: number }
  | { kind: "build"; gameBuildId: number; expectedPreviewHash: string };

export interface ResolvedPlayableGamePackageV2 {
  source: PlayableGameSourceV1;
  runtimePackage: GameRuntimePackageV2;
  packageHash: string;
  runtimeSourceHash: string;
  mediaResolver: GameMediaResolverV1;
}

export interface ResolvedMediaCatalogV1 {
  urls: Record<string, string>;
  failures: Array<{ assetKey: string; reason: string }>;
  usedBytes: number;
}

export interface GameMediaResolverV1 {
  preload(input: {
    assetKeys: string[];
    maximumBytes: number;
  }): Promise<ResolvedMediaCatalogV1>;
  read(assetKey: string): Promise<Blob>;
  dispose(): void;
}

export type GameProductionStatusV1 =
  | "consulting"
  | "brief-ready"
  | "producing"
  | "paused"
  | "preview-ready"
  | "released"
  | "stopped"
  | "failed"
  | "archived";

export type GameBuildStatusV1 =
  | "draft"
  | "authorized"
  | "planning"
  | "building"
  | "integrating"
  | "validating"
  | "preview-ready"
  | "release-ready"
  | "released"
  | "paused"
  | "recovery-required"
  | "failed"
  | "cancelled"
  | "archived";

export type GameBuildArtifactStatusV1 =
  | "pending"
  | "candidate"
  | "accepted"
  | "carried-forward"
  | "rejected"
  | "orphaned"
  | "invalid";

export type GameBuildArtifactKindV1 =
  | "consultation-evidence"
  | "game-design"
  | "narrative"
  | "product-module"
  | "visual-bible"
  | "audio-bible"
  | "asset-manifest"
  | "image"
  | "audio"
  | "rule-pack"
  | "campaign-pack"
  | "presentation"
  | "quality-report"
  | "playtest-report"
  | "integration-report";

export const GAME_PRODUCTION_COMMAND_TYPES = [
  "create-intent",
  "save-brief-revision",
  "authorize-start",
  "pause",
  "resume",
  "stop",
  "resolve-blocker",
  "request-preview",
  "publish",
  "evolve",
  "archive",
  "restore",
] as const;
export type GameProductionCommandTypeV1 =
  (typeof GAME_PRODUCTION_COMMAND_TYPES)[number];

export interface GameStartingPointV1 {
  kind: "mainline" | "branch" | "character" | "history" | "custom";
  title: string;
  summary: string;
  sourceRefs: string[];
  protagonistRefs: string[];
  openingConflict: string;
}

export interface GameStartingPointSuggestionV1 {
  suggestionKey: string;
  kind: GameStartingPointV1["kind"];
  title: string;
  rationale: string;
  sourceRefs: string[];
  protagonistRefs: string[];
  openingConflict: string;
  recommendedProductTypes: import("./text-game").GameProductType[];
  scale: GameProductionScaleV1["scope"];
  risks: string[];
}

/** Human-reviewable portable source facets exposed by the frozen WorldRelease. */
export interface GameProductionSourceOptionV1 {
  resourceKey: string;
  label: string;
  summary: string;
  kind: string | null;
}

export interface GameProductionSourceOptionsV1 {
  storySources: GameProductionSourceOptionV1[];
  characters: GameProductionSourceOptionV1[];
  importantLocations: GameProductionSourceOptionV1[];
  artifacts: GameProductionSourceOptionV1[];
  codexEntries: GameProductionSourceOptionV1[];
  storyArcs: GameProductionSourceOptionV1[];
}

/**
 * Explicit author selection. Relations and product-specific bindings are
 * derived by the compiler so callers cannot smuggle dangling references.
 */
export interface GameProductionSourceSelectionV1 {
  storyResourceKeys: string[];
  characterResourceKeys: string[];
  importantLocationResourceKeys: string[];
  artifactResourceKeys: string[];
  codexEntryResourceKeys: string[];
  storyArcResourceKeys: string[];
}

export interface GameProductionScaleV1 {
  scope: "scene" | "short-arc" | "chapter" | "multi-chapter" | "campaign";
  targetPlayMinutes: number;
  targetWordCount: number;
  targetEndingCount: number;
}

export interface GameProductionMediaProfileV1 {
  visualLevel: "none" | "key-scenes" | "illustrated";
  audioLevel: "none" | "music-sfx" | "full";
  imageCount: number;
  musicTrackCount: number;
  sfxCount: number;
  voiceLineCount: number;
  requiredMediaKinds: ProductMediaKind[];
}

export interface GameConsultationBudgetV1 {
  maximumModelCalls: number;
  maximumInputTokens: number;
  maximumOutputTokens: number;
  maximumCostUsd: number | null;
}

export interface GameProductionBudgetV3 extends GameConsultationBudgetV1 {
  maximumMediaCalls: number;
  maximumDurationMs: number;
  maximumStorageBytes: number;
}

export interface ProviderCapabilityRequirementV1 {
  requirementKey: string;
  mediaClass: "text" | "image" | "music" | "sfx" | "voice" | "transcode";
  operation: string;
  adapterFamily: string;
  minimumCapabilityVersion: string;
  allowedDataClasses: string[];
  maximumRequestCost: number | null;
  maximumTotalCost: number | null;
  rightsPolicyVersion: string;
  capabilityHash: string;
  required: boolean;
}

export interface GameProductionExternalDataPolicyV1 {
  allowedDataClasses: string[];
  forbiddenDataClasses: string[];
  allowReferenceImages: boolean;
  allowVoiceScripts: boolean;
}

export interface GameProductionFallbackPolicyV1 {
  allowTextOnly: boolean;
  allowExistingProjectMedia: boolean;
  allowProceduralAudio: boolean;
  onRequiredCapabilityMissing: "pause" | "fail";
}

export interface GameProductionCompletionContractV1 {
  requiresPlayablePreview: boolean;
  requiredGateIds: string[];
  minimumMediaCoverage: number;
  allowSoftWaivers: boolean;
}

export interface TtrpgProductionSeatV2 {
  seatKey: string;
  label: string;
  controller: "human" | "ai" | "open";
  role: "player" | "assistant-gm";
  characterMode: "world-template" | "quick-card" | "manual" | "ai-generated";
  sourceCharacterResourceKey: string | null;
  characterName: string;
  rankTier: "D" | "C" | "B" | "A" | null;
  privateGoal: string;
}

export type TtrpgCampaignProposalSectionV2 =
  | "background"
  | "coreConflict"
  | "opening"
  | "fronts"
  | "secrets"
  | "endings";

export interface TtrpgCampaignProposalV2 {
  proposalKey: string;
  title: string;
  pitch: string;
  background: string;
  coreConflict: string;
  structure: "linear" | "branching" | "node-based" | "sandbox";
  opening: string;
  frontConcepts: string[];
  secretConcepts: string[];
  endingConcepts: string[];
  sourceRefs: string[];
}

/** Reviewable proposal comparison and per-section mixing frozen into the existing Brief table. */
export interface TtrpgCampaignDesignV2 {
  schema: "storyforge.ttrpg-campaign-design";
  version: 2;
  origin: "author-guided" | "ai-candidate";
  sourceWorldContentHash: string;
  proposals: TtrpgCampaignProposalV2[];
  selection: {
    baseProposalKey: string;
    sectionSources: Record<TtrpgCampaignProposalSectionV2, string>;
    lockedSections: TtrpgCampaignProposalSectionV2[];
    authorNotes: string;
    confirmed: boolean;
  };
  /** Durable AI proposal evidence; null for the no-provider author-guided fallback. */
  candidateEvidence: null | {
    runId: number;
    candidateHash: string;
    contextManifestHash: string;
  };
}

export interface TtrpgProductionBriefV2 {
  schema: "storyforge.ttrpg-production-brief";
  version: 2;
  creationMode: "quick" | "advanced";
  naturalLanguageInstruction: string;
  campaign: {
    title: string;
    premise: string;
    background: string;
    coreConflict: string;
    genreTags: string[];
    tone: string[];
    difficulty: "introductory" | "standard" | "challenging";
    targetSessions: number;
    targetSessionMinutes: number;
  };
  /** Optional only for legacy Briefs; new production Briefs freeze proposal comparison/mixing. */
  campaignDesign?: TtrpgCampaignDesignV2;
  rules: {
    origin:
      | "builtin-storyforge"
      | "builtin-rank-lite"
      | "builtin-d20-fantasy"
      | "builtin-d100-investigation"
      | "saved-rule-pack";
    rulePackRecordId: number | null;
    ruleSystemId: string;
    ruleSystemVersion: string;
    baseContentHash: string;
    effectiveContentHash: string;
    houseRuleOverlay: TtrpgHouseRuleOverlayV2 | null;
    houseRuleDiff: TtrpgHouseRuleDiffV2[];
  };
  table: {
    gmMode: "human" | "ai" | "hybrid";
    seats: TtrpgProductionSeatV2[];
    spectatorPolicy: "disabled" | "public-only" | "invited";
    joinInProgress: boolean;
    asynchronousPlay: boolean;
  };
  characters: {
    defaultCreationMode: TtrpgProductionSeatV2["characterMode"];
    allowCustomSheets: boolean;
    allowAiGeneration: boolean;
    requireGmApproval: boolean;
    progressionMode: "rule-native" | "rank-lite" | "none";
    startingLevelOrTier: string;
    requiredProfileFields: string[];
  };
  story: {
    structure: "linear" | "branching" | "node-based" | "sandbox";
    openingScene: string;
    targetSceneCount: number;
    targetQuestCount: number;
    clueRedundancy: number;
    targetEndingCount: number;
    failForward: boolean;
    freeRoam: boolean;
    canonMutationPolicy:
      "session-only" | "author-review" | "allow-world-candidates";
  };
  information: {
    characterPrivateChannels: boolean;
    gmSecrets: boolean;
    hiddenNpcState: boolean;
    hiddenDice: "never" | "gm-only" | "allowed";
    interPlayerWhispers: boolean;
    revealAuditTrail: boolean;
  };
  safety: {
    sessionZeroRequired: boolean;
    consentChecklist: string[];
    lines: string[];
    veils: string[];
    contentWarnings: string[];
    pauseSignal: string;
    openDoor: boolean;
  };
  media: {
    visualStyle: string;
    sceneImages: boolean;
    characterPortraits: boolean;
    characterExpressions: boolean;
    itemIcons: boolean;
    handouts: boolean;
    maps: boolean;
    tokens: boolean;
    generationTiming: "prebuild" | "background-during-play" | "hybrid";
    backgroundGeneration: boolean;
    textFallback: boolean;
    maximumGeneratedAssets: number;
  };
  confirmations: {
    worldCanonBoundary: boolean;
    numericMappings: boolean;
    ruleLicense: boolean;
    aiParticipationDisclosure: boolean;
    mediaRights: boolean;
  };
}

export interface GameProductionBriefV3 {
  schema: "storyforge.game-production-brief";
  version: 3;
  source: {
    worldReleaseId: number;
    worldContentHash: string;
    selection: import("./text-game").ProductWorldSourceSelectionV1;
    startingPoint: GameStartingPointV1;
  };
  intent: {
    productType: import("./text-game").GameProductType;
    playerRole: string;
    protagonistRefs: string[];
    openingSituation: string;
    coreExperience: string[];
    requiredFacts: string[];
    forbiddenChanges: string[];
    contentBoundaries: string[];
    tone: string[];
  };
  scale: GameProductionScaleV1;
  media: GameProductionMediaProfileV1;
  consultationBudget: GameConsultationBudgetV1;
  productionBudget: GameProductionBudgetV3;
  qualityProfile: "prototype" | "internal" | "commercial-candidate";
  capabilityRequirements: ProviderCapabilityRequirementV1[];
  externalDataPolicy: GameProductionExternalDataPolicyV1;
  fallbackPolicy: GameProductionFallbackPolicyV1;
  completionContract: GameProductionCompletionContractV1;
  unresolvedDecisionKeys: string[];
  /** Closed TTRPG construction contract; required exactly when productType=ttrpg. */
  ttrpg?: TtrpgProductionBriefV2;
  /** Explicit author confirmations required by product-specific deterministic compilers. */
  authorConfirmations?: {
    ttrpgDefaultRuleMappings: boolean;
  };
  /** Present only on a Brief derived from an explicit evolution command. */
  evolution?: GameEvolutionImpactV1;
}

export type GameProductionTaskLaneV1 =
  "planning" | "content" | "visual" | "audio" | "integration" | "qa";
export type GameProductionTaskExecutionModeV1 =
  "deterministic" | "model" | "media-provider" | "human-import";

export interface GameTaskBudgetReservationV1 {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  mediaCalls: number;
  maximumCostUsd: number | null;
  durationMs: number;
  storageBytes: number;
}

export interface GameArtifactReuseDecisionV1 {
  sourceBuildNumber: number;
  sourceArtifactKey: string;
  sourceContentHash: string;
  reuseKey: string;
  requiresRevalidation: boolean;
  reason: string;
}

export interface GameProductionPlanTaskV3 {
  taskKey: string;
  lane: GameProductionTaskLaneV1;
  kind: string;
  skillId: string | null;
  executionMode: GameProductionTaskExecutionModeV1;
  dependsOn: string[];
  requiredReceipts: Array<{ taskKey: string; receiptHash: string | null }>;
  inputArtifactKeys: string[];
  outputArtifactKeys: string[];
  requirementKeys: string[];
  capabilityRequirementKeys: string[];
  concurrencyGroup: string;
  subjectLockKeys: string[];
  priority: number;
  budgetReservation: GameTaskBudgetReservationV1;
  maxAttempts: number;
  timeoutMs: number;
  failurePolicy: "fail-build" | "pause" | "fallback" | "skip-optional";
  fallbackTaskKey: string | null;
  acceptanceGateIds: string[];
  reuse: GameArtifactReuseDecisionV1 | null;
}

export interface GameProductionPlanV3 {
  schema: "storyforge.game-production-plan";
  version: 3;
  buildNumber: number;
  productType: import("./text-game").GameProductType;
  briefHash: string;
  controlEpoch: number;
  concurrency: {
    maximumCostBearingTasks: number;
    maximumTextProviderTasks: number;
    maximumMediaProviderTasks: number;
  };
  tasks: GameProductionPlanTaskV3[];
  terminalTaskKey: string;
}

export interface GameBuildManifestV1 {
  schema: "storyforge.game-build-manifest";
  version: 1;
  productionKey: string;
  buildNumber: number;
  briefRevision: number;
  briefHash: string;
  planHash: string;
  controlEpoch: number;
  runtimePackageHash: string;
  artifactReceipts: Array<{
    artifactKey: string;
    version: number;
    contentHash: string;
    producerReceiptHash: string | null;
  }>;
  completedGateIds: string[];
  fallbackSummary: string[];
}

export interface GameBuildQualityReportV1 {
  schema: "storyforge.game-build-quality-report";
  version: 1;
  buildNumber: number;
  packageHash: string;
  hardGateResults: Array<{
    gateId: string;
    passed: boolean;
    evidence: string[];
  }>;
  softGateResults: Array<{
    gateId: string;
    passed: boolean;
    evidence: string[];
  }>;
  mediaCoverage: number;
  playable: boolean;
  releaseReady: boolean;
  warnings: string[];
}

export type GameQualityGateReceiptStatusV1 =
  "passed" | "failed" | "needs-human" | "waived" | "skipped";

/**
 * Immutable verifier evidence attached to one Build. The indexed row keeps the
 * complete canonical receipt instead of spreading verifier-specific fields
 * across the Build record, so threshold upgrades create a new receipt rather
 * than rewriting old evidence.
 */
export interface GameQualityGateReceiptRecordV1 {
  id?: number;
  projectId: number;
  worldId: number;
  workId: number;
  buildId: number;
  gateId: string;
  gateVersion: string;
  verifierId: string;
  verifierVersion: string;
  status: GameQualityGateReceiptStatusV1;
  receiptJson: string;
  receiptHash: string;
  createdAt: number;
}

export type GameEvolutionBaseV1 =
  | { kind: "build"; buildNumber: number; manifestHash: string }
  | { kind: "release"; gameReleaseId: number; contentHash: string };

export type GameEvolutionAffectedLaneV1 =
  "content" | "product" | "visual" | "audio" | "world-source";

export interface GameEvolutionImpactV1 {
  schema: "storyforge.game-evolution-impact";
  version: 1;
  base: GameEvolutionBaseV1;
  userGoal: string;
  affectedLanes: GameEvolutionAffectedLaneV1[];
}

export interface GameProductionBlockerResolutionV1 {
  action:
    "retry" | "fallback" | "waive-soft-gate" | "change-capability" | "cancel";
  note: string;
}

export type GameBuildCompatibilityLevelV1 =
  "compatible" | "restart-recommended" | "breaking";

export interface GameBuildCompatibilityReportV1 {
  schema: "storyforge.game-build-compatibility";
  version: 1;
  level: GameBuildCompatibilityLevelV1;
  fromBuildNumber: number | null;
  fromPackageHash: string | null;
  toBuildNumber: number;
  toPackageHash: string;
  addedStableKeys: string[];
  removedStableKeys: string[];
  changedStableKeys: string[];
  unchangedStableKeyCount: number;
  migrationPolicy: "initial-session" | "identity" | "additive" | "pin-old-save";
  reasons: string[];
  reportHash: string;
}

export type GameProductionCommandV1 =
  | {
      type: "create-intent";
      commandId: string;
      productionKey: string;
      worldReleaseId: number;
      userText: string;
    }
  | {
      type: "save-brief-revision";
      commandId: string;
      expectedStateRevision: number;
      parentRevision: number | null;
      brief: GameProductionBriefV3;
    }
  | {
      type: "authorize-start";
      commandId: string;
      expectedStateRevision: number;
      briefRevision: number;
      briefHash: string;
      authorizationNonce: string;
    }
  | {
      type: "pause";
      commandId: string;
      expectedStateRevision: number;
      reason: string;
    }
  | { type: "resume"; commandId: string; expectedStateRevision: number }
  | {
      type: "stop";
      commandId: string;
      expectedStateRevision: number;
      retention: "keep-build" | "discard-unreleased";
    }
  | {
      type: "resolve-blocker";
      commandId: string;
      expectedStateRevision: number;
      blockerKey: string;
      resolution: GameProductionBlockerResolutionV1;
    }
  | {
      type: "request-preview";
      commandId: string;
      expectedStateRevision: number;
      buildNumber: number;
    }
  | {
      type: "publish";
      commandId: string;
      expectedStateRevision: number;
      buildNumber: number;
      expectedManifestHash: string;
      adoptionIntentHash: string;
    }
  | {
      type: "archive";
      commandId: string;
      expectedStateRevision: number;
      reason: string;
    }
  | { type: "restore"; commandId: string; expectedStateRevision: number }
  | {
      type: "evolve";
      commandId: string;
      expectedStateRevision: number;
      base: GameEvolutionBaseV1;
      userText: string;
      affectedLanes: GameEvolutionAffectedLaneV1[];
    };

export interface GameProductionRecordV1 {
  id?: number;
  projectId: number;
  worldId: number;
  workId: number;
  productionKey: string;
  title: string;
  status: GameProductionStatusV1;
  stateRevision: number;
  controlEpoch: number;
  currentBriefRevision: number | null;
  currentBuildNumber: number | null;
  currentGameReleaseId: number | null;
  lastErrorJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface GameProductionBriefRecordV1 {
  id?: number;
  projectId: number;
  worldId: number;
  workId: number;
  productionId: number;
  revision: number;
  parentRevision: number | null;
  status: "draft" | "authorized" | "superseded" | "withdrawn";
  sourceWorldReleaseId: number;
  sourceWorldContentHash: string;
  userIntentSummary: string;
  unresolvedJson: string;
  estimateJson: string;
  briefJson: string;
  briefHash: string;
  /** Frozen stage-two read authority. Empty legacy sentinels are rejected and
   * require the author to save a fresh Brief before production can start. */
  sourcePlanJson: string;
  sourcePlanHash: string;
  /** Frozen only by the explicit authorize-start command. */
  confirmedBriefJson: string;
  confirmedBriefHash: string;
  authorizedAt: number | null;
  createdAt: number;
}

export interface GameProductionCommandRecordV1 {
  id?: number;
  projectId: number;
  worldId: number;
  workId: number;
  productionId: number;
  commandId: string;
  type: GameProductionCommandTypeV1;
  payloadHash: string;
  expectedStateRevision: number | null;
  status: "claimed" | "succeeded" | "failed" | "abandoned";
  resultJson: string;
  errorCode: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface GameBuildRecordV1 {
  id?: number;
  projectId: number;
  worldId: number;
  workId: number;
  productionId: number;
  buildNumber: number;
  briefRevision: number;
  briefHash: string;
  parentBuildNumber: number | null;
  sourceGameReleaseId: number | null;
  status: GameBuildStatusV1;
  resumeState: GameBuildStatusV1 | null;
  stateRevision: number;
  controlEpoch: number;
  planRevision: number;
  planJson: string;
  planHash: string;
  budgetLedgerJson: string;
  manifestJson: string;
  manifestHash: string;
  packageHash: string;
  previewManifestJson: string;
  previewHash: string;
  qualityReportJson: string;
  qualityReportHash: string;
  compatibilityJson: string;
  rootTerminalReceiptHash: string | null;
  adoptionIntentHash: string | null;
  releasedGameReleaseId: number | null;
  failureJson: string;
  authorizedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GameBuildArtifactRecordV1 {
  id?: number;
  projectId: number;
  worldId: number;
  workId: number;
  buildId: number;
  artifactKey: string;
  requirementKey: string | null;
  version: number;
  kind: GameBuildArtifactKindV1;
  mediaKind: ProductMediaKind | null;
  status: GameBuildArtifactStatusV1;
  producerRunId: number | null;
  producerReceiptHash: string | null;
  controlEpoch: number;
  inputHash: string;
  contentHash: string;
  payloadJson: string;
  metadataJson: string;
  qualityJson: string;
  rightsJson: string;
  blobObjectId: number | null;
  mimeType: string | null;
  byteSize: number;
  parentArtifactHash: string | null;
  carriedFrom: {
    buildNumber: number;
    artifactKey: string;
    version: number;
    contentHash: string;
  } | null;
  createdAt: number;
  updatedAt: number;
}

export interface MediaBlobObjectRecordV1 {
  id?: number;
  projectId: number;
  worldId: number;
  workId: number;
  contentHash: string;
  mimeType: string;
  byteSize: number;
  backend: "indexeddb" | "opfs";
  storageState: "pending-write" | "ready" | "pending-delete" | "corrupt";
  data: ArrayBuffer | null;
  opfsPath: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  lastVerifiedAt: number | null;
  /** Optional image metadata used by comic/image products on the shared blob row. */
  width?: number;
  height?: number;
  disposition?: "available" | "pending-delete";
  deleteRequestedAt?: number | null;
  deleteReceiptHash?: string | null;
  createdAt: number;
  updatedAt: number;
}
