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
import {
  STORY_CORE_GENERATABLE_FIELD_SPECS,
  type StoryCoreGeneratableField,
} from '../registry/field-registry'
import type { AdoptResult, AssembleContextResult } from '../registry/types'
import type { AIConfig, ChatMessage, StoryCore } from '../types'
import type { WorkspaceScope } from '../types/world-ownership'
import {
  readOwnedRows,
  resolveReadScopeLike,
  resolveScope,
  scopeTransactionTables,
} from '../workspace/scope'
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
import {
  executeContextGatewayV1,
  type ContextGatewayExecutionV1,
} from '../context-gateway/execution'
import { isContextGatewayRequiredForWriteTargetV1 } from '../context-gateway/skill-policy'
import {
  assembleContextGatewayPacketV1,
  contextGatewayInputStateSourceKeysV1,
  projectContextGatewayInputStateV1,
} from './context-gateway-input'
import { parseStructuredOutputV1 } from './structured-output-pipeline'
import {
  renderFrozenPromptExecutionV1,
  type PromptExecutionEvidenceV1,
  type PromptExecutionOptionsV1,
} from './prompt-execution'

export const STORY_CORE_FIELDS = STORY_CORE_GENERATABLE_FIELD_SPECS.map(spec => spec.field)

export type StoryCoreField = StoryCoreGeneratableField
export type StoryCoreFieldOperationV1 = 'create' | FieldGenerationMode

export interface StoryCoreCopilotCandidate {
  field: StoryCoreField
  value: string
}

export interface StoryCoreCopilotSnapshot {
  id: number | null
  ragDocumentId: string | null
  updatedAt: number | null
  serialized: string
  values: Record<StoryCoreField, string>
}

export interface StoryCoreCopilotInput {
  projectId: number
  projectName: string
  scope?: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  supplementalContext: string
  inputGuidance: string
  targetField: StoryCoreField
  mode: StoryCoreFieldOperationV1
  assembled: AssembleContextResult
  snapshot: StoryCoreCopilotSnapshot
  config: AIConfig
  routingCategory: string
  generationOverrides?: { temperature?: number; maxTokens?: number }
  frozenPromptMessages?: ChatMessage[]
  promptExecutionEvidence?: PromptExecutionEvidenceV1
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
  promptExecutionEvidence?: PromptExecutionEvidenceV1
  contextGatewayExecution?: ContextGatewayExecutionV1
}

interface StoryCoreCopilotDependencies {
  runAI?: (messages: ChatMessage[]) => Promise<string>
  readCurrent?: () => Promise<StoryCoreCopilotSnapshot>
  adoptOutput?: (candidate: StoryCoreCopilotCandidate) => Promise<AdoptResult>
}

export const STORY_CORE_FIELD_CAPABILITIES = new Map(
  STORY_CORE_GENERATABLE_FIELD_SPECS.map(spec => [spec.field, spec.aiGeneration]),
) as ReadonlyMap<StoryCoreField, typeof STORY_CORE_GENERATABLE_FIELD_SPECS[number]['aiGeneration']>

export const STORY_CORE_FIELD_LABELS = Object.fromEntries(
  STORY_CORE_GENERATABLE_FIELD_SPECS.map(spec => [spec.field, spec.aiGeneration.label]),
) as Record<StoryCoreField, string>

const MODE_INSTRUCTIONS: Record<StoryCoreFieldOperationV1, string> = {
  create: '目标字段为空：创建可直接审阅的作者意图摘要，不得返回占位说明。',
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
    mainPlot: asText(row?.mainPlot),
    subPlots: asText(row?.subPlots),
  }
}

