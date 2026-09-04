import { chat } from '../../ai/client'
import {
  buildLocationExtractPromptFromContext,
  parseLocations,
  readLocationExtractPromptTemplateSnapshotV1,
  type ExtractedLocation,
} from '../../ai/adapters/structured-extract-adapter'
import { splitExtractionText, uniqueBy } from '../../ai/structured-extraction'
import { htmlToPlainText } from '../../utils/html'
import type { AIConfig, Chapter, ChatMessage, WorkspaceScope } from '../../types'
import { assembleContext } from '../../registry/assemble-context'
import { adopt } from '../../registry/adopt'
import { readOwnedRows } from '../../workspace/scope'
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

export const LOCATION_EXTRACTION_STEP_ID_V1 = 'world-origin:locations' as const
export const LOCATION_EXTRACTION_VERIFIER_SET_V1 = 'location-extraction-terminal-v1' as const
const MAX_MODEL_CALLS = 64
const MAX_CANDIDATES = 200

type RunAI = (messages: ChatMessage[], callIndex: number) => Promise<string>

interface StableLocationV1 {
  id: number
  name: string
  tags: string
  description: string
  significance: string
  parentId: number | null
  sortOrder: number
}

interface LocationExtractionChunkV1 {
  callIndex: number
  chapterId: number
  chapterTitle: string
  chapterOrder: number
  chunkIndex: number
  chunkCount: number
  chunkHash: string
  contextManifestHash: string
}

interface LocationExtractionPlanV1 {
  version: 1
  kind: 'location-extraction-plan'
  portable: false
  projectId: number
  workId: number
  promptTemplateHash: string
  existingContextManifestHash: string
  existingContextHash: string
  originalLocations: StableLocationV1[]
  originalLocationsHash: string
  chapterSourceHash: string
  chunks: LocationExtractionChunkV1[]
  planHash: string
}

interface LocationExtractionCallEvidenceV1 {
  callIndex: number
  promptInputHash: string
  outputHash: string
  discoveredHash: string
}

interface LocationExtractionProgressV1 {
  version: 1
  kind: 'location-extraction-progress'
  portable: false
  plan: LocationExtractionPlanV1
  nextCallIndex: number
  found: ExtractedLocation[]
  calls: LocationExtractionCallEvidenceV1[]
  progressHash: string
}

export interface LocationExtractionCandidateV1 {
  version: 1
  kind: 'location-extraction-candidate'
  portable: false
  plan: LocationExtractionPlanV1
  calls: LocationExtractionCallEvidenceV1[]
  locations: ExtractedLocation[]
  candidateHash: string
}

interface LocationExtractionFormalItemV1 extends Record<string, unknown> {
  name: string
  tags: ExtractedLocation['tags']
  description: string
  significance: string
  parentId: null
  sortOrder: number
}

interface LocationExtractionAdoptionIntentV1 {
  version: 1
  kind: 'location-extraction-adoption-intent'
  portable: false
  candidate: LocationExtractionCandidateV1
  selectedIndexes: number[]
  formalItems: LocationExtractionFormalItemV1[]
  intentHash: string
}

export type LocationExtractionBoundaryV1 =
  | 'plan.checkpoint'
  | 'chunk.checkpoint'
  | 'candidate.persisted'
  | 'candidate.checkpoint'

