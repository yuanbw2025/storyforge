import { useAIConfigStore } from '../../stores/ai-config'
import { usePromptStore } from '../../stores/prompt'
import { chat, resolveRequestConfig } from '../ai/client'
import { appendSimplifiedChineseOutputConstraint, appendUserConstraint } from '../ai/adapters/prompt-guards'
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
import {
  buildCharacterRevisionSnapshot,
  effectiveProtectedThrough,
  formatCharacterRevisionScope,
  parseCharacterRevisionOutput,
  type CharacterRevisionPlan,
  type CharacterRevisionScopeInput,
  type CharacterRevisionSnapshot,
  type CharacterRevisionStrategy,
} from '../story-planning/character-revision'
import type {
  AIConfig,
  Character,
  CharacterDrivenPlan,
  ChatMessage,
  WorkspaceScope,
} from '../types'
import { parseCharacterDrivenPlanArcs } from '../types'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
} from '../workspace/scope'
import {
  attachAgentContextInputStateV1,
  mergeContextEvidence,
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
import { parseStructuredOutputV1 } from './structured-output-pipeline'

const CHANGE_TYPES = ['add-character', 'revise-arc', 'revise-ending', 'remove-or-demote'] as const
const STRATEGIES = ['light', 'balanced', 'deep'] as const
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const RECOMMENDATIONS = ['protect', 'manual-review', 'optional-draft'] as const
const MAX_CANDIDATE_CHARS = 240_000
const MAX_TEXT_CHARS = 8_000
const MAX_SHORT_TEXT_CHARS = 500
const MAX_ARRAY_ITEMS = 100

export interface CharacterRevisionTaskInputV1 extends CharacterRevisionScopeInput {
  planId: number | null
}

export interface CharacterRevisionDecisionV1 {
  optionId: string
  outlineNodeIds: number[]
}

export interface CharacterRevisionCandidateV1 {
  version: 1
  plan: CharacterRevisionPlan
  decision: CharacterRevisionDecisionV1 | null
}

export interface CharacterRevisionCopilotSnapshotV1 {
  serialized: string
  revision: CharacterRevisionSnapshot
  request: CharacterRevisionTaskInputV1
  planId: number | null
}

interface CharacterRevisionCopilotInputV1 {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  authorRequest: string
  inputGuidance: string
  assembled: Awaited<ReturnType<typeof assembleContext>>
  snapshot: CharacterRevisionCopilotSnapshotV1
  config: AIConfig
  routingCategory: string
  generationOverrides?: { temperature?: number; maxTokens?: number }
  signal?: AbortSignal
}

export interface PreparedCharacterRevisionCopilotV1 {
  node: GenerationNode<
    CharacterRevisionCopilotInputV1,
    CharacterRevisionCandidateV1,
    { appliedOutlineNodeIds: number[]; alreadyAppliedOutlineNodeIds: number[] }
  >
  prepared: PreparedGenerationNode
  input: CharacterRevisionCopilotInputV1
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  snapshot: CharacterRevisionCopilotSnapshotV1
  label: string
}

interface CharacterRevisionCopilotDependenciesV1 {
  runAI?: (messages: ChatMessage[]) => Promise<string>
  readCurrent?: () => Promise<CharacterRevisionCopilotSnapshotV1>
}

export class CharacterRevisionCopilotStaleError extends Error {
  constructor() {
    super('角色重规划所依据的大纲、正文进度、目标角色或方案已经变化。为避免覆盖作者的新内容，请重新分析。')
    this.name = 'CharacterRevisionCopilotStaleError'
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象。`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys)
  const missing = keys.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (missing.length) throw new Error(`${label} 缺少字段：${missing.join('、')}。`)
  if (unknown.length) throw new Error(`${label} 包含不允许的字段：${unknown.join('、')}。`)
}

function text(value: unknown, label: string, max = MAX_TEXT_CHARS, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串。`)
  const result = value.trim()
  if (!allowEmpty && !result) throw new Error(`${label} 不能为空。`)
  if (result.length > max) throw new Error(`${label} 超过 ${max} 字符。`)
  return result
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${label} 必须是 ${min}-${max} 的整数。`)
  }
  return Number(value)
}

function nullableId(value: unknown, label: string): number | null {
  if (value === null) return null
  return integer(value, label, 1, Number.MAX_SAFE_INTEGER)
}

function array(value: unknown, label: string, max = MAX_ARRAY_ITEMS): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} 必须是最多 ${max} 项的数组。`)
  return value
}

