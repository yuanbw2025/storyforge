import { estimateTokens } from '../ai/context-budget'
import { resolveRequestConfig, type ChatResult } from '../ai/client'
import { computeKnownCostUsd } from '../ai/usage-log'
import {
  appendAgentEvent,
  getOrCreateAgentConversation,
  readAgentEvents,
} from '../agent/conversations'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import {
  executeRegisteredAIEntryV1,
  freezeFormalAIEntryBindingV1,
} from '../agent/formal-ai-entry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { db } from '../db/schema'
import { executeProductProductionCommand } from '../product-production/commands'
import { assembleContext } from '../registry/assemble-context'
import type {
  AgentConversation,
  AgentEvent,
  AIConfig,
  ChatMessage,
  TextOpenWorldCreatorBriefCandidateV1,
  TextOpenWorldCreatorBriefDraftV1,
  TextOpenWorldCreatorBriefModelEvidenceV1,
  TextOpenWorldCreatorBriefSynthesisV1,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorSourceBindingV1,
  TextOpenWorldCreatorSourceSelectionV1,
  TextOpenWorldCreatorSourceSummaryV1,
  ProductProductionRecordV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, readOwnedRows, scopeTransactionTables } from '../workspace/scope'
import { DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1 } from './product-config'
import {
  createTextOpenWorldCreatorSourceLocatorV1,
  inspectTextOpenWorldCreatorSourceLocatorV1,
  TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_BRIEF_VERIFIER_V1,
  TEXT_OPEN_WORLD_CREATOR_PRODUCT_BOUNDARY_V1,
  textOpenWorldCreatorLocatorFromProductionV1,
  textOpenWorldCreatorSourceBindingFromSelectionV1,
  textOpenWorldCreatorSourceSummaryFromSelectionV1,
  verifyTextOpenWorldCreatorBriefV1,
} from './creator-brief-persistence'

export {
  TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_BRIEF_VERIFIER_V1,
  TEXT_OPEN_WORLD_CREATOR_PRODUCT_BOUNDARY_V1,
} from './creator-brief-persistence'

export const TEXT_OPEN_WORLD_CREATOR_BRIEF_PURPOSE_PREFIX_V1 = 'text-open-world.creator-brief.v1:'
export const TEXT_OPEN_WORLD_CREATOR_BRIEF_SKILL_ID_V1 = 'text-open-world.creator-brief-consult.v1'
export const TEXT_OPEN_WORLD_CREATOR_BRIEF_ENTRY_ID_V1 = 'text-open-world.creator-brief.consult'

const HASH = /^[a-f0-9]{64}$/
const MAX_LIST_ITEMS = 24
const MAX_TEXT = 8_000

type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>

interface CreatorBriefSessionStartEventV1 {
  schema: 'storyforge.text-open-world-creator-brief-session-start'
  version: 1
  productInstanceKey: string
  sourceBinding: TextOpenWorldCreatorSourceBindingV1
  sourceBindingHash: string
  sourceSummary: TextOpenWorldCreatorSourceSummaryV1
  initialDraft: TextOpenWorldCreatorBriefDraftV1
  createdAt: number
}

interface CreatorBriefDraftEventV1 {
  schema: 'storyforge.text-open-world-creator-brief-draft-event'
  version: 1
  sourceBindingHash: string
  draft: TextOpenWorldCreatorBriefDraftV1
  draftHash: string
  savedAt: number
}

interface CreatorBriefCandidateEventV1 {
  schema: 'storyforge.text-open-world-creator-brief-candidate-event'
  version: 1
  sourceBindingHash: string
  draft: TextOpenWorldCreatorBriefDraftV1
  candidate: TextOpenWorldCreatorBriefCandidateV1
}

interface CreatorBriefConfirmationEventV1 {
  schema: 'storyforge.text-open-world-creator-brief-confirmation-event'
  version: 1
  sourceBindingHash: string
  brief: TextOpenWorldCreatorBriefV1
}

export interface TextOpenWorldCreatorBriefSessionV1 {
  scope: WorkspaceScope
  conversation: AgentConversation & { id: number }
  production: ProductProductionRecordV1 & { id: number }
  productInstanceKey: string
  selection: TextOpenWorldCreatorSourceSelectionV1 | null
  sourceBinding: TextOpenWorldCreatorSourceBindingV1
  sourceBindingHash: string
  sourceSummary: TextOpenWorldCreatorSourceSummaryV1
  draft: TextOpenWorldCreatorBriefDraftV1
  candidate: TextOpenWorldCreatorBriefCandidateV1 | null
  candidateRunId: number | null
  confirmedBrief: TextOpenWorldCreatorBriefV1 | null
  sourceIssue: string | null
}

/** Exact, credential-free identity used to resume one creator conversation
 * after a settings round-trip. It deliberately carries the portable source
 * binding rather than source text or a local database locator. */
export interface TextOpenWorldCreatorBriefResumeTargetV1 {
  conversationId: number
  productInstanceKey: string
  sourceBindingHash: string
  sourceBinding: TextOpenWorldCreatorSourceBindingV1
}

export class TextOpenWorldCreatorBriefErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[text-open-world-creator-brief:${code}] ${message}`)
    this.name = 'TextOpenWorldCreatorBriefErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new TextOpenWorldCreatorBriefErrorV1(code, message)
}

function requiredRunBindingHash(snapshot: AgentRunSnapshotV1): string {
  const value = snapshot.contract.runtimeBindingHash
  if (!value || !HASH.test(value)) fail('run-binding', 'Creator Brief Run 缺少可移植的运行绑定 Hash')
  return value
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('protocol', `${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('protocol', `${label} 字段不精确：${actual.join(',')}`)
  }
}

function textValue(value: unknown, label: string, maximum = MAX_TEXT, allowEmpty = false): string {
  if (typeof value !== 'string') fail('protocol', `${label} 必须是字符串`)
  const normalized = value.trim()
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    fail('protocol', `${label} 为空或超过 ${maximum} 字符`)
  }
  return normalized
}

function listValue(value: unknown, label: string, options: { minimum?: number; maximum?: number } = {}): string[] {
  if (!Array.isArray(value)) fail('protocol', `${label} 必须是数组`)
  const items = value.map((item, index) => textValue(item, `${label}[${index}]`, 1_000))
  if (items.length < (options.minimum ?? 0) || items.length > (options.maximum ?? MAX_LIST_ITEMS)) {
    fail('protocol', `${label} 数量必须在 ${options.minimum ?? 0} 到 ${options.maximum ?? MAX_LIST_ITEMS} 之间`)
  }
  if (new Set(items).size !== items.length) fail('protocol', `${label} 不得重复`)
  return items
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('protocol', `${label} 必须是 ${minimum} 到 ${maximum} 的整数`)
  }
  return value as number
}

function rangeValue(value: unknown, label: string, minimum: number, maximum: number) {
  const parsed = record(value, label)
  exact(parsed, ['minimum', 'maximum'], label)
  const lower = integer(parsed.minimum, `${label}.minimum`, minimum, maximum)
  const upper = integer(parsed.maximum, `${label}.maximum`, minimum, maximum)
  if (lower > upper) fail('protocol', `${label} 下限不能大于上限`)
  return { minimum: lower, maximum: upper }
}