function snapshotOf(row: StoryCore | null): StoryCoreCopilotSnapshot {
  const values = valuesOf(row)
  return {
    id: row?.id ?? null,
    ragDocumentId: row?.ragDocumentId ?? null,
    updatedAt: row?.updatedAt ?? null,
    serialized: JSON.stringify({
      id: row?.id ?? null,
      ragDocumentId: row?.ragDocumentId ?? null,
      updatedAt: row?.updatedAt ?? null,
      values,
    }),
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

export function parseStoryCoreCandidateDraft(draft: string): StoryCoreCopilotCandidate {
  return parseStructuredOutputV1({
    raw: draft,
    contract: {
      version: 1,
      schemaId: 'story-core-candidate.v1',
      target: 'storyCores.field',
      root: 'object',
      maxChars: 35_000,
      allowedRootFields: ['field', 'value'],
      requiredRootFields: ['field', 'value'],
      unknownRootFieldMessage: '故事核心候选只能包含 field 和 value。',
      missingRootFieldMessage: '故事核心候选只能包含 field 和 value。',
    },
    parse: value => {
      const source = value as Record<string, unknown>
      if (!STORY_CORE_FIELDS.includes(source.field as StoryCoreField)) {
        throw new Error('故事核心候选 field 不在允许范围。')
      }
      const field = source.field as StoryCoreField
      if (typeof source.value !== 'string' || source.value.trim().length < 2) {
        throw new Error(`故事核心候选 ${field}.value 至少需要 2 个字符。`)
      }
      const fieldValue = source.value.trim()
      const capability = STORY_CORE_FIELD_CAPABILITIES.get(field)!
      if (fieldValue.length > capability.maxChars) {
        throw new Error(`故事核心候选 ${field}.value 超过 ${capability.maxChars} 字符。`)
      }
      return { field, value: fieldValue }
    },
  })
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

function storyCoreHardSystem(input: StoryCoreCopilotInput): string {
  return `你是 StoryForge 世界基座 Agent，当前执行 story-core Skill。你只为作者生成一个故事核心字段的可确认候选。

硬性要求：
1. 本轮目标字段是 ${input.targetField}（${STORY_CORE_FIELD_LABELS[input.targetField]}），只允许生成这个字段。
2. ${MODE_INSTRUCTIONS[input.mode]}
3. 正式上下文是约束；缺失内容可以为本字段做最小候选补全，但不得声称它已成为 Canon。
4. 角色、故事线和既有大纲属于下游证据：上游缺失时可以据此反推当前目标字段，上游已有内容时用于核对兼容；不得借反推偷偷覆盖其他故事核心字段。
5. storyCore.mainPlot/subPlots 是作者意图摘要，不是可执行 StoryArc；不得在本轮自动创建、改写或废弃故事线。
6. 当前字段的直接依赖为 ${STORY_CORE_FIELD_CAPABILITIES.get(input.targetField)!.directDependencies.join('、') || '无'}；缺失依赖不允许顺写其它字段。
7. 只输出严格 JSON 对象，不输出 Markdown、解释或额外字段：
{"field":"${input.targetField}","value":"候选正文"}`
}

function buildStoryCoreMessages(input: StoryCoreCopilotInput): ChatMessage[] {
  if (input.frozenPromptMessages) return input.frozenPromptMessages.map(message => ({ ...message }))
  const supplemental = input.supplementalContext.trim()
    ? `\n\n【本轮已验证上游候选（尚未采纳，不属于 Canon）】\n${input.supplementalContext.trim()}`
    : ''
  return [{
    role: 'system',
    content: storyCoreHardSystem(input),
  }, {
    role: 'user',
    content: [
      input.inputGuidance,
      `【作者要求】\n${input.authorRequest}${supplemental}`,
      `【低权重灵感：作品名】\n${input.projectName}`,
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
    promptExecution?: PromptExecutionOptionsV1
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
  const scope = readScope
  const work = await db.works.get(scope.workId)
  if (!work || work.projectId !== input.projectId) throw new Error('当前作品不存在。')
  const before = await readSnapshot(input.projectId, scope)
  const targetField = resolveStoryCoreFieldV1(request)
  const capability = STORY_CORE_FIELD_CAPABILITIES.get(targetField)
  if (!capability) throw new Error(`故事核心字段 ${targetField} 缺少可生成能力声明。`)
  const requestedMode = resolveStoryCoreModeV1(request)
  if (!capability.modes.includes(requestedMode)) {
    throw new Error(`故事核心字段 ${targetField} 不支持 ${requestedMode} 模式。`)
  }
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
  const gatewayRequired = isContextGatewayRequiredForWriteTargetV1(skill, `storyCores.${targetField}`)
  if (gatewayRequired && !scope) {
    throw new Error('故事核心 Gateway required 字段需要完整的当前 WorkspaceScope。')
  }
  const targetResourceKey = before.values[targetField].trim() && before.ragDocumentId
    ? `story-core-field:${before.ragDocumentId}:field:${targetField}`
    : undefined
  const contextGatewayExecution = gatewayRequired
    ? await executeContextGatewayV1({
        skill,
        scope: scope!,
        worldGroupId,
        budgetTokens: Math.min(contextPolicy.maxInputTokens, skill.contextGateway!.maxRetrievedTokens),
        query: `${STORY_CORE_FIELD_LABELS[targetField]} ${requestedMode}；检查已有世界观、角色、故事线和大纲作为兼容或反推证据。\n${request}`,
        ...(targetResourceKey ? {
          mandatoryResourceKeys: [targetResourceKey],
          mandatoryOriginalResourceKeys: [targetResourceKey],
          targetResourceKeys: [targetResourceKey],
        } : {}),
        additionalReadsEnabled: false,
        signal: input.signal,
      })
    : undefined
  const assembled = contextGatewayExecution
    ? assembleContextGatewayPacketV1(contextGatewayExecution, contextPolicy.maxInputTokens)
    : await assembleContext({
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
  const inputState = contextGatewayExecution
    ? projectContextGatewayInputStateV1(skill, contextGatewayExecution, assembled)
    : resolveAgentSkillInputStateV1(skill, [assembled])
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  if (contextGatewayExecution) {
    contextEvidence.inputStateSourceKeys = contextGatewayInputStateSourceKeysV1(skill, contextGatewayExecution)
  }
  const nodeInput: StoryCoreCopilotInput = {
    projectId: input.projectId,
    projectName: work.title,
    scope,
    worldGroupId,
    authorRequest: request,
    supplementalContext: input.supplementalContext ?? '',
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    targetField,
    mode: snapshot.values[targetField].trim() ? requestedMode : 'create',
    assembled,
    snapshot,
    config,
    routingCategory,
    generationOverrides: input.generationOverrides,
    signal: input.signal,
  }
  if (input.promptExecution) {
    const rendered = await renderFrozenPromptExecutionV1({
      options: input.promptExecution,
      context: {
        projectName: work.title,
        genres: work.genres.join('/'),
        dimension: STORY_CORE_FIELD_LABELS[targetField],
        worldContext: assembled.text || '（当前没有已填写的正式设定）',
        storyCore: assembled.text || '',
        currentValue: snapshot.values[targetField],
        generationMode: nodeInput.mode,
        userHint: '',
      },
      hardSystem: storyCoreHardSystem(nodeInput),
      authorInstruction: request,
      additionalUserMessages: [
        nodeInput.inputGuidance,
        ...(nodeInput.supplementalContext.trim()
          ? [`【本轮已验证上游候选（尚未采纳，不属于 Canon）】\n${nodeInput.supplementalContext.trim()}`]
          : []),
        `【Harness 登记的正式上下文】\n${assembled.text || '（当前没有已填写的正式设定）'}`,
      ],
    })
    const generationOverrides = {
      maxTokens: 6_000,
      temperature: 0.5,
      ...rendered.generationOverrides,
      ...input.generationOverrides,
    }
    if ((generationOverrides.maxTokens ?? 0) > skill.maxOutputTokens) {
      throw new Error(`Prompt 请求输出 ${generationOverrides.maxTokens} tokens，超过 Skill 上限 ${skill.maxOutputTokens}；已在模型调用前阻止。`)
    }
    nodeInput.frozenPromptMessages = rendered.messages
    nodeInput.promptExecutionEvidence = {
      ...rendered.evidence,
      effectiveTemperature: generationOverrides.temperature ?? null,
      effectiveMaxTokens: generationOverrides.maxTokens ?? null,
    }
    nodeInput.generationOverrides = generationOverrides
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
    label: STORY_CORE_FIELD_LABELS[targetField],
    modelIdentity: { provider: config.provider, model: config.model },
    promptExecutionEvidence: nodeInput.promptExecutionEvidence,
    contextGatewayExecution,
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
  const hint = (input.hint ?? '').trim()
  if (hint) parts.push(`作者要求：${hint}`)
  const request = parts.join('\n')
  if (request.length > 8_000) {
    throw new Error('故事核心作者要求超过 8000 字符；没有截断，已在模型调用前阻止。')
  }
  return request
}
