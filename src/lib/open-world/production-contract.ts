import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1 } from '../agent/run/checkpoint-contract'
import type {
  ProductBuildArtifactKindV1,
  ProductProductionBriefV3,
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
  ProductTaskBudgetReservationV1,
  TextOpenWorldProductionArtifactDefinitionV1,
  TextOpenWorldProductionArtifactKindV1,
  TextOpenWorldProductionRunContractBlueprintV1,
  TextOpenWorldProductionStageV1,
  TextOpenWorldProductionTaskContractV1,
} from '../types'
import {
  TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_KINDS_V1,
  TEXT_OPEN_WORLD_PRODUCTION_STAGES_V1,
} from '../types'
import { TEXT_OPEN_WORLD_SOURCE_PIN_LIMITS_V1 } from './source-pin-contract'

const REQUIRED_STALE_WATCHES = [
  'sourcePinHash', 'briefHash', 'planHash', 'controlEpoch', 'inputArtifactHashes',
] as const
const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

/** Keep the Creator handoff and P0 reservation on the same acceptance boundary
 * as the immutable SourcePin implementation. */
export const TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1 = Object.freeze({
  ...TEXT_OPEN_WORLD_SOURCE_PIN_LIMITS_V1,
  maximumCheckpointResumePayloadBytes: AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1,
})

// P0's durable candidate contains every unit payload, the closure Pin refs,
// Artifact envelopes and the scheduler candidate envelope. JSON may expand
// one UTF-16 code unit to a six-byte escape. Each legal label can occur in both
// the unit payload and Pin ref, so 16 KiB/unit deliberately dominates two
// worst-case 1,000-character escaped labels plus keys, hashes, counters,
// quality and rights. The fixed envelope covers source/authorization metadata,
// evidence, candidate fields and structural punctuation.
const SOURCE_LOCK_JSON_BYTES_PER_CHAR = 6
const SOURCE_LOCK_UNIT_ENVELOPE_BYTES = 16 * 1024
const SOURCE_LOCK_FIXED_ENVELOPE_BYTES = 256 * 1024

function fail(message: string): never {
  throw new Error(`[text-open-world-production] ${message}`)
}

function modelTask(input: Omit<TextOpenWorldProductionTaskContractV1,
  'lane' | 'executionMode' | 'contextSourceKeys' | 'writeTarget' | 'budgetClass'
  | 'recommendedModelCalls' | 'tokenBudgetWeight' | 'durationBudgetWeight'
  | 'retryPolicy' | 'stalePolicy' | 'failurePolicy' | 'timeoutMs'>
  & {
    lane?: TextOpenWorldProductionTaskContractV1['lane']
    recommendedModelCalls?: number
    tokenBudgetWeight?: number
    durationBudgetWeight?: number
    timeoutMs?: number
  },
): TextOpenWorldProductionTaskContractV1 {
  return {
    ...input,
    lane: input.lane ?? 'content',
    executionMode: 'model',
    contextSourceKeys: ['product-production.brief', 'product-production.artifact-inputs'],
    writeTarget: {
      table: 'productBuildArtifacts', fields: ['payloadJson'],
      adoptionExtension: 'product-production-artifacts',
    },
    budgetClass: 'model',
    recommendedModelCalls: input.recommendedModelCalls ?? 3,
    tokenBudgetWeight: input.tokenBudgetWeight ?? input.recommendedModelCalls ?? 3,
    durationBudgetWeight: input.durationBudgetWeight ?? 2,
    retryPolicy: {
      maxAttempts: 2,
      retryableFailures: ['transport', 'rate-limit', 'protocol', 'schema-repair'],
      nonRetryableFailures: ['authorization', 'insufficient-balance', 'stale', 'unknown-result'],
      repairMode: 'bounded-local-repair',
    },
    stalePolicy: {
      watches: [...REQUIRED_STALE_WATCHES], propagation: 'transitive-downstream',
      onChange: 'pause-for-author', staleCandidatePolicy: 'view-only-rebuild-required',
    },
    failurePolicy: 'pause',
    timeoutMs: input.timeoutMs ?? 300_000,
  }
}

function deterministicTask(input: Omit<TextOpenWorldProductionTaskContractV1,
  'lane' | 'executionMode' | 'skillId' | 'contextSourceKeys' | 'writeTarget'
  | 'budgetClass' | 'recommendedModelCalls' | 'tokenBudgetWeight' | 'durationBudgetWeight'
  | 'retryPolicy' | 'stalePolicy'
  | 'failurePolicy' | 'timeoutMs'>
  & { lane?: TextOpenWorldProductionTaskContractV1['lane']; timeoutMs?: number },
): TextOpenWorldProductionTaskContractV1 {
  return {
    ...input,
    lane: input.lane ?? 'integration',
    executionMode: 'deterministic',
    skillId: null,
    contextSourceKeys: ['product-production.brief', 'product-production.artifact-inputs'],
    writeTarget: {
      table: 'productBuildArtifacts', fields: ['payloadJson', 'qualityJson'],
      adoptionExtension: 'product-production-artifacts',
    },
    budgetClass: 'deterministic',
    recommendedModelCalls: 0,
    tokenBudgetWeight: 0,
    durationBudgetWeight: 1,
    retryPolicy: {
      maxAttempts: 1,
      retryableFailures: [],
      nonRetryableFailures: ['authorization', 'insufficient-balance', 'stale', 'unknown-result'],
      repairMode: 'none',
    },
    stalePolicy: {
      watches: [...REQUIRED_STALE_WATCHES], propagation: 'transitive-downstream',
      onChange: 'pause-for-author', staleCandidatePolicy: 'view-only-rebuild-required',
    },
    failurePolicy: 'fail-build',
    timeoutMs: input.timeoutMs ?? 120_000,
  }
}

/**
 * P0-P10 compiler topology. Outputs that must be co-designed share one durable
 * bounded Run; they remain separate immutable Artifacts so later local repair
 * can invalidate only the dependent subgraph. A Run may consume several model
 * calls within its frozen reservation (for example one call per region).
 */
