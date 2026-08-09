import { useAIConfigStore } from '../../stores/ai-config'
import { usePromptStore } from '../../stores/prompt'
import { appendSimplifiedChineseOutputConstraint, appendUserConstraint } from '../ai/adapters/prompt-guards'
import { chat, resolveRequestConfig } from '../ai/client'
import { renderPrompt } from '../ai/prompt-engine'
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
import type { AIConfig, ChatMessage, CreativeRules, WorkspaceScope } from '../types'
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

export const CREATIVE_RULES_FIELDS = [
  'writingStyle',
  'atmosphere',
  'specialRequirements',
] as const

export type CreativeRulesField = typeof CREATIVE_RULES_FIELDS[number]

export interface CreativeRulesCopilotCandidateV1 {
  field: CreativeRulesField
  value: string
}

export interface CreativeRulesCopilotSnapshotV1 {
  id: number | null
  updatedAt: number | null
  serialized: string
  values: Record<CreativeRulesField, string>
}

interface CreativeRulesCopilotInputV1 {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  supplementalContext: string
  inputGuidance: string
  targetField: CreativeRulesField
  assembled: AssembleContextResult
  snapshot: CreativeRulesCopilotSnapshotV1
  projectName: string
  genres: string
  config: AIConfig
  routingCategory: string
  generationOverrides?: { temperature?: number; maxTokens?: number }
  signal?: AbortSignal
}

export interface PreparedCreativeRulesCopilotV1 {
  node: GenerationNode<CreativeRulesCopilotInputV1, CreativeRulesCopilotCandidateV1, AdoptResult>
  prepared: PreparedGenerationNode
  input: CreativeRulesCopilotInputV1
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  snapshot: CreativeRulesCopilotSnapshotV1
  targetField: CreativeRulesField
  label: string
  modelIdentity: MasterCandidateModelIdentityV1
}

interface CreativeRulesCopilotDependenciesV1 {
  runAI?: (messages: ChatMessage[]) => Promise<string>
  readCurrent?: () => Promise<CreativeRulesCopilotSnapshotV1>
  adoptOutput?: (candidate: CreativeRulesCopilotCandidateV1) => Promise<AdoptResult>
}

const FIELD_LABELS: Record<CreativeRulesField, string> = {
  writingStyle: '写作风格',
  atmosphere: '基调和氛围',
  specialRequirements: '特殊创作要求',
}

const FIELD_MAX_CHARS: Record<CreativeRulesField, number> = {
  writingStyle: 12_000,
  atmosphere: 8_000,
  specialRequirements: 20_000,
}

