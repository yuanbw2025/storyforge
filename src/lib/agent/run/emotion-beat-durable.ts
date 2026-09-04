import { db } from '../../db/schema'
import type { AIConfig, Chapter, ChatMessage, EmotionBeat, OutlineNode, WorkspaceScope } from '../../types'
import { chat } from '../../ai/client'
import { buildEmotionBeatPromptFromContext } from '../../ai/adapters/emotion-beat-adapter'
import { prepareContinuityContext } from '../../ai/chapter-memory/continuity-context'
import { assembleContext } from '../../registry/assemble-context'
import { adopt } from '../../registry/adopt'
import { assertRecordInScope, readOwnedRows } from '../../workspace/scope'
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

export const EMOTION_BEAT_STEP_ID_V1 = 'prose:emotion-beats' as const
export const EMOTION_BEAT_VERIFIER_SET_V1 = 'prose-emotion-beats-terminal-v1' as const
const SOURCE_KEYS = [
  'chapterOutline', 'detailedOutline', 'previousChapterEnding',
  'worldview', 'storyCore', 'characters', 'creativeRules',
] as const
const BEAT_KEYS = ['label', 'sceneGoal', 'emotionTone', 'readerFeeling', 'characterGrowth'] as const

export interface EmotionBeatCandidateV1 {
  version: 1
  kind: 'emotion-beat-candidate'
  portable: false
  projectId: number
  chapterId: number
  outlineNodeId: number
  worldGroupId: number | null
  chapterTitle: string
  contextManifestHash: string
  contextInputHash: string
  sourceBaselineHash: string
  baselineHash: string
  overallArc: string
  beats: EmotionBeat[]
  candidateHash: string
}

interface EmotionBeatAdoptionIntentV1 {
  version: 1
  kind: 'emotion-beat-adoption-intent'
  portable: false
  candidate: EmotionBeatCandidateV1
  intentHash: string
}

export type EmotionBeatAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

type RunAI = (messages: ChatMessage[]) => Promise<string>

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function assertExactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

function parseBeat(value: unknown, index: number): EmotionBeat {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`情感节拍 ${index + 1} 不是对象。`)
  }
  const row = value as Record<string, unknown>
  assertExactKeys(row, BEAT_KEYS, `情感节拍 ${index + 1} `)
  if (BEAT_KEYS.some(key => typeof row[key] !== 'string' || !row[key].trim())) {
    throw new Error(`情感节拍 ${index + 1} 字段必须是非空字符串。`)
  }
  return Object.fromEntries(BEAT_KEYS.map(key => [key, (row[key] as string).trim()])) as unknown as EmotionBeat
}

export function parseEmotionBeatCandidateDraftV1(output: string): Pick<EmotionBeatCandidateV1, 'overallArc' | 'beats'> {
  let source = output.trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('情感节拍模型输出不是有效 JSON。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('情感节拍模型输出必须是 JSON 对象。')
  }
  const row = parsed as Record<string, unknown>
  assertExactKeys(row, ['overallArc', 'beats'], '情感节拍候选 ')
  if (typeof row.overallArc !== 'string' || !row.overallArc.trim() || !Array.isArray(row.beats)) {
    throw new Error('情感节拍候选结构无效。')
  }
  if (row.beats.length < 3 || row.beats.length > 6) throw new Error('情感节拍数量必须为 3–6 个。')
  const beats = row.beats.map(parseBeat)
  if (new Set(beats.map(beat => beat.label)).size !== beats.length) throw new Error('情感节拍名称不得重复。')
  return { overallArc: row.overallArc.trim(), beats }
}

function storedCardBody(row: Record<string, any> | null) {
  return row ? {
    id: row.id ?? null,
    chapterId: row.chapterId,
    chapterTitle: row.chapterTitle,
    overallArc: row.overallArc,
    beats: typeof row.beats === 'string' ? row.beats : JSON.stringify(row.beats ?? []),
    source: row.source,
  } : null
}

