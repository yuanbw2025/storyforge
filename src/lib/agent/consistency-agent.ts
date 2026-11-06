import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import { normalizeChapterText, hashChapterText, sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'
import {
  buildConsistencyAuditPrompt,
  consistencyAuditEvidenceOffsetV1,
  parseConsistencyAuditResult,
  type ConsistencyAuditResult,
  type ConsistencyAuditCitationSourceV1,
  type ConsistencyFinding,
} from '../ai/adapters/consistency-audit-adapter'
import {
  checkHeldItemAcquisition,
  readProjectHeldItems,
} from '../consistency/held-items'
import {
  checkCognitionBoundary,
  formatCognitionCatalog,
  parseCognitionReferences,
  readCognitionAuditSnapshot,
} from '../knowledge-ledger/knowledge-ledger'
import {
  checkCharacterLifecycleBoundary,
  formatLifecycleCatalog,
  parseLifecycleActivityReferences,
  readLifecycleAuditSnapshot,
} from '../consistency/lifecycle-boundary'
import type {
  AgentConversation,
  AgentEvent,
  ChatMessage,
  OutlineNode,
} from '../types'
import { parseAgentEventPayload } from '../types'
import {
  AgentTeamBudgetTracker,
  type AgentTeamBudgetEvidence,
} from './team-budget'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
} from '../workspace/scope'
import type { WorkspaceScope } from '../types/world-ownership'
import type { ConsistencyAuditSourceReadV1 } from '../registry/types'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import { hashCanonicalValue } from './run/hash'
import { readAgentRunV1 } from './run/event-store'

export const CONSISTENCY_AGENT_VERSION = 1
export const CONSISTENCY_AGENT_PAYLOAD_TYPE = 'consistency-agent'

export type ConsistencyAgentMode = 'background' | 'fast' | 'deep'

export interface ConsistencyAgentContextEvidence {
  included: string[]
  omitted: string[]
  trimmed: string[]
  /** Absent on historical reports; source-level clipping is distinct from omitted sources. */
  truncated?: string[]
  /** Frozen by explicit durable audits; historical/background reports may lack it. */
  contentRevisionHash?: string
  citationIndexHash?: string
  inputTokens: number
  inputBudget: number
}

export interface ConsistencyAgentDurableEvidenceV1 {
  runId: number
  stepId: string
  attempt: number
  contextManifestHash: string
  candidateHash: string
}

export interface ConsistencyAgentCandidate {
  version: typeof CONSISTENCY_AGENT_VERSION
  type: typeof CONSISTENCY_AGENT_PAYLOAD_TYPE
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  mode: ConsistencyAgentMode
  sourceTextHash: string
  createdAt: number
  findings: ConsistencyFinding[]
  context: ConsistencyAgentContextEvidence
  budget: AgentTeamBudgetEvidence
  /** Present when the report is the post-adoption barrier's durable step. */
  durable?: ConsistencyAgentDurableEvidenceV1
}

export interface ConsistencyAgentRun {
  conversation: AgentConversation
  event: AgentEvent
  candidate: ConsistencyAgentCandidate
}

export const CONSISTENCY_AGENT_FAST_SOURCES_V1 = [
  'chapterOutline',
  'detailedOutline',
  'chapterContinuityHandoff',
  'previousPlanReconciliation',
  'currentFacts',
  'consistencyDossier',
  'canonAssertions',
  'characterKnowledge',
  'creativeRules',
  'worldRules',
  'stateCards',
  'heldItems',
] as const

export const CONSISTENCY_AGENT_DEEP_SOURCES_V1 = [
  ...CONSISTENCY_AGENT_FAST_SOURCES_V1,
  'recentChapterSummaries',
  'retrievedPassages',
  'itemLedger',
  'storyTimeline',
  'characterRelations',
  'foreshadows',
  'storyArcs',
  'storylineProgress',
] as const

export const CONSISTENCY_AGENT_INPUT_BUDGET_V1 = {
  fast: 16_000,
  deep: 32_000,
} as const

