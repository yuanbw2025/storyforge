import { db } from '../db/schema'
import type {
  CharacterInteractionBriefGuestV1,
  CharacterInteractionBriefRecordV1,
  CharacterInteractionBriefV1,
  CharacterInteractionMediaTierV1,
  CharacterInteractionProductionRecordV1,
  CharacterInteractionProductionRunContractV1,
  CharacterInteractionSourceSelectionRecordV1,
  CharacterInteractionStoryModeV1,
  CharacterInteractionUserRoleV1,
  CharacterInteractionWorldSourceCatalogV1,
  CharacterInteractionWorldSourceSelectionV1,
  CharacterInteractionWorldSourceTableV1,
  InteractionRelationshipDimensionKey,
  WorkspaceScope,
  WorldReferenceV1,
  ProductSourcePlanV1,
  ConfirmedProductBriefV1,
} from '../types'
import {
  CHARACTER_INTERACTION_PRODUCTION_STEPS_V1,
  INTERACTION_RELATIONSHIP_DIMENSIONS,
} from '../types'
import { resolveScope } from '../world-engine/scope'
import { createWorldReferenceV1, validateWorldReferenceV1 } from '../world-engine/world-reference'
import {
  assertFormalProductProductionStartV1,
  createConfirmedProductBriefV1,
  freezeProductSourcePlanV1,
  validateConfirmedProductBriefV1,
  validateProductSourcePlanV1,
  worldReferenceResourceScopeV1,
} from '../world-engine/product-source-contracts'
import { CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V1 } from '../world-engine/product-requirement-adapters'
import { listAllWorldReleaseResourceDescriptorsV1 } from '../context-gateway/world-release-provider'
import {
  freezeCharacterInteractionWorldSourceSelectionV1,
  loadCharacterInteractionWorldSourceCatalogV1,
  parseCharacterInteractionWorldSourceSelectionV1,
  validateCharacterInteractionWorldSourceSelectionV1,
} from './world-source'

const HASH = /^[a-f0-9]{64}$/
const STABLE_KEY = /^[a-zA-Z0-9._:-]+$/
const USER_ROLES = new Set<CharacterInteractionUserRoleV1>(['self', 'original-visitor', 'observer', 'director'])
const STORY_MODES = new Set<CharacterInteractionStoryModeV1>(['inherit-ending', 'parallel-timeline', 'new-event'])
const MEDIA_TIERS = new Set<CharacterInteractionMediaTierV1>(['text-core', 'portrait-standard', 'voice-optional'])
const ENDING_STRATEGIES = new Set(['open-ended', 'goal-complete', 'user-decides'])
const BRIEF_KEYS = new Set([
  'schema', 'version', 'productType', 'contractVersion', 'source', 'title', 'userInstruction',
  'userRole', 'participants', 'guests', 'setting', 'knowledgePolicy', 'relationshipPolicy',
  'runtime', 'media', 'worldFeedback',
])
const SOURCE_KEYS = new Set(['worldReleaseId', 'worldContentHash', 'selectionHash'])
const PARTICIPANT_KEYS = new Set(['participantKey', 'source', 'displayName', 'reason'])
const GUEST_KEYS = new Set(['guestKey', 'name', 'relationToWorld', 'profile'])
const SETTING_KEYS = new Set([
  'storyMode', 'timeContext', 'locationContext', 'historicalContext', 'chatGoal',
  'desiredDirections', 'safetyBoundaries',
])
const KNOWLEDGE_KEYS = new Set(['publicKnowledge', 'privateKnowledge', 'prohibitedDisclosure'])
const RELATIONSHIP_KEYS = new Set(['dimensions', 'largeChangeNeedsEvidence'])
const RUNTIME_KEYS = new Set(['sceneCount', 'maxTurnsPerScene', 'directorBudget', 'endingStrategy'])
const MEDIA_KEYS = new Set(['tier'])
const FEEDBACK_KEYS = new Set(['allowCandidate', 'autoWriteback'])
const RUN_CONTRACT_KEYS = new Set([
  'schema', 'version', 'productType', 'contractVersion', 'sourceWorldReleaseId',
  'sourceSelectionHash', 'briefHash', 'allowedContextSourceKeys', 'allowedSteps',
  'writeMode', 'worldWritebackAllowed', 'formalMediaWriteAllowed', 'requiredHumanConfirmations',
])