async function baseline(scope: WorkspaceScope, chapterId: number, worldGroupId: number | null) {
  const chapter = await db.chapters.get(chapterId)
  if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('情感节拍目标章节不存在或越界。')
  }
  const outline = await db.outlineNodes.get(chapter.outlineNodeId)
  if (
    !outline || !await assertRecordInScope(scope, 'outlineNodes', outline, { owner: 'work' })
    || (outline.worldGroupId ?? null) !== worldGroupId
  ) throw new Error('情感节拍目标章纲不存在、越界或世界不匹配。')
  const card = (await readOwnedRows<any>(scope, 'emotionBeatCards', { owner: 'work' }))
    .find(row => row.chapterId === chapterId) ?? null
  const sourceBaseline = {
    chapter: { id: chapter.id, outlineNodeId: chapter.outlineNodeId, title: chapter.title },
    outline: {
      id: outline.id, title: outline.title, summary: outline.summary,
      worldGroupId: outline.worldGroupId ?? null,
    },
  }
  return {
    chapter, outline: outline as OutlineNode,
    card,
    sourceBaselineHash: await hashCanonicalValue(sourceBaseline),
    baselineHash: await hashCanonicalValue({
      ...sourceBaseline,
      card: storedCardBody(card),
    }),
  }
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: any,
) {
  return appendAgentRunEventV1({
    scope, runId: snapshot.run.id, type, payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as any)
}

async function parseCandidate(value: unknown): Promise<EmotionBeatCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('情感节拍候选检查点无效。')
  const row = value as Record<string, any>
  const keys = [
    'version', 'kind', 'portable', 'projectId', 'chapterId', 'outlineNodeId', 'worldGroupId',
    'chapterTitle', 'contextManifestHash', 'contextInputHash', 'sourceBaselineHash',
    'baselineHash', 'overallArc', 'beats', 'candidateHash',
  ]
  assertExactKeys(row, keys, '情感节拍候选 ')
  if (
    row.version !== 1 || row.kind !== 'emotion-beat-candidate' || row.portable !== false
    || !Number.isInteger(row.projectId) || !Number.isInteger(row.chapterId) || !Number.isInteger(row.outlineNodeId)
    || (row.worldGroupId !== null && !Number.isInteger(row.worldGroupId))
    || !isHash(row.contextManifestHash) || !isHash(row.contextInputHash) || !isHash(row.sourceBaselineHash)
    || !isHash(row.baselineHash) || !isHash(row.candidateHash)
  ) throw new Error('情感节拍候选检查点不完整。')
  const parsed = parseEmotionBeatCandidateDraftV1(JSON.stringify({ overallArc: row.overallArc, beats: row.beats }))
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('情感节拍候选 hash 不匹配。')
  return { ...row, ...parsed } as EmotionBeatCandidateV1
}

