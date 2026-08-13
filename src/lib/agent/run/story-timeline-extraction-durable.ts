import { chat } from '../../ai/client'
import {
  buildStoryTimelinePrompt,
  parseStoryEventsStrictV1,
  readStoryTimelinePromptTemplateSnapshotV1,
  type ExtractedStoryEvent,
} from '../../ai/adapters/story-timeline-adapter'
import { splitExtractionText, uniqueBy } from '../../ai/structured-extraction'
import type { AIConfig, Chapter, ChatMessage, WorkspaceScope } from '../../types'
import { assembleContext } from '../../registry/assemble-context'
import { replaceAdoptedCollection } from '../../registry/adopt'
import { readOwnedRows } from '../../world-engine/scope'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'

export const STORY_TIMELINE_EXTRACTION_STEP_ID_V1 = 'prose:story-timeline-extraction' as const
export const STORY_TIMELINE_EXTRACTION_VERIFIER_SET_V1 = 'story-timeline-extraction-terminal-v1' as const
const MAX_MODEL_CALLS = 64
const MAX_CANDIDATES = 500

type RunAI = (messages: ChatMessage[], callIndex: number) => Promise<string>

interface StableTimelineRowV1 {
  id: number
  title: string
  storyTime: string
  importance: number
  description: string
  chapterId: number | null
  chapterTitle: string
  order: number
  createdAt: number
}

interface StoryTimelineExtractionChunkV1 {
  callIndex: number
  chapterId: number
  chapterTitle: string
  chapterOrder: number
  chunkIndex: number
  chunkCount: number
  chunkHash: string
  contextManifestHash: string
}

interface StoryTimelineExtractionPlanV1 {
  version: 1
  kind: 'story-timeline-extraction-plan'
  portable: false
  projectId: number
  workId: number
  promptTemplateHash: string
  originalTimeline: StableTimelineRowV1[]
  originalTimelineHash: string
  chapterSourceHash: string
  targetChapterIds: number[]
  chunks: StoryTimelineExtractionChunkV1[]
  planHash: string
}

interface StoryTimelineExtractionCallEvidenceV1 {
  callIndex: number
  promptInputHash: string
  outputHash: string
  discoveredHash: string
}

export interface StoryTimelineExtractionCandidateItemV1 extends ExtractedStoryEvent {
  chapterId: number
  chapterTitle: string
}

interface StoryTimelineExtractionProgressV1 {
  version: 1
  kind: 'story-timeline-extraction-progress'
  portable: false
  plan: StoryTimelineExtractionPlanV1
  nextCallIndex: number
  found: StoryTimelineExtractionCandidateItemV1[]
  calls: StoryTimelineExtractionCallEvidenceV1[]
  progressHash: string
}

export interface StoryTimelineExtractionCandidateV1 {
  version: 1
  kind: 'story-timeline-extraction-candidate'
  portable: false
  plan: StoryTimelineExtractionPlanV1
  calls: StoryTimelineExtractionCallEvidenceV1[]
  events: StoryTimelineExtractionCandidateItemV1[]
  candidateHash: string
}

interface StoryTimelineFormalRowV1 {
  title: string
  storyTime: string
  importance: number
  description: string
  chapterId: number
  chapterTitle: string
  order: number
}

interface StoryTimelineFormalChapterV1 {
  chapterId: number
  rows: StoryTimelineFormalRowV1[]
  rowsHash: string
}

interface StoryTimelineExtractionAdoptionProgressV1 {
  version: 1
  kind: 'story-timeline-extraction-adoption-progress'
  portable: false
  candidate: StoryTimelineExtractionCandidateV1
  selectedIndexes: number[]
  formalChapters: StoryTimelineFormalChapterV1[]
  nextChapterIndex: number
  appliedChapterHashes: string[]
  intentHash: string
  progressHash: string
}

export type StoryTimelineExtractionBoundaryV1 =
  | 'plan.checkpoint'
  | 'chunk.checkpoint'
  | 'candidate.persisted'
  | 'candidate.checkpoint'

export type StoryTimelineExtractionAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.chapter'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedStoryTimelineSourcesV1 {
  promptTemplateHash: string
  originalTimeline: StableTimelineRowV1[]
  originalTimelineHash: string
  chapterSourceHash: string
  targetChapterIds: number[]
  chapters: Array<{
    chapter: Chapter & { id: number }
    assembled: Awaited<ReturnType<typeof assembleContext>>
    chunks: string[]
  }>
  callCount: number
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function assertExactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function stableTimelineRow(row: Record<string, any>): StableTimelineRowV1 {
  return {
    id: row.id,
    title: String(row.title ?? ''),
    storyTime: String(row.storyTime ?? ''),
    importance: Number(row.importance),
    description: String(row.description ?? ''),
    chapterId: row.chapterId ?? null,
    chapterTitle: String(row.chapterTitle ?? ''),
    order: Number(row.order),
    createdAt: Number(row.createdAt ?? 0),
  }
}

function stableTimeline(rows: Record<string, any>[]): StableTimelineRowV1[] {
  return rows.map(stableTimelineRow).sort((left, right) => left.id - right.id)
}

function stableTimelineRowKey(row: StableTimelineRowV1): string {
  return JSON.stringify([
    row.id, row.title, row.storyTime, row.importance, row.description,
    row.chapterId, row.chapterTitle, row.order, row.createdAt,
  ])
}

function exactStableRows(left: StableTimelineRowV1[], right: StableTimelineRowV1[]): boolean {
  return left.length === right.length
    && left.every((row, index) => stableTimelineRowKey(row) === stableTimelineRowKey(right[index]))
}

function candidateKey(item: StoryTimelineExtractionCandidateItemV1): string {
  // AdoptionSchema identity is chapterId + title. Candidate de-duplication must
  // converge before adoption instead of presenting two rows that the governed
  // writer would deterministically merge.
  return JSON.stringify([item.chapterId, item.title.trim().toLocaleLowerCase()])
}