export const CONSISTENCY_AGENT_OUTPUT_BUDGET_V1 = {
  // Includes provider reasoning tokens, which can exhaust 4K before any report text.
  fast: 16_000,
  deep: 16_000,
} as const

interface ConsistencyAuditCitationIndexV1 {
  chapterVersionHash: string
  sources: Array<Omit<ConsistencyAuditCitationSourceV1, 'text'>>
  segments: Array<{ key: ConsistencyAuditSourceReadV1['key']; start: number; end: number; versionHash: string }>
}

export interface ConsistencyAgentExecutionTraceV1 {
  contextAssembled?: (input: {
    assembled: Awaited<ReturnType<typeof assembleContext>>
    messages: ChatMessage[]
    sourceTextHash: string
    citationIndex: ConsistencyAuditCitationIndexV1
    citationIndexHash: string
  }) => void | Promise<void>
  modelRequested?: (input: { messages: ChatMessage[] }) => void | Promise<void>
  modelResponded?: (input: { raw: string; completion?: 'complete' | 'incomplete'; finishReason?: string }) => void | Promise<void>
}

export type ConsistencyAgentModelResponseV1 = string | {
  raw: string
  completion: 'complete' | 'incomplete'
  finishReason?: string
}

function emptyContext(): ConsistencyAgentContextEvidence {
  return {
    included: [],
    omitted: [],
    trimmed: [],
    inputTokens: 0,
    inputBudget: 0,
  }
}

