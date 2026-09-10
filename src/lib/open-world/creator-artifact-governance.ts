import Dexie from 'dexie'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { agentRunUtf8ByteLengthV1 } from '../agent/run/checkpoint-contract'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { db } from '../db/schema'
import type {
  AgentRunCheckpointRecord,
  AgentRunEventRecord,
  AgentRunRecord,
  MediaBlobObjectRecordV1,
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionPlanV3,
  ProductProductionRecordV1,
  WorkspaceScope,
} from '../types'
import type {
  ProductProductionTaskArtifactV1,
  ProductProductionTaskExecutionResultV1,
} from '../product-production/scheduler'
import {
  parseProductBuildManifestV1,
  parseProductBuildQualityReportV1,
} from '../product-production/adoption'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { verifyProductBuildRootTerminalReceiptV1 } from '../product-production/receipts'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { parseProductRuntimePackageV1 } from '../product-production/runtime-package'
import {
  hashProductProductionCarriedCandidateV1,
  hashProductProductionCarriedReceiptV1,
  hashProductProductionParentArtifactProofV1,
  hashProductProductionPortableRootSealV1,
  hashProductProductionSealedParentArtifactProofV1,
  hashProductProductionTaskCandidateV1,
  hashProductProductionTaskReceiptV1,
  parseProductProductionPortableTaskLedgerV1,
  type ProductProductionParentRunWitnessV1,
} from '../product-production/task-evidence'
import { textOpenWorldProductionArtifactKindForKeyV1 } from './production-contract'
import {
  inspectTextOpenWorldProductionPlanAuthorityV1,
  readTextOpenWorldProductionPlanAuthorityV1,
  type TextOpenWorldProductionPlanAuthorityV1,
} from './production-authority'
import {
  validateTextOpenWorldSourcePinBundleV1,
  validateTextOpenWorldSourcePinUnitV1,
  validateTextOpenWorldSourcePinV1,
} from './source-pin'

const ACTIVE_ARTIFACT_STATUSES = new Set(['accepted', 'carried-forward'])
const COMPLETED_ROOT_BUILD_STATUSES = new Set(['preview-ready', 'release-ready', 'released', 'archived'])
const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const MAX_EVIDENCE_REFS = 500
const MAX_ENTITY_REFS = 1_000
const MAX_EVIDENCE_SCAN_NODES = 100_000
const MAX_VALIDATED_EVIDENCE_REFS = 20_000
const MAX_CURRENT_BUILD_ARTIFACT_ROWS = 65_536
const MAX_CURRENT_ACTIVE_ARTIFACT_ROWS = 65_536
const MAX_LINEAGE_ARTIFACT_ROWS = 262_144
const MAX_LINEAGE_BUILD_ROWS = 65
const MAX_LINEAGE_DEPTH = 64
const MAX_CURRENT_GOVERNANCE_JSON_BYTES = 256 * 1024 * 1024
const MAX_LINEAGE_GOVERNANCE_JSON_BYTES = 512 * 1024 * 1024
const MAX_CURRENT_GOVERNANCE_RUNS = 512
const MAX_GOVERNANCE_RUNS = 8_192
const RUN_EVIDENCE_READ_CONCURRENCY = 1
const MAX_GOVERNANCE_CHECKPOINT_BYTES = 64 * 1024 * 1024
const MAX_GOVERNANCE_RUN_EVENT_BYTES = 64 * 1024 * 1024
const MAX_SINGLE_RUN_EVENT_BYTES = 16 * 1024 * 1024
const MAX_SINGLE_RUN_EVENT_COUNT = 10_000
const GOVERNANCE_RUN_EVENT_DIGEST_PAGE_SIZE = 64
const MAX_PROJECTED_ENTITIES = 50_000
const MAX_REFERENCE_EDGES_SCANNED = 1_000_000
const MAX_PUBLIC_DTO_UTF8_BYTES = 64 * 1024 * 1024
const GOVERNANCE_TEXT_ENCODER = new TextEncoder()

/**
 * The Artifact row hash protects the serialized payload. Most text-open-world
 * payloads also carry a domain hash used by downstream compilers. Rechecking
 * that inner hash prevents a structurally plausible, self-rehashed row from
 * being presented as a domain-valid artifact.
 */
const ARTIFACT_OWN_HASH_FIELDS: Readonly<Record<string, string | null>> = {
  'text-open-world.source-pin': 'pinHash',
  'text-open-world.source-pin-unit': null,
  'text-open-world.source-manifest': 'manifestHash',
  'text-open-world.source-ledger': 'ledgerHash',
  'text-open-world.source-gap-report': 'reportHash',
  'text-open-world.game-brief': 'gameBriefHash',
  'text-open-world.experience-contract': 'experienceContractHash',
  'text-open-world.protagonist-asset': 'protagonistAssetHash',
  'text-open-world.gameplay-ruleset-skeleton': 'gameplayRulesetHash',
  'text-open-world.presentation-profile': 'presentationProfileHash',
  'text-open-world.story-arc': 'storyArcHash',
  'text-open-world.ending-contracts': 'endingContractsHash',
  'text-open-world.narrative-promises': 'narrativePromisesHash',
  'text-open-world.region-skeleton': 'regionSkeletonHash',
  'text-open-world.player-build': 'playerBuildHash',
  'text-open-world.mainline-thread': 'mainlineThreadHash',
  'text-open-world.significant-threads': 'significantThreadsHash',
  'text-open-world.region-narrative-packs': 'regionNarrativePacksHash',
  'text-open-world.quest-skeletons': 'questSkeletonsHash',
  'text-open-world.content-requirement-manifest': 'contentRequirementManifestHash',
  'text-open-world.progression-catalogs': 'progressionCatalogsHash',
  'text-open-world.enemy-encounter-catalog': 'enemyEncounterCatalogHash',
  'text-open-world.item-reward-catalog': 'itemRewardCatalogHash',
  'text-open-world.crafting-economy-catalog': 'craftingEconomyCatalogHash',
  'text-open-world.npc-runtime-catalog': 'npcRuntimeCatalogHash',
  'text-open-world.map-interaction-catalog': 'mapInteractionCatalogHash',
  'text-open-world.quest-design-documents': 'questDesignDocumentsHash',
  'text-open-world.director-decks': 'directorDecksHash',
  'text-open-world.scene-scripts': 'sceneScriptsHash',
  'text-open-world.choice-contracts': 'choiceContractsHash',
  'text-open-world.action-bindings': 'actionBindingsHash',
  'text-open-world.system-configs': 'systemConfigsHash',
  'text-open-world.media-requirements': 'mediaRequirementsHash',
  'text-open-world.content-budget': 'contentBudgetHash',
  'text-open-world.deterministic-preflight': 'deterministicPreflightHash',
  'text-open-world.balance-review': 'balanceReviewHash',
  'text-open-world.semantic-review': 'semanticReviewHash',
  'text-open-world.runtime-package': null,
  'text-open-world.integration-report': 'integrationReportHash',
  'text-open-world.quality-report': null,
  image: null,
  audio: null,
}

const UPSTREAM_HASH_ARTIFACTS: Readonly<Record<string, string>> = {
  sourcePinHash: 'text-open-world.source-pin',
  sourceManifestHash: 'text-open-world.source-manifest',
  sourceLedgerHash: 'text-open-world.source-ledger',
  gameBriefHash: 'text-open-world.game-brief',
  experienceContractHash: 'text-open-world.experience-contract',
  protagonistAssetHash: 'text-open-world.protagonist-asset',
  gameplayRulesetHash: 'text-open-world.gameplay-ruleset-skeleton',
  presentationProfileHash: 'text-open-world.presentation-profile',
  storyArcHash: 'text-open-world.story-arc',
  endingContractsHash: 'text-open-world.ending-contracts',
  narrativePromisesHash: 'text-open-world.narrative-promises',
  regionSkeletonHash: 'text-open-world.region-skeleton',
  playerBuildHash: 'text-open-world.player-build',
  mainlineThreadHash: 'text-open-world.mainline-thread',
  significantThreadsHash: 'text-open-world.significant-threads',
  regionNarrativePacksHash: 'text-open-world.region-narrative-packs',
  questSkeletonsHash: 'text-open-world.quest-skeletons',
  contentRequirementManifestHash: 'text-open-world.content-requirement-manifest',
  progressionCatalogsHash: 'text-open-world.progression-catalogs',
  enemyEncounterCatalogHash: 'text-open-world.enemy-encounter-catalog',
  itemRewardCatalogHash: 'text-open-world.item-reward-catalog',
  craftingEconomyCatalogHash: 'text-open-world.crafting-economy-catalog',
  npcRuntimeCatalogHash: 'text-open-world.npc-runtime-catalog',
  mapInteractionCatalogHash: 'text-open-world.map-interaction-catalog',
  questDesignDocumentsHash: 'text-open-world.quest-design-documents',
  directorDecksHash: 'text-open-world.director-decks',
  sceneScriptsHash: 'text-open-world.scene-scripts',
  choiceContractsHash: 'text-open-world.choice-contracts',
  actionBindingsHash: 'text-open-world.action-bindings',
  systemConfigsHash: 'text-open-world.system-configs',
  mediaRequirementsHash: 'text-open-world.media-requirements',
  contentBudgetHash: 'text-open-world.content-budget',
  deterministicPreflightHash: 'text-open-world.deterministic-preflight',
  balanceReviewHash: 'text-open-world.balance-review',
  semanticReviewHash: 'text-open-world.semantic-review',
  runtimePackageHash: 'text-open-world.runtime-package',
}

export type TextOpenWorldGovernedArtifactHealthV1 =
  | 'verified'
  | 'pending'
  | 'stale'
  | 'invalid'
  | 'corrupt'
  | 'dangling'

export type TextOpenWorldArtifactProductionValidationV1 =
  | 'production-validated'
  | 'integrity-only'
  | 'not-applicable'

export type TextOpenWorldGovernedArtifactGroupV1 =
  | 'source'
  | 'design'
  | 'narrative'
  | 'world'
  | 'gameplay'
  | 'quests'
  | 'presentation'
  | 'media'
  | 'governance'

export type TextOpenWorldGovernedEntityKindV1 =
  | 'story'
  | 'story-beat'
  | 'ending'
  | 'promise'
  | 'storyline'
  | 'story-stage'
  | 'region'
  | 'location'
  | 'route'
  | 'fast-travel-point'
  | 'character'
  | 'faction'
  | 'schedule'
  | 'quest'
  | 'quest-stage'
  | 'quest-objective'
  | 'quest-seed'
  | 'requirement'
  | 'condition'
  | 'effect'
  | 'action'
  | 'skill'
  | 'item'
  | 'reward'
  | 'drop-table'
  | 'enemy'
  | 'encounter'
  | 'vendor'
  | 'recipe'
  | 'interaction'
  | 'event'
  | 'scene'

export interface TextOpenWorldArtifactDiagnosticV1 {
  code: string
  message: string
}

export interface TextOpenWorldArtifactEvidenceRefV1 {
  kind: 'source-claim' | 'internal-ref' | 'hash'
  key: string
  field: string
}

export interface TextOpenWorldGovernedArtifactV1 {
  rowId: number
  artifactKey: string
  requirementKey: string | null
  kind: string
  label: string
  group: TextOpenWorldGovernedArtifactGroupV1
  version: number
  artifactStatus: ProductBuildArtifactRecordV1['status']
  health: TextOpenWorldGovernedArtifactHealthV1
  productionValidation: TextOpenWorldArtifactProductionValidationV1
  validatorId: string | null
  validationReceiptHash: string | null
  currentEpoch: boolean
  controlEpoch: number
  ownerTaskKey: string | null
  ownerLane: string | null
  producerRunId: number | null
  producerRunState: string | null
  producerReceiptHash: string | null
  inputHash: string
  contentHash: string
  schema: string | null
  byteSize: number
  mediaKind: ProductBuildArtifactRecordV1['mediaKind']
  mimeType: string | null
  sourceEvidence: TextOpenWorldArtifactEvidenceRefV1[]
  sourceEvidenceCount: number
  truncatedSourceEvidenceCount: number
  entityIdentities: string[]
  diagnostics: TextOpenWorldArtifactDiagnosticV1[]
  createdAt: number
  updatedAt: number
}

export interface TextOpenWorldGovernedEntityReferenceV1 {
  field: string
  targetKind: TextOpenWorldGovernedEntityKindV1
  targetKey: string
  targetIdentity: string
  status: 'resolved' | 'pending' | 'dangling'
}

export interface TextOpenWorldGovernedEntityFieldV1 {
  key: string
  label: string
  value: string
}

export interface TextOpenWorldGovernedEntityV1 {
  identity: string
  kind: TextOpenWorldGovernedEntityKindV1
  key: string
  title: string
  summary: string
  status: 'verified' | 'pending-reference' | 'dangling'
  artifactKey: string
  artifactVersion: number
  artifactContentHash: string
  definedByArtifactKeys: string[]
  fields: TextOpenWorldGovernedEntityFieldV1[]
  sourceEvidence: TextOpenWorldArtifactEvidenceRefV1[]
  sourceEvidenceCount: number
  truncatedSourceEvidenceCount: number
  references: TextOpenWorldGovernedEntityReferenceV1[]
  referenceCount: number
  truncatedReferenceCount: number
}

export interface TextOpenWorldArtifactCandidateEvidenceV1 {
  checkpointHash: string
  taskKey: string
  attempt: number
  controlEpoch: number
  inputHash: string
  candidateHash: string
  result: ProductProductionTaskExecutionResultV1
}

export interface TextOpenWorldArtifactRunEventStreamFingerprintV1 {
  eventCount: number
  payloadBytes: number
  firstSequence: number | null
  lastSequence: number | null
  eventStreamHash: string
}

export interface TextOpenWorldArtifactRunEvidenceV1 {
  runId: number
  state: string
  projectId: number
  workId: number | null
  productBuildId: number | null
  parentRunId: number | null
  parentRelation: string | null
  terminalReceiptHash: string | null
  boundary: {
    productBuildId: number
    buildNumber: number
    controlEpoch: number
    planHash: string
    taskKey: string
  } | null
  taskStep: {
    currentAttempt: number
    candidateHash: string | null
    outputHash: string | null
  } | null
  candidate: TextOpenWorldArtifactCandidateEvidenceV1 | null
  /** Exact initial read-set member retained even when the Run row is missing. */
  snapshotFingerprint?: GovernanceRunFingerprintV1
  integrity?: {
    status: string
    projectId: number
    workId: number | null
    productBuildId: number | null
    parentRunId: number | null
    parentRelation: string | null
    terminalReceiptHash: string | null
    contractVersion: number
    contractHash: string
    generation: number
    lastSequence: number
    projectionHash: string
    updatedAt: number
    contractJsonBytes: number
    contractJsonByteHash: string
    projectionJsonBytes: number
    projectionJsonByteHash: string
    checkpoint: {
      id: number
      throughSequence: number
      generation: number
      contractHash: string
      checkpointHash: string
      projectionHash: string
      resumePayloadHash: string | null
      resumePayloadBytes: number
      projectionJsonBytes: number
      projectionJsonByteHash: string
      resumePayloadJsonByteHash: string | null
    } | null
    eventStream: TextOpenWorldArtifactRunEventStreamFingerprintV1
  } | null
  error: string | null
}

export interface TextOpenWorldArtifactBuildEvidenceV1 {
  build: ProductBuildRecordV1 & { id: number }
  plan: ProductProductionPlanV3 | null
  rootRunId: number | null
  taskLedger: Record<string, {
    runId: number
    status: string
    idempotencyKey: string | null
    candidateHash: string | null
    terminalReceiptHash: string | null
  }>
}

export interface TextOpenWorldArtifactBlobEvidenceV1 {
  blobId: number
  projectId: number
  worldId: number
  workId: number
  contentHash: string
  mimeType: string
  byteSize: number
  storageState: MediaBlobObjectRecordV1['storageState']
  /** True only after the shared IndexedDB/OPFS byte verifier has rehashed the payload. */
  physicalBytesVerified: boolean
}

export interface TextOpenWorldArtifactGovernanceProjectionV1 {
  schema: 'storyforge.text-open-world-artifact-governance-projection'
  version: 1
  production: {
    id: number
    productionKey: string
    title: string
    status: ProductProductionRecordV1['status']
    stateRevision: number
  }
  build: {
    id: number
    buildNumber: number
    status: ProductBuildRecordV1['status']
    controlEpoch: number
    planHash: string
  }
  snapshotHash: string
  summary: {
    rowCount: number
    currentVerifiedArtifactCount: number
    currentProductionValidatedArtifactCount: number
    currentIntegrityOnlyArtifactCount: number
    currentProblemArtifactCount: number
    historicalArtifactCount: number
    entityCount: number
    danglingEntityCount: number
    pendingReferenceEntityCount: number
  }
  artifacts: TextOpenWorldGovernedArtifactV1[]
  entities: TextOpenWorldGovernedEntityV1[]
}

export type TextOpenWorldArtifactBrowserModeV1 = 'content' | 'artifacts' | 'diagnostics'

export interface TextOpenWorldArtifactBrowserPageV1 {
  snapshotHash: string
  mode: TextOpenWorldArtifactBrowserModeV1
  page: number
  pageSize: number
  total: number
  pageCount: number
  entities: TextOpenWorldGovernedEntityV1[]
  artifacts: TextOpenWorldGovernedArtifactV1[]
}

interface EntityReferenceSpecV1 {
  path: string[]
  field: string
  targetKind: TextOpenWorldGovernedEntityKindV1
  targetArtifacts: string[]
}

interface EntityCollectionSpecV1 {
  path: string[]
  kind: TextOpenWorldGovernedEntityKindV1
  rank: number
  staticKey?: string
  title?: string
  references?: EntityReferenceSpecV1[]
}

interface ArtifactPresentationV1 {
  label: string
  group: TextOpenWorldGovernedArtifactGroupV1
}

const ARTIFACT_PRESENTATION: Record<string, ArtifactPresentationV1> = {
  'text-open-world.source-pin': { label: '冻结来源', group: 'source' },
  'text-open-world.source-pin-unit': { label: '冻结来源单元', group: 'source' },
  'text-open-world.source-manifest': { label: '来源读取清单', group: 'source' },
  'text-open-world.source-ledger': { label: '来源证据账本', group: 'source' },
  'text-open-world.source-gap-report': { label: '来源缺口报告', group: 'source' },
  'text-open-world.game-brief': { label: '游戏 Brief', group: 'design' },
  'text-open-world.experience-contract': { label: '体验合同', group: 'design' },
  'text-open-world.protagonist-asset': { label: '主角身份资产', group: 'design' },
  'text-open-world.gameplay-ruleset-skeleton': { label: '玩法规则骨架', group: 'gameplay' },
  'text-open-world.presentation-profile': { label: '表现轮廓', group: 'presentation' },
  'text-open-world.story-arc': { label: '故事弧', group: 'narrative' },
  'text-open-world.ending-contracts': { label: '结局合同', group: 'narrative' },
  'text-open-world.narrative-promises': { label: '叙事承诺', group: 'narrative' },
  'text-open-world.region-skeleton': { label: '地区与地点骨架', group: 'world' },
  'text-open-world.player-build': { label: '玩家初始构筑', group: 'gameplay' },
  'text-open-world.mainline-thread': { label: '主线故事', group: 'narrative' },
  'text-open-world.significant-threads': { label: '重要故事线', group: 'narrative' },
  'text-open-world.region-narrative-packs': { label: '地区叙事生态', group: 'narrative' },
  'text-open-world.quest-skeletons': { label: '任务骨架', group: 'quests' },
  'text-open-world.content-requirement-manifest': { label: '内容需求清单', group: 'governance' },
  'text-open-world.progression-catalogs': { label: '成长与技能目录', group: 'gameplay' },
  'text-open-world.enemy-encounter-catalog': { label: '敌人与战斗目录', group: 'gameplay' },
  'text-open-world.item-reward-catalog': { label: '物品与奖励目录', group: 'gameplay' },
  'text-open-world.crafting-economy-catalog': { label: '制作与经济目录', group: 'gameplay' },
  'text-open-world.npc-runtime-catalog': { label: '角色与势力目录', group: 'world' },
  'text-open-world.map-interaction-catalog': { label: '地图与交互目录', group: 'world' },
  'text-open-world.quest-design-documents': { label: '可运行任务设计', group: 'quests' },
  'text-open-world.director-decks': { label: '地区发牌目录', group: 'quests' },
  'text-open-world.scene-scripts': { label: '场景脚本', group: 'presentation' },
  'text-open-world.choice-contracts': { label: '固定选项合同', group: 'presentation' },
  'text-open-world.action-bindings': { label: '自然语言与 Action 绑定', group: 'presentation' },
  'text-open-world.system-configs': { label: '系统配置', group: 'gameplay' },
  'text-open-world.media-requirements': { label: '媒资需求', group: 'media' },
  'text-open-world.content-budget': { label: '内容与时长预算', group: 'governance' },
  'text-open-world.deterministic-preflight': { label: '确定性预检', group: 'governance' },
  'text-open-world.balance-review': { label: '平衡评审', group: 'governance' },
  'text-open-world.semantic-review': { label: '叙事语义评审', group: 'governance' },
  'text-open-world.runtime-package': { label: '运行包', group: 'governance' },
  'text-open-world.integration-report': { label: '装配报告', group: 'governance' },
  'text-open-world.quality-report': { label: '发布质量报告', group: 'governance' },
}

const REGION_ARTIFACTS = ['text-open-world.region-skeleton', 'text-open-world.map-interaction-catalog']
const QUEST_ARTIFACTS = ['text-open-world.quest-skeletons', 'text-open-world.quest-design-documents']
const QUEST_RUNTIME_ARTIFACTS = ['text-open-world.quest-design-documents']