function stableFormalRow(row: Record<string, any>): StoryTimelineFormalRowV1 {
  return {
    title: String(row.title ?? ''),
    storyTime: String(row.storyTime ?? ''),
    importance: Number(row.importance),
    description: String(row.description ?? ''),
    chapterId: Number(row.chapterId),
    chapterTitle: String(row.chapterTitle ?? ''),
    order: Number(row.order),
  }
}

function formalRowKey(row: StoryTimelineFormalRowV1): string {
  return JSON.stringify([
    row.title, row.storyTime, row.importance, row.description,
    row.chapterId, row.chapterTitle, row.order,
  ])
}

function formalRowsFromStable(rows: StableTimelineRowV1[], chapterId: number): StoryTimelineFormalRowV1[] {
  return rows.filter(row => row.chapterId === chapterId)
    .map(stableFormalRow)
    .sort((left, right) => left.order - right.order || formalRowKey(left).localeCompare(formalRowKey(right)))
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: any,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope, runId: snapshot.run.id, type, payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as any)
}

async function hashAssembly(assembled: Awaited<ReturnType<typeof assembleContext>>): Promise<string> {
  return hashCanonicalValue({
    included: assembled.included,
    omitted: assembled.omitted,
    trimmed: assembled.trimmed,
    segments: assembled.segments.map(segment => ({ label: segment.label, content: segment.content })),
  })
}

async function prepareSources(scope: WorkspaceScope): Promise<PreparedStoryTimelineSourcesV1> {
  const [chapterRows, timelineRows] = await Promise.all([
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<any>(scope, 'storyTimelineEvents', { owner: 'work' }),
  ])
  const chapters: PreparedStoryTimelineSourcesV1['chapters'] = []
  for (const chapter of [...chapterRows].sort((left, right) => left.order - right.order)) {
    if (chapter.id == null) continue
    const assembled = await assembleContext({
      projectId: scope.projectId, scope, chapterId: chapter.id,
      sourceKeys: ['chapterContent'], inputBudgetMaxTokens: 100_000,
    })
    if (!assembled.included.includes('chapterContent') || assembled.text.trim().length <= 50) continue
    const chunks = splitExtractionText(assembled.text)
    if (chunks.length) chapters.push({ chapter: chapter as Chapter & { id: number }, assembled, chunks })
  }
  const callCount = chapters.reduce((sum, entry) => sum + entry.chunks.length, 0)
  if (!callCount) throw new Error('还没有可提取的已写正文。')
  if (callCount > MAX_MODEL_CALLS) {
    throw new Error(`当前正文需要 ${callCount} 个年表提取分块，超过单次上限 ${MAX_MODEL_CALLS}。`)
  }
  const originalTimeline = stableTimeline(timelineRows)
  const targetChapterIds = chapters.map(entry => entry.chapter.id)
  const chapterSourceHash = await hashCanonicalValue(await Promise.all(chapters.map(async entry => ({
    chapterId: entry.chapter.id,
    title: entry.chapter.title,
    order: entry.chapter.order,
    contextHash: await hashAssembly(entry.assembled),
    chunkHashes: await Promise.all(entry.chunks.map(chunk => hashCanonicalValue(chunk))),
  }))))
  return {
    promptTemplateHash: await hashCanonicalValue(readStoryTimelinePromptTemplateSnapshotV1()),
    originalTimeline,
    originalTimelineHash: await hashCanonicalValue(originalTimeline),
    chapterSourceHash,
    targetChapterIds,
    chapters,
    callCount,
  }
}

async function createPlan(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  prepared: PreparedStoryTimelineSourcesV1
}): Promise<{ snapshot: AgentRunSnapshotV1; plan: StoryTimelineExtractionPlanV1 }> {
  let snapshot = input.snapshot
  const chunks: StoryTimelineExtractionChunkV1[] = []
  let callIndex = 0
  for (const entry of input.prepared.chapters) {
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id, stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1, attempt: 1,
      projectId: input.scope.projectId, worldGroupId: null,
      declaredSourceKeys: ['chapterContent'], assembled: entry.assembled,
      boundary: { chapterId: entry.chapter.id }, readerVersion: 'story-timeline-extraction-chapter-v1',
    })
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1, attempt: 1, manifestHash: manifest.manifestHash,
    })
    for (let chunkIndex = 0; chunkIndex < entry.chunks.length; chunkIndex++) {
      chunks.push({
        callIndex,
        chapterId: entry.chapter.id,
        chapterTitle: entry.chapter.title,
        chapterOrder: entry.chapter.order,
        chunkIndex,
        chunkCount: entry.chunks.length,
        chunkHash: await hashCanonicalValue(entry.chunks[chunkIndex]),
        contextManifestHash: manifest.manifestHash,
      })
      callIndex++
    }
  }
  const body = {
    version: 1 as const,
    kind: 'story-timeline-extraction-plan' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    workId: input.scope.workId,
    promptTemplateHash: input.prepared.promptTemplateHash,
    originalTimeline: input.prepared.originalTimeline,
    originalTimelineHash: input.prepared.originalTimelineHash,
    chapterSourceHash: input.prepared.chapterSourceHash,
    targetChapterIds: input.prepared.targetChapterIds,
    chunks,
  }
  return { snapshot, plan: { ...body, planHash: await hashCanonicalValue(body) } }
}