async function latestState(scope: WorkspaceScope, runId: number): Promise<{
  candidate: EmotionBeatCandidateV1
  intent: EmotionBeatAdoptionIntentV1 | null
}> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('情感节拍候选缺少可验证检查点。')
  const value = checkpoint.resumePayload
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'emotion-beat-adoption-intent') {
    const row = value as Record<string, any>
    assertExactKeys(row, ['version', 'kind', 'portable', 'candidate', 'intentHash'], '情感节拍采纳意图 ')
    if (row.version !== 1 || row.portable !== false || !isHash(row.intentHash)) throw new Error('情感节拍采纳意图无效。')
    const candidate = await parseCandidate(row.candidate)
    const body = { version: 1 as const, kind: 'emotion-beat-adoption-intent' as const, portable: false as const, candidate }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('情感节拍采纳意图 hash 不匹配。')
    return { candidate, intent: row as EmotionBeatAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

function contract(input: { scope: WorkspaceScope; worldGroupId: number | null; chapter: Chapter }) {
  const skill = getAgentSkillV1('prose.emotion-beats', 'prose')
  return {
    version: 1 as const,
    objective: `为章节 ${input.chapter.id} 生成可确认情感节拍卡`,
    workflowKind: 'generate-verify-revise' as const,
    scope: {
      projectId: input.scope.projectId, worldGroupId: input.worldGroupId,
      chapterIds: [input.chapter.id!], outlineNodeIds: [input.chapter.outlineNodeId],
    },
    permissions: {
      contextSourceKeys: [...SOURCE_KEYS],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table, fields: [...target.fields], mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{ stepId: EMOTION_BEAT_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 18_000, maxOutputTokens: 3_000,
      maxAttemptsPerStep: 1, maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'emotion-beats.candidate', kind: 'output-present' as const, required: true },
      { id: 'emotion-beats.author', kind: 'author-confirmed' as const, required: true },
      { id: 'emotion-beats.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'emotion-beats.terminal', kind: 'terminal' as const,
      verifier: EMOTION_BEAT_VERIFIER_SET_V1,
      criterionIds: ['emotion-beats.candidate', 'emotion-beats.author', 'emotion-beats.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function assertCandidateRunTarget(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: EmotionBeatCandidateV1,
): void {
  const target = snapshot.contract.scope
  if (
    candidate.projectId !== scope.projectId
    || target.projectId !== scope.projectId
    || target.worldGroupId !== candidate.worldGroupId
    || (snapshot.run.worldGroupId ?? null) !== candidate.worldGroupId
    || target.chapterIds?.length !== 1 || target.chapterIds[0] !== candidate.chapterId
    || target.outlineNodeIds?.length !== 1 || target.outlineNodeIds[0] !== candidate.outlineNodeId
  ) throw new Error('情感节拍候选与 Run 目标不匹配。')
}

async function assembleEmotionBeatContext(input: {
  scope: WorkspaceScope
  chapterId: number
  outlineNodeId: number
  worldGroupId: number | null
}) {
  const continuitySnapshot = await prepareContinuityContext({
    projectId: input.scope.projectId,
    chapterId: input.chapterId,
    scope: input.scope,
  })
  return assembleContext({
    projectId: input.scope.projectId, scope: input.scope, worldGroupId: input.worldGroupId,
    chapterId: input.chapterId, outlineNodeId: input.outlineNodeId,
    sourceKeys: [...SOURCE_KEYS], inputBudgetMaxTokens: 18_000,
    continuitySnapshot,
  })
}

async function contextInputHash(assembled: Awaited<ReturnType<typeof assembleEmotionBeatContext>>) {
  return hashCanonicalValue({
    included: assembled.included,
    omitted: assembled.omitted,
    trimmed: assembled.trimmed,
    segments: assembled.segments.map(segment => ({ label: segment.label, content: segment.content })),
  })
}

function formalCardMatches(candidate: EmotionBeatCandidateV1, card: Record<string, any> | null | undefined): boolean {
  return !!card?.id
    && card.chapterId === candidate.chapterId
    && card.chapterTitle === candidate.chapterTitle
    && card.overallArc === candidate.overallArc
    && card.beats === JSON.stringify(candidate.beats)
    && card.source === 'ai'
}

function assertFormalCardMatches(candidate: EmotionBeatCandidateV1, card: Record<string, any> | null | undefined): asserts card is Record<string, any> & { id: number } {
  if (!card?.id) throw new Error('情感节拍终验缺少正式卡。')
  if (!formalCardMatches(candidate, card)) throw new Error('情感节拍正式后状态与候选不一致。')
}

async function assertCandidateFreshBeforeWrite(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: EmotionBeatCandidateV1
}): Promise<AgentRunSnapshotV1> {
  const current = await baseline(input.scope, input.candidate.chapterId, input.candidate.worldGroupId)
  const currentContext = await assembleEmotionBeatContext({
    scope: input.scope,
    chapterId: input.candidate.chapterId,
    outlineNodeId: input.candidate.outlineNodeId,
    worldGroupId: input.candidate.worldGroupId,
  })
  if (
    current.baselineHash === input.candidate.baselineHash
    && await contextInputHash(currentContext) === input.candidate.contextInputHash
  ) return input.snapshot
  const snapshot = await append(input.scope, input.snapshot, 'candidate.staled', {
    stepId: EMOTION_BEAT_STEP_ID_V1,
    candidateHash: input.candidate.candidateHash,
    reason: 'emotion-beat-baseline-changed',
  })
  throw Object.assign(new Error('章节或现有情感节拍卡已变化，请重新生成。'), { snapshot })
}

async function candidateSourceIsFresh(input: {
  scope: WorkspaceScope
  candidate: EmotionBeatCandidateV1
}): Promise<boolean> {
  const current = await baseline(input.scope, input.candidate.chapterId, input.candidate.worldGroupId)
  const currentContext = await assembleEmotionBeatContext({
    scope: input.scope,
    chapterId: input.candidate.chapterId,
    outlineNodeId: input.candidate.outlineNodeId,
    worldGroupId: input.candidate.worldGroupId,
  })
  return current.sourceBaselineHash === input.candidate.sourceBaselineHash
    && await contextInputHash(currentContext) === input.candidate.contextInputHash
}

async function assertCandidateSourceFreshAfterWrite(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: EmotionBeatCandidateV1
}): Promise<AgentRunSnapshotV1> {
  if (await candidateSourceIsFresh(input)) return input.snapshot
  const snapshot = await append(input.scope, input.snapshot, 'candidate.staled', {
    stepId: EMOTION_BEAT_STEP_ID_V1,
    candidateHash: input.candidate.candidateHash,
    reason: 'emotion-beat-source-changed-after-formal-write',
  })
  throw Object.assign(new Error('正式写入后上游章节或上下文已变化，本次回执不会通过终验。'), { snapshot })
}

export async function generateEmotionBeatCandidateV1(input: {
  scope: WorkspaceScope
  chapterId: number
  worldGroupId: number | null
  aiConfig?: AIConfig
  runAI?: RunAI
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: EmotionBeatCandidateV1 }> {
  const before = await baseline(input.scope, input.chapterId, input.worldGroupId)
  let snapshot = await createAgentRunV1({
    scope: input.scope, worldGroupId: input.worldGroupId,
    contract: contract({ scope: input.scope, worldGroupId: input.worldGroupId, chapter: before.chapter }),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: EMOTION_BEAT_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: EMOTION_BEAT_STEP_ID_V1, attempt: 1 })
  try {
    const assembled = await assembleEmotionBeatContext({
      scope: input.scope, worldGroupId: input.worldGroupId,
      chapterId: input.chapterId, outlineNodeId: before.chapter.outlineNodeId,
    })
    if (!assembled.included.includes('chapterOutline')) throw new Error('当前章纲为空，不能生成情感节拍。')
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id, stepId: EMOTION_BEAT_STEP_ID_V1, attempt: 1,
      projectId: input.scope.projectId, worldGroupId: input.worldGroupId,
      declaredSourceKeys: [...SOURCE_KEYS], assembled,
      boundary: { chapterId: input.chapterId, outlineNodeId: before.chapter.outlineNodeId },
      readerVersion: 'emotion-beats-context-v1',
    })
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: EMOTION_BEAT_STEP_ID_V1, attempt: 1, manifestHash: manifest.manifestHash,
    })
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: EMOTION_BEAT_STEP_ID_V1, attempt: 1,
      bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
    })
    const raw = await (input.runAI
      ? input.runAI(buildEmotionBeatPromptFromContext(assembled.text))
      : chat(buildEmotionBeatPromptFromContext(assembled.text), input.aiConfig!, {
          category: 'emotion.beat', projectId: input.scope.projectId, contextOverflowPolicy: 'reject',
        }))
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: EMOTION_BEAT_STEP_ID_V1, attempt: 1, outputHash: await hashCanonicalValue({ raw }),
    })
    const draft = parseEmotionBeatCandidateDraftV1(raw)
    const body = {
      version: 1 as const, kind: 'emotion-beat-candidate' as const, portable: false as const,
      projectId: input.scope.projectId, chapterId: input.chapterId,
      outlineNodeId: before.chapter.outlineNodeId, worldGroupId: input.worldGroupId,
      chapterTitle: before.outline.title || before.chapter.title, contextManifestHash: manifest.manifestHash,
      contextInputHash: await contextInputHash(assembled), sourceBaselineHash: before.sourceBaselineHash,
      baselineHash: before.baselineHash, ...draft,
    }
    const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
      stepId: EMOTION_BEAT_STEP_ID_V1, attempt: 1,
      candidateHash: candidate.candidateHash, requiresConfirmation: true,
    })
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
    return { snapshot: saved.snapshot, candidate }
  } catch (error) {
    if (snapshot.projection.steps[EMOTION_BEAT_STEP_ID_V1]?.status === 'running') {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: EMOTION_BEAT_STEP_ID_V1, attempt: 1,
        code: 'emotion-beat-generation-failed', retryable: false,
        category: 'protocol', action: 'fail',
      })
    }
    if (snapshot.projection.state !== 'failed') {
      await append(input.scope, snapshot, 'run.failed', { code: 'emotion-beat-generation-failed', retryable: false })
    }
    throw error
  }
}