export class CreativeRulesCopilotStaleError extends Error {
  constructor() {
    super('创作规则已在候选生成后发生变化。为避免覆盖作者的新修改，请重新生成候选。')
    this.name = 'CreativeRulesCopilotStaleError'
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function valuesOf(row: CreativeRules | null): Record<CreativeRulesField, string> {
  return {
    writingStyle: asText(row?.writingStyle),
    atmosphere: asText(row?.atmosphere) || asText(row?.toneAndMood),
    specialRequirements: asText(row?.specialRequirements),
  }
}

function snapshotOf(row: CreativeRules | null): CreativeRulesCopilotSnapshotV1 {
  const values = valuesOf(row)
  return {
    id: row?.id ?? null,
    updatedAt: row?.updatedAt ?? null,
    serialized: JSON.stringify({
      id: row?.id ?? null,
      updatedAt: row?.updatedAt ?? null,
      values,
      narrativePOV: asText(row?.narrativePOV),
      toneAndMood: asText(row?.toneAndMood),
      prohibitions: asText(row?.prohibitions),
      consistencyRules: asText(row?.consistencyRules),
      referenceWorks: asText(row?.referenceWorks),
      referenceWorksV2: row?.referenceWorksV2 ?? null,
      citedReferenceIds: asText(row?.citedReferenceIds),
      citedInsightIds: asText(row?.citedInsightIds),
    }),
    values,
  }
}

async function readSnapshot(
  projectId: number,
  scope?: WorkspaceScope,
): Promise<CreativeRulesCopilotSnapshotV1> {
  const resolved = scope ?? await resolveReadScopeLike(projectId)
  const row = (await readOwnedRows<CreativeRules>(resolved, 'creativeRules', { owner: 'work' }))[0] ?? null
  return snapshotOf(row)
}

function assertAuthorRequest(value: string): string {
  const request = value.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的创作规则要求。')
  if (request.length > 1_000) throw new Error('单次创作规则要求不能超过 1000 个字符。')
  return request
}

export function resolveCreativeRulesFieldV1(request: string): CreativeRulesField {
  const explicit = /目标字段\s*=\s*(writingStyle|atmosphere|specialRequirements)\b/i.exec(request)?.[1]
  if (explicit) {
    return CREATIVE_RULES_FIELDS.find(field => field.toLowerCase() === explicit.toLowerCase())!
  }
  const aliases: Array<[CreativeRulesField, RegExp]> = [
    ['writingStyle', /写作风格|文风/],
    ['atmosphere', /基调(?:和|与)?氛围|基调|氛围/],
    ['specialRequirements', /特殊创作要求|特殊要求/],
  ]
  const matched = aliases.find(([, pattern]) => pattern.test(request))?.[0]
  if (!matched) throw new Error('创作规则任务缺少明确的目标字段。')
  return matched
}

function parseJsonObject(draft: string): Record<string, unknown> {
  const input = draft.trim()
  if (!input) throw new Error('创作规则候选为空。')
  if (input.length > 25_000) throw new Error('创作规则候选超过 25000 字符。')
  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(input)
  let parsed: unknown
  try {
    parsed = JSON.parse(fenced?.[1]?.trim() ?? input)
  } catch {
    throw new Error('创作规则候选不是有效的严格 JSON 对象。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('创作规则候选必须是 JSON 对象。')
  }
  return parsed as Record<string, unknown>
}

export function parseCreativeRulesCandidateDraftV1(
  draft: string,
): CreativeRulesCopilotCandidateV1 {
  const source = parseJsonObject(draft)
  const keys = Object.keys(source).sort()
  if (keys.length !== 2 || keys[0] !== 'field' || keys[1] !== 'value') {
    throw new Error('创作规则候选只能包含 field 和 value。')
  }
  if (!CREATIVE_RULES_FIELDS.includes(source.field as CreativeRulesField)) {
    throw new Error('创作规则候选 field 不在允许范围。')
  }
  const field = source.field as CreativeRulesField
  if (typeof source.value !== 'string' || source.value.trim().length < 2) {
    throw new Error(`创作规则候选 ${field}.value 至少需要 2 个字符。`)
  }
  const value = source.value.trim()
  if (value.length > FIELD_MAX_CHARS[field]) {
    throw new Error(`创作规则候选 ${field}.value 超过 ${FIELD_MAX_CHARS[field]} 字符。`)
  }
  return { field, value }
}

function candidateIssues(
  candidate: CreativeRulesCopilotCandidateV1,
  input: Pick<CreativeRulesCopilotInputV1, 'targetField' | 'snapshot'>,
): GenerationGateIssue[] {
  let parsed: CreativeRulesCopilotCandidateV1
  try {
    parsed = parseCreativeRulesCandidateDraftV1(JSON.stringify(candidate))
  } catch (error) {
    return [{
      code: 'creative-rules-invalid-structure',
      message: error instanceof Error ? error.message : '创作规则候选结构无效。',
    }]
  }
  const issues: GenerationGateIssue[] = []
  if (parsed.field !== input.targetField) {
    issues.push({
      code: 'creative-rules-field-mismatch',
      message: `本轮只允许修改 ${input.targetField}，候选却请求修改 ${parsed.field}。`,
    })
  }
  if (parsed.value === input.snapshot.values[input.targetField].trim()) {
    issues.push({ code: 'creative-rules-unchanged', message: '候选与目标字段当前内容完全相同。' })
  }
  return issues
}

function buildMessages(input: CreativeRulesCopilotInputV1): ChatMessage[] {
  const template = usePromptStore.getState().getActive('rules.generate')
  const rendered = renderPrompt(template, {
    projectName: input.projectName,
    genres: input.genres,
    dimension: FIELD_LABELS[input.targetField],
    worldContext: '',
    storyCore: '',
    userHint: '',
  }).messages
  const supplemental = input.supplementalContext.trim()
    ? `\n\n【本轮已验证上游候选（尚未采纳，不属于 Canon）】\n${input.supplementalContext.trim()}`
    : ''
  return appendSimplifiedChineseOutputConstraint(appendUserConstraint(rendered, [
    input.inputGuidance,
    `【作者要求】\n${input.authorRequest}${supplemental}`,
    `【正式上下文】\n${input.assembled.text || '（当前没有已填写的正式设定）'}`,
    '【创作规则候选硬约束】',
    `1. 本轮目标字段是 ${input.targetField}（${FIELD_LABELS[input.targetField]}），只允许建议这个字段。`,
    '2. 世界观、故事核心和其它已确认创作规则都是约束；缺失内容可以做最小建议，但不得声称已经成为 Canon。',
    '3. 建议必须具体、可执行，同时写清应做什么和应避免什么；不得顺手改写其它规则字段。',
    `4. 只输出严格 JSON 对象，不输出 Markdown 围栏、解释或额外字段：{"field":"${input.targetField}","value":"候选正文"}`,
  ].join('\n\n')))
}

async function adoptCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  snapshot: CreativeRulesCopilotSnapshotV1
  targetField: CreativeRulesField
  candidate: CreativeRulesCopilotCandidateV1
}): Promise<AdoptResult> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  return db.transaction(
    'rw',
    scopeTransactionTables(db.creativeRules, db.temporalFacts),
    async () => {
      const current = await readSnapshot(input.projectId, scope)
      if (current.serialized !== input.snapshot.serialized) throw new CreativeRulesCopilotStaleError()
      const issues = candidateIssues(input.candidate, {
        targetField: input.targetField,
        snapshot: current,
      })
      if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
      const result = await adopt({
        projectId: input.projectId,
        scope,
        target: 'creativeRules',
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
      ) throw new Error('创作规则候选没有完整通过字段注册表校验，已回滚。')
      return result
    },
  )
}

export async function adoptRestoredCreativeRulesCandidateV1(input: {
  projectId: number
  scope?: WorkspaceScope
  snapshot: CreativeRulesCopilotSnapshotV1
  targetField: CreativeRulesField
  draft: string
}): Promise<AdoptResult> {
  return adoptCandidate({
    ...input,
    candidate: parseCreativeRulesCandidateDraftV1(input.draft),
  })
}

export function creativeRulesCandidateMatchesRowV1(
  candidate: CreativeRulesCopilotCandidateV1,
  row: CreativeRules | null | undefined,
): boolean {
  return valuesOf(row ?? null)[candidate.field] === candidate.value
}

export async function prepareCreativeRulesCopilotV1(
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
  dependencies: CreativeRulesCopilotDependenciesV1 = {},
): Promise<PreparedCreativeRulesCopilotV1> {
  const request = assertAuthorRequest(input.authorRequest)
  const skill = resolveAgentSkillV1('world-origin', input.skillId ?? 'world-origin.creative-rules')
  if (skill.executionMode !== 'creative-rules') {
    throw new Error('创作规则 Copilot 只接受 world-origin.creative-rules Skill。')
  }
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) {
    throw new Error('多世界项目必须先选择一个世界，才能生成创作规则。')
  }
  const worldGroupId = project.enableMultiWorld ? input.worldGroupId : null
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const scope = isLegacyReadScope(readScope) ? undefined : readScope
  const before = await readSnapshot(input.projectId, scope)
  const routingCategory = input.routingCategory ?? 'agent.world-foundation.creative-rules'
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
  if (before.serialized !== snapshot.serialized) throw new CreativeRulesCopilotStaleError()
  const inputState = resolveAgentSkillInputStateV1(skill, [assembled])
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  const targetField = resolveCreativeRulesFieldV1(request)
  const nodeInput: CreativeRulesCopilotInputV1 = {
    projectId: input.projectId,
    scope,
    worldGroupId,
    authorRequest: request,
    supplementalContext: input.supplementalContext ?? '',
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    targetField,
    assembled,
    snapshot,
    projectName: project.name,
    genres: project.genres?.join('、') || project.genre || '',
    config,
    routingCategory,
    generationOverrides: input.generationOverrides,
    signal: input.signal,
  }
  const node = createCreativeRulesCopilotNodeV1(nodeInput, dependencies)
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

export function createCreativeRulesCopilotNodeV1(
  input: CreativeRulesCopilotInputV1,
  dependencies: CreativeRulesCopilotDependenciesV1 = {},
): PreparedCreativeRulesCopilotV1['node'] {
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
      maxTokens: input.generationOverrides?.maxTokens ?? 4_000,
      temperature: input.generationOverrides?.temperature ?? 0.45,
    },
    contextOverflowPolicy: 'reject',
  }, input.signal))
  return {
    id: `agent.world-foundation.creative-rules:${input.projectId}:${input.targetField}:${input.snapshot.updatedAt ?? 0}`,
    kind: 'world-foundation.creative-rules',
    editableInput: true,
    assembleInput: buildMessages,
    run: async messages => parseCreativeRulesCandidateDraftV1(await runAI(messages)),
    gate: output => {
      const issues = candidateIssues(output, input)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      const current = await readCurrent()
      if (current.serialized !== input.snapshot.serialized) throw new CreativeRulesCopilotStaleError()
      const candidate = parseCreativeRulesCandidateDraftV1(JSON.stringify(output))
      const issues = candidateIssues(candidate, input)
      if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
      return adoptOutput(candidate)
    },
  }
}

export function formatCreativeRulesGenerationRequestV1(input: {
  field: CreativeRulesField
}): string {
  return `生成创作规则字段。目标字段=${input.field}。`
}