export type LocationExtractionAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedSourcesV1 {
  promptTemplateHash: string
  existingContext: Awaited<ReturnType<typeof assembleContext>>
  existingContextHash: string
  originalLocations: StableLocationV1[]
  originalLocationsHash: string
  chapterSourceHash: string
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

function stableLocation(row: Record<string, any>): StableLocationV1 {
  return {
    id: row.id,
    name: String(row.name ?? ''),
    tags: typeof row.tags === 'string' ? row.tags : JSON.stringify(row.tags ?? []),
    description: String(row.description ?? ''),
    significance: String(row.significance ?? ''),
    parentId: row.parentId ?? null,
    sortOrder: Number(row.sortOrder ?? 0),
  }
}

function stableLocations(rows: Record<string, any>[]): StableLocationV1[] {
  return rows.map(stableLocation).sort((left, right) => left.id - right.id)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameFormalItem(left: unknown, right: LocationExtractionFormalItemV1): boolean {
  if (!left || typeof left !== 'object' || Array.isArray(left)) return false
  const row = left as Record<string, unknown>
  return Object.keys(row).length === 6
    && Object.keys(row).every(key => ['name', 'tags', 'description', 'significance', 'parentId', 'sortOrder'].includes(key))
    && row.name === right.name
    && Array.isArray(row.tags)
    && sameValue(row.tags, right.tags)
    && row.description === right.description
    && row.significance === right.significance
    && row.parentId === null
    && row.sortOrder === right.sortOrder
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

async function prepareSources(scope: WorkspaceScope): Promise<PreparedSourcesV1> {
  const [locationRows, chapterRows, existingContext] = await Promise.all([
    readOwnedRows<any>(scope, 'importantLocations', { owner: 'world' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    assembleContext({
      projectId: scope.projectId, scope,
      sourceKeys: ['locations'], inputBudgetMaxTokens: 8_000,
    }),
  ])
  const chapters = chapterRows
    .filter(chapter => chapter.id != null && htmlToPlainText(chapter.content || '').trim().length > 50)
    .sort((left, right) => left.order - right.order || left.id! - right.id!)
  if (!chapters.length) throw new Error('还没有已写正文的章节。')
  const preparedChapters = [] as PreparedSourcesV1['chapters']
  for (const chapter of chapters) {
    const assembled = await assembleContext({
      projectId: scope.projectId, scope, chapterId: chapter.id,
      sourceKeys: ['chapterContent'], inputBudgetMaxTokens: 100_000,
    })
    if (!assembled.included.includes('chapterContent')) continue
    const chunks = splitExtractionText(assembled.text)
    if (chunks.length) preparedChapters.push({ chapter: chapter as Chapter & { id: number }, assembled, chunks })
  }
  const callCount = preparedChapters.reduce((sum, chapter) => sum + chapter.chunks.length, 0)
  if (!callCount) throw new Error('已写章节没有可提取的正文。')
  if (callCount > MAX_MODEL_CALLS) {
    throw new Error(`当前正文需要 ${callCount} 个地点提取分块，超过单次上限 ${MAX_MODEL_CALLS}。`)
  }
  const originalLocations = stableLocations(locationRows)
  const promptTemplateHash = await hashCanonicalValue(readLocationExtractPromptTemplateSnapshotV1())
  const existingContextHash = await hashCanonicalValue({
    included: existingContext.included,
    omitted: existingContext.omitted,
    trimmed: existingContext.trimmed,
    segments: existingContext.segments.map(segment => ({ label: segment.label, content: segment.content })),
  })
  const chapterSourceHash = await hashCanonicalValue(await Promise.all(preparedChapters.map(async entry => ({
    chapterId: entry.chapter.id,
    title: entry.chapter.title,
    order: entry.chapter.order,
    contentHash: await hashCanonicalValue(entry.assembled.text),
    chunkHashes: await Promise.all(entry.chunks.map(chunk => hashCanonicalValue(chunk))),
  }))))
  return {
    promptTemplateHash,
    existingContext,
    existingContextHash,
    originalLocations,
    originalLocationsHash: await hashCanonicalValue(originalLocations),
    chapterSourceHash,
    chapters: preparedChapters,
    callCount,
  }
}

async function createPlan(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  prepared: PreparedSourcesV1
}): Promise<{ snapshot: AgentRunSnapshotV1; plan: LocationExtractionPlanV1 }> {
  let snapshot = input.snapshot
  const existingManifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id, stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1,
    projectId: input.scope.projectId, worldGroupId: null,
    declaredSourceKeys: ['locations'], assembled: input.prepared.existingContext,
    readerVersion: 'location-extraction-existing-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1, manifestHash: existingManifest.manifestHash,
  })
  const chunks: LocationExtractionChunkV1[] = []
  let callIndex = 0
  for (const entry of input.prepared.chapters) {
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id, stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1,
      projectId: input.scope.projectId, worldGroupId: null,
      declaredSourceKeys: ['chapterContent'], assembled: entry.assembled,
      boundary: { chapterId: entry.chapter.id }, readerVersion: 'location-extraction-chapter-v1',
    })
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1, manifestHash: manifest.manifestHash,
    })
    for (let chunkIndex = 0; chunkIndex < entry.chunks.length; chunkIndex++) {
      const chunk = entry.chunks[chunkIndex]
      chunks.push({
        callIndex, chapterId: entry.chapter.id, chapterTitle: entry.chapter.title,
        chapterOrder: entry.chapter.order, chunkIndex, chunkCount: entry.chunks.length,
        chunkHash: await hashCanonicalValue(chunk), contextManifestHash: manifest.manifestHash,
      })
      callIndex++
    }
  }
  const body = {
    version: 1 as const, kind: 'location-extraction-plan' as const, portable: false as const,
    projectId: input.scope.projectId, workId: input.scope.workId,
    promptTemplateHash: input.prepared.promptTemplateHash,
    existingContextManifestHash: existingManifest.manifestHash,
    existingContextHash: input.prepared.existingContextHash,
    originalLocations: input.prepared.originalLocations,
    originalLocationsHash: input.prepared.originalLocationsHash,
    chapterSourceHash: input.prepared.chapterSourceHash,
    chunks,
  }
  return { snapshot, plan: { ...body, planHash: await hashCanonicalValue(body) } }
}