function contract(scope: WorkspaceScope, maxModelCalls: number) {
  const skill = getAgentSkillV1('prose.story-timeline-extraction', 'prose')
  return {
    version: 1 as const,
    objective: '从当前 Work 的已写正文提取可确认的故事进程年表',
    workflowKind: 'long-running-resumable' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: {
      contextSourceKeys: ['chapterContent'],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table, fields: [...target.fields], mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{ stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls, maxToolCalls: 0,
      maxInputTokens: maxModelCalls * 8_000,
      maxOutputTokens: maxModelCalls * 4_000,
      maxAttemptsPerStep: 1, maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'story-timeline.candidate', kind: 'output-present' as const, required: true },
      { id: 'story-timeline.author', kind: 'author-confirmed' as const, required: true },
      { id: 'story-timeline.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'story-timeline.terminal', kind: 'terminal' as const,
      verifier: STORY_TIMELINE_EXTRACTION_VERIFIER_SET_V1,
      criterionIds: ['story-timeline.candidate', 'story-timeline.author', 'story-timeline.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function parseStableTimeline(value: unknown): StableTimelineRowV1[] {
  if (!Array.isArray(value)) throw new Error('故事年表基线无效。')
  const rows = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`故事年表基线 ${index + 1} 无效。`)
    const row = item as Record<string, unknown>
    assertExactKeys(row, [
      'id', 'title', 'storyTime', 'importance', 'description',
      'chapterId', 'chapterTitle', 'order', 'createdAt',
    ], '故事年表基线 ')
    if (
      !Number.isInteger(row.id) || (row.id as number) <= 0
      || typeof row.title !== 'string' || !row.title.trim()
      || typeof row.storyTime !== 'string'
      || !Number.isInteger(row.importance) || (row.importance as number) < 1 || (row.importance as number) > 3
      || typeof row.description !== 'string'
      || (row.chapterId !== null && !Number.isInteger(row.chapterId))
      || typeof row.chapterTitle !== 'string'
      || !Number.isInteger(row.order) || !Number.isFinite(row.createdAt)
    ) throw new Error(`故事年表基线 ${index + 1} 不完整。`)
    return row as unknown as StableTimelineRowV1
  })
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('故事年表基线 ID 重复。')
  return rows
}

async function parsePlan(value: unknown): Promise<StoryTimelineExtractionPlanV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('故事年表提取计划无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, [
    'version', 'kind', 'portable', 'projectId', 'workId', 'promptTemplateHash',
    'originalTimeline', 'originalTimelineHash', 'chapterSourceHash',
    'targetChapterIds', 'chunks', 'planHash',
  ], '故事年表提取计划 ')
  if (
    row.version !== 1 || row.kind !== 'story-timeline-extraction-plan' || row.portable !== false
    || !Number.isInteger(row.projectId) || row.projectId <= 0
    || !Number.isInteger(row.workId) || row.workId <= 0
    || !isHash(row.promptTemplateHash) || !isHash(row.originalTimelineHash)
    || !isHash(row.chapterSourceHash) || !isHash(row.planHash)
    || !Array.isArray(row.targetChapterIds) || !Array.isArray(row.chunks)
    || row.targetChapterIds.length < 1 || row.chunks.length < 1 || row.chunks.length > MAX_MODEL_CALLS
  ) throw new Error('故事年表提取计划不完整。')
  const originalTimeline = parseStableTimeline(row.originalTimeline)
  const targetChapterIds = row.targetChapterIds.map((id: unknown) => {
    if (!Number.isInteger(id) || (id as number) <= 0) throw new Error('故事年表目标章节无效。')
    return id as number
  })
  if (new Set(targetChapterIds).size !== targetChapterIds.length) throw new Error('故事年表目标章节重复。')
  const chunks = row.chunks.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`故事年表分块 ${index + 1} 无效。`)
    const chunk = item as Record<string, unknown>
    assertExactKeys(chunk, [
      'callIndex', 'chapterId', 'chapterTitle', 'chapterOrder',
      'chunkIndex', 'chunkCount', 'chunkHash', 'contextManifestHash',
    ], '故事年表分块 ')
    if (
      chunk.callIndex !== index
      || !Number.isInteger(chunk.chapterId) || (chunk.chapterId as number) <= 0
      || typeof chunk.chapterTitle !== 'string' || !Number.isInteger(chunk.chapterOrder)
      || !Number.isInteger(chunk.chunkIndex) || (chunk.chunkIndex as number) < 0
      || !Number.isInteger(chunk.chunkCount) || (chunk.chunkCount as number) < 1
      || (chunk.chunkIndex as number) >= (chunk.chunkCount as number)
      || !isHash(chunk.chunkHash) || !isHash(chunk.contextManifestHash)
    ) throw new Error(`故事年表分块 ${index + 1} 不完整。`)
    return chunk as unknown as StoryTimelineExtractionChunkV1
  })
  for (let cursor = 0; cursor < chunks.length;) {
    const first = chunks[cursor]
    const group = chunks.slice(cursor, cursor + first.chunkCount)
    if (
      group.length !== first.chunkCount
      || group.some((chunk, index) => (
        chunk.chapterId !== first.chapterId || chunk.chapterTitle !== first.chapterTitle
        || chunk.chapterOrder !== first.chapterOrder || chunk.contextManifestHash !== first.contextManifestHash
        || chunk.chunkCount !== first.chunkCount || chunk.chunkIndex !== index
      ))
    ) throw new Error('故事年表章节分块序列无效。')
    cursor += first.chunkCount
  }
  if (!sameValue([...new Set(chunks.map(chunk => chunk.chapterId))], targetChapterIds)) {
    throw new Error('故事年表目标章节与分块不一致。')
  }
  if (await hashCanonicalValue(originalTimeline) !== row.originalTimelineHash) throw new Error('故事年表基线 hash 不匹配。')
  const { planHash, ...body } = row
  if (await hashCanonicalValue(body) !== planHash) throw new Error('故事年表提取计划 hash 不匹配。')
  return { ...row, originalTimeline, targetChapterIds, chunks } as StoryTimelineExtractionPlanV1
}

function parseCandidateItems(value: unknown, plan: StoryTimelineExtractionPlanV1): StoryTimelineExtractionCandidateItemV1[] {
  if (!Array.isArray(value)) throw new Error('故事年表候选集合无效。')
  const targetChapterIds = new Set(plan.targetChapterIds)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`故事年表候选 ${index + 1} 无效。`)
    const row = item as Record<string, unknown>
    assertExactKeys(row, [
      'title', 'storyTime', 'importance', 'description', 'chapterId', 'chapterTitle',
    ], '故事年表候选 ')
    const parsed = parseStoryEventsStrictV1(JSON.stringify([{
      title: row.title,
      storyTime: row.storyTime,
      importance: row.importance,
      description: row.description,
    }]))[0]
    if (!Number.isInteger(row.chapterId) || !targetChapterIds.has(row.chapterId as number) || typeof row.chapterTitle !== 'string') {
      throw new Error(`故事年表候选 ${index + 1} 章节绑定无效。`)
    }
    const planned = plan.chunks.find(chunk => chunk.chapterId === row.chapterId)
    if (!planned || planned.chapterTitle !== row.chapterTitle) throw new Error(`故事年表候选 ${index + 1} 章节标题不匹配。`)
    return { ...parsed, chapterId: row.chapterId as number, chapterTitle: row.chapterTitle }
  })
}

