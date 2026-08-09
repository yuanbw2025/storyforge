import { useAIConfigStore } from '../../stores/ai-config'
import { chat, resolveRequestConfig } from '../ai/client'
import type { FieldGenerationMode } from '../ai/field-generation-context'
import { db } from '../db/schema'
import type {
  GenerationGateIssue,
  GenerationNode,
  PreparedGenerationNode,
} from '../generation/generation-node'
import { prepareGenerationNode } from '../generation/generation-node'
import { adopt } from '../registry/adopt'
import { assembleContext } from '../registry/assemble-context'
import type { AdoptResult, AssembleContextResult } from '../registry/types'
import type { AIConfig, ChatMessage, StoryCore } from '../types'
import type { WorkspaceScope } from '../types/world-ownership'
import {
  isLegacyReadScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScope,
  scopeTransactionTables,
} from '../world-engine/scope'
import {
  createAgentContextCompressionSessionV1,
  type AgentContextCompressionRuntimeV1,
} from './context-compression'
import {
  attachAgentContextInputStateV1,
  evidenceFromContextResult,
  resolveAgentContextPolicy,
  type AgentContextEvidence,
  type AgentContextProfile,
} from './context-policy'
import type { MasterCandidateModelIdentityV1 } from './master-candidate-semantic-review'
import {
  buildAgentSkillInputGuidanceV1,
  resolveAgentSkillInputStateV1,
  resolveAgentSkillV1,
  type AgentSkillId,
} from './skill-registry'

export const STORY_CORE_FIELDS = [
  'logline',
  'concept',
  'theme',
  'centralConflict',
  'plotPattern',
  'mainPlot',
  'subPlots',
] as const

export type StoryCoreField = typeof STORY_CORE_FIELDS[number]

export interface StoryCoreCopilotCandidate {
  field: StoryCoreField
  value: string
}

export interface StoryCoreCopilotSnapshot {
  id: number | null
  updatedAt: number | null
  serialized: string
  values: Record<StoryCoreField, string>
}

export interface StoryCoreCopilotInput {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  supplementalContext: string
  inputGuidance: string
  targetField: StoryCoreField
  mode: FieldGenerationMode
  assembled: AssembleContextResult
  snapshot: StoryCoreCopilotSnapshot
  config: AIConfig
  routingCategory: string
  generationOverrides?: { temperature?: number; maxTokens?: number }
  signal?: AbortSignal
}

export interface PreparedStoryCoreCopilot {
  node: GenerationNode<StoryCoreCopilotInput, StoryCoreCopilotCandidate, AdoptResult>
  prepared: PreparedGenerationNode
  input: StoryCoreCopilotInput
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  snapshot: StoryCoreCopilotSnapshot
  targetField: StoryCoreField
  label: string
  modelIdentity: MasterCandidateModelIdentityV1
}

interface StoryCoreCopilotDependencies {
  runAI?: (messages: ChatMessage[]) => Promise<string>
  readCurrent?: () => Promise<StoryCoreCopilotSnapshot>
  adoptOutput?: (candidate: StoryCoreCopilotCandidate) => Promise<AdoptResult>
}

const FIELD_LABELS: Record<StoryCoreField, string> = {
  logline: '一句话故事',
  concept: '故事概念',
  theme: '故事主题',
  centralConflict: '核心冲突',
  plotPattern: '故事模式',
  mainPlot: '故事主线',
  subPlots: '故事复线',
}

const FIELD_MAX_CHARS: Record<StoryCoreField, number> = {
  logline: 1_000,
  concept: 4_000,
  theme: 4_000,
  centralConflict: 12_000,
  plotPattern: 4_000,
  mainPlot: 30_000,
  subPlots: 30_000,
}

const MODE_INSTRUCTIONS: Record<FieldGenerationMode, string> = {
  expand: '保留目标字段当前已有事实和方向，在其基础上补足因果、约束与具体性。',
  rewrite: '允许重写目标字段，但必须遵守其他已确认字段和正式上下文，不得顺手改写它们。',
  polish: '只优化目标字段的表达、逻辑顺序和可读性，除非作者明确要求，不新增重大设定。',
}