function contract(scope: WorkspaceScope, maxModelCalls: number) {
  const skill = getAgentSkillV1('world-origin.locations', 'world-origin')
  return {
    version: 1 as const,
    objective: '从当前作品已写正文提取可由作者确认的重要地点',
    workflowKind: 'long-running-resumable' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: {
      contextSourceKeys: ['chapterContent', 'locations'],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table, fields: [...target.fields], mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{ stepId: LOCATION_EXTRACTION_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls, maxToolCalls: 0,
      maxInputTokens: maxModelCalls * 8_000,
      maxOutputTokens: maxModelCalls * 4_000,
      maxAttemptsPerStep: 1, maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'locations.candidate', kind: 'output-present' as const, required: true },
      { id: 'locations.author', kind: 'author-confirmed' as const, required: true },
      { id: 'locations.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'locations.terminal', kind: 'terminal' as const,
      verifier: LOCATION_EXTRACTION_VERIFIER_SET_V1,
      criterionIds: ['locations.candidate', 'locations.author', 'locations.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

async function parsePlan(value: unknown): Promise<LocationExtractionPlanV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('地点提取计划检查点无效。')
  const row = value as Record<string, any>
  const keys = [
    'version', 'kind', 'portable', 'projectId', 'workId', 'promptTemplateHash',
    'existingContextManifestHash', 'existingContextHash', 'originalLocations',
    'originalLocationsHash', 'chapterSourceHash', 'chunks', 'planHash',
  ]
  assertExactKeys(row, keys, '地点提取计划 ')
  if (
    row.version !== 1 || row.kind !== 'location-extraction-plan' || row.portable !== false
    || !Number.isInteger(row.projectId) || row.projectId <= 0
    || !Number.isInteger(row.workId) || row.workId <= 0
    || !isHash(row.promptTemplateHash) || !isHash(row.existingContextManifestHash)
    || !isHash(row.existingContextHash) || !isHash(row.originalLocationsHash)
    || !isHash(row.chapterSourceHash) || !isHash(row.planHash)
    || !Array.isArray(row.originalLocations) || !Array.isArray(row.chunks)
    || row.chunks.length < 1 || row.chunks.length > MAX_MODEL_CALLS
  ) throw new Error('地点提取计划检查点不完整。')
  const originalLocations = row.originalLocations.map((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`地点原始基线 ${index + 1} 无效。`)
    const location = value as Record<string, unknown>
    assertExactKeys(location, ['id', 'name', 'tags', 'description', 'significance', 'parentId', 'sortOrder'], '地点原始基线 ')
    if (
      !Number.isInteger(location.id) || (location.id as number) <= 0
      || typeof location.name !== 'string' || !location.name.trim()
      || typeof location.tags !== 'string'
      || typeof location.description !== 'string'
      || typeof location.significance !== 'string'
      || (location.parentId !== null && !Number.isInteger(location.parentId))
      || !Number.isInteger(location.sortOrder)
    ) throw new Error(`地点原始基线 ${index + 1} 不完整。`)
    return location as unknown as StableLocationV1
  })
  if (new Set(originalLocations.map(location => location.id)).size !== originalLocations.length) {
    throw new Error('地点原始基线 ID 重复。')
  }
  const chunks = row.chunks.map((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`地点提取分块 ${index + 1} 无效。`)
    const chunk = value as Record<string, unknown>
    assertExactKeys(
      chunk,
      ['callIndex', 'chapterId', 'chapterTitle', 'chapterOrder', 'chunkIndex', 'chunkCount', 'chunkHash', 'contextManifestHash'],
      '地点提取分块 ',
    )
    if (
      chunk.callIndex !== index
      || !Number.isInteger(chunk.chapterId) || (chunk.chapterId as number) <= 0
      || typeof chunk.chapterTitle !== 'string'
      || !Number.isInteger(chunk.chapterOrder)
      || !Number.isInteger(chunk.chunkIndex) || (chunk.chunkIndex as number) < 0
      || !Number.isInteger(chunk.chunkCount) || (chunk.chunkCount as number) < 1
      || (chunk.chunkIndex as number) >= (chunk.chunkCount as number)
      || !isHash(chunk.chunkHash) || !isHash(chunk.contextManifestHash)
    ) throw new Error(`地点提取分块 ${index + 1} 不完整。`)
    return chunk as unknown as LocationExtractionChunkV1
  })
  for (let cursor = 0; cursor < chunks.length;) {
    const first = chunks[cursor]
    const group = chunks.slice(cursor, cursor + first.chunkCount)
    if (
      group.length !== first.chunkCount
      || group.some((chunk, index) => (
        chunk.chapterId !== first.chapterId
        || chunk.chapterTitle !== first.chapterTitle
        || chunk.chapterOrder !== first.chapterOrder
        || chunk.contextManifestHash !== first.contextManifestHash
        || chunk.chunkCount !== first.chunkCount
        || chunk.chunkIndex !== index
      ))
    ) throw new Error('地点提取章节分块序列无效。')
    cursor += first.chunkCount
  }
  const { planHash, ...body } = row
  if (await hashCanonicalValue(body) !== planHash) throw new Error('地点提取计划 hash 不匹配。')
  if (await hashCanonicalValue(originalLocations) !== row.originalLocationsHash) {
    throw new Error('地点提取原始基线 hash 不匹配。')
  }
  return { ...row, originalLocations, chunks } as LocationExtractionPlanV1
}

function parseCallEvidence(value: unknown, index: number): LocationExtractionCallEvidenceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('地点提取调用证据无效。')
  const row = value as Record<string, unknown>
  assertExactKeys(row, ['callIndex', 'promptInputHash', 'outputHash', 'discoveredHash'], '地点提取调用证据 ')
  if (row.callIndex !== index || !isHash(row.promptInputHash) || !isHash(row.outputHash) || !isHash(row.discoveredHash)) {
    throw new Error('地点提取调用证据不完整。')
  }
  return row as unknown as LocationExtractionCallEvidenceV1
}

async function parseProgress(value: unknown): Promise<LocationExtractionProgressV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('地点提取进度检查点无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'kind', 'portable', 'plan', 'nextCallIndex', 'found', 'calls', 'progressHash'], '地点提取进度 ')
  const plan = await parsePlan(row.plan)
  if (
    row.version !== 1 || row.kind !== 'location-extraction-progress' || row.portable !== false
    || !Number.isInteger(row.nextCallIndex) || row.nextCallIndex < 0 || row.nextCallIndex > plan.chunks.length
    || !Array.isArray(row.found) || !Array.isArray(row.calls) || !isHash(row.progressHash)
    || row.calls.length !== row.nextCallIndex
  ) throw new Error('地点提取进度检查点不完整。')
  const found = parseLocations(JSON.stringify(row.found))
  if (
    new Set(found.map(location => location.name.toLocaleLowerCase())).size !== found.length
    || found.some(location => plan.originalLocations.some(original => (
      original.name.toLocaleLowerCase() === location.name.toLocaleLowerCase()
    )))
  ) throw new Error('地点提取进度候选名称无效。')
  const calls = row.calls.map(parseCallEvidence)
  const { progressHash, ...body } = row
  if (await hashCanonicalValue(body) !== progressHash) throw new Error('地点提取进度 hash 不匹配。')
  return { ...row, plan, found, calls } as LocationExtractionProgressV1
}

async function parseCandidate(value: unknown): Promise<LocationExtractionCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('地点提取候选检查点无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'kind', 'portable', 'plan', 'calls', 'locations', 'candidateHash'], '地点提取候选 ')
  const plan = await parsePlan(row.plan)
  if (
    row.version !== 1 || row.kind !== 'location-extraction-candidate' || row.portable !== false
    || !Array.isArray(row.calls) || row.calls.length !== plan.chunks.length
    || !Array.isArray(row.locations) || !isHash(row.candidateHash)
  ) throw new Error('地点提取候选检查点不完整。')
  const calls = row.calls.map(parseCallEvidence)
  const locations = parseLocations(JSON.stringify(row.locations))
  if (new Set(locations.map(location => location.name.toLocaleLowerCase())).size !== locations.length) {
    throw new Error('地点提取候选名称重复。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('地点提取候选 hash 不匹配。')
  return { ...row, plan, calls, locations } as LocationExtractionCandidateV1
}

async function candidateFromProgress(
  progress: LocationExtractionProgressV1,
): Promise<LocationExtractionCandidateV1> {
  if (
    progress.nextCallIndex !== progress.plan.chunks.length
    || progress.calls.length !== progress.plan.chunks.length
  ) throw new Error('地点提取进度尚未完成，不能重建候选。')
  const body = {
    version: 1 as const, kind: 'location-extraction-candidate' as const, portable: false as const,
    plan: progress.plan, calls: progress.calls, locations: progress.found,
  }
  return { ...body, candidateHash: await hashCanonicalValue(body) }
}

async function latestState(scope: WorkspaceScope, runId: number): Promise<{
  progress: LocationExtractionProgressV1 | null
  candidate: LocationExtractionCandidateV1 | null
  intent: LocationExtractionAdoptionIntentV1 | null
}> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('地点提取运行缺少可验证检查点。')
  const value = checkpoint.resumePayload
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('地点提取检查点无效。')
  const kind = (value as Record<string, unknown>).kind
  if (kind === 'location-extraction-progress') {
    const progress = await parseProgress(value)
    const snapshot = await readAgentRunV1(scope, runId)
    const candidateHash = snapshot.projection.steps[LOCATION_EXTRACTION_STEP_ID_V1]?.candidateHash
    if (
      snapshot.projection.state === 'awaiting_confirmation'
      && progress.nextCallIndex === progress.plan.chunks.length
      && candidateHash
    ) {
      const candidate = await candidateFromProgress(progress)
      if (candidate.candidateHash !== candidateHash) throw new Error('地点候选事件与完整进度不匹配。')
      return { progress: null, candidate, intent: null }
    }
    return { progress, candidate: null, intent: null }
  }
  if (kind === 'location-extraction-candidate') return { progress: null, candidate: await parseCandidate(value), intent: null }
  if (kind !== 'location-extraction-adoption-intent') throw new Error('地点提取检查点类型无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'kind', 'portable', 'candidate', 'selectedIndexes', 'formalItems', 'intentHash'], '地点采纳意图 ')
  if (
    row.version !== 1 || row.portable !== false || !Array.isArray(row.selectedIndexes)
    || !Array.isArray(row.formalItems) || !isHash(row.intentHash)
  ) throw new Error('地点采纳意图不完整。')
  const candidate = await parseCandidate(row.candidate)
  if (
    row.selectedIndexes.length < 1
    || new Set(row.selectedIndexes).size !== row.selectedIndexes.length
    || row.selectedIndexes.some((index: unknown, position: number) => (
      !Number.isInteger(index) || (index as number) < 0 || (index as number) >= candidate.locations.length
      || (position > 0 && row.selectedIndexes[position - 1] >= (index as number))
    ))
    || row.formalItems.length !== row.selectedIndexes.length
  ) throw new Error('地点采纳意图选择无效。')
  const expectedFormalItems = row.selectedIndexes.map((index: number, order: number) => formalItem(
    candidate.locations[index], candidate.plan.originalLocations.length + order,
  ))
  if (!row.formalItems.every((item: unknown, index: number) => sameFormalItem(item, expectedFormalItems[index]))) {
    throw new Error('地点采纳意图正式项不匹配。')
  }
  const { intentHash, ...body } = row
  if (await hashCanonicalValue(body) !== intentHash) throw new Error('地点采纳意图 hash 不匹配。')
  return { progress: null, candidate, intent: { ...row, candidate, formalItems: expectedFormalItems } as LocationExtractionAdoptionIntentV1 }
}

async function verifyCurrentPlan(scope: WorkspaceScope, plan: LocationExtractionPlanV1): Promise<PreparedSourcesV1> {
  if (plan.projectId !== scope.projectId || plan.workId !== scope.workId) throw new Error('地点提取计划与当前 Work 不匹配。')
  let current: PreparedSourcesV1
  try {
    current = await prepareSources(scope)
  } catch {
    throw new Error('已写正文、已有地点或提示词模板已变化，请重新提取。')
  }
  if (
    current.promptTemplateHash !== plan.promptTemplateHash
    || current.existingContextHash !== plan.existingContextHash
    || current.originalLocationsHash !== plan.originalLocationsHash
    || current.chapterSourceHash !== plan.chapterSourceHash
    || current.callCount !== plan.chunks.length
  ) throw new Error('已写正文、已有地点或提示词模板已变化，请重新提取。')
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
  progress: LocationExtractionProgressV1
  prepared: PreparedSourcesV1
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: LocationExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: LocationExtractionCandidateV1 }> {
  let snapshot = input.snapshot
  let progress = input.progress
  const chunkTexts = input.prepared.chapters.flatMap(chapter => chapter.chunks)
  const existingNames = new Set(progress.plan.originalLocations.map(location => location.name.toLocaleLowerCase()))
  for (let callIndex = progress.nextCallIndex; callIndex < progress.plan.chunks.length; callIndex++) {
    const chunk = progress.plan.chunks[callIndex]
    const chunkText = chunkTexts[callIndex]
    if (!chunkText || await hashCanonicalValue(chunkText) !== chunk.chunkHash) {
      snapshot = await pauseUnsafeRun(input.scope, snapshot, 'location-extraction-chunk-rebind-mismatch')
      throw new Error('地点提取分块无法重绑，Run 已暂停。')
    }
    const discoveredNames = progress.found.map(location => location.name)
    const messages = buildLocationExtractPromptFromContext(
      chunkText, input.prepared.existingContext.text, discoveredNames,
    )
    const promptInputHash = await hashCanonicalValue({
      promptTemplateHash: progress.plan.promptTemplateHash,
      existingContextHash: progress.plan.existingContextHash,
      chunkHash: chunk.chunkHash,
      discoveredNames,
    })
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1,
      bindingHash: await hashCanonicalValue({
        executionBinding: snapshot.contract.executionBindings?.[0], callIndex, promptInputHash,
      }),
    })
    let raw: string
    try {
      raw = await (input.runAI
        ? input.runAI(messages, callIndex)
        : chat(messages, input.aiConfig!, { category: 'location.extract', projectId: input.scope.projectId }))
    } catch (error) {
      snapshot = await pauseUnsafeRun(input.scope, snapshot, 'location-extraction-model-outcome-unknown')
      throw error
    }
    const outputHash = await hashCanonicalValue({ raw })
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1, outputHash,
    })
    let parsed: ExtractedLocation[]
    try {
      parsed = parseLocations(raw)
    } catch (error) {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1,
        code: 'location-extraction-protocol-failed', retryable: false,
        category: 'protocol', action: 'fail',
      })
      await append(input.scope, snapshot, 'run.failed', { code: 'location-extraction-protocol-failed', retryable: false })
      throw error
    }
    const found = uniqueBy(
      [...progress.found, ...parsed].filter(location => !existingNames.has(location.name.toLocaleLowerCase())),
      location => location.name.toLocaleLowerCase(),
    )
    if (found.length > MAX_CANDIDATES) {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1,
        code: 'location-extraction-candidate-limit', retryable: false,
        category: 'protocol', action: 'fail',
      })
      await append(input.scope, snapshot, 'run.failed', { code: 'location-extraction-candidate-limit', retryable: false })
      throw new Error(`地点候选超过上限 ${MAX_CANDIDATES}。`)
    }
    const callEvidence: LocationExtractionCallEvidenceV1 = {
      callIndex, promptInputHash, outputHash, discoveredHash: await hashCanonicalValue(parsed),
    }
    const body = {
      version: 1 as const, kind: 'location-extraction-progress' as const, portable: false as const,
      plan: progress.plan, nextCallIndex: callIndex + 1, found, calls: [...progress.calls, callEvidence],
    }
    progress = { ...body, progressHash: await hashCanonicalValue(body) }
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: progress })
    snapshot = saved.snapshot
    await input.onDurableBoundary?.('chunk.checkpoint', snapshot, callIndex)
  }
  try {
    await verifyCurrentPlan(input.scope, progress.plan)
  } catch (error) {
    snapshot = await pauseUnsafeRun(input.scope, snapshot, 'location-extraction-source-stale-before-candidate')
    throw error
  }
  const candidate = await candidateFromProgress(progress)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1,
    candidateHash: candidate.candidateHash, requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot, progress.plan.chunks.length)
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot, progress.plan.chunks.length)
  return { snapshot, candidate }
}

