import { readTtrpgOpenModelCallRunsV1 } from './open-model-call-evidence'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { TTRPG_OPEN_MODEL_PURPOSES_V1 } from './open-model-purpose-contract'
/** One explicit, bounded hosting continuation. Durable owners remain the only state machine. */
import type { AIConfig, WorkspaceScope } from '../types'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { assertTtrpgOpenAuthorizationCurrentV1 } from './open-authorization'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgOpenHostingDelegationV1, assertTtrpgOpenHostingRequestV1 } from './open-hosting-delegation'
import { ttrpgOpenCallBudgetV1 } from './open-model-calls'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { evaluateTtrpgOpenHandoffV1 } from './open-handoff'
import { previewTtrpgOpenCompanionPermissionV1 } from './open-companion-preauthorization'
import { isTtrpgOpenModelNarrationReceiptV1 } from './open-kp-receipt'
import { reconcileTtrpgOpenKpRunV1 } from './open-kp-adoption'
import { resumeTtrpgOpenPlayV1 } from './open-play-coordinator'
import { startTtrpgOpenDelegatedCompanionOperationV1, preauthorizeTtrpgOpenCompanionV1,
  acceptTtrpgOpenDelegatedKpNarrationV1, ttrpgOpenOperationCommandIdV1 } from './runtime-commands'
import { executeTtrpgOpenCompanionRequestV1, executeTtrpgOpenKpRequestV1,
  generateTtrpgOpenCompanionCandidateV1, generateTtrpgOpenKpCandidateV1,
  recoverTtrpgOpenRuntimeCandidateV1 } from './open-intent-harness'

export interface TtrpgOpenHostingInputV1 {
  scope: WorkspaceScope; sessionId: number; viewerKey: string; epochKey: string; hostingDelegationRef: TtrpgOpenSourceRefV1
  aiConfig?: AIConfig; runAI?: Parameters<typeof executeTtrpgOpenCompanionRequestV1>[0]['runAI']; signal?: AbortSignal
}
export interface TtrpgOpenHostingResultV1 {
  status: 'handoff'
  reason: 'stopped' | 'paused' | 'awaiting-result' | 'model-recovery' | 'needs-human' | 'candidate-review' | 'budget' | 'stage-closed' | 'human' | 'yield'
  operationKey?: string; requestKey?: string; detail?: string
}
const handoff = (reason: TtrpgOpenHostingResultV1['reason'], extra: Omit<TtrpgOpenHostingResultV1, 'status' | 'reason'> = {}): TtrpgOpenHostingResultV1 => ({ status: 'handoff', reason, ...extra })
async function envelope(sessionId: number, label: string) {
  const head = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, commandId: `open.hosting.${label}.${crypto.randomUUID()}`, baseSequence: head.sequence, baseStateHash: head.stateHash }
}