export const TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1: TextOpenWorldProductionTaskContractV1[] = [
  deterministicTask({
    stage: 'P0', taskKey: 'p0.source-lock', objective: '把已授权世界版本或小说来源冻结为可验证 SourcePin。',
    dependsOn: [], inputArtifactKeys: [],
    outputArtifactKeys: ['text-open-world.source-pin', 'text-open-world.source-pin-unit'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.source-pin.schema', 'tow.source-pin.hash', 'tow.source-pin.authorization'],
    },
  }),
  modelTask({
    stage: 'P1', taskKey: 'p1.source-curation', objective: '渐进读取来源并形成清单、证据账本和显式缺口。',
    skillId: 'text-open-world.production.source-curation.v1', recommendedModelCalls: 6,
    durationBudgetWeight: 8,
    dependsOn: ['p0.source-lock'],
    inputArtifactKeys: ['text-open-world.source-pin', 'text-open-world.source-pin-unit'],
    outputArtifactKeys: [
      'text-open-world.source-manifest', 'text-open-world.source-ledger', 'text-open-world.source-gap-report',
    ],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.source.coverage', 'tow.source.evidence', 'tow.source.unread-explicit'],
    },
  }),
  modelTask({
    stage: 'P2', taskKey: 'p2.experience-design', objective: '把用户会谈与来源约束编译成游戏体验合同和主角身份资产。',
    skillId: 'text-open-world.production.experience-design.v1', recommendedModelCalls: 1, tokenBudgetWeight: 4,
    dependsOn: ['p1.source-curation'],
    inputArtifactKeys: [
      'text-open-world.source-pin', 'text-open-world.source-manifest',
      'text-open-world.source-ledger', 'text-open-world.source-gap-report',
    ],
    outputArtifactKeys: [
      'text-open-world.game-brief', 'text-open-world.experience-contract',
      'text-open-world.protagonist-asset',
    ],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.experience.user-confirmed', 'tow.experience.boundaries', 'tow.protagonist.identity'],
    },
  }),
  modelTask({
    stage: 'P2', taskKey: 'p2.gameplay-ruleset', objective: '冻结属性、成长、战斗、装备、经济和Effect白名单的玩法骨架。',
    skillId: 'text-open-world.production.gameplay-ruleset.v1', recommendedModelCalls: 1, tokenBudgetWeight: 3,
    dependsOn: ['p1.source-curation', 'p2.experience-design'],
    inputArtifactKeys: [
      'text-open-world.source-ledger', 'text-open-world.game-brief',
      'text-open-world.experience-contract', 'text-open-world.protagonist-asset',
    ],
    outputArtifactKeys: ['text-open-world.gameplay-ruleset-skeleton'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.ruleset.skeleton', 'tow.ruleset.effect-whitelist', 'tow.ruleset.g2-compatible'],
    },
  }),
  modelTask({
    stage: 'P2', taskKey: 'p2.presentation-profile', objective: '冻结UI主题、消费槽、媒资层级和文字降级表现口径。',
    skillId: 'text-open-world.production.presentation-profile.v1', recommendedModelCalls: 1,
    dependsOn: ['p2.experience-design'],
    inputArtifactKeys: ['text-open-world.game-brief', 'text-open-world.experience-contract'],
    outputArtifactKeys: ['text-open-world.presentation-profile'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.presentation.profile', 'tow.presentation.consumer-slots', 'tow.presentation.text-fallback'],
    },
  }),
  modelTask({
    stage: 'P3', taskKey: 'p3.story-architecture', objective: '设计核心冲突、叙事承诺、长程故事弧和多个合规结局。',
    skillId: 'text-open-world.production.story-architecture.v1', recommendedModelCalls: 1, tokenBudgetWeight: 8,
    dependsOn: ['p2.experience-design'],
    inputArtifactKeys: [
      'text-open-world.game-brief', 'text-open-world.experience-contract',
      'text-open-world.protagonist-asset', 'text-open-world.source-ledger',
      'text-open-world.source-gap-report',
    ],
    outputArtifactKeys: [
      'text-open-world.story-arc', 'text-open-world.ending-contracts', 'text-open-world.narrative-promises',
    ],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.story.core-goal', 'tow.story.endings', 'tow.story.promise-callback'],
    },
  }),
  modelTask({
    stage: 'P4', taskKey: 'p4.region-skeleton', objective: '从来源和故事需要建立完整地区、地点需求和初始空间骨架。',
    skillId: 'text-open-world.production.region-skeleton.v1', recommendedModelCalls: 1, tokenBudgetWeight: 6,
    dependsOn: ['p1.source-curation', 'p2.experience-design', 'p3.story-architecture'],
    inputArtifactKeys: [
      'text-open-world.game-brief', 'text-open-world.source-manifest', 'text-open-world.source-ledger',
      'text-open-world.experience-contract', 'text-open-world.story-arc',
    ],
    outputArtifactKeys: ['text-open-world.region-skeleton'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.regions.source-or-story-need', 'tow.regions.connected', 'tow.regions.early-arrival-safe'],
    },
  }),
  modelTask({
    stage: 'P4', taskKey: 'p4.player-build', objective: '把主角身份编译为满足玩法骨架的合法初始成长配置。',
    skillId: 'text-open-world.production.player-build.v1', recommendedModelCalls: 1, tokenBudgetWeight: 3,
    dependsOn: ['p2.experience-design', 'p2.gameplay-ruleset'],
    inputArtifactKeys: [
      'text-open-world.game-brief', 'text-open-world.protagonist-asset', 'text-open-world.experience-contract',
      'text-open-world.gameplay-ruleset-skeleton',
    ],
    outputArtifactKeys: ['text-open-world.player-build'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.player-build.schema', 'tow.player-build.ruleset-compatible'],
    },
  }),
  modelTask({
    stage: 'P5', taskKey: 'p5.mainline', objective: '形成严格顺序、可等待、可恢复且不能被普通状态锁死的主线。',
    skillId: 'text-open-world.production.mainline.v1', recommendedModelCalls: 1, tokenBudgetWeight: 10,
    dependsOn: ['p2.gameplay-ruleset', 'p3.story-architecture', 'p4.region-skeleton', 'p4.player-build'],
    inputArtifactKeys: [
      'text-open-world.game-brief', 'text-open-world.gameplay-ruleset-skeleton',
      'text-open-world.story-arc', 'text-open-world.ending-contracts',
      'text-open-world.narrative-promises', 'text-open-world.region-skeleton',
      'text-open-world.player-build',
    ],
    outputArtifactKeys: ['text-open-world.mainline-thread'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.mainline.strict-order', 'tow.mainline.reachable', 'tow.mainline.protected-wait'],
    },
  }),
  modelTask({
    stage: 'P6', taskKey: 'p6.significant-threads', objective: '生产角色、势力与地区拥有的重要故事线及其局部后果。',
    skillId: 'text-open-world.production.significant-threads.v1', recommendedModelCalls: 1, tokenBudgetWeight: 12,
    dependsOn: ['p1.source-curation', 'p3.story-architecture', 'p4.region-skeleton', 'p5.mainline'],
    inputArtifactKeys: [
      'text-open-world.game-brief', 'text-open-world.source-ledger',
      'text-open-world.story-arc', 'text-open-world.ending-contracts',
      'text-open-world.narrative-promises', 'text-open-world.region-skeleton',
      'text-open-world.mainline-thread',
    ],
    outputArtifactKeys: ['text-open-world.significant-threads'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.significant.owner-coverage', 'tow.significant.mainline-compatible', 'tow.significant.local-consequences'],
    },
  }),
  modelTask({
    stage: 'P7', taskKey: 'p7.region-narrative-packs', objective: '为每个地区补齐矛盾、角色层级、任务母题、传闻和事件供给。',
    skillId: 'text-open-world.production.region-narrative-packs.v1', recommendedModelCalls: 1, tokenBudgetWeight: 16,
    dependsOn: ['p1.source-curation', 'p2.experience-design', 'p4.region-skeleton', 'p5.mainline', 'p6.significant-threads'],
    inputArtifactKeys: [
      'text-open-world.game-brief', 'text-open-world.experience-contract',
      'text-open-world.source-ledger', 'text-open-world.region-skeleton',
      'text-open-world.mainline-thread', 'text-open-world.significant-threads',
    ],
    outputArtifactKeys: ['text-open-world.region-narrative-packs'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.regions.story-coverage', 'tow.regions.distinctiveness', 'tow.regions.content-supply'],
    },
  }),
  modelTask({
    stage: 'P8', taskKey: 'p8.quest-skeletons', objective: '先以体验和玩法需求描述任务，不引用尚未生产的具体目录项。',
    skillId: 'text-open-world.production.quest-skeletons.v1', recommendedModelCalls: 1, tokenBudgetWeight: 8,
    dependsOn: [
      'p2.experience-design', 'p2.gameplay-ruleset', 'p5.mainline',
      'p6.significant-threads', 'p7.region-narrative-packs',
    ],
    inputArtifactKeys: [
      'text-open-world.game-brief', 'text-open-world.experience-contract',
      'text-open-world.gameplay-ruleset-skeleton',
      'text-open-world.mainline-thread', 'text-open-world.significant-threads',
      'text-open-world.region-narrative-packs',
    ],
    outputArtifactKeys: ['text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.quests.story-motivation', 'tow.quests.requirement-complete', 'tow.quests.no-premature-references'],
    },
  }),
  modelTask({
    stage: 'P8', taskKey: 'p8.catalog.progression', objective: '生产成长、属性和技能目录，满足任务需求与等级节奏。',
    skillId: 'text-open-world.production.progression-catalogs.v1', recommendedModelCalls: 1, tokenBudgetWeight: 6,
    dependsOn: ['p2.gameplay-ruleset', 'p4.player-build', 'p8.quest-skeletons'],
    inputArtifactKeys: [
      'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.player-build',
      'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
    ],
    outputArtifactKeys: ['text-open-world.progression-catalogs'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.catalog.progression-schema', 'tow.catalog.progression-curve', 'tow.catalog.skill-sources'],
    },
  }),
  modelTask({
    stage: 'P8', taskKey: 'p8.catalog.encounters', objective: '生产敌人和遭遇目录，满足地区语义、任务需求和成长曲线。',
    // Encounter generation consumes every playable quest requirement and the
    // full regional inventory; size this lane for the accepted Creator scale,
    // not the earlier 6-quest prototype fixture.
    skillId: 'text-open-world.production.encounter-catalog.v1', recommendedModelCalls: 1, tokenBudgetWeight: 9,
    dependsOn: [
      'p2.gameplay-ruleset', 'p4.player-build', 'p7.region-narrative-packs',
      'p8.quest-skeletons', 'p8.catalog.progression',
    ],
    inputArtifactKeys: [
      'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.player-build',
      'text-open-world.region-narrative-packs', 'text-open-world.quest-skeletons',
      'text-open-world.content-requirement-manifest',
      'text-open-world.progression-catalogs',
    ],
    outputArtifactKeys: ['text-open-world.enemy-encounter-catalog'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.catalog.enemy-schema', 'tow.catalog.encounter-coverage', 'tow.catalog.encounter-curve'],
    },
  }),
  modelTask({
    stage: 'P8', taskKey: 'p8.catalog.items-rewards', objective: '生产物品、装备、掉落和奖励目录并闭合任务及成长预算。',
    // The formal Creator inventory carries every quest reward, encounter drop
    // and the complete 8/4/5/2 equipment-consumable-material-key-item floor.
    // Keep its exact structured context above that accepted content ceiling.
    skillId: 'text-open-world.production.item-reward-catalog.v1', recommendedModelCalls: 1, tokenBudgetWeight: 9,
    dependsOn: [
      'p2.gameplay-ruleset', 'p4.player-build', 'p8.quest-skeletons',
      'p8.catalog.progression', 'p8.catalog.encounters',
    ],
    inputArtifactKeys: [
      'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.player-build',
      'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
      'text-open-world.progression-catalogs',
      'text-open-world.enemy-encounter-catalog',
    ],
    outputArtifactKeys: ['text-open-world.item-reward-catalog'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.catalog.item-schema', 'tow.catalog.reward-budget', 'tow.catalog.item-sources'],
    },
  }),
  modelTask({
    stage: 'P8', taskKey: 'p8.catalog.crafting-economy', objective: '生产配方、商店、货币流和价格目录并闭合资源来源与消耗。',
    skillId: 'text-open-world.production.crafting-economy-catalog.v1', recommendedModelCalls: 1, tokenBudgetWeight: 8,
    dependsOn: ['p2.gameplay-ruleset', 'p7.region-narrative-packs', 'p8.quest-skeletons', 'p8.catalog.items-rewards'],
    inputArtifactKeys: [
      'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.region-narrative-packs',
      'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
      'text-open-world.item-reward-catalog',
    ],
    outputArtifactKeys: ['text-open-world.crafting-economy-catalog'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.catalog.crafting-schema', 'tow.catalog.economy-loop', 'tow.catalog.no-risk-arbitrage'],
    },
  }),
  modelTask({
    stage: 'P8', taskKey: 'p8.catalog.npc-runtime', objective: '生产角色层级、日程、服务、关系和死亡替代运行规则。',
    skillId: 'text-open-world.production.npc-runtime-catalog.v1', recommendedModelCalls: 1, tokenBudgetWeight: 8,
    dependsOn: ['p2.gameplay-ruleset', 'p7.region-narrative-packs', 'p8.quest-skeletons', 'p8.catalog.crafting-economy'],
    inputArtifactKeys: [
      'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.region-narrative-packs',
      'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
      'text-open-world.crafting-economy-catalog',
    ],
    outputArtifactKeys: ['text-open-world.npc-runtime-catalog'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.catalog.npc-schema', 'tow.catalog.service-continuity', 'tow.catalog.story-protection'],
    },
  }),
  modelTask({
    stage: 'P8', taskKey: 'p8.catalog.map-interactions', objective: '生产地点交互、道路、旅行、快速旅行和程序地图绑定目录。',
    // This compiler consumes the full regional pack plus every quest/location
    // requirement. Its context grows with the Creator-authored inventory, so
    // the old prototype weight could not carry even the accepted 8/5/16
    // campaign profile without truncating an authoritative dependency.
    skillId: 'text-open-world.production.map-interaction-catalog.v1', recommendedModelCalls: 1, tokenBudgetWeight: 8,
    dependsOn: ['p4.region-skeleton', 'p7.region-narrative-packs', 'p8.quest-skeletons'],
    inputArtifactKeys: [
      'text-open-world.region-skeleton', 'text-open-world.region-narrative-packs',
      'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
    ],
    outputArtifactKeys: ['text-open-world.map-interaction-catalog'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.catalog.map-schema', 'tow.catalog.map-connected', 'tow.catalog.early-arrival-safe'],
    },
  }),
  modelTask({
    stage: 'P8F', taskKey: 'p8f.quest-finalize', objective: '把任务骨架绑定到真实Action、目录、奖励、失败和时间合同。',
    // P8F consumes the complete formal gameplay catalogs. The accepted
    // 8/4/5/2 item floor and three governed enemy families are part of that
    // atomic binding input, so this reservation covers the full Creator scale.
    skillId: 'text-open-world.production.quest-finalize.v1', recommendedModelCalls: 1, tokenBudgetWeight: 19,
    dependsOn: [
      'p5.mainline', 'p6.significant-threads', 'p7.region-narrative-packs', 'p8.quest-skeletons',
      'p8.catalog.progression', 'p8.catalog.encounters', 'p8.catalog.items-rewards',
      'p8.catalog.crafting-economy', 'p8.catalog.npc-runtime', 'p8.catalog.map-interactions',
    ],
    inputArtifactKeys: [
      'text-open-world.mainline-thread', 'text-open-world.significant-threads',
      'text-open-world.region-narrative-packs',
      'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
      'text-open-world.progression-catalogs', 'text-open-world.enemy-encounter-catalog',
      'text-open-world.item-reward-catalog', 'text-open-world.crafting-economy-catalog',
      'text-open-world.npc-runtime-catalog', 'text-open-world.map-interaction-catalog',
    ],
    outputArtifactKeys: ['text-open-world.quest-design-documents', 'text-open-world.director-decks'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.quests.references', 'tow.quests.lifecycle', 'tow.director.deck-budgets'],
    },
  }),
  modelTask({
    stage: 'P9', taskKey: 'p9.scene-scripts', objective: '生产场景、固定选项和系统Action绑定，保持三类交互同一结果源。',
    skillId: 'text-open-world.production.scene-scripts.v1', recommendedModelCalls: 161, tokenBudgetWeight: 26,
    durationBudgetWeight: 48,
    timeoutMs: 3_600_000,
    dependsOn: ['p7.region-narrative-packs', 'p8f.quest-finalize'],
    inputArtifactKeys: [
      'text-open-world.source-ledger', 'text-open-world.experience-contract',
      'text-open-world.story-arc', 'text-open-world.region-narrative-packs',
      'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
      'text-open-world.npc-runtime-catalog', 'text-open-world.map-interaction-catalog',
      'text-open-world.quest-design-documents', 'text-open-world.director-decks',
    ],
    outputArtifactKeys: [
      'text-open-world.scene-scripts', 'text-open-world.choice-contracts', 'text-open-world.action-bindings',
    ],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.scenes.knowledge-boundary', 'tow.scenes.choice-consequences', 'tow.scenes.single-action-source'],
    },
  }),
  modelTask({
    stage: 'P10', taskKey: 'p10.system-finalize', objective: '汇总系统配置、媒资槽和内容预算，证明体量与玩法闭环。',
    // P10 validates the complete playable closure (all catalogs, finalized
    // quests and scenes), so its exact structured input is comparable to P9,
    // not to a single early-stage design artifact.
    skillId: 'text-open-world.production.system-finalize.v1', recommendedModelCalls: 1, tokenBudgetWeight: 18,
    dependsOn: [
      'p2.experience-design', 'p2.gameplay-ruleset', 'p2.presentation-profile',
      'p4.player-build', 'p7.region-narrative-packs',
      'p8.catalog.progression', 'p8.catalog.encounters', 'p8.catalog.items-rewards',
      'p8.catalog.crafting-economy', 'p8.catalog.npc-runtime', 'p8.catalog.map-interactions',
      'p8f.quest-finalize', 'p9.scene-scripts',
    ],
    inputArtifactKeys: [
      'text-open-world.game-brief', 'text-open-world.experience-contract',
      'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.presentation-profile',
      'text-open-world.player-build', 'text-open-world.region-narrative-packs',
      'text-open-world.progression-catalogs', 'text-open-world.enemy-encounter-catalog',
      'text-open-world.item-reward-catalog', 'text-open-world.crafting-economy-catalog',
      'text-open-world.npc-runtime-catalog', 'text-open-world.map-interaction-catalog',
      'text-open-world.quest-design-documents',
      'text-open-world.director-decks', 'text-open-world.scene-scripts',
      'text-open-world.choice-contracts', 'text-open-world.action-bindings',
    ],
    outputArtifactKeys: [
      'text-open-world.system-configs', 'text-open-world.media-requirements', 'text-open-world.content-budget',
    ],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.system.closed-loop', 'tow.media.required-slots', 'tow.content.inventory-budget'],
    },
  }),
  deterministicTask({
    stage: 'V1', taskKey: 'v1.deterministic-preflight', objective: '执行Schema、引用、预算、可解性和G2运行模块预检。',
    lane: 'qa', dependsOn: ['p10.system-finalize'],
    inputArtifactKeys: [
      'text-open-world.system-configs', 'text-open-world.media-requirements', 'text-open-world.content-budget',
      'text-open-world.quest-design-documents', 'text-open-world.director-decks', 'text-open-world.scene-scripts',
      'text-open-world.choice-contracts', 'text-open-world.action-bindings',
    ],
    outputArtifactKeys: ['text-open-world.deterministic-preflight'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.preflight.schema', 'tow.preflight.references', 'tow.preflight.solvability'],
    },
  }),
  modelTask({
    stage: 'V2', taskKey: 'v2.balance-review', objective: '评审成长、遭遇、奖励、经济、可解性和内容供给平衡。',
    lane: 'qa', skillId: 'text-open-world.production.balance-review.v1', recommendedModelCalls: 1, tokenBudgetWeight: 6,
    dependsOn: [
      'p8.catalog.progression', 'p8.catalog.encounters', 'p8.catalog.items-rewards',
      'p8.catalog.crafting-economy', 'p8f.quest-finalize', 'v1.deterministic-preflight',
    ],
    inputArtifactKeys: [
      'text-open-world.progression-catalogs', 'text-open-world.enemy-encounter-catalog',
      'text-open-world.item-reward-catalog', 'text-open-world.crafting-economy-catalog',
      'text-open-world.quest-design-documents', 'text-open-world.content-budget',
      'text-open-world.deterministic-preflight',
    ],
    outputArtifactKeys: ['text-open-world.balance-review'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.balance.progression', 'tow.balance.encounters', 'tow.balance.economy-solvability'],
    },
  }),
  modelTask({
    stage: 'V2', taskKey: 'v2.semantic-review', objective: '评审叙事、任务体验、内容重复度、时长和世界一致性。',
    lane: 'qa', skillId: 'text-open-world.production.semantic-review.v1', recommendedModelCalls: 1, tokenBudgetWeight: 8,
    dependsOn: ['p3.story-architecture', 'p5.mainline', 'p6.significant-threads', 'p7.region-narrative-packs', 'p9.scene-scripts', 'v1.deterministic-preflight'],
    inputArtifactKeys: [
      'text-open-world.source-ledger', 'text-open-world.experience-contract',
      'text-open-world.story-arc', 'text-open-world.narrative-promises', 'text-open-world.mainline-thread',
      'text-open-world.significant-threads', 'text-open-world.region-narrative-packs',
      'text-open-world.quest-design-documents', 'text-open-world.scene-scripts',
      'text-open-world.choice-contracts', 'text-open-world.action-bindings',
      'text-open-world.content-budget', 'text-open-world.deterministic-preflight',
    ],
    outputArtifactKeys: ['text-open-world.semantic-review'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.semantic.narrative', 'tow.semantic.quest-experience', 'tow.semantic.duration'],
    },
  }),
  deterministicTask({
    stage: 'V3', taskKey: 'v3.runtime-package', objective: '把已验收产物确定性装配为G2可直接运行的文字开放世界包。',
    dependsOn: [
      'p10.system-finalize', 'v1.deterministic-preflight',
      'v2.balance-review', 'v2.semantic-review',
    ],
    inputArtifactKeys: [
      'text-open-world.source-pin', 'text-open-world.source-ledger',
      'text-open-world.game-brief', 'text-open-world.experience-contract',
      'text-open-world.story-arc', 'text-open-world.ending-contracts',
      'text-open-world.mainline-thread', 'text-open-world.significant-threads',
      'text-open-world.quest-skeletons',
      'text-open-world.presentation-profile', 'text-open-world.player-build',
      'text-open-world.region-narrative-packs', 'text-open-world.progression-catalogs',
      'text-open-world.enemy-encounter-catalog', 'text-open-world.item-reward-catalog',
      'text-open-world.crafting-economy-catalog', 'text-open-world.npc-runtime-catalog',
      'text-open-world.map-interaction-catalog',
      'text-open-world.quest-design-documents', 'text-open-world.director-decks',
      'text-open-world.scene-scripts', 'text-open-world.choice-contracts',
      'text-open-world.action-bindings', 'text-open-world.system-configs',
      'text-open-world.media-requirements', 'text-open-world.content-budget',
      'text-open-world.deterministic-preflight', 'text-open-world.balance-review',
      'text-open-world.semantic-review',
    ],
    outputArtifactKeys: ['text-open-world.runtime-package', 'text-open-world.integration-report'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['tow.package.protocol', 'tow.package.g2-compatible', 'tow.package.source-provenance'],
    },
  }),
  deterministicTask({
    stage: 'QA', taskKey: 'qa.release', objective: '汇总硬闸、软警告、媒资覆盖与可发布结论。',
    lane: 'qa', dependsOn: ['v3.runtime-package'],
    inputArtifactKeys: ['text-open-world.runtime-package', 'text-open-world.integration-report'],
    outputArtifactKeys: ['text-open-world.quality-report'],
    completion: {
      requiresAcceptedOutputs: true, terminalEvidence: 'task-receipt',
      requiredGateIds: ['runtime.package.valid', 'runtime.playable', 'rights.complete'],
    },
  }),
]