export async function generateLocationExtractionCandidateV1(input: {
  scope: WorkspaceScope
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: LocationExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: LocationExtractionCandidateV1 }> {
  const prepared = await prepareSources(input.scope)
  let snapshot = await createAgentRunV1({
    scope: input.scope, worldGroupId: null,
    contract: contract(input.scope, prepared.callCount),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: LOCATION_EXTRACTION_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1 })
  const created = await createPlan({ scope: input.scope, snapshot, prepared })
  snapshot = created.snapshot
  const progressBody = {
    version: 1 as const, kind: 'location-extraction-progress' as const, portable: false as const,
    plan: created.plan, nextCallIndex: 0, found: [] as ExtractedLocation[], calls: [] as LocationExtractionCallEvidenceV1[],
  }
  const progress = { ...progressBody, progressHash: await hashCanonicalValue(progressBody) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: progress })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('plan.checkpoint', snapshot, -1)
  return continueExtraction({ ...input, snapshot, progress, prepared })
}

export async function readRecoverableLocationExtractionV1(input: {
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
      && row.contractJson?.includes('world-origin.locations')
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, row.id)
      if (!checkpoint) throw new Error('缺少地点提取检查点。')
      const progress = await parseProgress(checkpoint.resumePayload)
      const safeTail = checkpoint.snapshot.projection.lastSequence === checkpoint.checkpoint.throughSequence + 1
      return {
        snapshot: checkpoint.snapshot,
        nextCallIndex: progress.nextCallIndex,
        totalCalls: progress.plan.chunks.length,
        safeToResume: checkpoint.snapshot.projection.state === 'running' && safeTail,
      }
    } catch {
      // A crash before the first plan checkpoint is not resumable, but must remain
      // visible so the author can explicitly abandon it instead of creating orphans.
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

export async function resumeLocationExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: LocationExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: LocationExtractionCandidateV1 }> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId)
  if (!checkpoint) throw new Error('地点提取运行缺少可恢复检查点。')
  const progress = await parseProgress(checkpoint.resumePayload)
  if (
    checkpoint.snapshot.projection.state !== 'running'
    || checkpoint.snapshot.projection.lastSequence !== checkpoint.checkpoint.throughSequence + 1
  ) throw new Error('地点提取停在模型结果不可判定窗口，不会自动重试。')
  let prepared: PreparedSourcesV1
  try {
    prepared = await verifyCurrentPlan(input.scope, progress.plan)
  } catch (error) {
    await pauseUnsafeRun(input.scope, checkpoint.snapshot, 'location-extraction-source-stale-before-resume')
    throw error
  }
  return continueExtraction({ ...input, snapshot: checkpoint.snapshot, progress, prepared })
}