function stringArray(value: unknown, label: string, max = MAX_ARRAY_ITEMS): string[] {
  return array(value, label, max).map((item, index) => text(
    item,
    `${label}[${index}]`,
    MAX_TEXT_CHARS,
    true,
  )).filter(Boolean)
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} 不在允许范围内。`)
  return value as T
}

export function parseCharacterRevisionTaskInputV1(value: unknown): CharacterRevisionTaskInputV1 {
  const source = record(value, '角色重规划任务输入')
  exactKeys(source, [
    'planId',
    'changeType',
    'characterId',
    'characterName',
    'changeDescription',
    'protectedThroughOrdinal',
    'transitionChapterCount',
    'strategy',
    'anchorNodeIds',
    'extraRequirements',
  ], '角色重规划任务输入')
  const anchorNodeIds = [...new Set(array(source.anchorNodeIds, 'anchorNodeIds', 100).map(
    (item, index) => integer(item, `anchorNodeIds[${index}]`, 1, Number.MAX_SAFE_INTEGER),
  ))]
  return {
    planId: nullableId(source.planId, 'planId'),
    changeType: enumValue(source.changeType, CHANGE_TYPES, 'changeType'),
    characterId: nullableId(source.characterId, 'characterId'),
    characterName: text(source.characterName, 'characterName', MAX_SHORT_TEXT_CHARS, true),
    changeDescription: text(source.changeDescription, 'changeDescription', 4_000),
    protectedThroughOrdinal: integer(source.protectedThroughOrdinal, 'protectedThroughOrdinal', 0, 1_000_000),
    transitionChapterCount: integer(source.transitionChapterCount, 'transitionChapterCount', 0, 50),
    strategy: enumValue(source.strategy, STRATEGIES, 'strategy'),
    anchorNodeIds,
    extraRequirements: text(source.extraRequirements, 'extraRequirements', 4_000, true),
  }
}

function assertPlanShape(root: Record<string, unknown>): void {
  exactKeys(root, [
    'changeSummary',
    'scopeSummary',
    'affectedWrittenChapters',
    'immutableFacts',
    'conflicts',
    'foreshadowSuggestions',
    'mainPlotSuggestion',
    'options',
    'warnings',
  ], '角色重规划候选')
  text(root.changeSummary, 'changeSummary')
  text(root.scopeSummary, 'scopeSummary')
  text(root.mainPlotSuggestion, 'mainPlotSuggestion', MAX_TEXT_CHARS, true)
  stringArray(root.warnings, 'warnings')
  array(root.affectedWrittenChapters, 'affectedWrittenChapters').forEach((item, index) => {
    const row = record(item, `affectedWrittenChapters[${index}]`)
    exactKeys(row, ['ordinal', 'title', 'severity', 'reason', 'evidenceQuotes', 'recommendation'], `affectedWrittenChapters[${index}]`)
    integer(row.ordinal, `affectedWrittenChapters[${index}].ordinal`, 1, 1_000_000)
    text(row.title, `affectedWrittenChapters[${index}].title`, MAX_SHORT_TEXT_CHARS)
    enumValue(row.severity, SEVERITIES, `affectedWrittenChapters[${index}].severity`)
    text(row.reason, `affectedWrittenChapters[${index}].reason`)
    stringArray(row.evidenceQuotes, `affectedWrittenChapters[${index}].evidenceQuotes`)
    enumValue(row.recommendation, RECOMMENDATIONS, `affectedWrittenChapters[${index}].recommendation`)
  })
  array(root.immutableFacts, 'immutableFacts').forEach((item, index) => {
    const row = record(item, `immutableFacts[${index}]`)
    exactKeys(row, ['statement', 'sourceChapterOrdinal', 'evidenceQuote'], `immutableFacts[${index}]`)
    text(row.statement, `immutableFacts[${index}].statement`)
    if (row.sourceChapterOrdinal !== null) {
      integer(row.sourceChapterOrdinal, `immutableFacts[${index}].sourceChapterOrdinal`, 1, 1_000_000)
    }
    text(row.evidenceQuote, `immutableFacts[${index}].evidenceQuote`, MAX_TEXT_CHARS, true)
  })
  array(root.conflicts, 'conflicts').forEach((item, index) => {
    const row = record(item, `conflicts[${index}]`)
    exactKeys(row, ['severity', 'source', 'title', 'reason', 'evidenceQuote'], `conflicts[${index}]`)
    enumValue(row.severity, SEVERITIES, `conflicts[${index}].severity`)
    text(row.source, `conflicts[${index}].source`, MAX_SHORT_TEXT_CHARS)
    text(row.title, `conflicts[${index}].title`, MAX_SHORT_TEXT_CHARS)
    text(row.reason, `conflicts[${index}].reason`)
    text(row.evidenceQuote, `conflicts[${index}].evidenceQuote`, MAX_TEXT_CHARS, true)
  })
  array(root.foreshadowSuggestions, 'foreshadowSuggestions').forEach((item, index) => {
    const row = record(item, `foreshadowSuggestions[${index}]`)
    exactKeys(row, ['chapterOrdinal', 'title', 'suggestion'], `foreshadowSuggestions[${index}]`)
    integer(row.chapterOrdinal, `foreshadowSuggestions[${index}].chapterOrdinal`, 1, 1_000_000)
    text(row.title, `foreshadowSuggestions[${index}].title`, MAX_SHORT_TEXT_CHARS)
    text(row.suggestion, `foreshadowSuggestions[${index}].suggestion`)
  })
  const options = array(root.options, 'options', 3)
  if (options.length !== 3) throw new Error('角色重规划候选必须包含 light、balanced、deep 三档方案。')
  const intensities = new Set<CharacterRevisionStrategy>()
  const ids = new Set<string>()
  options.forEach((item, index) => {
    const row = record(item, `options[${index}]`)
    exactKeys(row, ['id', 'intensity', 'label', 'summary', 'risks', 'patches'], `options[${index}]`)
    const id = text(row.id, `options[${index}].id`, 120)
    if (ids.has(id)) throw new Error('角色重规划候选的 option id 不得重复。')
    ids.add(id)
    const intensity = enumValue(row.intensity, STRATEGIES, `options[${index}].intensity`)
    if (intensities.has(intensity)) throw new Error('角色重规划候选的三档 intensity 不得重复。')
    intensities.add(intensity)
    text(row.label, `options[${index}].label`, MAX_SHORT_TEXT_CHARS)
    text(row.summary, `options[${index}].summary`)
    stringArray(row.risks, `options[${index}].risks`)
    array(row.patches, `options[${index}].patches`).forEach((patch, patchIndex) => {
      const value = record(patch, `options[${index}].patches[${patchIndex}]`)
      exactKeys(value, ['outlineNodeId', 'proposedTitle', 'proposedSummary', 'reason'], `options[${index}].patches[${patchIndex}]`)
      integer(value.outlineNodeId, `options[${index}].patches[${patchIndex}].outlineNodeId`, 1, Number.MAX_SAFE_INTEGER)
      text(value.proposedTitle, `options[${index}].patches[${patchIndex}].proposedTitle`, MAX_SHORT_TEXT_CHARS)
      text(value.proposedSummary, `options[${index}].patches[${patchIndex}].proposedSummary`)
      text(value.reason, `options[${index}].patches[${patchIndex}].reason`)
    })
  })
  if (STRATEGIES.some(value => !intensities.has(value))) {
    throw new Error('角色重规划候选缺少 light、balanced 或 deep 方案。')
  }
}

export function parseCharacterRevisionPlanDraftV1(
  draft: string,
  snapshot: CharacterRevisionSnapshot,
  request: CharacterRevisionTaskInputV1,
): CharacterRevisionPlan {
  return parseStructuredOutputV1({
    raw: draft,
    contract: {
      version: 1,
      schemaId: 'character-revision-plan.v1',
      target: `character-revision:${request.characterId ?? request.characterName ?? 'unresolved'}`,
      root: 'object',
      maxChars: MAX_CANDIDATE_CHARS,
      allowedRootFields: [
        'changeSummary', 'scopeSummary', 'affectedWrittenChapters', 'immutableFacts',
        'conflicts', 'foreshadowSuggestions', 'mainPlotSuggestion', 'options', 'warnings',
      ],
      requiredRootFields: [
        'changeSummary', 'scopeSummary', 'affectedWrittenChapters', 'immutableFacts',
        'conflicts', 'foreshadowSuggestions', 'mainPlotSuggestion', 'options', 'warnings',
      ],
      unknownRootFieldMessage: '角色重规划候选包含不允许的字段。',
    },
    parse: value => {
      const root = record(value, '角色重规划候选')
      assertPlanShape(root)
      const parsed = parseCharacterRevisionOutput(JSON.stringify(root), snapshot, request)
      if (!parsed || parsed.options.length !== 3) throw new Error('角色重规划候选无法解析为三档安全方案。')
      return parsed
    },
  })
}

export function serializeCharacterRevisionCandidateV1(candidate: CharacterRevisionCandidateV1): string {
  return JSON.stringify({
    version: 1,
    plan: {
      ...candidate.plan,
      foreshadowSuggestions: candidate.plan.foreshadowSuggestions.map(({
        writtenRegion: _writtenRegion,
        ...suggestion
      }) => suggestion),
      options: candidate.plan.options.map(option => ({
        ...option,
        patches: option.patches.map(({
          ordinal: _ordinal,
          title: _title,
          currentTitle: _currentTitle,
          currentSummary: _currentSummary,
          anchorProtected: _anchorProtected,
          ...patch
        }) => patch),
      })),
    },
    decision: candidate.decision,
  }, null, 2)
}

export function parseCharacterRevisionCandidateDraftV1(
  draft: string,
  snapshot: CharacterRevisionCopilotSnapshotV1,
): CharacterRevisionCandidateV1 {
  return parseStructuredOutputV1({
    raw: draft,
    contract: {
      version: 1,
      schemaId: 'character-revision-candidate.v1',
      target: `character-revision:${snapshot.request.characterId ?? snapshot.request.characterName ?? 'unresolved'}`,
      root: 'object',
      maxChars: MAX_CANDIDATE_CHARS,
      allowedRootFields: ['version', 'plan', 'decision'],
      requiredRootFields: ['version', 'plan', 'decision'],
      unknownRootFieldMessage: '角色重规划持久候选包含不允许的字段。',
    },
    parse: value => {
      const root = record(value, '角色重规划持久候选')
      exactKeys(root, ['version', 'plan', 'decision'], '角色重规划持久候选')
      if (root.version !== 1) throw new Error('角色重规划持久候选版本不受支持。')
      const plan = parseCharacterRevisionPlanDraftV1(JSON.stringify(root.plan), snapshot.revision, snapshot.request)
      if (root.decision === null) return { version: 1, plan, decision: null }
      const decision = record(root.decision, '角色重规划作者选择')
      exactKeys(decision, ['optionId', 'outlineNodeIds'], '角色重规划作者选择')
      const optionId = text(decision.optionId, '角色重规划作者选择.optionId', 120)
      const option = plan.options.find(item => item.id === optionId)
      if (!option) throw new Error('角色重规划作者选择引用了未知方案。')
      const allowed = new Set(option.patches.map(patch => patch.outlineNodeId))
      const outlineNodeIds = [...new Set(array(decision.outlineNodeIds, '角色重规划作者选择.outlineNodeIds', 100).map(
        (item, index) => integer(item, `角色重规划作者选择.outlineNodeIds[${index}]`, 1, Number.MAX_SAFE_INTEGER),
      ))]
      if (!outlineNodeIds.length) throw new Error('角色重规划作者选择至少需要一个可应用 patch。')
      if (outlineNodeIds.some(id => !allowed.has(id))) throw new Error('角色重规划作者选择包含当前方案之外的 patch。')
      return { version: 1, plan, decision: { optionId, outlineNodeIds } }
    },
  })
}

export function decideCharacterRevisionCandidateV1(
  candidate: CharacterRevisionCandidateV1,
  optionId: string,
  outlineNodeIds: number[],
): CharacterRevisionCandidateV1 {
  const option = candidate.plan.options.find(item => item.id === optionId)
  if (!option) throw new Error('请选择有效的角色重规划方案。')
  const allowed = new Set(option.patches.map(patch => patch.outlineNodeId))
  const selected = [...new Set(outlineNodeIds)]
  if (!selected.length || selected.some(id => !allowed.has(id))) {
    throw new Error('请选择当前方案中至少一个可应用 patch。')
  }
  return { ...candidate, decision: { optionId, outlineNodeIds: selected } }
}

function formatPlan(plan: CharacterDrivenPlan | null): string {
  if (!plan) return '【本次所选角色驱动方案】无；仅依据角色卡、正式上下文与作者变更说明分析。'
  const lines = [`【本次所选角色驱动方案】${plan.name}（v${plan.version}，${plan.status}）`]
  if (plan.userHint.trim()) lines.push(`作者要求：${plan.userHint.trim()}`)
  for (const arc of parseCharacterDrivenPlanArcs(plan.arcs)) {
    lines.push(`- ${arc.name}｜${arc.role || '未标注身份'}：${arc.initialState || '未填写'} → ${arc.targetState || '未填写'}`)
  }
  return lines.join('\n')
}

async function readSnapshot(input: {
  projectId: number
  scope?: WorkspaceScope
  request: CharacterRevisionTaskInputV1
}): Promise<{ snapshot: CharacterRevisionCopilotSnapshotV1; manualSourceText: string }> {
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const scope = readScope
  const revision = await buildCharacterRevisionSnapshot(scope)
  if (!revision.plannedChapterCount) throw new Error('当前作品没有可重规划的章节大纲。')
  let plan: CharacterDrivenPlan | null = null
  if (input.request.planId != null) {
    const row = await db.characterDrivenPlans.get(input.request.planId) as CharacterDrivenPlan | undefined
    if (!row || !await assertRecordInScope(readScope, 'characterDrivenPlans', row, { owner: 'work' })) {
      throw new Error('本次选择的角色驱动方案不存在或不属于当前作品。')
    }
    plan = row
  }
  let character: Character | null = null
  if (input.request.characterId != null) {
    const rows = await readOwnedRows<Character>(readScope, 'characters', { owner: 'world' })
    character = rows.find(item => item.id === input.request.characterId) ?? null
    if (!character) throw new Error('本次选择的目标角色不存在或不属于当前世界。')
  }
  const request = parseCharacterRevisionTaskInputV1({
    ...input.request,
    characterName: character?.name ?? input.request.characterName,
    protectedThroughOrdinal: effectiveProtectedThrough(revision, input.request.protectedThroughOrdinal),
  })
  const futureNodeIds = new Set(revision.chapters
    .filter(chapter => chapter.ordinal > request.protectedThroughOrdinal && !chapter.written)
    .map(chapter => chapter.outlineNodeId))
  if (request.anchorNodeIds.some(id => !futureNodeIds.has(id))) {
    throw new Error('锚点必须属于当前作品保护区之后的未写章节。')
  }
  const planSnapshot = plan == null ? null : {
    id: plan.id,
    arcs: plan.arcs,
    userHint: plan.userHint,
    status: plan.status,
    version: plan.version,
    updatedAt: plan.updatedAt,
  }
  const serialized = JSON.stringify({
    revision,
    request,
    plan: planSnapshot,
    character: character == null ? null : {
      id: character.id,
      name: character.name,
      updatedAt: character.updatedAt,
    },
  })
  return {
    snapshot: { serialized, revision, request, planId: plan?.id ?? null },
    manualSourceText: [formatPlan(plan), formatCharacterRevisionScope(revision, request)].join('\n\n'),
  }
}

function buildMessages(input: CharacterRevisionCopilotInputV1): ChatMessage[] {
  const template = usePromptStore.getState().getActive('plot.character-revision')
  const rendered = renderPrompt(template, { revisionContext: input.assembled.text }).messages
  return appendSimplifiedChineseOutputConstraint(appendUserConstraint(rendered, [
    input.inputGuidance,
    `【本轮作者目标】\n${input.authorRequest}`,
    '【执行约束】只输出模板规定的严格 JSON 对象；不得增加字段。三档 intensity 必须各出现一次。已写区、保护区和未知节点的 patch 会被代码拒绝；没有逐字证据时必须明确写证据不足。主线建议、冲突和伏笔仅供作者查看，本轮唯一可写结果是作者最终勾选的未来大纲 patch。',
  ].join('\n\n')))
}

function candidateIssues(candidate: CharacterRevisionCandidateV1): GenerationGateIssue[] {
  const issues: GenerationGateIssue[] = []
  if (candidate.plan.options.length !== 3) {
    issues.push({ code: 'character-revision-options', message: '角色重规划候选没有完整三档方案。' })
  }
  const writable = candidate.plan.options.reduce((sum, option) => sum + option.patches.length, 0)
  if (writable === 0) {
    issues.push({
      code: 'character-revision-no-safe-patch',
      message: '三档方案都没有通过安全边界的未来大纲 patch；请缩小要求或改为人工处理。',
    })
  }
  return issues
}

function selectedPatches(candidate: CharacterRevisionCandidateV1) {
  if (!candidate.decision) throw new Error('请先选择一档方案和至少一个大纲 patch。')
  const option = candidate.plan.options.find(item => item.id === candidate.decision!.optionId)
  if (!option) throw new Error('作者选择的角色重规划方案已经无效。')
  const selected = new Set(candidate.decision.outlineNodeIds)
  const patches = option.patches.filter(patch => selected.has(patch.outlineNodeId))
  if (patches.length !== selected.size || !patches.length) throw new Error('作者选择的角色重规划 patch 已经无效。')
  return patches
}

async function applyCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  snapshot: CharacterRevisionCopilotSnapshotV1
  candidate: CharacterRevisionCandidateV1
  recovery: boolean
}): Promise<{ appliedOutlineNodeIds: number[]; alreadyAppliedOutlineNodeIds: number[] }> {
  const patches = selectedPatches(input.candidate)
  const fresh = await buildCharacterRevisionSnapshot(input.scope ?? input.projectId)
  if (!input.recovery) {
    const current = await readSnapshot({ projectId: input.projectId, scope: input.scope, request: input.snapshot.request })
    if (current.snapshot.serialized !== input.snapshot.serialized) throw new CharacterRevisionCopilotStaleError()
  }
  const currentByNode = new Map(fresh.chapters.map(chapter => [chapter.outlineNodeId, chapter]))
  const protectedThrough = effectiveProtectedThrough(fresh, input.snapshot.request.protectedThroughOrdinal)
  const anchors = new Set(input.snapshot.request.anchorNodeIds)
  const alreadyAppliedOutlineNodeIds: number[] = []
  for (const patch of patches) {
    const current = currentByNode.get(patch.outlineNodeId)
    if (!current || current.written || current.ordinal <= protectedThrough) throw new CharacterRevisionCopilotStaleError()
    if (anchors.has(patch.outlineNodeId) && patch.proposedTitle !== current.title) {
      throw new Error('角色重规划候选试图改名受保护锚点。')
    }
    if (current.title === patch.proposedTitle && current.summary === patch.proposedSummary) {
      alreadyAppliedOutlineNodeIds.push(patch.outlineNodeId)
      continue
    }
    if (current.title !== patch.currentTitle || current.summary !== patch.currentSummary) {
      throw new CharacterRevisionCopilotStaleError()
    }
  }
  const appliedOutlineNodeIds: number[] = []
  for (const patch of patches) {
    if (alreadyAppliedOutlineNodeIds.includes(patch.outlineNodeId)) continue
    const current = currentByNode.get(patch.outlineNodeId)!
    const result = await adopt({
      projectId: input.projectId,
      scope: input.scope,
      worldGroupId: current.worldGroupId,
      target: 'outlineNodes',
      recordId: patch.outlineNodeId,
      mode: 'replace',
      data: { title: patch.proposedTitle, summary: patch.proposedSummary },
    })
    if (result.written.length !== 1 || result.skipped.length || result.unknown.length || result.typeErrors.length || result.fkErrors.length) {
      throw new Error(`大纲节点 #${patch.outlineNodeId} 未能通过统一写回层。`)
    }
    appliedOutlineNodeIds.push(patch.outlineNodeId)
  }
  for (const patch of patches) {
    const current = currentByNode.get(patch.outlineNodeId)!
    if (current.chapterId == null || patch.proposedTitle === patch.currentTitle) continue
    const chapter = await db.chapters.get(current.chapterId)
    if (!chapter || chapter.projectId !== input.projectId) throw new CharacterRevisionCopilotStaleError()
    if (chapter.title === patch.proposedTitle) continue
    if (chapter.title !== patch.currentTitle) throw new CharacterRevisionCopilotStaleError()
    const chapterResult = await adopt({
      projectId: input.projectId,
      scope: input.scope,
      target: 'chapters',
      recordId: current.chapterId,
      mode: 'replace',
      data: { title: patch.proposedTitle },
    })
    if (chapterResult.written.length !== 1) throw new Error(`章节 #${current.chapterId} 标题同步失败。`)
  }
  return { appliedOutlineNodeIds, alreadyAppliedOutlineNodeIds }
}

