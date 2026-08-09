import { nanoid } from 'nanoid'
import { useAIConfigStore } from '../../stores/ai-config'
import { chat, resolveRequestConfig } from '../ai/client'
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
  if (!Array.isArray(source.keyEvents) || source.keyEvents.length < 1 || source.keyEvents.length > 3) {
    throw new Error(`${label}.keyEvents 必须包含 1-3 个事件。`)
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
  return {
    title: assertString(source.title, `${label}.title`, MAX_STAGE_TITLE_CHARS),
    description: assertString(source.description, `${label}.description`, MAX_STAGE_DESCRIPTION_CHARS),
    keyEvents,
    ...(source.turningPoint === undefined
      ? {}
      : { turningPoint: assertString(source.turningPoint, `${label}.turningPoint`, MAX_EVENT_CHARS) }),
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

function buildStoryArcMessages(input: StoryArcCopilotInput): ChatMessage[] {
  const kindInstruction = input.kind === 'main'
    ? '只规划 main 类型主线。'
    : input.kind === 'sub'
      ? '只规划 sub 类型支线，并说明它如何与现有主线交织。'
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
2. 每条故事线必须有 3-7 个因果递进阶段；每阶段包含标题、描述和 1-3 个关键事件。
3. 转折点可用 turningPoint；只有确有卷级依据时才同时填写 startVolume/endVolume，均为从 1 开始的整数。
4. 已有设定是约束；设定缺失时只做服务于本轮规划的候选补全，不声称它已经成为 Canon。
5. 避免复制已有故事线；支线必须有独立目标，也要说明与主线的因果交汇。
6. 只输出严格 JSON 数组，不输出 Markdown、解释或额外字段。每项严格使用：
{"name":"名称","type":"main|sub","description":"整体描述","stages":[{"title":"阶段标题","description":"阶段描述","keyEvents":["事件"],"turningPoint":"可选","startVolume":1,"endVolume":2}]}`,
  }, {
    role: 'user' as const,
    content: [
      input.inputGuidance,
      `【作者要求】\n${input.authorRequest}${supplemental}`,
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
  const nodeInput: StoryArcCopilotInput = {
    projectId: input.projectId,
    scope,
    worldGroupId,
    authorRequest: request,
    supplementalContext: input.supplementalContext ?? '',
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    kind,
    assembled,
    snapshot,
    config,
    routingCategory,
    generationOverrides: input.generationOverrides,
    signal: input.signal,
  }
  const node = createStoryArcCopilotNode(nodeInput, dependencies)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    contextSources: assembled.included,
    contextEvidence,
    snapshot,
    kind,
    label: kind === 'main' ? '主线故事线' : kind === 'sub' ? '支线故事线' : '主线与支线',
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
  }, input.signal))
  return {
    id: `agent.outline.story-arcs:${input.projectId}:${input.worldGroupId ?? 'global'}:${input.kind}:${input.snapshot.serialized.length}`,
    kind: 'outline.story-arcs',
    editableInput: true,
    assembleInput: buildStoryArcMessages,
    run: async messages => parseStoryArcCandidateDraft(await runAI(messages)),
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
