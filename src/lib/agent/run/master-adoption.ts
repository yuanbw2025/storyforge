import { db } from '../../db/schema'
import type { WorkspaceScope } from '../../types'
import {
  assertMasterCandidateDependenciesAdoptedV1,
  assertMasterCreativeArtifactAdoptableV1,
  adoptMasterCandidate,
  type ExecutedMasterCandidate,
} from '../orchestrator'
import { appendAgentEvent } from '../conversations'
import { scopeTransactionTables } from '../../world-engine/scope'
import {
  restoreMasterAgentCandidatesV1,
  type MasterAgentDurableCandidateV1,
} from './master-durable'
import { isMasterAgentRunWorkflowKindV1 } from '../workflow-catalog'
import {
  appendAgentRunEventV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { hashCanonicalValue } from './hash'
import { readOwnedRows } from '../../world-engine/scope'
import { adoptGeneratedOutlineItems } from '../../outline/adopt-generation'
import { parseCharacterCandidateDraft } from '../character-copilot'
import { parseOutlineCandidateDraft } from '../outline-copilot'
import { parseProseCandidateDraft } from '../prose-copilot'
import { parseInspirationCandidateDraft } from '../inspiration-copilot'
import {
  parseStoryArcCandidateDraft,
  storyArcCandidateMatchesRowV1,
} from '../story-arc-copilot'
import {
  characterDrivenCandidateMatchesPlanV1,
  parseCharacterDrivenCandidateDraftV1,
} from '../character-driven-copilot'
import {
  characterRevisionCandidateMatchesBusinessStateV1,
  repairPartialCharacterRevisionAdoptionV1,
  type CharacterRevisionCopilotSnapshotV1,
} from '../character-revision-copilot'
import {
  characterSupplementCandidateMatchesBusinessStateV1,
  type CharacterSupplementCopilotSnapshotV1,
} from '../character-supplement-copilot'
import {
  parseStoryCoreCandidateDraft,
  storyCoreCandidateMatchesRowV1,
} from '../story-core-copilot'
import {
  creativeRulesCandidateMatchesRowV1,
  parseCreativeRulesCandidateDraftV1,
} from '../creative-rules-copilot'
import {
  parseWorldviewFieldCandidateDraft,
  worldviewFieldCandidateMatchesRowV1,
} from '../worldview-field-copilot'
import { parseStorylineProgressCandidateDraftV1 } from '../storyline-progress-copilot'
import { parseInspirationVersions } from '../../inspiration/workspace'
import { plainTextToHtml } from '../../utils/html'
import {
  beginAgentRunRecoveryV1,
  completeAgentRunRecoveryV1,
} from './checkpoint'
import { appendMasterAgentImpactReportV1 } from './master-impact'
import { readFreshMasterCandidateStepReceiptV1 } from './master-step-verification'
import {
  worldGameCandidateMatchesBusinessStateV1,
  type WorldGameCopilotSnapshotV1,
} from '../world-game-copilot'

export interface MasterAgentCandidateAdoptionRefV1 {
  scope: WorkspaceScope
  runId: number
  candidateEventId: number
  runtime?: ExecutedMasterCandidate
  worldGroupId?: number | null
}

export interface MasterAgentCandidateAdoptionResultV1 {
  message: string
  adoptionHash: string
  snapshot: AgentRunSnapshotV1
}

interface ResolvedMasterCandidateV1 {
  snapshot: AgentRunSnapshotV1
  candidate: MasterAgentDurableCandidateV1
  stepId: string
}

export interface MasterAgentAdoptionDependenciesV1 {
  adopt?: typeof adoptMasterCandidate
  afterBusinessAdoption?: () => void | Promise<void>
}

async function resolveCandidate(
  input: MasterAgentCandidateAdoptionRefV1,
): Promise<ResolvedMasterCandidateV1> {
  const restored = await restoreMasterAgentCandidatesV1({ scope: input.scope, runId: input.runId })
  const candidate = restored.candidates.find(item => item.event.id === input.candidateEventId)
  if (!candidate) throw new Error('主 Agent durable 候选不存在、越界或证据已损坏')
  const stepId = candidate.payload.runStepId
  if (!stepId) throw new Error('主 Agent durable 候选缺少 runStepId')
  const step = restored.snapshot.projection.steps[stepId]
  if (!step || step.candidateHash !== candidate.payload.candidateHash) {
    throw new Error('主 Agent durable 候选与 run ledger 不一致')
  }
  if (restored.snapshot.run.conversationId !== candidate.event.conversationId) {
    throw new Error('主 Agent durable 候选与运行对话不一致')
  }
  return { snapshot: restored.snapshot, candidate, stepId }
}

function startedFor(
  snapshot: AgentRunSnapshotV1,
  stepId: string,
  candidateHash: string,
): boolean {
  return snapshot.events.some(event => (
    event.type === 'adoption.started'
    && event.payload.stepId === stepId
    && event.payload.candidateHash === candidateHash
  ))
}

async function assertRequiredSemanticReviewFresh(
  resolved: ResolvedMasterCandidateV1,
): Promise<void> {
  const policy = resolved.snapshot.contract.candidateSemanticReviewPolicy
  if (!policy?.taskIds.includes(resolved.candidate.payload.taskId)) return
  const candidateHash = resolved.candidate.payload.candidateHash!
  const receipt = await readFreshMasterCandidateStepReceiptV1({
    snapshot: resolved.snapshot,
    stepId: resolved.stepId,
    candidateHash,
    outputHash: await hashCanonicalValue(resolved.candidate.draft),
    semanticReview: resolved.candidate.payload.semanticReview,
    generator: resolved.candidate.payload.generator,
  })
  if (!receipt) {
    throw new Error('主 Agent durable 候选缺少 fresh 独立语义终验，重新执行并通过终验前不能采纳。')
  }
}

export async function beginMasterAgentCandidateAdoptionV1(
  input: MasterAgentCandidateAdoptionRefV1,
): Promise<ResolvedMasterCandidateV1> {
  const resolved = await resolveCandidate(input)
  await assertRequiredSemanticReviewFresh(resolved)
  await assertMasterCandidateDependenciesAdoptedV1(
    resolved.candidate.event,
    resolved.candidate.payload,
    input.scope,
  )
  const candidateHash = resolved.candidate.payload.candidateHash!
  const step = resolved.snapshot.projection.steps[resolved.stepId]
  if (
    step.status === 'running'
    && step.confirmation === 'adopt'
    && startedFor(resolved.snapshot, resolved.stepId, candidateHash)
  ) return resolved
  if (step.status === 'succeeded' && step.adoptionHash) return resolved
  if (step.status !== 'awaiting_confirmation') {
    throw new Error(`主 Agent durable 候选当前状态 ${step.status} 不等待作者确认`)
  }
  const conversationId = resolved.snapshot.run.conversationId
  if (conversationId == null) throw new Error('主 Agent durable run 缺少候选对话')
  const intentHash = await hashCanonicalValue({
    version: 1,
    kind: 'master-agent-adoption',
    candidateHash,
    taskId: resolved.candidate.payload.taskId,
  })
  await db.transaction(
    'rw',
    scopeTransactionTables(db.agentConversations, db.agentEvents, db.agentRuns, db.agentRunEvents),
    async () => {
      const snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.runId,
        type: 'confirmation.recorded',
        payload: {
          stepId: resolved.stepId,
          candidateHash,
          decision: 'adopt',
        },
        expectedLastSequence: resolved.snapshot.projection.lastSequence,
      })
      await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.runId,
        type: 'adoption.started',
        payload: {
          stepId: resolved.stepId,
          candidateHash,
          intentHash,
        },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
      await appendAgentEvent({
        projectId: input.scope.projectId,
        conversationId,
        kind: 'confirmation',
        content: '作者已确认采纳领域 Agent 候选。',
        payload: {
          version: 1,
          runId: input.runId,
          candidateEventId: input.candidateEventId,
          decision: 'adopted',
        },
        scope: input.scope,
      })
    },
  )
  return resolveCandidate(input)
}