export async function adoptRestoredCharacterRevisionCandidateV1(input: {
  projectId: number
  scope?: WorkspaceScope
  snapshot: CharacterRevisionCopilotSnapshotV1
  draft: string
}) {
  return applyCandidate({
    ...input,
    candidate: parseCharacterRevisionCandidateDraftV1(input.draft, input.snapshot),
    recovery: false,
  })
}

export async function repairPartialCharacterRevisionAdoptionV1(input: {
  projectId: number
  scope?: WorkspaceScope
  snapshot: CharacterRevisionCopilotSnapshotV1
  draft: string
}) {
  return applyCandidate({
    ...input,
    candidate: parseCharacterRevisionCandidateDraftV1(input.draft, input.snapshot),
    recovery: true,
  })
}

export async function characterRevisionCandidateMatchesBusinessStateV1(input: {
  scope: WorkspaceScope
  snapshot: CharacterRevisionCopilotSnapshotV1
  draft: string
}): Promise<boolean> {
  const candidate = parseCharacterRevisionCandidateDraftV1(input.draft, input.snapshot)
  const patches = selectedPatches(candidate)
  const outlines = await readOwnedRows<any>(input.scope, 'outlineNodes', { owner: 'work' })
  const chapters = await readOwnedRows<any>(input.scope, 'chapters', { owner: 'work' })
  const outlineById = new Map(outlines.map(row => [row.id, row]))
  const chapterByOutline = new Map(chapters.map(row => [row.outlineNodeId, row]))
  return patches.every(patch => {
    const outline = outlineById.get(patch.outlineNodeId)
    if (!outline || outline.title !== patch.proposedTitle || outline.summary !== patch.proposedSummary) return false
    const original = input.snapshot.revision.chapters.find(item => item.outlineNodeId === patch.outlineNodeId)
    const chapter = chapterByOutline.get(patch.outlineNodeId)
    return original?.chapterId == null || patch.proposedTitle === original.title || chapter?.title === patch.proposedTitle
  })
}