/**
 * One canonical model-call profile for every producer of a text-open-world
 * Brief. Fresh production reserves six bounded P1 source batches, 160
 * disclosure-isolated P9 calls (at most 159 Scenes plus one shared request),
 * one additional P9 fragment-repair call, and one call for every other current
 * model executor. Actual provider usage is metered from executed calls and can
 * be lower than the reservation.
 */
export const TEXT_OPEN_WORLD_PRODUCTION_MODEL_CALL_BUDGET_V1 = Object.freeze({
  minimum: TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1
    .filter(task => task.executionMode === 'model')
    .reduce((sum, task) => sum + task.recommendedModelCalls, 0),
  recommended: TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1
    .filter(task => task.executionMode === 'model')
    .reduce((sum, task) => sum + task.recommendedModelCalls, 0),
})

/**
 * Token reservations intentionally keep the authored production proportions
 * independent from provider-call fan-out. P9 may execute one isolated call per
 * Scene, but that must not starve the earlier story and quest compilers.
 */
export const TEXT_OPEN_WORLD_PRODUCTION_TOKEN_BUDGET_WEIGHT_V1 =
  TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1
    .filter(task => task.executionMode === 'model')
    .reduce((sum, task) => sum + task.tokenBudgetWeight, 0)

/** Base duration weights before optional media lanes are added to a Plan. */
export const TEXT_OPEN_WORLD_PRODUCTION_DURATION_BUDGET_WEIGHT_V1 =
  TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1
    .reduce((sum, task) => sum + task.durationBudgetWeight, 0)