export async function commitMasterAgentCandidateAdoptionV1(
  input: MasterAgentCandidateAdoptionRefV1,
  dependencies: MasterAgentAdoptionDependenciesV1 = {},
): Promise<MasterAgentCandidateAdoptionResultV1> {
  let resolved = await resolveCandidate(input)
  assertMasterCreativeArtifactAdoptableV1(resolved.candidate.payload)
  let step = resolved.snapshot.projection.steps[resolved.stepId]
  if (step.status === 'succeeded' && step.adoptionHash) {
    return {
      message: '候选已经完成采纳。',
      adoptionHash: step.adoptionHash,
      snapshot: resolved.snapshot,
    }
  }
  if (step.status === 'awaiting_confirmation') {
    resolved = await beginMasterAgentCandidateAdoptionV1(input)
    step = resolved.snapshot.projection.steps[resolved.stepId]
  }
  if (
    step.status !== 'running'
    || step.confirmation !== 'adopt'
  ) throw new Error('主 Agent durable 候选尚未进入可提交采纳状态')

  if (!startedFor(resolved.snapshot, resolved.stepId, resolved.candidate.payload.candidateHash!)) {
    await appendAgentRunEventV1({
      scope: input.scope,
      runId: input.runId,
      type: 'adoption.started',
      payload: {
        stepId: resolved.stepId,
        candidateHash: resolved.candidate.payload.candidateHash!,
        intentHash: await hashCanonicalValue({
          version: 1,
          kind: 'master-agent-adoption',
          candidateHash: resolved.candidate.payload.candidateHash,
          taskId: resolved.candidate.payload.taskId,
        }),
      },
    })
    resolved = await resolveCandidate(input)
    step = resolved.snapshot.projection.steps[resolved.stepId]
  }

  await assertRequiredSemanticReviewFresh(resolved)
  const adopt = dependencies.adopt ?? adoptMasterCandidate
  const message = await adopt({
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId: resolved.snapshot.run.worldGroupId ?? null,
    event: resolved.candidate.event,
    payload: resolved.candidate.payload,
    draft: resolved.candidate.draft,
    runtime: input.runtime,
  })
  await dependencies.afterBusinessAdoption?.()
  const adoptionHash = await hashCanonicalValue({
    version: 1,
    candidateHash: resolved.candidate.payload.candidateHash,
    evidence: {
      agentId: resolved.candidate.payload.agentId,
      candidateEventId: input.candidateEventId,
      message,
    },
  })
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  step = snapshot.projection.steps[resolved.stepId]
  await db.transaction(
    'rw',
    scopeTransactionTables(db.agentRuns, db.agentRunEvents),
    async () => {
      snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.runId,
        type: 'adoption.committed',
        payload: {
          stepId: resolved.stepId,
          candidateHash: resolved.candidate.payload.candidateHash!,
          adoptionHash,
        },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
      snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.runId,
        type: 'step.succeeded',
        payload: {
          stepId: resolved.stepId,
          attempt: step.attempt,
          outputHash: resolved.candidate.payload.candidateHash!,
        },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
    },
  )
  try {
    await appendMasterAgentImpactReportV1({
      scope: input.scope,
      snapshot,
      candidate: resolved.candidate,
    })
  } catch (error) {
    const conversationId = snapshot.run.conversationId
    if (conversationId != null) {
      await appendAgentEvent({
        projectId: input.scope.projectId,
        conversationId,
        kind: 'error',
        role: 'system',
        content: `采纳已完成，但影响分析未能生成：${error instanceof Error ? error.message : String(error)}`,
        payload: {
          version: 1,
          kind: 'master-agent-impact-error',
          runId: input.runId,
          stepId: resolved.stepId,
        },
        scope: input.scope,
      })
    }
  }
  return { message, adoptionHash, snapshot }
}