export class StoryCoreCopilotStaleError extends Error {
  constructor() {
    super('故事核心已在候选生成后发生变化。为避免覆盖作者的新修改，请重新生成候选。')
    this.name = 'StoryCoreCopilotStaleError'
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function valuesOf(row: StoryCore | null): Record<StoryCoreField, string> {
  return {
    logline: asText(row?.logline),
    concept: asText(row?.concept),
    theme: asText(row?.theme),
    centralConflict: asText(row?.centralConflict),
    plotPattern: asText(row?.plotPattern),
    mainPlot: asText(row?.mainPlot) || asText(row?.storyLines),
    subPlots: asText(row?.subPlots),
  }
}

function snapshotOf(row: StoryCore | null): StoryCoreCopilotSnapshot {
  const values = valuesOf(row)
  return {
    id: row?.id ?? null,
    updatedAt: row?.updatedAt ?? null,
    serialized: JSON.stringify({ id: row?.id ?? null, updatedAt: row?.updatedAt ?? null, values }),
    values,
  }
}

async function readSnapshot(
  projectId: number,
  scope?: WorkspaceScope,
): Promise<StoryCoreCopilotSnapshot> {
  const resolved = scope ?? await resolveReadScopeLike(projectId)
  const row = (await readOwnedRows<StoryCore>(resolved, 'storyCores', { owner: 'work' }))[0] ?? null
  return snapshotOf(row)
}

function assertAuthorRequest(value: string): string {
  const request = value.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的故事核心要求。')
  if (request.length > 1_000) throw new Error('单次故事核心要求不能超过 1000 个字符。')
  return request
}

export function resolveStoryCoreFieldV1(request: string): StoryCoreField {
  const explicit = /目标字段\s*=\s*(logline|concept|theme|centralConflict|plotPattern|mainPlot|subPlots)\b/i.exec(request)?.[1]
  if (explicit) {
    return STORY_CORE_FIELDS.find(field => field.toLowerCase() === explicit.toLowerCase())!
  }
  const aliases: Array<[StoryCoreField, RegExp]> = [
    ['logline', /一句话故事|故事梗概句/],
    ['concept', /故事概念|高概念/],
    ['theme', /故事主题|主题命题/],
    ['centralConflict', /核心冲突|中心冲突/],
    ['plotPattern', /故事模式|情节模式/],
    ['mainPlot', /故事主线|主情节/],
    ['subPlots', /故事复线|故事副线/],
  ]
  const matched = aliases.find(([, pattern]) => pattern.test(request))?.[0]
  if (!matched) throw new Error('故事核心任务缺少明确的目标字段。')
  return matched
}

export function resolveStoryCoreModeV1(request: string): FieldGenerationMode {
  const explicit = /生成模式\s*=\s*(expand|rewrite|polish)\b/i.exec(request)?.[1]?.toLowerCase()
  if (explicit === 'rewrite' || explicit === 'polish' || explicit === 'expand') return explicit
  if (/重写|重做|推倒重来/.test(request)) return 'rewrite'
  if (/润色|优化表达/.test(request)) return 'polish'
  return 'expand'
}

function parseJsonObject(draft: string): Record<string, unknown> {
  const input = draft.trim()
  if (!input) throw new Error('故事核心候选为空。')
  if (input.length > 35_000) throw new Error('故事核心候选超过 35000 字符。')
  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(input)
  let parsed: unknown
  try {
    parsed = JSON.parse(fenced?.[1]?.trim() ?? input)
  } catch {
    throw new Error('故事核心候选不是有效的严格 JSON 对象。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('故事核心候选必须是 JSON 对象。')
  }
  return parsed as Record<string, unknown>
}

export function parseStoryCoreCandidateDraft(draft: string): StoryCoreCopilotCandidate {
  const source = parseJsonObject(draft)
  const keys = Object.keys(source).sort()
  if (keys.length !== 2 || keys[0] !== 'field' || keys[1] !== 'value') {
    throw new Error('故事核心候选只能包含 field 和 value。')
  }
  if (!STORY_CORE_FIELDS.includes(source.field as StoryCoreField)) {
    throw new Error('故事核心候选 field 不在允许范围。')
  }
  const field = source.field as StoryCoreField
  if (typeof source.value !== 'string' || source.value.trim().length < 2) {
    throw new Error(`故事核心候选 ${field}.value 至少需要 2 个字符。`)
  }
  const value = source.value.trim()
  if (value.length > FIELD_MAX_CHARS[field]) {
    throw new Error(`故事核心候选 ${field}.value 超过 ${FIELD_MAX_CHARS[field]} 字符。`)
  }
  return { field, value }
}

function candidateIssues(
  candidate: StoryCoreCopilotCandidate,
  input: Pick<StoryCoreCopilotInput, 'targetField' | 'snapshot'>,
): GenerationGateIssue[] {
  let parsed: StoryCoreCopilotCandidate
  try {
    parsed = parseStoryCoreCandidateDraft(JSON.stringify(candidate))
  } catch (error) {
    return [{
      code: 'story-core-invalid-structure',
      message: error instanceof Error ? error.message : '故事核心候选结构无效。',
    }]
  }
  const issues: GenerationGateIssue[] = []
  if (parsed.field !== input.targetField) {
    issues.push({
      code: 'story-core-field-mismatch',
      message: `本轮只允许修改 ${input.targetField}，候选却请求修改 ${parsed.field}。`,
    })
  }
  if (parsed.value === input.snapshot.values[input.targetField].trim()) {
    issues.push({ code: 'story-core-unchanged', message: '候选与目标字段当前内容完全相同。' })
  }
  return issues
}

function buildStoryCoreMessages(input: StoryCoreCopilotInput): ChatMessage[] {
  const supplemental = input.supplementalContext.trim()
    ? `\n\n【本轮已验证上游候选（尚未采纳，不属于 Canon）】\n${input.supplementalContext.trim()}`
    : ''
  return [{
    role: 'system',
    content: `你是 StoryForge 世界基座 Agent，当前执行 story-core Skill。你只为作者生成一个故事核心字段的可确认候选。

硬性要求：
1. 本轮目标字段是 ${input.targetField}（${FIELD_LABELS[input.targetField]}），只允许生成这个字段。
2. ${MODE_INSTRUCTIONS[input.mode]}
3. 正式上下文是约束；缺失内容可以为本字段做最小候选补全，但不得声称它已成为 Canon。
4. 角色、故事线和既有大纲属于下游证据：上游缺失时可以据此反推当前目标字段，上游已有内容时用于核对兼容；不得借反推偷偷覆盖其他故事核心字段。
5. 只输出严格 JSON 对象，不输出 Markdown、解释或额外字段：
{"field":"${input.targetField}","value":"候选正文"}`,
  }, {
    role: 'user',
    content: [
      input.inputGuidance,
      `【作者要求】\n${input.authorRequest}${supplemental}`,
      `【正式上下文】\n${input.assembled.text || '（当前没有已填写的正式设定）'}`,
    ].join('\n\n'),
  }]
}

async function adoptCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  snapshot: StoryCoreCopilotSnapshot
  targetField: StoryCoreField
  candidate: StoryCoreCopilotCandidate
}): Promise<AdoptResult> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  return db.transaction(
    'rw',
    scopeTransactionTables(db.storyCores, db.temporalFacts),
    async () => {
      const current = await readSnapshot(input.projectId, scope)
      if (current.serialized !== input.snapshot.serialized) throw new StoryCoreCopilotStaleError()
      const issues = candidateIssues(input.candidate, {
        targetField: input.targetField,
        snapshot: current,
      })
      if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
      const result = await adopt({
        projectId: input.projectId,
        scope,
        target: 'storyCores',
        mode: 'replace',
        data: { [input.targetField]: input.candidate.value },
      })
      if (
        result.written.length !== 1
        || result.unknown.length
        || result.typeErrors.length
        || result.fkErrors.length
        || result.skipped.length
        || !result.written[0]?.fields.includes(input.targetField)
      ) throw new Error('故事核心候选没有完整通过字段注册表校验，已回滚。')
      return result
    },
  )
}

export async function adoptRestoredStoryCoreCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  snapshot: StoryCoreCopilotSnapshot
  targetField: StoryCoreField
  draft: string
}): Promise<AdoptResult> {
  return adoptCandidate({
    ...input,
    candidate: parseStoryCoreCandidateDraft(input.draft),
  })
}

export function storyCoreCandidateMatchesRowV1(
  candidate: StoryCoreCopilotCandidate,
  row: StoryCore | null | undefined,
): boolean {
  return valuesOf(row ?? null)[candidate.field] === candidate.value
}

export async function prepareStoryCoreCopilot(
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
  dependencies: StoryCoreCopilotDependencies = {},
): Promise<PreparedStoryCoreCopilot> {
  const request = assertAuthorRequest(input.authorRequest)
  const skill = resolveAgentSkillV1('world-origin', input.skillId ?? 'world-origin.story-core')
  if (skill.executionMode !== 'story-core') throw new Error('故事核心 Copilot 只接受 world-origin.story-core Skill。')
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) {
    throw new Error('多世界项目必须先选择一个世界，才能生成故事核心。')
  }
  const worldGroupId = project.enableMultiWorld ? input.worldGroupId : null
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const scope = isLegacyReadScope(readScope) ? undefined : readScope
  const before = await readSnapshot(input.projectId, scope)
  const routingCategory = input.routingCategory ?? 'agent.world-foundation.story-core'
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
  if (before.serialized !== snapshot.serialized) throw new StoryCoreCopilotStaleError()
  const inputState = resolveAgentSkillInputStateV1(skill, [assembled])
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  const targetField = resolveStoryCoreFieldV1(request)
  const nodeInput: StoryCoreCopilotInput = {
    projectId: input.projectId,
    scope,
    worldGroupId,
    authorRequest: request,
    supplementalContext: input.supplementalContext ?? '',
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    targetField,
    mode: resolveStoryCoreModeV1(request),
    assembled,
    snapshot,
    config,
    routingCategory,
    generationOverrides: input.generationOverrides,
    signal: input.signal,
  }
  const node = createStoryCoreCopilotNode(nodeInput, dependencies)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    contextSources: assembled.included,
    contextEvidence,
    snapshot,
    targetField,
    label: FIELD_LABELS[targetField],
    modelIdentity: { provider: config.provider, model: config.model },
  }
}