export const TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_DEFINITIONS_V1: TextOpenWorldProductionArtifactDefinitionV1[] =
  TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.flatMap(task => task.outputArtifactKeys.map(artifactKey => ({
    artifactKey,
    kind: artifactKey,
    schema: `storyforge.${artifactKey.replace(/\./g, '-')}` as `storyforge.${string}`,
    version: 1 as const,
    ownerTaskKey: task.taskKey,
  })))

/**
 * Canonical transitive stale closure for the production DAG. The edited task
 * itself is included. Review findings and creator repair Builds must share
 * this code-owned rule instead of encoding propagation in prompts or UI.
 */
export function textOpenWorldProductionTaskDescendantsV1(
  taskKey: string,
  contracts: readonly Pick<TextOpenWorldProductionTaskContractV1, 'taskKey' | 'dependsOn'>[] =
    TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1,
): string[] {
  if (!contracts.some(task => task.taskKey === taskKey)) {
    fail(`stale closure 起点不存在:${taskKey}`)
  }
  const found = new Set<string>([taskKey])
  let changed = true
  while (changed) {
    changed = false
    for (const task of contracts) {
      if (found.has(task.taskKey) || !task.dependsOn.some(dependency => found.has(dependency))) continue
      found.add(task.taskKey)
      changed = true
    }
  }
  return contracts.filter(task => found.has(task.taskKey)).map(task => task.taskKey)
}