export async function readPendingLocationExtractionCandidateV1(input: {
  scope: WorkspaceScope
}): Promise<{
  snapshot: AgentRunSnapshotV1
  candidate: LocationExtractionCandidateV1
  selectedIndexes: number[] | null
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['awaiting_confirmation', 'running', 'verifying'].includes(row.status)
      && row.contractJson?.includes('world-origin.locations')
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      const snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      if (state.intent) return {
        snapshot, candidate: state.intent.candidate, selectedIndexes: [...state.intent.selectedIndexes],
      }
      if (state.candidate) return { snapshot, candidate: state.candidate, selectedIndexes: null }
    } catch {
      // Damaged historical candidates remain auditable but are not recoverable.
    }
  }
  return null
}

function formalItem(location: ExtractedLocation, sortOrder: number): LocationExtractionFormalItemV1 {
  return {
    name: location.name, tags: location.tags,
    description: location.description, significance: location.significance,
    parentId: null, sortOrder,
  }
}

function formalMatches(item: LocationExtractionFormalItemV1, row: Record<string, any> | undefined): boolean {
  return !!row?.id
    && row.name === item.name
    && row.tags === JSON.stringify(item.tags)
    && row.description === item.description
    && row.significance === item.significance
    && (row.parentId ?? null) === null
    && Number(row.sortOrder ?? 0) === item.sortOrder
}