const ref = (
  field: string,
  targetKind: TextOpenWorldGovernedEntityKindV1,
  targetArtifacts: string[],
  ...path: string[]
): EntityReferenceSpecV1 => ({ field, targetKind, targetArtifacts, path })

const ENTITY_COLLECTIONS: Record<string, EntityCollectionSpecV1[]> = {
  'text-open-world.protagonist-asset': [
    { path: [], kind: 'character', rank: 30, staticKey: 'text-open-world.protagonist-asset.root', title: '玩家主角' },
  ],
  'text-open-world.story-arc': [
    { path: [], kind: 'story', rank: 10, staticKey: 'text-open-world.story-arc.root', title: '核心故事弧' },
    { path: ['macroBeats'], kind: 'story-beat', rank: 10, references: [
      ref('承诺设置', 'promise', ['text-open-world.narrative-promises'], 'promiseSetupKeys'),
      ref('承诺回调', 'promise', ['text-open-world.narrative-promises'], 'promiseCallbackKeys'),
      ref('承诺兑现', 'promise', ['text-open-world.narrative-promises'], 'promisePayoffKeys'),
    ] },
  ],
  'text-open-world.ending-contracts': [
    { path: ['endings'], kind: 'ending', rank: 10 },
  ],
  'text-open-world.narrative-promises': [
    { path: ['promises'], kind: 'promise', rank: 10, references: [
      ref('设置节拍', 'story-beat', ['text-open-world.story-arc'], 'setup', 'beatKey'),
      ref('回调节拍', 'story-beat', ['text-open-world.story-arc'], 'callbacks', '*', 'beatKey'),
      ref('兑现节拍', 'story-beat', ['text-open-world.story-arc'], 'payoff', 'beatKey'),
      ref('关联结局', 'ending', ['text-open-world.ending-contracts'], 'payoff', 'endingKeys'),
    ] },
  ],
  'text-open-world.mainline-thread': [
    { path: ['thread'], kind: 'storyline', rank: 20, references: [
      ref('阶段', 'story-stage', ['text-open-world.mainline-thread'], 'stageKeys'),
      ref('结局', 'ending', ['text-open-world.ending-contracts'], 'endingKeys'),
    ] },
    { path: ['stages'], kind: 'story-stage', rank: 20, references: [
      ref('上一阶段', 'story-stage', ['text-open-world.mainline-thread'], 'previousStageKey'),
      ref('下一阶段', 'story-stage', ['text-open-world.mainline-thread'], 'nextStageKey'),
      ref('故事节拍', 'story-beat', ['text-open-world.story-arc'], 'storyBeatKey'),
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKeys'),
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKeys'),
    ] },
  ],
  'text-open-world.significant-threads': [
    { path: ['threads'], kind: 'storyline', rank: 20, references: [
      ref('故事节拍', 'story-beat', ['text-open-world.story-arc'], 'storyBeatKeys'),
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKeys'),
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKeys'),
      ref('叙事承诺', 'promise', ['text-open-world.narrative-promises'], 'supportingPromiseKeys'),
      ref('阶段', 'story-stage', ['text-open-world.significant-threads'], 'stageKeys'),
    ] },
    { path: ['stages'], kind: 'story-stage', rank: 20, references: [
      ref('故事线', 'storyline', ['text-open-world.significant-threads'], 'threadKey'),
      ref('上一阶段', 'story-stage', ['text-open-world.significant-threads'], 'previousStageKey'),
      ref('下一阶段', 'story-stage', ['text-open-world.significant-threads'], 'nextStageKey'),
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKeys'),
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKeys'),
    ] },
  ],
  'text-open-world.region-skeleton': [
    { path: ['regions'], kind: 'region', rank: 30, references: [
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKeys'),
      ref('快速旅行点', 'fast-travel-point', ['text-open-world.region-skeleton'], 'fastTravelPointKey'),
    ] },
    { path: ['locations'], kind: 'location', rank: 30, references: [
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKey'),
    ] },
    { path: ['edges'], kind: 'route', rank: 30, references: [
      ref('起点', 'location', REGION_ARTIFACTS, 'fromLocationKey'),
      ref('终点', 'location', REGION_ARTIFACTS, 'toLocationKey'),
    ] },
    { path: ['fastTravelPoints'], kind: 'fast-travel-point', rank: 30, references: [
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKey'),
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKey'),
    ] },
  ],
  'text-open-world.region-narrative-packs': [
    { path: ['packs'], kind: 'story', rank: 15, references: [
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKey'),
    ] },
    { path: ['packs', '*', 'ordinaryQuestSeeds'], kind: 'quest-seed', rank: 10, references: [
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKeys'),
    ] },
    { path: ['packs', '*', 'taskTemplateSeeds'], kind: 'quest-seed', rank: 10, references: [
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKeys'),
    ] },
    { path: ['packs', '*', 'randomEventSeeds'], kind: 'event', rank: 10, references: [
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKeys'),
    ] },
  ],
  'text-open-world.quest-skeletons': [
    { path: ['quests'], kind: 'quest', rank: 10, references: [
      ref('故事线', 'storyline', ['text-open-world.mainline-thread', 'text-open-world.significant-threads'], 'storylineKey'),
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKeys'),
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKeys'),
      ref('任务阶段', 'quest-stage', QUEST_ARTIFACTS, 'stageKeys'),
    ] },
    { path: ['stages'], kind: 'quest-stage', rank: 10, references: [
      ref('任务', 'quest', QUEST_ARTIFACTS, 'questKey'),
      ref('上一阶段', 'quest-stage', QUEST_ARTIFACTS, 'previousStageKey'),
      ref('下一阶段', 'quest-stage', QUEST_ARTIFACTS, 'nextStageKey'),
      ref('目标', 'quest-objective', QUEST_ARTIFACTS, 'objectiveKeys'),
    ] },
    { path: ['objectives'], kind: 'quest-objective', rank: 10, references: [
      ref('任务', 'quest', QUEST_ARTIFACTS, 'questKey'),
      ref('任务阶段', 'quest-stage', QUEST_ARTIFACTS, 'stageKey'),
      ref('内容需求', 'requirement', ['text-open-world.content-requirement-manifest'], 'requirementKeys'),
    ] },
  ],
  'text-open-world.content-requirement-manifest': [
    { path: ['requirements'], kind: 'requirement', rank: 20 },
  ],
  'text-open-world.quest-design-documents': [
    { path: ['quests'], kind: 'quest', rank: 20, references: [
      ref('故事线', 'storyline', ['text-open-world.mainline-thread', 'text-open-world.significant-threads'], 'storylineKey'),
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKeys'),
      ref('任务阶段', 'quest-stage', ['text-open-world.quest-design-documents'], 'stageKeys'),
      ref('奖励', 'reward', ['text-open-world.item-reward-catalog'], 'rewardContractKey'),
      ref('前置条件', 'condition', QUEST_RUNTIME_ARTIFACTS, 'prerequisiteConditionKeys'),
      ref('奖励效果', 'effect', QUEST_RUNTIME_ARTIFACTS, 'rewardEffectKeys'),
      ref('领取动作', 'action', QUEST_RUNTIME_ARTIFACTS, 'claimActionKey'),
      ref('接受动作', 'action', QUEST_RUNTIME_ARTIFACTS, 'acceptActionKey'),
      ref('放弃动作', 'action', QUEST_RUNTIME_ARTIFACTS, 'abandonActionKey'),
      ref('过期动作', 'action', QUEST_RUNTIME_ARTIFACTS, 'expirationActionKeys'),
    ] },
    { path: ['stages'], kind: 'quest-stage', rank: 20, references: [
      ref('任务', 'quest', ['text-open-world.quest-design-documents'], 'questKey'),
      ref('目标', 'quest-objective', ['text-open-world.quest-design-documents'], 'objectiveKeys'),
      ref('完成条件', 'condition', QUEST_RUNTIME_ARTIFACTS, 'completionConditionKeys'),
      ref('完成动作', 'action', QUEST_RUNTIME_ARTIFACTS, 'completionActionKey'),
    ] },
    { path: ['objectives'], kind: 'quest-objective', rank: 20, references: [
      ref('任务', 'quest', ['text-open-world.quest-design-documents'], 'questKey'),
      ref('任务阶段', 'quest-stage', ['text-open-world.quest-design-documents'], 'stageKey'),
      ref('内容需求', 'requirement', ['text-open-world.content-requirement-manifest'], 'requirementKeys'),
      ref('支持动作', 'action', QUEST_RUNTIME_ARTIFACTS, 'supportActionKeys'),
      ref('完成条件', 'condition', QUEST_RUNTIME_ARTIFACTS, 'completionConditionKeys'),
      ref('完成动作', 'action', QUEST_RUNTIME_ARTIFACTS, 'completionActionKey'),
    ] },
    { path: ['conditions'], kind: 'condition', rank: 20 },
    { path: ['effects'], kind: 'effect', rank: 20 },
    { path: ['actions'], kind: 'action', rank: 20 },
  ],
  'text-open-world.progression-catalogs': [
    { path: ['skills'], kind: 'skill', rank: 20 },
  ],
  'text-open-world.enemy-encounter-catalog': [
    { path: ['enemies'], kind: 'enemy', rank: 20, references: [
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKey'),
      ref('常驻地点', 'location', REGION_ARTIFACTS, 'homeLocationKey'),
      ref('技能', 'skill', ['text-open-world.progression-catalogs'], 'skillKeys'),
    ] },
    { path: ['encounters'], kind: 'encounter', rank: 20, references: [
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKey'),
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKey'),
      ref('任务目标', 'quest-objective', QUEST_ARTIFACTS, 'questObjectiveKeys'),
      ref('敌人', 'enemy', ['text-open-world.enemy-encounter-catalog'], 'enemyGroups', '*', 'enemyKey'),
    ] },
  ],
  'text-open-world.item-reward-catalog': [
    { path: ['items'], kind: 'item', rank: 20 },
    { path: ['rewardContracts'], kind: 'reward', rank: 20, references: [
      ref('物品', 'item', ['text-open-world.item-reward-catalog'], 'grants', 'items', '*', 'itemKey'),
      ref('技能', 'skill', ['text-open-world.progression-catalogs'], 'grants', 'skillKeys'),
    ] },
    { path: ['dropTables'], kind: 'drop-table', rank: 20, references: [
      ref('敌人', 'enemy', ['text-open-world.enemy-encounter-catalog'], 'sourceEnemyKey'),
      ref('物品', 'item', ['text-open-world.item-reward-catalog'], 'entries', '*', 'itemKey'),
    ] },
  ],
  'text-open-world.crafting-economy-catalog': [
    { path: ['recipes'], kind: 'recipe', rank: 20, references: [
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKey'),
      ref('制作地点', 'location', REGION_ARTIFACTS, 'stationLocationKeys'),
      ref('材料', 'item', ['text-open-world.item-reward-catalog'], 'ingredients', '*', 'itemKey'),
      ref('产物', 'item', ['text-open-world.item-reward-catalog'], 'outputs', '*', 'itemKey'),
    ] },
    { path: ['vendors'], kind: 'vendor', rank: 20, references: [
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKey'),
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKey'),
      ref('商品', 'item', ['text-open-world.item-reward-catalog'], 'inventoryEntries', '*', 'itemKey'),
    ] },
  ],
  'text-open-world.npc-runtime-catalog': [
    { path: ['factions'], kind: 'faction', rank: 20 },
    { path: ['actors'], kind: 'character', rank: 20, references: [
      ref('势力', 'faction', ['text-open-world.npc-runtime-catalog'], 'factionKey'),
      ref('常驻地点', 'location', REGION_ARTIFACTS, 'homeLocationKey'),
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKey'),
      ref('任务', 'quest', QUEST_ARTIFACTS, 'questConsumerKeys'),
    ] },
    { path: ['schedules'], kind: 'schedule', rank: 20, references: [
      ref('角色', 'character', ['text-open-world.npc-runtime-catalog'], 'actorKey'),
      ref('地点', 'location', REGION_ARTIFACTS, 'entries', '*', 'locationKey'),
    ] },
  ],
  'text-open-world.map-interaction-catalog': [
    { path: ['regions'], kind: 'region', rank: 20, references: [
      ref('地点', 'location', ['text-open-world.map-interaction-catalog'], 'locationKeys'),
      ref('快速旅行点', 'fast-travel-point', ['text-open-world.map-interaction-catalog'], 'fastTravelPointKey'),
    ] },
    { path: ['locations'], kind: 'location', rank: 20, references: [
      ref('地区', 'region', ['text-open-world.map-interaction-catalog'], 'regionKey'),
    ] },
    { path: ['interactions'], kind: 'interaction', rank: 20, references: [
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKey'),
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKey'),
      ref('任务', 'quest', QUEST_ARTIFACTS, 'questConsumerKeys'),
    ] },
  ],
  'text-open-world.director-decks': [
    { path: ['templates'], kind: 'quest-seed', rank: 20, references: [
      ref('任务', 'quest', ['text-open-world.quest-design-documents'], 'questKey'),
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKeys'),
    ] },
    { path: ['randomEvents'], kind: 'event', rank: 20, references: [
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKeys'),
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKeys'),
      ref('升级模板', 'quest-seed', ['text-open-world.director-decks'], 'upgradeTemplateKey'),
    ] },
  ],
  'text-open-world.scene-scripts': [
    { path: ['scenes'], kind: 'scene', rank: 20, references: [
      ref('地区', 'region', REGION_ARTIFACTS, 'regionKey'),
      ref('地点', 'location', REGION_ARTIFACTS, 'locationKey'),
      ref('任务', 'quest', ['text-open-world.quest-design-documents'], 'questKey'),
      ref('任务阶段', 'quest-stage', ['text-open-world.quest-design-documents'], 'stageKey'),
      ref('任务目标', 'quest-objective', ['text-open-world.quest-design-documents'], 'objectiveKey'),
      ref('角色', 'character', ['text-open-world.npc-runtime-catalog'], 'actorKey'),
      ref('参与角色', 'character', ['text-open-world.npc-runtime-catalog'], 'participantKeys'),
      ref('地图交互', 'interaction', ['text-open-world.map-interaction-catalog'], 'interactionKey'),
      ref('随机事件', 'event', ['text-open-world.director-decks'], 'randomEventKey'),
    ] },
  ],
}

function presentation(kind: string): ArtifactPresentationV1 {
  return ARTIFACT_PRESENTATION[kind] ?? (kind === 'image' || kind === 'audio'
    ? { label: kind === 'image' ? '视觉媒资' : '音频媒资', group: 'media' }
    : { label: kind, group: 'governance' })
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function valuesAt(value: unknown, path: readonly string[]): unknown[] {
  if (path.length === 0) return [value]
  const [head, ...tail] = path
  if (head === '*') {
    return Array.isArray(value) ? value.flatMap(item => valuesAt(item, tail)) : []
  }
  const row = record(value)
  if (!row || !(head in row)) return []
  const next = row[head]
  if (tail.length === 0 && Array.isArray(next)) return next
  return valuesAt(next, tail)
}

function stringsAt(value: unknown, path: readonly string[]): string[] {
  return valuesAt(value, path)
    .flatMap(item => Array.isArray(item) ? item : [item])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim())
}

interface SourceEvidenceScanV1 {
  all: TextOpenWorldArtifactEvidenceRefV1[]
  disclosed: TextOpenWorldArtifactEvidenceRefV1[]
  truncatedCount: number
  overflow: boolean
}

function collectSourceEvidence(value: unknown): SourceEvidenceScanV1 {
  const found = new Map<string, TextOpenWorldArtifactEvidenceRefV1>()
  const pending: Array<{ value: unknown; field: string }> = [{ value, field: '' }]
  const visited = new WeakSet<object>()
  let scannedNodes = 0
  let overflow = false
  while (pending.length > 0) {
    const { value: current, field } = pending.pop()!
    scannedNodes += 1
    if (scannedNodes > MAX_EVIDENCE_SCAN_NODES) {
      overflow = true
      break
    }
    if (typeof current === 'object' && current != null) {
      if (visited.has(current)) continue
      visited.add(current)
    }
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current[index], field })
      }
      continue
    }
    const row = record(current)
    if (!row) continue
    for (const [key, item] of Object.entries(row)) {
      if ((key === 'sourceClaimKeys' || key === 'sourceRefs') && Array.isArray(item)) {
        for (const sourceKey of item) {
          if (typeof sourceKey !== 'string' || !sourceKey.trim()) continue
          const kind = key === 'sourceClaimKeys' ? 'source-claim' as const : 'internal-ref' as const
          found.set(`${kind}:${sourceKey}`, { kind, key: sourceKey, field: key })
          if (found.size > MAX_VALIDATED_EVIDENCE_REFS) {
            overflow = true
            break
          }
        }
      } else if (/Hash$/.test(key) && typeof item === 'string' && isSha256Hash(item)
        && (/^(source|gameBrief|experienceContract|storyArc|region|quest|contentRequirement)/.test(key))) {
        found.set(`hash:${key}:${item}`, { kind: 'hash', key: item, field: key })
      }
      if (overflow) break
      if (typeof item === 'object' && item != null) pending.push({ value: item, field: key || field })
    }
    if (overflow) break
  }
  const all = [...found.values()].sort((left, right) => left.kind.localeCompare(right.kind)
    || left.field.localeCompare(right.field) || left.key.localeCompare(right.key))
  return {
    all,
    disclosed: all.slice(0, MAX_EVIDENCE_REFS),
    truncatedCount: Math.max(0, all.length - MAX_EVIDENCE_REFS),
    overflow,
  }
}

/**
 * Creator browsing is an explicit disclosure surface. Never reflect arbitrary
 * payload keys: future schemas may add private knowledge, hidden conditions or
 * unrevealed outcomes that must not leak merely because they are strings.
 */
const ENTITY_DISCLOSURE_FIELDS: Readonly<Partial<Record<
  TextOpenWorldGovernedEntityKindV1,
  readonly string[]
>>> = {
  story: ['title', 'fantasy', 'localConflict', 'regionalQuestion', 'dailyLifeBaseline', 'distinctivenessStatement'],
  'story-beat': ['order', 'phase', 'title', 'dramaticPurpose', 'protagonistChange', 'requiredReveal'],
  ending: ['title', 'summary', 'outcomeSummary', 'emotionalPromise', 'decisivePlayerValue'],
  promise: ['title', 'summary', 'statement', 'playerExpectation'],
  storyline: ['order', 'kind', 'ownerKind', 'ownerTitle', 'title', 'summary', 'coreGoal', 'centralConflict', 'theme'],
  'story-stage': ['order', 'title', 'summary', 'dramaticQuestion', 'requiredReveal', 'stageOutcome', 'estimatedMinutes'],
  region: ['order', 'title', 'description', 'fantasy', 'localConflict', 'regionalQuestion', 'dailyLifeBaseline'],
  location: ['order', 'title', 'description', 'kind', 'purpose', 'dailyLife', 'contentRisk'],
  route: ['order', 'title', 'description', 'travelMinutes', 'riskProfile'],
  'fast-travel-point': ['order', 'title', 'description'],
  character: ['displayName', 'playerRole', 'identitySummary', 'motivations', 'personalStakes', 'title', 'name', 'tier', 'roleTitle', 'narrativeFunction', 'biography', 'routine'],
  faction: ['title', 'name', 'publicGoal', 'localResource', 'visiblePresence', 'summary'],
  schedule: ['title', 'summary'],
  quest: ['order', 'type', 'title', 'premise', 'description', 'storyMotivation', 'intendedPlayerExperience', 'estimatedMinutes', 'lifecyclePolicy', 'timePolicy', 'repeatable', 'initialStatus', 'tags'],
  'quest-stage': ['order', 'title', 'purpose', 'completionIntent'],
  'quest-objective': ['order', 'title', 'description', 'playerIntent', 'successDescription', 'optional', 'interactionTimeCostMinutes'],
  'quest-seed': ['order', 'title', 'premise', 'playerActivity', 'storyFrame', 'eligibilitySummary', 'estimatedMinutes'],
  requirement: ['order', 'kind', 'title', 'description', 'requestedTraits', 'minimumCount', 'criticality'],
  condition: ['title', 'description', 'kind'],
  effect: ['title', 'description', 'kind'],
  action: ['label', 'description', 'category', 'riskLevel'],
  skill: ['order', 'title', 'description', 'kind', 'activation', 'acquisition', 'resourceCost', 'cooldownTurns'],
  item: ['order', 'title', 'description', 'kind', 'rarity', 'basePrice', 'equipmentSlotKey'],
  reward: ['order', 'title', 'description'],
  'drop-table': ['order', 'title', 'description'],
  enemy: ['order', 'title', 'description', 'kind', 'level', 'role'],
  encounter: ['order', 'title', 'description', 'kind', 'recommendedLevel'],
  vendor: ['order', 'title', 'description', 'kind'],
  recipe: ['order', 'title', 'description', 'category'],
  interaction: ['order', 'title', 'description', 'kind', 'playerPrompt'],
  event: ['order', 'title', 'setup', 'playerOpportunity', 'kind', 'repeatability'],
  scene: ['order', 'title', 'summary', 'openingText', 'kind'],
}

function displayFields(
  kind: TextOpenWorldGovernedEntityKindV1,
  value: Record<string, unknown>,
): TextOpenWorldGovernedEntityFieldV1[] {
  const result: TextOpenWorldGovernedEntityFieldV1[] = []
  const append = (key: string, item: unknown) => {
    if (result.length >= 32) return
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const text = String(item).trim()
      if (text) result.push({ key, label: key, value: text.slice(0, 4_000) })
      return
    }
    if (Array.isArray(item) && item.every(entry => ['string', 'number', 'boolean'].includes(typeof entry))) {
      const text = item.slice(0, 50).map(String).join('、')
      if (text) result.push({ key, label: key, value: text.slice(0, 4_000) })
    }
  }
  for (const key of ENTITY_DISCLOSURE_FIELDS[kind] ?? []) append(key, value[key])
  return result
}