export async function resumeTtrpgOpenHostingV1(input: TtrpgOpenHostingInputV1): Promise<TtrpgOpenHostingResultV1> {
  input = { ...input, scope: { ...input.scope }, hostingDelegationRef: { ...input.hostingDelegationRef },
    ...(input.aiConfig ? { aiConfig: { ...input.aiConfig } } : {}) }
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  const content = source.runtimePackage.ttrpg
  if (session.kind !== 'ttrpg' || source.runtimeSourceHash !== session.runtimeSourceHash || !content || !isTtrpgRuntimeContentV2(content)
    || !content.campaign.runtimePolicy.enabled) throw new Error('[ttrpg-hosting] 本冒险没有有效的冻结 AI 主持来源')
  const frozenContent = content
  try {
  for (let iteration = 0; iteration < 64; iteration++) {
    if (input.signal?.aborted) return handoff('stopped')
    const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun
    const epoch = run?.coordination.epochs.find(e => e.epochKey === input.epochKey)
    if (!runtime || !run || !runtime.authorization || !epoch || epoch.viewerKey !== input.viewerKey
      || !epoch.hostingDelegation || stable(epoch.hostingDelegation.sourceRef) !== stable(input.hostingDelegationRef)) throw new Error('[ttrpg-hosting] 不是本轮真实委托')
    if (epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || epoch.hostingDelegation.stoppedRef) return handoff('stopped')
    if (runtime.product.safety.status !== 'active') return handoff('paused')
    assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization,
      participants: await readTtrpgSessionParticipantsV2(input.sessionId), viewerKey: input.viewerKey })
    assertTtrpgOpenHostingDelegationV1(state, { epochKey: epoch.epochKey, viewerKey: input.viewerKey, delegationRef: input.hostingDelegationRef })
    const runs = await readTtrpgOpenModelCallRunsV1({ ...input, calls: run.coordination.calls })
    const ownedCalls = run.coordination.calls.filter(c => c.authorizationEpochKey === epoch.epochKey
      && stable(c.hostingDelegationRef) === stable(input.hostingDelegationRef))
    const readInput = (call: typeof ownedCalls[number]) => {
      const owner = runs.find(r => r.contractHash === call.runContractHash)
      if (!owner?.id) throw new Error('[ttrpg-hosting] 原请求运行证据缺失，不能创建替代请求')
      return { scope: input.scope, sessionId: input.sessionId, viewerKey: input.viewerKey, runId: owner.id, requestKey: call.requestKey }
    }
    const repair = run.narrations?.find(row => isTtrpgOpenModelNarrationReceiptV1(row)
      && stable(row.hostingDelegationRef) === stable(input.hostingDelegationRef)
      && runs.find(r => r.contractHash === row.runContractHash)?.status !== 'completed')
    if (repair && isTtrpgOpenModelNarrationReceiptV1(repair)) {
      const call = ownedCalls.find(c => c.requestKey === repair.requestKey)
      if (!call) throw new Error('[ttrpg-hosting] 已提交叙述缺少原委托请求')
      await reconcileTtrpgOpenKpRunV1({ ...readInput(call), candidateHash: repair.candidateHash }); continue
    }
    const budget = ttrpgOpenCallBudgetV1(epoch, run.coordination.calls)
    if (budget.blockedByUnknown || budget.blockedByDenial || ownedCalls.some(c => c.status === 'failed')) return handoff('model-recovery')
    const pending = run.coordination.calls.find(c => c.authorizationEpochKey === epoch.epochKey && ['prepared', 'dispatched'].includes(c.status))
    if (pending) {
      if (pending.status === 'dispatched') return handoff('awaiting-result', { requestKey: pending.requestKey })
      if (!ownedCalls.includes(pending) || !['prose.ttrpg-open-companion', 'prose.ttrpg-open-kp'].includes(pending.skillId)) return handoff('needs-human', { requestKey: pending.requestKey })
      const original = { ...readInput(pending), aiConfig: input.aiConfig, runAI: input.runAI, signal: input.signal }
      if (pending.skillId === 'prose.ttrpg-open-kp') await executeTtrpgOpenKpRequestV1(original)
      else await executeTtrpgOpenCompanionRequestV1(original)
      continue
    }
    const operation = run.operations.find(o => o.authorizationEpochKey === epoch.epochKey && ['awaiting-approval', 'executing'].includes(o.status))
    const outstanding = ownedCalls.find(c => c.status === 'succeeded'
      && !run.operations.some(o => o.intentEvidence?.runContractHash === c.runContractHash)
      && !run.narrations?.some(n => isTtrpgOpenModelNarrationReceiptV1(n) && n.requestKey === c.requestKey))
    if (outstanding) {
      if (outstanding.intentRejection) return handoff('needs-human', { requestKey: outstanding.requestKey })
      const original = readInput(outstanding), candidate = await recoverTtrpgOpenRuntimeCandidateV1(original)
      if (!candidate || !['ready', 'usable-with-warnings'].includes(candidate.artifact.status)) return handoff('candidate-review', { requestKey: outstanding.requestKey })
      if (input.signal?.aborted) return handoff('stopped')
      const accepted = { ...await envelope(input.sessionId, 'candidate'), ...original, candidateHash: candidate.candidateHash, hostingDelegationRef: input.hostingDelegationRef }
      if (candidate.schema === 'storyforge.ttrpg-open-kp-candidate') {
        if (!operation || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'narration') return handoff('needs-human', { requestKey: outstanding.requestKey })
        await acceptTtrpgOpenDelegatedKpNarrationV1({ ...accepted, operationKey: operation.operationKey, frozenPlanHash: operation.planHash,
          commandId: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, 'narration') })
      } else if (candidate.schema === 'storyforge.ttrpg-open-intent-candidate' && candidate.intent && !operation) {
        // Mechanical routing can require clarification/parameters. Retain that candidate for a human, without trying another model.
        try { await startTtrpgOpenDelegatedCompanionOperationV1(accepted) }
        catch (error) { return handoff('needs-human', { requestKey: outstanding.requestKey, detail: error instanceof Error ? error.message : String(error) }) }
      } else return handoff('needs-human', { requestKey: outstanding.requestKey })
      continue
    }
    if (operation) {
      const operationInput = { sessionId: input.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash,
        viewerKey: input.viewerKey, hostingDelegationRef: input.hostingDelegationRef }
      if (operation.status === 'awaiting-approval') {
        const call = ownedCalls.find(c => c.runContractHash === operation.intentEvidence?.runContractHash)
        if (!call || stable(operation.intentEvidence?.hostingDelegationRef) !== stable(input.hostingDelegationRef)) return handoff('needs-human', { operationKey: operation.operationKey })
        const candidate = await recoverTtrpgOpenRuntimeCandidateV1(readInput(call))
        if (candidate?.schema !== 'storyforge.ttrpg-open-intent-candidate' || !candidate.intent) return handoff('candidate-review', { operationKey: operation.operationKey })
        try { previewTtrpgOpenCompanionPermissionV1(state, frozenContent, candidate.intent, operation.operationKey) }
        catch (error) { return handoff('needs-human', { operationKey: operation.operationKey, detail: error instanceof Error ? error.message : String(error) }) }
        await preauthorizeTtrpgOpenCompanionV1({ ...await envelope(input.sessionId, 'safe-action'), ...operationInput,
          ...readInput(call), candidateHash: candidate.candidateHash,
          commandId: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, 'preauthorization') })
        continue
      }
      const settled = await resumeTtrpgOpenPlayV1(operationInput)
      if (settled.status === 'completed') continue
      if (settled.status !== 'awaiting-narration') return handoff(settled.status === 'paused' ? 'paused' : 'needs-human', { operationKey: operation.operationKey, detail: settled.status })
      const waiting = await generate('kp', 'gm'); if (waiting) return waiting
      continue
    }
    if (run.stage.status !== 'open') return handoff('stage-closed')
    const last = run.operations.filter(o => o.authorizationEpochKey === epoch.epochKey).slice(-1)[0]
    if (!last || last.status !== 'completed') return handoff('human')
    const next = evaluateTtrpgOpenHandoffV1(state, last.operationKey)
    if (next.kind !== 'companion-ready' || !next.actorKey) return handoff(next.kind === 'budget' ? 'budget' : next.kind === 'model-recovery' ? 'model-recovery' : next.kind === 'paused' ? 'paused' : 'human')
    const waiting = await generate('companion', next.actorKey); if (waiting) return waiting

    async function generate(purpose: 'companion' | 'kp', actorKey: string): Promise<TtrpgOpenHostingResultV1 | null> {
      const unfinished = run!.coordination.calls.find(c => c.authorizationEpochKey === epoch!.epochKey && c.status === 'succeeded'
        && !run!.operations.some(o => o.intentEvidence?.runContractHash === c.runContractHash)
        && !run!.narrations?.some(n => isTtrpgOpenModelNarrationReceiptV1(n) && n.requestKey === c.requestKey))
      if (unfinished) return handoff('needs-human', { requestKey: unfinished.requestKey })
      if (budget.countedRequests >= epoch!.budget.maximumCalls || budget.committedOrReservedTokens >= epoch!.budget.maximumTokens
        || budget.committedOrReservedCostUsd + epoch!.hostingDelegation!.maximumCostUsdPerCall > epoch!.budget.maximumCostUsd) return handoff('budget')
      const fresh = await readProductRuntimeState(input.sessionId)
      assertTtrpgOpenHostingRequestV1(fresh, { epochKey: input.epochKey, viewerKey: input.viewerKey,
        delegationRef: input.hostingDelegationRef, purpose: purpose === 'kp' ? 'kp-narration' : 'companion', actorKey,
        maximumCostUsd: epoch!.hostingDelegation!.maximumCostUsdPerCall })
      if (input.signal?.aborted) return handoff('stopped')
      const request = { ...await envelope(input.sessionId, purpose), scope: input.scope, viewerKey: input.viewerKey,
        rawInput: '只依据自己本轮实际已知资料，提出一次协作行动。', maximumOutputTokens: Math.min(frozenContent.campaign.runtimePolicy.maximumOutputTokens,
          getAgentSkillV1(TTRPG_OPEN_MODEL_PURPOSES_V1[purpose === 'kp' ? 'kp-narration' : purpose].skillId).maxOutputTokens),
        maximumCostUsd: epoch!.hostingDelegation!.maximumCostUsdPerCall, hostingDelegationRef: input.hostingDelegationRef,
        aiConfig: input.aiConfig, runAI: input.runAI, signal: input.signal }
      if (purpose === 'kp') await generateTtrpgOpenKpCandidateV1(request)
      else await generateTtrpgOpenCompanionCandidateV1({ ...request, actorKey })
      return null
    }
  }
  return handoff('yield', { detail: '本次已到有限推进上限，进度已保存；请明确继续。' })
  } catch (error) {
    const latest = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
    const original = latest?.openRun?.coordination.epochs.find(e => e.epochKey === input.epochKey)
    if (original?.viewerKey === input.viewerKey && stable(original.hostingDelegation?.sourceRef) === stable(input.hostingDelegationRef)) {
      if (original.hostingDelegation?.stoppedRef || original.status !== 'active') return handoff('stopped')
      if (latest?.product.safety.status !== 'active') return handoff('paused')
    }
    throw error
  }
}