export async function rejectMasterAgentCandidateV1(
  input: MasterAgentCandidateAdoptionRefV1,
  reason = '作者拒绝了领域 Agent 候选，没有写入项目。',
): Promise<AgentRunSnapshotV1> {
  const resolved = await resolveCandidate(input)
  const step = resolved.snapshot.projection.steps[resolved.stepId]
  if (step.status === 'failed' && step.confirmation === 'reject') return resolved.snapshot
  if (step.status !== 'awaiting_confirmation') {
    throw new Error(`主 Agent durable 候选当前状态 ${step.status} 不能拒绝`)
  }
  const conversationId = resolved.snapshot.run.conversationId
  if (conversationId == null) throw new Error('主 Agent durable run 缺少候选对话')
  let snapshot = resolved.snapshot
  await db.transaction(
    'rw',
    scopeTransactionTables(db.agentConversations, db.agentEvents, db.agentRuns, db.agentRunEvents),
    async () => {
      snapshot = await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.runId,
        type: 'confirmation.recorded',
        payload: {
          stepId: resolved.stepId,
          candidateHash: resolved.candidate.payload.candidateHash!,
          decision: 'reject',
        },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
      await appendAgentEvent({
        projectId: input.scope.projectId,
        conversationId,
        kind: 'confirmation',
        content: reason.trim().slice(0, 1_000) || '作者拒绝了领域 Agent 候选。',
        payload: {
          version: 1,
          runId: input.runId,
          candidateEventId: input.candidateEventId,
          decision: 'rejected',
        },
        scope: input.scope,
      })
    },
  )
  return snapshot
}