function titleOf(value: Record<string, unknown>, fallback: string): string {
  for (const key of ['title', 'displayName', 'name', 'label', 'roleTitle']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim().slice(0, 500)
  }
  return fallback
}

function summaryOf(value: Record<string, unknown>): string {
  for (const key of [
    'summary', 'description', 'premise', 'logline', 'themeStatement', 'purpose',
    'outcomeSummary', 'identitySummary', 'biography', 'storyFrame', 'openingText', 'setup',
  ]) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim().slice(0, 4_000)
  }
  const identity = record(value.identity)
  if (identity) {
    for (const key of ['fantasy', 'localConflict', 'regionalQuestion']) {
      if (typeof identity[key] === 'string' && identity[key].trim()) return identity[key].trim().slice(0, 4_000)
    }
  }
  return ''
}

function expectedArtifactSchema(kind: string): string {
  if (kind === 'image' || kind === 'audio') return 'storyforge.generated-media-artifact'
  if (kind === 'text-open-world.runtime-package') return 'storyforge.product-runtime-package'
  if (kind === 'text-open-world.quality-report') return 'storyforge.product-build-quality-report'
  return `storyforge.${kind.replace(/\./g, '-')}`
}

function assertProjectionPathExists(value: unknown, path: readonly string[], label: string): void {
  if (path.length === 0) {
    if (!record(value)) throw new Error(`${label} 必须是对象`)
    return
  }
  const [head, ...tail] = path
  if (head === '*') {
    if (!Array.isArray(value)) throw new Error(`${label} 的父级必须是数组`)
    for (const [index, item] of value.entries()) {
      assertProjectionPathExists(item, tail, `${label}[${index}]`)
    }
    return
  }
  const row = record(value)
  if (!row || !Object.prototype.hasOwnProperty.call(row, head)) {
    throw new Error(`${label} 缺少必需字段 ${head}`)
  }
  if (tail.length === 0) {
    if (!Array.isArray(row[head]) && !record(row[head])) {
      throw new Error(`${label}.${head} 必须是对象或对象数组`)
    }
    return
  }
  assertProjectionPathExists(row[head], tail, `${label}.${head}`)
}

async function validateArtifactPayloadContract(
  kind: string,
  payload: Record<string, unknown>,
  payloadJson: string,
): Promise<void> {
  if (!(kind in ARTIFACT_OWN_HASH_FIELDS)) {
    throw new Error(`Artifact kind 未登记读取合同:${kind}`)
  }
  if (kind === 'text-open-world.source-pin') {
    await validateTextOpenWorldSourcePinV1(payload)
    return
  }
  if (kind === 'text-open-world.source-pin-unit') {
    await validateTextOpenWorldSourcePinUnitV1(payload)
    return
  }
  if (kind === 'text-open-world.runtime-package') {
    const parsed = parseProductRuntimePackageV1(payload)
    if (parsed.productType !== 'text-open-world') throw new Error('RuntimePackage 产品类型错误')
    return
  }
  if (kind === 'text-open-world.quality-report') {
    parseProductBuildQualityReportV1(payloadJson)
    return
  }
  if (kind === 'image' || kind === 'audio') {
    if (typeof payload.assetKey !== 'string' || !STABLE_KEY.test(payload.assetKey)
      || !record(payload.request)) throw new Error('媒资 payload 缺少稳定 assetKey 或 request')
    return
  }
  if (payload.productType !== 'text-open-world') {
    throw new Error('文字开放世界 Artifact 缺少正确 productType')
  }
  if (typeof payload.productInstanceKey !== 'string' || !STABLE_KEY.test(payload.productInstanceKey)
    || !Number.isSafeInteger(payload.createdAt) || Number(payload.createdAt) < 0) {
    throw new Error('文字开放世界 Artifact 缺少稳定产品实例或 createdAt')
  }
  const ownHashField = ARTIFACT_OWN_HASH_FIELDS[kind]
  if (!ownHashField || !isSha256Hash(payload[ownHashField])) {
    throw new Error(`Artifact 缺少合法 ${ownHashField ?? 'domain hash'}`)
  }
  const body = { ...payload }
  delete body[ownHashField]
  if (await hashProductProductionValueV2(body) !== payload[ownHashField]) {
    throw new Error(`Artifact ${ownHashField} 与领域内容不一致`)
  }
  for (const spec of ENTITY_COLLECTIONS[kind] ?? []) {
    assertProjectionPathExists(payload, spec.path, `${kind}.projection`)
  }
}

function candidateEvidence(
  value: unknown,
  checkpointHash: string,
): TextOpenWorldArtifactCandidateEvidenceV1 | null {
  const candidate = record(value)
  const result = record(candidate?.result)
  if (!candidate || candidate.schema !== 'storyforge.product-production-task-candidate'
    || candidate.version !== 1 || typeof candidate.taskKey !== 'string'
    || !Number.isInteger(candidate.attempt) || !Number.isInteger(candidate.controlEpoch)
    || !isSha256Hash(candidate.inputHash) || !isSha256Hash(candidate.candidateHash)
    || !result || !Array.isArray(result.artifacts) || !Array.isArray(result.passedGateIds)
    || !record(result.usage)
    || !result.artifacts.every(item => {
      const artifact = record(item)
      return artifact != null
        && typeof artifact.artifactKey === 'string'
        && typeof artifact.kind === 'string'
        && artifact.payload !== undefined
    })
    || !result.passedGateIds.every(item => typeof item === 'string')) return null
  return {
    checkpointHash,
    taskKey: candidate.taskKey,
    attempt: candidate.attempt as number,
    controlEpoch: candidate.controlEpoch as number,
    inputHash: candidate.inputHash,
    candidateHash: candidate.candidateHash,
    // JSON.parse already produced a detached value. Cloning a potentially
    // large deterministic candidate here only doubles the reader heap.
    result: result as unknown as ProductProductionTaskExecutionResultV1,
  }
}

async function runEvidence(
  snapshot: AgentRunSnapshotV1,
  eventStream: TextOpenWorldArtifactRunEventStreamFingerprintV1,
  candidate: TextOpenWorldArtifactCandidateEvidenceV1 | null = null,
  checkpoint: LatestCheckpointHeaderV1 | null = null,
): Promise<TextOpenWorldArtifactRunEvidenceV1> {
  const boundary = snapshot.contract.scope.productProduction ?? null
  const step = boundary
    ? snapshot.projection.steps[boundary.taskKey]
      ?? (boundary.taskKey === '$root' ? snapshot.projection.steps.$join : null)
    : null
  return {
    runId: snapshot.run.id,
    state: snapshot.projection.state,
    projectId: snapshot.run.projectId,
    workId: snapshot.run.workId ?? null,
    productBuildId: snapshot.run.productBuildId ?? null,
    parentRunId: snapshot.run.parentRunId ?? null,
    parentRelation: snapshot.run.parentRelation ?? null,
    terminalReceiptHash: snapshot.projection.terminalReceiptHash ?? null,
    boundary: boundary ? { ...boundary } : null,
    taskStep: step ? {
      currentAttempt: step.attempt,
      candidateHash: step.candidateHash ?? null,
      outputHash: step.outputHash ?? null,
    } : null,
    candidate,
    integrity: {
      status: snapshot.run.status,
      projectId: snapshot.run.projectId,
      workId: snapshot.run.workId ?? null,
      productBuildId: snapshot.run.productBuildId ?? null,
      parentRunId: snapshot.run.parentRunId ?? null,
      parentRelation: snapshot.run.parentRelation ?? null,
      terminalReceiptHash: snapshot.run.terminalReceiptHash ?? null,
      contractVersion: snapshot.run.contractVersion,
      contractHash: snapshot.run.contractHash,
      generation: snapshot.run.generation,
      lastSequence: snapshot.run.lastSequence,
      projectionHash: snapshot.run.projectionHash,
      updatedAt: snapshot.run.updatedAt,
      contractJsonBytes: agentRunUtf8ByteLengthV1(snapshot.run.contractJson),
      contractJsonByteHash: await hashGovernanceUtf8TextV1(snapshot.run.contractJson),
      projectionJsonBytes: agentRunUtf8ByteLengthV1(snapshot.run.projectionJson),
      projectionJsonByteHash: await hashGovernanceUtf8TextV1(snapshot.run.projectionJson),
      checkpoint: checkpoint == null ? null : {
        id: checkpoint.id,
        throughSequence: checkpoint.throughSequence,
        generation: checkpoint.generation,
        contractHash: checkpoint.contractHash,
        checkpointHash: checkpoint.checkpointHash,
        projectionHash: checkpoint.projectionHash,
        resumePayloadHash: checkpoint.resumePayloadHash ?? null,
        resumePayloadBytes: checkpoint.resumePayloadBytes,
        projectionJsonBytes: checkpoint.projectionJsonBytes,
        projectionJsonByteHash: checkpoint.projectionJsonByteHash,
        resumePayloadJsonByteHash: checkpoint.resumePayloadJsonByteHash,
      },
      eventStream,
    },
    error: null,
  }
}

function artifactIssue(
  view: TextOpenWorldGovernedArtifactV1,
  code: string,
  message: string,
  health: TextOpenWorldGovernedArtifactHealthV1 = 'corrupt',
): void {
  view.diagnostics.push({ code, message })
  if (view.health === 'verified' || view.health === 'pending') view.health = health
  if (health !== 'verified') {
    view.productionValidation = 'not-applicable'
    view.validatorId = null
    view.validationReceiptHash = null
  }
}

async function productionValidationReceiptV1(input: {
  productionKey: string
  build: ProductBuildRecordV1 & { id: number }
  authorityReceiptHash: string
  taskKey: string
  validatorId: string
  artifacts: TextOpenWorldGovernedArtifactV1[]
}): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.text-open-world-production-validation-receipt',
    version: 1,
    productionKey: input.productionKey,
    buildNumber: input.build.buildNumber,
    planHash: input.build.planHash,
    controlEpoch: input.build.controlEpoch,
    authorityReceiptHash: input.authorityReceiptHash,
    taskKey: input.taskKey,
    validatorId: input.validatorId,
    artifacts: [...input.artifacts]
      .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)
        || left.version - right.version || left.rowId - right.rowId)
      .map(artifact => ({
        artifactKey: artifact.artifactKey,
        version: artifact.version,
        inputHash: artifact.inputHash,
        contentHash: artifact.contentHash,
        producerRunId: artifact.producerRunId,
        producerReceiptHash: artifact.producerReceiptHash,
      })),
  })
}

function isExactArtifactScope(scope: WorkspaceScope, row: ProductBuildArtifactRecordV1): boolean {
  return row.projectId === scope.projectId && row.worldId === scope.worldId && row.workId === scope.workId
}

function isSafeCarriedArtifactRefV1(
  value: unknown,
): value is NonNullable<ProductBuildArtifactRecordV1['carriedFrom']> {
  const row = record(value)
  if (!row) return false
  const keys = ['buildNumber', 'artifactKey', 'version', 'contentHash', 'proofHash']
  return Object.keys(row).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(row, key))
    && Number.isSafeInteger(row.buildNumber) && Number(row.buildNumber) >= 1
    && typeof row.artifactKey === 'string' && STABLE_KEY.test(row.artifactKey)
    && Number.isSafeInteger(row.version) && Number(row.version) >= 1
    && isSha256Hash(row.contentHash) && isSha256Hash(row.proofHash)
}

async function candidateArtifactMatchesRow(
  candidate: ProductProductionTaskArtifactV1,
  row: ProductBuildArtifactRecordV1,
): Promise<boolean> {
  const payloadJson = canonicalProductProductionJsonV2(candidate.payload)
  const metadataJson = canonicalProductProductionJsonV2(candidate.metadata ?? {})
  const qualityJson = canonicalProductProductionJsonV2(candidate.quality ?? {})
  const rightsJson = canonicalProductProductionJsonV2(candidate.rights ?? {})
  const expectedHash = candidate.contentHash ?? await hashProductProductionValueV2(candidate.payload)
  const expectedBytes = candidate.byteSize ?? new TextEncoder().encode(payloadJson).byteLength
  return candidate.artifactKey === row.artifactKey
    && (candidate.requirementKey ?? null) === row.requirementKey
    && candidate.kind === row.kind
    && (candidate.mediaKind ?? null) === row.mediaKind
    && payloadJson === row.payloadJson
    && metadataJson === row.metadataJson
    && qualityJson === row.qualityJson
    && rightsJson === row.rightsJson
    && expectedHash === row.contentHash
    && (candidate.blobObjectId ?? null) === row.blobObjectId
    && (candidate.mimeType ?? null) === row.mimeType
    && expectedBytes === row.byteSize
}

function copiedArtifactContentMatches(
  child: ProductBuildArtifactRecordV1,
  parent: ProductBuildArtifactRecordV1,
): boolean {
  return child.artifactKey === parent.artifactKey
    && child.requirementKey === parent.requirementKey
    && child.kind === parent.kind
    && child.mediaKind === parent.mediaKind
    && child.contentHash === parent.contentHash
    && child.payloadJson === parent.payloadJson
    && child.metadataJson === parent.metadataJson
    && child.qualityJson === parent.qualityJson
    && child.rightsJson === parent.rightsJson
    && child.blobObjectId === parent.blobObjectId
    && child.mimeType === parent.mimeType
    && child.byteSize === parent.byteSize
}

function candidateUsageWithinTaskBudget(
  usage: ProductProductionTaskExecutionResultV1['usage'],
  task: ProductProductionPlanV3['tasks'][number],
): boolean {
  const integers = [usage.modelCalls, usage.inputTokens, usage.outputTokens, usage.mediaCalls,
    usage.durationMs, usage.storageBytes]
  const budget = task.budgetReservation
  return integers.every(value => Number.isInteger(value) && value >= 0)
    && (usage.costUsd == null || Number.isFinite(usage.costUsd) && usage.costUsd >= 0)
    && usage.modelCalls <= budget.modelCalls
    && usage.inputTokens <= budget.inputTokens
    && usage.outputTokens <= budget.outputTokens
    && usage.mediaCalls <= budget.mediaCalls
    && usage.durationMs <= budget.durationMs
    && usage.storageBytes <= budget.storageBytes
    && (budget.maximumCostUsd == null || (usage.costUsd ?? 0) <= budget.maximumCostUsd)
}

function exactRunBoundaryForArtifact(input: {
  row: ProductBuildArtifactRecordV1
  build: ProductBuildRecordV1 & { id: number }
  evidence: TextOpenWorldArtifactRunEvidenceV1 | undefined
  runEvidenceById: ReadonlyMap<number, TextOpenWorldArtifactRunEvidenceV1>
  expectedRootRunId?: number | null
  expectedTaskKey?: string
  expectedPlanHash?: string
  requireCompletedRoot?: boolean
  expectedRootTerminalReceiptHash?: string | null
}): string | null {
  const { row, build, evidence } = input
  if (!evidence || evidence.error) return evidence?.error ?? '生产 Run 不存在'
  const taskKey = input.expectedTaskKey ?? evidence.boundary?.taskKey ?? null
  if (!taskKey || evidence.projectId !== row.projectId || evidence.workId !== row.workId
    || evidence.productBuildId !== build.id || evidence.state !== 'completed'
    || evidence.terminalReceiptHash !== row.producerReceiptHash
    || evidence.parentRunId == null || evidence.parentRelation !== `task:${taskKey}`
    || !evidence.boundary || evidence.boundary.productBuildId !== build.id
    || evidence.boundary.buildNumber !== build.buildNumber
    || evidence.boundary.controlEpoch !== row.controlEpoch
    || (input.expectedPlanHash !== undefined && evidence.boundary.planHash !== input.expectedPlanHash)
    || evidence.boundary.taskKey !== taskKey) {
    return '生产 Run/Receipt/Build/epoch/task 谱系不一致'
  }
  if (Object.prototype.hasOwnProperty.call(input, 'expectedRootRunId')
    && (input.expectedRootRunId == null || evidence.parentRunId !== input.expectedRootRunId)) {
    return input.expectedRootRunId == null
      ? 'Build ledger 缺少必需 rootRunId'
      : '生产 Run 不属于当前 Build root'
  }
  const root = input.runEvidenceById.get(evidence.parentRunId)
  if (!root || root.error || root.projectId !== row.projectId || root.workId !== row.workId
    || root.productBuildId !== build.id || root.parentRunId != null
    || root.boundary?.taskKey !== '$root' || root.boundary.productBuildId !== build.id
    || root.boundary.buildNumber !== build.buildNumber
    || root.boundary.controlEpoch !== row.controlEpoch
    || root.boundary.planHash !== evidence.boundary.planHash) {
    return '生产 Run 的 root 父运行无法闭合'
  }
  if (input.requireCompletedRoot
    && (!isSha256Hash(input.expectedRootTerminalReceiptHash)
      || root.state !== 'completed'
      || root.terminalReceiptHash !== input.expectedRootTerminalReceiptHash)) {
    return '已完成 Build 的 root Run 与终端 receipt 无法闭合'
  }
  return null
}

function parentRunWitness(
  evidence: TextOpenWorldArtifactRunEvidenceV1 | undefined,
): ProductProductionParentRunWitnessV1 | null {
  if (!evidence || evidence.error || !evidence.boundary) return null
  return {
    parentRelation: evidence.parentRelation,
    status: evidence.state,
    terminalReceiptHash: evidence.terminalReceiptHash,
    boundary: {
      buildNumber: evidence.boundary.buildNumber,
      controlEpoch: evidence.boundary.controlEpoch,
      planHash: evidence.boundary.planHash,
      taskKey: evidence.boundary.taskKey,
    },
  }
}

interface AcceptedCandidateProofV1 {
  error: string | null
  artifactsByKey: ReadonlyMap<string, ProductProductionTaskArtifactV1>
}

async function createAcceptedCandidateProof(
  evidence: TextOpenWorldArtifactRunEvidenceV1,
): Promise<AcceptedCandidateProofV1> {
  const candidate = evidence.candidate
  const artifactsByKey = new Map<string, ProductProductionTaskArtifactV1>()
  if (!candidate) return {
    error: 'accepted Artifact 缺少可验证 task-candidate checkpoint', artifactsByKey,
  }
  if (candidate.taskKey !== evidence.boundary?.taskKey
    || evidence.taskStep?.currentAttempt !== candidate.attempt) {
    return { error: 'candidate checkpoint 与 Run 身份不一致', artifactsByKey }
  }
  const candidateHash = await hashProductProductionTaskCandidateV1(candidate.result)
  if (candidateHash !== candidate.candidateHash
    || evidence.taskStep?.candidateHash !== candidate.candidateHash
    || evidence.taskStep.outputHash !== candidate.candidateHash) {
    return { error: 'candidateHash、checkpoint 与 Run step 输出不一致', artifactsByKey }
  }
  const receiptHash = await hashProductProductionTaskReceiptV1({
    taskKey: candidate.taskKey,
    attempt: candidate.attempt,
    inputHash: candidate.inputHash,
    candidateHash: candidate.candidateHash,
    passedGateIds: candidate.result.passedGateIds,
    usage: candidate.result.usage,
    controlEpoch: candidate.controlEpoch,
  })
  if (receiptHash !== evidence.terminalReceiptHash) {
    return { error: 'task terminal receipt 无法由 checkpoint 重算', artifactsByKey }
  }
  for (const artifact of candidate.result.artifacts) {
    if (artifactsByKey.has(artifact.artifactKey)) {
      return { error: `task-candidate 存在重复 Artifact:${artifact.artifactKey}`, artifactsByKey }
    }
    artifactsByKey.set(artifact.artifactKey, artifact)
  }
  return { error: null, artifactsByKey }
}

function acceptedCandidateProofForRun(
  cache: Map<number, Promise<AcceptedCandidateProofV1>>,
  evidence: TextOpenWorldArtifactRunEvidenceV1,
): Promise<AcceptedCandidateProofV1> {
  const existing = cache.get(evidence.runId)
  if (existing) return existing
  const created = createAcceptedCandidateProof(evidence)
  cache.set(evidence.runId, created)
  return created
}

async function verifyAcceptedRowsAgainstProof(input: {
  rows: ProductBuildArtifactRecordV1[]
  evidence: TextOpenWorldArtifactRunEvidenceV1
  proof: AcceptedCandidateProofV1
}): Promise<string | null> {
  const { rows, evidence, proof } = input
  if (proof.error) return proof.error
  const candidate = evidence.candidate!
  for (const row of rows) {
    if (candidate.controlEpoch !== row.controlEpoch || candidate.inputHash !== row.inputHash
      || evidence.terminalReceiptHash !== row.producerReceiptHash) {
      return 'candidate checkpoint、receipt 与 Artifact 身份不一致'
    }
    const artifact = proof.artifactsByKey.get(row.artifactKey)
    if (!artifact || !await candidateArtifactMatchesRow(artifact, row)) {
      return 'Artifact payload/metadata/quality/rights/blob 与 checkpoint 候选不一致'
    }
  }
  return null
}