function parseCallEvidence(value: unknown, index: number): StoryTimelineExtractionCallEvidenceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('故事年表调用证据无效。')
  const row = value as Record<string, unknown>
  assertExactKeys(row, ['callIndex', 'promptInputHash', 'outputHash', 'discoveredHash'], '故事年表调用证据 ')
  if (row.callIndex !== index || !isHash(row.promptInputHash) || !isHash(row.outputHash) || !isHash(row.discoveredHash)) {
    throw new Error('故事年表调用证据不完整。')
  }
  return row as unknown as StoryTimelineExtractionCallEvidenceV1
}

async function parseProgress(value: unknown): Promise<StoryTimelineExtractionProgressV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('故事年表提取进度无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'kind', 'portable', 'plan', 'nextCallIndex', 'found', 'calls', 'progressHash'], '故事年表提取进度 ')
  const plan = await parsePlan(row.plan)
  if (
    row.version !== 1 || row.kind !== 'story-timeline-extraction-progress' || row.portable !== false
    || !Number.isInteger(row.nextCallIndex) || row.nextCallIndex < 0 || row.nextCallIndex > plan.chunks.length
    || !Array.isArray(row.calls) || row.calls.length !== row.nextCallIndex || !isHash(row.progressHash)
  ) throw new Error('故事年表提取进度不完整。')
  const found = parseCandidateItems(row.found, plan)
  if (new Set(found.map(candidateKey)).size !== found.length || found.length > MAX_CANDIDATES) {
    throw new Error('故事年表提取候选重复或超限。')
  }
  const calls = row.calls.map(parseCallEvidence)
  const { progressHash, ...body } = row
  if (await hashCanonicalValue(body) !== progressHash) throw new Error('故事年表提取进度 hash 不匹配。')
  return { ...row, plan, found, calls } as StoryTimelineExtractionProgressV1
}

async function parseCandidate(value: unknown): Promise<StoryTimelineExtractionCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('故事年表候选检查点无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'kind', 'portable', 'plan', 'calls', 'events', 'candidateHash'], '故事年表候选 ')
  const plan = await parsePlan(row.plan)
  if (
    row.version !== 1 || row.kind !== 'story-timeline-extraction-candidate' || row.portable !== false
    || !Array.isArray(row.calls) || row.calls.length !== plan.chunks.length || !isHash(row.candidateHash)
  ) throw new Error('故事年表候选检查点不完整。')
  const calls = row.calls.map(parseCallEvidence)
  const events = parseCandidateItems(row.events, plan)
  if (new Set(events.map(candidateKey)).size !== events.length || events.length > MAX_CANDIDATES) {
    throw new Error('故事年表候选重复或超限。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('故事年表候选 hash 不匹配。')
  return { ...row, plan, calls, events } as StoryTimelineExtractionCandidateV1
}

async function candidateFromProgress(progress: StoryTimelineExtractionProgressV1): Promise<StoryTimelineExtractionCandidateV1> {
  if (progress.nextCallIndex !== progress.plan.chunks.length || progress.calls.length !== progress.plan.chunks.length) {
    throw new Error('故事年表提取尚未完成，不能重建候选。')
  }
  const body = {
    version: 1 as const,
    kind: 'story-timeline-extraction-candidate' as const,
    portable: false as const,
    plan: progress.plan,
    calls: progress.calls,
    events: progress.found,
  }
  return { ...body, candidateHash: await hashCanonicalValue(body) }
}

function parseFormalRow(
  value: unknown,
  chapterId: number,
  order: number,
  candidate: StoryTimelineExtractionCandidateV1,
): StoryTimelineFormalRowV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('故事年表正式行无效。')
  const row = value as Record<string, unknown>
  assertExactKeys(row, [
    'title', 'storyTime', 'importance', 'description', 'chapterId', 'chapterTitle', 'order',
  ], '故事年表正式行 ')
  const parsed = parseStoryEventsStrictV1(JSON.stringify([{
    title: row.title,
    storyTime: row.storyTime,
    importance: row.importance,
    description: row.description,
  }]))[0]
  const planned = candidate.plan.chunks.find(chunk => chunk.chapterId === chapterId)
  if (row.chapterId !== chapterId || row.order !== order || !planned || row.chapterTitle !== planned.chapterTitle) {
    throw new Error('故事年表正式行章节或顺序无效。')
  }
  return { ...parsed, chapterId, chapterTitle: row.chapterTitle as string, order }
}

async function buildFormalChapters(
  candidate: StoryTimelineExtractionCandidateV1,
  selectedIndexes: number[],
): Promise<StoryTimelineFormalChapterV1[]> {
  return Promise.all(candidate.plan.targetChapterIds.map(async chapterId => {
    const rows = selectedIndexes.map(index => candidate.events[index])
      .filter(event => event.chapterId === chapterId)
      .map((event, order) => ({
        title: event.title,
        storyTime: event.storyTime,
        importance: event.importance,
        description: event.description,
        chapterId: event.chapterId,
        chapterTitle: event.chapterTitle,
        order,
      }))
    return { chapterId, rows, rowsHash: await hashCanonicalValue(rows) }
  }))
}

async function parseAdoptionProgress(value: unknown): Promise<StoryTimelineExtractionAdoptionProgressV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('故事年表采纳进度无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, [
    'version', 'kind', 'portable', 'candidate', 'selectedIndexes', 'formalChapters',
    'nextChapterIndex', 'appliedChapterHashes', 'intentHash', 'progressHash',
  ], '故事年表采纳进度 ')
  const candidate = await parseCandidate(row.candidate)
  if (
    row.version !== 1 || row.kind !== 'story-timeline-extraction-adoption-progress' || row.portable !== false
    || !Array.isArray(row.selectedIndexes) || !Array.isArray(row.formalChapters)
    || !Number.isInteger(row.nextChapterIndex) || row.nextChapterIndex < 0
    || !Array.isArray(row.appliedChapterHashes) || !isHash(row.intentHash) || !isHash(row.progressHash)
  ) throw new Error('故事年表采纳进度不完整。')
  const selectedIndexes = row.selectedIndexes.map((index: unknown, position: number) => {
    if (
      !Number.isInteger(index) || (index as number) < 0 || (index as number) >= candidate.events.length
      || (position > 0 && Number(row.selectedIndexes[position - 1]) >= (index as number))
    ) throw new Error('故事年表采纳选择无效。')
    return index as number
  })
  const formalChapters = row.formalChapters.map((item: unknown, chapterIndex: number) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('故事年表正式章节无效。')
    const chapter = item as Record<string, any>
    assertExactKeys(chapter, ['chapterId', 'rows', 'rowsHash'], '故事年表正式章节 ')
    if (chapter.chapterId !== candidate.plan.targetChapterIds[chapterIndex] || !Array.isArray(chapter.rows) || !isHash(chapter.rowsHash)) {
      throw new Error('故事年表正式章节不完整。')
    }
    const rows = chapter.rows.map((formal: unknown, order: number) => parseFormalRow(formal, chapter.chapterId, order, candidate))
    return { chapterId: chapter.chapterId, rows, rowsHash: chapter.rowsHash } as StoryTimelineFormalChapterV1
  })
  if (
    formalChapters.length !== candidate.plan.targetChapterIds.length
    || row.nextChapterIndex > formalChapters.length
    || row.appliedChapterHashes.length !== row.nextChapterIndex
    || row.appliedChapterHashes.some((hash: unknown, index: number) => hash !== formalChapters[index].rowsHash)
  ) throw new Error('故事年表采纳章节进度无效。')
  for (const chapter of formalChapters) {
    if (await hashCanonicalValue(chapter.rows) !== chapter.rowsHash) throw new Error('故事年表正式章节 hash 不匹配。')
  }
  const expectedFormal = await buildFormalChapters(candidate, selectedIndexes)
  if (!sameValue(expectedFormal, formalChapters)) throw new Error('故事年表正式章节与冻结选择不匹配。')
  const intentBody = { candidate, selectedIndexes, formalChapters }
  if (await hashCanonicalValue(intentBody) !== row.intentHash) throw new Error('故事年表采纳意图 hash 不匹配。')
  const { progressHash, ...body } = row
  if (await hashCanonicalValue(body) !== progressHash) throw new Error('故事年表采纳进度 hash 不匹配。')
  return { ...row, candidate, selectedIndexes, formalChapters } as StoryTimelineExtractionAdoptionProgressV1
}