function stableLocationMatches(left: StableLocationV1, right: StableLocationV1 | undefined): boolean {
  return !!right
    && left.id === right.id
    && left.name === right.name
    && left.tags === right.tags
    && left.description === right.description
    && left.significance === right.significance
    && left.parentId === right.parentId
    && left.sortOrder === right.sortOrder
}

async function adoptionFreshness(input: {
  scope: WorkspaceScope
  candidate: LocationExtractionCandidateV1
  intent?: LocationExtractionAdoptionIntentV1 | null
  requireFormalItems?: boolean
}): Promise<{
  fresh: boolean
  rows: StableLocationV1[]
  selectedRows: Array<StableLocationV1 | undefined>
}> {
  let upstreamFresh = false
  try {
    const current = await prepareSources(input.scope)
    upstreamFresh = current.promptTemplateHash === input.candidate.plan.promptTemplateHash
      && current.chapterSourceHash === input.candidate.plan.chapterSourceHash
  } catch {
    upstreamFresh = false
  }
  const rows = stableLocations(await readOwnedRows<any>(input.scope, 'importantLocations', { owner: 'world' }))
  const originalById = new Map(input.candidate.plan.originalLocations.map(location => [location.id, location]))
  const formalByName = new Map((input.intent?.formalItems ?? []).map(item => [item.name.toLocaleLowerCase(), item]))
  const originalsFresh = input.candidate.plan.originalLocations.every(original => stableLocationMatches(
    original, rows.find(row => row.id === original.id),
  ))
  const extras = rows.filter(row => !originalById.has(row.id))
  const extrasAllowed = extras.every(row => {
    const item = formalByName.get(row.name.toLocaleLowerCase())
    return !!item && formalMatches(item, row)
  })
  const selectedRows = (input.intent?.formalItems ?? []).map(item => rows.find(row => row.name === item.name))
  const formalFresh = !input.requireFormalItems
    || selectedRows.every((row, index) => formalMatches(input.intent!.formalItems[index], row))
  return { fresh: upstreamFresh && originalsFresh && extrasAllowed && formalFresh, rows, selectedRows }
}