async function completedBuildRootIssue(input: {
  production: ProductProductionRecordV1 & { id: number }
  buildEvidence: TextOpenWorldArtifactBuildEvidenceV1
  plan: ProductProductionPlanV3
  activeRows: ProductBuildArtifactRecordV1[]
  runEvidenceById: ReadonlyMap<number, TextOpenWorldArtifactRunEvidenceV1>
}): Promise<string | null> {
  const { production, buildEvidence, plan, activeRows } = input
  const build = buildEvidence.build
  if (!COMPLETED_ROOT_BUILD_STATUSES.has(build.status)) return null
  try {
    const manifest = parseProductBuildManifestV1(build.manifestJson)
    const quality = parseProductBuildQualityReportV1(build.qualityReportJson)
    if (canonicalProductProductionJsonV2(manifest) !== build.manifestJson
      || canonicalProductProductionJsonV2(quality) !== build.qualityReportJson
      || await hashProductProductionValueV2(manifest) !== build.manifestHash
      || await hashProductProductionValueV2(quality) !== build.qualityReportHash
      || manifest.productionKey !== production.productionKey
      || manifest.buildNumber !== build.buildNumber
      || manifest.briefRevision !== build.briefRevision
      || manifest.briefHash !== build.briefHash
      || manifest.planHash !== build.planHash
      || manifest.controlEpoch !== build.controlEpoch
      || manifest.runtimePackageHash !== build.packageHash
      || quality.buildNumber !== build.buildNumber
      || quality.packageHash !== build.packageHash) {
      return '已完成 Build 的 manifest/quality/hash 指针不闭合'
    }
    const orderedRows = [...activeRows]
      .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
    const receipts = orderedRows.map(row => ({
      artifactKey: row.artifactKey,
      version: row.version,
      contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash,
    }))
    if (canonicalProductProductionJsonV2(receipts)
      !== canonicalProductProductionJsonV2(manifest.artifactReceipts)) {
      return '已完成 Build 的当前 Artifact 集合与 manifest receipt 集合不一致'
    }
    const packageRows = orderedRows.filter(row => row.kind === 'text-open-world.runtime-package')
    const qualityRows = orderedRows.filter(row => row.kind === 'text-open-world.quality-report')
    if (packageRows.length !== 1 || qualityRows.length !== 1
      || packageRows[0].contentHash !== build.packageHash
      || qualityRows[0].contentHash !== build.qualityReportHash) {
      return '已完成 Build 的 package/quality Artifact 指针不唯一或不一致'
    }
    const rootReceiptVerification = await verifyProductBuildRootTerminalReceiptV1({
      planHash: build.planHash,
      manifestHash: build.manifestHash,
      packageHash: build.packageHash,
      qualityReportHash: build.qualityReportHash,
      controlEpoch: build.controlEpoch,
      budgetLedgerJson: build.budgetLedgerJson,
      artifacts: orderedRows,
      expectedReceiptHash: build.rootTerminalReceiptHash ?? '',
    })
    const root = buildEvidence.rootRunId == null
      ? null : input.runEvidenceById.get(buildEvidence.rootRunId)
    if (!root || root.error || root.projectId !== build.projectId || root.workId !== build.workId
      || root.productBuildId !== build.id || root.parentRunId != null
      || root.boundary?.taskKey !== '$root' || root.boundary.productBuildId !== build.id
      || root.boundary.buildNumber !== build.buildNumber
      || root.boundary.controlEpoch !== build.controlEpoch
      || root.boundary.planHash !== build.planHash
      || root.state !== 'completed'
      || !rootReceiptVerification.valid
      || rootReceiptVerification.version !== 2
      || root.terminalReceiptHash !== build.rootTerminalReceiptHash) {
      return '已完成 Build 的 root Run/terminal receipt 不是当前 v2 完整封存证明'
    }
    const taskReceipts = plan.tasks.map(task => {
      const ledger = buildEvidence.taskLedger[task.taskKey]
      if (!ledger || ledger.status !== 'settled' || !isSha256Hash(ledger.terminalReceiptHash)) {
        throw new Error(`root join 缺少 settled task receipt:${task.taskKey}`)
      }
      return { taskKey: task.taskKey, receiptHash: ledger.terminalReceiptHash }
    })
    const expectedOutputHash = await hashProductProductionValueV2({
      manifestHash: build.manifestHash,
      taskReceipts,
    })
    if (root.taskStep?.currentAttempt !== 1 || root.taskStep.outputHash !== expectedOutputHash) {
      return '已完成 Build 的 root $join outputHash 无法由 manifest 与 task receipts 重算'
    }
    return null
  } catch (cause) {
    return `已完成 Build 的根证明损坏：${cause instanceof Error ? cause.message : String(cause)}`
  }
}

async function sealedParentProofHashFromEvidenceV1(input: {
  production: ProductProductionRecordV1 & { id: number }
  buildEvidence: TextOpenWorldArtifactBuildEvidenceV1
  artifact: ProductBuildArtifactRecordV1
  activeRows: ProductBuildArtifactRecordV1[]
  blobEvidenceById?: ReadonlyMap<number, TextOpenWorldArtifactBlobEvidenceV1>
}): Promise<string> {
  const { production, buildEvidence, artifact } = input
  const { build, plan } = buildEvidence
  if (!plan || !['preview-ready', 'release-ready', 'released', 'archived'].includes(build.status)
    || !isSha256Hash(build.rootTerminalReceiptHash)
    || canonicalProductProductionJsonV2(plan) !== build.planJson
    || await hashProductProductionValueV2(plan) !== build.planHash
    || plan.productType !== production.productType
    || plan.buildNumber !== build.buildNumber || plan.briefHash !== build.briefHash
    || plan.controlEpoch !== build.controlEpoch) {
    throw new Error('carriedFrom 父 Build 的 Plan/封存状态不闭合')
  }
  const manifest = parseProductBuildManifestV1(build.manifestJson)
  const quality = parseProductBuildQualityReportV1(build.qualityReportJson)
  if (canonicalProductProductionJsonV2(manifest) !== build.manifestJson
    || canonicalProductProductionJsonV2(quality) !== build.qualityReportJson
    || await hashProductProductionValueV2(manifest) !== build.manifestHash
    || await hashProductProductionValueV2(quality) !== build.qualityReportHash
    || manifest.productionKey !== production.productionKey
    || manifest.buildNumber !== build.buildNumber || manifest.briefRevision !== build.briefRevision
    || manifest.briefHash !== build.briefHash || manifest.planHash !== build.planHash
    || manifest.controlEpoch !== build.controlEpoch || manifest.runtimePackageHash !== build.packageHash
    || quality.buildNumber !== build.buildNumber || quality.packageHash !== build.packageHash) {
    throw new Error('carriedFrom 父 Build 的 Manifest/Quality 不闭合')
  }
  const orderedRows = [...input.activeRows]
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey) || left.version - right.version)
  const expectedKeys = plan.tasks.flatMap(task => task.outputArtifactKeys).sort()
  const actualKeys = orderedRows.map(row => row.artifactKey)
  if (orderedRows.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || new Set(actualKeys).size !== actualKeys.length
    || orderedRows.some(row => row.buildId !== build.id
      || row.projectId !== production.projectId || row.worldId !== production.worldId
      || row.workId !== production.workId || row.controlEpoch !== build.controlEpoch
      || !ACTIVE_ARTIFACT_STATUSES.has(row.status))) {
    throw new Error('carriedFrom 父 Build 的完整 active Artifact 集合与 Plan 不一致')
  }
  const manifestReceipts = orderedRows.map(row => ({
    artifactKey: row.artifactKey,
    version: row.version,
    contentHash: row.contentHash,
    producerReceiptHash: row.producerReceiptHash,
  }))
  if (canonicalProductProductionJsonV2(manifestReceipts)
    !== canonicalProductProductionJsonV2(manifest.artifactReceipts)) {
    throw new Error('carriedFrom 父 Build 的完整 active Artifact 集合与 Manifest 不一致')
  }
  const rootReceiptVerification = await verifyProductBuildRootTerminalReceiptV1({
    planHash: build.planHash,
    manifestHash: build.manifestHash,
    packageHash: build.packageHash,
    qualityReportHash: build.qualityReportHash,
    controlEpoch: build.controlEpoch,
    budgetLedgerJson: build.budgetLedgerJson,
    artifacts: orderedRows,
    expectedReceiptHash: build.rootTerminalReceiptHash ?? '',
  })
  if (!rootReceiptVerification.valid || rootReceiptVerification.version !== 2) {
    throw new Error('carriedFrom 父 Build 不是 v2 完整 Artifact 封存证明')
  }
  for (const row of orderedRows) {
    if (row.blobObjectId == null) continue
    const blob = input.blobEvidenceById?.get(row.blobObjectId)
    if (!blob || !blob.physicalBytesVerified || blob.projectId !== production.projectId
      || blob.worldId !== production.worldId || blob.workId !== production.workId
      || blob.contentHash !== row.contentHash || blob.mimeType !== row.mimeType
      || blob.byteSize !== row.byteSize || blob.storageState !== 'ready') {
      throw new Error('carriedFrom 父 Build 的媒资物理数据无法验证')
    }
  }
  const portableTaskLedger = parseProductProductionPortableTaskLedgerV1({
    budgetLedgerJson: build.budgetLedgerJson,
    plan,
  })
  const ownerTasks = plan.tasks.filter(task => task.outputArtifactKeys.includes(artifact.artifactKey))
  const ownerTask = ownerTasks[0]
  const ownerLedger = ownerTask == null ? null
    : portableTaskLedger.find(row => row.taskKey === ownerTask.taskKey)
  const manifestMembers = manifest.artifactReceipts.filter(row => row.artifactKey === artifact.artifactKey)
  const manifestMember = manifestMembers[0]
  if (ownerTasks.length !== 1 || !ownerTask || !ownerLedger || manifestMembers.length !== 1
    || !manifestMember || ownerLedger.idempotencyKey !== artifact.inputHash
    || ownerLedger.terminalReceiptHash !== artifact.producerReceiptHash
    || ownerTask.acceptanceGateIds.some(gate => !ownerLedger.passedGateIds.includes(gate))
    || manifestMember.version !== artifact.version
    || manifestMember.contentHash !== artifact.contentHash
    || manifestMember.producerReceiptHash !== artifact.producerReceiptHash) {
    throw new Error('carriedFrom 父 Artifact 的 owner/ledger/manifest member 不闭合')
  }
  const portableRootSealHash = await hashProductProductionPortableRootSealV1({
    planHash: build.planHash,
    manifestHash: build.manifestHash,
    packageHash: build.packageHash,
    qualityReportHash: build.qualityReportHash,
    rootTerminalReceiptHash: build.rootTerminalReceiptHash,
    controlEpoch: build.controlEpoch,
    portableTaskLedger,
  })
  return hashProductProductionSealedParentArtifactProofV1({
    productionKey: production.productionKey,
    productType: production.productType,
    build,
    portableTaskLedger,
    portableRootSealHash,
    ownerTask,
    manifestMember,
    artifact,
    blobContentHash: artifact.blobObjectId == null ? null : artifact.contentHash,
  })
}

async function verifyCarriedLineage(input: {
  production: ProductProductionRecordV1 & { id: number }
  row: ProductBuildArtifactRecordV1
  buildsByNumber: ReadonlyMap<number, TextOpenWorldArtifactBuildEvidenceV1[]>
  buildEvidenceById: ReadonlyMap<number, TextOpenWorldArtifactBuildEvidenceV1>
  artifactRowsByLocator: ReadonlyMap<string, ProductBuildArtifactRecordV1[]>
  activeArtifactRowsByBuildId: ReadonlyMap<number, ProductBuildArtifactRecordV1[]>
  runEvidenceById: ReadonlyMap<number, TextOpenWorldArtifactRunEvidenceV1>
  acceptedProofByRunId: Map<number, Promise<AcceptedCandidateProofV1>>
  blobEvidenceById?: ReadonlyMap<number, TextOpenWorldArtifactBlobEvidenceV1>
}): Promise<string | null> {
  let current = input.row
  const visited = new Set<string>()
  for (let depth = 0; depth <= MAX_LINEAGE_DEPTH; depth += 1) {
    const currentBuild = input.buildEvidenceById.get(current.buildId)?.build
    if (!currentBuild) return 'carried lineage 的 Build 不存在'
    const locator = `${current.buildId}:${current.id ?? -1}`
    if (visited.has(locator)) return 'carried lineage 存在循环'
    visited.add(locator)
    if (current.carriedFrom == null) {
      if (current.parentArtifactHash != null) return 'accepted lineage 叶不应声明 parentArtifactHash'
      if (current.producerRunId == null || current.producerReceiptHash == null) {
        return 'accepted lineage 叶缺少 producer proof'
      }
      const evidence = input.runEvidenceById.get(current.producerRunId)
      const boundaryIssue = exactRunBoundaryForArtifact({
        row: current, build: currentBuild, evidence,
        runEvidenceById: input.runEvidenceById,
      })
      if (boundaryIssue) return boundaryIssue
      const proof = await acceptedCandidateProofForRun(input.acceptedProofByRunId, evidence!)
      return verifyAcceptedRowsAgainstProof({ rows: [current], evidence: evidence!, proof })
    }
    if (!['carried-forward', 'invalid'].includes(current.status)
      || !isSafeCarriedArtifactRefV1(current.carriedFrom)
      || current.parentArtifactHash !== current.contentHash
      || current.carriedFrom.contentHash !== current.contentHash
      || current.carriedFrom.artifactKey !== current.artifactKey
      || !isSha256Hash(current.carriedFrom.proofHash)) {
      return 'carriedFrom、parentArtifactHash 与内容 Hash 不闭合'
    }
    if (current.producerRunId == null || !isSha256Hash(current.producerReceiptHash)) {
      return 'carried lineage 中存在尚未重新签发的祖先'
    }
    const carriedEvidence = input.runEvidenceById.get(current.producerRunId)
    const carriedBoundaryIssue = exactRunBoundaryForArtifact({
      row: current, build: currentBuild, evidence: carriedEvidence,
      runEvidenceById: input.runEvidenceById,
    })
    if (carriedBoundaryIssue) return carriedBoundaryIssue
    const parentBuilds = input.buildsByNumber.get(current.carriedFrom.buildNumber) ?? []
    if (parentBuilds.length !== 1) return 'carriedFrom Build 缺失或不唯一'
    const parentBuild = parentBuilds[0].build
    const sameBuild = parentBuild.id === currentBuild.id
    if (sameBuild) {
      if (current.carriedFrom.version >= current.version) return '同 Build carry 版本没有严格递减'
    } else if (current.carriedFrom.buildNumber >= currentBuild.buildNumber
      || currentBuild.parentBuildNumber !== parentBuild.buildNumber) {
      return '跨 Build carry 不是直接父 Build'
    }
    const parents = (input.artifactRowsByLocator.get(
      `${parentBuild.id}\u0000${current.carriedFrom.artifactKey}\u0000${current.carriedFrom.version}`,
    ) ?? []).filter(row => row.contentHash === current.carriedFrom!.contentHash)
    if (parents.length !== 1) return 'carriedFrom 精确父 Artifact 缺失或不唯一'
    const parent = parents[0]
    if (!isExactArtifactScope({
      projectId: current.projectId, worldId: current.worldId, workId: current.workId,
    }, parent) || !copiedArtifactContentMatches(current, parent)) {
      return 'carried Artifact 与精确父行的作用域或治理内容不一致'
    }
    if (sameBuild) {
      if (parent.producerRunId == null) return 'carriedFrom 父 Artifact 缺少 producer Run'
      const parentProducerEvidence = input.runEvidenceById.get(parent.producerRunId)
      const parentBoundaryIssue = exactRunBoundaryForArtifact({
        row: parent, build: parentBuild, evidence: parentProducerEvidence,
        runEvidenceById: input.runEvidenceById,
      })
      if (parentBoundaryIssue) return `carriedFrom 父证明无法闭合：${parentBoundaryIssue}`
      const producerWitness = parentRunWitness(parentProducerEvidence)
      const rootWitness = parentRunWitness(parentProducerEvidence?.parentRunId == null
        ? undefined : input.runEvidenceById.get(parentProducerEvidence.parentRunId))
      if (!producerWitness || !rootWitness
        || await hashProductProductionParentArtifactProofV1({
          artifact: parent,
          producer: producerWitness,
          root: rootWitness,
        }) !== current.carriedFrom.proofHash) {
        return 'carriedFrom 同 Build 冻结父证明 Hash 不一致'
      }
      if (parent.controlEpoch >= current.controlEpoch || parent.status !== 'invalid') {
        return '同 Build carry 父行 epoch/status 不合法'
      }
    } else {
      if (parent.controlEpoch !== parentBuild.controlEpoch
        || !ACTIVE_ARTIFACT_STATUSES.has(parent.status)) {
        return '跨 Build carry 父行不是父 Build 当前有效内容'
      }
      const parentBuildEvidence = parentBuilds.find(item => item.build.id === parentBuild.id)
      if (!parentBuildEvidence
        || await sealedParentProofHashFromEvidenceV1({
          production: input.production,
          buildEvidence: parentBuildEvidence,
          artifact: parent,
          activeRows: input.activeArtifactRowsByBuildId.get(parentBuild.id) ?? [],
          blobEvidenceById: input.blobEvidenceById,
        }) !== current.carriedFrom.proofHash) {
        return 'carriedFrom 跨 Build 封存父证明 Hash 不一致'
      }
      // The portable sealed proof is the authority boundary for a terminal
      // parent Build. Imported Agent Runs are deliberately staled/rebound, so
      // descending into their physical run lineage would make a valid seal
      // non-portable and adds no stronger guarantee than the Build root.
      return null
    }
    current = parent
  }
  return `carried lineage 超过 ${MAX_LINEAGE_DEPTH} 层安全上限`
}

interface MutableEntityV1 extends TextOpenWorldGovernedEntityV1 {
  rank: number
  raw: Record<string, unknown>
  referenceSpecs: EntityReferenceSpecV1[]
}

function projectEntitiesFromArtifact(
  artifact: TextOpenWorldGovernedArtifactV1,
  payload: Record<string, unknown>,
  budget: { entityCount: number },
): MutableEntityV1[] {
  const specs = ENTITY_COLLECTIONS[artifact.kind] ?? []
  const result: MutableEntityV1[] = []
  for (const spec of specs) {
    const rows = valuesAt(payload, spec.path)
    for (const [index, candidate] of rows.entries()) {
      const row = record(candidate)
      if (!row) {
        artifactIssue(artifact, 'projection.collection-shape', `${spec.path.join('.') || 'root'} 不是对象集合`)
        continue
      }
      const key = spec.staticKey ?? (typeof row.key === 'string' ? row.key.trim() : '')
      if (!STABLE_KEY.test(key)) {
        artifactIssue(artifact, 'projection.entity-key', `${spec.kind} 缺少合法稳定 key（索引 ${index}）`)
        continue
      }
      const identity = `${spec.kind}:${key}`
      const sourceEvidence = collectSourceEvidence(row)
      budget.entityCount += 1
      if (budget.entityCount > MAX_PROJECTED_ENTITIES) {
        throw new Error(`[text-open-world-artifact-governance] 投影实体数超过 ${MAX_PROJECTED_ENTITIES} 安全上限`)
      }
      result.push({
        identity,
        kind: spec.kind,
        key,
        title: titleOf(row, spec.title ?? key),
        summary: summaryOf(row),
        status: 'verified',
        artifactKey: artifact.artifactKey,
        artifactVersion: artifact.version,
        artifactContentHash: artifact.contentHash,
        definedByArtifactKeys: [artifact.artifactKey],
        fields: displayFields(spec.kind, row),
        sourceEvidence: sourceEvidence.disclosed,
        sourceEvidenceCount: sourceEvidence.all.length,
        truncatedSourceEvidenceCount: sourceEvidence.truncatedCount,
        references: [],
        referenceCount: 0,
        truncatedReferenceCount: 0,
        rank: spec.rank,
        raw: row,
        referenceSpecs: spec.references ?? [],
      })
    }
  }
  return result
}

function definedRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined))
}

function mirrorInvariant(entity: MutableEntityV1): unknown | null {
  const value = entity.raw
  if (entity.kind === 'region') return definedRecord({
    key: value.key, order: value.order, title: value.title, description: value.description,
    theme: value.theme, locationKeys: value.locationKeys,
    fastTravelPointKey: value.fastTravelPointKey, initialKnowledge: value.initialKnowledge,
  })
  if (entity.kind === 'location') return definedRecord({
    key: value.key, regionKey: value.regionKey, order: value.order, title: value.title,
    description: value.description, kind: value.kind, purpose: value.purpose,
    functions: value.functions, earlyArrivalDescription: value.earlyArrivalDescription,
    initialKnowledge: value.initialKnowledge,
  })
  if (entity.kind === 'quest') return definedRecord({
    key: value.key, order: value.order, type: value.type, title: value.title,
    storylineKey: value.storylineKey, regionKeys: value.regionKeys,
    stageKeys: value.stageKeys, estimatedMinutes: value.estimatedMinutes,
  })
  if (entity.kind === 'quest-stage') return definedRecord({
    key: value.key, questKey: value.questKey, order: value.order,
    title: value.title, objectiveKeys: value.objectiveKeys,
  })
  if (entity.kind === 'quest-objective') return definedRecord({
    key: value.key, questKey: value.questKey, stageKey: value.stageKey,
    order: value.order, title: value.title, optional: value.optional,
    requirementKeys: value.requirementKeys,
  })
  return null
}

function knownMirrorPair(left: MutableEntityV1, right: MutableEntityV1): boolean {
  const pair = new Set([left.artifactKey, right.artifactKey])
  if ((left.kind === 'region' || left.kind === 'location')
    && pair.has('text-open-world.region-skeleton')
    && pair.has('text-open-world.map-interaction-catalog')) return true
  return ['quest', 'quest-stage', 'quest-objective'].includes(left.kind)
    && pair.has('text-open-world.quest-skeletons')
    && pair.has('text-open-world.quest-design-documents')
}