async function latestState(scope: WorkspaceScope, runId: number): Promise<{
  progress: StoryTimelineExtractionProgressV1 | null
  candidate: StoryTimelineExtractionCandidateV1 | null
  adoption: StoryTimelineExtractionAdoptionProgressV1 | null
}> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('故事年表提取运行缺少可验证检查点。')
  const value = checkpoint.resumePayload
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('故事年表提取检查点无效。')
  const kind = (value as Record<string, unknown>).kind
  if (kind === 'story-timeline-extraction-progress') {
    const progress = await parseProgress(value)
    const snapshot = await readAgentRunV1(scope, runId)
    const candidateHash = snapshot.projection.steps[STORY_TIMELINE_EXTRACTION_STEP_ID_V1]?.candidateHash
    if (
      snapshot.projection.state === 'awaiting_confirmation'
      && progress.nextCallIndex === progress.plan.chunks.length
      && candidateHash
    ) {
      const candidate = await candidateFromProgress(progress)
      if (candidate.candidateHash !== candidateHash) throw new Error('故事年表候选事件与完整进度不匹配。')
      return { progress: null, candidate, adoption: null }
    }
    return { progress, candidate: null, adoption: null }
  }
  if (kind === 'story-timeline-extraction-candidate') {
    return { progress: null, candidate: await parseCandidate(value), adoption: null }
  }
  if (kind === 'story-timeline-extraction-adoption-progress') {
    const adoption = await parseAdoptionProgress(value)
    return { progress: null, candidate: adoption.candidate, adoption }
  }
  throw new Error('故事年表提取检查点类型无效。')
}

