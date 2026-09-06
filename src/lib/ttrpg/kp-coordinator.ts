import { ttrpgCampaignNavigationV1 } from './campaign-navigation'
import { createTtrpgViewerProjectionV1 } from './viewer-projection'
import { db } from '../db/schema'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../types'
import { loadTtrpgRuntimeContentV1 } from './runtime-content'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgDirectorAuthorityV1 } from './director-context'
import { adoptTtrpgDirectorDecisionV1, generateTtrpgDirectorDecisionV1 } from './director-harness'
import { adoptTtrpgGmNarrationCandidateV1, generateTtrpgGmNarrationCandidateV1 } from './gm-harness'
import { adoptTtrpgGmActorActionCandidateV1, generateTtrpgGmActorActionCandidateV1 } from './gm-actor-harness'
import { coordinateTtrpgAiPlayerEpochV1 } from './player-coordinator'
import { openTtrpgCampaignScene, readProductRuntimeState, readProductRuntimeStateVersion } from './runtime-api'

export type TtrpgKpPhaseV1 = 'opening' | 'directing' | 'narrating' | 'npc' | 'companion'
export interface TtrpgKpCycleResultV1 {
  status: 'human-response' | 'human-turn' | 'choice' | 'paused' | 'ended' | 'setup-required' | 'confirmation' | 'vacant' | 'budget-limit' | 'busy'
  aiActions: number
  pendingRunId?: number
}
const inFlight = new Set<number>()
async function pendingRun(scope: WorkspaceScope, sessionId: number, schema: string, baseSequence: number, kind?: string) {
  const runs = await db.agentRuns.where('productRuntimeSessionId').equals(sessionId).reverse().toArray()
  for (const run of runs) {
    if (run.id == null || ['failed', 'cancelled', 'completed'].includes(run.status)) continue
    const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, run.id, { owner: 'instance' })
    const candidate = saved?.resumePayload as { schema?: string; kind?: string; baseSequence?: number } | undefined
    if (candidate?.schema === schema && candidate.baseSequence === baseSequence && (!kind || candidate.kind === kind)) return run.id
  }
  return null
}
/** A bounded host cycle. Every decision, actor action and narration is a separately recoverable durable run. */
export async function runTtrpgKpCycleV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
  aiConfig?: AIConfig
  runAI?: (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>
  signal?: AbortSignal
  maxAiActions?: number
  stayInScene?: boolean
  onPhase?: (phase: TtrpgKpPhaseV1) => void
  onChanged?: () => void | Promise<void>
}): Promise<TtrpgKpCycleResultV1> {
  const sessionId = input.productRuntimeSessionId
  const maximum = input.maxAiActions ?? 4
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 8) throw new Error('[ttrpg-kp] 单次 AI 回合预算必须为 1～8')
  const execute = async (): Promise<TtrpgKpCycleResultV1> => {
    if (inFlight.has(sessionId)) return { status: 'busy', aiActions: 0 }
    inFlight.add(sessionId)
    let aiActions = 0
    try {
      const { campaign, rulePack } = await loadTtrpgRuntimeContentV1(input)
      const checkSignal = () => { if (input.signal?.aborted) throw new DOMException('主持已停止', 'AbortError') }
      for (let guard = 0; guard < 3 * maximum + 6; guard++) {
        checkSignal()
        const state = await readProductRuntimeState(sessionId), product = state.ttrpg!.product!
        if (product.ending) return { status: 'ended', aiActions }
        if (product.safety.status === 'paused') return { status: 'paused', aiActions }
        if (!product.sessionZero.completed) return { status: 'setup-required', aiActions }
        const participants = await readTtrpgSessionParticipantsV2(sessionId)
        const gm = assertTtrpgDirectorAuthorityV1(participants)
        const version = await readProductRuntimeStateVersion(sessionId)
        if (!state.ttrpg?.scene) {
          input.onPhase?.('opening')
          await openTtrpgCampaignScene({ sessionId, commandId: `kp.opening.${version.sequence}`, baseSequence: version.sequence,
            baseStateHash: version.stateHash, sceneKey: campaign.openingSceneKey })
          await input.onChanged?.(); continue
        }
        const latest = product.actionHistory[product.actionHistory.length - 1]
        const hasCurrentAction = latest?.receipt?.context.sceneKey === state.ttrpg.scene.sceneKey
        if (hasCurrentAction && !product.directorDecisions?.some(item => item.basisActionSequence === latest.eventSequence)) {
          input.onPhase?.('directing')
          const old = await pendingRun(input.scope, sessionId, 'storyforge.ttrpg-runtime-decision', version.sequence, 'director')
          const runId = old ?? (await generateTtrpgDirectorDecisionV1({ ...input,
            objective: '回应刚才的行动；按已满足条件揭示有用线索，给玩家明确可行的下一步，保持角色自主选择。' })).candidate.runId
          if (gm.controller === 'hybrid') return { status: 'confirmation', aiActions, pendingRunId: runId }
          checkSignal(); await adoptTtrpgDirectorDecisionV1({ scope: input.scope, runId })
          await input.onChanged?.(); continue
        }
        if (hasCurrentAction && !product.gmNarrations.some(item => item.actionSequence === latest.eventSequence)) {
          input.onPhase?.('narrating')
          const old = await pendingRun(input.scope, sessionId, 'storyforge.ttrpg-gm-candidate', version.sequence)
          const runId = old ?? (await generateTtrpgGmNarrationCandidateV1({ ...input,
            objective: '以有画面感而简洁的中文主持，回应已结算行动与刚刚公开的线索；让后果清楚可感，最后向当前真人玩家提出一个具体问题。不要罗列规则术语，不替真人决定。' })).candidate.runId
          if (gm.controller === 'hybrid') return { status: 'confirmation', aiActions, pendingRunId: runId }
          checkSignal(); await adoptTtrpgGmNarrationCandidateV1({ scope: input.scope, runId })
          await input.onChanged?.(); continue
        }
        const gmProjection = createTtrpgViewerProjectionV1({ state, campaign, rulePack, role: 'gm',
          participantControllers: Object.fromEntries(participants.filter(seat => seat.actorKey).map(seat => [seat.actorKey!, seat.controller])) })
        if (gmProjection.pendingHumanResponses.length || gmProjection.pendingEffectChoices.length) return { status: 'human-response', aiActions }
        if (ttrpgCampaignNavigationV1(state, campaign).endings.length) return { status: 'choice', aiActions }
        const decision = product.directorDecisions?.[product.directorDecisions.length - 1]
        if (decision?.sceneKey === state.ttrpg.scene.sceneKey && !input.stayInScene && ['move', 'conclude'].includes(decision.pacing)) return { status: 'choice', aiActions }
        const actorKey = state.ttrpg.activeActorKey
        const actor = campaign.characterTemplates.find(item => item.characterKey === actorKey)
        if (!actor) return { status: 'vacant', aiActions }
        const seat = participants.find(item => item.actorKey === actorKey)
        if (actor.role === 'player' && seat?.controller === 'human') return { status: 'human-turn', aiActions }
        if (seat?.controller === 'vacant' || seat?.assignmentState === 'left') return { status: 'vacant', aiActions }
        if (aiActions >= maximum) return { status: 'budget-limit', aiActions }
        if (actor.role === 'npc') {
          input.onPhase?.('npc')
          const old = await pendingRun(input.scope, sessionId, 'storyforge.ttrpg-gm-actor-action-candidate', version.sequence)
          const runId = old ?? (await generateTtrpgGmActorActionCandidateV1({ ...input,
            objective: '根据这个 NPC 自己知道的信息和目标，选择一个有意义的行动回应当前局势。行动描述只描述可见尝试，不解释秘密动机。spokenIntent 必须为 null，台词由公开叙述另行表达。' })).candidate.runId
          if (gm.controller === 'hybrid') return { status: 'confirmation', aiActions, pendingRunId: runId }
          checkSignal(); await adoptTtrpgGmActorActionCandidateV1({ scope: input.scope, runId })
        } else {
          input.onPhase?.('companion')
          const result = await coordinateTtrpgAiPlayerEpochV1({ ...input, objective: '以自己的角色目标和已知事实协助调查，主动提出有意义的行动，避免重复刚才的行动。' })
          if (result.status === 'awaiting-human-confirmation') return { status: 'confirmation', aiActions, pendingRunId: result.candidate.runId }
          if (result.status !== 'action-committed') return { status: result.status === 'human-controlled' ? 'human-turn' : 'vacant', aiActions }
        }
        aiActions++; await input.onChanged?.()
      }
      return { status: 'budget-limit', aiActions }
    } finally { inFlight.delete(sessionId) }
  }
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request(`storyforge-ttrpg-kp-${sessionId}`,
    { ifAvailable: true }, lock => lock ? execute() : Promise.resolve({ status: 'busy' as const, aiActions: 0 }))
  return execute()
}