export function createStoryCoreCopilotNode(
  input: StoryCoreCopilotInput,
  dependencies: StoryCoreCopilotDependencies = {},
): PreparedStoryCoreCopilot['node'] {
  const readCurrent = dependencies.readCurrent ?? (() => readSnapshot(input.projectId, input.scope))
  const adoptOutput = dependencies.adoptOutput ?? (candidate => adoptCandidate({
    projectId: input.projectId,
    scope: input.scope,
    snapshot: input.snapshot,
    targetField: input.targetField,
    candidate,
  }))
  const runAI = dependencies.runAI ?? (messages => chat(messages, input.config, {
    category: input.routingCategory,
    projectId: input.projectId,
    configOverrides: {
      maxTokens: input.generationOverrides?.maxTokens ?? 6_000,
      temperature: input.generationOverrides?.temperature ?? 0.5,
    },
    contextOverflowPolicy: 'reject',
  }, input.signal))
  return {
    id: `agent.world-foundation.story-core:${input.projectId}:${input.targetField}:${input.snapshot.updatedAt ?? 0}`,
    kind: 'world-foundation.story-core',
    editableInput: true,
    assembleInput: buildStoryCoreMessages,
    run: async messages => parseStoryCoreCandidateDraft(await runAI(messages)),
    gate: output => {
      const issues = candidateIssues(output, input)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      const current = await readCurrent()
      if (current.serialized !== input.snapshot.serialized) throw new StoryCoreCopilotStaleError()
      const candidate = parseStoryCoreCandidateDraft(JSON.stringify(output))
      const issues = candidateIssues(candidate, input)
      if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
      return adoptOutput(candidate)
    },
  }
}

function compactText(value: string | null | undefined, max: number): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

export function formatStoryCoreGenerationRequestV1(input: {
  field: StoryCoreField
  mode: FieldGenerationMode
  hint?: string
  parameterValues?: Record<string, unknown>
  systemOverride?: string | null
  userOverride?: string | null
}): string {
  const parts = [
    `生成故事核心字段。目标字段=${input.field}；生成模式=${input.mode}。`,
  ]
  const hint = compactText(input.hint, 360)
  if (hint) parts.push(`作者要求：${hint}`)
  if (input.parameterValues && Object.keys(input.parameterValues).length) {
    const serialized = compactText(JSON.stringify(input.parameterValues), 240)
    if (serialized) parts.push(`模板参数：${serialized}`)
  }
  const systemOverride = compactText(input.systemOverride, 160)
  if (systemOverride) parts.push(`自定义系统要求：${systemOverride}`)
  const userOverride = compactText(input.userOverride, 160)
  if (userOverride) parts.push(`自定义用户要求：${userOverride}`)
  return parts.join('\n').slice(0, 1_000)
}