export function parseTextOpenWorldCreatorBriefDraftV1(value: unknown): TextOpenWorldCreatorBriefDraftV1 {
  const root = record(value, 'creatorBriefDraft')
  exact(root, [
    'schema', 'version', 'gameTitle', 'playerRole', 'playerFantasy', 'protagonistMode',
    'protagonistDirective', 'coreGoal', 'primaryConflict', 'openingSituation',
    'experiencePillars', 'toneKeywords', 'mustKeep', 'allowedInferences', 'forbiddenChanges',
    'contentRating', 'contentBoundaries', 'authorNotes', 'unresolvedQuestions',
    'acceptedAssumptions', 'scale', 'media', 'completion',
  ], 'creatorBriefDraft')
  if (root.schema !== 'storyforge.text-open-world-creator-brief-draft' || root.version !== 1) {
    fail('protocol', 'creatorBriefDraft schema/version 无效')
  }
  const protagonistMode = root.protagonistMode
  if (protagonistMode !== 'source-character' && protagonistMode !== 'author-defined') {
    fail('protocol', 'protagonistMode 无效')
  }
  const scale = record(root.scale, 'scale')
  exact(scale, [
    'regions', 'namedLocations', 'mainlineStages', 'endings', 'significantStorylines',
    'ordinaryQuests', 'taskTemplates', 'randomEvents', 'requiredPlayMinutes',
    'optionalInventoryMinutes',
  ], 'scale')
  const media = record(root.media, 'media')
  exact(media, ['proceduralMap', 'characterPortraits', 'sceneBackgrounds', 'audio', 'artDirection'], 'media')
  if (media.proceduralMap !== 'required' || media.characterPortraits !== 'required'
    || media.sceneBackgrounds !== 'required' || !['none', 'optional'].includes(String(media.audio))) {
    fail('protocol', '媒资意图超出当前产品能力')
  }
  const completion = record(root.completion, 'completion')
  exact(completion, [
    'playablePreviewRequired', 'deterministicGatesRequired', 'semanticReviewRequired',
    'publishAfterGates', 'humanPlaytest', 'repairPolicy',
  ], 'completion')
  if (completion.playablePreviewRequired !== true || completion.deterministicGatesRequired !== true
    || completion.semanticReviewRequired !== true || completion.publishAfterGates !== true
    || completion.humanPlaytest !== 'post-release' || completion.repairPolicy !== 'new-release') {
    fail('protocol', '完成条件不能绕过试玩、质量门、发布或新版本修复策略')
  }
  return {
    schema: 'storyforge.text-open-world-creator-brief-draft',
    version: 1,
    gameTitle: textValue(root.gameTitle, 'gameTitle', 200),
    playerRole: textValue(root.playerRole, 'playerRole', 2_000),
    playerFantasy: textValue(root.playerFantasy, 'playerFantasy', 2_000),
    protagonistMode,
    protagonistDirective: textValue(root.protagonistDirective, 'protagonistDirective', 2_000),
    coreGoal: textValue(root.coreGoal, 'coreGoal', 2_000),
    primaryConflict: textValue(root.primaryConflict, 'primaryConflict', 2_000),
    openingSituation: textValue(root.openingSituation, 'openingSituation', 2_000),
    experiencePillars: listValue(root.experiencePillars, 'experiencePillars', { minimum: 2, maximum: 8 }),
    toneKeywords: listValue(root.toneKeywords, 'toneKeywords', { minimum: 1, maximum: 12 }),
    mustKeep: listValue(root.mustKeep, 'mustKeep', { maximum: 24 }),
    allowedInferences: listValue(root.allowedInferences, 'allowedInferences', { maximum: 24 }),
    forbiddenChanges: listValue(root.forbiddenChanges, 'forbiddenChanges', { minimum: 1, maximum: 24 }),
    contentRating: textValue(root.contentRating, 'contentRating', 100),
    contentBoundaries: listValue(root.contentBoundaries, 'contentBoundaries', { maximum: 24 }),
    authorNotes: textValue(root.authorNotes, 'authorNotes', 4_000, true),
    unresolvedQuestions: listValue(root.unresolvedQuestions, 'unresolvedQuestions', { maximum: 24 }),
    acceptedAssumptions: listValue(root.acceptedAssumptions, 'acceptedAssumptions', { maximum: 24 }),
    scale: {
      regions: integer(scale.regions, 'scale.regions', 1, 12),
      namedLocations: rangeValue(scale.namedLocations, 'scale.namedLocations', 2, 100),
      mainlineStages: rangeValue(scale.mainlineStages, 'scale.mainlineStages', 2, 60),
      endings: integer(scale.endings, 'scale.endings', 1, 12),
      significantStorylines: integer(scale.significantStorylines, 'scale.significantStorylines', 0, 30),
      ordinaryQuests: rangeValue(scale.ordinaryQuests, 'scale.ordinaryQuests', 0, 200),
      taskTemplates: rangeValue(scale.taskTemplates, 'scale.taskTemplates', 0, 100),
      randomEvents: rangeValue(scale.randomEvents, 'scale.randomEvents', 0, 500),
      requiredPlayMinutes: rangeValue(scale.requiredPlayMinutes, 'scale.requiredPlayMinutes', 10, 10_000),
      optionalInventoryMinutes: rangeValue(scale.optionalInventoryMinutes, 'scale.optionalInventoryMinutes', 0, 20_000),
    },
    media: {
      proceduralMap: 'required',
      characterPortraits: 'required',
      sceneBackgrounds: 'required',
      audio: media.audio as 'none' | 'optional',
      artDirection: textValue(media.artDirection, 'media.artDirection', 2_000, true),
    },
    completion: {
      playablePreviewRequired: true,
      deterministicGatesRequired: true,
      semanticReviewRequired: true,
      publishAfterGates: true,
      humanPlaytest: 'post-release',
      repairPolicy: 'new-release',
    },
  }
}

export function createDefaultTextOpenWorldCreatorBriefDraftV1(
  selection: TextOpenWorldCreatorSourceSelectionV1,
): TextOpenWorldCreatorBriefDraftV1 {
  const title = selection.sourceKind === 'world-release'
    ? `${selection.preview.worldName}开放世界`
    : `${selection.preview.workTitle}开放世界`
  const scale = DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1.defaultScale
  return parseTextOpenWorldCreatorBriefDraftV1({
    schema: 'storyforge.text-open-world-creator-brief-draft',
    version: 1,
    gameTitle: title,
    playerRole: '由作者设定主角，或从来源中选择适合承担核心目标的角色。',
    playerFantasy: '在一个持续演化的世界里成长、旅行，并完成一条长期主线与多条故事线。',
    protagonistMode: 'author-defined',
    protagonistDirective: '主角身份必须能自然进入开场，并拥有推进核心目标的现实动机。',
    coreGoal: '沿严格顺序主线成长并完成核心目标，同时允许探索地区故事与普通任务。',
    primaryConflict: '主角的长期目标与持续演化的地区、人物和势力问题相互牵引。',
    openingSituation: '从主地图中的一个起始地区和明确可执行的首个任务开始。',
    experiencePillars: ['长期主线成长', '重要角色与地区故事', '自由探索与随机冒险'],
    toneKeywords: ['沉浸', '冒险', '成长'],
    mustKeep: [],
    allowedInferences: ['允许在不违背来源事实的前提下补齐游戏化连接内容。'],
    forbiddenChanges: ['不得改写已确认来源事实、人物核心身份和世界硬规则。'],
    contentRating: '由作者确认；默认避免露骨成人内容。',
    contentBoundaries: [],
    authorNotes: '',
    unresolvedQuestions: [],
    acceptedAssumptions: [],
    scale: structuredClone(scale),
    media: {
      proceduralMap: 'required',
      characterPortraits: 'required',
      sceneBackgrounds: 'required',
      audio: 'none',
      artDirection: '',
    },
    completion: {
      playablePreviewRequired: true,
      deterministicGatesRequired: true,
      semanticReviewRequired: true,
      publishAfterGates: true,
      humanPlaytest: 'post-release',
      repairPolicy: 'new-release',
    },
  })
}