function ancestorsOf(
  taskKey: string,
  taskByKey: ReadonlyMap<string, TextOpenWorldProductionTaskContractV1>,
  output: Set<string> = new Set(),
): Set<string> {
  for (const dependency of taskByKey.get(taskKey)?.dependsOn ?? []) {
    if (output.has(dependency)) continue
    output.add(dependency)
    ancestorsOf(dependency, taskByKey, output)
  }
  return output
}

/** Strict product-level checks that the generic Plan parser cannot infer. */
export function validateTextOpenWorldProductionTaskContractsV1(
  contracts: readonly TextOpenWorldProductionTaskContractV1[] = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1,
): TextOpenWorldProductionTaskContractV1[] {
  const tasks = structuredClone(contracts) as TextOpenWorldProductionTaskContractV1[]
  const taskByKey = new Map(tasks.map(task => [task.taskKey, task]))
  if (tasks.length === 0 || taskByKey.size !== tasks.length) fail('taskKey 必须存在且唯一')
  const outputOwners = new Map<TextOpenWorldProductionArtifactKindV1, string>()
  for (const task of tasks) {
    if (!STABLE_KEY.test(task.taskKey) || !task.objective.trim()) fail(`${task.taskKey || 'task'} 基本字段无效`)
    if (!TEXT_OPEN_WORLD_PRODUCTION_STAGES_V1.includes(task.stage)) fail(`${task.taskKey} stage 未登记`)
    if (task.dependsOn.some(key => !taskByKey.has(key) || key === task.taskKey)) fail(`${task.taskKey} 依赖无效`)
    if (task.executionMode === 'model') {
      if (!task.skillId || task.budgetClass !== 'model' || task.retryPolicy.maxAttempts !== 2
        || !Number.isInteger(task.recommendedModelCalls) || task.recommendedModelCalls < 1
        || !Number.isInteger(task.tokenBudgetWeight) || task.tokenBudgetWeight < 1
        || !Number.isInteger(task.durationBudgetWeight) || task.durationBudgetWeight < 1
        || task.failurePolicy !== 'pause' || task.retryPolicy.repairMode !== 'bounded-local-repair') {
        fail(`${task.taskKey} 模型 Run 合同不完整`)
      }
    } else if (task.executionMode === 'deterministic') {
      if (task.skillId !== null || task.budgetClass !== 'deterministic'
        || task.recommendedModelCalls !== 0
        || task.tokenBudgetWeight !== 0
        || !Number.isInteger(task.durationBudgetWeight) || task.durationBudgetWeight < 1
        || task.retryPolicy.maxAttempts !== 1 || task.failurePolicy !== 'fail-build'
        || task.retryPolicy.repairMode !== 'none') fail(`${task.taskKey} 确定性 Run 合同不完整`)
    } else fail(`${task.taskKey} 首版只允许 model/deterministic`)
    if (task.timeoutMs < 1 || task.outputArtifactKeys.length === 0
      || !task.completion.requiresAcceptedOutputs || task.completion.requiredGateIds.length === 0
      || task.completion.terminalEvidence !== 'task-receipt') fail(`${task.taskKey} 完成条件不完整`)
    if (new Set(task.completion.requiredGateIds).size !== task.completion.requiredGateIds.length) {
      fail(`${task.taskKey} gate 重复`)
    }
    if (REQUIRED_STALE_WATCHES.some(watch => !task.stalePolicy.watches.includes(watch))
      || task.stalePolicy.propagation !== 'transitive-downstream'
      || task.stalePolicy.onChange !== 'pause-for-author'
      || task.stalePolicy.staleCandidatePolicy !== 'view-only-rebuild-required') {
      fail(`${task.taskKey} stale 合同不完整`)
    }
    if (!task.retryPolicy.nonRetryableFailures.includes('stale')
      || !task.retryPolicy.nonRetryableFailures.includes('unknown-result')) {
      fail(`${task.taskKey} 非重试边界不完整`)
    }
    for (const artifactKey of task.outputArtifactKeys) {
      if (!TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_KINDS_V1.includes(artifactKey)) {
        fail(`${task.taskKey} 输出 Artifact Kind 未登记:${artifactKey}`)
      }
      if (outputOwners.has(artifactKey)) fail(`${artifactKey} 有多个 owner`)
      outputOwners.set(artifactKey, task.taskKey)
    }
  }
  if (TEXT_OPEN_WORLD_PRODUCTION_STAGES_V1.some(stage => !tasks.some(task => task.stage === stage))) {
    fail('P0-P10/V1-V3/QA 阶段未完整覆盖')
  }
  const artifactKinds = new Set(TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_KINDS_V1)
  if (artifactKinds.size !== outputOwners.size
    || [...artifactKinds].some(kind => !outputOwners.has(kind))) fail('Artifact Kind 与输出 owner 未闭合')
  for (const task of tasks) {
    const ancestors = ancestorsOf(task.taskKey, taskByKey)
    for (const input of task.inputArtifactKeys) {
      const owner = outputOwners.get(input)
      if (!owner || !ancestors.has(owner)) fail(`${task.taskKey} 输入未由上游依赖提供:${input}`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (taskKey: string) => {
    if (visiting.has(taskKey)) fail(`生产 DAG 有环:${taskKey}`)
    if (visited.has(taskKey)) return
    visiting.add(taskKey)
    for (const dependency of taskByKey.get(taskKey)!.dependsOn) visit(dependency)
    visiting.delete(taskKey)
    visited.add(taskKey)
  }
  tasks.forEach(task => visit(task.taskKey))
  if (!taskByKey.has('qa.release') || ancestorsOf('qa.release', taskByKey).size !== tasks.length - 1) {
    fail('所有任务必须进入 qa.release terminal join')
  }
  return tasks
}

export function createTextOpenWorldProductionRunContractBlueprintV1(): TextOpenWorldProductionRunContractBlueprintV1 {
  return {
    version: 1,
    productOwner: 'text-open-world',
    workflowKind: 'long-running-resumable',
    activation: 'active',
    scopeBindings: ['projectId', 'worldId', 'workId', 'productionId', 'buildId'],
    lineageBindings: ['sourceReleaseId', 'sourceHash', 'briefHash', 'planHash', 'controlEpoch'],
    artifactAcceptance: 'candidate-then-accepted-by-shared-artifact-store',
    tasks: validateTextOpenWorldProductionTaskContractsV1(),
    terminalTaskKey: 'qa.release',
  }
}

function reservation(input: Partial<ProductTaskBudgetReservationV1>): ProductTaskBudgetReservationV1 {
  return {
    modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
    maximumCostUsd: 0, durationMs: 0, storageBytes: 0, ...input,
  }
}

export function estimateTextOpenWorldSourceLockCheckpointBytesV1(input: {
  sourceUnitCount: number
  sourceTotalChars?: number
}): number {
  if (!Number.isSafeInteger(input.sourceUnitCount) || input.sourceUnitCount < 1
    || input.sourceUnitCount > TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumUnits) {
    fail(`P0来源单元数必须在1到${TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumUnits}之间`)
  }
  const sourceTotalChars = input.sourceTotalChars
    ?? TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumTotalChars
  if (!Number.isSafeInteger(sourceTotalChars) || sourceTotalChars < 0
    || sourceTotalChars > TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumTotalChars) {
    fail(`P0来源字符数必须在0到${TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumTotalChars}之间`)
  }
  const required = SOURCE_LOCK_FIXED_ENVELOPE_BYTES
    + input.sourceUnitCount * SOURCE_LOCK_UNIT_ENVELOPE_BYTES
    + sourceTotalChars * SOURCE_LOCK_JSON_BYTES_PER_CHAR
  if (required > TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumCheckpointResumePayloadBytes) {
    fail(`P0来源候选超过durable checkpoint上限:${required}`)
  }
  return required
}

function sourceLockStorageReservationV1(input: {
  sourceUnitCount: number
  sourceTotalChars?: number
  maximumStorageBytes: number
}): number {
  // Reserve the full durable-candidate upper bound rather than payload-only
  // bytes. This keeps a legal P0 result writable, recoverable and acceptable
  // under one invariant instead of letting storage and checkpoint limits drift.
  const required = estimateTextOpenWorldSourceLockCheckpointBytesV1(input)
  if (required > input.maximumStorageBytes) {
    fail(`Brief storage授权不足以安全冻结P0来源，至少需要${required}字节`)
  }
  return required
}

function allocateStorageReservationsV1(input: {
  taskKeys: string[]
  p0StorageBytes: number
  maximumStorageBytes: number
}): Map<string, number> {
  const p0TaskKey = 'p0.source-lock'
  if (!input.taskKeys.includes(p0TaskKey) || new Set(input.taskKeys).size !== input.taskKeys.length) {
    fail('storage预留任务集合无效')
  }
  const otherTaskKeys = input.taskKeys.filter(taskKey => taskKey !== p0TaskKey)
  if (otherTaskKeys.length === 0) fail('P0之外没有可分配storage余量的任务')
  const remaining = input.maximumStorageBytes - input.p0StorageBytes
  const perTask = Math.floor(remaining / otherTaskKeys.length)
  let residual = remaining - perTask * otherTaskKeys.length
  const allocations = new Map<string, number>([[p0TaskKey, input.p0StorageBytes]])
  for (const taskKey of otherTaskKeys) {
    allocations.set(taskKey, perTask + (residual > 0 ? 1 : 0))
    residual = Math.max(0, residual - 1)
  }
  return allocations
}

function allocateModelCalls(
  contracts: readonly TextOpenWorldProductionTaskContractV1[],
  maximumModelCalls: number,
): Map<string, number> {
  const modelTasks = contracts.filter(task => task.executionMode === 'model')
  const recommendedTotal = modelTasks.reduce((sum, task) => sum + task.recommendedModelCalls, 0)
  if (maximumModelCalls < recommendedTotal) {
    fail(`完整生产 DAG 至少需要 ${recommendedTotal} 次已授权模型调用`)
  }
  const plannedTotal = Math.min(maximumModelCalls, recommendedTotal)
  const remaining = plannedTotal - modelTasks.length
  const capacityTotal = modelTasks.reduce((sum, task) => sum + task.recommendedModelCalls - 1, 0)
  const allocations = new Map(modelTasks.map(task => [task.taskKey, 1]))
  const fractions: Array<{ taskKey: string; remainder: number }> = []
  let allocatedExtra = 0
  for (const task of modelTasks) {
    const capacity = task.recommendedModelCalls - 1
    const exact = capacityTotal === 0 ? 0 : remaining * capacity / capacityTotal
    const extra = Math.min(capacity, Math.floor(exact))
    allocations.set(task.taskKey, 1 + extra)
    allocatedExtra += extra
    fractions.push({ taskKey: task.taskKey, remainder: exact - extra })
  }
  fractions.sort((left, right) => right.remainder - left.remainder
    || left.taskKey.localeCompare(right.taskKey))
  let residual = remaining - allocatedExtra
  for (const item of fractions) {
    if (residual === 0) break
    const task = modelTasks.find(candidate => candidate.taskKey === item.taskKey)!
    const current = allocations.get(item.taskKey)!
    if (current >= task.recommendedModelCalls) continue
    allocations.set(item.taskKey, current + 1)
    residual -= 1
  }
  if (residual !== 0) fail('模型调用预算无法确定性分配')
  return allocations
}

function planTask(
  contract: TextOpenWorldProductionTaskContractV1,
  budgetReservation: ProductTaskBudgetReservationV1,
  textCapabilityKeys: string[],
  priority: number,
): ProductProductionPlanTaskV3 {
  return {
    taskKey: contract.taskKey,
    lane: contract.lane,
    kind: `text-open-world.${contract.taskKey}`,
    skillId: contract.skillId,
    executionMode: contract.executionMode,
    dependsOn: [...contract.dependsOn],
    requiredReceipts: contract.dependsOn.map(taskKey => ({ taskKey, receiptHash: null })),
    inputArtifactKeys: [...contract.inputArtifactKeys],
    outputArtifactKeys: [...contract.outputArtifactKeys],
    requirementKeys: [],
    capabilityRequirementKeys: contract.executionMode === 'model' ? [...textCapabilityKeys] : [],
    concurrencyGroup: contract.executionMode === 'model' ? 'text-provider' : 'deterministic',
    subjectLockKeys: [...contract.outputArtifactKeys],
    priority,
    budgetReservation,
    maxAttempts: contract.retryPolicy.maxAttempts,
    // The Run timeout may never exceed the wall-clock amount the author
    // actually authorized for this task in the concrete Plan.
    timeoutMs: Math.max(1, Math.min(contract.timeoutMs, budgetReservation.durationMs)),
    failurePolicy: contract.failurePolicy,
    fallbackTaskKey: null,
    acceptanceGateIds: [...contract.completion.requiredGateIds],
    reuse: null,
  }
}

/** Generates the active, shared-Harness-compatible text-open-world plan. */
export async function createTextOpenWorldProductionPlanV1(input: {
  buildNumber: number
  controlEpoch?: number
  /** Hash of the scheduler compatibility Brief supplied below. */
  briefHash: string
  brief: ProductProductionBriefV3 | string
  /** Creator production keeps its author-confirmed Brief as the Build
   * authority. When supplied, the Plan binds that hash while separately
   * verifying `briefHash` against the compatibility projection. */
  authoritativeBriefHash?: string
  /** Exact P0 unit keys frozen by the dual-source creator SourcePlan. */
  sourceUnitArtifactKeys?: string[]
  /** Exact P0 source-body character count when the adapter exposes it. Omit it
   * for a bounded/private source and the 4,000,000-character safety limit is
   * reserved instead. WorldRelease index-only P0 may explicitly pass zero. */
  sourceTotalChars?: number
  /** G5-03 authorizes text cost only; procedural prototype media reserves no
   * paid provider amount until the G5-08 media plan is confirmed. */
  mediaCostAuthorized?: boolean
}): Promise<ProductProductionPlanV3> {
  const brief = parseProductProductionBriefV3(input.brief)
  if (brief.intent.productType !== 'text-open-world') fail('只能为 text-open-world Brief 创建专属 Plan')
  if (brief.media.voiceLineCount > 0) fail('文字开放世界首版尚未实现独立voice媒资通路，请将voiceLineCount设为0')
  if (!Number.isInteger(input.buildNumber) || input.buildNumber < 1) fail('buildNumber 无效')
  if (!isSha256Hash(input.briefHash)) fail('briefHash 无效')
  if (await hashProductProductionValueV2(brief) !== input.briefHash) fail('briefHash 与 Brief 内容不一致')
  const planBriefHash = input.authoritativeBriefHash ?? input.briefHash
  if (!isSha256Hash(planBriefHash)) fail('authoritativeBriefHash 无效')
  const controlEpoch = input.controlEpoch ?? 0
  if (!Number.isInteger(controlEpoch) || controlEpoch < 0) fail('controlEpoch 无效')

  // P0 freezes one immutable unit Artifact for every selected WorldRelease or
  // novel unit. Resolve and bound the exact key set before budget allocation so
  // storage is based on the source rather than an equal task split.
  const sourceUnitKeys = input.sourceUnitArtifactKeys
    ? [...input.sourceUnitArtifactKeys]
    : brief.source.selection.resourceKeys.map((_, index) => (
        index === 0
          ? 'text-open-world.source-pin-unit'
          : `text-open-world.source-pin-unit.${String(index + 1).padStart(5, '0')}`
      ))
  if (sourceUnitKeys.length === 0
    || sourceUnitKeys.length > TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumUnits) {
    fail(`文字开放世界来源选择必须在1到${TEXT_OPEN_WORLD_PRODUCTION_SOURCE_LIMITS_V1.maximumUnits}个单元之间`)
  }
  if (new Set(sourceUnitKeys).size !== sourceUnitKeys.length
    || sourceUnitKeys.some((key, index) => key !== (index === 0
      ? 'text-open-world.source-pin-unit'
      : `text-open-world.source-pin-unit.${String(index + 1).padStart(5, '0')}`))) {
    fail('P0来源单元 Artifact keys 不连续或不唯一')
  }

  const contracts = validateTextOpenWorldProductionTaskContractsV1()
  const modelCallsByTask = allocateModelCalls(contracts, brief.productionBudget.maximumModelCalls)
  const plannedModelCalls = [...modelCallsByTask.values()].reduce((sum, value) => sum + value, 0)
  const tokenBudgetWeightTotal = contracts
    .filter(contract => contract.executionMode === 'model')
    .reduce((sum, contract) => sum + contract.tokenBudgetWeight, 0)
  if (tokenBudgetWeightTotal < 1) fail('模型任务 token 预算权重无效')
  const capabilityKeys = (classes: Array<ProductProductionBriefV3['capabilityRequirements'][number]['mediaClass']>) => (
    brief.capabilityRequirements.filter(item => classes.includes(item.mediaClass)).map(item => item.requirementKey)
  )
  const textCapabilities = capabilityKeys(['text'])
  const imageCapabilities = capabilityKeys(['image'])
  const audioCapabilities = capabilityKeys(['music', 'sfx', 'voice'])
  const visualCount = brief.media.imageCount > 0 || imageCapabilities.length > 0
    ? Math.max(1, brief.media.imageCount) : 0
  const requestedAudioCount = brief.media.musicTrackCount + brief.media.sfxCount + brief.media.voiceLineCount
  const audioCount = requestedAudioCount > 0 || audioCapabilities.length > 0 ? Math.max(1, requestedAudioCount) : 0
  const mediaLaneCount = Number(visualCount > 0) + Number(audioCount > 0)
  const mediaDurationBudgetWeight = 2
  const durationBudgetWeightTotal = contracts.reduce(
    (sum, contract) => sum + contract.durationBudgetWeight,
    mediaLaneCount * mediaDurationBudgetWeight,
  )
  const mediaCostAuthorized = input.mediaCostAuthorized ?? true
  const costBearingUnits = plannedModelCalls + (mediaCostAuthorized ? visualCount + audioCount : 0)
  const maximumStorageBytes = Math.floor(brief.productionBudget.maximumStorageBytes)
  const p0StorageBytes = sourceLockStorageReservationV1({
    sourceUnitCount: sourceUnitKeys.length,
    sourceTotalChars: input.sourceTotalChars,
    maximumStorageBytes,
  })
  const storageByTask = allocateStorageReservationsV1({
    taskKeys: [
      ...contracts.map(contract => contract.taskKey),
      ...(visualCount > 0 ? ['media.visual'] : []),
      ...(audioCount > 0 ? ['media.audio'] : []),
    ],
    p0StorageBytes,
    maximumStorageBytes,
  })
  const storageFor = (taskKey: string) => storageByTask.get(taskKey)
    ?? fail(`任务缺少storage预留:${taskKey}`)
  const durationFor = (weight: number) => Math.floor(
    brief.productionBudget.maximumDurationMs * weight / durationBudgetWeightTotal,
  )
  const costForUnits = (units: number) => brief.productionBudget.maximumCostUsd == null
    ? null : brief.productionBudget.maximumCostUsd * 0.99 * units / costBearingUnits
  const tasks = contracts.map((contract, index) => {
    const modelCalls = modelCallsByTask.get(contract.taskKey) ?? 0
    const taskBudget = contract.executionMode === 'model' ? reservation({
      modelCalls,
      inputTokens: Math.floor(
        brief.productionBudget.maximumInputTokens * contract.tokenBudgetWeight / tokenBudgetWeightTotal,
      ),
      outputTokens: Math.floor(
        brief.productionBudget.maximumOutputTokens * contract.tokenBudgetWeight / tokenBudgetWeightTotal,
      ),
      maximumCostUsd: costForUnits(modelCalls),
      durationMs: durationFor(contract.durationBudgetWeight),
      storageBytes: storageFor(contract.taskKey),
    }) : reservation({
      durationMs: durationFor(1),
      storageBytes: storageFor(contract.taskKey),
    })
    return planTask(contract, taskBudget, textCapabilities, 1_000 - index * 10)
  })

  // The contract declares the base kind; the concrete Plan owns the exact
  // bounded keys so P1 can prove that it read the complete selection.
  const p0 = tasks.find(task => task.taskKey === 'p0.source-lock')!
  p0.outputArtifactKeys = ['text-open-world.source-pin', ...sourceUnitKeys]
  p0.subjectLockKeys = [...p0.outputArtifactKeys]
  const p1 = tasks.find(task => task.taskKey === 'p1.source-curation')!
  p1.inputArtifactKeys = ['text-open-world.source-pin', ...sourceUnitKeys]

  const v3 = tasks.find(task => task.taskKey === 'v3.runtime-package')!
  const addMediaTask = (config: {
    taskKey: string
    kind: string
    outputPrefix: string
    count: number
    capabilityRequirementKeys: string[]
    requirementKinds: string[]
    lane: 'visual' | 'audio'
  }) => {
    if (config.count === 0) return
    const outputs = Array.from(
      { length: config.count },
      (_, index) => `${config.outputPrefix}.${String(index + 1).padStart(3, '0')}`,
    )
    tasks.push({
      taskKey: config.taskKey, lane: config.lane, kind: config.kind,
      skillId: 'product-production.media-request.v1', executionMode: 'media-provider',
      dependsOn: ['p10.system-finalize'],
      requiredReceipts: [{ taskKey: 'p10.system-finalize', receiptHash: null }],
      inputArtifactKeys: ['text-open-world.media-requirements'], outputArtifactKeys: outputs,
      requirementKeys: config.requirementKinds,
      capabilityRequirementKeys: config.capabilityRequirementKeys,
      concurrencyGroup: 'media-provider', subjectLockKeys: outputs, priority: 50,
      budgetReservation: reservation({
        mediaCalls: config.count,
        maximumCostUsd: mediaCostAuthorized ? costForUnits(config.count) : 0,
        durationMs: durationFor(mediaDurationBudgetWeight), storageBytes: storageFor(config.taskKey),
      }),
      maxAttempts: 2,
      timeoutMs: Math.max(1, Math.min(600_000, durationFor(mediaDurationBudgetWeight))),
      // The shared scheduler has no durable "skipped task" terminal state.
      // Prototype Builds bind built-in procedural adapters, while required
      // commercial media pauses visibly. Slot-level text/placeholder fallback
      // remains available when a slot is intentionally left unbound; a failed
      // scheduled provider task must never be silently reported as complete.
      failurePolicy: 'pause',
      fallbackTaskKey: null, acceptanceGateIds: ['media.integrity', 'media.rights'], reuse: null,
    })
    v3.dependsOn.push(config.taskKey)
    v3.requiredReceipts.push({ taskKey: config.taskKey, receiptHash: null })
    v3.inputArtifactKeys.push(...outputs)
  }
  addMediaTask({
    taskKey: 'media.visual', kind: 'text-open-world.image-bundle',
    outputPrefix: 'text-open-world.media.visual', count: visualCount,
    capabilityRequirementKeys: imageCapabilities,
    requirementKinds: brief.media.requiredMediaKinds.filter(kind => !['bgm', 'sfx', 'voice'].includes(kind)),
    lane: 'visual',
  })
  addMediaTask({
    taskKey: 'media.audio', kind: 'text-open-world.audio-bundle',
    outputPrefix: 'text-open-world.media.audio', count: audioCount,
    capabilityRequirementKeys: audioCapabilities,
    requirementKinds: brief.media.requiredMediaKinds.filter(kind => ['bgm', 'sfx', 'voice'].includes(kind)),
    lane: 'audio',
  })
  // V3 only assembles already-normalized accepted blobs and never invokes a
  // transcoder. If a future format conversion is needed it must be a separate
  // media-provider task with its own receipt, not an unused binding on this
  // deterministic compiler.
  v3.capabilityRequirementKeys = []
  const qa = tasks.find(task => task.taskKey === 'qa.release')!
  qa.acceptanceGateIds = [...new Set([
    ...qa.acceptanceGateIds, ...brief.completionContract.requiredGateIds,
  ])]

  return parseProductProductionPlanV3({
    schema: 'storyforge.product-production-plan', version: 3,
    buildNumber: input.buildNumber, productType: brief.intent.productType,
    briefHash: planBriefHash, controlEpoch,
    concurrency: {
      maximumCostBearingTasks: 3,
      maximumTextProviderTasks: 2,
      maximumMediaProviderTasks: 1,
    },
    tasks,
    terminalTaskKey: 'qa.release',
  }, brief, planBriefHash)
}

export function textOpenWorldProductionArtifactKindForKeyV1(
  artifactKey: string,
): ProductBuildArtifactKindV1 {
  if ((TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_KINDS_V1 as readonly string[]).includes(artifactKey)) {
    return artifactKey as TextOpenWorldProductionArtifactKindV1
  }
  if (/^text-open-world\.source-pin-unit\.\d{5}$/.test(artifactKey)) {
    return 'text-open-world.source-pin-unit'
  }
  if (/^text-open-world\.media\.visual\.\d{3}$/.test(artifactKey)) return 'image'
  if (/^text-open-world\.media\.audio\.\d{3}$/.test(artifactKey)) return 'audio'
  fail(`Artifact key 没有 kind 映射:${artifactKey}`)
}

export function textOpenWorldProductionStageTaskKeysV1(
  stage: TextOpenWorldProductionStageV1,
): string[] {
  return TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1
    .filter(task => task.stage === stage)
    .map(task => task.taskKey)
}
