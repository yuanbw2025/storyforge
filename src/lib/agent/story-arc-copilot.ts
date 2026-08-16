import { nanoid } from 'nanoid'
import { useAIConfigStore } from '../../stores/ai-config'
import { chat, resolveRequestConfig, type ChatResult } from '../ai/client'
import { estimateTokens } from '../ai/context-budget'
import { computeKnownCostUsd } from '../ai/usage-log'
import { supportsVerifiedJsonObjectResponseV1 } from '../ai/provider-capabilities'
import { db } from '../db/schema'
import type {
  GenerationGateIssue,
  GenerationNode,
  PreparedGenerationNode,
} from '../generation/generation-node'
import { prepareGenerationNode } from '../generation/generation-node'
import { adopt } from '../registry/adopt'
import { assembleContext } from '../registry/assemble-context'
import type { AIConfig, ChatMessage, StoryArc, StoryArcType, WorkspaceScope } from '../types'
import { parseStages, stringifyStages, type StoryStage } from '../types/story-arc'
import {
  isLegacyReadScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScope,
  scopeTransactionTables,
} from '../world-engine/scope'
import {
  attachAgentContextInputStateV1,
  evidenceFromContextResult,
  resolveAgentContextPolicy,
  type AgentContextEvidence,
  type AgentContextProfile,
} from './context-policy'
import {
  createAgentContextCompressionSessionV1,
  type AgentContextCompressionRuntimeV1,
} from './context-compression'
import {
  buildAgentSkillInputGuidanceV1,
  resolveAgentSkillInputStateV1,
  resolveAgentSkillV1,
  type AgentSkillId,
} from './skill-registry'
import {
  isCreativeReliabilityRuntimeEnabledV1,
  parseCreativeArtifactV1,
  resolveCreativeQualityPolicyV1,
  type CreativeArtifactFragmentV1,
  type CreativeAssumptionV1,
  type CreativeArtifactIssueV1,
  type CreativeArtifactV1,
  type CreativeCallEvidenceV1,
  type CreativeQualityModeV1,
} from './creative-reliability'
import { normalizeCreativeJsonEnvelopeV1 } from './creative-json-normalizer'
import {
  buildNarrativeBriefV1,
  formatNarrativeBriefForPromptV1,
  mergeProvisionalAssumptionsV1,
  type NarrativeBriefV1,
} from './narrative-brief'
import { hashCanonicalValue } from './run/hash'
import type { AgentTeamBudgetTracker } from './team-budget'

export type StoryArcRequestKind = 'main' | 'sub' | 'mixed'

export interface StoryArcCopilotStageCandidate {
  title: string
  description: string
  keyEvents: string[]
  turningPoint?: string
  startVolume?: number
  endVolume?: number
}

export interface StoryArcCopilotCandidate {
  name: string
  type: StoryArcType
  description: string
  stages: StoryArcCopilotStageCandidate[]
}

export interface StoryArcCopilotSnapshot {
  serialized: string
  existingNames: string[]
}

export interface StoryArcCopilotInput {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  supplementalContext: string
  inputGuidance: string
  kind: StoryArcRequestKind
  assembled: Awaited<ReturnType<typeof assembleContext>>
  narrativeBrief: NarrativeBriefV1
  creativeReliabilityEnabled?: boolean
  snapshot: StoryArcCopilotSnapshot
  config: AIConfig
  routingCategory: string
  generationOverrides?: { temperature?: number; maxTokens?: number }
  signal?: AbortSignal
}

export interface PreparedStoryArcCopilot {
  node: GenerationNode<
    StoryArcCopilotInput,
    StoryArcCopilotCandidate[],
    { writtenCount: number; ids: number[] }
  >
  prepared: PreparedGenerationNode
  input: StoryArcCopilotInput
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  snapshot: StoryArcCopilotSnapshot
  kind: StoryArcRequestKind
  label: string
  modelIdentity: { provider: string; model: string }
  runRaw: (messages: ChatMessage[]) => Promise<StoryArcRawModelResultV1>
}

export interface StoryArcRawModelResultV1 {
  output: string
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  durationMs: number
}

export interface StoryArcCreativeRunResultV1 {
  output: StoryArcCopilotCandidate[]
  draft: string
  artifact: CreativeArtifactV1
}

interface StoryArcCopilotDependencies {
  runAI?: (messages: ChatMessage[]) => Promise<string>
  readCurrent?: () => Promise<StoryArcCopilotSnapshot>
  saveCandidates?: (
    candidates: StoryArcCopilotCandidate[],
  ) => Promise<{ writtenCount: number; ids: number[] }>
}

const MAX_CANDIDATE_CHARS = 120_000
const MAX_ARCS = 8
const MAX_NAME_CHARS = 120
const MAX_DESCRIPTION_CHARS = 2_000
const MAX_STAGE_TITLE_CHARS = 160
const MAX_STAGE_DESCRIPTION_CHARS = 2_000
const MAX_EVENT_CHARS = 400
const MAX_KEY_EVENTS = 5

export class StoryArcCopilotStaleError extends Error {
  constructor() {
    super('故事线已在候选生成后发生变化。为避免覆盖或合并到错误版本，请重新生成候选。')
    this.name = 'StoryArcCopilotStaleError'
  }
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

function snapshotOf(rows: StoryArc[]): StoryArcCopilotSnapshot {
  const ordered = rows
    .map(row => ({
      id: row.id ?? null,
      name: row.name,
      type: row.type,
      description: row.description ?? '',
      stages: row.stages,
      updatedAt: row.updatedAt,
    }))
    .sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
  return {
    serialized: JSON.stringify(ordered),
    existingNames: ordered.map(row => normalizeIdentity(row.name)),
  }
}

async function readSnapshot(
  projectId: number,
  scope?: WorkspaceScope,
): Promise<StoryArcCopilotSnapshot> {
  const resolved = scope ?? await resolveReadScopeLike(projectId)
  return snapshotOf(await readOwnedRows<StoryArc>(resolved, 'storyArcs', { owner: 'work' }))
}

function assertAuthorRequest(value: string): string {
  const request = value.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的故事线要求。')
  if (request.length > 2_000) throw new Error('单次故事线要求不能超过 2000 个字符。')
  return request
}

export function resolveStoryArcRequestKindV1(request: string): StoryArcRequestKind {
  const hasMain = /主线/.test(request)
  const hasSub = /支线|复线/.test(request)
  if (hasMain && hasSub) return 'mixed'
  if (hasSub) return 'sub'
  return 'main'
}

function parseStrictJsonArray(draft: string): unknown[] {
  const input = draft.trim()
  if (!input) throw new Error('故事线候选为空。')
  if (input.length > MAX_CANDIDATE_CHARS) {
    throw new Error(`故事线候选超过 ${MAX_CANDIDATE_CHARS} 字符。`)
  }
  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(input)
  const source = fenced?.[1]?.trim() ?? input
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('故事线候选不是有效的严格 JSON 数组。')
  }
  if (!Array.isArray(parsed)) throw new Error('故事线候选必须是 JSON 数组。')
  return parsed
}