function normalized(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

async function businessAlreadyMatches(
  input: MasterAgentCandidateAdoptionRefV1,
  candidate: MasterAgentDurableCandidateV1,
): Promise<boolean> {
  const agentId = candidate.payload.agentId
  if (agentId === 'world-origin') {
    if (candidate.payload.skillId === 'world-origin.worldview-field') {
      const parsed = parseWorldviewFieldCandidateDraft(candidate.draft)
      const rows = await readOwnedRows<any>(input.scope, 'worldviews', { owner: 'world' })
      const row = rows.find(item => (
        (item.worldGroupId ?? null) === (input.worldGroupId ?? null)
      )) ?? (input.worldGroupId == null ? rows[0] : undefined)
      return parsed.field === candidate.payload.worldviewField
        && worldviewFieldCandidateMatchesRowV1(parsed, row)
    }
    if (candidate.payload.skillId === 'world-origin.story-core') {
      const parsed = parseStoryCoreCandidateDraft(candidate.draft)
      const row = (await readOwnedRows<any>(input.scope, 'storyCores', { owner: 'work' }))[0]
      return parsed.field === candidate.payload.storyCoreField
        && storyCoreCandidateMatchesRowV1(parsed, row)
    }
    if (candidate.payload.skillId === 'world-origin.creative-rules') {
      const parsed = parseCreativeRulesCandidateDraftV1(candidate.draft)
      const row = (await readOwnedRows<any>(input.scope, 'creativeRules', { owner: 'work' }))[0]
      return parsed.field === candidate.payload.creativeRulesField
        && creativeRulesCandidateMatchesRowV1(parsed, row)
    }
    const rows = await readOwnedRows<any>(input.scope, 'worldviews', { owner: 'world' })
    const row = rows.find(item => (item.worldGroupId ?? null) === (input.worldGroupId ?? null))
    return (row?.worldOrigin ?? '') === candidate.draft.trim()
  }
  if (agentId === 'character') {
    if (candidate.payload.skillId === 'character.supplement') {
      return characterSupplementCandidateMatchesBusinessStateV1({
        scope: input.scope,
        snapshot: candidate.payload.baseSnapshot as CharacterSupplementCopilotSnapshotV1,
        draft: candidate.draft,
      })
    }
    const parsed = parseCharacterCandidateDraft(candidate.draft)
    const rows = await readOwnedRows<any>(input.scope, 'characters', { owner: 'world' })
    return rows.some(row => (
      normalized(row.name ?? '') === normalized(parsed.name)
      // adopt() intentionally omits empty-string fields to avoid erasing
      // existing values. Treat an omitted empty candidate field as equivalent
      // to the canonical empty value during terminal verification.
      && Object.entries(parsed).every(([field, value]) => (
        value === '' ? (row[field] ?? '') === '' : row[field] === value
      ))
      && row.isCrossWorld !== true
    ))
  }
  if (agentId === 'inspiration') {
    const mode = candidate.payload.mode ?? 'single'
    const expected = parseInspirationCandidateDraft(candidate.draft, mode)
    const rows = await readOwnedRows<any>(input.scope, 'inspirationWorkspaces', { owner: 'work' })
    const versions = parseInspirationVersions(rows[0]?.versions)
    const expectedHash = await hashCanonicalValue(expected)
    for (const version of versions) {
      try {
        if (version.mode === mode && await hashCanonicalValue(JSON.parse(version.resultJson)) === expectedHash) return true
      } catch {
        // Ignore malformed historical versions and continue checking later versions.
      }
    }
    return false
  }
  if (agentId === 'outline') {
    if (candidate.payload.skillId === 'outline.world-game') {
      return worldGameCandidateMatchesBusinessStateV1({
        scope: input.scope,
        snapshot: candidate.payload.baseSnapshot as WorldGameCopilotSnapshotV1,
        draft: candidate.draft,
      })
    }
    if (candidate.payload.skillId === 'outline.character-revision') {
      return characterRevisionCandidateMatchesBusinessStateV1({
        scope: input.scope,
        snapshot: candidate.payload.baseSnapshot as CharacterRevisionCopilotSnapshotV1,
        draft: candidate.draft,
      })
    }
    if (candidate.payload.skillId === 'outline.character-driven') {
      const planId = candidate.payload.characterDrivenPlanId
      if (planId == null) return false
      const expected = parseCharacterDrivenCandidateDraftV1(candidate.draft)
      const plan = (await readOwnedRows<any>(
        input.scope,
        'characterDrivenPlans',
        { owner: 'work' },
      )).find(row => row.id === planId)
      return characterDrivenCandidateMatchesPlanV1(expected, plan)
    }
    if (candidate.payload.skillId === 'outline.story-arcs') {
      const expected = parseStoryArcCandidateDraft(candidate.draft)
      const rows = await readOwnedRows<any>(input.scope, 'storyArcs', { owner: 'work' })
      return expected.every(item => rows.some(row => storyArcCandidateMatchesRowV1(item, row)))
    }
    if (candidate.payload.skillId === 'outline.storyline-progress') {
      const expected = parseStorylineProgressCandidateDraftV1(candidate.draft)
      if (expected.progress.length + expected.crossings.length + expected.newArcs.length === 0) return false
      const chapterId = candidate.payload.storylineProgressChapterId
      if (chapterId == null) return false
      const progressRows = await readOwnedRows<any>(input.scope, 'storylineProgress', { owner: 'work' })
      const crossingRows = await readOwnedRows<any>(input.scope, 'storylineCrossings', { owner: 'work' })
      const arcRows = await readOwnedRows<any>(input.scope, 'storyArcs', { owner: 'work' })
      const progressMatch = expected.progress.every(item => progressRows.some(row => (
        row.arcId === item.arcId
        && row.status === item.status
        && (row.currentStageId ?? null) === (item.currentStageId ?? null)
        && row.progressNote === item.progressNote
        && row.lastActiveChapterId === chapterId
        && row.evidenceQuote === item.evidenceQuote
      )))
      const crossingMatch = expected.crossings.every(item => crossingRows.some(row => (
        row.arcIdA === Math.min(item.arcIdA, item.arcIdB)
        && row.arcIdB === Math.max(item.arcIdA, item.arcIdB)
        && row.chapterId === chapterId
        && row.note === item.note
        && row.evidenceQuote === item.evidenceQuote
      )))
      const newArcMatch = expected.newArcs.every(item => arcRows.some(row => (
        normalized(row.name ?? '') === normalized(item.name)
        && row.type === item.arcType
        && row.description === item.description
      )))
      return progressMatch && crossingMatch && newArcMatch
    }
    const items = parseOutlineCandidateDraft(candidate.draft)
    const mode = candidate.payload.outlineMode
    if (!mode) return false
    const parentId = mode === 'volumes' ? null : (candidate.payload.outlineParentId ?? null)
    const type = mode === 'volumes' ? 'volume' : 'chapter'
    const startingOrder = (candidate.payload.baseSnapshot as { startingOrder?: unknown } | null)?.startingOrder
    if (typeof startingOrder !== 'number' || !Number.isInteger(startingOrder) || startingOrder < 0) {
      return false
    }
    const rows = await readOwnedRows<any>(input.scope, 'outlineNodes', { owner: 'work' })
    return items.every((item, index) => rows.some(row => (
      row.type === type
      && (row.parentId ?? null) === parentId
      && row.order === startingOrder + index
      && normalized(row.title ?? '') === normalized(item.title)
      && row.summary === item.summary
    )))
  }
  const text = parseProseCandidateDraft(candidate.draft)
  const outlineNodeId = candidate.payload.proseOutlineNodeId
  if (outlineNodeId == null) return false
  const chapter = (await readOwnedRows<any>(input.scope, 'chapters', { owner: 'work' }))
    .find(row => row.outlineNodeId === outlineNodeId)
  if (!chapter) return false
  const fragment = plainTextToHtml(text)
  return candidate.payload.proseOperation === 'continue'
    ? String(chapter.content ?? '').endsWith(fragment)
    : chapter.content === fragment
}

export async function isMasterAgentCandidateBusinessStateMatchingV1(
  input: MasterAgentCandidateAdoptionRefV1,
  candidate: MasterAgentDurableCandidateV1,
): Promise<boolean> {
  return businessAlreadyMatches(input, candidate)
}

async function repairPartialOutlineAdoption(
  input: MasterAgentCandidateAdoptionRefV1,
  candidate: MasterAgentDurableCandidateV1,
): Promise<void> {
  if (candidate.payload.agentId !== 'outline') return
  if (candidate.payload.skillId === 'outline.character-revision') {
    await repairPartialCharacterRevisionAdoptionV1({
      projectId: input.scope.projectId,
      scope: input.scope,
      snapshot: candidate.payload.baseSnapshot as CharacterRevisionCopilotSnapshotV1,
      draft: candidate.draft,
    })
    return
  }
    if (
      candidate.payload.skillId === 'outline.world-game'
      || candidate.payload.skillId === 'outline.story-arcs'
      || candidate.payload.skillId === 'outline.storyline-progress'
      || candidate.payload.skillId === 'outline.character-driven'
    ) return
  const mode = candidate.payload.outlineMode
  if (!mode) throw new Error('大纲候选缺少写回模式')
  const items = parseOutlineCandidateDraft(candidate.draft)
  const parentId = mode === 'volumes' ? null : (candidate.payload.outlineParentId ?? null)
  const type = mode === 'volumes' ? 'volume' as const : 'chapter' as const
  const base = candidate.payload.baseSnapshot as { startingOrder?: number }
  const startingOrder = typeof base.startingOrder === 'number'
    && Number.isInteger(base.startingOrder)
    && base.startingOrder >= 0
    ? base.startingOrder
    : (() => { throw new Error('大纲候选缺少可恢复的 startingOrder') })()
  const rows = await readOwnedRows<any>(input.scope, 'outlineNodes', { owner: 'work' })
  for (const [index, item] of items.entries()) {
    const exact = rows.some(row => (
      row.type === type
      && (row.parentId ?? null) === parentId
      && row.order === startingOrder + index
      && normalized(row.title ?? '') === normalized(item.title)
      && row.summary === item.summary
    ))
    if (exact) continue
    const conflicting = rows.some(row => (
      row.type === type
      && (row.parentId ?? null) === parentId
      && row.order === startingOrder + index
      && normalized(row.title ?? '') !== normalized(item.title)
    ))
    if (conflicting) throw new Error('大纲部分采纳遇到已占用的目标顺序，已停止恢复')
    const result = await adoptGeneratedOutlineItems({
      projectId: input.scope.projectId,
      workspaceScope: input.scope,
      worldGroupId: input.worldGroupId,
      parentId,
      type,
      items: [item],
      startingOrder: startingOrder + index,
    })
    if (result.writtenCount !== 1 || result.skippedReasons.length > 0) {
      throw new Error('大纲部分采纳未能补齐缺项')
    }
    rows.push({
      type,
      parentId,
      order: startingOrder + index,
      title: item.title,
      summary: item.summary,
    })
  }
}

export interface MasterAgentAdoptionRecoveryResultV1 {
  recoveredRunIds: number[]
  failed: Array<{ runId: number; reason: string }>
}

/** Completes adoption.started runs after a host interruption without re-running generation. */
export async function recoverPendingMasterAgentAdoptionsV1(
  scope: WorkspaceScope,
): Promise<MasterAgentAdoptionRecoveryResultV1> {
  const result: MasterAgentAdoptionRecoveryResultV1 = { recoveredRunIds: [], failed: [] }
  const runs = (await readOwnedRows<any>(scope, 'agentRuns', { owner: 'work' }))
    .filter(run => run.id != null && run.conversationId != null && ['running', 'paused'].includes(run.status))
  for (const run of runs) {
    try {
      const restored = await restoreMasterAgentCandidatesV1({ scope, runId: run.id })
      if (!isMasterAgentRunWorkflowKindV1(restored.snapshot.contract.workflowKind)) continue
      let snapshot = restored.snapshot
      if (snapshot.projection.state === 'paused') {
        const recovery = await beginAgentRunRecoveryV1({
          scope,
          runId: run.id,
          expectedLastSequence: snapshot.projection.lastSequence,
        })
        snapshot = await completeAgentRunRecoveryV1({
          scope,
          runId: run.id,
          checkpointHash: recovery.checkpointHash,
          expectedLastSequence: recovery.snapshot.projection.lastSequence,
        })
      }
      const pending = restored.candidates.find(candidate => {
        const step = snapshot.projection.steps[candidate.payload.runStepId!]
        return step?.confirmation === 'adopt'
          && step.status === 'running'
          && !step.adoptionHash
          && startedFor(snapshot, candidate.payload.runStepId!, candidate.payload.candidateHash!)
      })
      if (!pending) continue
      const ref = {
        scope,
        runId: run.id,
        candidateEventId: pending.event.id!,
        worldGroupId: snapshot.run.worldGroupId ?? null,
      }
      await repairPartialOutlineAdoption(ref, pending)
      if (!await businessAlreadyMatches(ref, pending)) {
        await commitMasterAgentCandidateAdoptionV1(ref)
      } else {
        const current = await readAgentRunV1(scope, run.id)
        const step = current.projection.steps[pending.payload.runStepId!]
        const adoptionHash = await hashCanonicalValue({
          version: 1,
          candidateHash: pending.payload.candidateHash,
          evidence: { recovered: true, candidateEventId: pending.event.id },
        })
        const committed = await appendAgentRunEventV1({
          scope,
          runId: run.id,
          type: 'adoption.committed',
          payload: {
            stepId: pending.payload.runStepId!,
            candidateHash: pending.payload.candidateHash!,
            adoptionHash,
          },
          expectedLastSequence: current.projection.lastSequence,
        })
        await appendAgentRunEventV1({
          scope,
          runId: run.id,
          type: 'step.succeeded',
          payload: {
            stepId: pending.payload.runStepId!,
            attempt: step.attempt,
            outputHash: pending.payload.candidateHash!,
          },
          expectedLastSequence: committed.projection.lastSequence,
        })
      }
      result.recoveredRunIds.push(run.id)
    } catch (error) {
      result.failed.push({ runId: run.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}
