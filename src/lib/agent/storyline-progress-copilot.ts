import { useAIConfigStore } from '../../stores/ai-config'
import { chat, resolveRequestConfig } from '../ai/client'
import type {
  GenerationGateIssue,
  GenerationNode,
  PreparedGenerationNode,
} from '../generation/generation-node'
import { prepareGenerationNode } from '../generation/generation-node'
import { assembleContext } from '../registry/assemble-context'
import type { AdoptResult, AssembleContextResult } from '../registry/types'
import type {
  AIConfig,
  Chapter,
  ChatMessage,
  StoryArc,
  WorkspaceScope,
} from '../types'
import {
  adoptStorylineAnalysisCandidates,
  parseStorylineProgressResult,
  type StorylineAnalysisCandidates,
} from '../storyline/storyline-progress'
import {
  readOwnedRows,
  resolveReadScopeLike,
} from '../workspace/scope'
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
import { parseStructuredOutputV1 } from './structured-output-pipeline'
import { hashCanonicalValue } from './run/hash'
import type { MasterCandidateModelIdentityV1 } from './master-candidate-semantic-review'
import { htmlToPlainText } from '../utils/html'
import { db } from '../db/schema'

export interface StorylineProgressCopilotSnapshotV1 {
  chapterId: number
  chapterUpdatedAt: number | null
  chapterContentHash: string
  arcs: Array<Pick<StoryArc, 'id' | 'name' | 'type' | 'description' | 'stages'>>
  serialized: string
}

interface StorylineProgressCopilotInputV1 {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  chapterId: number
  chapterTitle: string
  chapterContent: string
  authorRequest: string
  supplementalContext: string
  inputGuidance: string
  assembled: AssembleContextResult
  snapshot: StorylineProgressCopilotSnapshotV1
  config: AIConfig
  routingCategory: string
  generationOverrides?: { temperature?: number; maxTokens?: number }
  signal?: AbortSignal
}

export interface PreparedStorylineProgressCopilotV1 {
  node: GenerationNode<
    StorylineProgressCopilotInputV1,
    StorylineAnalysisCandidates,
    AdoptResult
  >
  prepared: PreparedGenerationNode
  input: StorylineProgressCopilotInputV1
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  snapshot: StorylineProgressCopilotSnapshotV1
  chapterId: number
  label: string
  modelIdentity: MasterCandidateModelIdentityV1
}

interface StorylineProgressCopilotDependenciesV1 {
  runAI?: (messages: ChatMessage[]) => Promise<string>
  readCurrent?: () => Promise<StorylineProgressCopilotSnapshotV1>
  adoptOutput?: (candidate: StorylineAnalysisCandidates) => Promise<AdoptResult>
}

export class StorylineProgressCopilotStaleError extends Error {
  constructor() {
    super('目标章节或故事线状态已在候选生成后发生变化，请重新映射。')
    this.name = 'StorylineProgressCopilotStaleError'
  }
}

function arcBoundaries(rows: StoryArc[]): StorylineProgressCopilotSnapshotV1['arcs'] {
  return rows
    .filter(row => row.id != null)
    .map(row => ({
      id: row.id!,
      name: row.name,
      type: row.type,
      description: row.description ?? '',
      stages: row.stages,
    }))
    .sort((left, right) => left.id - right.id)
}