function fail(message: string): never {
  throw new Error(`[chatgame-production] ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length) fail(`${label} 含未知字段:${unknown.join(',')}`)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export async function hashCharacterInteractionProductionValueV1(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashCharacterInteractionBriefV1(brief: CharacterInteractionBriefV1): Promise<string> {
  const { worldReleaseId: _localWorldReleaseId, ...portableSource } = brief.source
  return hashCharacterInteractionProductionValueV1({ ...brief, source: portableSource })
}

async function hashCharacterInteractionRunContractV1(
  contract: CharacterInteractionProductionRunContractV1,
): Promise<string> {
  const { sourceWorldReleaseId: _localWorldReleaseId, ...portable } = contract
  return hashCharacterInteractionProductionValueV1(portable)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function text(value: unknown, label: string, maximum = 4_000, allowEmpty = false): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const result = value.trim()
  if ((!allowEmpty && !result) || result.length > maximum) fail(`${label} 无效`)
  return result
}

function positiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) fail(`${label} 必须是有效正整数`)
  return Number(value)
}

function nonNegativeInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) fail(`${label} 必须是有效非负整数`)
  return Number(value)
}

function uniqueTextArray(value: unknown, label: string, maximumItems = 32, maximumLength = 1_000): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) fail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => text(item, `${label}[${index}]`, maximumLength))
  if (new Set(result).size !== result.length) fail(`${label} 不能重复`)
  return result
}

function parseJsonObject(value: unknown, label: string): Record<string, unknown> {
  let parsed = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { fail(`${label} 不是合法 JSON`) }
  }
  if (!isRecord(parsed)) fail(`${label} 必须是对象`)
  return parsed
}

function parseGuest(value: unknown, index: number): CharacterInteractionBriefGuestV1 {
  if (!isRecord(value)) fail(`guests[${index}] 必须是对象`)
  exactKeys(value, GUEST_KEYS, `guests[${index}]`)
  const guestKey = text(value.guestKey, `guests[${index}].guestKey`, 160)
  if (!STABLE_KEY.test(guestKey)) fail(`guests[${index}].guestKey 不是稳定 key`)
  return {
    guestKey,
    name: text(value.name, `guests[${index}].name`, 160),
    relationToWorld: text(value.relationToWorld, `guests[${index}].relationToWorld`, 1_000, true),
    profile: text(value.profile, `guests[${index}].profile`, 4_000),
  }
}

export function parseCharacterInteractionBriefV1(value: unknown): CharacterInteractionBriefV1 {
  const parsed = parseJsonObject(value, 'CharacterInteractionBriefV1')
  exactKeys(parsed, BRIEF_KEYS, 'CharacterInteractionBriefV1')
  if (parsed.schema !== 'storyforge.character-interaction-brief' || parsed.version !== 1
    || parsed.productType !== 'character-interaction' || parsed.contractVersion !== 1) {
    fail('Brief 协议身份无效')
  }
  const source = parseJsonObject(parsed.source, 'Brief.source')
  exactKeys(source, SOURCE_KEYS, 'Brief.source')
  if (!HASH.test(String(source.worldContentHash)) || !HASH.test(String(source.selectionHash))) {
    fail('Brief.source hash 无效')
  }
  if (!Array.isArray(parsed.participants) || !parsed.participants.length || parsed.participants.length > 8) {
    fail('Brief.participants 必须包含 1..8 人')
  }
  const participants = parsed.participants.map((raw, index) => {
    if (!isRecord(raw)) fail(`participants[${index}] 必须是对象`)
    exactKeys(raw, PARTICIPANT_KEYS, `participants[${index}]`)
    const participantKey = text(raw.participantKey, `participants[${index}].participantKey`, 200)
    if (!STABLE_KEY.test(participantKey) || (raw.source !== 'world' && raw.source !== 'guest')) {
      fail(`participants[${index}] 身份无效`)
    }
    return {
      participantKey,
      source: raw.source,
      displayName: text(raw.displayName, `participants[${index}].displayName`, 160),
      reason: text(raw.reason, `participants[${index}].reason`, 1_000),
    } as CharacterInteractionBriefV1['participants'][number]
  })
  if (new Set(participants.map(item => item.participantKey)).size !== participants.length) {
    fail('Brief.participants key 不能重复')
  }
  if (!Array.isArray(parsed.guests)) fail('Brief.guests 必须是数组')
  const guests = parsed.guests.map(parseGuest)
  if (new Set(guests.map(item => item.guestKey)).size !== guests.length) fail('Brief.guests key 不能重复')
  const guestKeys = new Set(guests.map(item => item.guestKey))
  const guestParticipantKeys = participants.filter(item => item.source === 'guest').map(item => item.participantKey)
  if (guestKeys.size !== guestParticipantKeys.length || guestParticipantKeys.some(key => !guestKeys.has(key))) {
    fail('Brief guest participant 与 guests 必须精确一致')
  }

  const setting = parseJsonObject(parsed.setting, 'Brief.setting')
  exactKeys(setting, SETTING_KEYS, 'Brief.setting')
  if (!STORY_MODES.has(setting.storyMode as CharacterInteractionStoryModeV1)) fail('Brief.storyMode 无效')
  const knowledge = parseJsonObject(parsed.knowledgePolicy, 'Brief.knowledgePolicy')
  exactKeys(knowledge, KNOWLEDGE_KEYS, 'Brief.knowledgePolicy')
  const relationship = parseJsonObject(parsed.relationshipPolicy, 'Brief.relationshipPolicy')
  exactKeys(relationship, RELATIONSHIP_KEYS, 'Brief.relationshipPolicy')
  if (!Array.isArray(relationship.dimensions) || !relationship.dimensions.length
    || relationship.dimensions.some(key => !INTERACTION_RELATIONSHIP_DIMENSIONS.includes(key as InteractionRelationshipDimensionKey))
    || new Set(relationship.dimensions).size !== relationship.dimensions.length
    || relationship.largeChangeNeedsEvidence !== true) {
    fail('Brief.relationshipPolicy 无效')
  }
  const runtime = parseJsonObject(parsed.runtime, 'Brief.runtime')
  exactKeys(runtime, RUNTIME_KEYS, 'Brief.runtime')
  if (!ENDING_STRATEGIES.has(String(runtime.endingStrategy))) fail('Brief.runtime.endingStrategy 无效')
  const media = parseJsonObject(parsed.media, 'Brief.media')
  exactKeys(media, MEDIA_KEYS, 'Brief.media')
  if (!MEDIA_TIERS.has(media.tier as CharacterInteractionMediaTierV1)) fail('Brief.media.tier 无效')
  const feedback = parseJsonObject(parsed.worldFeedback, 'Brief.worldFeedback')
  exactKeys(feedback, FEEDBACK_KEYS, 'Brief.worldFeedback')
  if (typeof feedback.allowCandidate !== 'boolean' || feedback.autoWriteback !== false) {
    fail('Brief.worldFeedback 必须显式禁止自动回写')
  }
  if (!USER_ROLES.has(parsed.userRole as CharacterInteractionUserRoleV1)) fail('Brief.userRole 无效')

  return {
    schema: 'storyforge.character-interaction-brief',
    version: 1,
    productType: 'character-interaction',
    contractVersion: 1,
    source: {
      worldReleaseId: positiveInteger(source.worldReleaseId, 'Brief.source.worldReleaseId'),
      worldContentHash: String(source.worldContentHash),
      selectionHash: String(source.selectionHash),
    },
    title: text(parsed.title, 'Brief.title', 240),
    userInstruction: text(parsed.userInstruction, 'Brief.userInstruction', 8_000),
    userRole: parsed.userRole as CharacterInteractionUserRoleV1,
    participants,
    guests,
    setting: {
      storyMode: setting.storyMode as CharacterInteractionStoryModeV1,
      timeContext: text(setting.timeContext, 'Brief.setting.timeContext', 2_000),
      locationContext: text(setting.locationContext, 'Brief.setting.locationContext', 2_000),
      historicalContext: text(setting.historicalContext, 'Brief.setting.historicalContext', 4_000, true),
      chatGoal: text(setting.chatGoal, 'Brief.setting.chatGoal', 4_000),
      desiredDirections: uniqueTextArray(setting.desiredDirections, 'Brief.setting.desiredDirections'),
      safetyBoundaries: uniqueTextArray(setting.safetyBoundaries, 'Brief.setting.safetyBoundaries'),
    },
    knowledgePolicy: {
      publicKnowledge: uniqueTextArray(knowledge.publicKnowledge, 'Brief.knowledgePolicy.publicKnowledge'),
      privateKnowledge: uniqueTextArray(knowledge.privateKnowledge, 'Brief.knowledgePolicy.privateKnowledge'),
      prohibitedDisclosure: uniqueTextArray(knowledge.prohibitedDisclosure, 'Brief.knowledgePolicy.prohibitedDisclosure'),
    },
    relationshipPolicy: {
      dimensions: [...relationship.dimensions] as InteractionRelationshipDimensionKey[],
      largeChangeNeedsEvidence: true,
    },
    runtime: {
      sceneCount: positiveInteger(runtime.sceneCount, 'Brief.runtime.sceneCount', 24),
      maxTurnsPerScene: positiveInteger(runtime.maxTurnsPerScene, 'Brief.runtime.maxTurnsPerScene', 500),
      directorBudget: nonNegativeInteger(runtime.directorBudget, 'Brief.runtime.directorBudget', 100),
      endingStrategy: runtime.endingStrategy as CharacterInteractionBriefV1['runtime']['endingStrategy'],
    },
    media: { tier: media.tier as CharacterInteractionMediaTierV1 },
    worldFeedback: { allowCandidate: feedback.allowCandidate, autoWriteback: false },
  }
}

export interface CharacterInteractionBriefInputV1 {
  title: string
  userInstruction: string
  userRole: CharacterInteractionUserRoleV1
  participantReasons?: Record<string, string>
  guests?: CharacterInteractionBriefGuestV1[]
  storyMode: CharacterInteractionStoryModeV1
  timeContext: string
  locationContext: string
  historicalContext?: string
  chatGoal: string
  desiredDirections?: string[]
  safetyBoundaries?: string[]
  publicKnowledge?: string[]
  privateKnowledge?: string[]
  prohibitedDisclosure?: string[]
  relationshipDimensions?: InteractionRelationshipDimensionKey[]
  sceneCount?: number
  maxTurnsPerScene?: number
  directorBudget?: number
  endingStrategy?: CharacterInteractionBriefV1['runtime']['endingStrategy']
  mediaTier?: CharacterInteractionMediaTierV1
  allowWorldFeedbackCandidate?: boolean
}

function participantKeyForWorldCharacter(exportId: number): string {
  return `world-character:${exportId}`
}

export function buildCharacterInteractionBriefV1(input: {
  catalog: CharacterInteractionWorldSourceCatalogV1
  selection: CharacterInteractionWorldSourceSelectionV1
  brief: CharacterInteractionBriefInputV1
}): CharacterInteractionBriefV1 {
  const characterById = new Map((input.catalog.records.characters ?? []).map(item => [item.exportId, item]))
  const guests = input.brief.guests ?? []
  if (input.selection.participantCharacterExportIds.length + guests.length > 8) fail('世界角色与原创角色合计不能超过 8 人')
  const worldParticipants = input.selection.participantCharacterExportIds.map(exportId => {
    const record = characterById.get(exportId)
    if (!record) fail(`Brief 世界角色不存在:${exportId}`)
    const participantKey = participantKeyForWorldCharacter(exportId)
    return {
      participantKey,
      source: 'world' as const,
      displayName: record.label,
      reason: input.brief.participantReasons?.[participantKey]?.trim() || '参与本次角色互动',
    }
  })
  const guestParticipants = guests.map(guest => ({
    participantKey: guest.guestKey,
    source: 'guest' as const,
    displayName: guest.name,
    reason: input.brief.participantReasons?.[guest.guestKey]?.trim() || guest.relationToWorld || '参与本次角色互动',
  }))
  return deepFreeze(parseCharacterInteractionBriefV1({
    schema: 'storyforge.character-interaction-brief',
    version: 1,
    productType: 'character-interaction',
    contractVersion: 1,
    source: {
      worldReleaseId: input.selection.worldReleaseId,
      worldContentHash: input.selection.worldContentHash,
      selectionHash: input.selection.selectionHash,
    },
    title: input.brief.title,
    userInstruction: input.brief.userInstruction,
    userRole: input.brief.userRole,
    participants: [...worldParticipants, ...guestParticipants],
    guests,
    setting: {
      storyMode: input.brief.storyMode,
      timeContext: input.brief.timeContext,
      locationContext: input.brief.locationContext,
      historicalContext: input.brief.historicalContext ?? '',
      chatGoal: input.brief.chatGoal,
      desiredDirections: input.brief.desiredDirections ?? [],
      safetyBoundaries: input.brief.safetyBoundaries ?? [],
    },
    knowledgePolicy: {
      publicKnowledge: input.brief.publicKnowledge ?? [],
      privateKnowledge: input.brief.privateKnowledge ?? [],
      prohibitedDisclosure: input.brief.prohibitedDisclosure ?? [],
    },
    relationshipPolicy: {
      dimensions: input.brief.relationshipDimensions ?? [...INTERACTION_RELATIONSHIP_DIMENSIONS],
      largeChangeNeedsEvidence: true,
    },
    runtime: {
      sceneCount: input.brief.sceneCount ?? 1,
      maxTurnsPerScene: input.brief.maxTurnsPerScene ?? 80,
      directorBudget: input.brief.directorBudget ?? 12,
      endingStrategy: input.brief.endingStrategy ?? 'open-ended',
    },
    media: { tier: input.brief.mediaTier ?? 'text-core' },
    worldFeedback: {
      allowCandidate: input.brief.allowWorldFeedbackCandidate === true,
      autoWriteback: false,
    },
  }))
}

export function parseCharacterInteractionProductionRunContractV1(
  value: unknown,
): CharacterInteractionProductionRunContractV1 {
  const parsed = parseJsonObject(value, 'CharacterInteractionProductionRunContractV1')
  exactKeys(parsed, RUN_CONTRACT_KEYS, 'CharacterInteractionProductionRunContractV1')
  if (parsed.schema !== 'storyforge.character-interaction-production-run-contract'
    || parsed.version !== 1 || parsed.productType !== 'character-interaction'
    || parsed.contractVersion !== 1 || parsed.writeMode !== 'candidate-only'
    || parsed.worldWritebackAllowed !== false || parsed.formalMediaWriteAllowed !== false
    || !HASH.test(String(parsed.sourceSelectionHash)) || !HASH.test(String(parsed.briefHash))) {
    fail('Run Contract 协议或权限无效')
  }
  if (!Array.isArray(parsed.allowedContextSourceKeys)
    || parsed.allowedContextSourceKeys.length !== 1
    || parsed.allowedContextSourceKeys[0] !== 'characterInteractionProduction') {
    fail('Run Contract 只能读取角色互动生产上下文')
  }
  const allowed = [...CHARACTER_INTERACTION_PRODUCTION_STEPS_V1]
  if (!Array.isArray(parsed.allowedSteps) || parsed.allowedSteps.length !== allowed.length
    || parsed.allowedSteps.some((step, index) => step !== allowed[index])
    || !Array.isArray(parsed.requiredHumanConfirmations)
    || parsed.requiredHumanConfirmations.length !== allowed.length
    || parsed.requiredHumanConfirmations.some((step, index) => step !== allowed[index])) {
    fail('Run Contract 步骤或人工确认点无效')
  }
  return {
    schema: 'storyforge.character-interaction-production-run-contract',
    version: 1,
    productType: 'character-interaction',
    contractVersion: 1,
    sourceWorldReleaseId: positiveInteger(parsed.sourceWorldReleaseId, 'RunContract.sourceWorldReleaseId'),
    sourceSelectionHash: String(parsed.sourceSelectionHash),
    briefHash: String(parsed.briefHash),
    allowedContextSourceKeys: ['characterInteractionProduction'],
    allowedSteps: allowed,
    writeMode: 'candidate-only',
    worldWritebackAllowed: false,
    formalMediaWriteAllowed: false,
    requiredHumanConfirmations: allowed,
  }
}

async function buildRunContract(input: {
  selection: CharacterInteractionWorldSourceSelectionV1
  briefHash: string
}): Promise<{ contract: CharacterInteractionProductionRunContractV1; hash: string }> {
  const contract = deepFreeze(parseCharacterInteractionProductionRunContractV1({
    schema: 'storyforge.character-interaction-production-run-contract',
    version: 1,
    productType: 'character-interaction',
    contractVersion: 1,
    sourceWorldReleaseId: input.selection.worldReleaseId,
    sourceSelectionHash: input.selection.selectionHash,
    briefHash: input.briefHash,
    allowedContextSourceKeys: ['characterInteractionProduction'],
    allowedSteps: [...CHARACTER_INTERACTION_PRODUCTION_STEPS_V1],
    writeMode: 'candidate-only',
    worldWritebackAllowed: false,
    formalMediaWriteAllowed: false,
    requiredHumanConfirmations: [...CHARACTER_INTERACTION_PRODUCTION_STEPS_V1],
  }))
  return { contract, hash: await hashCharacterInteractionRunContractV1(contract) }
}

export interface CharacterInteractionProductionBundleV1 {
  production: CharacterInteractionProductionRecordV1 & { id: number }
  sourceRecord: CharacterInteractionSourceSelectionRecordV1 & { id: number }
  selection: CharacterInteractionWorldSourceSelectionV1
  catalog: CharacterInteractionWorldSourceCatalogV1
  briefRecord: CharacterInteractionBriefRecordV1 & { id: number }
  brief: CharacterInteractionBriefV1
  runContract: CharacterInteractionProductionRunContractV1 | null
  worldReference: WorldReferenceV1 | null
  sourcePlan: ProductSourcePlanV1 | null
  confirmedBriefContract: ConfirmedProductBriefV1 | null
}

async function requireScope(input: WorkspaceScope): Promise<WorkspaceScope> {
  return resolveScope({ scope: input })
}

function assertRowScope(scope: WorkspaceScope, row: { projectId: number; worldId: number; workId: number }, label: string): void {
  if (row.projectId !== scope.projectId || row.worldId !== scope.worldId || row.workId !== scope.workId) {
    fail(`${label} 不属于当前 WorkspaceScope`)
  }
}

export async function loadCharacterInteractionProductionV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<CharacterInteractionProductionBundleV1> {
  const scope = await requireScope(input.scope)
  const production = await db.characterInteractionProductions.get(positiveInteger(input.productionId, 'productionId'))
  if (!production?.id) fail('角色互动生产不存在')
  assertRowScope(scope, production, '生产根')
  if (production.activeSourceSelectionId == null || production.activeBriefId == null) fail('生产根缺少活动来源或 Brief')
  const [sourceRecord, briefRecord] = await Promise.all([
    db.characterInteractionSourceSelections.get(production.activeSourceSelectionId),
    db.characterInteractionBriefs.get(production.activeBriefId),
  ])
  if (!sourceRecord?.id || !briefRecord?.id || sourceRecord.productionId !== production.id
    || briefRecord.productionId !== production.id || briefRecord.sourceSelectionId !== sourceRecord.id) {
    fail('生产根的来源或 Brief 引用无效')
  }
  assertRowScope(scope, sourceRecord, '来源选择')
  assertRowScope(scope, briefRecord, 'Brief')
  const selection = deepFreeze(parseCharacterInteractionWorldSourceSelectionV1(sourceRecord.selectionJson))
  if (selection.selectionHash !== sourceRecord.selectionHash
    || selection.worldContentHash !== sourceRecord.worldContentHash
    || selection.worldReleaseId !== sourceRecord.sourceWorldReleaseId) {
    fail('来源记录与 Selection 身份不一致')
  }
  await validateCharacterInteractionWorldSourceSelectionV1({ scope, selection })
  const catalog = deepFreeze(await loadCharacterInteractionWorldSourceCatalogV1({
    scope,
    worldReleaseId: sourceRecord.sourceWorldReleaseId,
  }))
  const brief = deepFreeze(parseCharacterInteractionBriefV1(briefRecord.briefJson))
  if (await hashCharacterInteractionBriefV1(brief) !== briefRecord.briefHash
    || brief.source.selectionHash !== selection.selectionHash) {
    fail('Brief hash 或来源身份已漂移')
  }
  let runContract: CharacterInteractionProductionRunContractV1 | null = null
  let worldReference: WorldReferenceV1 | null = null
  let sourcePlan: ProductSourcePlanV1 | null = null
  let confirmedBriefContract: ConfirmedProductBriefV1 | null = null
  const hasSourceContracts = sourceRecord.worldReferenceJson != null || sourceRecord.worldReferenceHash != null
    || sourceRecord.sourcePlanJson != null || sourceRecord.sourcePlanHash != null
  if (hasSourceContracts) {
    if (!sourceRecord.worldReferenceJson || !sourceRecord.worldReferenceHash
      || !sourceRecord.sourcePlanJson || !sourceRecord.sourcePlanHash) {
      fail('来源行的 WorldReference/SourcePlan 合同不完整')
    }
    worldReference = await validateWorldReferenceV1(JSON.parse(sourceRecord.worldReferenceJson) as WorldReferenceV1)
    sourcePlan = await validateProductSourcePlanV1(JSON.parse(sourceRecord.sourcePlanJson) as ProductSourcePlanV1)
    if (worldReference.referenceHash !== sourceRecord.worldReferenceHash
      || sourcePlan.planHash !== sourceRecord.sourcePlanHash
      || sourcePlan.worldReference.referenceHash !== worldReference.referenceHash
      || sourcePlan.productType !== 'character-interaction'
      || sourcePlan.productInstanceKey !== production.productionKey) {
      fail('来源行的 WorldReference/SourcePlan owner 或 hash 不一致')
    }
  }
  if (briefRecord.status === 'confirmed') {
    if (!briefRecord.runContractJson || !briefRecord.runContractHash || !briefRecord.confirmedAt) {
      fail('已确认 Brief 缺少 Run Contract')
    }
    runContract = deepFreeze(parseCharacterInteractionProductionRunContractV1(briefRecord.runContractJson))
    if (await hashCharacterInteractionRunContractV1(runContract) !== briefRecord.runContractHash
      || runContract.briefHash !== briefRecord.briefHash
      || runContract.sourceSelectionHash !== selection.selectionHash) {
      fail('Run Contract hash 或来源身份已漂移')
    }
    if (briefRecord.confirmedContractJson || briefRecord.confirmedContractHash || briefRecord.authorStartRevision != null) {
      if (!sourcePlan || !briefRecord.confirmedContractJson || !briefRecord.confirmedContractHash
        || briefRecord.authorStartRevision == null) fail('确认 Brief 的跨阶段合同不完整')
      confirmedBriefContract = await validateConfirmedProductBriefV1({
        brief: JSON.parse(briefRecord.confirmedContractJson) as ConfirmedProductBriefV1,
        sourcePlan,
      })
      if (confirmedBriefContract.confirmationHash !== briefRecord.confirmedContractHash
        || confirmedBriefContract.authorStartRevision !== briefRecord.authorStartRevision
        || confirmedBriefContract.briefContentHash !== briefRecord.briefHash) {
        fail('ConfirmedProductBrief 与产品 Brief 行不一致')
      }
    }
  } else if (briefRecord.runContractJson != null || briefRecord.runContractHash != null || briefRecord.confirmedAt != null) {
    fail('草稿 Brief 不得持有正式 Run Contract')
  }
  return {
    production: production as CharacterInteractionProductionRecordV1 & { id: number },
    sourceRecord: sourceRecord as CharacterInteractionSourceSelectionRecordV1 & { id: number },
    selection,
    catalog,
    briefRecord: briefRecord as CharacterInteractionBriefRecordV1 & { id: number },
    brief,
    runContract,
    worldReference,
    sourcePlan,
    confirmedBriefContract,
  }
}

export async function listCharacterInteractionProductionsV1(
  scopeInput: WorkspaceScope,
): Promise<CharacterInteractionProductionRecordV1[]> {
  const scope = await requireScope(scopeInput)
  return db.characterInteractionProductions.where('workId').equals(scope.workId)
    .and(row => row.projectId === scope.projectId && row.worldId === scope.worldId)
    .reverse().sortBy('updatedAt')
}

export async function createCharacterInteractionProductionV1(input: {
  scope: WorkspaceScope
  productionKey: string
  worldReleaseId: number
  participantCharacterExportIds: number[]
  optionalRecordSelections?: Array<{
    table: Exclude<CharacterInteractionWorldSourceTableV1, 'characters' | 'workCharacterBindings' | 'characterRelations'>
    exportIds: number[]
  }>
  brief: CharacterInteractionBriefInputV1
}): Promise<CharacterInteractionProductionBundleV1> {
  const scope = await requireScope(input.scope)
  const productionKey = text(input.productionKey, 'productionKey', 160)
  if (!STABLE_KEY.test(productionKey)) fail('productionKey 不是稳定 key')
  const guestKeys = (input.brief.guests ?? []).map(item => item.guestKey)
  const catalog = await loadCharacterInteractionWorldSourceCatalogV1({ scope, worldReleaseId: input.worldReleaseId })
  const selection = await freezeCharacterInteractionWorldSourceSelectionV1({
    scope,
    worldReleaseId: input.worldReleaseId,
    participantCharacterExportIds: input.participantCharacterExportIds,
    optionalRecordSelections: input.optionalRecordSelections,
    guestCharacterKeys: guestKeys,
  })
  const brief = buildCharacterInteractionBriefV1({ catalog, selection, brief: input.brief })
  const briefHash = await hashCharacterInteractionBriefV1(brief)
  await validateCharacterInteractionWorldSourceSelectionV1({ scope, selection })
  const worldReference = await createWorldReferenceV1(input.worldReleaseId)
  const releaseScope = await worldReferenceResourceScopeV1(worldReference)
  const descriptors = await listAllWorldReleaseResourceDescriptorsV1(releaseScope)
  const selectedCharacterCoordinates = new Set(input.participantCharacterExportIds.map(String))
  const initialResourceKeys = descriptors.filter(descriptor => (
    descriptor.worldSemantic?.resourceKind === 'character'
      && selectedCharacterCoordinates.has(descriptor.worldSemantic.resourceCoordinate)
  )).map(descriptor => descriptor.resourceKey)
  const sourcePlan = await freezeProductSourcePlanV1({
    productInstanceKey: productionKey,
    worldReference,
    adapter: CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V1,
    goal: {
      // Guest characters are product-private Brief data, not WorldRelease
      // resources. Requiring a world character for every guest makes a valid
      // mixed/guest production permanently impossible to publish.
      participantCount: input.participantCharacterExportIds.length,
      inheritStoryContinuity: input.brief.storyMode === 'inherit-ending',
      allowCrossWorld: false,
    },
    missingStrategy: 'product-private-supplement',
    initialResourceKeys,
    createdAt: Date.now(),
  })
  const now = Date.now()
  let productionId = 0
  await db.transaction('rw', [
    db.worldReleases,
    db.characterInteractionProductions,
    db.characterInteractionSourceSelections,
    db.characterInteractionBriefs,
  ], async () => {
    const release = await db.worldReleases.get(selection.worldReleaseId)
    if (!release || release.projectId !== scope.projectId || release.worldId !== scope.worldId
      || release.contentHash !== selection.worldContentHash) {
      fail('写入前 WorldRelease 身份已变化')
    }
    if (await db.characterInteractionProductions.where('[workId+productionKey]')
      .equals([scope.workId, productionKey]).first()) fail('productionKey 已存在')
    productionId = await db.characterInteractionProductions.add({
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      productionKey,
      title: brief.title,
      status: 'brief-draft',
      activeSourceSelectionId: null,
      activeBriefId: null,
      createdAt: now,
      updatedAt: now,
    }) as number
    const sourceSelectionId = await db.characterInteractionSourceSelections.add({
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      productionId,
      revision: 1,
      status: 'frozen',
      sourceWorldReleaseId: selection.worldReleaseId,
      selectionJson: stableJson(selection),
      selectionHash: selection.selectionHash,
      worldContentHash: selection.worldContentHash,
      worldReferenceJson: stableJson(worldReference),
      worldReferenceHash: worldReference.referenceHash,
      sourcePlanJson: stableJson(sourcePlan),
      sourcePlanHash: sourcePlan.planHash,
      createdAt: now,
    }) as number
    const briefId = await db.characterInteractionBriefs.add({
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      productionId,
      sourceSelectionId,
      revision: 1,
      status: 'draft',
      briefJson: stableJson(brief),
      briefHash,
      runContractJson: null,
      runContractHash: null,
      confirmedAt: null,
      confirmedContractJson: null,
      confirmedContractHash: null,
      authorStartRevision: null,
      createdAt: now,
    }) as number
    const updated = await db.characterInteractionProductions.update(productionId, {
      activeSourceSelectionId: sourceSelectionId,
      activeBriefId: briefId,
    })
    if (updated !== 1) fail('生产根来源接线失败')
  })
  return loadCharacterInteractionProductionV1({ scope, productionId })
}

export async function confirmCharacterInteractionBriefV1(input: {
  scope: WorkspaceScope
  productionId: number
  brief?: CharacterInteractionBriefV1
}): Promise<CharacterInteractionProductionBundleV1> {
  const scope = await requireScope(input.scope)
  const current = await loadCharacterInteractionProductionV1({ scope, productionId: input.productionId })
  if (current.production.status !== 'brief-draft' || current.briefRecord.status !== 'draft') {
    fail('只有 Brief 草稿可以确认')
  }
  const brief = parseCharacterInteractionBriefV1(input.brief ?? current.brief)
  if (brief.source.worldReleaseId !== current.selection.worldReleaseId
    || brief.source.worldContentHash !== current.selection.worldContentHash
    || brief.source.selectionHash !== current.selection.selectionHash) {
    fail('Brief 不能更换冻结来源')
  }
  const expectedGuestKeys = [...current.selection.guestCharacterKeys].sort()
  const briefGuestKeys = brief.guests.map(item => item.guestKey).sort()
  if (stableJson(expectedGuestKeys) !== stableJson(briefGuestKeys)) fail('Brief guest 与冻结 Selection 不一致')
  await validateCharacterInteractionWorldSourceSelectionV1({ scope, selection: current.selection })
  const briefHash = await hashCharacterInteractionBriefV1(brief)
  const run = await buildRunContract({ selection: current.selection, briefHash })
  if (!current.sourcePlan) fail('新正式生产必须先冻结 ProductSourcePlan')
  const now = Date.now()
  const existingBriefs = await db.characterInteractionBriefs.where('productionId')
    .equals(current.production.id).toArray()
  const revision = Math.max(0, ...existingBriefs.map(item => item.revision)) + 1
  // Contract validation reads and hashes the immutable WorldRelease. Do it
  // before entering the write transaction, then re-check the exact release
  // identity and next revision inside the transaction. Nested Dexie.waitFor
  // around WebCrypto + IndexedDB reads can otherwise keep the transaction
  // alive indefinitely in browsers/fake-indexeddb.
  const confirmedContract = await createConfirmedProductBriefV1({
    productType: 'character-interaction',
    productInstanceKey: current.production.productionKey,
    sourcePlan: current.sourcePlan,
    briefRevision: revision,
    briefContentHash: briefHash,
    authorStartRevision: revision,
    confirmedAt: now,
  })
  let briefId = 0
  await db.transaction('rw', [
    db.worldReleases,
    db.characterInteractionProductions,
    db.characterInteractionBriefs,
  ], async () => {
    const production = await db.characterInteractionProductions.get(current.production.id)
    if (!production || production.status !== 'brief-draft'
      || production.activeSourceSelectionId !== current.sourceRecord.id
      || production.activeBriefId !== current.briefRecord.id) {
      fail('确认前生产根已变化')
    }
    const latest = await db.characterInteractionBriefs.where('productionId').equals(production.id!).toArray()
    if (Math.max(0, ...latest.map(item => item.revision)) + 1 !== revision) fail('确认前 Brief revision 已变化')
    const release = await db.worldReleases.get(current.sourcePlan!.worldReference.localReleaseRecordId)
    if (!release || release.contentHash !== current.sourcePlan!.worldReference.releaseHash) {
      fail('确认前 WorldReference 已变化')
    }
    briefId = await db.characterInteractionBriefs.add({
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      productionId: production.id!,
      sourceSelectionId: current.sourceRecord.id,
      revision,
      status: 'confirmed',
      briefJson: stableJson(brief),
      briefHash,
      runContractJson: stableJson(run.contract),
      runContractHash: run.hash,
      confirmedAt: now,
      confirmedContractJson: stableJson(confirmedContract),
      confirmedContractHash: confirmedContract.confirmationHash,
      authorStartRevision: revision,
      createdAt: now,
    }) as number
    const updated = await db.characterInteractionProductions.update(production.id!, {
      title: brief.title,
      status: 'brief-confirmed',
      activeBriefId: briefId,
      updatedAt: now,
    })
    if (updated !== 1) fail('Brief 确认接线失败')
  })
  return loadCharacterInteractionProductionV1({ scope, productionId: current.production.id })
}

/** The single gate future formal Agent/AI/media entrypoints must call first. */
export async function assertCharacterInteractionFormalProductionReadyV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<CharacterInteractionProductionBundleV1> {
  const bundle = await loadCharacterInteractionProductionV1(input)
  if (bundle.production.status === 'brief-draft' || bundle.briefRecord.status !== 'confirmed'
    || !bundle.runContract) fail('正式生产要求 frozen Selection + confirmed Brief + verified Run Contract')
  if (!bundle.worldReference || !bundle.sourcePlan || !bundle.confirmedBriefContract
    || bundle.briefRecord.authorStartRevision == null) {
    fail('正式生产要求 WorldReference + ProductSourcePlan + ConfirmedProductBrief + 用户开始授权')
  }
  await assertFormalProductProductionStartV1({
    sourcePlan: bundle.sourcePlan,
    confirmedBrief: bundle.confirmedBriefContract,
    authorStartRevision: bundle.briefRecord.authorStartRevision,
  })
  await validateCharacterInteractionWorldSourceSelectionV1({ scope: input.scope, selection: bundle.selection })
  return bundle
}

/** Registered CONTEXT_SOURCES reader; never reads active world authoring tables. */
export async function readCharacterInteractionProductionContextV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<string> {
  const bundle = await assertCharacterInteractionFormalProductionReadyV1(input)
  return [
    `【角色互动产品自有生产约束】${bundle.production.title}`,
    '世界语义正文不在此来源中；正式 Harness 只能通过 WorldReference + ProductSourcePlan 打开中立 WorldRelease Gateway。',
    `WorldReference=${bundle.worldReference!.referenceHash}`,
    `SourcePlan=${bundle.sourcePlan!.planHash}`,
    `Selection=${bundle.selection.selectionHash} / Brief=${bundle.briefRecord.briefHash}`,
    `ConfirmedBrief=${bundle.confirmedBriefContract!.confirmationHash} / RunContract=${bundle.briefRecord.runContractHash}`,
    stableJson({
      brief: bundle.brief,
      selectedWorldResourceKeys: bundle.sourcePlan!.initialResourceKeys,
      sourceRequirements: bundle.sourcePlan!.requirements.map(requirement => ({
        key: requirement.key,
        level: requirement.level,
        status: requirement.status,
        minimumResources: requirement.minimumResources,
      })),
    }),
  ].join('\n')
}