function artifactSort(left: TextOpenWorldGovernedArtifactV1, right: TextOpenWorldGovernedArtifactV1): number {
  const healthOrder: Record<TextOpenWorldGovernedArtifactHealthV1, number> = {
    corrupt: 0, dangling: 1, pending: 2, verified: 3, stale: 4, invalid: 5,
  }
  return healthOrder[left.health] - healthOrder[right.health]
    || left.artifactKey.localeCompare(right.artifactKey)
    || right.version - left.version
    || left.rowId - right.rowId
}

function missingArtifactView(input: {
  rowId: number
  artifactKey: string
  task: ProductProductionPlanV3['tasks'][number]
  build: ProductBuildRecordV1 & { id: number }
  health: 'pending' | 'corrupt'
}): TextOpenWorldGovernedArtifactV1 {
  let kind = input.artifactKey
  try { kind = textOpenWorldProductionArtifactKindForKeyV1(input.artifactKey) } catch { /* diagnostic keeps key */ }
  const info = presentation(kind)
  return {
    rowId: input.rowId,
    artifactKey: input.artifactKey,
    requirementKey: null,
    kind,
    label: info.label,
    group: info.group,
    version: 0,
    artifactStatus: 'pending',
    health: input.health,
    productionValidation: 'not-applicable',
    validatorId: null,
    validationReceiptHash: null,
    currentEpoch: true,
    controlEpoch: input.build.controlEpoch,
    ownerTaskKey: input.task.taskKey,
    ownerLane: input.task.lane,
    producerRunId: null,
    producerRunState: null,
    producerReceiptHash: null,
    inputHash: '',
    contentHash: '',
    schema: null,
    byteSize: 0,
    mediaKind: null,
    mimeType: null,
    sourceEvidence: [],
    sourceEvidenceCount: 0,
    truncatedSourceEvidenceCount: 0,
    entityIdentities: [],
    diagnostics: [],
    createdAt: input.build.createdAt,
    updatedAt: input.build.updatedAt,
  }
}

/**
 * Pure, fail-closed projection over one already-resolved current Build. It
 * never writes Artifact rows and never exposes SourcePinUnit.contentText.
 */
export interface TextOpenWorldArtifactGovernanceProjectionInputV1 {
  scope: WorkspaceScope
  production: ProductProductionRecordV1 & { id: number }
  build: ProductBuildRecordV1 & { id: number }
  plan: ProductProductionPlanV3
  artifactRows: ProductBuildArtifactRecordV1[]
  lineageArtifactRows: ProductBuildArtifactRecordV1[]
  buildEvidenceById: ReadonlyMap<number, TextOpenWorldArtifactBuildEvidenceV1>
  runEvidenceById: ReadonlyMap<number, TextOpenWorldArtifactRunEvidenceV1>
  blobEvidenceById?: ReadonlyMap<number, TextOpenWorldArtifactBlobEvidenceV1>
}