export async function readPendingEmotionBeatCandidateV1(input: {
  scope: WorkspaceScope
  chapterId: number
  worldGroupId: number | null
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: EmotionBeatCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['awaiting_confirmation', 'running', 'verifying'].includes(row.status)
      && (row.worldGroupId ?? null) === input.worldGroupId
      && row.contractJson?.includes('prose.emotion-beats')
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      const snapshot = await readAgentRunV1(input.scope, row.id)
      if (
        snapshot.contract.scope.chapterIds?.length !== 1
        || snapshot.contract.scope.chapterIds[0] !== input.chapterId
      ) continue
      const { candidate } = await latestState(input.scope, row.id)
      assertCandidateRunTarget(input.scope, snapshot, candidate)
      if (candidate.worldGroupId === input.worldGroupId) return { snapshot, candidate }
    } catch {
      // Damaged historical candidates remain auditable but are not recoverable.
    }
  }
  return null
}

export async function adoptEmotionBeatCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (
    boundary: EmotionBeatAdoptionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; recordId: number }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent: savedIntent } = await latestState(input.scope, input.runId)
  assertCandidateRunTarget(input.scope, snapshot, candidate)
  let intent = savedIntent
  const step = snapshot.projection.steps[EMOTION_BEAT_STEP_ID_V1]
  const completedCard = (await readOwnedRows<any>(input.scope, 'emotionBeatCards', { owner: 'work' }))
    .find(row => row.chapterId === candidate.chapterId)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    const currentAdoptionHash = completedCard?.id
      ? await hashCanonicalValue({
          intentHash: intent.intentHash, recordId: completedCard.id, card: storedCardBody(completedCard),
        })
      : null
    const sourceFresh = await candidateSourceIsFresh({ scope: input.scope, candidate })
    if (currentAdoptionHash !== step?.adoptionHash || !sourceFresh) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope, runId: snapshot.run.id,
        reason: currentAdoptionHash !== step?.adoptionHash
          ? 'emotion-beat-card-changed-after-verification'
          : 'emotion-beat-source-changed-after-verification',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: EMOTION_BEAT_STEP_ID_V1, candidateHash: candidate.candidateHash,
        reason: currentAdoptionHash !== step?.adoptionHash
          ? 'emotion-beat-card-changed-after-verification'
          : 'emotion-beat-source-changed-after-verification',
      })
      throw new Error('情感节拍完成回执已过期；正式卡或上游上下文在终验后发生变化。')
    }
    return { snapshot, receiptHash: snapshot.projection.terminalReceiptHash, recordId: completedCard!.id }
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await assertCandidateFreshBeforeWrite({ scope: input.scope, snapshot, candidate })
    if (!intent) {
      const body = {
        version: 1 as const, kind: 'emotion-beat-adoption-intent' as const,
        portable: false as const, candidate,
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: EMOTION_BEAT_STEP_ID_V1, candidateHash: candidate.candidateHash, decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: EMOTION_BEAT_STEP_ID_V1, candidateHash: candidate.candidateHash, intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (step?.confirmation !== 'adopt' || !intent) {
    throw new Error('情感节拍候选不在可恢复采纳状态。')
  }

  let adoptionHash = snapshot.projection.steps[EMOTION_BEAT_STEP_ID_V1]?.adoptionHash
  let card = (await readOwnedRows<any>(input.scope, 'emotionBeatCards', { owner: 'work' }))
    .find(row => row.chapterId === candidate.chapterId)
  if (!adoptionHash) {
    // If the process died after the formal write, reuse that exact post-state.
    // Otherwise repeat the CAS immediately before the first formal mutation so
    // a crash after adoption.started cannot write a now-stale candidate.
    if (!formalCardMatches(candidate, card)) {
      snapshot = await assertCandidateFreshBeforeWrite({ scope: input.scope, snapshot, candidate })
      const adopted = await adopt({
        projectId: input.scope.projectId, scope: input.scope,
        target: 'emotionBeatCards', mode: 'add',
        data: {
          chapterId: candidate.chapterId, chapterTitle: candidate.chapterTitle,
          overallArc: candidate.overallArc, beats: candidate.beats, source: 'ai',
        },
      })
      if (adopted.unknown.length || adopted.typeErrors.length || adopted.fkErrors.length || adopted.skipped.length) {
        throw new Error('情感节拍采纳未完整通过注册表校验。')
      }
      card = (await readOwnedRows<any>(input.scope, 'emotionBeatCards', { owner: 'work' }))
        .find(row => row.chapterId === candidate.chapterId)
      assertFormalCardMatches(candidate, card)
    }
    assertFormalCardMatches(candidate, card)
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({ intentHash: intent.intentHash, recordId: card.id, card: storedCardBody(card) })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: EMOTION_BEAT_STEP_ID_V1, candidateHash: candidate.candidateHash, adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  if (!formalCardMatches(candidate, card)) {
    snapshot = await append(input.scope, snapshot, 'candidate.staled', {
      stepId: EMOTION_BEAT_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      reason: 'emotion-beat-card-changed-before-terminal-verification',
    })
    throw Object.assign(new Error('情感节拍正式卡在采纳后、终验前发生变化。'), { snapshot })
  }
  snapshot = await assertCandidateSourceFreshAfterWrite({ scope: input.scope, snapshot, candidate })
  if (snapshot.projection.steps[EMOTION_BEAT_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: EMOTION_BEAT_STEP_ID_V1, attempt: 1, outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: EMOTION_BEAT_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  card ??= (await readOwnedRows<any>(input.scope, 'emotionBeatCards', { owner: 'work' }))
    .find(row => row.chapterId === candidate.chapterId)
  assertFormalCardMatches(candidate, card)
  const postStateHash = await hashCanonicalValue(storedCardBody(card))
  const receipt = await createVerificationReceiptV1({
    version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [candidate.contextManifestHash], candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [], postStateHash, verifierSetVersion: EMOTION_BEAT_VERIFIER_SET_V1,
    criteria: [
      { id: 'emotion-beats.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'emotion-beats.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'emotion-beats.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, receiptHash: receipt.receiptHash, recordId: card.id }
}

export async function rejectEmotionBeatCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate } = await latestState(input.scope, input.runId)
  assertCandidateRunTarget(input.scope, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation') throw new Error('情感节拍候选不在等待确认状态。')
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: EMOTION_BEAT_STEP_ID_V1, candidateHash: candidate.candidateHash, decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-emotion-beats' })
}