export async function prepareCharacterRevisionCopilotV1(
  input: {
    projectId: number
    scope?: WorkspaceScope
    worldGroupId: number | null
    request: CharacterRevisionTaskInputV1
    authorRequest: string
    skillId?: AgentSkillId
    routingCategory?: string
    contextProfile?: AgentContextProfile
    configOverride?: AIConfig
    generationOverrides?: { temperature?: number; maxTokens?: number }
    contextCompressionRuntime?: AgentContextCompressionRuntimeV1
    signal?: AbortSignal
  },
  dependencies: CharacterRevisionCopilotDependenciesV1 = {},
): Promise<PreparedCharacterRevisionCopilotV1> {
  const authorRequest = text(input.authorRequest, '角色重规划作者目标', 1_000)
  const request = parseCharacterRevisionTaskInputV1(input.request)
  const skill = resolveAgentSkillV1('outline', input.skillId ?? 'outline.character-revision')
  if (skill.executionMode !== 'character-revision') {
    throw new Error('角色中途重规划 Copilot 只接受 outline.character-revision Skill。')
  }
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) {
    throw new Error('多世界项目必须先选择当前世界，才能分析角色变更。')
  }
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const scope = readScope
  const before = await readSnapshot({ projectId: input.projectId, scope, request })
  const routingCategory = input.routingCategory ?? 'agent.outline.character-revision'
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
        authorRequest,
        routingCategory,
        signal: input.signal,
        runtime: input.contextCompressionRuntime,
      })
    : undefined
  const assembled = await assembleContext({
    projectId: input.projectId,
    scope,
    worldGroupId: project.enableMultiWorld ? input.worldGroupId : null,
    chapterId: before.snapshot.revision.lastWrittenChapterId,
    subjectCharacterName: before.snapshot.request.characterName,
    provider: config.provider,
    model: config.model,
    sourceKeys: [...skill.contextSourceKeys],
    manualSourceText: before.manualSourceText,
    inputBudgetMaxTokens: contextPolicy.maxInputTokens,
    sourceBudgetScale: contextPolicy.sourceBudgetScale,
    sourceTransformer: compression?.sourceTransformer,
  })
  const after = await readSnapshot({ projectId: input.projectId, scope, request: before.snapshot.request })
  if (before.snapshot.serialized !== after.snapshot.serialized) throw new CharacterRevisionCopilotStaleError()
  const inputState = resolveAgentSkillInputStateV1(skill, [assembled])
  const contextEvidence = attachAgentContextInputStateV1(
    mergeContextEvidence(contextProfile, [assembled]),
    inputState,
  )
  const nodeInput: CharacterRevisionCopilotInputV1 = {
    projectId: input.projectId,
    scope,
    worldGroupId: project.enableMultiWorld ? input.worldGroupId : null,
    authorRequest,
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    assembled,
    snapshot: after.snapshot,
    config,
    routingCategory,
    generationOverrides: input.generationOverrides,
    signal: input.signal,
  }
  const node = createCharacterRevisionCopilotNodeV1(nodeInput, dependencies)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    contextSources: contextEvidence.included,
    contextEvidence,
    snapshot: after.snapshot,
    label: '角色变更影响与未来大纲修订',
  }
}

