import { useAIConfigStore } from '../../stores/ai-config'
import { getModelPreset } from '../ai/context-budget'
import { chat, resolveRequestConfig, type ChatResult } from '../ai/client'
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
  WORLDVIEW_GENERATABLE_FIELD_SPECS,
  type WorldviewGeneratableField,
} from '../registry/field-registry'
import type { AdoptResult, AssembleContextResult } from '../registry/types'
import type { AIConfig, ChatMessage, DivineDesign, NaturalResources, Worldview } from '../types'
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
import { parseStructuredOutputV1 } from './structured-output-pipeline'
import {
  renderFrozenPromptExecutionV1,
  type PromptExecutionEvidenceV1,
  type PromptExecutionOptionsV1,
} from './prompt-execution'
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

export const WORLDVIEW_AGENT_FIELDS = WORLDVIEW_GENERATABLE_FIELD_SPECS
  .map(spec => spec.field) as readonly WorldviewGeneratableField[]

export type WorldviewAgentField = WorldviewGeneratableField
export type WorldviewTextAgentField = Exclude<WorldviewAgentField, 'divineDesign' | 'naturalResources'>
export type WorldviewFoundationState = 'empty' | 'partial' | 'complete'
export type WorldviewFieldOperationV1 = 'create' | FieldGenerationMode

export const WORLDVIEW_FIELD_DEFAULT_OUTPUT_TOKENS_V1 = 6_000
const WORLDVIEW_FIELD_CANDIDATE_MAX_CHARS_V1 = Math.max(
  ...WORLDVIEW_GENERATABLE_FIELD_SPECS.map(spec => spec.aiGeneration.maxChars),
) + 10_000

export interface WorldviewFieldOutputBudgetV1 {
  version: 1
  source: 'default' | 'author-custom'
  requestedTokens: number
  effectiveMaxTokens: number
  effectiveCapTokens: number
  modelCapTokens: number
  authorConfigCapTokens: number
  schemaCapTokens: number
  skillCapTokens: number
  longOutputMode: 'disabled'
}

export type WorldviewFieldCopilotCandidate =
  | { field: WorldviewTextAgentField; value: string; temporaryAssumptions?: string[] }
  | { field: 'divineDesign'; value: DivineDesign; temporaryAssumptions?: string[] }
  | { field: 'naturalResources'; value: NaturalResources; temporaryAssumptions?: string[] }

type WorldviewFieldValue = string | DivineDesign | NaturalResources

export interface WorldviewFieldCopilotSnapshot {
  id: number | null
  ragDocumentId: string | null
  updatedAt: number | null
  serialized: string
  values: Record<WorldviewAgentField, WorldviewFieldValue>
  foundationState: WorldviewFoundationState
}