function assertString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串。`)
  const result = value.trim()
  if (result.length > maxLength) throw new Error(`${label} 超过 ${maxLength} 字符。`)
  return result
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length) throw new Error(`${label} 包含不允许的字段：${unknown.join('、')}。`)
  const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  if (missing.length) throw new Error(`${label} 缺少字段：${missing.join('、')}。`)
}

function parseVolumeNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 10_000) {
    throw new Error(`${label} 必须是 1-10000 的整数。`)
  }
  return Number(value)
}

function parseOptionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  // JSON object mode commonly materializes an unfilled optional text control as
  // an empty string. Its documented semantic meaning is absence, so normalize
  // only that exact no-information case; non-string and non-empty invalid values
  // still fail closed.
  if (typeof value === 'string' && !value.trim()) return undefined
  return assertString(value, label, maxLength)
}

function parseStage(value: unknown, arcIndex: number, stageIndex: number): StoryArcCopilotStageCandidate {
  const label = `故事线候选第 ${arcIndex + 1} 项的第 ${stageIndex + 1} 个阶段`
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象。`)
  }
  const source = value as Record<string, unknown>
  assertExactKeys(
    source,
    ['title', 'description', 'keyEvents'],
    ['turningPoint', 'startVolume', 'endVolume'],
    label,
  )
  if (
    !Array.isArray(source.keyEvents)
    || source.keyEvents.length < 1
    || source.keyEvents.length > MAX_KEY_EVENTS
  ) {
    throw new Error(`${label}.keyEvents 必须包含 1-${MAX_KEY_EVENTS} 个事件。`)
  }
  const keyEvents = source.keyEvents.map((event, eventIndex) => assertString(
    event,
    `${label}.keyEvents[${eventIndex}]`,
    MAX_EVENT_CHARS,
  ))
  if (new Set(keyEvents.map(normalizeIdentity)).size !== keyEvents.length) {
    throw new Error(`${label}.keyEvents 不得重复。`)
  }
  const startVolume = parseVolumeNumber(source.startVolume, `${label}.startVolume`)
  const endVolume = parseVolumeNumber(source.endVolume, `${label}.endVolume`)
  if ((startVolume === undefined) !== (endVolume === undefined)) {
    throw new Error(`${label} 的卷范围必须同时提供 startVolume 和 endVolume。`)
  }
  if (startVolume !== undefined && endVolume !== undefined && startVolume > endVolume) {
    throw new Error(`${label} 的卷范围起点不能晚于终点。`)
  }
  const turningPoint = parseOptionalString(source.turningPoint, `${label}.turningPoint`, MAX_EVENT_CHARS)
  return {
    title: assertString(source.title, `${label}.title`, MAX_STAGE_TITLE_CHARS),
    description: assertString(source.description, `${label}.description`, MAX_STAGE_DESCRIPTION_CHARS),
    keyEvents,
    ...(turningPoint === undefined ? {} : { turningPoint }),
    ...(startVolume === undefined ? {} : { startVolume, endVolume }),
  }
}

export function parseStoryArcCandidateDraft(draft: string): StoryArcCopilotCandidate[] {
  const rows = parseStrictJsonArray(draft)
  if (rows.length < 1 || rows.length > MAX_ARCS) {
    throw new Error(`故事线候选数量必须在 1-${MAX_ARCS} 之间。`)
  }
  const candidates = rows.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`故事线候选第 ${index + 1} 项必须是对象。`)
    }
    const source = value as Record<string, unknown>
    assertExactKeys(source, ['name', 'type', 'description', 'stages'], [], `故事线候选第 ${index + 1} 项`)
    if (source.type !== 'main' && source.type !== 'sub') {
      throw new Error(`故事线候选第 ${index + 1} 项.type 必须是 main 或 sub。`)
    }
    if (!Array.isArray(source.stages) || source.stages.length < 3 || source.stages.length > 7) {
      throw new Error(`故事线候选第 ${index + 1} 项.stages 必须包含 3-7 个阶段。`)
    }
    const stages = source.stages.map((stage, stageIndex) => parseStage(stage, index, stageIndex))
    const stageNames = stages.map(stage => normalizeIdentity(stage.title))
    if (new Set(stageNames).size !== stageNames.length) {
      throw new Error(`故事线候选第 ${index + 1} 项包含重复阶段标题。`)
    }
    const type: StoryArcType = source.type
    return {
      name: assertString(source.name, `故事线候选第 ${index + 1} 项.name`, MAX_NAME_CHARS),
      type,
      description: assertString(
        source.description,
        `故事线候选第 ${index + 1} 项.description`,
        MAX_DESCRIPTION_CHARS,
      ),
      stages,
    }
  })
  const names = candidates.map(candidate => normalizeIdentity(candidate.name))
  if (new Set(names).size !== names.length) throw new Error('故事线候选包含重复名称。')
  return candidates
}

/**
 * Production model transport v2. Editable/persisted candidates intentionally
 * remain a bare JSON array, while model output uses an exact object envelope so
 * providers with JSON-object mode can enforce a compatible top-level value.
 */