function selectionBinding(selection: TextOpenWorldCreatorSourceSelectionV1): TextOpenWorldCreatorSourceBindingV1 {
  return textOpenWorldCreatorSourceBindingFromSelectionV1(selection)
}

function sourceSummary(selection: TextOpenWorldCreatorSourceSelectionV1): TextOpenWorldCreatorSourceSummaryV1 {
  return textOpenWorldCreatorSourceSummaryFromSelectionV1(selection)
}

function sameScope(left: WorkspaceScope, right: WorkspaceScope): boolean {
  return left.projectId === right.projectId && left.worldId === right.worldId && left.workId === right.workId
}

async function recheckSelection(selection: TextOpenWorldCreatorSourceSelectionV1): Promise<TextOpenWorldCreatorSourceSelectionV1> {
  const inspected = await inspectTextOpenWorldCreatorSourceLocatorV1({
    scope: selection.sourceScope,
    locator: createTextOpenWorldCreatorSourceLocatorV1(selection),
  })
  if (inspected.bindingHash !== await hashCanonicalValue(selectionBinding(selection))) {
    fail('source-stale', '来源版本、边界或能力身份已变化，请重新选择来源')
  }
  return inspected.selection
}

function parseEventPayload(event: AgentEvent): unknown {
  try { return JSON.parse(event.payload) as unknown }
  catch { fail('event-corrupt', `会谈事件 #${event.sequence} 的 payload 已损坏`) }
}

function isSessionStart(value: unknown): value is CreatorBriefSessionStartEventV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<CreatorBriefSessionStartEventV1>
  return row.schema === 'storyforge.text-open-world-creator-brief-session-start' && row.version === 1
}

function isDraftEvent(value: unknown): value is CreatorBriefDraftEventV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<CreatorBriefDraftEventV1>
  return row.schema === 'storyforge.text-open-world-creator-brief-draft-event' && row.version === 1
}

function isCandidateEvent(value: unknown): value is CreatorBriefCandidateEventV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<CreatorBriefCandidateEventV1>
  return row.schema === 'storyforge.text-open-world-creator-brief-candidate-event' && row.version === 1
}

function isConfirmationEvent(value: unknown): value is CreatorBriefConfirmationEventV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<CreatorBriefConfirmationEventV1>
  return row.schema === 'storyforge.text-open-world-creator-brief-confirmation-event' && row.version === 1
}

async function hydrateSession(
  scope: WorkspaceScope,
  conversation: AgentConversation & { id: number },
  options: { recheck: boolean },
): Promise<TextOpenWorldCreatorBriefSessionV1> {
  const events = await readAgentEvents(conversation.id, scope)
  const payloads = events.map(event => ({ event, payload: parseEventPayload(event) }))
  const starts = payloads.filter(item => isSessionStart(item.payload))
  if (starts.length !== 1) fail('event-corrupt', '会谈必须且只能有一个来源起点事件')
  const start = starts[0]!.payload as CreatorBriefSessionStartEventV1
  if (!HASH.test(start.sourceBindingHash)) fail('event-corrupt', '会谈来源 Hash 无效')
  const expectedBindingHash = await hashCanonicalValue(start.sourceBinding)
  if (expectedBindingHash !== start.sourceBindingHash) fail('event-corrupt', '会谈来源绑定 Hash 不匹配')
  const production = await db.productProductions
    .where('[workId+productionKey]').equals([scope.workId, start.productInstanceKey]).first()
  if (!production?.id || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'text-open-world'
    || production.creatorSourceBindingHash !== start.sourceBindingHash) {
    fail('production-missing', '会谈对应的 ProductProduction 或来源绑定不存在')
  }
  let draft = parseTextOpenWorldCreatorBriefDraftV1(start.initialDraft)
  let candidate: TextOpenWorldCreatorBriefCandidateV1 | null = null
  let candidateRunId: number | null = null
  let confirmedBrief: TextOpenWorldCreatorBriefV1 | null = null
  for (const item of payloads) {
    if (isDraftEvent(item.payload)) {
      if (item.payload.sourceBindingHash !== start.sourceBindingHash
        || await hashCanonicalValue(item.payload.draft) !== item.payload.draftHash) {
        fail('event-corrupt', `会谈草稿事件 #${item.event.sequence} Hash 不匹配`)
      }
      draft = parseTextOpenWorldCreatorBriefDraftV1(item.payload.draft)
    } else if (isCandidateEvent(item.payload)) {
      if (item.payload.sourceBindingHash !== start.sourceBindingHash
        || item.payload.candidate.sourceBindingHash !== start.sourceBindingHash) {
        fail('event-corrupt', `会谈候选事件 #${item.event.sequence} 来源不匹配`)
      }
      draft = parseTextOpenWorldCreatorBriefDraftV1(item.payload.draft)
      candidate = structuredClone(item.payload.candidate)
      candidateRunId = item.event.durableRunId ?? null
    } else if (isConfirmationEvent(item.payload)) {
      if (item.payload.sourceBindingHash !== start.sourceBindingHash
        || item.payload.brief.sourceBindingHash !== start.sourceBindingHash) {
        fail('event-corrupt', `会谈确认事件 #${item.event.sequence} 来源不匹配`)
      }
      await verifyTextOpenWorldCreatorBriefV1(item.payload.brief)
    }
  }
  if (production.currentBriefRevision != null) {
    const row = await db.productProductionBriefs
      .where('[productionId+revision]').equals([production.id, production.currentBriefRevision]).first()
    if (row?.briefKind === 'text-open-world-creator-v1') {
      confirmedBrief = await verifyTextOpenWorldCreatorBriefV1(row.briefJson)
      if (confirmedBrief.productInstanceKey !== production.productionKey
        || confirmedBrief.sourceBindingHash !== start.sourceBindingHash
        || row.candidateRunId == null) {
        fail('brief-corrupt', '正式 Creator Brief 与 Production/来源/Run 不一致')
      }
      draft = parseTextOpenWorldCreatorBriefDraftV1(confirmedBrief.draft)
      candidateRunId = row.candidateRunId
    }
  }
  let selection: TextOpenWorldCreatorSourceSelectionV1 | null = null
  let sourceIssue: string | null = null
  try {
    const inspected = await inspectTextOpenWorldCreatorSourceLocatorV1({
      scope,
      locator: textOpenWorldCreatorLocatorFromProductionV1(production),
    })
    if (inspected.bindingHash !== start.sourceBindingHash
      || (options.recheck && canonicalStringify(inspected.summary) !== canonicalStringify(start.sourceSummary))) {
      fail('source-stale', '当前来源身份或摘要与会谈起点不一致')
    }
    selection = inspected.selection
  } catch (cause) {
    sourceIssue = cause instanceof Error
      ? cause.message.replace(/^\[[^\]]+\]\s*/, '')
      : '来源无法重新核验'
  }
  return {
    scope,
    conversation,
    production: production as ProductProductionRecordV1 & { id: number },
    productInstanceKey: start.productInstanceKey,
    selection,
    sourceBinding: structuredClone(start.sourceBinding),
    sourceBindingHash: start.sourceBindingHash,
    sourceSummary: structuredClone(start.sourceSummary),
    draft,
    candidate,
    candidateRunId,
    confirmedBrief,
    sourceIssue,
  }
}

function normalizeSessionKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!key || key.length > 100) fail('session-key', '会谈 sessionKey 无效')
  return key
}

function requireSessionSelection(
  session: TextOpenWorldCreatorBriefSessionV1,
): TextOpenWorldCreatorSourceSelectionV1 {
  if (!session.selection || session.sourceIssue) {
    fail('source-stale', session.sourceIssue ?? '来源无法重新定位，请返回来源选择')
  }
  return session.selection
}

export async function startTextOpenWorldCreatorBriefSessionV1(input: {
  selection: TextOpenWorldCreatorSourceSelectionV1
  sessionKey: string
  createdAt?: number
}): Promise<TextOpenWorldCreatorBriefSessionV1> {
  const selection = await recheckSelection(structuredClone(input.selection))
  if (selection.preview.readiness === 'blocked') fail('source-blocked', '来源仍有阻断缺口，不能进入会谈')
  const scope = selection.sourceScope
  const binding = selectionBinding(selection)
  const bindingHash = await hashCanonicalValue(binding)
  const key = normalizeSessionKey(input.sessionKey)
  const productInstanceKey = `text-open-world.${key}.${bindingHash.slice(0, 16)}`
  const createdAt = input.createdAt ?? Date.now()
  const intent = await executeProductProductionCommand({
    scope,
    command: {
      type: 'create-text-open-world-intent',
      commandId: `creator-intent:${bindingHash.slice(0, 40)}:${key}`,
      productionKey: productInstanceKey,
      productType: 'text-open-world',
      sourceLocator: createTextOpenWorldCreatorSourceLocatorV1(selection),
      expectedSourceBindingHash: bindingHash,
      userText: `为“${sourceSummary(selection).label}”创建文字开放世界`,
    },
    now: createdAt,
  })
  if (!intent.ok) fail(intent.errorCode ?? 'production-intent', String(intent.result.message ?? '无法创建 ProductProduction'))
  const purpose = `${TEXT_OPEN_WORLD_CREATOR_BRIEF_PURPOSE_PREFIX_V1}${bindingHash}:${key}`
  const conversation = await getOrCreateAgentConversation({
    projectId: scope.projectId,
    worldGroupId: null,
    purpose,
    title: `${sourceSummary(selection).label} · 开放世界会谈`,
    scope,
  }) as AgentConversation & { id: number }
  await db.transaction(
    'rw',
    scopeTransactionTables(db.agentConversations, db.agentEvents),
    async () => {
      const existing = await readAgentEvents(conversation.id, scope)
      const starts = existing
        .map(event => parseEventPayload(event))
        .filter(isSessionStart)
      if (starts.length > 1) fail('event-corrupt', '会谈存在多个来源起点事件')
      if (starts.length === 1) {
        if (starts[0]!.sourceBindingHash !== bindingHash
          || starts[0]!.productInstanceKey !== productInstanceKey) {
          fail('event-corrupt', '会谈来源起点与当前生产身份不一致')
        }
        return
      }
      const initialDraft = createDefaultTextOpenWorldCreatorBriefDraftV1(selection)
      const payload: CreatorBriefSessionStartEventV1 = {
        schema: 'storyforge.text-open-world-creator-brief-session-start',
        version: 1,
        productInstanceKey,
        sourceBinding: binding,
        sourceBindingHash: bindingHash,
        sourceSummary: sourceSummary(selection),
        initialDraft,
        createdAt,
      }
      await appendAgentEvent({
        projectId: scope.projectId,
        conversationId: conversation.id,
        kind: 'message',
        role: 'user',
        content: `选择来源：${payload.sourceSummary.label}`,
        payload,
        scope,
      })
    },
  )
  return hydrateSession(scope, conversation, { recheck: true })
}

export async function recoverLatestTextOpenWorldCreatorBriefSessionV1(
  scopes: readonly WorkspaceScope[],
): Promise<TextOpenWorldCreatorBriefSessionV1 | null> {
  const uniqueScopes = scopes.filter((scope, index, all) => (
    all.findIndex(candidate => sameScope(candidate, scope)) === index
  ))
  const candidates = (await Promise.all(uniqueScopes.map(async scope => {
    const rows = await readOwnedRows<AgentConversation>(scope, 'agentConversations', { owner: 'work' })
    return rows
      .filter((row): row is AgentConversation & { id: number } => Boolean(
        row.id && row.status === 'active' && row.purpose.startsWith(TEXT_OPEN_WORLD_CREATOR_BRIEF_PURPOSE_PREFIX_V1),
      ))
      .map(conversation => ({ scope, conversation }))
  }))).flat().sort((left, right) => right.conversation.updatedAt - left.conversation.updatedAt)
  for (const candidate of candidates) {
    try { return await hydrateSession(candidate.scope, candidate.conversation, { recheck: true }) }
    catch { /* a corrupt unrelated session must not hide a later valid one */ }
  }
  return null
}

/** Resume only the conversation named by a settings-return capability.
 * A missing, stale, corrupt, cross-product, or cross-source target never
 * falls back to another recent conversation. */
export async function recoverTextOpenWorldCreatorBriefSessionByIdentityV1(
  scopes: readonly WorkspaceScope[],
  target: TextOpenWorldCreatorBriefResumeTargetV1,
): Promise<TextOpenWorldCreatorBriefSessionV1 | null> {
  if (!Number.isSafeInteger(target.conversationId) || target.conversationId < 1
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(target.productInstanceKey)
    || !HASH.test(target.sourceBindingHash)
    || await hashCanonicalValue(target.sourceBinding) !== target.sourceBindingHash) return null
  const uniqueScopes = scopes.filter((scope, index, all) => (
    all.findIndex(candidate => sameScope(candidate, scope)) === index
  ))
  for (const scope of uniqueScopes) {
    const conversations = await readOwnedRows<AgentConversation>(scope, 'agentConversations', { owner: 'work' })
    const conversation = conversations.find((row): row is AgentConversation & { id: number } => (
      row.id === target.conversationId
      && row.status === 'active'
      && row.purpose.startsWith(TEXT_OPEN_WORLD_CREATOR_BRIEF_PURPOSE_PREFIX_V1)
    ))
    if (!conversation) continue
    const session = await hydrateSession(scope, conversation, { recheck: true })
    if (session.productInstanceKey !== target.productInstanceKey
      || session.sourceBindingHash !== target.sourceBindingHash
      || canonicalStringify(session.sourceBinding) !== canonicalStringify(target.sourceBinding)) return null
    return session
  }
  return null
}