async function verifyCurrentPlan(
  scope: WorkspaceScope,
  plan: StoryTimelineExtractionPlanV1,
  options: { requireTimelineBaseline: boolean } = { requireTimelineBaseline: true },
): Promise<PreparedStoryTimelineSourcesV1> {
  if (plan.projectId !== scope.projectId || plan.workId !== scope.workId) throw new Error('故事年表提取计划与当前 Work 不匹配。')
  let current: PreparedStoryTimelineSourcesV1
  try {
    current = await prepareSources(scope)
  } catch {
    throw new Error('正文、故事年表基线或提示词模板已变化，请重新提取。')
  }
  if (
    current.promptTemplateHash !== plan.promptTemplateHash
    || current.chapterSourceHash !== plan.chapterSourceHash
    || current.callCount !== plan.chunks.length
    || !sameValue(current.targetChapterIds, plan.targetChapterIds)
    || (options.requireTimelineBaseline && current.originalTimelineHash !== plan.originalTimelineHash)
  ) throw new Error('正文、故事年表基线或提示词模板已变化，请重新提取。')
  return current
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string): Promise<AgentRunSnapshotV1> {
  if (snapshot.projection.state === 'running' || snapshot.projection.state === 'awaiting_confirmation') {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

async function continueExtraction(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  progress: StoryTimelineExtractionProgressV1
  prepared: PreparedStoryTimelineSourcesV1
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: StoryTimelineExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: StoryTimelineExtractionCandidateV1 }> {
  let snapshot = input.snapshot
  let progress = input.progress
  const chunkTexts = input.prepared.chapters.flatMap(chapter => chapter.chunks)
  const chapterFound = new Map<number, StoryTimelineExtractionCandidateItemV1[]>()
  for (const event of progress.found) chapterFound.set(event.chapterId, [...(chapterFound.get(event.chapterId) ?? []), event])
  for (let callIndex = progress.nextCallIndex; callIndex < progress.plan.chunks.length; callIndex++) {
    const chunk = progress.plan.chunks[callIndex]
    const chunkText = chunkTexts[callIndex]
    if (!chunkText || await hashCanonicalValue(chunkText) !== chunk.chunkHash) {
      await pauseUnsafeRun(input.scope, snapshot, 'story-timeline-extraction-chunk-rebind-mismatch')
      throw new Error('故事年表提取分块无法重绑，Run 已暂停。')
    }
    const previousForChapter = chapterFound.get(chunk.chapterId) ?? []
    const messages = buildStoryTimelinePrompt(chunk.chapterTitle, chunkText)
    const promptInputHash = await hashCanonicalValue({
      promptTemplateHash: progress.plan.promptTemplateHash,
      chunkHash: chunk.chunkHash,
    })
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1, attempt: 1,
      bindingHash: await hashCanonicalValue({
        executionBinding: snapshot.contract.executionBindings?.[0], callIndex, promptInputHash,
      }),
    })
    let raw: string
    try {
      raw = await (input.runAI
        ? input.runAI(messages, callIndex)
        : chat(messages, input.aiConfig!, { category: 'story.timeline', projectId: input.scope.projectId }))
    } catch (error) {
      await pauseUnsafeRun(input.scope, snapshot, 'story-timeline-extraction-model-outcome-unknown')
      throw error
    }
    const outputHash = await hashCanonicalValue({ raw })
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1, attempt: 1, outputHash,
    })
    let parsed: ExtractedStoryEvent[]
    try {
      parsed = parseStoryEventsStrictV1(raw)
    } catch (error) {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1, attempt: 1,
        code: 'story-timeline-extraction-protocol-failed', retryable: false,
        category: 'protocol', action: 'fail',
      })
      await append(input.scope, snapshot, 'run.failed', {
        code: 'story-timeline-extraction-protocol-failed', retryable: false,
      })
      throw error
    }
    const bound = parsed.map(event => ({ ...event, chapterId: chunk.chapterId, chapterTitle: chunk.chapterTitle }))
    chapterFound.set(chunk.chapterId, uniqueBy([...previousForChapter, ...bound], candidateKey))
    const found = progress.plan.targetChapterIds.flatMap(chapterId => chapterFound.get(chapterId) ?? [])
    if (found.length > MAX_CANDIDATES) {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1, attempt: 1,
        code: 'story-timeline-extraction-candidate-limit', retryable: false,
        category: 'protocol', action: 'fail',
      })
      await append(input.scope, snapshot, 'run.failed', {
        code: 'story-timeline-extraction-candidate-limit', retryable: false,
      })
      throw new Error(`故事年表候选超过上限 ${MAX_CANDIDATES}。`)
    }
    const callEvidence: StoryTimelineExtractionCallEvidenceV1 = {
      callIndex, promptInputHash, outputHash, discoveredHash: await hashCanonicalValue(parsed),
    }
    const body = {
      version: 1 as const,
      kind: 'story-timeline-extraction-progress' as const,
      portable: false as const,
      plan: progress.plan,
      nextCallIndex: callIndex + 1,
      found,
      calls: [...progress.calls, callEvidence],
    }
    progress = { ...body, progressHash: await hashCanonicalValue(body) }
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: progress })
    snapshot = saved.snapshot
    await input.onDurableBoundary?.('chunk.checkpoint', snapshot, callIndex)
  }
  try {
    await verifyCurrentPlan(input.scope, progress.plan)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'story-timeline-extraction-source-stale-before-candidate')
    throw error
  }
  const candidate = await candidateFromProgress(progress)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot, progress.plan.chunks.length)
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot, progress.plan.chunks.length)
  return { snapshot, candidate }
}

export async function generateStoryTimelineExtractionCandidateV1(input: {
  scope: WorkspaceScope
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: StoryTimelineExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: StoryTimelineExtractionCandidateV1 }> {
  const prepared = await prepareSources(input.scope)
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: null,
    contract: contract(input.scope, prepared.callCount),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1, attempt: 1 })
  const created = await createPlan({ scope: input.scope, snapshot, prepared })
  snapshot = created.snapshot
  const body = {
    version: 1 as const,
    kind: 'story-timeline-extraction-progress' as const,
    portable: false as const,
    plan: created.plan,
    nextCallIndex: 0,
    found: [] as StoryTimelineExtractionCandidateItemV1[],
    calls: [] as StoryTimelineExtractionCallEvidenceV1[],
  }
  const progress = { ...body, progressHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: progress })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('plan.checkpoint', snapshot, -1)
  return continueExtraction({ ...input, snapshot, progress, prepared })
}

export async function readRecoverableStoryTimelineExtractionV1(input: {
  scope: WorkspaceScope
}): Promise<{
  snapshot: AgentRunSnapshotV1
  nextCallIndex: number
  totalCalls: number
  safeToResume: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      (row.status === 'running' || row.status === 'paused')
      && row.contractJson?.includes('prose.story-timeline-extraction')
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, row.id)
      if (!checkpoint) throw new Error('缺少故事年表提取检查点。')
      const progress = await parseProgress(checkpoint.resumePayload)
      const safeTail = checkpoint.snapshot.projection.lastSequence === checkpoint.checkpoint.throughSequence + 1
      return {
        snapshot: checkpoint.snapshot,
        nextCallIndex: progress.nextCallIndex,
        totalCalls: progress.plan.chunks.length,
        safeToResume: checkpoint.snapshot.projection.state === 'running' && safeTail,
      }
    } catch {
      return {
        snapshot,
        nextCallIndex: 0,
        totalCalls: snapshot.contract.budget.maxModelCalls,
        safeToResume: false,
      }
    }
  }
  return null
}