export function parseStoryArcModelResponseV2(raw: string): StoryArcCopilotCandidate[] {
  if (!raw.trim()) throw new Error('故事线模型响应为空。')
  if (raw.length > MAX_CANDIDATE_CHARS) {
    throw new Error(`故事线模型响应超过 ${MAX_CANDIDATE_CHARS} 字符。`)
  }
  const normalized = normalizeCreativeJsonEnvelopeV1(raw)
  if (!normalized.value) throw new Error(normalized.issues[0]?.message ?? '故事线模型响应无效。')
  const source = normalized.value
  assertExactKeys(source, ['storyArcs'], ['assumptions'], '故事线模型响应')
  if (!Array.isArray(source.storyArcs)) {
    throw new Error('故事线模型响应.storyArcs 必须是 JSON 数组。')
  }
  if (source.assumptions !== undefined) parseStoryArcAssumptionTextsV1(source.assumptions, true)
  return parseStoryArcCandidateDraft(JSON.stringify(source.storyArcs))
}

/** Strict pre-CREL parser used only by the local rollback path. */
export function parseStoryArcModelResponseLegacyV1(raw: string): StoryArcCopilotCandidate[] {
  const input = raw.trim()
  if (!input) throw new Error('故事线模型响应为空。')
  if (input.length > MAX_CANDIDATE_CHARS) {
    throw new Error(`故事线模型响应超过 ${MAX_CANDIDATE_CHARS} 字符。`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    throw new Error('故事线模型响应不是有效的严格 JSON 对象。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('故事线模型响应必须是 JSON 对象。')
  }
  const source = parsed as Record<string, unknown>
  assertExactKeys(source, ['storyArcs'], [], '故事线模型响应')
  if (!Array.isArray(source.storyArcs)) {
    throw new Error('故事线模型响应.storyArcs 必须是 JSON 数组。')
  }
  return parseStoryArcCandidateDraft(JSON.stringify(source.storyArcs))
}

function candidateIssues(
  output: StoryArcCopilotCandidate[],
  snapshot: StoryArcCopilotSnapshot,
  kind: StoryArcRequestKind,
): GenerationGateIssue[] {
  let parsed: StoryArcCopilotCandidate[]
  try {
    parsed = parseStoryArcCandidateDraft(JSON.stringify(output))
  } catch (error) {
    return [{
      code: 'story-arc-invalid-structure',
      message: error instanceof Error ? error.message : '故事线候选结构无效。',
    }]
  }
  const issues: GenerationGateIssue[] = []
  const existing = new Set(snapshot.existingNames)
  const duplicate = parsed.find(candidate => existing.has(normalizeIdentity(candidate.name)))
  if (duplicate) {
    issues.push({
      code: 'story-arc-duplicate-name',
      message: `当前作品已存在故事线“${duplicate.name}”。`,
    })
  }
  if (kind === 'main' && parsed.some(candidate => candidate.type !== 'main')) {
    issues.push({ code: 'story-arc-kind-mismatch', message: '主线任务只能生成 main 类型故事线。' })
  }
  if (kind === 'sub' && parsed.some(candidate => candidate.type !== 'sub')) {
    issues.push({ code: 'story-arc-kind-mismatch', message: '支线任务只能生成 sub 类型故事线。' })
  }
  if (kind === 'mixed' && (
    !parsed.some(candidate => candidate.type === 'main')
    || !parsed.some(candidate => candidate.type === 'sub')
  )) {
    issues.push({ code: 'story-arc-kind-mismatch', message: '主线与支线混编任务必须同时包含 main 和 sub。' })
  }
  return issues
}

interface StoryArcCreativeParseOutcomeV1 {
  status: CreativeArtifactV1['status']
  candidates: StoryArcCopilotCandidate[]
  editableText: string
  validFragments: CreativeArtifactFragmentV1[]
  rejectedFragments: CreativeArtifactFragmentV1[]
  issues: CreativeArtifactIssueV1[]
  assumptions: CreativeAssumptionV1[]
}

function normalizeStoryArcCreativeItemV1(
  value: unknown,
  arcIndex: number,
): { value: unknown; issues: CreativeArtifactIssueV1[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { value, issues: [] }
  }
  const source = value as Record<string, unknown>
  if (!Array.isArray(source.stages)) return { value, issues: [] }

  const issues: CreativeArtifactIssueV1[] = []
  const stages = source.stages.map((stage, stageIndex) => {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return stage
    const normalized = { ...(stage as Record<string, unknown>) }
    if (typeof normalized.turningPoint === 'boolean') {
      const booleanValue = normalized.turningPoint
      delete normalized.turningPoint
      issues.push(creativeIssue({
        code: 'story-arc-turning-point-normalized',
        path: `$.storyArcs[${arcIndex}].stages[${stageIndex}].turningPoint`,
        message: booleanValue
          ? '模型把 turningPoint 写成布尔值；为避免猜测创作语义，已忽略该可选标记并保留阶段正文与关键事件。'
          : '模型把 turningPoint 写成 false；已按未提供可选转折描述处理。',
        severity: 'warning',
        disposition: 'advisory',
        action: 'none',
      }))
    }

    const hasStartVolume = Object.prototype.hasOwnProperty.call(normalized, 'startVolume')
    const hasEndVolume = Object.prototype.hasOwnProperty.call(normalized, 'endVolume')
    const startVolume = normalized.startVolume
    const endVolume = normalized.endVolume
    const validRange = hasStartVolume
      && hasEndVolume
      && Number.isInteger(startVolume)
      && Number.isInteger(endVolume)
      && Number(startVolume) >= 1
      && Number(startVolume) <= 10_000
      && Number(endVolume) >= 1
      && Number(endVolume) <= 10_000
      && Number(startVolume) <= Number(endVolume)
    if ((hasStartVolume || hasEndVolume) && !validRange) {
      delete normalized.startVolume
      delete normalized.endVolume
      issues.push(creativeIssue({
        code: 'story-arc-volume-range-normalized',
        path: `$.storyArcs[${arcIndex}].stages[${stageIndex}]`,
        message: '模型提供了不完整或无效的可选卷范围；已同时忽略 startVolume/endVolume，并保留阶段正文与关键事件。',
        severity: 'warning',
        disposition: 'advisory',
        action: 'remove',
      }))
    }
    return normalized
  })
  return { value: { ...source, stages }, issues }
}

function parseStoryArcAssumptionTextsV1(
  value: unknown,
  strict: boolean,
): { assumptions: CreativeAssumptionV1[]; issues: CreativeArtifactIssueV1[] } {
  if (value === undefined) return { assumptions: [], issues: [] }
  if (!Array.isArray(value) || value.length > 7) {
    if (strict) throw new Error('故事线模型响应.assumptions 必须是最多 7 项的字符串数组。')
    return {
      assumptions: [],
      issues: [creativeIssue({
        code: 'story-arc-assumptions-invalid',
        path: '$.assumptions',
        message: 'assumptions 必须是最多 7 项的字符串数组；已忽略损坏的假设元数据。',
        severity: 'warning',
        disposition: 'advisory',
        action: 'remove',
      })],
    }
  }
  const assumptions: CreativeAssumptionV1[] = []
  const issues: CreativeArtifactIssueV1[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const text = typeof item === 'string' ? item.trim() : ''
    if (!text || text.length > 500 || seen.has(text)) {
      if (strict) throw new Error(`故事线模型响应.assumptions[${index}] 必须是唯一的非空短字符串。`)
      issues.push(creativeIssue({
        code: 'story-arc-assumption-item-invalid',
        path: `$.assumptions[${index}]`,
        message: `第 ${index + 1} 项临时假设无效，已忽略；合法故事线仍保留。`,
        severity: 'warning',
        disposition: 'advisory',
        action: 'remove',
      }))
      return
    }
    seen.add(text)
    assumptions.push({
      version: 1,
      id: `story-arc-assumption:${index + 1}`,
      text,
      derivedFrom: ['narrativeBrief:creativeFreedom'],
      confidence: 'low',
      conflictsWith: [],
      status: 'provisional',
    })
  })
  return { assumptions, issues }
}

function creativeIssue(input: {
  code: string
  path: string
  message: string
  severity?: CreativeArtifactIssueV1['severity']
  disposition?: CreativeArtifactIssueV1['disposition']
  action?: CreativeArtifactIssueV1['suggestedAction']
  deterministic?: boolean
}): CreativeArtifactIssueV1 {
  return {
    version: 1,
    code: input.code,
    severity: input.severity ?? 'error',
    disposition: input.disposition ?? 'repairable',
    path: input.path,
    message: input.message,
    suggestedAction: input.action ?? 'repair-once',
    evidenceRefs: [],
    deterministic: input.deterministic ?? true,
  }
}

function storyArcCreativeParseOutcomeV1(
  raw: string,
  snapshot: StoryArcCopilotSnapshot,
  kind: StoryArcRequestKind,
): StoryArcCreativeParseOutcomeV1 {
  if (!raw.trim()) {
    const empty = creativeIssue({
      code: 'story-arc-empty-response',
      path: '$',
      message: '模型没有返回故事线内容。',
    })
    return {
      status: 'manual-repair',
      candidates: [],
      editableText: '[]',
      validFragments: [],
      rejectedFragments: [],
      issues: [empty],
      assumptions: [],
    }
  }
  if (raw.length > MAX_CANDIDATE_CHARS) {
    const tooLarge = creativeIssue({
      code: 'story-arc-response-too-large',
      path: '$',
      message: `故事线响应超过 ${MAX_CANDIDATE_CHARS} 字符，不能安全持久化。`,
      disposition: 'blocking',
      action: 'replan',
    })
    return {
      status: 'blocked',
      candidates: [],
      editableText: raw.slice(0, MAX_CANDIDATE_CHARS),
      validFragments: [],
      rejectedFragments: [],
      issues: [tooLarge],
      assumptions: [],
    }
  }
  const envelope = normalizeCreativeJsonEnvelopeV1(raw)
  if (!envelope.value) {
    return {
      status: 'manual-repair',
      candidates: [],
      editableText: envelope.normalizedText,
      validFragments: [],
      rejectedFragments: [{
        version: 1,
        id: 'story-arc-response',
        path: '$',
        text: envelope.normalizedText.slice(0, 40_000),
        status: 'rejected',
        issueCodes: envelope.issues.map(issue => issue.code),
      }],
      issues: envelope.issues,
      assumptions: [],
    }
  }

  const rootKeys = Object.keys(envelope.value)
  if (!rootKeys.includes('storyArcs') || rootKeys.some(key => key !== 'storyArcs' && key !== 'assumptions')) {
    const rootIssue = creativeIssue({
      code: 'story-arc-root-fields-invalid',
      path: '$',
      message: '故事线响应顶层必须包含 storyArcs，且只能额外包含 assumptions。',
    })
    return {
      status: 'manual-repair',
      candidates: [],
      editableText: envelope.normalizedText,
      validFragments: [],
      rejectedFragments: [{
        version: 1,
        id: 'story-arc-response',
        path: '$',
        text: envelope.normalizedText.slice(0, 40_000),
        status: 'rejected',
        issueCodes: [rootIssue.code],
      }],
      issues: [rootIssue],
      assumptions: [],
    }
  }
  if (!Array.isArray(envelope.value.storyArcs)) {
    const arrayIssue = creativeIssue({
      code: 'story-arc-list-invalid',
      path: '$.storyArcs',
      message: 'storyArcs 必须是数组。',
    })
    return {
      status: 'manual-repair',
      candidates: [],
      editableText: envelope.normalizedText,
      validFragments: [],
      rejectedFragments: [{
        version: 1,
        id: 'story-arc-list',
        path: '$.storyArcs',
        text: JSON.stringify(envelope.value.storyArcs).slice(0, 40_000),
        status: 'rejected',
        issueCodes: [arrayIssue.code],
      }],
      issues: [arrayIssue],
      assumptions: [],
    }
  }

  const candidates: StoryArcCopilotCandidate[] = []
  const validFragments: CreativeArtifactFragmentV1[] = []
  const rejectedFragments: CreativeArtifactFragmentV1[] = []
  const issues: CreativeArtifactIssueV1[] = []
  const assumptionResult = parseStoryArcAssumptionTextsV1(envelope.value.assumptions, false)
  issues.push(...assumptionResult.issues)
  envelope.value.storyArcs.forEach((value, index) => {
    const normalized = normalizeStoryArcCreativeItemV1(value, index)
    issues.push(...normalized.issues)
    try {
      const candidate = parseStoryArcCandidateDraft(JSON.stringify([normalized.value]))[0]
      candidates.push(candidate)
      validFragments.push({
        version: 1,
        id: `story-arc:${index}`,
        path: `$.storyArcs[${index}]`,
        text: JSON.stringify(candidate, null, 2),
        status: 'valid',
        issueCodes: [],
      })
    } catch (error) {
      const itemIssue = creativeIssue({
        code: 'story-arc-item-invalid',
        path: `$.storyArcs[${index}]`,
        message: error instanceof Error ? error.message : '故事线项目结构无效。',
      })
      issues.push(itemIssue)
      rejectedFragments.push({
        version: 1,
        id: `story-arc:${index}`,
        path: itemIssue.path,
        text: JSON.stringify(normalized.value, null, 2).slice(0, 40_000),
        status: 'rejected',
        issueCodes: [itemIssue.code],
      })
    }
  })

  const gateIssues = candidateIssues(candidates, snapshot, kind)
  issues.push(...gateIssues.map(item => creativeIssue({
    code: item.code,
    path: '$.storyArcs',
    message: item.message,
  })))
  const gatePassed = gateIssues.length === 0
  const status: CreativeArtifactV1['status'] = issues.length === 0
    ? 'ready'
    : candidates.length > 0 && gatePassed
      ? 'usable-with-warnings'
      : 'manual-repair'
  return {
    status,
    candidates,
    editableText: candidates.length ? JSON.stringify(candidates, null, 2) : envelope.normalizedText,
    validFragments,
    rejectedFragments,
    issues,
    assumptions: assumptionResult.assumptions,
  }
}

/**
 * Re-gates an author-edited bare-array draft without making another model call.
 * The original call/repair evidence stays immutable; only the editable view and
 * its current deterministic validation result are refreshed.
 */
export function revalidateStoryArcCreativeDraftV1(input: {
  draft: string
  snapshot: StoryArcCopilotSnapshot
  kind: StoryArcRequestKind
  previousArtifact: CreativeArtifactV1
}): CreativeArtifactV1 {
  let status: CreativeArtifactV1['status'] = 'ready'
  let validFragments: CreativeArtifactFragmentV1[] = []
  let rejectedFragments: CreativeArtifactFragmentV1[] = []
  let issues: CreativeArtifactIssueV1[] = []

  if (input.draft.length > MAX_CANDIDATE_CHARS) {
    status = 'blocked'
    issues = [creativeIssue({
      code: 'story-arc-author-draft-too-large',
      path: '$',
      message: `作者修订稿超过 ${MAX_CANDIDATE_CHARS} 字符，不能安全采纳。`,
      disposition: 'blocking',
      action: 'edit',
    })]
    rejectedFragments = [{
      version: 1,
      id: 'story-arc-author-draft',
      path: '$',
      text: input.draft.slice(0, 40_000),
      status: 'rejected',
      issueCodes: issues.map(issue => issue.code),
    }]
  } else {
    try {
      const candidates = parseStoryArcCandidateDraft(input.draft)
      const gateIssues = candidateIssues(candidates, input.snapshot, input.kind)
      validFragments = candidates.map((candidate, index) => ({
        version: 1,
        id: `story-arc:${index}`,
        path: `$[${index}]`,
        text: JSON.stringify(candidate, null, 2),
        status: 'valid',
        issueCodes: [],
      }))
      if (gateIssues.length) {
        status = 'blocked'
        issues = gateIssues.map(item => creativeIssue({
          code: item.code,
          path: '$',
          message: item.message,
          disposition: 'blocking',
          action: 'edit',
        }))
      }
    } catch (error) {
      status = 'manual-repair'
      issues = [creativeIssue({
        code: 'story-arc-author-draft-invalid',
        path: '$',
        message: error instanceof Error ? error.message : '作者修订稿结构无效。',
        action: 'edit',
      })]
      rejectedFragments = [{
        version: 1,
        id: 'story-arc-author-draft',
        path: '$',
        text: input.draft.slice(0, 40_000),
        status: 'rejected',
        issueCodes: issues.map(issue => issue.code),
      }]
    }
  }

  return parseCreativeArtifactV1({
    ...input.previousArtifact,
    status,
    editableText: input.draft.slice(0, MAX_CANDIDATE_CHARS),
    validFragments,
    rejectedFragments,
    issues,
  })
}

function buildStoryArcRepairMessagesV1(input: {
  raw: string
  issues: readonly CreativeArtifactIssueV1[]
  kind: StoryArcRequestKind
}): ChatMessage[] {
  const kindRule = input.kind === 'main'
    ? 'storyArcs 只能有一项且 type=main。'
    : input.kind === 'sub'
      ? 'storyArcs 只能有一项且 type=sub。'
      : 'storyArcs 必须同时包含至少一项 main 和一项 sub。'
  return [{
    role: 'system',
    content: [
      '你是结构修复器，只修下面列出的确定性问题，不重新创作故事。',
      '保留原输出中全部合法名称、描述、事件顺序和事实，不引入新人物、新设定或新因果。',
      kindRule,
      '只返回严格 JSON 对象，顶层必须有 storyArcs，可保留合法的 assumptions 字符串数组。',
      '每项严格为 name/type/description/stages；每个阶段必须有 title/description/keyEvents，',
      'turningPoint/startVolume/endVolume 没有明确内容时直接省略，禁止 null 或占位值。',
      '不要解释，不要 Markdown。',
    ].join('\n'),
  }, {
    role: 'user',
    content: [
      '【只允许修复的问题】',
      JSON.stringify(input.issues.map(issue => ({
        code: issue.code,
        path: issue.path,
      }))),
      '【上一次原始输出】',
      input.raw,
    ].join('\n'),
  }]
}

function storyArcCallEvidenceV1(input: {
  callIndex: 1 | 2
  purpose: CreativeCallEvidenceV1['purpose']
  messages: readonly ChatMessage[]
  modelIdentity: PreparedStoryArcCopilot['modelIdentity']
  result?: StoryArcRawModelResultV1
  failed?: boolean
}): Promise<CreativeCallEvidenceV1> {
  return (async () => {
    const estimatedInput = input.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
    const estimatedOutput = input.result ? estimateTokens(input.result.output) : null
    const usage = input.result?.usage
    const inputTokens = usage?.inputTokens ?? (input.result ? estimatedInput : null)
    const outputTokens = usage?.outputTokens ?? estimatedOutput
    return {
      version: 1,
      callIndex: input.callIndex,
      purpose: input.purpose,
      status: input.failed ? 'failed' : 'succeeded',
      provider: input.modelIdentity.provider,
      model: input.modelIdentity.model,
      usageSource: usage ? 'provider' : input.result ? 'estimated' : 'unknown',
      inputTokens,
      outputTokens,
      totalTokens: usage?.totalTokens ?? (
        estimatedOutput === null ? null : estimatedInput + estimatedOutput
      ),
      latencyMs: input.result?.durationMs ?? null,
      estimatedCostUsd: inputTokens == null || outputTokens == null
        ? null
        : computeKnownCostUsd(input.modelIdentity.model, inputTokens, outputTokens),
      outputHash: input.result ? await hashCanonicalValue(input.result.output) : null,
    }
  })()
}

export async function runStoryArcCreativeReliabilityV1(input: {
  prepared: PreparedStoryArcCopilot
  budget: AgentTeamBudgetTracker
  qualityMode: CreativeQualityModeV1
  validate?: (candidates: StoryArcCopilotCandidate[]) => Promise<GenerationGateIssue[]> | GenerationGateIssue[]
}): Promise<StoryArcCreativeRunResultV1> {
  const policy = resolveCreativeQualityPolicyV1(input.qualityMode)
  const maxOutputTokens = input.prepared.input.generationOverrides?.maxTokens ?? 10_000
  const firstMessages = input.prepared.prepared.messages
  const firstReservation = input.budget.reserveCall({
    label: '故事线编排 Skill',
    messages: firstMessages,
    maxOutputTokens,
  })
  let first: StoryArcRawModelResultV1
  try {
    first = await input.prepared.runRaw(firstMessages)
    input.budget.settleCall(firstReservation, first.output)
  } catch (error) {
    input.budget.settleFailedCall(firstReservation)
    throw error
  }
  const calls: CreativeCallEvidenceV1[] = [await storyArcCallEvidenceV1({
    callIndex: 1,
    purpose: 'generate',
    messages: firstMessages,
    modelIdentity: input.prepared.modelIdentity,
    result: first,
  })]
  let outcome = storyArcCreativeParseOutcomeV1(
    first.output,
    input.prepared.snapshot,
    input.prepared.kind,
  )
  if (outcome.candidates.length > 0 && input.validate) {
    const hardIssues = await input.validate(outcome.candidates)
    if (hardIssues.length) {
      outcome = {
        ...outcome,
        status: 'blocked',
        issues: [...outcome.issues, ...hardIssues.map(item => creativeIssue({
          code: item.code,
          path: '$.storyArcs',
          message: item.message,
          disposition: 'blocking',
          action: 'repair-once',
        }))],
      }
    }
  }

  const repairable = outcome.issues.some(issue => issue.suggestedAction === 'repair-once')
  let repair: CreativeArtifactV1['repair'] = null
  if (policy.allowAutomaticRepair && repairable) {
    const repairIssues = outcome.issues.filter(issue => issue.suggestedAction === 'repair-once')
    const repairTargetIssueCodes = [...new Set(repairIssues.map(issue => issue.code))]
    const repairMessages = buildStoryArcRepairMessagesV1({
      raw: first.output,
      issues: repairIssues,
      kind: input.prepared.kind,
    })
    const reservation = input.budget.reserveCall({
      label: '故事线编排 Skill（定向修复）',
      messages: repairMessages,
      maxOutputTokens,
    })
    let repaired: StoryArcRawModelResultV1 | null = null
    try {
      repaired = await input.prepared.runRaw(repairMessages)
      input.budget.settleCall(reservation, repaired.output)
      calls.push(await storyArcCallEvidenceV1({
        callIndex: 2,
        purpose: 'repair',
        messages: repairMessages,
        modelIdentity: input.prepared.modelIdentity,
        result: repaired,
      }))
      const next = storyArcCreativeParseOutcomeV1(
        repaired.output,
        input.prepared.snapshot,
        input.prepared.kind,
      )
      if (next.candidates.length > 0 && input.validate) {
        const hardIssues = await input.validate(next.candidates)
        if (hardIssues.length) {
          next.status = 'blocked'
          next.issues.push(...hardIssues.map(item => creativeIssue({
            code: item.code,
            path: '$.storyArcs',
            message: item.message,
            disposition: 'blocking',
            action: 'replan',
          })))
        }
      }
      outcome = next
    } catch {
      input.budget.settleFailedCall(reservation)
      calls.push(await storyArcCallEvidenceV1({
        callIndex: 2,
        purpose: 'repair',
        messages: repairMessages,
        modelIdentity: input.prepared.modelIdentity,
        failed: true,
      }))
      const wasBlocked = outcome.status === 'blocked'
      if (!wasBlocked) outcome.status = 'manual-repair'
      outcome.issues.push(creativeIssue({
        code: 'story-arc-repair-provider-failed',
        path: '$',
        message: '唯一一次定向修复调用失败；已停止自动调用并保留首次产物。',
        disposition: wasBlocked ? 'blocking' : 'repairable',
        action: 'edit',
        deterministic: false,
      }))
    }
    repair = {
      version: 1,
      sourceTextHash: await hashCanonicalValue(first.output),
      targetIssueCodes: repairTargetIssueCodes,
      callIndex: 2,
      result: repaired == null
        ? 'failed'
        : outcome.status === 'ready'
          ? 'repaired'
          : outcome.candidates.length > 0
            ? 'partial'
            : 'failed',
    }
  }

  const artifact = parseCreativeArtifactV1({
    version: 1,
    policyVersion: 'creative-reliability-v1',
    status: outcome.status,
    qualityMode: input.qualityMode,
    originalText: first.output.slice(0, MAX_CANDIDATE_CHARS),
    editableText: outcome.editableText,
    validFragments: outcome.validFragments,
    rejectedFragments: outcome.rejectedFragments,
    issues: outcome.issues,
    assumptions: mergeProvisionalAssumptionsV1(
      input.prepared.input.narrativeBrief.assumptions,
      outcome.assumptions,
    ),
    canonEvidenceRefs: [],
    callEvidence: calls,
    repair,
  })
  return {
    output: outcome.candidates,
    draft: outcome.editableText,
    artifact,
  }
}

function buildStoryArcMessages(input: StoryArcCopilotInput): ChatMessage[] {
  const kindInstruction = input.kind === 'main'
    ? '只规划且只输出 1 条故事线；type 必须严格为 main，禁止输出 sub。'
    : input.kind === 'sub'
      ? '只规划且只输出 1 条故事线；type 必须严格为 sub，并说明它如何与现有主线交织，禁止输出 main。'
      : '同时规划至少一条 main 主线和一条 sub 支线，并明确它们的交汇关系。'
  const supplemental = input.supplementalContext.trim()
    ? `\n\n【本轮已验证上游候选（尚未采纳，不属于 Canon）】\n${input.supplementalContext.trim()}`
    : ''
  return [{
    role: 'system' as const,
    content: `你是 StoryForge 大纲 Agent，当前执行 story-arcs Skill。你的职责是把作者已确认的世界、
故事核心、角色和既有规划编排为可确认的主线/支线候选，不改写上游事实，也不把规划中的未来信息
伪装成角色当前已知信息。

硬性要求：
1. ${kindInstruction}
2. 默认生成紧凑但完整的 3-5 个因果递进阶段；每阶段包含标题、一到两句描述和 1-3 个关键事件，每个事件用一句话表达。不要为了填满上限重复、拆碎或扩写同一事件。
3. 每条故事线顶层只能有 name/type/description/stages 四个字段。turningPoint、startVolume、endVolume 只能放在 stages 数组内的阶段对象上，绝不能放在故事线顶层；只有确有卷级依据时才同时填写 startVolume/endVolume，均为从 1 开始的整数。
4. 已有设定是硬约束；不得改变既定时限、能力、代价、因果或实体身份，也不得为未命名人物擅自命名。设定缺失时只做不与现有事实冲突的候选补全，不声称它已经成为 Canon。
5. 避免复制已有故事线；支线必须有独立目标，也要说明与主线的因果交汇。
6. 只输出一个严格 JSON 对象，不输出 Markdown、解释或额外字段。顶层${input.creativeReliabilityEnabled !== false ? '必须有 storyArcs，可选 assumptions' : '只能有 storyArcs'}；最小结构严格使用：
{"storyArcs":[{"name":"名称","type":"main|sub","description":"整体描述","stages":[{"title":"阶段标题","description":"阶段描述","keyEvents":["事件"]}]}]}
7. 阶段对象内的 turningPoint、startVolume、endVolume 都是可选字段；turningPoint 如填写必须是描述转折的字符串，绝不能写 true/false；startVolume/endVolume 只有在两者都有明确卷级依据时才成对填写整数。没有明确依据就省略，不要输出占位值。
${input.creativeReliabilityEnabled !== false
  ? '8. 若你为“开放创作空间”补充了会被下游依赖、但正式上下文没有确认的事实，可增加 assumptions 字符串数组，最多 7 项；不要把故事线本身重复抄入 assumptions。'
  : ''}`,
  }, {
    role: 'user' as const,
    content: [
      input.inputGuidance,
      `【作者要求】\n${input.authorRequest}${supplemental}`,
      ...(input.creativeReliabilityEnabled !== false
        ? [formatNarrativeBriefForPromptV1(input.narrativeBrief)]
        : []),
      `【正式上下文】\n${input.assembled.text || '（当前没有已填写的正式上游内容）'}`,
    ].join('\n\n'),
  }]
}

function toStoredStages(candidate: StoryArcCopilotCandidate): StoryStage[] {
  return candidate.stages.map(stage => ({
    id: nanoid(8),
    title: stage.title,
    description: stage.description,
    keyEvents: [...stage.keyEvents],
    ...(stage.turningPoint ? { turningPoint: stage.turningPoint } : {}),
    ...(stage.startVolume === undefined
      ? {}
      : { startVolume: stage.startVolume, endVolume: stage.endVolume }),
  }))
}

async function adoptCandidates(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  snapshot: StoryArcCopilotSnapshot
  candidates: StoryArcCopilotCandidate[]
}): Promise<{ writtenCount: number; ids: number[] }> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  return db.transaction('rw', scopeTransactionTables(db.storyArcs), async () => {
    const current = await readSnapshot(input.projectId, scope)
    if (current.serialized !== input.snapshot.serialized) throw new StoryArcCopilotStaleError()
    const issues = candidateIssues(input.candidates, current, 'mixed')
      .filter(issue => issue.code !== 'story-arc-kind-mismatch')
    if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
    const result = await adopt({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      target: 'storyArcs',
      mode: 'add-many',
      data: input.candidates.map(candidate => ({
        name: candidate.name,
        type: candidate.type,
        description: candidate.description,
        stages: stringifyStages(toStoredStages(candidate)),
      })),
    })
    if (
      result.written.length !== input.candidates.length
      || result.unknown.length
      || result.typeErrors.length
      || result.fkErrors.length
      || result.skipped.length
    ) throw new Error(`故事线候选只写入 ${result.written.length}/${input.candidates.length} 项，已回滚。`)
    return { writtenCount: result.written.length, ids: result.written.map(row => row.id) }
  })
}

export async function adoptRestoredStoryArcCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  snapshot: StoryArcCopilotSnapshot
  draft: string
}): Promise<{ writtenCount: number; ids: number[] }> {
  return adoptCandidates({
    ...input,
    candidates: parseStoryArcCandidateDraft(input.draft),
  })
}

export function storyArcCandidateMatchesRowV1(
  candidate: StoryArcCopilotCandidate,
  row: StoryArc,
): boolean {
  if (
    normalizeIdentity(candidate.name) !== normalizeIdentity(row.name)
    || candidate.type !== row.type
    || candidate.description !== (row.description ?? '')
  ) return false
  const stages = parseStages(row.stages)
  if (stages.length !== candidate.stages.length) return false
  return candidate.stages.every((expected, index) => {
    const actual = stages[index]
    return actual != null
      && expected.title === actual.title
      && expected.description === actual.description
      && JSON.stringify(expected.keyEvents) === JSON.stringify(actual.keyEvents)
      && (expected.turningPoint ?? '') === (actual.turningPoint ?? '')
      && (expected.startVolume ?? null) === (actual.startVolume ?? null)
      && (expected.endVolume ?? null) === (actual.endVolume ?? null)
  })
}

export async function prepareStoryArcCopilot(
  input: {
    projectId: number
    scope?: WorkspaceScope
    worldGroupId: number | null
    authorRequest: string
    skillId?: AgentSkillId
    supplementalContext?: string
    routingCategory?: string
    contextProfile?: AgentContextProfile
    configOverride?: AIConfig
    generationOverrides?: { temperature?: number; maxTokens?: number }
    contextCompressionRuntime?: AgentContextCompressionRuntimeV1
    inheritedAssumptions?: readonly CreativeAssumptionV1[]
    creativeReliabilityEnabled?: boolean
    signal?: AbortSignal
  },
  dependencies: StoryArcCopilotDependencies = {},
): Promise<PreparedStoryArcCopilot> {
  const request = assertAuthorRequest(input.authorRequest)
  const skill = resolveAgentSkillV1('outline', input.skillId ?? 'outline.story-arcs')
  if (skill.executionMode !== 'story-arcs') throw new Error('故事线 Copilot 只接受 outline.story-arcs Skill。')
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) {
    throw new Error('多世界项目必须先选择一个世界，才能生成故事线。')
  }
  const worldGroupId = project.enableMultiWorld ? input.worldGroupId : null
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const scope = isLegacyReadScope(readScope) ? undefined : readScope
  const before = await readSnapshot(input.projectId, scope)
  const routingCategory = input.routingCategory ?? 'agent.outline.story-arcs'
  const config = input.configOverride ?? resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: routingCategory },
  ).config
  const contextProfile = input.contextProfile ?? 'balanced'
  const contextPolicy = resolveAgentContextPolicy(skill.contextTaskKind, contextProfile)
  const compression = input.contextCompressionRuntime
    ? createAgentContextCompressionSessionV1({
        policy: skill.contextCompression,
        config,
        projectId: input.projectId,
        authorRequest: request,
        routingCategory,
        signal: input.signal,
        runtime: input.contextCompressionRuntime,
      })
    : undefined
  const assembled = await assembleContext({
    projectId: input.projectId,
    scope,
    worldGroupId,
    provider: config.provider,
    model: config.model,
    sourceKeys: [...skill.contextSourceKeys],
    inputBudgetMaxTokens: contextPolicy.maxInputTokens,
    sourceBudgetScale: contextPolicy.sourceBudgetScale,
    sourceTransformer: compression?.sourceTransformer,
  })
  const snapshot = await readSnapshot(input.projectId, scope)
  if (before.serialized !== snapshot.serialized) throw new StoryArcCopilotStaleError()
  const inputState = resolveAgentSkillInputStateV1(skill, [assembled])
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  const kind = resolveStoryArcRequestKindV1(request)
  const narrativeBrief = buildNarrativeBriefV1({
    authorRequest: request,
    assembled,
    inheritedAssumptions: input.inheritedAssumptions,
  })
  const creativeReliabilityEnabled = input.creativeReliabilityEnabled
    ?? isCreativeReliabilityRuntimeEnabledV1()
  const nodeInput: StoryArcCopilotInput = {
    projectId: input.projectId,
    scope,
    worldGroupId,
    authorRequest: request,
    supplementalContext: input.supplementalContext ?? '',
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    kind,
    assembled,
    narrativeBrief,
    creativeReliabilityEnabled,
    snapshot,
    config,
    routingCategory,
    generationOverrides: input.generationOverrides,
    signal: input.signal,
  }
  const runRaw = async (messages: ChatMessage[]): Promise<StoryArcRawModelResultV1> => {
    const startedAt = Date.now()
    const result: ChatResult = {}
    const output = dependencies.runAI
      ? await dependencies.runAI(messages)
      : await chat(messages, config, {
          category: routingCategory,
          projectId: input.projectId,
          configOverrides: {
            maxTokens: input.generationOverrides?.maxTokens ?? 10_000,
            temperature: input.generationOverrides?.temperature ?? 0.55,
          },
          contextOverflowPolicy: 'reject',
        }, input.signal, result, supportsVerifiedJsonObjectResponseV1(config.provider)
          ? { responseFormat: 'json_object' }
          : undefined)
    return {
      output,
      ...(result.usage ? { usage: result.usage } : {}),
      durationMs: Math.max(0, Date.now() - startedAt),
    }
  }
  const node = createStoryArcCopilotNode(nodeInput, {
    ...dependencies,
    runAI: async messages => (await runRaw(messages)).output,
  })
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    contextSources: assembled.included,
    contextEvidence,
    snapshot,
    kind,
    label: kind === 'main' ? '主线故事线' : kind === 'sub' ? '支线故事线' : '主线与支线',
    modelIdentity: { provider: config.provider, model: config.model },
    runRaw,
  }
}