export function createCharacterRevisionCopilotNodeV1(
  input: CharacterRevisionCopilotInputV1,
  dependencies: CharacterRevisionCopilotDependenciesV1 = {},
): PreparedCharacterRevisionCopilotV1['node'] {
  const readCurrent = dependencies.readCurrent ?? (async () => (
    await readSnapshot({ projectId: input.projectId, scope: input.scope, request: input.snapshot.request })
  ).snapshot)
  const runAI = dependencies.runAI ?? (messages => chat(messages, input.config, {
    category: input.routingCategory,
    projectId: input.projectId,
    configOverrides: {
      maxTokens: input.generationOverrides?.maxTokens ?? 12_000,
      temperature: input.generationOverrides?.temperature ?? 0.25,
    },
    contextOverflowPolicy: 'reject',
  }, input.signal))
  return {
    id: `agent.outline.character-revision:${input.projectId}:${input.snapshot.serialized.length}`,
    kind: 'outline.character-revision',
    editableInput: true,
    assembleInput: buildMessages,
    run: async messages => ({
      version: 1,
      plan: parseCharacterRevisionPlanDraftV1(
        await runAI(messages),
        input.snapshot.revision,
        input.snapshot.request,
      ),
      decision: null,
    }),
    gate: output => {
      const issues = candidateIssues(output)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      const current = await readCurrent()
      if (current.serialized !== input.snapshot.serialized) throw new CharacterRevisionCopilotStaleError()
      return applyCandidate({
        projectId: input.projectId,
        scope: input.scope,
        snapshot: input.snapshot,
        candidate: output,
        recovery: false,
      })
    },
  }
}