export async function resumeStoryTimelineExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: StoryTimelineExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: StoryTimelineExtractionCandidateV1 }> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId)
  if (!checkpoint) throw new Error('故事年表提取运行缺少可恢复检查点。')
  const progress = await parseProgress(checkpoint.resumePayload)
  if (
    checkpoint.snapshot.projection.state !== 'running'
    || checkpoint.snapshot.projection.lastSequence !== checkpoint.checkpoint.throughSequence + 1
  ) throw new Error('故事年表提取停在模型结果不可判定窗口，不会自动重试。')
  let prepared: PreparedStoryTimelineSourcesV1
  try {
    prepared = await verifyCurrentPlan(input.scope, progress.plan)
  } catch (error) {
    await pauseUnsafeRun(input.scope, checkpoint.snapshot, 'story-timeline-extraction-source-stale-before-resume')
    throw error
  }
  return continueExtraction({ ...input, snapshot: checkpoint.snapshot, progress, prepared })
}

export async function readPendingStoryTimelineExtractionCandidateV1(input: {
  scope: WorkspaceScope
}): Promise<{
  snapshot: AgentRunSnapshotV1
  candidate: StoryTimelineExtractionCandidateV1
  selectedIndexes: number[] | null
  adoptionStarted: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['awaiting_confirmation', 'running', 'verifying'].includes(row.status)
      && row.contractJson?.includes('prose.story-timeline-extraction')
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      const snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      if (state.adoption) return {
        snapshot,
        candidate: state.adoption.candidate,
        selectedIndexes: [...state.adoption.selectedIndexes],
        adoptionStarted: snapshot.projection.steps[STORY_TIMELINE_EXTRACTION_STEP_ID_V1]?.confirmation === 'adopt',
      }
      if (state.candidate) return {
        snapshot, candidate: state.candidate, selectedIndexes: null, adoptionStarted: false,
      }
    } catch {
      // Damaged historical candidates stay auditable but are not recoverable.
    }
  }
  return null
}

async function inspectAdoptionState(input: {
  scope: WorkspaceScope
  progress: StoryTimelineExtractionAdoptionProgressV1
}): Promise<{ fresh: boolean; nextAlreadyApplied: boolean; rows: StableTimelineRowV1[]; reason?: string }> {
  const current = stableTimeline(await readOwnedRows<any>(input.scope, 'storyTimelineEvents', { owner: 'work' }))
  const targetIds = new Set(input.progress.candidate.plan.targetChapterIds)
  const original = input.progress.candidate.plan.originalTimeline
  if (!exactStableRows(
    current.filter(row => !targetIds.has(row.chapterId ?? -1)),
    original.filter(row => !targetIds.has(row.chapterId ?? -1)),
  )) return { fresh: false, nextAlreadyApplied: false, rows: current, reason: 'outside-target-changed' }
  let nextAlreadyApplied = false
  for (let index = 0; index < input.progress.formalChapters.length; index++) {
    const formal = input.progress.formalChapters[index]
    const currentFormal = formalRowsFromStable(current, formal.chapterId)
    const currentStable = current.filter(row => row.chapterId === formal.chapterId)
    const originalStable = original.filter(row => row.chapterId === formal.chapterId)
    const matchesFormal = sameValue(currentFormal, formal.rows)
    const matchesOriginal = exactStableRows(currentStable, originalStable)
    if (index < input.progress.nextChapterIndex) {
      if (!matchesFormal) return { fresh: false, nextAlreadyApplied: false, rows: current, reason: `applied-chapter-${index}-changed` }
    } else if (index === input.progress.nextChapterIndex) {
      if (!matchesFormal && !matchesOriginal) {
        return { fresh: false, nextAlreadyApplied: false, rows: current, reason: `current-chapter-${index}-changed` }
      }
      nextAlreadyApplied = matchesFormal
    } else if (!matchesOriginal) {
      return { fresh: false, nextAlreadyApplied: false, rows: current, reason: `pending-chapter-${index}-changed` }
    }
  }
  return { fresh: true, nextAlreadyApplied, rows: current }
}

async function allFormalState(input: {
  scope: WorkspaceScope
  progress: StoryTimelineExtractionAdoptionProgressV1
}): Promise<{ fresh: boolean; rows: StableTimelineRowV1[] }> {
  const current = stableTimeline(await readOwnedRows<any>(input.scope, 'storyTimelineEvents', { owner: 'work' }))
  const targetIds = new Set(input.progress.candidate.plan.targetChapterIds)
  const original = input.progress.candidate.plan.originalTimeline
  const outsideFresh = exactStableRows(
    current.filter(row => !targetIds.has(row.chapterId ?? -1)),
    original.filter(row => !targetIds.has(row.chapterId ?? -1)),
  )
  const chaptersFresh = input.progress.formalChapters.every(formal => (
    sameValue(formalRowsFromStable(current, formal.chapterId), formal.rows)
  ))
  return { fresh: outsideFresh && chaptersFresh, rows: current }
}

async function saveAdoptionProgress(
  scope: WorkspaceScope,
  runId: number,
  input: Omit<StoryTimelineExtractionAdoptionProgressV1, 'progressHash'>,
): Promise<{ snapshot: AgentRunSnapshotV1; progress: StoryTimelineExtractionAdoptionProgressV1 }> {
  const progress = { ...input, progressHash: await hashCanonicalValue(input) }
  const saved = await createAgentRunCheckpointV1({ scope, runId, resumePayload: progress })
  return { snapshot: saved.snapshot, progress }
}

