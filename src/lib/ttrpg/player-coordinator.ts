import type { AIConfig, ChatMessage, WorkspaceScope } from '../types'
import { db } from '../db/schema'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { readProductRuntimeState } from './runtime-api'
import { readTtrpgSessionParticipantsV2 } from './participants'
import {
  adoptTtrpgPlayerActionCandidateV1,
  generateTtrpgPlayerActionCandidateV1,
  type TtrpgPlayerActionCandidateV1,
} from './player-harness'

type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>

export type TtrpgAiPlayerCoordinatorResultV1 =
  | { status: 'no-active-actor' | 'gm-controlled' | 'human-controlled' | 'vacant' | 'manual-required'; actorKey: string | null }
  | { status: 'awaiting-human-confirmation'; actorKey: string; candidate: TtrpgPlayerActionCandidateV1; reused: boolean }
  | { status: 'action-committed'; actorKey: string; candidate: TtrpgPlayerActionCandidateV1; eventSequence: number; reused: boolean }

function isCandidate(value: unknown): value is TtrpgPlayerActionCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<TtrpgPlayerActionCandidateV1>
  return row.schema === 'storyforge.ttrpg-player-action-candidate' && row.version === 1
    && row.portable === false && typeof row.coordinatorKey === 'string'
    && typeof row.candidateHash === 'string' && Number.isInteger(row.runId)
}

async function reusableCandidate(input: {
  scope: WorkspaceScope
  sessionId: number
  coordinatorKey: string
}): Promise<TtrpgPlayerActionCandidateV1 | null> {
  const runs = await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).reverse().limit(24).toArray()
  for (const run of runs) {
    if (run.id == null || ['failed', 'cancelled'].includes(run.status)) continue
    try {
      const saved = await readLatestVerifiedAgentRunCheckpointV1(input.scope, run.id, { owner: 'instance' })
      if (saved && isCandidate(saved.resumePayload) && saved.resumePayload.coordinatorKey === input.coordinatorKey) {
        return saved.resumePayload
      }
    } catch {
      // A corrupt/unrelated historical run is never reused as authority.
    }
  }
  return null
}

/**
 * Resolve one active-seat epoch. This coordinator never loops on its own and
 * therefore cannot create AI self-dialogue storms; the bounded cycle below is
 * the only automatic multi-seat continuation entry.
 */
export async function coordinateTtrpgAiPlayerEpochV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
  objective?: string
  allowManualActivation?: boolean
  aiConfig?: AIConfig
  runAI?: RunAI
  signal?: AbortSignal
}): Promise<TtrpgAiPlayerCoordinatorResultV1> {
  const state = await readProductRuntimeState(input.productRuntimeSessionId)
  const actorKey = state.ttrpg?.activeActorKey ?? null
  if (!actorKey) return { status: 'no-active-actor', actorKey: null }
  const participants = await readTtrpgSessionParticipantsV2(input.productRuntimeSessionId)
  const seat = participants.find(row => row.role === 'player' && row.actorKey === actorKey)
  if (!seat) return { status: 'gm-controlled', actorKey }
  if (seat.controller === 'human') return { status: 'human-controlled', actorKey }
  if (seat.controller === 'vacant' || seat.assignmentState === 'vacant' || seat.assignmentState === 'left') {
    return { status: 'vacant', actorKey }
  }
  if (seat.activation === 'manual' && !input.allowManualActivation) return { status: 'manual-required', actorKey }
  const coordinatorKey = `ttrpg-player:${input.productRuntimeSessionId}:${state.lastSequence}:${actorKey}`
  const existing = await reusableCandidate({
    scope: input.scope, sessionId: input.productRuntimeSessionId, coordinatorKey,
  })
  const candidate = existing ?? (await generateTtrpgPlayerActionCandidateV1({
    scope: input.scope,
    productRuntimeSessionId: input.productRuntimeSessionId,
    actorKey,
    objective: input.objective?.trim() || '依据本角色目标、当前玩家可见场景和可用行动，选择一个合理且能推动游戏的角色内行动。',
    aiConfig: input.aiConfig,
    runAI: input.runAI,
    signal: input.signal,
  })).candidate
  if (candidate.controller === 'hybrid') {
    return { status: 'awaiting-human-confirmation', actorKey, candidate, reused: existing != null }
  }
  const adopted = await adoptTtrpgPlayerActionCandidateV1({ scope: input.scope, runId: candidate.runId })
  return {
    status: 'action-committed', actorKey, candidate,
    eventSequence: adopted.event.sequence, reused: existing != null,
  }
}

/**
 * Continue consecutive AI-controlled player turns, stopping at the first
 * human, hybrid confirmation, vacant seat or GM/NPC turn. The hard ceiling is
 * an operational guard, not a gameplay rule.
 */
export async function runTtrpgAiPlayerCycleV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
  maxCommittedActions?: number
  objective?: string
  aiConfig?: AIConfig
  runAI?: RunAI
  signal?: AbortSignal
}): Promise<{ decisions: TtrpgAiPlayerCoordinatorResultV1[]; committedActions: number }> {
  const maximum = input.maxCommittedActions ?? 8
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 32) {
    throw new Error('[ttrpg-player-coordinator] maxCommittedActions 必须为 1–32')
  }
  const decisions: TtrpgAiPlayerCoordinatorResultV1[] = []
  let committedActions = 0
  while (committedActions < maximum) {
    if (input.signal?.aborted) throw new DOMException('AI 玩家循环已取消', 'AbortError')
    const decision = await coordinateTtrpgAiPlayerEpochV1(input)
    decisions.push(decision)
    if (decision.status !== 'action-committed') break
    committedActions += 1
  }
  return { decisions, committedActions }
}
