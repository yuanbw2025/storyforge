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
import type { AIConfig, ChatMessage, DivineDesign, Worldview } from '../types'
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

export const WORLDVIEW_AGENT_FIELDS = [
  'worldOrigin',
  'powerHierarchy',
  'divineDesign',
  'worldStructure',
  'worldDimensions',
  'continentLayout',
  'mountainsRivers',
  'climateByRegion',
  'naturalResourceOverview',
  'races',
  'factionLayout',
  'regionDimensions',
  'politicsOverview',
  'economyOverview',
  'cultureOverview',
  'internalConflicts',
  'itemDesign',
] as const

export type WorldviewAgentField = typeof WORLDVIEW_AGENT_FIELDS[number]
export type WorldviewTextAgentField = Exclude<WorldviewAgentField, 'divineDesign'>
export type WorldviewFoundationState = 'empty' | 'partial' | 'complete'

export type WorldviewFieldCopilotCandidate =
  | { field: WorldviewTextAgentField; value: string }
  | { field: 'divineDesign'; value: DivineDesign }

type WorldviewFieldValue = string | DivineDesign

export interface WorldviewFieldCopilotSnapshot {
  id: number | null
  updatedAt: number | null
  serialized: string
  values: Record<WorldviewAgentField, WorldviewFieldValue>
  foundationState: WorldviewFoundationState
}

export interface WorldviewFieldCopilotInput {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  supplementalContext: string
  inputGuidance: string
  targetField: WorldviewAgentField
  mode: FieldGenerationMode
  assembled: AssembleContextResult
  snapshot: WorldviewFieldCopilotSnapshot
  config: AIConfig
  routingCategory: string
  generationOverrides?: { temperature?: number; maxTokens?: number }
  signal?: AbortSignal
}

export interface PreparedWorldviewFieldCopilot {
  node: GenerationNode<WorldviewFieldCopilotInput, WorldviewFieldCopilotCandidate, AdoptResult>
  prepared: PreparedGenerationNode
  input: WorldviewFieldCopilotInput
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  snapshot: WorldviewFieldCopilotSnapshot
  targetField: WorldviewAgentField
  label: string
  modelIdentity: MasterCandidateModelIdentityV1
}

interface WorldviewFieldCopilotDependencies {
  runAI?: (messages: ChatMessage[]) => Promise<string>
  readCurrent?: () => Promise<WorldviewFieldCopilotSnapshot>
  adoptOutput?: (candidate: WorldviewFieldCopilotCandidate) => Promise<AdoptResult>
}

const EMPTY_DIVINE_DESIGN: DivineDesign = {
  hasDivinity: false,
  divineRank: '',
  divineNames: '',
  divineRules: '',
}

export const WORLDVIEW_AGENT_FIELD_LABELS: Record<WorldviewAgentField, string> = {
  worldOrigin: '世界来源',
  powerHierarchy: '力量体系',
  divineDesign: '神明与信仰',
  worldStructure: '世界结构',
  worldDimensions: '疆域尺寸',
  continentLayout: '地貌分布',
  mountainsRivers: '山川水系',
  climateByRegion: '气候环境',
  naturalResourceOverview: '自然资源',
  races: '种族与民族',
  factionLayout: '势力分布',
  regionDimensions: '城池重镇',
  politicsOverview: '政治制度',
  economyOverview: '经济制度',
  cultureOverview: '文化制度',
  internalConflicts: '矛盾冲突',
  itemDesign: '道具与器物',
}

const FIELD_MAX_CHARS: Record<WorldviewTextAgentField, number> = {
  worldOrigin: 12_000,
  powerHierarchy: 30_000,
  worldStructure: 20_000,
  worldDimensions: 12_000,
  continentLayout: 30_000,
  mountainsRivers: 30_000,
  climateByRegion: 30_000,
  naturalResourceOverview: 30_000,
  races: 30_000,
  factionLayout: 30_000,
  regionDimensions: 30_000,
  politicsOverview: 30_000,
  economyOverview: 30_000,
  cultureOverview: 30_000,
  internalConflicts: 30_000,
  itemDesign: 30_000,
}