export async function saveTextOpenWorldCreatorBriefDraftV1(input: {
  session: TextOpenWorldCreatorBriefSessionV1
  draft: TextOpenWorldCreatorBriefDraftV1
  savedAt?: number
}): Promise<TextOpenWorldCreatorBriefSessionV1> {
  await recheckSelection(requireSessionSelection(input.session))
  const draft = parseTextOpenWorldCreatorBriefDraftV1(input.draft)
  const payload: CreatorBriefDraftEventV1 = {
    schema: 'storyforge.text-open-world-creator-brief-draft-event',
    version: 1,
    sourceBindingHash: input.session.sourceBindingHash,
    draft,
    draftHash: await hashCanonicalValue(draft),
    savedAt: input.savedAt ?? Date.now(),
  }
  await appendAgentEvent({
    projectId: input.session.scope.projectId,
    conversationId: input.session.conversation.id,
    kind: 'message',
    role: 'user',
    content: '更新并保存创作者 Brief 草稿。',
    payload,
    scope: input.session.scope,
  })
  return hydrateSession(input.session.scope, input.session.conversation, { recheck: false })
}

function parseModelJson(output: string): Record<string, unknown> {
  let source = output.trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]!
  try { return record(JSON.parse(source), '模型输出') }
  catch (cause) {
    if (cause instanceof SyntaxError) fail('model-protocol', '模型输出不是有效 JSON')
    throw cause
  }
}

export function parseTextOpenWorldCreatorBriefSynthesisV1(value: unknown): TextOpenWorldCreatorBriefSynthesisV1 {
  const root = record(value, 'synthesis')
  exact(root, [
    'suggestedTitle', 'understandingSummary', 'playerFantasy', 'experiencePromise',
    'primaryConflict', 'recommendedOpening', 'protagonistFit', 'experiencePillars',
    'sourceUsePlan', 'unresolvedQuestions', 'assumptions', 'risks',
  ], 'synthesis')
  return {
    suggestedTitle: textValue(root.suggestedTitle, 'suggestedTitle', 200),
    understandingSummary: textValue(root.understandingSummary, 'understandingSummary', 3_000),
    playerFantasy: textValue(root.playerFantasy, 'playerFantasy', 2_000),
    experiencePromise: textValue(root.experiencePromise, 'experiencePromise', 2_000),
    primaryConflict: textValue(root.primaryConflict, 'primaryConflict', 2_000),
    recommendedOpening: textValue(root.recommendedOpening, 'recommendedOpening', 2_000),
    protagonistFit: textValue(root.protagonistFit, 'protagonistFit', 2_000),
    experiencePillars: listValue(root.experiencePillars, 'experiencePillars', { minimum: 2, maximum: 8 }),
    sourceUsePlan: listValue(root.sourceUsePlan, 'sourceUsePlan', { minimum: 1, maximum: 12 }),
    unresolvedQuestions: listValue(root.unresolvedQuestions, 'unresolvedQuestions', { maximum: 12 }),
    assumptions: listValue(root.assumptions, 'assumptions', { maximum: 12 }),
    risks: listValue(root.risks, 'risks', { maximum: 12 }),
  }
}

function consultationMessages(input: {
  manualContext: string
  priorCandidate: TextOpenWorldCreatorBriefCandidateV1 | null
  followUp: string
  repairIssue?: string
  badOutput?: string
}): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      '你是 StoryForge 文字开放世界产品的主会谈 Agent。你的职责是澄清和复述作者意图，不是读取或改写来源正文，也不是直接生成游戏。',
      '输入中的 sourceSummary 只是 G5-01 的无正文元数据；禁止把未提供的人名、地点、剧情或设定伪装成来源事实。',
      'productBoundary 是当前代码能力的硬边界，不得建议绕过；scale、媒资偏好和创作边界只能提出建议，最终由作者编辑确认。',
      '发现矛盾或缺失时写入 unresolvedQuestions；不能用臆测偷偷填平。问题已经由 followUp 回答时，应从未决项移除或转成 assumptions。',
      '只输出严格 JSON，顶层字段必须精确为：suggestedTitle,understandingSummary,playerFantasy,experiencePromise,primaryConflict,recommendedOpening,protagonistFit,experiencePillars,sourceUsePlan,unresolvedQuestions,assumptions,risks。',
      'experiencePillars 2-8项，sourceUsePlan 至少1项；所有数组只能是字符串数组。',
      input.repairIssue ? `上次输出未通过协议：${input.repairIssue.slice(0, 800)}。只修复结构和越界内容。` : '',
    ].filter(Boolean).join('\n'),
  }, {
    role: 'user',
    content: [
      '【作者输入与受控来源摘要】',
      input.manualContext,
      input.priorCandidate ? `【上一轮主 Agent 理解】${canonicalStringify(input.priorCandidate.synthesis)}` : '',
      input.followUp ? `【作者补充回答】${input.followUp}` : '',
      input.badOutput ? `【上次无效输出，仅用于协议修复】${input.badOutput.slice(0, 20_000)}` : '',
    ].filter(Boolean).join('\n\n'),
  }]
}

async function appendRun(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: unknown,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0])
}

function modelEvidence(input: {
  result: ChatResult
  messages: ChatMessage[]
  output: string
  provider: string
  model: string
  startedAt: number
}): TextOpenWorldCreatorBriefModelEvidenceV1 {
  const inputTokens = input.result.usage?.inputTokens
    ?? input.messages.reduce((total, message) => total + estimateTokens(message.content), 0)
  const outputTokens = input.result.usage?.outputTokens ?? estimateTokens(input.output)
  return {
    provider: input.provider,
    model: input.model,
    usageSource: input.result.usage ? 'provider' : 'estimated',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    estimatedCostUsd: computeKnownCostUsd(input.model, inputTokens, outputTokens),
  }
}