async function readSnapshot(
  projectId: number,
  chapterId: number,
  scope?: WorkspaceScope,
): Promise<StorylineProgressCopilotSnapshotV1> {
  const resolved = scope ?? await resolveReadScopeLike(projectId)
  const [chapter, arcs, progress, crossings] = await Promise.all([
    readOwnedRows<Chapter>(resolved, 'chapters', { owner: 'work' }),
    readOwnedRows<StoryArc>(resolved, 'storyArcs', { owner: 'work' }),
    readOwnedRows<any>(resolved, 'storylineProgress', { owner: 'work' }),
    readOwnedRows<any>(resolved, 'storylineCrossings', { owner: 'work' }),
  ])
  const target = chapter.find(row => row.id === chapterId)
  if (!target) throw new Error('目标章节不存在或不属于当前作品。')
  const content = htmlToPlainText(target.content || '').trim()
  if (!content) throw new Error('目标章节没有可映射的正文。')
  const boundaries = arcBoundaries(arcs)
  if (!boundaries.length) throw new Error('当前作品尚未登记故事线。')
  const chapterContentHash = await hashCanonicalValue(content)
  const serialized = JSON.stringify({
    chapterId,
    chapterUpdatedAt: target.updatedAt ?? null,
    chapterContentHash,
    arcs: boundaries,
    progress: progress
      .map(row => ({ id: row.id ?? null, arcId: row.arcId, updatedAt: row.updatedAt ?? null }))
      .sort((left, right) => (left.id ?? 0) - (right.id ?? 0)),
    crossings: crossings
      .map(row => ({ id: row.id ?? null, arcIdA: row.arcIdA, arcIdB: row.arcIdB, chapterId: row.chapterId, updatedAt: row.updatedAt ?? null }))
      .sort((left, right) => (left.id ?? 0) - (right.id ?? 0)),
  })
  return {
    chapterId,
    chapterUpdatedAt: target.updatedAt ?? null,
    chapterContentHash,
    arcs: boundaries,
    serialized,
  }
}

function parseCandidateDraft(
  draft: string,
  input: Pick<StorylineProgressCopilotInputV1, 'chapterContent' | 'snapshot'>,
): StorylineAnalysisCandidates {
  return parseStructuredOutputV1({
    raw: draft,
    contract: {
      version: 1,
      schemaId: 'storyline-progress-analysis.v1',
      target: `chapter:${input.snapshot.chapterId}:storyline-progress`,
      root: 'object',
      maxChars: 120_000,
      allowedRootFields: ['progress', 'crossings', 'newArcs'],
      requiredRootFields: ['progress', 'crossings', 'newArcs'],
    },
    parse: value => {
      const source = value as Record<string, unknown>
      if (!Array.isArray(source.progress) || !Array.isArray(source.crossings) || !Array.isArray(source.newArcs)) {
        throw new Error('故事线进度候选的三个字段都必须是数组。')
      }
      const wire = {
        ...source,
        progress: source.progress.map(item => normalizeEvidenceField(item)),
        crossings: source.crossings.map(item => normalizeEvidenceField(item)),
        newArcs: source.newArcs.map(item => normalizeEvidenceField(item)),
      }
      const normalized = parseStorylineProgressResult({
        raw: JSON.stringify(wire),
        chapterContent: input.chapterContent,
        arcs: input.snapshot.arcs,
      })
      if (
        source.progress.length + source.crossings.length + source.newArcs.length > 0
        && normalized.progress.length + normalized.crossings.length + normalized.newArcs.length === 0
      ) throw new Error('候选没有通过故事线闭集或正文逐字证据校验。')
      if (normalized.progress.length + normalized.crossings.length + normalized.newArcs.length === 0) {
        throw new Error('本章没有足够证据映射到故事线。')
      }
      return normalized
    },
  })
}

function normalizeEvidenceField(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const row = value as Record<string, unknown>
  return row.quote === undefined && typeof row.evidenceQuote === 'string'
    ? { ...row, quote: row.evidenceQuote }
    : row
}

function candidateIssues(
  candidate: StorylineAnalysisCandidates,
  input: Pick<StorylineProgressCopilotInputV1, 'chapterContent' | 'snapshot'>,
): GenerationGateIssue[] {
  try {
    parseCandidateDraft(JSON.stringify(candidate), input)
    return []
  } catch (error) {
    return [{
      code: 'storyline-progress-invalid',
      message: error instanceof Error ? error.message : '故事线进度候选无效。',
    }]
  }
}

