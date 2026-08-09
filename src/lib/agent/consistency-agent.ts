import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import { normalizeChapterText, hashChapterText } from '../ai/chapter-memory/text-normalization'
import {
  buildConsistencyAuditPrompt,
  parseConsistencyAuditResult,
  type ConsistencyAuditResult,
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
} from '../types'
import { parseAgentEventPayload } from '../types'
import {
  AgentTeamBudgetTracker,
  type AgentTeamBudgetEvidence,
} from './team-budget'
import {
  assertRecordInScope,
  isLegacyReadScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
} from '../world-engine/scope'
import type { WorkspaceScope } from '../types/world-ownership'
import { hashCanonicalValue } from './run/hash'

export const CONSISTENCY_AGENT_VERSION = 1
export const CONSISTENCY_AGENT_PAYLOAD_TYPE = 'consistency-agent'

export type ConsistencyAgentMode = 'background' | 'fast' | 'deep'

export interface ConsistencyAgentContextEvidence {
  included: string[]
  omitted: string[]
  trimmed: string[]
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

const FAST_SOURCES = [
  'chapterContinuityHandoff',
  'previousPlanReconciliation',
  'currentFacts',
  'canonAssertions',
  'characterKnowledge',
  'creativeRules',
  'worldRules',
  'stateCards',
  'heldItems',
] as const

const DEEP_SOURCES = [
  ...FAST_SOURCES,
  'recentChapterSummaries',
  'retrievedPassages',
  'itemLedger',
  'storyTimeline',
  'characterRelations',
  'foreshadows',
  'storyArcs',
  'storylineProgress',
] as const

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
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  outlineNodeId?: number | null
  chapterContent: string
  mode: Exclude<ConsistencyAgentMode, 'background'>
  provider?: Parameters<typeof assembleContext>[0]['provider']
  model?: string
  budget: AgentTeamBudgetTracker
  call: (messages: ChatMessage[]) => Promise<string>
}): Promise<ConsistencyAgentCandidate> {
  const scope = await resolveReadScopeLike(input.projectId)
  const chapter = await db.chapters.get(input.chapterId)
  if (!await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('一致性审计章节不存在或不属于当前作品。')
  }
  const chapterText = normalizeChapterText(input.chapterContent)
  const sourceTextHash = await hashChapterText(chapterText)
  const [evidence, cognition, lifecycle, deterministicFindings] = await Promise.all([
    assembleContext({
      projectId: input.projectId,
      scope: isLegacyReadScope(scope) ? undefined : scope,
      chapterId: input.chapterId,
      outlineNodeId: input.outlineNodeId,
      worldGroupId: input.worldGroupId,
      sourceKeys: [...(input.mode === 'fast' ? FAST_SOURCES : DEEP_SOURCES)],
      provider: input.provider,
      model: input.model,
      inputBudgetMaxTokens: input.mode === 'fast' ? 16_000 : 32_000,
      sourceBudgetScale: input.mode === 'fast' ? 0.55 : 1,
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
  const messages = buildConsistencyAuditPrompt({
    mode: input.mode,
    chapterTitle: input.chapterTitle,
    chapterContent: chapterText,
    evidenceContext: evidence.text,
    cognitionCatalog: formatCognitionCatalog(cognition.catalog),
    lifecycleCatalog: formatLifecycleCatalog(lifecycle.catalog),
  })
  const reservation = input.budget.reserveCall({
    label: input.mode === 'fast' ? '一致性 Fast Guard' : '一致性 Deep Audit',
    messages,
    maxOutputTokens: input.mode === 'fast' ? 4_000 : 6_000,
  })
  let raw: string
  try {
    raw = await input.call(messages)
    input.budget.settleCall(reservation, raw)
  } catch (error) {
    input.budget.settleFailedCall(reservation)
    throw error
  }
  const parsed = parseConsistencyAuditResult({
    raw,
    mode: input.mode,
    chapterContent: chapterText,
    evidenceContext: evidence.text,
  })
  if (!parsed) {
    throw new Error('一致性 Agent 返回的 JSON 无法解析；没有保存不完整报告。')
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
  const latest = matches[0]
  if (!latest) return null
  const conversation = await db.agentConversations.get(latest.event.conversationId)
  return conversation && await assertRecordInScope(scope, 'agentConversations', conversation, { owner: 'work' })
    ? { conversation, event: latest.event, candidate: latest.candidate }
    : null
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