async function createConsultationRun(input: {
  session: TextOpenWorldCreatorBriefSessionV1
  objective: string
  manualContext: string
  maxModelCalls: number
  modelIdentity: { provider: string; model: string }
}): Promise<{ snapshot: AgentRunSnapshotV1; manifestForAttempt: (attempt: number) => Promise<string> }> {
  const skill = getAgentSkillV1(TEXT_OPEN_WORLD_CREATOR_BRIEF_SKILL_ID_V1)
  const formalEntry = await freezeFormalAIEntryBindingV1(TEXT_OPEN_WORLD_CREATOR_BRIEF_ENTRY_ID_V1)
  const executionBinding = createAgentSkillExecutionBindingV1(skill)
  const runtimeBindingHash = await hashCanonicalValue({
    sourceBindingHash: input.session.sourceBindingHash,
    productInstanceKey: input.session.productInstanceKey,
    manualContextHash: await hashCanonicalValue(input.manualContext),
    executionBinding,
    formalEntry,
    modelIdentity: input.modelIdentity,
  })
  let snapshot = await createAgentRunV1({
    scope: input.session.scope,
    worldGroupId: null,
    conversationId: input.session.conversation.id,
    contract: {
      version: 1,
      objective: input.objective,
      workflowKind: 'direct-generation',
      scope: { projectId: input.session.scope.projectId, worldGroupId: null },
      permissions: { contextSourceKeys: ['manualText'], writeTargets: [] },
      runtimeBindingHash,
      executionBindings: [{
        stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
        ...executionBinding,
        formalEntry,
      }],
      budget: {
        maxModelCalls: input.maxModelCalls,
        maxToolCalls: 0,
        maxInputTokens: 48_000,
        maxOutputTokens: 10_000,
        maxAttemptsPerStep: Math.max(1, input.maxModelCalls),
      },
      acceptance: [
        { id: 'creator-brief.protocol-valid', kind: 'deterministic-check', required: true },
        { id: 'creator-brief.source-bound', kind: 'deterministic-check', required: true },
        { id: 'creator-brief.author-confirmed', kind: 'author-confirmed', required: true },
        { id: 'creator-brief.no-unresolved-items', kind: 'deterministic-check', required: true },
      ],
      verificationPlan: [{
        id: 'creator-brief.terminal',
        kind: 'terminal',
        verifier: TEXT_OPEN_WORLD_CREATOR_BRIEF_VERIFIER_V1,
        criterionIds: [
          'creator-brief.protocol-valid',
          'creator-brief.source-bound',
          'creator-brief.author-confirmed',
          'creator-brief.no-unresolved-items',
        ],
      }],
      failurePolicy: {
        onProtocolError: 'retry',
        onVerificationFailure: 'revise',
        onStaleInput: 'pause-for-author',
      },
    },
  })
  snapshot = await appendRun(input.session.scope, snapshot, 'step.scheduled', {
    stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
  })
  snapshot = await appendRun(input.session.scope, snapshot, 'step.started', {
    stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
    attempt: 1,
  })
  const manifestForAttempt = async (attempt: number) => {
    // A repair attempt follows model/request/response and step transition events
    // appended by the caller. Re-read the durable tail before claiming the next
    // context event so bounded repair never uses the first attempt's stale CAS.
    snapshot = await readAgentRunV1(input.session.scope, snapshot.run.id)
    const assembled = await assembleContext({
      projectId: input.session.scope.projectId,
      scope: input.session.scope,
      worldGroupId: null,
      sourceKeys: ['manualText'],
      manualSourceText: input.manualContext,
      inputBudgetMaxTokens: 24_000,
    })
    if (assembled.included.length !== 1 || assembled.included[0] !== 'manualText'
      || assembled.text !== input.manualContext) {
      fail('context-boundary', '主 Agent 会谈必须且只能读取作者输入与受控来源摘要')
    }
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
      attempt,
      projectId: input.session.scope.projectId,
      worldGroupId: null,
      declaredSourceKeys: ['manualText'],
      assembled,
      readerVersion: 'text-open-world-creator-brief-manual-context-v1',
    })
    snapshot = await appendRun(input.session.scope, snapshot, 'context.assembled', {
      stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
      attempt,
      manifestHash: manifest.manifestHash,
    })
    return manifest.manifestHash
  }
  return {
    get snapshot() { return snapshot },
    manifestForAttempt,
  } as { snapshot: AgentRunSnapshotV1; manifestForAttempt: (attempt: number) => Promise<string> }
}

export function applyTextOpenWorldCreatorBriefSynthesisV1(
  draft: TextOpenWorldCreatorBriefDraftV1,
  synthesis: TextOpenWorldCreatorBriefSynthesisV1,
): TextOpenWorldCreatorBriefDraftV1 {
  return parseTextOpenWorldCreatorBriefDraftV1({
    ...draft,
    gameTitle: synthesis.suggestedTitle,
    playerFantasy: synthesis.playerFantasy,
    primaryConflict: synthesis.primaryConflict,
    openingSituation: synthesis.recommendedOpening,
    experiencePillars: synthesis.experiencePillars,
    unresolvedQuestions: synthesis.unresolvedQuestions,
    acceptedAssumptions: [...new Set([...draft.acceptedAssumptions, ...synthesis.assumptions])],
    authorNotes: [draft.authorNotes, `主 Agent 体验承诺：${synthesis.experiencePromise}`]
      .filter(Boolean).join('\n'),
  })
}

export async function generateTextOpenWorldCreatorBriefCandidateV1(input: {
  session: TextOpenWorldCreatorBriefSessionV1
  draft: TextOpenWorldCreatorBriefDraftV1
  followUp?: string
  aiConfig?: AIConfig
  runAI?: RunAI
  signal?: AbortSignal
}): Promise<TextOpenWorldCreatorBriefSessionV1> {
  if (!input.aiConfig && !input.runAI) fail('ai-config', '缺少 AI 配置；仍可人工编辑并确认 Brief')
  const freshSelection = await recheckSelection(requireSessionSelection(input.session))
  const bindingHash = await hashCanonicalValue(selectionBinding(freshSelection))
  if (bindingHash !== input.session.sourceBindingHash) fail('source-stale', '来源绑定已变化，请重新选择')
  const saved = await saveTextOpenWorldCreatorBriefDraftV1({ session: input.session, draft: input.draft })
  const draft = saved.draft
  const followUp = (input.followUp ?? '').trim().slice(0, 4_000)
  if (followUp) await appendAgentEvent({
    projectId: saved.scope.projectId,
    conversationId: saved.conversation.id,
    kind: 'message',
    role: 'user',
    content: followUp,
    payload: {
      schema: 'storyforge.text-open-world-creator-brief-follow-up',
      version: 1,
      sourceBindingHash: saved.sourceBindingHash,
    },
    scope: saved.scope,
  })
  const manualContext = canonicalStringify({
    sourceBinding: saved.sourceBinding,
    sourceSummary: saved.sourceSummary,
    authorDraft: draft,
    productBoundary: TEXT_OPEN_WORLD_CREATOR_PRODUCT_BOUNDARY_V1,
  })
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, {
    category: 'authoring.text-open-world-creator-brief',
    projectId: saved.scope.projectId,
    contextOverflowPolicy: 'reject',
  }) : null
  const modelIdentity = input.runAI
    ? { provider: 'test-adapter', model: 'injected' }
    : {
        provider: resolved?.config.provider ?? fail('ai-config', '缺少 provider'),
        model: resolved?.config.model ?? fail('ai-config', '缺少 model'),
      }
  const run = await createConsultationRun({
    session: saved,
    objective: `澄清并确认文字开放世界《${draft.gameTitle}》的创作者 Brief`,
    manualContext,
    maxModelCalls: 2,
    modelIdentity,
  })
  let snapshot = run.snapshot
  const contextManifestHashes: string[] = []
  const modelCalls: TextOpenWorldCreatorBriefModelEvidenceV1[] = []
  const invoke = async (attempt: 1 | 2, repairIssue?: string, badOutput?: string) => {
    const manifestHash = await run.manifestForAttempt(attempt)
    snapshot = await readAgentRunV1(saved.scope, snapshot.run.id)
    contextManifestHashes.push(manifestHash)
    const messages = consultationMessages({
      manualContext,
      priorCandidate: saved.candidate,
      followUp,
      repairIssue,
      badOutput,
    })
    snapshot = await appendRun(saved.scope, snapshot, 'model.requested', {
      stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
      attempt,
      bindingHash: await hashCanonicalValue({
        executionBinding: snapshot.contract.executionBindings?.[0],
        messages,
      }),
    })
    const result: ChatResult = {}
    const startedAt = Date.now()
    let output: string
    try {
      output = input.runAI
        ? await input.runAI(messages, input.signal)
        : await executeRegisteredAIEntryV1(
            'text-open-world.creator-brief.consult',
            messages,
            input.aiConfig!,
            {
              category: 'authoring.text-open-world-creator-brief',
              projectId: saved.scope.projectId,
              contextOverflowPolicy: 'reject',
            },
            input.signal,
            result,
            { responseFormat: 'json_object' },
            resolved!,
          )
    } catch (cause) {
      await appendRun(saved.scope, snapshot, 'run.paused', {
        reason: 'creator-brief-model-outcome-unknown',
        recoverable: false,
      })
      throw cause
    }
    modelCalls.push(modelEvidence({
      result,
      messages,
      output,
      provider: modelIdentity.provider,
      model: modelIdentity.model,
      startedAt,
    }))
    snapshot = await appendRun(saved.scope, snapshot, 'model.responded', {
      stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
      attempt,
      outputHash: await hashCanonicalValue(output),
    })
    return output
  }
  try {
    const first = await invoke(1)
    let synthesis: TextOpenWorldCreatorBriefSynthesisV1
    let repairApplied = false
    try { synthesis = parseTextOpenWorldCreatorBriefSynthesisV1(parseModelJson(first)) }
    catch (cause) {
      const issue = cause instanceof Error ? cause.message : String(cause)
      snapshot = await appendRun(saved.scope, snapshot, 'step.failed', {
        stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
        attempt: 1,
        code: 'creator-brief-model-protocol',
        retryable: true,
        category: 'protocol',
        action: 'retry',
      })
      snapshot = await appendRun(saved.scope, snapshot, 'step.started', {
        stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
        attempt: 2,
      })
      const second = await invoke(2, issue, first)
      synthesis = parseTextOpenWorldCreatorBriefSynthesisV1(parseModelJson(second))
      repairApplied = true
    }
    await recheckSelection(requireSessionSelection(saved))
    const body = {
      schema: 'storyforge.text-open-world-creator-brief-candidate' as const,
      version: 1 as const,
      origin: 'ai' as const,
      runBindingHash: requiredRunBindingHash(snapshot),
      sourceBindingHash: saved.sourceBindingHash,
      draftHash: await hashCanonicalValue(draft),
      contextManifestHashes,
      synthesis,
      modelCalls,
      repairApplied,
    }
    const candidate: TextOpenWorldCreatorBriefCandidateV1 = {
      ...body,
      candidateHash: await hashCanonicalValue(body),
    }
    snapshot = (await createAgentRunCheckpointV1({
      scope: saved.scope,
      runId: snapshot.run.id,
      resumePayload: candidate,
      expectedLastSequence: snapshot.projection.lastSequence,
    })).snapshot
    snapshot = await appendRun(saved.scope, snapshot, 'candidate.persisted', {
      stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
      attempt: repairApplied ? 2 : 1,
      candidateHash: candidate.candidateHash,
      requiresConfirmation: true,
    })
    const payload: CreatorBriefCandidateEventV1 = {
      schema: 'storyforge.text-open-world-creator-brief-candidate-event',
      version: 1,
      sourceBindingHash: saved.sourceBindingHash,
      draft,
      candidate,
    }
    await appendAgentEvent({
      projectId: saved.scope.projectId,
      conversationId: saved.conversation.id,
      durableRunId: snapshot.run.id,
      kind: 'candidate',
      role: 'assistant',
      content: synthesis.understandingSummary,
      payload,
      scope: saved.scope,
    })
    return hydrateSession(saved.scope, saved.conversation, { recheck: false })
  } catch (cause) {
    const current = await readAgentRunV1(saved.scope, snapshot.run.id)
    if (!['paused', 'failed', 'cancelled', 'completed'].includes(current.projection.state)) {
      try {
        snapshot = current
        if (snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1]?.status === 'running') {
          snapshot = await appendRun(saved.scope, snapshot, 'step.failed', {
            stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
            attempt: snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1]?.attempt ?? 1,
            code: 'creator-brief-generation-failed',
            retryable: false,
            category: 'protocol',
            action: 'fail',
          })
        }
        await appendRun(saved.scope, snapshot, 'run.failed', {
          code: 'creator-brief-generation-failed',
          retryable: false,
        })
      } catch { /* retain the original error */ }
    }
    throw cause
  }
}