function buildMessages(input: StorylineProgressCopilotInputV1): ChatMessage[] {
  const supplemental = input.supplementalContext.trim()
    ? `\n\n【本轮已验证上游候选（尚未采纳，不属于 Canon）】\n${input.supplementalContext.trim()}`
    : ''
  return [
    {
      role: 'system',
      content: `你是 StoryForge 大纲 Agent，当前执行 storyline-progress Skill。你的职责是把一章已写正文映射到作者已登记的故事线，形成作者确认候选，不得改写正文或自动改变故事线规划。\n\n硬规则：\n1. progress/crossings 只能使用正式上下文里的故事线 ID 和阶段 ID；\n2. quote 必须逐字出现在当前章节正文中；没有证据就不要输出；\n3. 同一故事线本章最多一条 progress，交汇必须是两条不同的已登记故事线；\n4. 新故事线只能放进 newArcs，不能伪装成已登记故事线；\n5. 不确定时返回空数组，但至少有一条可靠证据才生成候选；\n6. 只输出严格 JSON 对象，不输出 Markdown 或解释：{"progress":[],"crossings":[],"newArcs":[]}`,
    },
    {
      role: 'user',
      content: [
        input.inputGuidance,
        `【作者要求】\n${input.authorRequest}${supplemental}`,
        `【正式上下文】\n${input.assembled.text || '（当前没有可用的正式上下文）'}`,
        '请只输出本章有逐字证据支持的故事线映射 JSON。',
      ].join('\n\n'),
    },
  ]
}

async function readChapterContent(
  projectId: number,
  chapterId: number,
  scope?: WorkspaceScope,
): Promise<string> {
  const resolved = scope ?? await resolveReadScopeLike(projectId)
  const row = (await readOwnedRows<Chapter>(resolved, 'chapters', { owner: 'work' }))
    .find(chapter => chapter.id === chapterId)
  const content = htmlToPlainText(row?.content || '').trim()
  if (!content) throw new Error('目标章节没有可映射的正文。')
  return content
}

export async function prepareStorylineProgressCopilotV1(
  input: {
    projectId: number
    scope?: WorkspaceScope
    worldGroupId: number | null
    chapterId: number
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
  dependencies: StorylineProgressCopilotDependenciesV1 = {},
): Promise<PreparedStorylineProgressCopilotV1> {
  const request = input.authorRequest.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的故事线映射要求。')
  if (request.length > 2_000) throw new Error('单次故事线映射要求不能超过 2000 个字符。')
  const skill = resolveAgentSkillV1('outline', input.skillId ?? 'outline.storyline-progress')
  if (skill.executionMode !== 'storyline-progress') {
    throw new Error('故事线进度 Copilot 只接受 outline.storyline-progress Skill。')
  }
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) throw new Error('多世界项目必须先选择一个世界。')
  const worldGroupId = project.enableMultiWorld ? input.worldGroupId : null
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const scope = readScope
  const before = await readSnapshot(input.projectId, input.chapterId, scope)
  const routingCategory = input.routingCategory ?? 'agent.outline.storyline-progress'
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
    chapterId: input.chapterId,
    provider: config.provider,
    model: config.model,
    sourceKeys: [...skill.contextSourceKeys],
    inputBudgetMaxTokens: contextPolicy.maxInputTokens,
    sourceBudgetScale: contextPolicy.sourceBudgetScale,
    sourceTransformer: compression?.sourceTransformer,
  })
  const snapshot = await readSnapshot(input.projectId, input.chapterId, scope)
  if (before.serialized !== snapshot.serialized) throw new StorylineProgressCopilotStaleError()
  const chapter = (await readOwnedRows<Chapter>(scope ?? await resolveReadScopeLike(input.projectId), 'chapters', { owner: 'work' }))
    .find(row => row.id === input.chapterId)
  if (!chapter) throw new Error('目标章节不存在或不属于当前作品。')
  const content = htmlToPlainText(chapter.content || '').trim()
  const inputState = resolveAgentSkillInputStateV1(skill, [assembled])
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  const nodeInput: StorylineProgressCopilotInputV1 = {
    projectId: input.projectId,
    scope,
    worldGroupId,
    chapterId: input.chapterId,
    chapterTitle: chapter.title,
    chapterContent: content,
    authorRequest: request,
    supplementalContext: input.supplementalContext ?? '',
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    assembled,
    snapshot,
    config,
    routingCategory,
    generationOverrides: input.generationOverrides,
    signal: input.signal,
  }
  const node = createStorylineProgressCopilotNodeV1(nodeInput, dependencies)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    contextSources: assembled.included,
    contextEvidence,
    snapshot,
    chapterId: input.chapterId,
    label: `映射章节“${chapter.title}”的故事线进度`,
    modelIdentity: { provider: config.provider, model: config.model },
  }
}