async function projectTextOpenWorldArtifactGovernanceTrustedV1(
  input: TextOpenWorldArtifactGovernanceProjectionInputV1,
  productionAuthority: TextOpenWorldProductionPlanAuthorityV1,
): Promise<TextOpenWorldArtifactGovernanceProjectionV1> {
  const { scope, production, build, plan } = input
  if (production.projectId !== scope.projectId || production.worldId !== scope.worldId
    || production.workId !== scope.workId || build.projectId !== scope.projectId
    || build.worldId !== scope.worldId || build.workId !== scope.workId
    || production.productType !== 'text-open-world'
    || production.currentBuildNumber !== build.buildNumber
    || build.productionId !== production.id
    || plan.productType !== 'text-open-world'
    || plan.buildNumber !== build.buildNumber
    || plan.briefHash !== build.briefHash
    || plan.controlEpoch !== build.controlEpoch
    || build.planHash !== await hashProductProductionValueV2(plan)) {
    throw new Error('[text-open-world-artifact-governance] 当前 Production/Build/Plan 身份不闭合')
  }
  if (input.artifactRows.length > MAX_CURRENT_ACTIVE_ARTIFACT_ROWS
    || input.lineageArtifactRows.length > MAX_LINEAGE_ARTIFACT_ROWS
    || input.artifactRows.some(row => !isExactArtifactScope(scope, row) || row.buildId !== build.id)
    || input.lineageArtifactRows.some(row => !isExactArtifactScope(scope, row))) {
    throw new Error('[text-open-world-artifact-governance] Artifact 输入数量或作用域不闭合')
  }
  const originAuthorized = productionAuthority.origin === 'creator-start-v1'
    && isSha256Hash(productionAuthority.authorityReceiptHash)
  const ownerByArtifact = new Map<string, ProductProductionPlanV3['tasks'][number]>()
  for (const task of plan.tasks) for (const artifactKey of task.outputArtifactKeys) {
    if (ownerByArtifact.has(artifactKey)) {
      throw new Error(`[text-open-world-artifact-governance] Plan Artifact owner 重复:${artifactKey}`)
    }
    ownerByArtifact.set(artifactKey, task)
  }
  const currentActiveByKey = new Map<string, ProductBuildArtifactRecordV1[]>()
  for (const row of input.artifactRows) {
    if (row.controlEpoch !== build.controlEpoch || !ACTIVE_ARTIFACT_STATUSES.has(row.status)) continue
    const list = currentActiveByKey.get(row.artifactKey) ?? []
    list.push(row)
    currentActiveByKey.set(row.artifactKey, list)
  }
  const parsedPayloads = new Map<number, Record<string, unknown>>()
  const allSourceEvidenceByRowId = new Map<number, TextOpenWorldArtifactEvidenceRefV1[]>()
  const views: TextOpenWorldGovernedArtifactV1[] = []
  for (const sourceRow of input.artifactRows) {
    const row = sourceRow
    const owner = ownerByArtifact.get(row.artifactKey) ?? null
    const currentEpoch = row.controlEpoch === build.controlEpoch
    const active = ACTIVE_ARTIFACT_STATUSES.has(row.status)
    const info = presentation(row.kind)
    const view: TextOpenWorldGovernedArtifactV1 = {
      rowId: row.id ?? -1,
      artifactKey: row.artifactKey,
      requirementKey: row.requirementKey,
      kind: row.kind,
      label: info.label,
      group: info.group,
      version: row.version,
      artifactStatus: row.status,
      health: !currentEpoch && active ? 'stale' : !active
        ? (row.status === 'pending' || row.status === 'candidate' ? 'pending' : 'invalid')
        : 'verified',
      productionValidation: currentEpoch && active ? 'integrity-only' : 'not-applicable',
      validatorId: null,
      validationReceiptHash: null,
      currentEpoch,
      controlEpoch: row.controlEpoch,
      ownerTaskKey: owner?.taskKey ?? null,
      ownerLane: owner?.lane ?? null,
      producerRunId: row.producerRunId,
      producerRunState: null,
      producerReceiptHash: row.producerReceiptHash,
      inputHash: row.inputHash,
      contentHash: row.contentHash,
      schema: null,
      byteSize: row.byteSize,
      mediaKind: row.mediaKind,
      mimeType: row.mimeType,
      sourceEvidence: [],
      sourceEvidenceCount: 0,
      truncatedSourceEvidenceCount: 0,
      entityIdentities: [],
      diagnostics: [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
    views.push(view)
    if (!currentEpoch || !active) continue
    if ((currentActiveByKey.get(row.artifactKey)?.length ?? 0) !== 1) {
      artifactIssue(view, 'artifact.active-duplicate', '当前 epoch 存在多个 active 版本，均不能作为权威内容')
      continue
    }
    if (!isExactArtifactScope(scope, row) || row.buildId !== build.id) {
      artifactIssue(view, 'artifact.scope', 'Artifact 不属于当前 Work/Product/Build 精确作用域')
      continue
    }
    if (!owner || !owner.outputArtifactKeys.includes(row.artifactKey)) {
      artifactIssue(view, 'artifact.plan-owner', 'Artifact 没有当前冻结 Plan 的唯一 owner task')
      continue
    }
    if (row.id == null || row.id < 1 || !Number.isInteger(row.version) || row.version < 1
      || !STABLE_KEY.test(row.artifactKey) || !isSha256Hash(row.inputHash)
      || !isSha256Hash(row.contentHash)) {
      artifactIssue(view, 'artifact.identity', 'Artifact ID、版本或 Hash 无效')
      continue
    }
    if (row.producerRunId == null || row.producerReceiptHash == null
      || !isSha256Hash(row.producerReceiptHash)) {
      artifactIssue(view, 'artifact.producer-pending', row.status === 'carried-forward'
        ? '复用 Artifact 尚未由当前 epoch 的 task Run 重新签发'
        : 'accepted Artifact 缺少生产 Run 或 receipt', row.status === 'carried-forward' ? 'pending' : 'corrupt')
      continue
    }
    if (row.status === 'accepted' && (row.carriedFrom != null || row.parentArtifactHash != null)) {
      artifactIssue(view, 'artifact.lineage-shape',
        'accepted Artifact 不得伪装为 carried lineage 节点')
      continue
    }
    if (row.status === 'carried-forward'
      && (row.carriedFrom == null || !isSha256Hash(row.parentArtifactHash))) {
      artifactIssue(view, 'artifact.lineage-shape',
        'carried-forward Artifact 缺少精确父定位或 parentArtifactHash')
      continue
    }
    let expectedKind: string
    try { expectedKind = textOpenWorldProductionArtifactKindForKeyV1(row.artifactKey) }
    catch {
      artifactIssue(view, 'artifact.kind-mapping', 'Artifact key 没有文字开放世界 kind 映射')
      continue
    }
    if (expectedKind !== row.kind) {
      artifactIssue(view, 'artifact.kind', `Artifact kind 应为 ${expectedKind}`)
      continue
    }
    let payload: unknown
    let metadata: unknown
    let quality: unknown
    let rights: unknown
    let payloadCanonical: string
    let metadataCanonical: string
    let qualityCanonical: string
    let rightsCanonical: string
    try {
      payload = JSON.parse(row.payloadJson)
      metadata = JSON.parse(row.metadataJson)
      quality = JSON.parse(row.qualityJson)
      rights = JSON.parse(row.rightsJson)
      payloadCanonical = canonicalProductProductionJsonV2(payload)
      metadataCanonical = canonicalProductProductionJsonV2(metadata)
      qualityCanonical = canonicalProductProductionJsonV2(quality)
      rightsCanonical = canonicalProductProductionJsonV2(rights)
    } catch {
      // Parser diagnostics may quote invalid JSON. SourcePinUnit payloads can
      // contain private source text, so only expose a fixed public message.
      artifactIssue(view, 'artifact.json', 'Artifact payload 或治理元数据不是合法且可规范化的 JSON')
      continue
    }
    const payloadRecord = record(payload)
    if (!payloadRecord || !record(metadata) || !record(quality) || !record(rights)
      || payloadCanonical !== row.payloadJson
      || metadataCanonical !== row.metadataJson
      || qualityCanonical !== row.qualityJson
      || rightsCanonical !== row.rightsJson) {
      artifactIssue(view, 'artifact.canonical-json', 'Artifact 或治理元数据不是规范对象 JSON')
      continue
    }
    view.schema = typeof payloadRecord.schema === 'string' ? payloadRecord.schema : null
    const expectedSchema = expectedArtifactSchema(row.kind)
    if (payloadRecord.schema !== expectedSchema || payloadRecord.version !== 1) {
      artifactIssue(view, 'artifact.schema', `Artifact payload 应为 ${expectedSchema} v1`)
      continue
    }
    if (typeof payloadRecord.productInstanceKey === 'string'
      && payloadRecord.productInstanceKey !== production.productionKey) {
      artifactIssue(view, 'artifact.product-instance', 'Artifact productInstanceKey 与当前 Production 不一致')
      continue
    }
    if (row.blobObjectId == null) {
      if (row.mimeType != null || row.mediaKind != null || row.byteSize !== new TextEncoder().encode(row.payloadJson).byteLength) {
        artifactIssue(view, 'artifact.storage', '非媒资 Artifact 的 byteSize、mimeType 或 mediaKind 不一致')
        continue
      }
      if (row.kind !== 'text-open-world.source-pin'
        && await hashProductProductionValueV2(payload) !== row.contentHash) {
        artifactIssue(view, 'artifact.content-hash', 'Artifact payload 与 contentHash 不一致')
        continue
      }
    } else {
      const blob = input.blobEvidenceById?.get(row.blobObjectId)
      if (!blob || blob.projectId !== scope.projectId || blob.worldId !== scope.worldId
        || blob.workId !== scope.workId || blob.contentHash !== row.contentHash
        || blob.mimeType !== row.mimeType || blob.byteSize !== row.byteSize
        || blob.storageState !== 'ready'
        || !['image', 'audio'].includes(row.kind) || row.mediaKind == null) {
        artifactIssue(view, 'artifact.media-blob', '媒资 Artifact 的 Blob、作用域或存储状态不一致')
        continue
      }
      if (!blob.physicalBytesVerified) {
        artifactIssue(view, 'artifact.media-blob-bytes', '媒资 Artifact 的物理数据缺失、大小错误或 Hash 不一致')
        continue
      }
    }
    try {
      await validateArtifactPayloadContract(row.kind, payloadRecord, row.payloadJson)
    } catch (cause) {
      artifactIssue(view, 'artifact.domain-contract', cause instanceof Error ? cause.message : String(cause))
      continue
    }
    const evidence = input.runEvidenceById.get(row.producerRunId)
    view.producerRunState = evidence?.state ?? null
    const sourceEvidence = collectSourceEvidence(payloadRecord)
    if (sourceEvidence.overflow) {
      artifactIssue(view, 'artifact.source-evidence-overflow',
        'Artifact 来源证据扫描超过安全上限，不能在未完整验证时进入受治理内容')
      continue
    }
    parsedPayloads.set(row.id, payloadRecord)
    allSourceEvidenceByRowId.set(row.id, sourceEvidence.all)
    view.sourceEvidence = sourceEvidence.disclosed
    view.sourceEvidenceCount = sourceEvidence.all.length
    view.truncatedSourceEvidenceCount = sourceEvidence.truncatedCount
  }

  const currentBuildEvidence = input.buildEvidenceById.get(build.id)
  if (!currentBuildEvidence || currentBuildEvidence.build.productionId !== production.id
    || currentBuildEvidence.plan?.controlEpoch !== build.controlEpoch
    || currentBuildEvidence.plan?.briefHash !== build.briefHash) {
    throw new Error('[text-open-world-artifact-governance] Build evidence 缺失或与当前 Plan 不一致')
  }
  const buildsByNumber = new Map<number, TextOpenWorldArtifactBuildEvidenceV1[]>()
  for (const evidence of input.buildEvidenceById.values()) {
    if (evidence.build.productionId !== production.id
      || evidence.build.projectId !== scope.projectId || evidence.build.worldId !== scope.worldId
      || evidence.build.workId !== scope.workId) continue
    const entries = buildsByNumber.get(evidence.build.buildNumber) ?? []
    entries.push(evidence)
    buildsByNumber.set(evidence.build.buildNumber, entries)
  }
  const artifactRowsByLocator = new Map<string, ProductBuildArtifactRecordV1[]>()
  const activeArtifactRowsByBuildId = new Map<number, ProductBuildArtifactRecordV1[]>()
  for (const row of input.lineageArtifactRows) {
    const locator = `${row.buildId}\u0000${row.artifactKey}\u0000${row.version}`
    const rows = artifactRowsByLocator.get(locator) ?? []
    rows.push(row)
    artifactRowsByLocator.set(locator, rows)
    const lineageBuild = input.buildEvidenceById.get(row.buildId)?.build
    if (lineageBuild && row.controlEpoch === lineageBuild.controlEpoch
      && ACTIVE_ARTIFACT_STATUSES.has(row.status)) {
      const activeRows = activeArtifactRowsByBuildId.get(row.buildId) ?? []
      activeRows.push(row)
      activeArtifactRowsByBuildId.set(row.buildId, activeRows)
    }
  }
  const viewByRowId = new Map(views.map(view => [view.rowId, view]))
  const acceptedProofByRunId = new Map<number, Promise<AcceptedCandidateProofV1>>()
  const markTaskGroup = (
    rows: ProductBuildArtifactRecordV1[],
    code: string,
    message: string,
    health: TextOpenWorldGovernedArtifactHealthV1 = 'corrupt',
  ) => {
    for (const row of rows) {
      const view = viewByRowId.get(row.id ?? -1)
      if (view) artifactIssue(view, code, message, health)
    }
  }
  const markViewGroup = (
    group: TextOpenWorldGovernedArtifactV1[],
    code: string,
    message: string,
    health: TextOpenWorldGovernedArtifactHealthV1 = 'corrupt',
  ) => group.forEach(view => artifactIssue(view, code, message, health))
  let missingRowId = -1
  for (const task of plan.tasks) {
    const rows = input.artifactRows.filter(row => row.controlEpoch === build.controlEpoch
      && ACTIVE_ARTIFACT_STATUSES.has(row.status)
      && task.outputArtifactKeys.includes(row.artifactKey))
    const rowViews = rows.map(row => viewByRowId.get(row.id ?? -1)).filter(Boolean) as TextOpenWorldGovernedArtifactV1[]
    const actualKeyCounts = new Map<string, number>()
    for (const row of rows) actualKeyCounts.set(row.artifactKey, (actualKeyCounts.get(row.artifactKey) ?? 0) + 1)
    const missingViews = task.outputArtifactKeys
      .filter(key => !actualKeyCounts.has(key))
      .map(artifactKey => {
        const view = missingArtifactView({
          rowId: missingRowId--,
          artifactKey,
          task,
          build,
          health: COMPLETED_ROOT_BUILD_STATUSES.has(build.status) ? 'corrupt' : 'pending',
        })
        views.push(view)
        viewByRowId.set(view.rowId, view)
        return view
      })
    const groupViews = [...rowViews, ...missingViews]
    try {
    const completedProducer = rows.some(row => row.producerRunId != null
      && input.runEvidenceById.get(row.producerRunId)?.state === 'completed')
    const keys = rows.map(row => row.artifactKey).sort()
    const expectedKeys = [...task.outputArtifactKeys].sort()
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
      markViewGroup(groupViews, 'artifact.atomic-group-incomplete',
        '同一 task 的当前 epoch 输出不完整或重复，整组不进入受治理内容',
        COMPLETED_ROOT_BUILD_STATUSES.has(build.status) || completedProducer ? 'corrupt' : 'pending')
      continue
    }
    if (rowViews.some(view => view.health !== 'verified')) {
      markTaskGroup(rows, 'artifact.atomic-group-invalid', '同一 task 至少一个 sibling 无法验证，整组均不进入受治理内容')
      continue
    }
    const runIds = new Set(rows.map(row => row.producerRunId))
    const receiptHashes = new Set(rows.map(row => row.producerReceiptHash))
    const inputHashes = new Set(rows.map(row => row.inputHash))
    const statuses = new Set(rows.map(row => row.status))
    if (runIds.size !== 1 || receiptHashes.size !== 1 || inputHashes.size !== 1 || statuses.size !== 1) {
      markTaskGroup(rows, 'artifact.atomic-group-provenance', '同一 task sibling 的状态、Run、receipt 或 inputHash 不一致')
      continue
    }
    const runId = rows[0].producerRunId!
    const evidence = input.runEvidenceById.get(runId)
    const boundaryIssue = exactRunBoundaryForArtifact({
      row: rows[0], build, evidence, runEvidenceById: input.runEvidenceById,
      expectedRootRunId: currentBuildEvidence.rootRunId,
      expectedTaskKey: task.taskKey,
      expectedPlanHash: build.planHash,
      requireCompletedRoot: COMPLETED_ROOT_BUILD_STATUSES.has(build.status),
      expectedRootTerminalReceiptHash: build.rootTerminalReceiptHash,
    })
    if (boundaryIssue) {
      markTaskGroup(rows, 'artifact.run-provenance', boundaryIssue)
      continue
    }
    const ledger = currentBuildEvidence.taskLedger[task.taskKey]
    if (!ledger || ledger.status !== 'settled' || ledger.runId !== runId
      || ledger.idempotencyKey !== rows[0].inputHash
      || ledger.terminalReceiptHash !== rows[0].producerReceiptHash) {
      markTaskGroup(rows, 'artifact.ledger-provenance', 'Build task ledger 与 Artifact 生产证明不一致')
      continue
    }
    if (rows[0].status === 'accepted') {
      const candidate = evidence!.candidate
      const candidateKeys = candidate?.result.artifacts.map(item => item.artifactKey).sort() ?? []
      if (!candidate || candidateKeys.length !== expectedKeys.length
        || candidateKeys.some((key, index) => key !== expectedKeys[index])
        || new Set(candidate.result.passedGateIds).size !== candidate.result.passedGateIds.length
        || task.acceptanceGateIds.some(gate => !candidate.result.passedGateIds.includes(gate))
        || !candidateUsageWithinTaskBudget(candidate.result.usage, task)) {
        markTaskGroup(rows, 'artifact.candidate-group', 'task-candidate checkpoint 未精确覆盖 Plan 输出与验收门')
        continue
      }
      const proof = await acceptedCandidateProofForRun(acceptedProofByRunId, evidence!)
      const candidateIssue = await verifyAcceptedRowsAgainstProof({ rows, evidence: evidence!, proof })
      if (candidateIssue || ledger.candidateHash !== candidate.candidateHash) {
        markTaskGroup(rows, 'artifact.candidate-proof', candidateIssue ?? 'Build ledger candidateHash 不一致')
      }
      continue
    }
    const candidateHash = await hashProductProductionCarriedCandidateV1(rows)
    const dependencies = task.dependsOn.map(taskKey => ({
      taskKey,
      receiptHash: currentBuildEvidence.taskLedger[taskKey]?.terminalReceiptHash ?? '',
    }))
    if (dependencies.some(item => !isSha256Hash(item.receiptHash))) {
      markTaskGroup(rows, 'artifact.carried-dependencies', '复用 task 的依赖 receipt 不完整')
      continue
    }
    const receiptHash = await hashProductProductionCarriedReceiptV1({
      taskKey: task.taskKey,
      inputHash: rows[0].inputHash,
      candidateHash,
      dependencies,
      passedGateIds: task.acceptanceGateIds,
      controlEpoch: build.controlEpoch,
    })
    if (candidateHash !== ledger.candidateHash || evidence!.taskStep?.outputHash !== candidateHash
      || receiptHash !== rows[0].producerReceiptHash || receiptHash !== evidence!.terminalReceiptHash) {
      markTaskGroup(rows, 'artifact.carried-receipt', '复用 task 的 candidate/step/receipt 无法按共享算法重算')
      continue
    }
    let lineageIssue: string | null = null
    for (const row of rows) {
      lineageIssue = await verifyCarriedLineage({
        production, row, buildsByNumber,
        buildEvidenceById: input.buildEvidenceById,
        artifactRowsByLocator,
        activeArtifactRowsByBuildId,
        runEvidenceById: input.runEvidenceById,
        acceptedProofByRunId,
        blobEvidenceById: input.blobEvidenceById,
      })
      if (lineageIssue) break
    }
    if (lineageIssue) markTaskGroup(rows, 'artifact.carried-lineage', lineageIssue)
    } catch (cause) {
      markTaskGroup(rows, 'artifact.proof-error',
        `task 证明无法安全验证：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  const rootIssue = await completedBuildRootIssue({
    production,
    buildEvidence: currentBuildEvidence,
    plan,
    activeRows: input.artifactRows.filter(row => row.controlEpoch === build.controlEpoch
      && ACTIVE_ARTIFACT_STATUSES.has(row.status)),
    runEvidenceById: input.runEvidenceById,
  })
  if (rootIssue) {
    markViewGroup(views.filter(view => view.currentEpoch), 'build.root-proof', rootIssue)
  }

  const currentPinViews = views.filter(view => view.currentEpoch && view.health === 'verified'
    && view.kind === 'text-open-world.source-pin')
  const currentUnitViews = views.filter(view => view.currentEpoch && view.health === 'verified'
    && view.kind === 'text-open-world.source-pin-unit')
  if (currentPinViews.length === 0 && currentUnitViews.length > 0) {
    for (const unit of currentUnitViews) {
      artifactIssue(unit, 'source-pin.closure-pending', 'SourcePin 闭合索引尚未验收，来源单元暂不计入当前有效内容', 'pending')
    }
  } else if (currentPinViews.length === 1) {
    const pinView = currentPinViews[0]
    const pin = parsedPayloads.get(pinView.rowId)
    try {
      if (!pin || pin.pinHash !== pinView.contentHash) throw new Error('SourcePin 行 Hash 与 pinHash 不一致')
      await validateTextOpenWorldSourcePinBundleV1({
        pin: pin as never,
        units: currentUnitViews.map(unit => ({
          payload: parsedPayloads.get(unit.rowId) as never,
          artifactContentHash: unit.contentHash,
        })),
      })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      artifactIssue(pinView, 'source-pin.closure', `SourcePin 闭包损坏：${detail}`)
      for (const unit of currentUnitViews) {
        artifactIssue(unit, 'source-pin.closure', 'SourcePinUnit 不能闭合到当前 SourcePin')
      }
    }
  }

  let dependencyChanged = true
  while (dependencyChanged) {
    dependencyChanged = false
    for (const view of views.filter(item => item.currentEpoch && item.health === 'verified')) {
      const payload = parsedPayloads.get(view.rowId)
      if (!payload) continue
      for (const [field, targetArtifactKey] of Object.entries(UPSTREAM_HASH_ARTIFACTS)) {
        if (targetArtifactKey === view.kind || !(field in payload)) continue
        const declaredHash = payload[field]
        if (!isSha256Hash(declaredHash)) {
          artifactIssue(view, 'artifact.upstream-hash', `${field} 不是合法 Hash`)
          dependencyChanged = true
          break
        }
        const targets = views.filter(item => item.currentEpoch
          && ACTIVE_ARTIFACT_STATUSES.has(item.artifactStatus)
          && item.artifactKey === targetArtifactKey)
        const target = targets.length === 1 && targets[0].health === 'verified' ? targets[0] : null
        if (!target) {
          artifactIssue(view, targets.length === 0 ? 'artifact.upstream-pending' : 'artifact.upstream-invalid',
            targets.length === 0 ? `${targetArtifactKey} 尚未生产，${field} 暂不能闭合`
              : `${targetArtifactKey} 当前不可验证，${field} 暂不能闭合`,
            targets.length === 0 ? 'pending' : 'dangling')
          dependencyChanged = true
          break
        }
        const targetPayload = parsedPayloads.get(target.rowId)
        const targetOwnHashField = ARTIFACT_OWN_HASH_FIELDS[target.kind]
        const targetHash = targetOwnHashField && targetPayload
          ? targetPayload[targetOwnHashField]
          : target.contentHash
        if (targetHash !== declaredHash) {
          artifactIssue(view, 'artifact.upstream-mismatch', `${field} 与当前 ${targetArtifactKey} 不一致`, 'dangling')
          dependencyChanged = true
          break
        }
      }
    }
  }

  const ledgerViews = views.filter(view => view.currentEpoch && view.health === 'verified'
    && view.kind === 'text-open-world.source-ledger')
  const claimKeys = new Set<string>()
  if (ledgerViews.length === 1) {
    const ledger = parsedPayloads.get(ledgerViews[0].rowId)
    for (const entry of Array.isArray(ledger?.entries) ? ledger.entries : []) {
      const claim = record(entry)
      if (typeof claim?.claimKey === 'string') claimKeys.add(claim.claimKey)
    }
  }
  for (const view of views.filter(item => item.currentEpoch && item.health === 'verified')) {
    const requestedClaims = (allSourceEvidenceByRowId.get(view.rowId) ?? [])
      .filter(item => item.kind === 'source-claim')
    if (!requestedClaims.length) continue
    if (ledgerViews.length !== 1) {
      artifactIssue(view, 'source-claim.ledger-pending',
        '内容引用了来源 claim，但当前 SourceLedger 尚不可验证', 'pending')
      continue
    }
    const missing = requestedClaims.filter(item => !claimKeys.has(item.key))
    if (missing.length) artifactIssue(view, 'source-claim.dangling',
      `有 ${missing.length} 个来源 claim 无法在当前 SourceLedger 解析`, 'dangling')
  }

  for (const task of plan.tasks) {
    const taskViews = views.filter(view => view.currentEpoch
      && ACTIVE_ARTIFACT_STATUSES.has(view.artifactStatus)
      && view.ownerTaskKey === task.taskKey)
    const authority = productionAuthority.tasks.get(task.taskKey)
    const actualKeys = taskViews.map(view => view.artifactKey).sort()
    const expectedKeys = [...task.outputArtifactKeys].sort()
    const exactHealthyGroup = taskViews.length === expectedKeys.length
      && actualKeys.every((key, index) => key === expectedKeys[index])
      && taskViews.every(view => view.health === 'verified')
    if (!originAuthorized || !authority?.valid || !authority.validatorId || !exactHealthyGroup) {
      if (!originAuthorized || !authority?.valid) {
        for (const view of taskViews.filter(item => item.health === 'verified')) {
          view.diagnostics.push({
            code: 'artifact.production-validation-unavailable',
            message: authority?.diagnostic
              ?? productionAuthority.diagnostic
              ?? (productionAuthority.origin === 'structural-only'
                ? 'Plan 只有拓扑相似性，缺少 Creator 冻结启动来源证明'
                : 'Artifact 的 owner task 不属于产品内置生产合同'),
          })
        }
      }
      continue
    }
    const receiptHash = await productionValidationReceiptV1({
      productionKey: production.productionKey,
      build,
      authorityReceiptHash: productionAuthority.authorityReceiptHash!,
      taskKey: task.taskKey,
      validatorId: authority.validatorId,
      artifacts: taskViews,
    })
    for (const view of taskViews) {
      view.productionValidation = 'production-validated'
      view.validatorId = authority.validatorId
      view.validationReceiptHash = receiptHash
    }
  }

  const candidates: MutableEntityV1[] = []
  const projectionBudget = { entityCount: 0 }
  for (const artifact of views) {
    // Integrity-only projections may still diagnose duplicate, mirror and
    // reference defects, but they are never emitted as publishable entities.
    if (artifact.health !== 'verified') continue
    const payload = parsedPayloads.get(artifact.rowId)
    if (!payload) continue
    const before = projectionBudget.entityCount
    try {
      const projected = projectEntitiesFromArtifact(artifact, payload, projectionBudget)
      candidates.push(...projected)
    } catch {
      projectionBudget.entityCount = before
      artifactIssue(artifact, 'projection.entity-budget',
        'Artifact 实体投影超过治理读取的安全上限')
    }
  }
  const viewByArtifactVersion = new Map(views.map(view => [
    `${view.artifactKey}\u0000${view.version}`,
    view,
  ]))
  const preliminaryGroups = new Map<string, MutableEntityV1[]>()
  for (const candidate of candidates) {
    const list = preliminaryGroups.get(candidate.identity) ?? []
    list.push(candidate)
    preliminaryGroups.set(candidate.identity, list)
  }
  for (const [identity, rows] of preliminaryGroups) {
    const byArtifact = new Map<string, MutableEntityV1[]>()
    for (const row of rows) {
      const values = byArtifact.get(row.artifactKey) ?? []
      values.push(row)
      byArtifact.set(row.artifactKey, values)
    }
    for (const [artifactKey, duplicates] of byArtifact) {
      if (duplicates.length < 2) continue
      const view = viewByArtifactVersion.get(`${artifactKey}\u0000${duplicates[0].artifactVersion}`)
      if (view) artifactIssue(view, 'projection.entity-duplicate',
        `同一 Artifact 重复定义实体 ${identity}`)
    }
    const uniqueRows = [...byArtifact.values()]
      .filter(definitions => definitions.length === 1)
      .map(definitions => definitions[0])
    for (let leftIndex = 0; leftIndex < uniqueRows.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < uniqueRows.length; rightIndex += 1) {
        const left = uniqueRows[leftIndex]
        const right = uniqueRows[rightIndex]
        const mirror = knownMirrorPair(left, right)
        const mismatch = mirror && canonicalProductProductionJsonV2(mirrorInvariant(left))
          !== canonicalProductProductionJsonV2(mirrorInvariant(right))
        if (!mismatch && (mirror || left.rank !== right.rank)) continue
        for (const candidate of [left, right]) {
          const view = viewByArtifactVersion.get(
            `${candidate.artifactKey}\u0000${candidate.artifactVersion}`,
          )
          if (view) artifactIssue(view, mirror ? 'projection.mirror-conflict' : 'projection.authority-conflict',
            mirror ? `镜像 Artifact 对实体 ${identity} 的权威字段不一致`
              : `多个 Artifact 以相同 authority 定义实体 ${identity}`)
        }
      }
    }
  }
  // Remember identities that were actually emitted before conflict checks.
  // When every definition is invalidated, references must become dangling
  // instead of looking like content that simply has not been generated yet.
  const producedEntityIdentities = new Set(candidates.map(candidate => candidate.identity))
  const candidateGroups = new Map<string, MutableEntityV1[]>()
  for (const candidate of candidates) {
    const source = viewByArtifactVersion.get(`${candidate.artifactKey}\u0000${candidate.artifactVersion}`)
    if (source?.health !== 'verified') continue
    const list = candidateGroups.get(candidate.identity) ?? []
    list.push(candidate)
    candidateGroups.set(candidate.identity, list)
  }
  const canonicalEntities = new Map<string, MutableEntityV1>()
  for (const [identity, rows] of candidateGroups) {
    rows.sort((left, right) => {
      const leftSource = viewByArtifactVersion.get(`${left.artifactKey}\u0000${left.artifactVersion}`)
      const rightSource = viewByArtifactVersion.get(`${right.artifactKey}\u0000${right.artifactVersion}`)
      const leftProductionRank = originAuthorized
        && leftSource?.productionValidation === 'production-validated' ? 1 : 0
      const rightProductionRank = originAuthorized
        && rightSource?.productionValidation === 'production-validated' ? 1 : 0
      return rightProductionRank - leftProductionRank
        || right.rank - left.rank
      || right.artifactVersion - left.artifactVersion
        || left.artifactKey.localeCompare(right.artifactKey)
    })
    const best = rows[0]
    best.definedByArtifactKeys = [...new Set(rows.map(row => row.artifactKey))].sort()
    canonicalEntities.set(identity, best)
  }
  const productionEligibleEntityIdentities = new Set(candidates
    .filter(candidate => {
      const source = viewByArtifactVersion.get(
        `${candidate.artifactKey}\u0000${candidate.artifactVersion}`,
      )
      return source?.health === 'verified'
        && source.productionValidation === 'production-validated'
    })
    .map(candidate => candidate.identity))
  const invalidEntityIdentities = new Set([...producedEntityIdentities]
    .filter(identity => !canonicalEntities.has(identity)
      || originAuthorized && !productionEligibleEntityIdentities.has(identity)))
  const currentAnalyzableArtifactKeys = new Set(views
    .filter(view => view.currentEpoch && view.health === 'verified')
    .map(view => view.artifactKey))
  let scannedReferenceEdges = 0
  let referenceBudgetExhausted = false
  const allReferencesByIdentity = new Map<string, TextOpenWorldGovernedEntityReferenceV1[]>()
  const reverseReferenceSources = new Map<string, Set<string>>()
  entityLoop: for (const entity of canonicalEntities.values()) {
    const sourceArtifact = viewByArtifactVersion.get(
      `${entity.artifactKey}\u0000${entity.artifactVersion}`,
    )
    if (!sourceArtifact || sourceArtifact.health !== 'verified') continue
    if (referenceBudgetExhausted) {
      artifactIssue(sourceArtifact, 'projection.reference-budget',
        '全局实体引用扫描已达到安全上限，该 Artifact 未进入内容投影')
      continue
    }
    const refs = new Map<string, TextOpenWorldGovernedEntityReferenceV1>()
    for (const spec of entity.referenceSpecs) {
      for (const targetKey of stringsAt(entity.raw, spec.path)) {
        scannedReferenceEdges += 1
        if (scannedReferenceEdges > MAX_REFERENCE_EDGES_SCANNED) {
          referenceBudgetExhausted = true
          artifactIssue(sourceArtifact, 'projection.reference-budget',
            'Artifact 实体引用边超过 1,000,000 条全局安全上限')
          continue entityLoop
        }
        const targetIdentity = `${spec.targetKind}:${targetKey}`
        const allowedDefinitions = (preliminaryGroups.get(targetIdentity) ?? [])
          .filter(definition => spec.targetArtifacts.includes(definition.artifactKey))
        const eligibleDefinitions = allowedDefinitions.filter(definition => {
          const targetSource = viewByArtifactVersion.get(
            `${definition.artifactKey}\u0000${definition.artifactVersion}`,
          )
          return targetSource?.health === 'verified'
            && (!originAuthorized
              || targetSource.productionValidation === 'production-validated')
        })
        const producerAvailable = spec.targetArtifacts.some(key => currentAnalyzableArtifactKeys.has(key))
        const status = eligibleDefinitions.length > 0 ? 'resolved' as const
          : allowedDefinitions.length > 0
            || invalidEntityIdentities.has(targetIdentity) || producerAvailable
            ? 'dangling' as const : 'pending' as const
        refs.set(`${spec.field}:${targetIdentity}`, {
          field: spec.field, targetKind: spec.targetKind, targetKey, targetIdentity, status,
        })
      }
    }
    const allReferences = [...refs.values()].sort((left, right) => left.field.localeCompare(right.field)
      || left.targetIdentity.localeCompare(right.targetIdentity))
    allReferencesByIdentity.set(entity.identity, allReferences)
    for (const reference of allReferences) {
      const sources = reverseReferenceSources.get(reference.targetIdentity) ?? new Set<string>()
      sources.add(entity.identity)
      reverseReferenceSources.set(reference.targetIdentity, sources)
    }
    entity.referenceCount = allReferences.length
    entity.truncatedReferenceCount = Math.max(0, allReferences.length - MAX_ENTITY_REFS)
    entity.references = allReferences.slice(0, MAX_ENTITY_REFS)
    entity.status = allReferences.some(item => item.status === 'dangling') ? 'dangling'
      : allReferences.some(item => item.status === 'pending') ? 'pending-reference' : 'verified'
    if (entity.status === 'dangling') {
      const artifact = viewByArtifactVersion.get(`${entity.artifactKey}\u0000${entity.artifactVersion}`)
      if (artifact) artifactIssue(artifact, 'artifact.dangling-reference',
        '内容含有已应存在但无法解析的稳定 ID 引用', 'dangling')
    }
  }
  const entityIdentitiesBySourceArtifact = new Map<string, string[]>()
  for (const entity of canonicalEntities.values()) {
    const locator = `${entity.artifactKey}\u0000${entity.artifactVersion}`
    const identities = entityIdentitiesBySourceArtifact.get(locator) ?? []
    identities.push(entity.identity)
    entityIdentitiesBySourceArtifact.set(locator, identities)
  }
  // Seed propagation from every entity whose defining Artifact has already
  // lost publishable authority, including first-hop dangling references,
  // reference-budget failures, and all siblings in the same atomic Artifact.
  // Merely checking duplicate/conflict identities would let B→A→missing-X
  // retain a falsely resolved A after A's Artifact was downgraded.
  const propagatedInvalidEntities = new Set(invalidEntityIdentities)
  const invalidEntityQueue = [...propagatedInvalidEntities]
  for (const [sourceLocator, identities] of entityIdentitiesBySourceArtifact) {
    const sourceArtifact = viewByArtifactVersion.get(sourceLocator)
    if (sourceArtifact?.health === 'verified'
      && (!originAuthorized
        || sourceArtifact.productionValidation === 'production-validated')) continue
    for (const identity of identities) {
      if (propagatedInvalidEntities.has(identity)) continue
      propagatedInvalidEntities.add(identity)
      invalidEntityQueue.push(identity)
    }
  }
  for (let cursor = 0; cursor < invalidEntityQueue.length; cursor += 1) {
    const invalidTargetIdentity = invalidEntityQueue[cursor]
    for (const sourceIdentity of reverseReferenceSources.get(invalidTargetIdentity) ?? []) {
      const sourceEntity = canonicalEntities.get(sourceIdentity)
      if (!sourceEntity) continue
      const sourceArtifact = viewByArtifactVersion.get(
        `${sourceEntity.artifactKey}\u0000${sourceEntity.artifactVersion}`,
      )
      // A first-hop dangling reference has already downgraded this Artifact.
      // It must still propagate invalidity to its own referrers; otherwise a
      // B→A→invalid-X chain can publish B with a falsely resolved reference.
      if (!sourceArtifact) continue
      const references = allReferencesByIdentity.get(sourceIdentity) ?? []
      for (const reference of references) {
        if (reference.targetIdentity === invalidTargetIdentity) reference.status = 'dangling'
      }
      sourceEntity.status = 'dangling'
      artifactIssue(sourceArtifact, 'artifact.dangling-reference-cascade',
        `内容引用的 ${invalidTargetIdentity} 已失去生产验证权威`, 'dangling')
      const sourceLocator = `${sourceEntity.artifactKey}\u0000${sourceEntity.artifactVersion}`
      for (const siblingIdentity of entityIdentitiesBySourceArtifact.get(sourceLocator) ?? []) {
        if (propagatedInvalidEntities.has(siblingIdentity)) continue
        propagatedInvalidEntities.add(siblingIdentity)
        invalidEntityQueue.push(siblingIdentity)
      }
    }
  }
  const publishableEntities = [...canonicalEntities.values()].filter(entity => {
    const source = viewByArtifactVersion.get(`${entity.artifactKey}\u0000${entity.artifactVersion}`)
    return source?.health === 'verified'
      && source.productionValidation === 'production-validated'
      && entity.status === 'verified'
      && !propagatedInvalidEntities.has(entity.identity)
  })
  const entityIdsByArtifactVersion = new Map<string, string[]>()
  for (const entity of publishableEntities) {
    const locator = `${entity.artifactKey}\u0000${entity.artifactVersion}`
    const identities = entityIdsByArtifactVersion.get(locator) ?? []
    identities.push(entity.identity)
    entityIdsByArtifactVersion.set(locator, identities)
  }
  for (const artifact of views) {
    artifact.entityIdentities = (entityIdsByArtifactVersion.get(
      `${artifact.artifactKey}\u0000${artifact.version}`,
    ) ?? []).sort()
  }
  const entities: TextOpenWorldGovernedEntityV1[] = publishableEntities
    .map(({ rank: _rank, raw: _raw, referenceSpecs: _referenceSpecs, ...entity }) => entity)
    .sort((left, right) => left.kind.localeCompare(right.kind)
      || left.title.localeCompare(right.title) || left.key.localeCompare(right.key))
  views.sort(artifactSort)
  const currentIntegrityVerifiedArtifactCount = views.filter(view => view.currentEpoch
    && view.health === 'verified').length
  const currentProductionValidatedArtifactCount = views.filter(view => view.currentEpoch
    && view.health === 'verified'
    && view.productionValidation === 'production-validated').length
  const summary = {
    rowCount: views.length,
    currentVerifiedArtifactCount: currentIntegrityVerifiedArtifactCount,
    currentProductionValidatedArtifactCount,
    currentIntegrityOnlyArtifactCount: currentIntegrityVerifiedArtifactCount
      - currentProductionValidatedArtifactCount,
    currentProblemArtifactCount: views.filter(view => view.currentEpoch
      && ['corrupt', 'dangling', 'pending'].includes(view.health)).length,
    historicalArtifactCount: views.filter(view => !view.currentEpoch || view.health === 'invalid').length,
    entityCount: entities.length,
    danglingEntityCount: entities.filter(entity => entity.status === 'dangling').length,
    pendingReferenceEntityCount: entities.filter(entity => entity.status === 'pending-reference').length,
  }
  const productionView = {
    id: production.id, productionKey: production.productionKey, title: production.title,
    status: production.status, stateRevision: production.stateRevision,
  }
  const buildView = {
    id: build.id, buildNumber: build.buildNumber, status: build.status,
    controlEpoch: build.controlEpoch, planHash: build.planHash,
  }
  const safeSnapshotJson = canonicalProductProductionJsonV2({
    schema: 'storyforge.text-open-world-artifact-governance-projection',
    version: 1,
    production: productionView,
    build: buildView,
    summary,
    artifacts: views,
    entities,
  })
  if (agentRunUtf8ByteLengthV1(safeSnapshotJson) > MAX_PUBLIC_DTO_UTF8_BYTES) {
    throw new Error('[text-open-world-artifact-governance] 公开治理 DTO 超过 64 MiB 安全上限')
  }
  const snapshotDigest = await crypto.subtle.digest('SHA-256', GOVERNANCE_TEXT_ENCODER.encode(safeSnapshotJson))
  const snapshotHash = Array.from(new Uint8Array(snapshotDigest), byte => byte.toString(16).padStart(2, '0')).join('')
  return {
    schema: 'storyforge.text-open-world-artifact-governance-projection',
    version: 1,
    production: productionView,
    build: buildView,
    snapshotHash,
    summary,
    artifacts: views,
    entities,
  }
}

/**
 * Public pure projection is intentionally integrity-only. Production
 * validation is available solely through readTextOpenWorldArtifactGovernanceV1,
 * which resolves the frozen Creator evidence from IndexedDB itself.
 */
export async function projectTextOpenWorldArtifactGovernanceV1(
  input: TextOpenWorldArtifactGovernanceProjectionInputV1,
): Promise<TextOpenWorldArtifactGovernanceProjectionV1> {
  return projectTextOpenWorldArtifactGovernanceTrustedV1(
    input,
    inspectTextOpenWorldProductionPlanAuthorityV1(input.plan),
  )
}

/**
 * Safe, snapshot-bound pagination for the Creator browser. Searchable text is
 * deliberately limited to already disclosed DTO fields and stable locators.
 */
export function pageTextOpenWorldArtifactGovernanceV1(input: {
  projection: TextOpenWorldArtifactGovernanceProjectionV1
  expectedSnapshotHash?: string
  mode: TextOpenWorldArtifactBrowserModeV1
  query?: string
  kind?: string
  health?: TextOpenWorldGovernedArtifactHealthV1 | 'all'
  entityStatus?: TextOpenWorldGovernedEntityV1['status'] | 'all'
  page?: number
  pageSize?: number
}): TextOpenWorldArtifactBrowserPageV1 {
  if (input.expectedSnapshotHash != null
    && input.expectedSnapshotHash !== input.projection.snapshotHash) {
    throw new Error('[text-open-world-artifact-governance] 浏览游标属于旧快照')
  }
  const query = input.query?.trim().toLocaleLowerCase() ?? ''
  const pageSize = Math.max(1, Math.min(50, Math.floor(input.pageSize ?? 30)))
  const requestedPage = Math.max(1, Math.floor(input.page ?? 1))
  let entities: TextOpenWorldGovernedEntityV1[] = []
  let artifacts: TextOpenWorldGovernedArtifactV1[] = []
  if (input.mode === 'content') {
    entities = input.projection.entities.filter(item => (
      (!input.kind || input.kind === 'all' || item.kind === input.kind)
      && ((input.entityStatus ?? 'verified') === 'all'
        || item.status === (input.entityStatus ?? 'verified'))
      && (!query || [item.identity, item.key, item.title, item.summary]
        .some(value => value.toLocaleLowerCase().includes(query)))
    ))
  } else {
    artifacts = input.projection.artifacts.filter(item => {
      const diagnostic = input.mode === 'diagnostics'
        ? item.health !== 'verified'
          || item.productionValidation === 'integrity-only'
          || item.diagnostics.length > 0
        : true
      return diagnostic
        && (!input.kind || input.kind === 'all' || item.group === input.kind || item.kind === input.kind)
        && (!input.health || input.health === 'all' || item.health === input.health)
        && (!query || [item.artifactKey, item.kind, item.label, item.ownerTaskKey ?? '']
          .some(value => value.toLocaleLowerCase().includes(query)))
    })
  }
  const total = input.mode === 'content' ? entities.length : artifacts.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, pageCount)
  const start = (page - 1) * pageSize
  return {
    snapshotHash: input.projection.snapshotHash,
    mode: input.mode,
    page,
    pageSize,
    total,
    pageCount,
    entities: entities.slice(start, start + pageSize),
    artifacts: artifacts.slice(start, start + pageSize),
  }
}

interface LatestCheckpointHeaderV1 {
  id: number
  runId: number
  throughSequence: number
  generation: number
  contractHash: string
  checkpointHash: string
  projectionHash: string
  resumePayloadHash: string | null
  resumePayloadBytes: number
  projectionJsonBytes: number
  projectionJsonByteHash: string
  resumePayloadJsonByteHash: string | null
}

export interface GovernanceRunFingerprintV1 {
  runId: number
  missing: boolean
  status: string | null
  projectId: number | null
  workId: number | null
  productBuildId: number | null
  parentRunId: number | null
  parentRelation: string | null
  terminalReceiptHash: string | null
  contractVersion: number | null
  contractHash: string | null
  generation: number | null
  lastSequence: number | null
  projectionHash: string | null
  updatedAt: number | null
  contractJsonBytes: number | null
  contractJsonByteHash: string | null
  projectionJsonBytes: number | null
  projectionJsonByteHash: string | null
  checkpoint: LatestCheckpointHeaderV1 | null
  eventStream: TextOpenWorldArtifactRunEventStreamFingerprintV1
}

async function hashGovernanceUtf8TextV1(value: string): Promise<string> {
  const digestPromise = crypto.subtle.digest('SHA-256', GOVERNANCE_TEXT_ENCODER.encode(value))
  const digest = Dexie.currentTransaction
    ? await Dexie.waitFor(digestPromise)
    : await digestPromise
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function checkpointHeaderFromRowV1(
  row: AgentRunCheckpointRecord & { id: number },
): Promise<LatestCheckpointHeaderV1> {
  const projectionJsonBytes = agentRunUtf8ByteLengthV1(row.projectionJson)
  const resumePayloadBytes = row.resumePayloadJson == null
    ? 0 : agentRunUtf8ByteLengthV1(row.resumePayloadJson)
  const projectionJsonByteHash = await hashGovernanceUtf8TextV1(row.projectionJson)
  const resumePayloadJsonByteHash = row.resumePayloadJson == null
    ? null : await hashGovernanceUtf8TextV1(row.resumePayloadJson)
  return {
    id: row.id,
    runId: row.runId,
    throughSequence: row.throughSequence,
    generation: row.generation,
    contractHash: row.contractHash,
    checkpointHash: row.checkpointHash,
    projectionHash: row.projectionHash,
    resumePayloadHash: row.resumePayloadHash ?? null,
    resumePayloadBytes,
    projectionJsonBytes,
    projectionJsonByteHash,
    resumePayloadJsonByteHash,
  }
}

async function loadLatestCheckpointHeadersV1(
  runIds: number[],
  maximumAggregateBytes: number,
): Promise<{ byRunId: Map<number, LatestCheckpointHeaderV1>; totalBytes: number }> {
  if (!Number.isSafeInteger(maximumAggregateBytes) || maximumAggregateBytes < 0) {
    throw new Error('[text-open-world-artifact-governance] checkpoint 聚合读取预算无效')
  }
  const byRunId = new Map<number, LatestCheckpointHeaderV1>()
  let totalBytes = 0
  // The checkpoint body shares one IndexedDB record with its header. Read one
  // latest row at a time so the aggregate cap is checked before another large
  // resume payload can be materialized in memory.
  for (const runId of runIds) {
    const row = await db.agentRunCheckpoints
      .where('[runId+throughSequence]')
      .between([runId, Dexie.minKey], [runId, Dexie.maxKey])
      .last()
    if (!row || row.id == null) continue
    const header = await checkpointHeaderFromRowV1(
      row as AgentRunCheckpointRecord & { id: number },
    )
    totalBytes += header.projectionJsonBytes + header.resumePayloadBytes
    if (totalBytes > maximumAggregateBytes) {
      throw new Error('[text-open-world-artifact-governance] checkpoint 正文超过聚合读取预算')
    }
    byRunId.set(row.runId, header)
  }
  return { byRunId, totalBytes }
}

async function checkpointHeaderMatches(
  checkpoint: AgentRunCheckpointRecord & { id: number },
  expected: LatestCheckpointHeaderV1 | undefined,
): Promise<boolean> {
  if (!expected) return false
  const actual = await checkpointHeaderFromRowV1(checkpoint)
  return canonicalProductProductionJsonV2(actual) === canonicalProductProductionJsonV2(expected)
}

async function fingerprintFromRawRun(
  runId: number,
  row: (AgentRunRecord & { id: number }) | undefined,
  checkpoint: LatestCheckpointHeaderV1 | null,
  eventStream: TextOpenWorldArtifactRunEventStreamFingerprintV1,
): Promise<GovernanceRunFingerprintV1> {
  return {
    runId,
    missing: row == null,
    status: row?.status ?? null,
    projectId: row?.projectId ?? null,
    workId: row?.workId ?? null,
    productBuildId: row?.productBuildId ?? null,
    parentRunId: row?.parentRunId ?? null,
    parentRelation: row?.parentRelation ?? null,
    terminalReceiptHash: row?.terminalReceiptHash ?? null,
    contractVersion: row?.contractVersion ?? null,
    contractHash: row?.contractHash ?? null,
    generation: row?.generation ?? null,
    lastSequence: row?.lastSequence ?? null,
    projectionHash: row?.projectionHash ?? null,
    updatedAt: row?.updatedAt ?? null,
    contractJsonBytes: row == null ? null : agentRunUtf8ByteLengthV1(row.contractJson),
    contractJsonByteHash: row == null ? null : await hashGovernanceUtf8TextV1(row.contractJson),
    projectionJsonBytes: row == null ? null : agentRunUtf8ByteLengthV1(row.projectionJson),
    projectionJsonByteHash: row == null ? null : await hashGovernanceUtf8TextV1(row.projectionJson),
    checkpoint,
    eventStream,
  }
}

function fingerprintFromEvidence(
  evidence: TextOpenWorldArtifactRunEvidenceV1,
): GovernanceRunFingerprintV1 {
  if (evidence.snapshotFingerprint) return evidence.snapshotFingerprint
  const integrity = evidence.integrity
  if (!integrity) {
    return {
      runId: evidence.runId, missing: true, status: null, projectId: null, workId: null,
      productBuildId: null, parentRunId: null, parentRelation: null,
      terminalReceiptHash: null, contractVersion: null, contractHash: null,
      generation: null, lastSequence: null, projectionHash: null, updatedAt: null,
      contractJsonBytes: null, contractJsonByteHash: null,
      projectionJsonBytes: null, projectionJsonByteHash: null,
      checkpoint: null,
      eventStream: {
        eventCount: 0, payloadBytes: 0, firstSequence: null, lastSequence: null,
        eventStreamHash: '0'.repeat(64),
      },
    }
  }
  return {
    runId: evidence.runId,
    missing: false,
    status: integrity.status,
    projectId: integrity.projectId,
    workId: integrity.workId,
    productBuildId: integrity.productBuildId,
    parentRunId: integrity.parentRunId,
    parentRelation: integrity.parentRelation,
    terminalReceiptHash: integrity.terminalReceiptHash,
    contractVersion: integrity.contractVersion,
    contractHash: integrity.contractHash,
    generation: integrity.generation,
    lastSequence: integrity.lastSequence,
    projectionHash: integrity.projectionHash,
    updatedAt: integrity.updatedAt,
    contractJsonBytes: integrity.contractJsonBytes,
    contractJsonByteHash: integrity.contractJsonByteHash,
    projectionJsonBytes: integrity.projectionJsonBytes,
    projectionJsonByteHash: integrity.projectionJsonByteHash,
    checkpoint: integrity.checkpoint == null ? null : {
      ...integrity.checkpoint,
      runId: evidence.runId,
    },
    eventStream: integrity.eventStream,
  }
}

async function preflightGovernanceRunBytesV1(
  runIds: number[],
  maximumAggregateBytes: number,
): Promise<{
  totalBytes: number
  eventStreams: Map<number, TextOpenWorldArtifactRunEventStreamFingerprintV1>
}> {
  if (!Number.isSafeInteger(maximumAggregateBytes) || maximumAggregateBytes < 0) {
    throw new Error('[text-open-world-artifact-governance] Run 事件聚合读取预算无效')
  }
  let aggregateBytes = 0
  const eventStreams = new Map<number, TextOpenWorldArtifactRunEventStreamFingerprintV1>()
  for (const runId of runIds) {
    let runBytes = 0
    let eventCount = 0
    let payloadBytes = 0
    let firstSequence: number | null = null
    let lastSequence: number | null = null
    let pageNumber = 0
    let eventStreamHash = await hashProductProductionValueV2({
      schema: 'storyforge.text-open-world-governance-run-event-stream',
      version: 1,
      runId,
      seed: true,
    })
    const run = await db.agentRuns.get(runId)
    if (run) {
      runBytes += agentRunUtf8ByteLengthV1(run.contractJson)
        + agentRunUtf8ByteLengthV1(run.projectionJson)
    }
    if (runBytes > MAX_SINGLE_RUN_EVENT_BYTES) {
      throw new Error(`[text-open-world-artifact-governance] Run ${runId} 事件证明超过单 Run 安全上限`)
    }
    for (;;) {
      const page: AgentRunEventRecord[] = await (lastSequence == null
        ? db.agentRunEvents
          .where('[runId+sequence]')
          .between([runId, Dexie.minKey], [runId, Dexie.maxKey])
        : db.agentRunEvents
          .where('[runId+sequence]')
          .between([runId, lastSequence], [runId, Dexie.maxKey], false, true))
        .limit(GOVERNANCE_RUN_EVENT_DIGEST_PAGE_SIZE)
        .toArray()
      if (page.length === 0) break
      const eventRows: Array<Required<Pick<AgentRunEventRecord,
        'projectId' | 'runId' | 'sequence' | 'generation' | 'contractHash' | 'type' | 'payloadJson' | 'createdAt'>> & {
          id: number | null
          worldGroupId: number | null
        }> = []
      for (const event of page) {
        if (event.runId !== runId || !Number.isSafeInteger(event.sequence)
          || (lastSequence != null && event.sequence <= lastSequence)) {
          throw new Error(`[text-open-world-artifact-governance] Run ${runId} 事件索引顺序损坏`)
        }
        eventCount += 1
        const bytes = agentRunUtf8ByteLengthV1(event.payloadJson)
        payloadBytes += bytes
        runBytes += bytes
        if (eventCount > MAX_SINGLE_RUN_EVENT_COUNT || runBytes > MAX_SINGLE_RUN_EVENT_BYTES) {
          throw new Error(`[text-open-world-artifact-governance] Run ${runId} 事件证明超过单 Run 安全上限`)
        }
        firstSequence ??= event.sequence
        lastSequence = event.sequence
        eventRows.push({
          id: event.id ?? null,
          projectId: event.projectId,
          worldGroupId: event.worldGroupId ?? null,
          runId: event.runId,
          sequence: event.sequence,
          generation: event.generation,
          contractHash: event.contractHash,
          type: event.type,
          // Deliberately hash the exact stored bytes, not the parsed payload.
          // This binds whitespace/key-order/body mutations that leave all
          // materialized Run columns and payload length unchanged.
          payloadJson: event.payloadJson,
          createdAt: event.createdAt,
        })
      }
      pageNumber += 1
      eventStreamHash = await hashProductProductionValueV2({
        schema: 'storyforge.text-open-world-governance-run-event-stream-page',
        version: 1,
        runId,
        pageNumber,
        previousHash: eventStreamHash,
        events: eventRows,
      })
      if (page.length < GOVERNANCE_RUN_EVENT_DIGEST_PAGE_SIZE) break
    }
    eventStreamHash = await hashProductProductionValueV2({
      schema: 'storyforge.text-open-world-governance-run-event-stream-final',
      version: 1,
      runId,
      eventCount,
      payloadBytes,
      firstSequence,
      lastSequence,
      streamHash: eventStreamHash,
    })
    eventStreams.set(runId, {
      eventCount,
      payloadBytes,
      firstSequence,
      lastSequence,
      eventStreamHash,
    })
    aggregateBytes += runBytes
    if (aggregateBytes > maximumAggregateBytes) {
      throw new Error('[text-open-world-artifact-governance] Run 事件证明超过聚合读取预算')
    }
  }
  return { totalBytes: aggregateBytes, eventStreams }
}

async function loadRunEvidence(
  scope: WorkspaceScope,
  runIds: number[],
  maximumCheckpointBytes = MAX_GOVERNANCE_CHECKPOINT_BYTES,
  maximumRunEventBytes = MAX_GOVERNANCE_RUN_EVENT_BYTES,
): Promise<{
  evidence: Map<number, TextOpenWorldArtifactRunEvidenceV1>
  checkpointBytes: number
  runEventBytes: number
}> {
  const uniqueRunIds = [...new Set(runIds)].sort((left, right) => left - right)
  if (uniqueRunIds.length > MAX_GOVERNANCE_RUNS) {
    throw new Error('[text-open-world-artifact-governance] 治理谱系 Run 数超过安全上限')
  }
  const runEventRead = await preflightGovernanceRunBytesV1(uniqueRunIds, maximumRunEventBytes)
  const headers = await loadLatestCheckpointHeadersV1(uniqueRunIds, maximumCheckpointBytes)
  const result = new Map<number, TextOpenWorldArtifactRunEvidenceV1>()
  for (let offset = 0; offset < uniqueRunIds.length; offset += RUN_EVIDENCE_READ_CONCURRENCY) {
    const chunk = uniqueRunIds.slice(offset, offset + RUN_EVIDENCE_READ_CONCURRENCY)
    await Promise.all(chunk.map(async runId => {
      const expectedHeader = headers.byRunId.get(runId)
      const eventStream = runEventRead.eventStreams.get(runId)!
      try {
        const verifiedCheckpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId, {
          maximumResumePayloadBytes: expectedHeader?.resumePayloadBytes ?? 0,
        })
        if (verifiedCheckpoint) {
          if (!await checkpointHeaderMatches(verifiedCheckpoint.checkpoint, expectedHeader)) {
            throw new Error('读取期间 checkpoint 已变化')
          }
          result.set(runId, await runEvidence(
            verifiedCheckpoint.snapshot,
            eventStream,
            candidateEvidence(verifiedCheckpoint.resumePayload, verifiedCheckpoint.checkpoint.checkpointHash),
            expectedHeader ?? null,
          ))
        } else {
          if (expectedHeader) throw new Error('读取期间 checkpoint 已删除')
          result.set(runId, await runEvidence(await readAgentRunV1(scope, runId), eventStream))
        }
      } catch (cause) {
        const raw = await db.agentRuns.get(runId) as (AgentRunRecord & { id: number }) | undefined
        const fingerprint = await fingerprintFromRawRun(runId, raw, expectedHeader ?? null, eventStream)
        result.set(runId, {
          runId,
          state: 'unreadable',
          projectId: raw?.projectId ?? scope.projectId,
          workId: raw?.workId ?? null,
          productBuildId: raw?.productBuildId ?? null,
          parentRunId: raw?.parentRunId ?? null,
          parentRelation: raw?.parentRelation ?? null,
          terminalReceiptHash: raw?.terminalReceiptHash ?? null,
          boundary: null,
          taskStep: null,
          candidate: null,
          snapshotFingerprint: fingerprint,
          integrity: fingerprint.missing ? null : {
            status: fingerprint.status!,
            projectId: fingerprint.projectId!,
            workId: fingerprint.workId,
            productBuildId: fingerprint.productBuildId,
            parentRunId: fingerprint.parentRunId,
            parentRelation: fingerprint.parentRelation,
            terminalReceiptHash: fingerprint.terminalReceiptHash,
            contractVersion: fingerprint.contractVersion!,
            contractHash: fingerprint.contractHash!,
            generation: fingerprint.generation!,
            lastSequence: fingerprint.lastSequence!,
            projectionHash: fingerprint.projectionHash!,
            updatedAt: fingerprint.updatedAt!,
            contractJsonBytes: fingerprint.contractJsonBytes!,
            contractJsonByteHash: fingerprint.contractJsonByteHash!,
            projectionJsonBytes: fingerprint.projectionJsonBytes!,
            projectionJsonByteHash: fingerprint.projectionJsonByteHash!,
            checkpoint: fingerprint.checkpoint,
            eventStream: fingerprint.eventStream,
          },
          error: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }))
  }
  return { evidence: result, checkpointBytes: headers.totalBytes, runEventBytes: runEventRead.totalBytes }
}

function toBlobEvidence(
  row: MediaBlobObjectRecordV1 & { id: number },
  physicalBytesVerified: boolean,
): TextOpenWorldArtifactBlobEvidenceV1 {
  return {
    blobId: row.id, projectId: row.projectId, worldId: row.worldId, workId: row.workId,
    contentHash: row.contentHash, mimeType: row.mimeType, byteSize: row.byteSize,
    storageState: row.storageState, physicalBytesVerified,
  }
}

interface GovernanceBlobPhysicalFingerprintV1 {
  blobId: number
  physicalBytesVerified: boolean
}

async function verifyGovernanceBlobRowsV1(input: {
  scope: WorkspaceScope
  rows: Array<(MediaBlobObjectRecordV1 & { id: number }) | undefined>
}): Promise<{
  evidenceById: Map<number, TextOpenWorldArtifactBlobEvidenceV1>
  fingerprints: GovernanceBlobPhysicalFingerprintV1[]
}> {
  const evidenceById = new Map<number, TextOpenWorldArtifactBlobEvidenceV1>()
  const fingerprints: GovernanceBlobPhysicalFingerprintV1[] = []
  for (const row of input.rows) {
    if (!row) continue
    if (row.projectId !== input.scope.projectId || row.worldId !== input.scope.worldId
      || row.workId !== input.scope.workId) {
      throw new Error('[text-open-world-artifact-governance] 媒资作用域完整性错误')
    }
    let physicalBytesVerified = false
    try {
      await readVerifiedMediaBlobObjectData(row)
      physicalBytesVerified = true
    } catch {
      // Governance reads are intentionally non-mutating. The public Artifact
      // diagnostic reports a fixed safe reason without exposing storage paths.
    }
    evidenceById.set(row.id, toBlobEvidence(row, physicalBytesVerified))
    fingerprints.push({ blobId: row.id, physicalBytesVerified })
  }
  fingerprints.sort((left, right) => left.blobId - right.blobId)
  return { evidenceById, fingerprints }
}

function parseBuildEvidence(
  build: ProductBuildRecordV1 & { id: number },
): TextOpenWorldArtifactBuildEvidenceV1 {
  let plan: ProductProductionPlanV3 | null = null
  try { plan = parseProductProductionPlanV3(build.planJson, undefined, build.briefHash) }
  catch { /* historical/corrupt plans remain available only as diagnostics */ }
  const taskLedger: TextOpenWorldArtifactBuildEvidenceV1['taskLedger'] = {}
  let rootRunId: number | null = null
  try {
    const ledger = record(JSON.parse(build.budgetLedgerJson))
    if (ledger?.schema === 'storyforge.product-production-budget-ledger'
      && ledger.version === 2 && record(ledger.tasks)) {
      rootRunId = ledger.rootRunId == null ? null
        : Number.isInteger(ledger.rootRunId) ? ledger.rootRunId as number : null
      for (const [taskKey, raw] of Object.entries(ledger.tasks as Record<string, unknown>)) {
        const row = record(raw)
        if (!row || !Number.isInteger(row.runId)) continue
        taskLedger[taskKey] = {
          runId: row.runId as number,
          status: typeof row.status === 'string' ? row.status : '',
          idempotencyKey: isSha256Hash(row.idempotencyKey) ? row.idempotencyKey : null,
          candidateHash: isSha256Hash(row.candidateHash) ? row.candidateHash : null,
          terminalReceiptHash: isSha256Hash(row.terminalReceiptHash) ? row.terminalReceiptHash : null,
        }
      }
    }
  } catch { /* invalid ledger is represented by an empty proof */ }
  return { build, plan, rootRunId, taskLedger }
}

interface GovernanceArtifactClosureV1 {
  builds: Array<ProductBuildRecordV1 & { id: number }>
  currentArtifacts: ProductBuildArtifactRecordV1[]
  lineageArtifacts: ProductBuildArtifactRecordV1[]
}

function artifactGovernanceJsonBytes(row: ProductBuildArtifactRecordV1): number {
  return agentRunUtf8ByteLengthV1(row.payloadJson)
    + agentRunUtf8ByteLengthV1(row.metadataJson)
    + agentRunUtf8ByteLengthV1(row.qualityJson)
    + agentRunUtf8ByteLengthV1(row.rightsJson)
}

/**
 * Reads every bounded Artifact version owned by the current Build so the Creator can
 * inspect stale/invalid history, plus only the exact older-Build rows named by carriedFrom.
 * This avoids materializing abandoned Builds while preserving byte-for-byte lineage proof.
 */
async function readGovernanceArtifactClosureV1(input: {
  scope: WorkspaceScope
  productionId: number
  build: ProductBuildRecordV1 & { id: number }
}): Promise<GovernanceArtifactClosureV1> {
  const currentArtifacts: ProductBuildArtifactRecordV1[] = []
  const lineageArtifacts: ProductBuildArtifactRecordV1[] = []
  const artifactsByLocator = new Map<string, ProductBuildArtifactRecordV1>()
  const retainedRows = new Set<string>()
  let currentActiveCount = 0
  let currentJsonBytes = 0
  let lineageJsonBytes = 0
  const retain = (row: ProductBuildArtifactRecordV1, current: boolean) => {
    if (!isExactArtifactScope(input.scope, row)
      || (current && row.buildId !== input.build.id)) {
      throw new Error('[text-open-world-artifact-governance] Artifact 作用域完整性错误')
    }
    const retainedKey = row.id == null
      ? `${row.buildId}:${row.artifactKey}:${row.version}:${row.createdAt}:${row.updatedAt}`
      : `id:${row.id}`
    if (retainedRows.has(retainedKey)) return
    retainedRows.add(retainedKey)
    const locator = `${row.buildId}:${row.artifactKey}:${row.version}`
    if (lineageArtifacts.length >= MAX_LINEAGE_ARTIFACT_ROWS) {
      throw new Error('[text-open-world-artifact-governance] carried lineage 行数超过浏览安全上限')
    }
    const bytes = artifactGovernanceJsonBytes(row)
    lineageJsonBytes += bytes
    if (lineageJsonBytes > MAX_LINEAGE_GOVERNANCE_JSON_BYTES) {
      throw new Error('[text-open-world-artifact-governance] carried lineage 治理 JSON 超过 512 MiB 安全上限')
    }
    if (current) {
      currentJsonBytes += bytes
      if (row.controlEpoch === input.build.controlEpoch
        && ACTIVE_ARTIFACT_STATUSES.has(row.status)) currentActiveCount += 1
      if (currentActiveCount > MAX_CURRENT_ACTIVE_ARTIFACT_ROWS) {
        throw new Error('[text-open-world-artifact-governance] 当前 Build active Artifact 数超过安全上限')
      }
      if (currentJsonBytes > MAX_CURRENT_GOVERNANCE_JSON_BYTES) {
        throw new Error('[text-open-world-artifact-governance] 当前 Build 治理 JSON 超过 256 MiB 安全上限')
      }
    }
    if (!artifactsByLocator.has(locator)) artifactsByLocator.set(locator, row)
    lineageArtifacts.push(row)
  }
  const currentRows = await db.productBuildArtifacts
    .where('buildId')
    .equals(input.build.id)
    .reverse()
    .limit(MAX_CURRENT_BUILD_ARTIFACT_ROWS + 1)
    .toArray()
  if (currentRows.length > MAX_CURRENT_BUILD_ARTIFACT_ROWS) {
    throw new Error('[text-open-world-artifact-governance] 当前 Build Artifact 历史数超过安全上限')
  }
  for (const row of currentRows) {
    currentArtifacts.push(row)
    retain(row, true)
  }

  const buildsByNumber = new Map<number, ProductBuildRecordV1 & { id: number }>([
    [input.build.buildNumber, input.build],
  ])
  const loadedSealedParentArtifacts = new Set<number>()
  const retainSealedParentActiveRows = async (parentBuild: ProductBuildRecordV1 & { id: number }) => {
    if (parentBuild.id === input.build.id || loadedSealedParentArtifacts.has(parentBuild.id)) return
    loadedSealedParentArtifacts.add(parentBuild.id)
    const rows = await db.productBuildArtifacts
      .where('buildId')
      .equals(parentBuild.id)
      .limit(MAX_CURRENT_BUILD_ARTIFACT_ROWS + 1)
      .toArray()
    if (rows.length > MAX_CURRENT_BUILD_ARTIFACT_ROWS) {
      throw new Error('[text-open-world-artifact-governance] carriedFrom 父 Build Artifact 数超过安全上限')
    }
    for (const row of rows) {
      if (row.controlEpoch === parentBuild.controlEpoch
        && ACTIVE_ARTIFACT_STATUSES.has(row.status)) retain(row, false)
    }
  }
  const pending = currentArtifacts
    .filter(row => row.controlEpoch === input.build.controlEpoch
      && row.status === 'carried-forward' && isSafeCarriedArtifactRefV1(row.carriedFrom))
    .map(row => ({ ref: row.carriedFrom!, depth: 1 }))
  const visited = new Set<string>()
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const { ref, depth } = pending[cursor]
    if (depth > MAX_LINEAGE_DEPTH) {
      throw new Error('[text-open-world-artifact-governance] carried lineage 深度超过 64 层安全上限')
    }
    const refKey = `${ref.buildNumber}:${ref.artifactKey}:${ref.version}:${ref.contentHash}`
    if (visited.has(refKey)) continue
    visited.add(refKey)
    let parentBuild = buildsByNumber.get(ref.buildNumber)
    if (!parentBuild) {
      const found = await db.productBuilds
        .where('[productionId+buildNumber]')
        .equals([input.productionId, ref.buildNumber])
        .first()
      if (!found || found.id == null || found.productionId !== input.productionId
        || found.projectId !== input.scope.projectId || found.worldId !== input.scope.worldId
        || found.workId !== input.scope.workId) continue
      if (buildsByNumber.size >= MAX_LINEAGE_BUILD_ROWS) {
        throw new Error('[text-open-world-artifact-governance] carried lineage Build 数超过浏览安全上限')
      }
      parentBuild = found as ProductBuildRecordV1 & { id: number }
      buildsByNumber.set(found.buildNumber, parentBuild)
    }
    await retainSealedParentActiveRows(parentBuild)
    const locator = `${parentBuild.id}:${ref.artifactKey}:${ref.version}`
    let parent = artifactsByLocator.get(locator)
    if (!parent) {
      parent = await db.productBuildArtifacts
        .where('[buildId+artifactKey+version]')
        .equals([parentBuild.id, ref.artifactKey, ref.version])
        .first()
      if (!parent) continue
      if (!isExactArtifactScope(input.scope, parent) || parent.buildId !== parentBuild.id) {
        throw new Error('[text-open-world-artifact-governance] carriedFrom 父 Artifact 作用域完整性错误')
      }
      retain(parent, false)
    }
    if (isSafeCarriedArtifactRefV1(parent.carriedFrom)) {
      pending.push({ ref: parent.carriedFrom, depth: depth + 1 })
    }
  }
  return {
    builds: [...buildsByNumber.values()].sort((left, right) => left.buildNumber - right.buildNumber),
    currentArtifacts,
    lineageArtifacts,
  }
}

async function loadGovernanceRunEvidenceV1(input: {
  scope: WorkspaceScope
  currentBuildId: number
  artifacts: ProductBuildArtifactRecordV1[]
  buildEvidence: TextOpenWorldArtifactBuildEvidenceV1[]
}): Promise<Map<number, TextOpenWorldArtifactRunEvidenceV1>> {
  const requested = new Set<number>()
  for (const row of input.artifacts) if (row.producerRunId != null) requested.add(row.producerRunId)
  for (const evidence of input.buildEvidence) if (evidence.rootRunId != null) requested.add(evidence.rootRunId)
  const currentRuns = new Set(input.artifacts
    .filter(row => row.buildId === input.currentBuildId && row.producerRunId != null)
    .map(row => row.producerRunId!))
  const currentRootRunId = input.buildEvidence.find(row => row.build.id === input.currentBuildId)?.rootRunId
  if (currentRootRunId != null) currentRuns.add(currentRootRunId)
  if (currentRuns.size > MAX_CURRENT_GOVERNANCE_RUNS) {
    throw new Error('[text-open-world-artifact-governance] 当前 Build Run 数超过安全上限')
  }
  const firstRead = await loadRunEvidence(input.scope, [...requested])
  const first = firstRead.evidence
  const parentRunIds = [...first.values()]
    .flatMap(row => row.parentRunId == null || first.has(row.parentRunId) ? [] : [row.parentRunId])
  if (first.size + new Set(parentRunIds).size > MAX_GOVERNANCE_RUNS) {
    throw new Error('[text-open-world-artifact-governance] 治理谱系 Run 数超过安全上限')
 }
  const parentsRead = await loadRunEvidence(
    input.scope,
    [...new Set(parentRunIds)],
    MAX_GOVERNANCE_CHECKPOINT_BYTES - firstRead.checkpointBytes,
    MAX_GOVERNANCE_RUN_EVENT_BYTES - firstRead.runEventBytes,
  )
  for (const [runId, evidence] of parentsRead.evidence) first.set(runId, evidence)
  return first
}

async function loadGovernanceRunFingerprintsV1(input: {
  runIds: number[]
  maximumCheckpointBytes?: number
  maximumRunEventBytes?: number
}): Promise<GovernanceRunFingerprintV1[]> {
  const runIds = [...new Set(input.runIds)].sort((left, right) => left - right)
  if (runIds.length > MAX_GOVERNANCE_RUNS) {
    throw new Error('[text-open-world-artifact-governance] 治理谱系 Run 数超过安全上限')
  }
  const eventRead = await preflightGovernanceRunBytesV1(
    runIds,
    input.maximumRunEventBytes ?? MAX_GOVERNANCE_RUN_EVENT_BYTES,
  )
  const headers = await loadLatestCheckpointHeadersV1(
    runIds,
    input.maximumCheckpointBytes ?? MAX_GOVERNANCE_CHECKPOINT_BYTES,
  )
  const fingerprints: GovernanceRunFingerprintV1[] = []
  for (const runId of runIds) {
    const row = await db.agentRuns.get(runId)
    fingerprints.push(await fingerprintFromRawRun(
      runId,
      row == null ? undefined : row as AgentRunRecord & { id: number },
      headers.byRunId.get(runId) ?? null,
      eventRead.eventStreams.get(runId)!,
    ))
  }
  return fingerprints
}

async function governanceReadSetHash(input: {
  production: ProductProductionRecordV1 & { id: number }
  builds: Array<ProductBuildRecordV1 & { id: number }>
  artifacts: ProductBuildArtifactRecordV1[]
  runFingerprints: GovernanceRunFingerprintV1[]
  blobRows: Array<(MediaBlobObjectRecordV1 & { id: number }) | undefined>
  blobPhysicalFingerprints: GovernanceBlobPhysicalFingerprintV1[]
  authorityEvidenceHash: string
}): Promise<string> {
  return hashProductProductionValueV2({
    // Bind the complete row: productionKey/title/controlEpoch and the creator
    // source locator all affect the returned projection or its authority.
    production: { ...input.production, id: input.production.id },
    builds: input.builds.map(row => ({ ...row, id: row.id }))
      .sort((left, right) => left.id - right.id),
    artifacts: input.artifacts.map(row => ({
      ...row, id: row.id ?? null,
    })).sort((left, right) => (left.id ?? -1) - (right.id ?? -1)),
    runs: [...input.runFingerprints].sort((left, right) => left.runId - right.runId),
    authorityEvidenceHash: input.authorityEvidenceHash,
    blobPhysicalFingerprints: [...input.blobPhysicalFingerprints]
      .sort((left, right) => left.blobId - right.blobId),
    blobs: input.blobRows.filter((row): row is MediaBlobObjectRecordV1 & { id: number } => row != null)
      .map(row => ({
        id: row.id, projectId: row.projectId, worldId: row.worldId, workId: row.workId,
        contentHash: row.contentHash, mimeType: row.mimeType, byteSize: row.byteSize,
        storageState: row.storageState, backend: row.backend, opfsPath: row.opfsPath,
        updatedAt: row.updatedAt,
      })).sort((left, right) => left.id - right.id),
  })
}

/**
 * Reads only the current Build selected by the exact Production. A caller
 * cannot use this endpoint to switch to another Work or an older Build.
 */
export async function readTextOpenWorldArtifactGovernanceV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<TextOpenWorldArtifactGovernanceProjectionV1> {
  const scope = await resolveScope({ scope: input.scope })
  const production = await db.productProductions.get(input.productionId)
  if (!production || production.id == null
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'text-open-world') {
    throw new Error('[text-open-world-artifact-governance] Production 不存在、跨 Work 或产品类型错误')
  }
  if (production.currentBuildNumber == null) {
    throw new Error('[text-open-world-artifact-governance] 当前 Production 尚无 Build')
  }
  const build = await db.productBuilds
    .where('[productionId+buildNumber]')
    .equals([production.id, production.currentBuildNumber])
    .first()
  if (!build || build.id == null
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || build.productionId !== production.id) {
    throw new Error('[text-open-world-artifact-governance] 当前 Build 不存在或作用域不闭合')
  }
  const plan = parseProductProductionPlanV3(build.planJson, undefined, build.briefHash)
  const productionAuthority = await readTextOpenWorldProductionPlanAuthorityV1({
    scope,
    productionId: production.id,
    buildId: build.id,
  })
  const closure = await readGovernanceArtifactClosureV1({
    scope,
    productionId: production.id,
    build: build as ProductBuildRecordV1 & { id: number },
  })
  const artifactRows = closure.currentArtifacts
  const lineageArtifactRows = closure.lineageArtifacts
  const buildEvidenceRows = closure.builds.map(parseBuildEvidence)
  const buildEvidenceById = new Map(buildEvidenceRows.map(row => [row.build.id, row]))
  const runEvidenceById = await loadGovernanceRunEvidenceV1({
    scope,
    currentBuildId: build.id,
    artifacts: lineageArtifactRows,
    buildEvidence: buildEvidenceRows,
  })
  const blobIds = [...new Set(lineageArtifactRows
    .map(row => row.blobObjectId)
    .filter((id): id is number => id != null))]
  const blobRows = blobIds.length ? await db.mediaBlobObjects.bulkGet(blobIds) : []
  const initialBlobVerification = await verifyGovernanceBlobRowsV1({
    scope,
    rows: blobRows as Array<(MediaBlobObjectRecordV1 & { id: number }) | undefined>,
  })
  const blobEvidenceById = initialBlobVerification.evidenceById
  const initialRunFingerprints = [...runEvidenceById.values()]
    .map(fingerprintFromEvidence)
  const initialReadSetHash = await governanceReadSetHash({
    production: production as ProductProductionRecordV1 & { id: number },
    builds: closure.builds,
    artifacts: lineageArtifactRows,
    runFingerprints: initialRunFingerprints,
    blobRows: blobRows as Array<(MediaBlobObjectRecordV1 & { id: number }) | undefined>,
    blobPhysicalFingerprints: initialBlobVerification.fingerprints,
    authorityEvidenceHash: productionAuthority.evidenceHash,
  })
  const projection = await projectTextOpenWorldArtifactGovernanceTrustedV1({
    scope, production: production as ProductProductionRecordV1 & { id: number },
    build: build as ProductBuildRecordV1 & { id: number }, plan,
    artifactRows, lineageArtifactRows, buildEvidenceById, runEvidenceById, blobEvidenceById,
  }, productionAuthority.authority)
  const currentProduction = await db.productProductions.get(production.id)
  if (!currentProduction || currentProduction.id == null
    || currentProduction.productType !== 'text-open-world'
    || currentProduction.currentBuildNumber !== production.currentBuildNumber
    || !await assertRecordInScope(scope, 'productProductions', currentProduction, { owner: 'work' })) {
    throw new Error('[text-open-world-artifact-governance] 读取期间 Production 已变化')
  }
  const currentBuild = await db.productBuilds.get(build.id)
  if (!currentBuild || currentBuild.id == null || currentBuild.productionId !== production.id
    || currentBuild.buildNumber !== production.currentBuildNumber
    || !await assertRecordInScope(scope, 'productBuilds', currentBuild, { owner: 'work' })) {
    throw new Error('[text-open-world-artifact-governance] 读取期间当前 Build 已变化')
  }
  const tailClosure = await readGovernanceArtifactClosureV1({
    scope,
    productionId: production.id,
    build: currentBuild as ProductBuildRecordV1 & { id: number },
  })
  const tailProductionAuthority = await readTextOpenWorldProductionPlanAuthorityV1({
    scope,
    productionId: currentProduction.id,
    buildId: currentBuild.id,
  })
  const tailRunFingerprints = await loadGovernanceRunFingerprintsV1({
    runIds: initialRunFingerprints.map(row => row.runId),
  })
  const tailBlobIds = [...new Set(tailClosure.lineageArtifacts
    .flatMap(row => row.blobObjectId == null ? [] : [row.blobObjectId]))]
  const tailBlobRows = tailBlobIds.length ? await db.mediaBlobObjects.bulkGet(tailBlobIds) : []
  const tailBlobVerification = await verifyGovernanceBlobRowsV1({
    scope,
    rows: tailBlobRows as Array<(MediaBlobObjectRecordV1 & { id: number }) | undefined>,
  })
  const tailReadSetHash = await governanceReadSetHash({
    production: currentProduction as ProductProductionRecordV1 & { id: number },
    builds: tailClosure.builds,
    artifacts: tailClosure.lineageArtifacts,
    runFingerprints: tailRunFingerprints,
    blobRows: tailBlobRows as Array<(MediaBlobObjectRecordV1 & { id: number }) | undefined>,
    blobPhysicalFingerprints: tailBlobVerification.fingerprints,
    authorityEvidenceHash: tailProductionAuthority.evidenceHash,
  })
  if (tailReadSetHash !== initialReadSetHash) {
    throw new Error('[text-open-world-artifact-governance] 读取期间治理快照已变化，请刷新')
  }
  return projection
}