async function createManualCandidateRun(input: {
  session: TextOpenWorldCreatorBriefSessionV1
  draft: TextOpenWorldCreatorBriefDraftV1
}): Promise<{ snapshot: AgentRunSnapshotV1; candidateHash: string; contextManifestHashes: string[] }> {
  const manualContext = canonicalStringify({
    sourceBinding: input.session.sourceBinding,
    sourceSummary: input.session.sourceSummary,
    authorDraft: input.draft,
    productBoundary: TEXT_OPEN_WORLD_CREATOR_PRODUCT_BOUNDARY_V1,
  })
  const run = await createConsultationRun({
    session: input.session,
    objective: `由作者人工确认文字开放世界《${input.draft.gameTitle}》Brief`,
    manualContext,
    maxModelCalls: 1,
    modelIdentity: { provider: 'author', model: 'manual-confirmation' },
  })
  let snapshot = run.snapshot
  const manifestHash = await run.manifestForAttempt(1)
  snapshot = await readAgentRunV1(input.session.scope, snapshot.run.id)
  const candidateHash = await hashCanonicalValue({
    origin: 'author',
    sourceBindingHash: input.session.sourceBindingHash,
    draft: input.draft,
    productBoundary: TEXT_OPEN_WORLD_CREATOR_PRODUCT_BOUNDARY_V1,
  })
  snapshot = (await createAgentRunCheckpointV1({
    scope: input.session.scope,
    runId: snapshot.run.id,
    resumePayload: {
      schema: 'storyforge.text-open-world-creator-brief-author-candidate',
      version: 1,
      sourceBindingHash: input.session.sourceBindingHash,
      draft: input.draft,
      candidateHash,
    },
    expectedLastSequence: snapshot.projection.lastSequence,
  })).snapshot
  snapshot = await appendRun(input.session.scope, snapshot, 'candidate.persisted', {
    stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
    attempt: 1,
    candidateHash,
    requiresConfirmation: true,
  })
  return { snapshot, candidateHash, contextManifestHashes: [manifestHash] }
}