export interface WorldviewFieldCopilotInput {
  projectId: number
  projectName: string
  scope?: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  supplementalContext: string
  inputGuidance: string
  targetField: WorldviewAgentField
  mode: WorldviewFieldOperationV1
  assembled: AssembleContextResult
  snapshot: WorldviewFieldCopilotSnapshot
  config: AIConfig
  routingCategory: string
  generationOverrides?: { temperature?: number; maxTokens?: number }
  frozenPromptMessages?: ChatMessage[]
  promptExecutionEvidence?: PromptExecutionEvidenceV1
  outputBudget?: WorldviewFieldOutputBudgetV1
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
  promptExecutionEvidence?: PromptExecutionEvidenceV1
  /** Present only for write targets admitted through the required Gateway canary. */
  contextGatewayExecution?: ContextGatewayExecutionV1
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

export const WORLDVIEW_AGENT_FIELD_LABELS = Object.fromEntries(
  WORLDVIEW_GENERATABLE_FIELD_SPECS.map(spec => [spec.field, spec.aiGeneration.label]),
) as Record<WorldviewAgentField, string>

export const WORLDVIEW_AGENT_FIELD_CAPABILITIES = new Map(
  WORLDVIEW_GENERATABLE_FIELD_SPECS.map(spec => [spec.field, spec.aiGeneration]),
) as ReadonlyMap<WorldviewAgentField, typeof WORLDVIEW_GENERATABLE_FIELD_SPECS[number]['aiGeneration']>

const MODE_INSTRUCTIONS: Record<WorldviewFieldOperationV1, string> = {
  create: '目标字段为空：创建一份可直接审阅的新设定，不得用“暂无资料”或待办占位交付。',
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

const EMPTY_NATURAL_RESOURCES: NaturalResources = {
  rareCreatures: '',
  herbs: '',
  minerals: '',
  others: '',
}

function normalizeNaturalResources(value: unknown): NaturalResources {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_NATURAL_RESOURCES }
  const source = value as Partial<NaturalResources>
  return {
    rareCreatures: text(source.rareCreatures),
    herbs: text(source.herbs),
    minerals: text(source.minerals),
    others: text(source.others),
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
    naturalResources: normalizeNaturalResources(row?.naturalResources),
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
  return Object.values(value).some(item => item === true || (typeof item === 'string' && item.trim().length > 0))
}

function foundationStateOf(values: Record<WorldviewAgentField, WorldviewFieldValue>): WorldviewFoundationState {
  const populated = WORLDVIEW_AGENT_FIELDS.filter(field => hasMaterial(values[field])).length
  return populated === 0 ? 'empty' : populated === WORLDVIEW_AGENT_FIELDS.length ? 'complete' : 'partial'
}

function snapshotOf(row: Worldview | null): WorldviewFieldCopilotSnapshot {
  const values = valuesOf(row)
  const body = {
    id: row?.id ?? null,
    ragDocumentId: row?.ragDocumentId ?? null,
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
  if (request.length > 8_000) throw new Error('单次世界基座要求不能超过 8000 个字符。')
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
    ['naturalResources', /自然资源明细|资源分类明细|物产分类明细/],
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

export function resolveWorldviewFieldOperationV1(input: {
  requestedMode: FieldGenerationMode
  currentValue: WorldviewFieldValue
}): WorldviewFieldOperationV1 {
  return hasMaterial(input.currentValue) ? input.requestedMode : 'create'
}

export function resolveWorldviewFieldOutputBudgetV1(input: {
  config: AIConfig
  targetField: WorldviewAgentField
  skillMaxOutputTokens: number
  requestedMaxTokens?: number
}): WorldviewFieldOutputBudgetV1 {
  const modelCapTokens = getModelPreset(input.config.provider, input.config.model).maxOutput
  const authorConfigCapTokens = input.config.maxTokens > 0
    ? input.config.maxTokens
    : modelCapTokens
  const capability = WORLDVIEW_AGENT_FIELD_CAPABILITIES.get(input.targetField)
  if (!capability) throw new Error(`世界基座字段 ${input.targetField} 缺少可生成能力声明。`)
  const fieldMaxChars = capability.maxChars
  // Conservative CJK upper bound plus a small JSON envelope allowance.
  const schemaCapTokens = Math.max(1, Math.floor(fieldMaxChars * 1.5) + 256)
  const effectiveCapTokens = Math.min(
    modelCapTokens,
    authorConfigCapTokens,
    schemaCapTokens,
    input.skillMaxOutputTokens,
  )
  const source = input.requestedMaxTokens == null ? 'default' : 'author-custom'
  const requestedTokens = input.requestedMaxTokens ?? WORLDVIEW_FIELD_DEFAULT_OUTPUT_TOKENS_V1
  if (!Number.isSafeInteger(requestedTokens) || requestedTokens < 1) {
    throw new Error('世界基座输出长度必须是正整数 token。')
  }
  if (source === 'author-custom' && requestedTokens > effectiveCapTokens) {
    throw new Error(
      `作者请求 ${requestedTokens.toLocaleString()} output tokens，超过当前单次 effective cap ${effectiveCapTokens.toLocaleString()}；LONGOUT-1 尚未启用，已在模型调用前明确拒绝，没有截断、降长或额外调用。`,
    )
  }
  return {
    version: 1,
    source,
    requestedTokens,
    effectiveMaxTokens: Math.min(requestedTokens, effectiveCapTokens),
    effectiveCapTokens,
    modelCapTokens,
    authorConfigCapTokens,
    schemaCapTokens,
    skillCapTokens: input.skillMaxOutputTokens,
    longOutputMode: 'disabled',
  }
}

export function parseWorldviewFieldOutputBudgetV1(value: unknown): WorldviewFieldOutputBudgetV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('世界基座输出预算证据无效。')
  }
  const source = value as Record<string, unknown>
  const keys = [
    'version', 'source', 'requestedTokens', 'effectiveMaxTokens', 'effectiveCapTokens',
    'modelCapTokens', 'authorConfigCapTokens', 'schemaCapTokens', 'skillCapTokens',
    'longOutputMode',
  ] as const
  exactKeys(source, keys, '世界基座输出预算')
  if (source.version !== 1
    || !['default', 'author-custom'].includes(String(source.source))
    || source.longOutputMode !== 'disabled') {
    throw new Error('世界基座输出预算版本、来源或长输出模式无效。')
  }
  for (const key of keys.slice(2, 9)) {
    if (!Number.isSafeInteger(source[key]) || (source[key] as number) < 1) {
      throw new Error(`世界基座输出预算 ${key} 必须是正整数。`)
    }
  }
  const cap = Math.min(
    source.modelCapTokens as number,
    source.authorConfigCapTokens as number,
    source.schemaCapTokens as number,
    source.skillCapTokens as number,
  )
  if (source.effectiveCapTokens !== cap
    || source.effectiveMaxTokens !== Math.min(source.requestedTokens as number, cap)
    || (source.source === 'author-custom' && (source.requestedTokens as number) > cap)) {
    throw new Error('世界基座输出预算 effective cap 派生不一致。')
  }
  return source as unknown as WorldviewFieldOutputBudgetV1
}

function exactKeys(source: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(source).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label}只能包含 ${wanted.join('、')}。`)
  }
}

export function parseWorldviewFieldCandidateDraft(draft: string): WorldviewFieldCopilotCandidate {
  return parseStructuredOutputV1({
    raw: draft,
    contract: {
      version: 1,
      schemaId: 'worldview-field-candidate.v1',
      target: 'worldviews.field',
      root: 'object',
      // Native object fields may legitimately exceed the old text-only ceiling.
      // Per-field parsers below still enforce each capability's own limit.
      maxChars: WORLDVIEW_FIELD_CANDIDATE_MAX_CHARS_V1,
      allowedRootFields: ['field', 'value', 'temporaryAssumptions'],
      requiredRootFields: ['field', 'value'],
      unknownRootFieldMessage: '世界基座候选只能包含 field、value、temporaryAssumptions。',
      missingRootFieldMessage: '世界基座候选必须包含 field、value。',
    },
    parse: value => {
      const source = value as Record<string, unknown>
      exactKeys(
        source,
        source.temporaryAssumptions === undefined
          ? ['field', 'value']
          : ['field', 'value', 'temporaryAssumptions'],
        '世界基座候选',
      )
      if (!WORLDVIEW_AGENT_FIELDS.includes(source.field as WorldviewAgentField)) {
        throw new Error('世界基座候选 field 不在允许范围。')
      }
      const field = source.field as WorldviewAgentField
      const capability = WORLDVIEW_AGENT_FIELD_CAPABILITIES.get(field)
      if (!capability) throw new Error(`世界基座候选 ${field} 缺少可生成能力声明。`)
      let temporaryAssumptions: string[] | undefined
      if (source.temporaryAssumptions !== undefined) {
        if (capability.temporaryAssumptions !== 'allowed') {
          throw new Error(`世界基座候选 ${field} 不允许 temporaryAssumptions。`)
        }
        if (
          !Array.isArray(source.temporaryAssumptions)
          || source.temporaryAssumptions.length > 8
          || source.temporaryAssumptions.some(item => (
            typeof item !== 'string' || !item.trim() || item.length > 500
          ))
        ) throw new Error('temporaryAssumptions 必须是最多 8 条、每条不超过 500 字符的非空文本。')
        temporaryAssumptions = [...new Set(source.temporaryAssumptions.map(item => item.trim()))]
      }
      if (field === 'divineDesign') {
        if (!source.value || typeof source.value !== 'object' || Array.isArray(source.value)) {
          throw new Error('神明与信仰候选 value 必须是对象。')
        }
        const divine = source.value as Record<string, unknown>
        exactKeys(divine, ['hasDivinity', 'divineRank', 'divineNames', 'divineRules'], '神明与信仰候选 value')
        if (typeof divine.hasDivinity !== 'boolean') throw new Error('神明与信仰 hasDivinity 必须是布尔值。')
        const divineRank = divine.divineRank
        const divineNames = divine.divineNames
        const divineRules = divine.divineRules
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
            hasDivinity: divine.hasDivinity,
            divineRank: divineRank.trim(),
            divineNames: divineNames.trim(),
            divineRules: divineRules.trim(),
          },
          ...(temporaryAssumptions?.length ? { temporaryAssumptions } : {}),
        }
      }
      if (field === 'naturalResources') {
        if (!source.value || typeof source.value !== 'object' || Array.isArray(source.value)) {
          throw new Error('自然资源明细候选 value 必须是对象。')
        }
        const resources = source.value as Record<string, unknown>
        exactKeys(resources, ['rareCreatures', 'herbs', 'minerals', 'others'], '自然资源明细候选 value')
        for (const [key, candidate] of Object.entries(resources)) {
          if (typeof candidate !== 'string' || candidate.length > 20_000) {
            throw new Error(`自然资源明细 ${key} 必须是 0-20000 字符的文本。`)
          }
        }
        return {
          field,
          value: {
            rareCreatures: (resources.rareCreatures as string).trim(),
            herbs: (resources.herbs as string).trim(),
            minerals: (resources.minerals as string).trim(),
            others: (resources.others as string).trim(),
          },
          ...(temporaryAssumptions?.length ? { temporaryAssumptions } : {}),
        }
      }
      if (typeof source.value !== 'string' || source.value.trim().length < 2) {
        throw new Error(`世界基座候选 ${field}.value 至少需要 2 个字符。`)
      }
      const fieldValue = source.value.trim()
      if (fieldValue.length > capability.maxChars) {
        throw new Error(`世界基座候选 ${field}.value 超过 ${capability.maxChars} 字符。`)
      }
      return {
        field,
        value: fieldValue,
        ...(temporaryAssumptions?.length ? { temporaryAssumptions } : {}),
      }
    },
  })
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
    : field === 'naturalResources'
      ? '{"field":"naturalResources","value":{"rareCreatures":"珍禽异兽与牲畜","herbs":"灵药与作物","minerals":"矿物与金属","others":"其他特产"},"temporaryAssumptions":["尚未成为正式设定的假设"]}'
    : field === 'races'
      ? '{"field":"races","value":"候选正文","temporaryAssumptions":["本轮为补齐空白而采用、尚未成为正式设定的假设"]}'
    : `{"field":"${field}","value":"候选正文","temporaryAssumptions":["尚未成为正式设定的假设"]}`
}

function worldviewFieldHardSystem(input: WorldviewFieldCopilotInput): string {
  const capability = WORLDVIEW_AGENT_FIELD_CAPABILITIES.get(input.targetField)
  if (!capability) throw new Error(`世界基座字段 ${input.targetField} 缺少可生成能力声明。`)
  const dependencies = capability.directDependencies
    .map(field => `${field}（${WORLDVIEW_AGENT_FIELD_LABELS[field as WorldviewAgentField] ?? field}）`)
    .join('、')
  const raceRequirement = input.targetField === 'races'
    ? `8. 种族与民族正文必须给出可用于故事的具体新设定，至少覆盖：身份/来源、群体差异、生活或组织方式、群体关系或张力。不得输出占位话术、状态说明或概念解释。${
        input.snapshot.foundationState === 'empty'
          ? '当前无正式世界内容，可自主创造；采用的临时假设放入 temporaryAssumptions，它们不属于 Canon。'
          : '已有内容只决定兼容边界，不应让正文围绕同一已知信息打转；要补充真正的新结构。'
      }`
    : ''
  return `你是 StoryForge 世界基座 Agent，当前执行 worldview-field Skill。你只为作者生成一个世界基座字段的可确认候选。

硬性要求：
1. 本轮目标字段是 ${input.targetField}（${WORLDVIEW_AGENT_FIELD_LABELS[input.targetField]}），只允许生成这个字段。
2. ${MODE_INSTRUCTIONS[input.mode]}
3. ${FOUNDATION_STATE_INSTRUCTIONS[input.snapshot.foundationState]}
4. 世界观、规则、事实、故事核心和其他已确认内容属于正式约束；角色、故事线和大纲属于下游证据，只能在上游缺失时用于反推，不能覆盖已确认的上游设定。
5. 不得输出对其他字段的顺带修改，也不得把推断冒充已经写入的数据。
6. 项目名“${input.projectName}”只是低权重灵感，不是世界事实、主题命令或中心概念；除非作者明确要求，不得围绕标题释义或反复复述标题。
${dependencies ? `7. 当前字段的直接依赖是 ${dependencies}。已填写依赖是约束；缺失依赖只能形成 temporaryAssumptions，不得顺写其它字段。发现潜在冲突时保留目标候选并明确写入临时假设，交给作者重规划。` : '7. 当前字段没有字段级直接依赖；仍须遵守正式上下文。'}
${raceRequirement}
${input.targetField === 'races' ? '9' : '8'}. 只输出严格 JSON 对象，不输出 Markdown、解释或额外字段：
${outputContract(input.targetField)}`
}

function buildWorldviewFieldMessages(input: WorldviewFieldCopilotInput): ChatMessage[] {
  if (input.frozenPromptMessages) return input.frozenPromptMessages.map(message => ({ ...message }))
  const supplemental = input.supplementalContext.trim()
    ? `\n\n【本轮已验证上游候选（尚未采纳，不属于 Canon）】\n${input.supplementalContext.trim()}`
    : ''
  return [{
    role: 'system',
    content: worldviewFieldHardSystem(input),
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
    promptExecution?: PromptExecutionOptionsV1
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
  const scope = readScope
  const work = await db.works.get(scope.workId)
  if (!work || work.projectId !== input.projectId) throw new Error('当前作品不存在。')
  const before = await readSnapshot(input.projectId, worldGroupId, scope)
  const targetField = resolveWorldviewAgentFieldV1(request)
  const capability = WORLDVIEW_AGENT_FIELD_CAPABILITIES.get(targetField)
  if (!capability) throw new Error(`世界基座字段 ${targetField} 缺少可生成能力声明。`)
  const requestedMode = resolveWorldviewFieldModeV1(request)
  if (!capability.modes.includes(requestedMode)) {
    throw new Error(`世界基座字段 ${targetField} 不支持 ${requestedMode} 模式。`)
  }
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
  const gatewayRequired = isContextGatewayRequiredForWriteTargetV1(
    skill,
    `worldviews.${targetField}`,
  )
  if (gatewayRequired && !scope) {
    throw new Error('世界基座 Gateway required 字段需要完整的当前 WorkspaceScope。')
  }
  const targetResourceKey = hasMaterial(before.values[targetField])
    && before.ragDocumentId
    ? `worldview-field:${before.ragDocumentId}:field:${targetField}`
    : undefined
  const contextGatewayExecution = gatewayRequired
    ? await executeContextGatewayV1({
        skill,
        scope: scope!,
        worldGroupId,
        budgetTokens: Math.min(contextPolicy.maxInputTokens, skill.contextGateway!.maxRetrievedTokens),
        query: [
          `${WORLDVIEW_AGENT_FIELD_LABELS[targetField]} ${resolveWorldviewFieldModeV1(request)}`,
          request,
        ].join('\n'),
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
  const snapshot = await readSnapshot(input.projectId, worldGroupId, scope)
  if (before.serialized !== snapshot.serialized) throw new WorldviewFieldCopilotStaleError()
  const inputState = contextGatewayExecution
    ? projectContextGatewayInputStateV1(skill, contextGatewayExecution, assembled)
    : resolveAgentSkillInputStateV1(skill, [assembled])
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  if (contextGatewayExecution) {
    contextEvidence.inputStateSourceKeys = contextGatewayInputStateSourceKeysV1(
      skill,
      contextGatewayExecution,
    )
  }
  const nodeInput: WorldviewFieldCopilotInput = {
    projectId: input.projectId,
    projectName: work.title,
    scope,
    worldGroupId,
    authorRequest: request,
    supplementalContext: input.supplementalContext ?? '',
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    targetField,
    mode: resolveWorldviewFieldOperationV1({
      requestedMode,
      currentValue: snapshot.values[targetField],
    }),
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
        dimension: WORLDVIEW_AGENT_FIELD_LABELS[targetField],
        worldContext: assembled.text || '（当前没有已填写的正式设定）',
        existingWorldview: assembled.text || '',
        currentValue: JSON.stringify(snapshot.values[targetField]),
        generationMode: nodeInput.mode,
        userHint: '',
      },
      hardSystem: worldviewFieldHardSystem(nodeInput),
      authorInstruction: request,
      additionalUserMessages: [
        nodeInput.inputGuidance,
        ...(nodeInput.supplementalContext.trim()
          ? [`【本轮已验证上游候选（尚未采纳，不属于 Canon）】\n${nodeInput.supplementalContext.trim()}`]
          : []),
        `【低权重灵感：作品名】\n${work.title}`,
        `【Harness 登记的正式上下文】\n${assembled.text || '（当前没有已填写的正式设定）'}`,
      ],
    })
    const generationOverrides = {
      temperature: 0.5,
      ...rendered.generationOverrides,
      ...input.generationOverrides,
    }
    nodeInput.frozenPromptMessages = rendered.messages
    nodeInput.promptExecutionEvidence = {
      ...rendered.evidence,
      effectiveTemperature: generationOverrides.temperature ?? null,
      effectiveMaxTokens: generationOverrides.maxTokens ?? null,
    }
    nodeInput.generationOverrides = generationOverrides
  }
  nodeInput.outputBudget = resolveWorldviewFieldOutputBudgetV1({
    config,
    targetField,
    skillMaxOutputTokens: skill.maxOutputTokens,
    requestedMaxTokens: nodeInput.generationOverrides?.maxTokens,
  })
  nodeInput.generationOverrides = {
    ...nodeInput.generationOverrides,
    maxTokens: nodeInput.outputBudget.effectiveMaxTokens,
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
    promptExecutionEvidence: nodeInput.promptExecutionEvidence,
    contextGatewayExecution,
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
  const runAI = dependencies.runAI ?? (async messages => {
    const result: ChatResult = {}
    const content = await chat(messages, input.config, {
      category: input.routingCategory,
      projectId: input.projectId,
      configOverrides: {
        // prepareWorldviewFieldCopilot has already resolved or explicitly
        // frozen the connection. Re-assert it at execution so a later task
        // route change cannot switch provider/model between prepare and run.
        provider: input.config.provider,
        apiKey: input.config.apiKey,
        baseUrl: input.config.baseUrl,
        model: input.config.model,
        contextWindow: input.config.contextWindow,
        maxTokens: input.outputBudget?.effectiveMaxTokens
          ?? WORLDVIEW_FIELD_DEFAULT_OUTPUT_TOKENS_V1,
        temperature: input.generationOverrides?.temperature ?? 0.5,
      },
      contextOverflowPolicy: 'reject',
    }, input.signal, result)
    if (result.finishReason === 'length') {
      throw new Error('模型因达到输出上限而停止；本次不是完整候选，已拒绝标记成功。请缩小目标或等待 LONGOUT-1 分段协议。')
    }
    return content
  })
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
  const hint = (input.hint ?? '').trim()
  if (hint) parts.push(`作者要求：${hint}`)
  const request = parts.join('\n')
  if (request.length > 8_000) {
    throw new Error('世界基座作者要求超过 8000 字符；没有截断，已在模型调用前阻止。')
  }
  return request
}