const MODE_INSTRUCTIONS: Record<FieldGenerationMode, string> = {
  expand: '保留目标字段当前已有事实和方向，在其基础上补足因果、约束与具体性。',
  rewrite: '允许重写目标字段，但必须遵守其他已确认字段和正式上下文，不得顺手改写它们。',
  polish: '只优化目标字段的表达、逻辑顺序和可读性，除非作者明确要求，不新增重大设定。',
}

const FOUNDATION_STATE_INSTRUCTIONS: Record<WorldviewFoundationState, string> = {
  empty: '世界基座字段均为空。只依据作者要求创建目标字段；若有下游内容，只把它当作反推证据，不得冒充已确认的上游设定。',
  partial: '世界基座只填写了一部分。锁定所有已填字段，只补充当前目标字段；可以利用故事核心、角色、故事线和大纲反推缺失联系。',
  complete: '世界基座字段已经完整。目标字段的生成必须严格服从其他已确认字段，只允许执行作者指定的扩写、重写或润色。',
}

export class WorldviewFieldCopilotStaleError extends Error {
  constructor() {
    super('世界基座已在候选生成后发生变化。为避免覆盖作者的新修改，请重新生成候选。')
    this.name = 'WorldviewFieldCopilotStaleError'
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeDivineDesign(value: unknown): DivineDesign {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_DIVINE_DESIGN }
  const source = value as Partial<DivineDesign>
  return {
    hasDivinity: source.hasDivinity === true,
    divineRank: text(source.divineRank),
    divineNames: text(source.divineNames),
    divineRules: text(source.divineRules),
  }
}

function valuesOf(row: Worldview | null): Record<WorldviewAgentField, WorldviewFieldValue> {
  return {
    worldOrigin: text(row?.worldOrigin),
    powerHierarchy: text(row?.powerHierarchy),
    divineDesign: normalizeDivineDesign(row?.divineDesign),
    worldStructure: text(row?.worldStructure),
    worldDimensions: text(row?.worldDimensions),
    continentLayout: text(row?.continentLayout),
    mountainsRivers: text(row?.mountainsRivers),
    climateByRegion: text(row?.climateByRegion),
    naturalResourceOverview: text(row?.naturalResourceOverview),
    races: text(row?.races),
    factionLayout: text(row?.factionLayout),
    regionDimensions: text(row?.regionDimensions),
    politicsOverview: text(row?.politicsOverview),
    economyOverview: text(row?.economyOverview),
    cultureOverview: text(row?.cultureOverview),
    internalConflicts: text(row?.internalConflicts),
    itemDesign: text(row?.itemDesign),
  }
}

function hasMaterial(value: WorldviewFieldValue): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  return value.hasDivinity
    || Boolean(value.divineRank.trim() || value.divineNames.trim() || value.divineRules.trim())
}

function foundationStateOf(values: Record<WorldviewAgentField, WorldviewFieldValue>): WorldviewFoundationState {
  const populated = WORLDVIEW_AGENT_FIELDS.filter(field => hasMaterial(values[field])).length
  return populated === 0 ? 'empty' : populated === WORLDVIEW_AGENT_FIELDS.length ? 'complete' : 'partial'
}

function snapshotOf(row: Worldview | null): WorldviewFieldCopilotSnapshot {
  const values = valuesOf(row)
  const body = {
    id: row?.id ?? null,
    updatedAt: row?.updatedAt ?? null,
    values,
  }
  return {
    ...body,
    serialized: JSON.stringify(body),
    foundationState: foundationStateOf(values),
  }
}

async function readSnapshot(
  projectId: number,
  worldGroupId: number | null,
  scope?: WorkspaceScope,
): Promise<WorldviewFieldCopilotSnapshot> {
  const resolved = scope ?? await resolveReadScopeLike(projectId)
  const rows = await readOwnedRows<Worldview>(resolved, 'worldviews', { owner: 'world' })
  const row = worldGroupId == null
    ? (rows.find(item => (item.worldGroupId ?? null) === null) ?? rows[0] ?? null)
    : (rows.find(item => item.worldGroupId === worldGroupId) ?? null)
  return snapshotOf(row)
}

function assertAuthorRequest(value: string): string {
  const request = value.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的世界基座要求。')
  if (request.length > 1_000) throw new Error('单次世界基座要求不能超过 1000 个字符。')
  return request
}