export function createStoryArcCopilotNode(
  input: StoryArcCopilotInput,
  dependencies: StoryArcCopilotDependencies = {},
): PreparedStoryArcCopilot['node'] {
  const readCurrent = dependencies.readCurrent ?? (() => readSnapshot(input.projectId, input.scope))
  const saveCandidates = dependencies.saveCandidates ?? (candidates => adoptCandidates({
    projectId: input.projectId,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    snapshot: input.snapshot,
    candidates,
  }))
  const runAI = dependencies.runAI ?? (messages => chat(messages, input.config, {
    category: input.routingCategory,
    projectId: input.projectId,
    configOverrides: {
      maxTokens: input.generationOverrides?.maxTokens ?? 10_000,
      temperature: input.generationOverrides?.temperature ?? 0.55,
    },
    contextOverflowPolicy: 'reject',
  }, input.signal, undefined, supportsVerifiedJsonObjectResponseV1(input.config.provider)
    ? { responseFormat: 'json_object' }
    : undefined))
  return {
    id: `agent.outline.story-arcs:${input.projectId}:${input.worldGroupId ?? 'global'}:${input.kind}:${input.snapshot.serialized.length}`,
    kind: 'outline.story-arcs',
    editableInput: true,
    assembleInput: buildStoryArcMessages,
    run: async messages => (
      input.creativeReliabilityEnabled !== false
        ? parseStoryArcModelResponseV2(await runAI(messages))
        : parseStoryArcModelResponseLegacyV1(await runAI(messages))
    ),
    gate: output => {
      const issues = candidateIssues(output, input.snapshot, input.kind)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      const current = await readCurrent()
      if (current.serialized !== input.snapshot.serialized) throw new StoryArcCopilotStaleError()
      const candidates = parseStoryArcCandidateDraft(JSON.stringify(output))
      const issues = candidateIssues(candidates, current, input.kind)
      if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
      return saveCandidates(candidates)
    },
  }
}