async function assertAdoptionFresh(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: LocationExtractionCandidateV1
  intent?: LocationExtractionAdoptionIntentV1 | null
}): Promise<AgentRunSnapshotV1> {
  if ((await adoptionFreshness(input)).fresh) return input.snapshot
  if (input.snapshot.projection.state === 'awaiting_confirmation' || input.snapshot.projection.state === 'running') {
    const snapshot = await append(input.scope, input.snapshot, 'candidate.staled', {
      stepId: LOCATION_EXTRACTION_STEP_ID_V1,
      candidateHash: input.candidate.candidateHash,
      reason: 'location-extraction-source-or-location-baseline-changed',
    })
    throw Object.assign(new Error('已写正文、已有地点或候选正式状态已变化，请重新提取。'), { snapshot })
  }
  throw new Error('地点提取采纳基线已变化。')
}

export async function adoptLocationExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  selectedIndexes: number[]
  onDurableBoundary?: (boundary: LocationExtractionAdoptionBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; written: number }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate ?? state.intent?.candidate
  if (!candidate) throw new Error('地点候选不在可采纳状态。')
  let intent = state.intent
  const indexes = [...new Set(input.selectedIndexes)].sort((left, right) => left - right)
  if (!indexes.length || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= candidate.locations.length)) {
    throw new Error('请选择有效的地点候选。')
  }
  if (intent && !sameValue(intent.selectedIndexes, indexes)) throw new Error('地点采纳选择与冻结意图不一致。')
  const step = snapshot.projection.steps[LOCATION_EXTRACTION_STEP_ID_V1]
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    const freshness = await adoptionFreshness({
      scope: input.scope, candidate, intent, requireFormalItems: true,
    })
    const adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      formal: freshness.selectedRows.map(row => row ?? null),
    })
    if (!freshness.fresh || adoptionHash !== step?.adoptionHash) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope, runId: snapshot.run.id, reason: 'location-extraction-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: LOCATION_EXTRACTION_STEP_ID_V1, candidateHash: candidate.candidateHash,
        reason: 'location-extraction-terminal-evidence-stale',
      })
      throw new Error('地点提取完成回执已过期。')
    }
    return { snapshot, receiptHash: snapshot.projection.terminalReceiptHash, written: intent.formalItems.length }
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await assertAdoptionFresh({ scope: input.scope, snapshot, candidate })
    if (!intent) {
      const formalItems = indexes.map((index, order) => formalItem(
        candidate.locations[index], candidate.plan.originalLocations.length + order,
      ))
      const body = {
        version: 1 as const, kind: 'location-extraction-adoption-intent' as const, portable: false as const,
        candidate, selectedIndexes: indexes, formalItems,
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: LOCATION_EXTRACTION_STEP_ID_V1, candidateHash: candidate.candidateHash, decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: LOCATION_EXTRACTION_STEP_ID_V1, candidateHash: candidate.candidateHash, intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (step?.confirmation !== 'adopt' || !intent) {
    throw new Error('地点候选不在可恢复采纳状态。')
  }

  let adoptionHash = snapshot.projection.steps[LOCATION_EXTRACTION_STEP_ID_V1]?.adoptionHash
  if (!adoptionHash) {
    snapshot = await assertAdoptionFresh({ scope: input.scope, snapshot, candidate, intent })
    let currentRows = await readOwnedRows<any>(input.scope, 'importantLocations', { owner: 'world' })
    if (!intent.formalItems.every(item => formalMatches(item, currentRows.find(row => row.name === item.name)))) {
      const result = await adopt({
        projectId: input.scope.projectId, scope: input.scope,
        target: 'importantLocations', mode: 'add-many', data: intent.formalItems,
      })
      if (result.unknown.length || result.typeErrors.length || result.fkErrors.length || result.skipped.length) {
        throw new Error('地点采纳未完整通过注册表校验。')
      }
      currentRows = await readOwnedRows<any>(input.scope, 'importantLocations', { owner: 'world' })
    }
    const selectedRows = intent.formalItems.map(item => currentRows.find(row => row.name === item.name))
    if (selectedRows.some((row, index) => !formalMatches(intent!.formalItems[index], row))) {
      throw new Error('地点采纳后正式状态与冻结意图不一致。')
    }
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      formal: selectedRows.map(row => stableLocation(row)),
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: LOCATION_EXTRACTION_STEP_ID_V1, candidateHash: candidate.candidateHash, adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  const terminalFreshness = await adoptionFreshness({
    scope: input.scope, candidate, intent, requireFormalItems: true,
  })
  const selectedRows = terminalFreshness.selectedRows
  if (!terminalFreshness.fresh) {
    snapshot = await append(input.scope, snapshot, 'candidate.staled', {
      stepId: LOCATION_EXTRACTION_STEP_ID_V1, candidateHash: candidate.candidateHash,
      reason: 'location-extraction-source-or-formal-state-changed-before-terminal',
    })
    throw new Error('地点提取上游或正式状态在采纳后、终验前发生变化。')
  }
  if (snapshot.projection.steps[LOCATION_EXTRACTION_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: LOCATION_EXTRACTION_STEP_ID_V1, attempt: 1, outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: LOCATION_EXTRACTION_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue(selectedRows)
  const contextManifestHashes = [
    candidate.plan.existingContextManifestHash,
    ...new Set(candidate.plan.chunks.map(chunk => chunk.contextManifestHash)),
  ]
  const receipt = await createVerificationReceiptV1({
    version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes, candidateHashes: [candidate.candidateHash], adoptionEventIds: [],
    postStateHash, verifierSetVersion: LOCATION_EXTRACTION_VERIFIER_SET_V1,
    criteria: [
      { id: 'locations.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'locations.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'locations.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ], acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, receiptHash: receipt.receiptHash, written: intent.formalItems.length }
}

export async function abandonLocationExtractionV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  if (snapshot.projection.state === 'completed' || snapshot.projection.state === 'cancelled' || snapshot.projection.state === 'failed') {
    return snapshot
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    const state = await latestState(input.scope, input.runId)
    if (!state.candidate) throw new Error('地点候选检查点无效。')
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: LOCATION_EXTRACTION_STEP_ID_V1,
      candidateHash: state.candidate.candidateHash,
      decision: 'reject',
    })
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-location-extraction' })
}