export function resolveWorldviewAgentFieldV1(request: string): WorldviewAgentField {
  const explicit = /目标字段\s*=\s*([A-Za-z][A-Za-z0-9]*)\b/.exec(request)?.[1]
  if (explicit && WORLDVIEW_AGENT_FIELDS.includes(explicit as WorldviewAgentField)) {
    return explicit as WorldviewAgentField
  }
  const aliases: Array<[WorldviewAgentField, RegExp]> = [
    ['divineDesign', /神明|信仰|宗教/],
    ['powerHierarchy', /力量体系|能力体系|修炼体系/],
    ['worldStructure', /世界结构|空间层级|位面结构/],
    ['worldDimensions', /疆域尺寸|世界尺寸|疆域范围/],
    ['continentLayout', /地貌分布|大陆分布|地形格局/],
    ['mountainsRivers', /山川水系|山脉|河流|水系/],
    ['climateByRegion', /气候环境|季节|自然灾害/],
    ['naturalResourceOverview', /自然资源|物产分布/],
    ['races', /种族与民族|种族|民族/],
    ['factionLayout', /势力分布|势力格局|阵营格局/],
    ['regionDimensions', /城池重镇|核心城市|行政区域/],
    ['politicsOverview', /政治制度|政体|官制/],
    ['economyOverview', /经济制度|货币|税赋|贸易/],
    ['cultureOverview', /文化制度|文化习俗|语言教育/],
    ['internalConflicts', /矛盾冲突|社会矛盾|阶级冲突/],
    ['itemDesign', /道具与器物|物品体系|器物体系/],
    ['worldOrigin', /世界来源|世界起源|创世起源|时代背景|世界观|背景设定/],
  ]
  return aliases.find(([, pattern]) => pattern.test(request))?.[0] ?? 'worldOrigin'
}

export function resolveWorldviewFieldModeV1(request: string): FieldGenerationMode {
  const explicit = /生成模式\s*=\s*(expand|rewrite|polish)\b/i.exec(request)?.[1]?.toLowerCase()
  if (explicit === 'rewrite' || explicit === 'polish' || explicit === 'expand') return explicit
  if (/重写|重做|推倒重来/.test(request)) return 'rewrite'
  if (/润色|优化表达/.test(request)) return 'polish'
  return 'expand'
}