export async function adoptStoryTimelineExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  selectedIndexes: number[]
  onDurableBoundary?: (boundary: StoryTimelineExtractionAdoptionBoundaryV1, snapshot: AgentRunSnapshotV1, chapterIndex?: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; written: number }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  if (!candidate) throw new Error('故事年表候选不在可采纳状态。')
  const indexes = [...new Set(input.selectedIndexes)].sort((left, right) => left - right)
  if (indexes.some(index => !Number.isInteger(index) || index < 0 || index >= candidate.events.length)) {
    throw new Error('故事年表候选选择无效。')
  }
  let adoption = state.adoption
  if (adoption && !sameValue(adoption.selectedIndexes, indexes)) throw new Error('故事年表采纳选择与冻结意图不一致。')
  const step = snapshot.projection.steps[STORY_TIMELINE_EXTRACTION_STEP_ID_V1]
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && adoption) {
    let upstreamFresh = true
    try { await verifyCurrentPlan(input.scope, candidate.plan, { requireTimelineBaseline: false }) } catch { upstreamFresh = false }
    const formal = await allFormalState({ scope: input.scope, progress: adoption })
    const adoptionHash = await hashCanonicalValue({ intentHash: adoption.intentHash, formalState: formal.rows })
    if (!upstreamFresh || !formal.fresh || adoptionHash !== step?.adoptionHash) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope, runId: snapshot.run.id, reason: 'story-timeline-extraction-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'story-timeline-extraction-terminal-evidence-stale',
      })
      throw new Error('故事年表提取完成回执已过期。')
    }
    return { snapshot, receiptHash: snapshot.projection.terminalReceiptHash, written: indexes.length }
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    try { await verifyCurrentPlan(input.scope, candidate.plan) } catch (error) {
      snapshot = await append(input.scope, snapshot, 'candidate.staled', {
        stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'story-timeline-extraction-source-or-baseline-changed',
      })
      throw error
    }
    if (!adoption) {
      const formalChapters = await buildFormalChapters(candidate, indexes)
      const intentBody = { candidate, selectedIndexes: indexes, formalChapters }
      const body = {
        version: 1 as const,
        kind: 'story-timeline-extraction-adoption-progress' as const,
        portable: false as const,
        candidate,
        selectedIndexes: indexes,
        formalChapters,
        nextChapterIndex: 0,
        appliedChapterHashes: [] as string[],
        intentHash: await hashCanonicalValue(intentBody),
      }
      const saved = await saveAdoptionProgress(input.scope, snapshot.run.id, body)
      snapshot = saved.snapshot
      adoption = saved.progress
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: adoption.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (step?.confirmation !== 'adopt' || !adoption) {
    throw new Error('故事年表候选不在可恢复采纳状态。')
  }
  try { await verifyCurrentPlan(input.scope, candidate.plan, { requireTimelineBaseline: false }) } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'story-timeline-extraction-upstream-stale-during-adoption')
    throw error
  }
  while (adoption.nextChapterIndex < adoption.formalChapters.length) {
    const chapterIndex = adoption.nextChapterIndex
    const formal = adoption.formalChapters[chapterIndex]
    const inspected = await inspectAdoptionState({ scope: input.scope, progress: adoption })
    if (!inspected.fresh) {
      await pauseUnsafeRun(input.scope, snapshot, 'story-timeline-extraction-formal-state-diverged')
      throw new Error(`故事年表正式状态与冻结进度不一致：${inspected.reason ?? 'unknown'}。`)
    }
    if (!inspected.nextAlreadyApplied) {
      const result = await replaceAdoptedCollection({
        projectId: input.scope.projectId,
        workspaceScope: input.scope,
        target: 'storyTimelineEvents',
        scope: { chapterId: formal.chapterId },
        data: formal.rows.map(row => ({ ...row })),
      })
      if (result.written.length !== formal.rows.length) throw new Error('故事年表章节替换未完整写入。')
    }
    const current = stableTimeline(await readOwnedRows<any>(input.scope, 'storyTimelineEvents', { owner: 'work' }))
    if (!sameValue(formalRowsFromStable(current, formal.chapterId), formal.rows)) {
      throw new Error('故事年表章节替换后与冻结意图不一致。')
    }
    await input.onDurableBoundary?.('formal.chapter', snapshot, chapterIndex)
    const body = {
      version: 1 as const,
      kind: 'story-timeline-extraction-adoption-progress' as const,
      portable: false as const,
      candidate,
      selectedIndexes: adoption.selectedIndexes,
      formalChapters: adoption.formalChapters,
      nextChapterIndex: chapterIndex + 1,
      appliedChapterHashes: [...adoption.appliedChapterHashes, formal.rowsHash],
      intentHash: adoption.intentHash,
    }
    const saved = await saveAdoptionProgress(input.scope, snapshot.run.id, body)
    snapshot = saved.snapshot
    adoption = saved.progress
  }
  const terminal = await allFormalState({ scope: input.scope, progress: adoption })
  if (!terminal.fresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'story-timeline-extraction-formal-state-changed-before-terminal')
    throw new Error('故事年表正式状态在终验前发生变化。')
  }
  let adoptionHash = snapshot.projection.steps[STORY_TIMELINE_EXTRACTION_STEP_ID_V1]?.adoptionHash
  if (!adoptionHash) {
    adoptionHash = await hashCanonicalValue({ intentHash: adoption.intentHash, formalState: terminal.rows })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  if (snapshot.projection.steps[STORY_TIMELINE_EXTRACTION_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1, attempt: 1, outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: STORY_TIMELINE_EXTRACTION_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue(terminal.rows)
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [...new Set(candidate.plan.chunks.map(chunk => chunk.contextManifestHash))],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash,
    verifierSetVersion: STORY_TIMELINE_EXTRACTION_VERIFIER_SET_V1,
    criteria: [
      { id: 'story-timeline.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'story-timeline.author', status: 'passed', evidenceRefs: [`intent:${adoption.intentHash}`] },
      { id: 'story-timeline.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, receiptHash: receipt.receiptHash, written: indexes.length }
}

export async function abandonStoryTimelineExtractionV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  if (['completed', 'cancelled', 'failed'].includes(snapshot.projection.state)) return snapshot
  const state = await latestState(input.scope, input.runId)
  if (state.adoption && snapshot.projection.steps[STORY_TIMELINE_EXTRACTION_STEP_ID_V1]?.confirmation === 'adopt') {
    throw new Error('故事年表替换已经开始；请继续完成冻结采纳，不能留下半完成状态。')
  }
  if (snapshot.projection.state === 'awaiting_confirmation' && state.candidate) {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: STORY_TIMELINE_EXTRACTION_STEP_ID_V1,
      candidateHash: state.candidate.candidateHash,
      decision: 'reject',
    })
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-story-timeline-extraction' })
}