export async function confirmTextOpenWorldCreatorBriefV1(input: {
  session: TextOpenWorldCreatorBriefSessionV1
  draft: TextOpenWorldCreatorBriefDraftV1
  acknowledgements: {
    sourceIdentityReviewed: boolean
    productBoundaryReviewed: boolean
    unresolvedItemsClosed: boolean
    directPublishWorkflowReviewed: boolean
  }
  confirmedAt?: number
}): Promise<TextOpenWorldCreatorBriefSessionV1> {
  const draft = parseTextOpenWorldCreatorBriefDraftV1(input.draft)
  if (draft.unresolvedQuestions.length) fail('unresolved', '仍有未决问题；请回答、删除或转为明确接受的假设')
  if (!input.acknowledgements.sourceIdentityReviewed
    || !input.acknowledgements.productBoundaryReviewed
    || !input.acknowledgements.unresolvedItemsClosed
    || !input.acknowledgements.directPublishWorkflowReviewed) {
    fail('confirmation', '必须逐项确认来源、产品边界、未决项和发布修复流程')
  }
  const selection = await recheckSelection(requireSessionSelection(input.session))
  if (await hashCanonicalValue(selectionBinding(selection)) !== input.session.sourceBindingHash) {
    fail('source-stale', '来源已变化，请重新选择并重新会谈')
  }
  let snapshot: AgentRunSnapshotV1
  let previousCandidateHash: string
  let contextManifestHashes: string[]
  let origin: 'ai' | 'author'
  if (input.session.candidate) {
    if (input.session.candidateRunId == null) fail('event-corrupt', '候选缺少 durable Run 引用')
    snapshot = await readAgentRunV1(input.session.scope, input.session.candidateRunId)
    if (snapshot.projection.state !== 'awaiting_confirmation'
      || snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1]?.candidateHash
        !== input.session.candidate.candidateHash) {
      const manual = await createManualCandidateRun({ session: input.session, draft })
      snapshot = manual.snapshot
      previousCandidateHash = manual.candidateHash
      contextManifestHashes = manual.contextManifestHashes
      origin = 'author'
    } else {
      previousCandidateHash = input.session.candidate.candidateHash
      contextManifestHashes = [...input.session.candidate.contextManifestHashes]
      origin = 'ai'
    }
  } else {
    const manual = await createManualCandidateRun({ session: input.session, draft })
    snapshot = manual.snapshot
    previousCandidateHash = manual.candidateHash
    contextManifestHashes = manual.contextManifestHashes
    origin = 'author'
  }
  const confirmedAt = input.confirmedAt ?? Date.now()
  const parentRevision = input.session.production.currentBriefRevision
  const revision = (parentRevision ?? 0) + 1
  const finalCandidateHash = await hashCanonicalValue({
    sourceBindingHash: input.session.sourceBindingHash,
    draft,
    sourceSummary: input.session.sourceSummary,
    productBoundary: TEXT_OPEN_WORLD_CREATOR_PRODUCT_BOUNDARY_V1,
  })
  if (finalCandidateHash !== previousCandidateHash) {
    snapshot = await appendRun(input.session.scope, snapshot, 'candidate.revised', {
      stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
      attempt: snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1]?.attempt ?? 1,
      previousCandidateHash,
      candidateHash: finalCandidateHash,
    })
  }
  const body = {
    schema: 'storyforge.text-open-world-creator-brief' as const,
    version: 1 as const,
    productInstanceKey: input.session.productInstanceKey,
    revision,
    sourceBinding: structuredClone(input.session.sourceBinding),
    sourceBindingHash: input.session.sourceBindingHash,
    sourceSummary: structuredClone(input.session.sourceSummary),
    draft,
    productBoundary: structuredClone(TEXT_OPEN_WORLD_CREATOR_PRODUCT_BOUNDARY_V1),
    confirmation: {
      sourceIdentityReviewed: true as const,
      productBoundaryReviewed: true as const,
      unresolvedItemsClosed: true as const,
      directPublishWorkflowReviewed: true as const,
    },
    candidateEvidence: {
      candidateHash: finalCandidateHash,
      runBindingHash: requiredRunBindingHash(snapshot),
      origin,
      contextManifestHashes,
    },
    confirmedAt,
  }
  const brief: TextOpenWorldCreatorBriefV1 = {
    ...body,
    briefHash: await hashCanonicalValue(body),
  }
  snapshot = (await createAgentRunCheckpointV1({
    scope: input.session.scope,
    runId: snapshot.run.id,
    resumePayload: brief,
    expectedLastSequence: snapshot.projection.lastSequence,
  })).snapshot
  snapshot = await appendRun(input.session.scope, snapshot, 'confirmation.recorded', {
    stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
    candidateHash: finalCandidateHash,
    decision: 'adopt',
  })
  snapshot = await appendRun(input.session.scope, snapshot, 'step.succeeded', {
    stepId: TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
    attempt: snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1]?.attempt ?? 1,
    outputHash: brief.briefHash,
  })
  snapshot = await appendRun(input.session.scope, snapshot, 'verification.started', {
    verifierSetVersion: TEXT_OPEN_WORLD_CREATOR_BRIEF_VERIFIER_V1,
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash,
    contextManifestHashes,
    candidateHashes: [finalCandidateHash, brief.briefHash],
    adoptionEventIds: [],
    postStateHash: brief.briefHash,
    verifierSetVersion: TEXT_OPEN_WORLD_CREATOR_BRIEF_VERIFIER_V1,
    criteria: [
      { id: 'creator-brief.protocol-valid', status: 'passed', evidenceRefs: [`brief:${brief.briefHash}`] },
      { id: 'creator-brief.source-bound', status: 'passed', evidenceRefs: [`source:${brief.sourceBindingHash}`] },
      { id: 'creator-brief.author-confirmed', status: 'passed', evidenceRefs: [`candidate:${finalCandidateHash}`] },
      { id: 'creator-brief.no-unresolved-items', status: 'passed', evidenceRefs: ['unresolved:0'] },
    ],
    acceptedAt: confirmedAt,
  })
  snapshot = await appendRun(input.session.scope, snapshot, 'verification.accepted', {
    receiptHash: receipt.receiptHash,
  })
  const saveReceipt = await executeProductProductionCommand({
    scope: input.session.scope,
    productionId: input.session.production.id,
    command: {
      type: 'save-text-open-world-creator-brief',
      commandId: `creator-brief:${input.session.conversation.id}:${revision}:${brief.briefHash.slice(0, 40)}`,
      expectedStateRevision: input.session.production.stateRevision,
      parentRevision,
      sourceLocator: createTextOpenWorldCreatorSourceLocatorV1(selection),
      candidateRunId: snapshot.run.id,
      brief,
    },
    now: confirmedAt,
  })
  if (!saveReceipt.ok) {
    fail(saveReceipt.errorCode ?? 'brief-save', String(saveReceipt.result.message ?? 'Creator Brief 未能写入正式生命周期'))
  }
  const payload: CreatorBriefConfirmationEventV1 = {
    schema: 'storyforge.text-open-world-creator-brief-confirmation-event',
    version: 1,
    sourceBindingHash: input.session.sourceBindingHash,
    brief,
  }
  await appendAgentEvent({
    projectId: input.session.scope.projectId,
    conversationId: input.session.conversation.id,
    durableRunId: snapshot.run.id,
    kind: 'confirmation',
    role: 'user',
    content: `作者已确认 Brief v${brief.revision}。`,
    payload,
    scope: input.session.scope,
  })
  return hydrateSession(input.session.scope, input.session.conversation, { recheck: false })
}

/** Recover the last candidate checkpoint without repeating a paid model call. */
export async function recoverTextOpenWorldCreatorBriefCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<TextOpenWorldCreatorBriefCandidateV1 | null> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['awaiting_confirmation', 'running', 'verifying', 'completed'].includes(snapshot.projection.state)) return null
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId)
  if (!checkpoint) return null
  const value = checkpoint.resumePayload
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<TextOpenWorldCreatorBriefCandidateV1>
  if (candidate.schema !== 'storyforge.text-open-world-creator-brief-candidate'
    || candidate.version !== 1 || candidate.runBindingHash !== requiredRunBindingHash(snapshot)
    || !HASH.test(candidate.candidateHash ?? '')) return null
  const { candidateHash, ...body } = candidate as TextOpenWorldCreatorBriefCandidateV1
  if (await hashCanonicalValue(body) !== candidateHash) fail('event-corrupt', '恢复候选 Hash 不匹配')
  return structuredClone(candidate as TextOpenWorldCreatorBriefCandidateV1)
}

/** Diagnostic helper used by tests and G5-04 promotion. */
export async function listTextOpenWorldCreatorBriefRunsV1(session: TextOpenWorldCreatorBriefSessionV1) {
  const rows = await db.agentRuns.where('conversationId').equals(session.conversation.id).toArray()
  return rows.filter(row => row.workId === session.scope.workId && row.projectId === session.scope.projectId)
}