function parseJsonObject(draft: string): Record<string, unknown> {
  const input = draft.trim()
  if (!input) throw new Error('世界基座候选为空。')
  if (input.length > 40_000) throw new Error('世界基座候选超过 40000 字符。')
  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(input)
  let parsed: unknown
  try {
    parsed = JSON.parse(fenced?.[1]?.trim() ?? input)
  } catch {
    throw new Error('世界基座候选不是有效的严格 JSON 对象。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('世界基座候选必须是 JSON 对象。')
  }
  return parsed as Record<string, unknown>
}

function exactKeys(source: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(source).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}只能包含 ${wanted.join('、')}。`)
  }
}

export function parseWorldviewFieldCandidateDraft(draft: string): WorldviewFieldCopilotCandidate {
  const source = parseJsonObject(draft)
  exactKeys(source, ['field', 'value'], '世界基座候选')
  if (!WORLDVIEW_AGENT_FIELDS.includes(source.field as WorldviewAgentField)) {
    throw new Error('世界基座候选 field 不在允许范围。')
  }
  const field = source.field as WorldviewAgentField
  if (field === 'divineDesign') {
    if (!source.value || typeof source.value !== 'object' || Array.isArray(source.value)) {
      throw new Error('神明与信仰候选 value 必须是对象。')
    }
    const value = source.value as Record<string, unknown>
    exactKeys(value, ['hasDivinity', 'divineRank', 'divineNames', 'divineRules'], '神明与信仰候选 value')
    if (typeof value.hasDivinity !== 'boolean') throw new Error('神明与信仰 hasDivinity 必须是布尔值。')
    const divineRank = value.divineRank
    const divineNames = value.divineNames
    const divineRules = value.divineRules
    for (const [key, candidate] of Object.entries({ divineRank, divineNames, divineRules })) {
      if (typeof candidate !== 'string' || candidate.length > 20_000) {
        throw new Error(`神明与信仰 ${key} 必须是 0-20000 字符的文本。`)
      }
    }
    if (typeof divineRank !== 'string' || typeof divineNames !== 'string' || typeof divineRules !== 'string') {
      throw new Error('神明与信仰文本字段无效。')
    }
    return {
      field,
      value: {
        hasDivinity: value.hasDivinity,
        divineRank: divineRank.trim(),
        divineNames: divineNames.trim(),
        divineRules: divineRules.trim(),
      },
    }
  }
  if (typeof source.value !== 'string' || source.value.trim().length < 2) {
    throw new Error(`世界基座候选 ${field}.value 至少需要 2 个字符。`)
  }
  const value = source.value.trim()
  if (value.length > FIELD_MAX_CHARS[field]) {
    throw new Error(`世界基座候选 ${field}.value 超过 ${FIELD_MAX_CHARS[field]} 字符。`)
  }
  return { field, value }
}

function sameValue(left: WorldviewFieldValue, right: WorldviewFieldValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function candidateIssues(
  candidate: WorldviewFieldCopilotCandidate,
  input: Pick<WorldviewFieldCopilotInput, 'targetField' | 'snapshot'>,
): GenerationGateIssue[] {
  let parsed: WorldviewFieldCopilotCandidate
  try {
    parsed = parseWorldviewFieldCandidateDraft(JSON.stringify(candidate))
  } catch (error) {
    return [{
      code: 'worldview-field-invalid-structure',
      message: error instanceof Error ? error.message : '世界基座候选结构无效。',
    }]
  }
  const issues: GenerationGateIssue[] = []
  if (parsed.field !== input.targetField) {
    issues.push({
      code: 'worldview-field-mismatch',
      message: `本轮只允许修改 ${input.targetField}，候选却请求修改 ${parsed.field}。`,
    })
  }
  if (parsed.field === input.targetField && sameValue(parsed.value, input.snapshot.values[input.targetField])) {
    issues.push({ code: 'worldview-field-unchanged', message: '候选与目标字段当前内容完全相同。' })
  }
  return issues
}

function outputContract(field: WorldviewAgentField): string {
  return field === 'divineDesign'
    ? '{"field":"divineDesign","value":{"hasDivinity":true,"divineRank":"信仰层级","divineNames":"名号与职司","divineRules":"规则、仪式与禁忌"}}'
    : `{"field":"${field}","value":"候选正文"}`
}

function buildWorldviewFieldMessages(input: WorldviewFieldCopilotInput): ChatMessage[] {
  const supplemental = input.supplementalContext.trim()
    ? `\n\n【本轮已验证上游候选（尚未采纳，不属于 Canon）】\n${input.supplementalContext.trim()}`
    : ''
  return [{
    role: 'system',
    content: `你是 StoryForge 世界基座 Agent，当前执行 worldview-field Skill。你只为作者生成一个世界基座字段的可确认候选。

硬性要求：
1. 本轮目标字段是 ${input.targetField}（${WORLDVIEW_AGENT_FIELD_LABELS[input.targetField]}），只允许生成这个字段。
2. ${MODE_INSTRUCTIONS[input.mode]}
3. ${FOUNDATION_STATE_INSTRUCTIONS[input.snapshot.foundationState]}
4. 世界观、规则、事实、故事核心和其他已确认内容属于正式约束；角色、故事线和大纲属于下游证据，只能在上游缺失时用于反推，不能覆盖已确认的上游设定。
5. 不得输出对其他字段的顺带修改，也不得把推断冒充已经写入的数据。
6. 只输出严格 JSON 对象，不输出 Markdown、解释或额外字段：
${outputContract(input.targetField)}`,
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
  worldGroupId: number | null
  snapshot: WorldviewFieldCopilotSnapshot
  targetField: WorldviewAgentField
  candidate: WorldviewFieldCopilotCandidate
}): Promise<AdoptResult> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  return db.transaction(
    'rw',
    scopeTransactionTables(db.worldviews, db.temporalFacts),
    async () => {
      const current = await readSnapshot(input.projectId, input.worldGroupId, scope)
      if (current.serialized !== input.snapshot.serialized) throw new WorldviewFieldCopilotStaleError()
      const issues = candidateIssues(input.candidate, {
        targetField: input.targetField,
        snapshot: current,
      })
      if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
      const result = await adopt({
        projectId: input.projectId,
        scope,
        worldGroupId: input.worldGroupId,
        target: 'worldviews',
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
      ) throw new Error('世界基座候选没有完整通过字段注册表校验，已回滚。')
      return result
    },
  )
}

export async function adoptRestoredWorldviewFieldCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  snapshot: WorldviewFieldCopilotSnapshot
  targetField: WorldviewAgentField
  draft: string
}): Promise<AdoptResult> {
  return adoptCandidate({
    ...input,
    candidate: parseWorldviewFieldCandidateDraft(input.draft),
  })
}

export function worldviewFieldCandidateMatchesRowV1(
  candidate: WorldviewFieldCopilotCandidate,
  row: Worldview | null | undefined,
): boolean {
  return sameValue(valuesOf(row ?? null)[candidate.field], candidate.value)
}

export async function prepareWorldviewFieldCopilot(
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
  dependencies: WorldviewFieldCopilotDependencies = {},
): Promise<PreparedWorldviewFieldCopilot> {
  const request = assertAuthorRequest(input.authorRequest)
  const skill = resolveAgentSkillV1('world-origin', input.skillId ?? 'world-origin.worldview-field')
  if (skill.executionMode !== 'worldview-field') {
    throw new Error('世界基座字段 Copilot 只接受 world-origin.worldview-field Skill。')
  }
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) {
    throw new Error('多世界项目必须先选择一个世界，才能生成世界基座。')
  }
  const worldGroupId = project.enableMultiWorld ? input.worldGroupId : null
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const scope = isLegacyReadScope(readScope) ? undefined : readScope
  const before = await readSnapshot(input.projectId, worldGroupId, scope)
  const routingCategory = input.routingCategory ?? 'agent.world-foundation.worldview-field'
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
  const snapshot = await readSnapshot(input.projectId, worldGroupId, scope)
  if (before.serialized !== snapshot.serialized) throw new WorldviewFieldCopilotStaleError()
  const inputState = resolveAgentSkillInputStateV1(skill, [assembled])
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  const targetField = resolveWorldviewAgentFieldV1(request)
  const nodeInput: WorldviewFieldCopilotInput = {
    projectId: input.projectId,
    scope,
    worldGroupId,
    authorRequest: request,
    supplementalContext: input.supplementalContext ?? '',
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    targetField,
    mode: resolveWorldviewFieldModeV1(request),
    assembled,
    snapshot,
    config,
    routingCategory,
    generationOverrides: input.generationOverrides,
    signal: input.signal,
  }
  const node = createWorldviewFieldCopilotNode(nodeInput, dependencies)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    contextSources: assembled.included,
    contextEvidence,
    snapshot,
    targetField,
    label: WORLDVIEW_AGENT_FIELD_LABELS[targetField],
    modelIdentity: { provider: config.provider, model: config.model },
  }
}

export function createWorldviewFieldCopilotNode(
  input: WorldviewFieldCopilotInput,
  dependencies: WorldviewFieldCopilotDependencies = {},
): PreparedWorldviewFieldCopilot['node'] {
  const readCurrent = dependencies.readCurrent
    ?? (() => readSnapshot(input.projectId, input.worldGroupId, input.scope))
  const adoptOutput = dependencies.adoptOutput ?? (candidate => adoptCandidate({
    projectId: input.projectId,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
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
    id: `agent.world-foundation.worldview-field:${input.projectId}:${input.targetField}:${input.snapshot.updatedAt ?? 0}`,
    kind: 'world-foundation.worldview-field',
    editableInput: true,
    assembleInput: buildWorldviewFieldMessages,
    run: async messages => parseWorldviewFieldCandidateDraft(await runAI(messages)),
    gate: output => {
      const issues = candidateIssues(output, input)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      const current = await readCurrent()
      if (current.serialized !== input.snapshot.serialized) throw new WorldviewFieldCopilotStaleError()
      const candidate = parseWorldviewFieldCandidateDraft(JSON.stringify(output))
      const issues = candidateIssues(candidate, input)
      if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
      return adoptOutput(candidate)
    },
  }
}

function compactText(value: string | null | undefined, max: number): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

export function formatWorldviewFieldGenerationRequestV1(input: {
  field: WorldviewAgentField
  mode: FieldGenerationMode
  hint?: string
  parameterValues?: Record<string, unknown>
  systemOverride?: string | null
  userOverride?: string | null
}): string {
  const parts = [
    `生成世界基座字段。目标字段=${input.field}；生成模式=${input.mode}。`,
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