export function createStorylineProgressCopilotNodeV1(
  input: StorylineProgressCopilotInputV1,
  dependencies: StorylineProgressCopilotDependenciesV1 = {},
): PreparedStorylineProgressCopilotV1['node'] {
  const readCurrent = dependencies.readCurrent ?? (() => readSnapshot(input.projectId, input.chapterId, input.scope))
  const adoptOutput = dependencies.adoptOutput ?? (candidate => adoptStorylineAnalysisCandidates({
    projectId: input.projectId,
    scope: input.scope,
    chapterId: input.chapterId,
    snapshot: input.snapshot,
    candidate,
  }))
  const runAI = dependencies.runAI ?? (messages => chat(messages, input.config, {
    category: input.routingCategory,
    projectId: input.projectId,
    configOverrides: {
      maxTokens: input.generationOverrides?.maxTokens ?? 8_000,
      temperature: input.generationOverrides?.temperature ?? 0.2,
    },
    contextOverflowPolicy: 'reject',
  }, input.signal))
  return {
    id: `agent.outline.storyline-progress:${input.projectId}:${input.chapterId}:${input.snapshot.chapterContentHash.slice(0, 12)}`,
    kind: 'outline.storyline-progress',
    editableInput: true,
    assembleInput: buildMessages,
    run: async messages => parseCandidateDraft(await runAI(messages), input),
    gate: output => {
      const issues = candidateIssues(output, input)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      const current = await readCurrent()
      if (current.serialized !== input.snapshot.serialized) throw new StorylineProgressCopilotStaleError()
      const chapterContent = await readChapterContent(input.projectId, input.chapterId, input.scope)
      const candidate = parseCandidateDraft(JSON.stringify(output), {
        chapterContent,
        snapshot: { ...input.snapshot, arcs: current.arcs },
      })
      return adoptOutput(candidate)
    },
  }
}

export function parseStorylineProgressCandidateDraftV1(draft: string): StorylineAnalysisCandidates {
  return parseStructuredOutputV1({
    raw: draft,
    contract: {
      version: 1,
      schemaId: 'storyline-progress-candidate.v1',
      target: 'storyline-progress:restored-candidate',
      root: 'object',
      maxChars: 120_000,
      allowedRootFields: ['progress', 'crossings', 'newArcs'],
      requiredRootFields: ['progress', 'crossings', 'newArcs'],
    },
    parse: value => {
      const raw = value as Record<string, unknown>
      if (!Array.isArray(raw.progress) || !Array.isArray(raw.crossings) || !Array.isArray(raw.newArcs)) {
        throw new Error('故事线进度候选缺少三个数组字段。')
      }
      return {
        progress: raw.progress.map(normalizeRestoredEvidenceRow) as StorylineAnalysisCandidates['progress'],
        crossings: raw.crossings.map(normalizeRestoredEvidenceRow) as StorylineAnalysisCandidates['crossings'],
        newArcs: raw.newArcs.map(normalizeRestoredEvidenceRow) as StorylineAnalysisCandidates['newArcs'],
      }
    },
  })
}

function normalizeRestoredEvidenceRow(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const row = value as Record<string, unknown>
  return row.evidenceQuote === undefined && typeof row.quote === 'string'
    ? { ...row, evidenceQuote: row.quote }
    : row
}

export async function adoptRestoredStorylineProgressCandidateV1(input: {
  projectId: number
  scope?: WorkspaceScope
  chapterId: number
  snapshot: StorylineProgressCopilotSnapshotV1
  draft: string
}): Promise<AdoptResult> {
  const current = await readSnapshot(input.projectId, input.chapterId, input.scope)
  if (current.serialized !== input.snapshot.serialized) throw new StorylineProgressCopilotStaleError()
  const chapterContent = await readChapterContent(input.projectId, input.chapterId, input.scope)
  const candidate = parseCandidateDraft(input.draft, {
    chapterContent,
    snapshot: current,
  })
  return adoptStorylineAnalysisCandidates({
    projectId: input.projectId,
    scope: input.scope,
    chapterId: input.chapterId,
    snapshot: current,
    candidate,
  })
}