function dedupeFindings(findings: readonly ConsistencyFinding[]): ConsistencyFinding[] {
  const seen = new Set<string>()
  return findings.filter(finding => {
    const key = [
      finding.category.trim(),
      finding.severity,
      finding.quote.trim(),
      finding.reason.trim(),
    ].join('\u0000')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function buildDeterministicFindings(input: {
  projectId: number
  chapterId: number
  worldGroupId: number | null
  chapterText: string
  scope: WorkspaceScope
}): Promise<ConsistencyFinding[]> {
  const [heldItems, characters] = await Promise.all([
    readProjectHeldItems(input.projectId, input.chapterId, input.worldGroupId, null, null, input.scope),
    readOwnedRows<any>(input.scope, 'characters', { owner: 'world' }),
  ])
  return checkHeldItemAcquisition(
    input.chapterText,
    heldItems,
    [],
    characters.map(character => character.name),
  )
}

function candidateBase(input: {
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  mode: ConsistencyAgentMode
  sourceTextHash: string
  findings: ConsistencyFinding[]
  context: ConsistencyAgentContextEvidence
  budget: AgentTeamBudgetEvidence
  contextEvidence?: ConsistencyAgentContextEvidence
}): ConsistencyAgentCandidate {
  return {
    version: CONSISTENCY_AGENT_VERSION,
    type: CONSISTENCY_AGENT_PAYLOAD_TYPE,
    projectId: input.projectId,
    chapterId: input.chapterId,
    chapterTitle: input.chapterTitle,
    worldGroupId: input.worldGroupId,
    mode: input.mode,
    sourceTextHash: input.sourceTextHash,
    createdAt: Date.now(),
    findings: dedupeFindings(input.findings),
    context: input.contextEvidence ?? input.context,
    budget: input.budget,
  }
}

/** Hash the semantic report without its run-specific envelope. */
export async function hashConsistencyAgentCandidateV1(
  candidate: ConsistencyAgentCandidate,
): Promise<string> {
  const { durable: _durable, ...withoutDurableEvidence } = candidate
  return hashCanonicalValue(withoutDurableEvidence)
}

/** 保存正文后的零 token Fast Guard。不会装配模型上下文，也不会调用提供商。 */
export async function runBackgroundConsistencyAgent(input: {
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  chapterContent: string
  budget: AgentTeamBudgetTracker
  contextEvidence?: ConsistencyAgentContextEvidence
}): Promise<ConsistencyAgentCandidate> {
  const scope = await resolveReadScopeLike(input.projectId)
  const chapter = await db.chapters.get(input.chapterId)
  if (!await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('一致性审计章节不存在或不属于当前作品。')
  }
  const chapterText = normalizeChapterText(input.chapterContent)
  const sourceTextHash = await hashChapterText(chapterText)
  const findings = await buildDeterministicFindings({
    projectId: input.projectId,
    chapterId: input.chapterId,
    worldGroupId: input.worldGroupId,
    chapterText,
    scope,
  })
  return candidateBase({
    ...input,
    mode: 'background',
    sourceTextHash,
    findings,
    context: emptyContext(),
    contextEvidence: input.contextEvidence,
    budget: input.budget.snapshot(),
  })
}

/**
 * 作者明确触发的单调用审计。模型只提取封闭引用；认知、存亡和物品判决继续由代码完成。
 */
export async function runConsistencyAgent(input: {
  projectId: number
  scope: WorkspaceScope
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  outlineNodeId?: number | null
  chapterContent: string
  mode: Exclude<ConsistencyAgentMode, 'background'>
  provider?: Parameters<typeof assembleContext>[0]['provider']
  model?: string
  budget: AgentTeamBudgetTracker
  call: (messages: ChatMessage[]) => Promise<ConsistencyAgentModelResponseV1>
  trace?: ConsistencyAgentExecutionTraceV1
}): Promise<ConsistencyAgentCandidate> {
  const scope = input.scope
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || scope.projectId !== input.projectId || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('一致性审计章节不存在或不属于当前作品。')
  }
  const [project, outlineNodes] = await Promise.all([
    db.projects.get(scope.projectId),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
  ])
  const target = walkOutlineChaptersInCanonicalOrder(outlineNodes).chapters
    .find(entry => entry.outlineNode.id === chapter.outlineNodeId)
  if (!target || (project?.enableMultiWorld ? target.worldGroupId : null) !== input.worldGroupId
    || (input.outlineNodeId != null && input.outlineNodeId !== target.outlineNode.id)) {
    throw new Error('一致性审计来源不属于当前章节的作品与世界组。')
  }
  const chapterText = normalizeChapterText(input.chapterContent)
  const sourceTextHash = await hashChapterText(chapterText)
  const captured: ConsistencyAuditSourceReadV1[] = []
  const [evidence, cognition, lifecycle, deterministicFindings] = await Promise.all([
    assembleContext({
      projectId: input.projectId,
      scope,
      chapterId: input.chapterId,
      outlineNodeId: target.outlineNode.id,
      captureConsistencyAuditSource: source => { captured.push(source) },
      worldGroupId: input.worldGroupId,
      sourceKeys: [...(input.mode === 'fast'
        ? CONSISTENCY_AGENT_FAST_SOURCES_V1
        : CONSISTENCY_AGENT_DEEP_SOURCES_V1)],
      provider: input.provider,
      model: input.model,
      inputBudgetMaxTokens: CONSISTENCY_AGENT_INPUT_BUDGET_V1[input.mode],
    }),
    readCognitionAuditSnapshot(input.projectId, input.chapterId, input.worldGroupId, input.outlineNodeId, scope),
    readLifecycleAuditSnapshot(input.projectId, input.chapterId, input.worldGroupId, scope),
    buildDeterministicFindings({
      projectId: input.projectId,
      chapterId: input.chapterId,
      worldGroupId: input.worldGroupId,
      chapterText,
      scope,
    }),
  ])
  const sources: ConsistencyAuditCitationSourceV1[] = []
  const segments: ConsistencyAuditCitationIndexV1['segments'] = []
  for (const capture of captured) {
    const index = evidence.included.indexOf(capture.key)
    const delivered = evidence.segments[index]
    const source = evidence.sourceEvidence?.find(item => item.key === capture.key)
    if (source?.status !== 'included' || source.delivery !== 'full' || !source.sourceHash
      || delivered?.content !== capture.content || await sha256Text(capture.content) !== source.sourceHash) continue
    const startInRequest = evidence.segments.slice(0, index).reduce(
      (offset, segment) => offset + segment.content.length + 2,
      consistencyAuditEvidenceOffsetV1(input.chapterTitle),
    )
    segments.push({ key: capture.key, start: startInRequest, end: startInRequest + capture.content.length, versionHash: source.sourceHash })
    for (const { id, start, end } of capture.rows) {
      sources.push({ sourceType: capture.key === 'canonAssertions' ? 'canon' : 'observation', sourceId: id,
        sourceKey: capture.key, versionHash: source.sourceHash, start, end, text: capture.content.slice(start, end) })
    }
  }
  const citationIndex: ConsistencyAuditCitationIndexV1 = {
    chapterVersionHash: sourceTextHash,
    sources: sources.map(({ text: _text, ...location }) => location),
    segments,
  }
  const citationIndexHash = await hashCanonicalValue(citationIndex)
  const messages = buildConsistencyAuditPrompt({
    mode: input.mode,
    chapterTitle: input.chapterTitle,
    chapterContent: chapterText,
    evidenceContext: evidence.text,
    citationSources: sources,
    cognitionCatalog: formatCognitionCatalog(cognition.catalog),
    lifecycleCatalog: formatLifecycleCatalog(lifecycle.catalog),
  })
  // The audit budget includes the full chapter and catalogs, not just registered sources.
  const requestTokens = messages.reduce((total, message) => total + estimateTokens(message.content), 0)
  if (requestTokens > CONSISTENCY_AGENT_INPUT_BUDGET_V1[input.mode]) {
    throw new Error(`本章全文与审计资料超出${input.mode === 'fast' ? ' Fast Guard' : ' Deep Audit'} 输入预算；未发送模型请求。${input.mode === 'fast' ? '可选择 Deep Audit 进行更大范围审计。' : ''}`)
  }
  await input.trace?.contextAssembled?.({ assembled: evidence, messages, sourceTextHash, citationIndex, citationIndexHash })
  await input.trace?.modelRequested?.({ messages })
  const reservation = input.budget.reserveCall({
    label: input.mode === 'fast' ? '一致性 Fast Guard' : '一致性 Deep Audit',
    messages,
    maxOutputTokens: CONSISTENCY_AGENT_OUTPUT_BUDGET_V1[input.mode],
  })
  let raw: string
  let received: ConsistencyAgentModelResponseV1
  try {
    received = await input.call(messages)
    raw = typeof received === 'string' ? received : received.raw
    input.budget.settleCall(reservation, raw)
  } catch (error) {
    input.budget.settleFailedCall(reservation)
    throw error
  }
  await input.trace?.modelResponded?.({ raw, ...(typeof received === 'string' ? {} : { completion: received.completion, finishReason: received.finishReason }) })
  if (typeof received !== 'string' && received.completion !== 'complete') {
    throw new Error('一致性响应未完整结束，未生成报告或自动重发。')
  }
  const parsed = parseConsistencyAuditResult({
    raw,
    mode: input.mode,
    chapterContent: chapterText,
    chapterVersionHash: sourceTextHash,
    sources,
  })
  if (!parsed) {
    throw new Error('一致性 Agent 返回的 JSON 无法解析或引文、证据无效；没有保存不完整报告。')
  }
  const cognitionFindings = checkCognitionBoundary(
    chapterText,
    parseCognitionReferences(raw, chapterText, cognition.catalog),
    cognition.projected,
  )
  const lifecycleFindings = checkCharacterLifecycleBoundary(
    chapterText,
    parseLifecycleActivityReferences(raw, chapterText, lifecycle.catalog),
    lifecycle.projected,
  )
  return candidateBase({
    ...input,
    sourceTextHash,
    findings: [
      ...deterministicFindings,
      ...cognitionFindings,
      ...lifecycleFindings,
      ...parsed.findings,
    ],
    context: {
      included: evidence.included,
      omitted: evidence.omitted,
      trimmed: evidence.trimmed,
      truncated: (evidence.sourceEvidence ?? []).filter(source => source.delivery === 'truncated').map(source => source.key),
      citationIndexHash,
      inputTokens: evidence.totalInputTokens,
      inputBudget: evidence.inputBudget,
    },
    budget: input.budget.snapshot(),
  })
}

export function isConsistencyAgentCandidateV1(value: unknown): value is ConsistencyAgentCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<ConsistencyAgentCandidate>
  const durable = candidate.durable
  const durableValid = durable === undefined || (
    durable !== null
    && typeof durable === 'object'
    && !Array.isArray(durable)
    && Number.isInteger(durable.runId)
    && durable.runId > 0
    && typeof durable.stepId === 'string'
    && durable.stepId.length > 0
    && Number.isInteger(durable.attempt)
    && durable.attempt > 0
    && typeof durable.contextManifestHash === 'string'
    && /^[a-f0-9]{64}$/u.test(durable.contextManifestHash)
    && typeof durable.candidateHash === 'string'
    && /^[a-f0-9]{64}$/u.test(durable.candidateHash)
  )
  return candidate.version === CONSISTENCY_AGENT_VERSION
    && candidate.type === CONSISTENCY_AGENT_PAYLOAD_TYPE
    && typeof candidate.projectId === 'number'
    && typeof candidate.chapterId === 'number'
    && typeof candidate.sourceTextHash === 'string'
    && ['background', 'fast', 'deep'].includes(String(candidate.mode))
    && Array.isArray(candidate.findings)
    && durableValid
}

export function summarizeConsistencyAgentCandidate(candidate: ConsistencyAgentCandidate): string {
  const hard = candidate.findings.filter(finding => finding.severity === 'hard').length
  const risk = candidate.findings.filter(finding => finding.severity === 'risk').length
  return `${candidate.mode} · 硬冲突 ${hard} · 风险 ${risk} · 共 ${candidate.findings.length}`
}

/**
 * 同一章、同一正文 hash、同一模式只保留一个可恢复事件；显式重跑会更新原事件而非制造重复。
 */
export async function persistConsistencyAgentCandidate(
  candidate: ConsistencyAgentCandidate,
): Promise<ConsistencyAgentRun> {
  const scope = await resolveScopeLike(candidate.projectId)
  const chapter = await db.chapters.get(candidate.chapterId)
  if (!await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('一致性 Agent 候选的章节不存在或不属于当前作品。')
  }
  const events = await readOwnedRows<AgentEvent>(scope, 'agentEvents', { owner: 'work' })
  const existing = events
    .filter(event => event.kind === 'candidate')
    .map(event => ({ event, candidate: parseAgentEventPayload<unknown>(event, null) }))
    .find(row => (
      isConsistencyAgentCandidateV1(row.candidate)
      && row.candidate.chapterId === candidate.chapterId
      && row.candidate.mode === candidate.mode
      && row.candidate.sourceTextHash === candidate.sourceTextHash
      && (candidate.durable
        ? row.event.durableRunId === candidate.durable.runId
        : row.event.durableRunId == null)
    ))
  const now = Date.now()
  if (existing?.event.id != null) {
    const conversation = await db.agentConversations.get(existing.event.conversationId)
    if (conversation && await assertRecordInScope(scope, 'agentConversations', conversation, { owner: 'work' })) {
      await db.transaction('rw', db.agentConversations, db.agentEvents, async () => {
        await db.agentEvents.update(existing.event.id!, {
          durableRunId: candidate.durable?.runId ?? null,
          content: summarizeConsistencyAgentCandidate(candidate),
          payload: JSON.stringify(candidate),
          createdAt: now,
        })
        await db.agentConversations.update(conversation.id!, { updatedAt: now })
      })
      return {
        conversation: { ...conversation, updatedAt: now },
        event: {
          ...existing.event,
          content: summarizeConsistencyAgentCandidate(candidate),
          payload: JSON.stringify(candidate),
          createdAt: now,
        },
        candidate,
      }
    }
  }

  const conversation = stampNewRecord(scope, 'agentConversations', {
    projectId: candidate.projectId,
    worldGroupId: candidate.worldGroupId,
    purpose: 'consistency.audit',
    title: `一致性 Agent · ${candidate.chapterTitle}`,
    status: 'archived',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as AgentConversation
  return db.transaction('rw', db.agentConversations, db.agentEvents, async () => {
    const conversationId = await db.agentConversations.add(conversation) as number
    const event = stampNewRecord(scope, 'agentEvents', {
      projectId: candidate.projectId,
      conversationId,
      durableRunId: candidate.durable?.runId ?? null,
      sequence: 1,
      kind: 'candidate',
      role: 'assistant',
      content: summarizeConsistencyAgentCandidate(candidate),
      payload: JSON.stringify(candidate),
      createdAt: now,
    }, { owner: 'work' }) as AgentEvent
    const eventId = await db.agentEvents.add(event) as number
    return {
      conversation: { ...conversation, id: conversationId },
      event: { ...event, id: eventId },
      candidate,
    }
  })
}

export async function readLatestConsistencyAgentRun(input: {
  projectId: number
  chapterId: number
}): Promise<ConsistencyAgentRun | null> {
  const scope = await resolveReadScopeLike(input.projectId)
  const chapter = await db.chapters.get(input.chapterId)
  if (!await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) return null
  const events = await readOwnedRows<AgentEvent>(scope, 'agentEvents', { owner: 'work' })
  const matches = events
    .filter(event => event.kind === 'candidate')
    .map(event => ({ event, candidate: parseAgentEventPayload<unknown>(event, null) }))
    .filter((row): row is { event: AgentEvent; candidate: ConsistencyAgentCandidate } => (
      isConsistencyAgentCandidateV1(row.candidate)
      && row.candidate.chapterId === input.chapterId
    ))
    .sort((left, right) => right.event.createdAt - left.event.createdAt)
  for (const latest of matches) {
    const durable = latest.candidate.durable
    if (durable?.stepId === 'chapter:consistency-audit') {
      try {
        const snapshot = await readAgentRunV1(scope, durable.runId)
        const step = snapshot.projection.steps[durable.stepId]
        const hasTerminalAuthority = snapshot.projection.state === 'completed'
          && (snapshot.projection.memorySettlement?.state === 'settled'
            || snapshot.events.some(event => event.type === 'verification.staled'))
        const hasContextAuthority = snapshot.events.some(event => (
          event.type === 'context.assembled'
          && event.payload.stepId === durable.stepId
          && event.payload.manifestHash === durable.contextManifestHash
        ))
        if (
          latest.event.durableRunId !== durable.runId
          || step?.candidateHash !== durable.candidateHash
          || durable.candidateHash !== await hashConsistencyAgentCandidateV1(latest.candidate)
          || !hasTerminalAuthority
          || !hasContextAuthority
        ) continue
      } catch {
        continue
      }
    }
    const conversation = await db.agentConversations.get(latest.event.conversationId)
    if (conversation && await assertRecordInScope(scope, 'agentConversations', conversation, { owner: 'work' })) {
      return { conversation, event: latest.event, candidate: latest.candidate }
    }
  }
  return null
}

export async function isConsistencyAgentCurrent(
  candidate: ConsistencyAgentCandidate,
): Promise<boolean> {
  const scope = await resolveReadScopeLike(candidate.projectId)
  const chapter = await db.chapters.get(candidate.chapterId)
  return Boolean(
    chapter
    && await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })
    && await hashChapterText(chapter.content ?? '') === candidate.sourceTextHash
  )
}

export function toConsistencyAuditResult(
  candidate: ConsistencyAgentCandidate,
): ConsistencyAuditResult {
  return {
    mode: candidate.mode === 'deep' ? 'deep' : 'fast',
    findings: candidate.findings,
  }
}
