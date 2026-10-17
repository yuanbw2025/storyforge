import { ttrpgOpenEntityParameterAllowedV1 } from './open-entity-catalog'
import { verifyTtrpgOpenEntityStateV1 } from './open-entity-proof'
import { ttrpgOpenSituationCatalogV1, ttrpgOpenSessionSituationActorAccessV1 } from './open-session-situation-catalog'
import { finishTtrpgOpenSituationDraftV1, readTtrpgOpenSituationStopRepairsV1 } from './open-generated-situation-stop'
import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'
import { listTtrpgOpenHistoricalResponsesV1, readTtrpgOpenHistoricalResponseV1 } from './open-imported-response'
import { readTtrpgOpenModelCallRunsV1 } from './open-model-call-evidence'
import { projectTtrpgOpenContextInspectionV1 } from './open-context-inspection'
import { createTtrpgOpenHostingDelegationV1 } from './open-hosting-delegation'
import { resumeTtrpgOpenHostingV1, type TtrpgOpenHostingInputV1 } from './open-hosting-coordinator'
import { delegateTtrpgOpenHostingV1, stopTtrpgOpenHostingV1, disposeTtrpgOpenIntentV1 } from './runtime-commands'
import { parseTtrpgOpenTableMessageRequestV1,type TtrpgOpenTableMessageRequestV1 } from './open-table-conversation'
import { postTtrpgOpenTableMessageV1 } from './runtime-commands'
import { ttrpgOpenTurnCycleMatchesV1 } from './open-turn-settlement'
import { buildTtrpgOpenManualCatalogV1 } from './open-manual-catalog'
import { verifyTtrpgOpenManualEpochsV1,verifyTtrpgOpenManualAuthorizationV1 } from './open-manual-action'
import { parseTtrpgOpenRuleRequestV1,type TtrpgOpenRuleRequestV1 } from './open-rule-plan'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { prepareTtrpgOpenPrivateChoiceDisclosureV1,discloseTtrpgOpenPrivateChoiceV1 } from './runtime-commands'
import { currentTtrpgOpenPrivateChoiceV1,verifyTtrpgOpenPrivateChoiceHashesV1 } from './open-private-choice'
import { ttrpgOpenDiscoveryEffectTemplatesV1 } from './open-discovery-effect-templates'
import { reconcileTtrpgOpenKpRunV1 } from './open-kp-adoption'
import { cancelTtrpgOpenPreparedRequestV1 } from './open-request-cancellation'
import { reconcileTtrpgOpenHumanNarrationV1, readTtrpgOpenHumanNarrationRepairKeysV1 } from './open-human-narration-recovery'
import { isTtrpgOpenModelNarrationReceiptV1 } from './open-kp-receipt'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { projectTtrpgOpenTableRiskV1, describeTtrpgOpenHumanEffectV1 } from './open-table-risk'
import { currentTtrpgOpenPressureEffectReviewV1, ttrpgOpenPressureEffectDefinitionV1, ttrpgOpenPressureEffectReviewCurrentV1, type TtrpgOpenPressureEffectRequestV1 } from './open-pressure-effect'
import { assertTtrpgOpenPressureGmV1, sameTtrpgOpenPressureSourceV1, ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle'
import { evaluateTtrpgOpenTerminalV1 } from './open-terminal-gates'
import { ttrpgOpenGateBasisJsonV1, ttrpgOpenGateHumanActorsV1 } from './open-terminal-gates'
import { chooseTtrpgOpenGateRecoveryV1 } from './open-gate-recovery'
import { ttrpgOpenSituationEffectWorkV1 } from './open-situation-cycle'
/** Player desk adapter: real scoped APIs, sanitized read model and durable candidates. */
import { rejectTtrpgOpenIntentCandidateV1 } from './open-intent-disposition'
import { db } from '../db/schema'
import type { WorkspaceScope, AIConfig } from '../types'
import { evaluateTtrpgPredicateV1 } from './predicate'
import { ttrpgOpenSituationGateContextV1 } from './open-situation-runtime'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { stableProductRuntimeJsonV1 } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenSessionSituationHashesV1 } from './open-session-situation-proof'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { readTtrpgSessionParticipantsV2, configureTtrpgSessionParticipantV2 } from './participants'
import { assertTtrpgOpenAuthorizationCurrentV1 } from './open-authorization'
import { loadTtrpgOpenHumanViewV1 } from './open-player-context'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { ttrpgOpenScopedKeyV1 } from './open-coordination'
import { previewTtrpgOpenCompanionPermissionV1 } from './open-companion-preauthorization'
import { ttrpgOpenCallBudgetV1 } from './open-model-calls'
import { readTtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
import { readTtrpgOpenKpCandidateV1 } from './open-kp-candidate'
import { assertTtrpgOpenModelActorV1 } from './open-model-purpose'
import { recoverTtrpgOpenRuntimeCandidateV1, generateTtrpgOpenIntentCandidateV1, generateTtrpgOpenCompanionCandidateV1, generateTtrpgOpenKpCandidateV1 } from './open-intent-harness'
import { completeTtrpgOpenSessionZeroV1, startTtrpgOpenRunV1, changeTtrpgSituationV1, changeTtrpgSafetyStatus, recordTtrpgOpenHumanNarrationV1, startTtrpgOpenEpochV1,
  startTtrpgOpenIntentCandidateOperationV1, startTtrpgOpenOperationV1, closeTtrpgOpenEpochV1, confirmTtrpgOpenOperationV1, preauthorizeTtrpgOpenCompanionV1,
  ttrpgOpenOperationCommandIdV1, acceptTtrpgOpenKpNarrationV1, selectTtrpgOpenOperationEffectV1, selectTtrpgOpenDiscoveryEffectV1,
  prepareTtrpgOpenPressureEffectV1, readTtrpgOpenPressureEffectApprovalViewV1, proposeTtrpgOpenPressureEffectV1, confirmTtrpgOpenPressureEffectV1, closeTtrpgOpenStageV1, recoverTtrpgOpenOperationGatesV1 } from './runtime-commands'
import { resumeTtrpgOpenPlayV1 } from './open-play-coordinator'
export type TtrpgOpenTableInputV1 = { scope: WorkspaceScope; sessionId: number; viewerKey: string }
type TableSource = Awaited<ReturnType<typeof humanTable>>
function tablePrivateChoiceReviewsV1(f: TableSource) {
  const op = f.runtime.openRun?.operations.find(o => o.status === 'executing'),run = f.runtime.openRun
  if (!op || !run || op.plan.rollVisibility === 'public') return []
  try { assertTtrpgOpenHumanHostV1(f.runtime.authorization!,f.seat.viewerKey) } catch { return [] }
  const next = nextTtrpgOpenOperationStepV1(op)?.kind,receipt = run.ruleReceipts.find(r => r.operationKey === op.operationKey)
  const templates = next === 'effect' && op.pendingChoice?.selectedAlternativeKey === null
    ? op.plan.effectTemplates.filter(t => t.planKey === op.pendingChoice!.templateKey)
    : next === 'knowledge' && receipt ? ttrpgOpenDiscoveryEffectTemplatesV1(op,receipt).filter(t => t.alternatives.length && !op.discoveryChoices?.some(c => c.templateKey === t.planKey)) : []
  return templates.map(t => ({ operationKey: op.operationKey,kind: next as 'effect' | 'knowledge',templateKey: t.planKey,
    disclosed: Boolean(currentTtrpgOpenPrivateChoiceV1({ state: f.state,runtime: f.runtime,operation: op,kind: next as 'effect' | 'knowledge',templateKey: t.planKey })) }))
}
function tableGateRecoveryV1(f: TableSource) {
  const run = f.runtime.openRun, op = run?.operations.find(o => o.status === 'executing')
  if (!run || !op || run.stage.status !== 'open' || nextTtrpgOpenOperationStepV1(op)?.kind !== 'gates') return null
  const attempt = run.gateRecoveries?.find(r => r.operationKey === op.operationKey && r.authorizationEpochKey === op.authorizationEpochKey)
  if (attempt?.stoppedRef) return { status: 'stopped' as const,canAttempt: false,proof: null,needsAuthorReview: run.gateReceipts?.some(r => r.viewerKey === f.seat.viewerKey && attempt.failedEvaluationRefs.some(ref => sameTtrpgOpenPressureSourceV1(ref,r.sourceRef)) && r.result.requestAuthorReview.length > 0) ?? false }
  const basis = ttrpgOpenGateBasisJsonV1(f.state), rule = run.ruleReceipts.find(r => r.operationKey === op.operationKey)!
  if (!ttrpgOpenGateHumanActorsV1(f.runtime).every(h => run.gateReceipts?.some(r => r.actorKey === h.actorKey && r.viewerKey === h.viewerKey && r.authorizationEpochKey === op.authorizationEpochKey && sameTtrpgOpenPressureSourceV1(r.ruleSourceRef,ttrpgOpenPressureRuleSourceV1(rule)) && r.evaluationBasisJson === basis))) return null
  const selected = chooseTtrpgOpenGateRecoveryV1(f.state,op.operationKey)
  if (!selected) return null
  let host = false;try { assertTtrpgOpenHumanHostV1(f.runtime.authorization!,f.seat.viewerKey);host = true } catch { /* The recipient can request their own permitted hint. */ }
  const allowed = selected.evaluation.viewerKey === f.seat.viewerKey || selected.gateKey !== 'hypothesis-formable' && host
  return { status: attempt ? 'attempted' as const : 'awaiting' as const,canAttempt: !attempt && allowed && f.runtime.product.safety.status === 'active',
    proof: !attempt && allowed ? { evaluationRef: selected.evaluation.sourceRef,evaluationBasisHash: selected.evaluation.result.evaluationBasisHash!,gateKey: selected.gateKey,actorKey: selected.evaluation.actorKey } : null,
    needsAuthorReview: selected.evaluation.viewerKey === f.seat.viewerKey && selected.evaluation.result.requestAuthorReview.length > 0 }
}
export type TtrpgOpenTableConsequenceInputV1 = TtrpgOpenTableInputV1 & { operationKey: string; owner: 'pressure' | 'situations' | 'stage'; cycleKey: string; workKey: string }
function locateTableConsequenceV1(f: TableSource) {
  const run = f.runtime.openRun, operation = run?.operations.find(o => o.status === 'executing'), rule = run?.ruleReceipts.find(r => r.operationKey === operation?.operationKey)
  if (!run || !operation || !rule) return null
  const source = ttrpgOpenPressureRuleSourceV1(rule), step = nextTtrpgOpenOperationStepV1(operation)?.kind
  if (step === 'pressure') {
    const cycle = run.pressureCycles?.find(c => !c.completedRef && ttrpgOpenTurnCycleMatchesV1(c,operation,source,'pressure')), work = cycle?.work.find(w => !w.completedRef)
    if (cycle && work?.templateKey && !work.situationTemplateKey) return { owner: 'pressure' as const, operation, cycle, work }
  }
  if (step === 'situations') {
    const cycle = run.situationCycles?.find(c => !c.completedRef && ttrpgOpenTurnCycleMatchesV1(c,operation,source,'situations')), actual = cycle?.work.find(w => !w.completedRef)
    if (cycle && actual?.kind === 'effect') return { owner: 'situations' as const, operation, cycle, work: ttrpgOpenSituationEffectWorkV1(actual) }
  }
  if (step === 'gates' && run.stage.status === 'closed') {
    const cycle = run.stageClosures?.find(c => !c.completedRef && sameTtrpgOpenPressureSourceV1(c.ruleSourceRef, source)), work = cycle?.work.find(w => !w.completedRef)
    if (cycle && work) return { owner: 'stage' as const, operation, cycle, work }
  }
  return null
}
function tableConsequenceLinesV1(f: TableSource, effects: import('../types').TtrpgEffectPrimitiveV2[], host: boolean) {
  const results = effects.map(effect => describeTtrpgOpenHumanEffectV1({ state: f.state, rules: f.runtime.openRun!.operations.find(o => o.status === 'executing')!.plan.rulePack, actorKey: f.seat.actorKey!, effect, bindings: {}, host,
    name: ref => ref && (host || ref === f.seat.actorKey || ref === f.state.entities[f.seat.actorKey!]?.locationKey || f.content.campaign.entityBindings.some(b => b.bindingKey === ref && (b.audience === 'public' || b.audience === 'party' || b.audience === 'private' && b.knownByActorKeys.includes(f.seat.actorKey!)))) ? f.state.entities[ref]?.name ?? null : null }))
  return { lines: results.map(r => r.text), reviewable: results.every(r => r.reviewable) }
}
async function tableConsequence(input: TtrpgOpenTableConsequenceInputV1, host = false) {
  const f = host ? await humanHostTable(input) : await humanTable(input), actual = locateTableConsequenceV1(f)
  if (host) assertTtrpgOpenPressureGmV1(f.runtime.authorization!, input.viewerKey)
  if (!actual || actual.owner !== input.owner || actual.operation.operationKey !== input.operationKey || actual.cycle.cycleKey !== input.cycleKey || actual.work.workKey !== input.workKey) throw new Error('当前后果已变化，请重新读取进度')
  return { f, ...actual }
}
/** Explicit host read. Ordinary player reads never invoke this private surface. */
export async function readTtrpgOpenTableHostConsequenceV1(input: TtrpgOpenTableConsequenceInputV1) {
  const { f, cycle, work, operation } = await tableConsequence(input, true)
  const template = cycle.frozenContent.campaign.effectPlanTemplates.find(t => t.planKey === work.templateKey)!
  const review = currentTtrpgOpenPressureEffectReviewV1(work)
  const epochKey = f.runtime.openRun!.coordination.activeEpochKey!
  return { ...input, title: template.reason, sequence: f.state.lastSequence,
    parameters: template.parameters.map((p, i) => ({ key: p.parameterKey, label: `后果对象 ${i + 1}`, required: p.required,
      options: Object.values(f.state.entities).filter(e => e.lifecycleStatus === 'active' && p.entityKinds.includes(e.kind === 'location' ? 'location' : e.kind === 'item' ? 'item' : 'actor') && (e.kind !== 'player' || f.runtime.authorization!.selectedActorKeys.includes(e.entityKey)) && (p.allowedRefs.includes(e.entityKey) || ttrpgOpenEntityParameterAllowedV1(f.runtime.openRun, e.entityKey, p.allowDynamicFromTemplateKeys))).map(e => ({ key: e.entityKey, name: e.name })) })),
    alternatives: template.alternatives.map(a => ({ key: a.alternativeKey, title: a.title })),
    history: (work.effectReviews ?? []).map(r => ({ revision: r.revision, status: r.status })),
    canPropose: f.runtime.product.safety.status === 'active' && (!review || ['rejected', 'stale', 'unpayable'].includes(review.status) || !ttrpgOpenPressureEffectReviewCurrentV1(f.state, f.runtime, epochKey, review)),
    existing: review ? { reviewKey: review.reviewKey, riskHash: review.riskHash, status: review.status, revision: review.revision, request: structuredClone(review.request), current: ttrpgOpenPressureEffectReviewCurrentV1(f.state, f.runtime, epochKey, review) } : null,
    frozenPlanHash: operation.planHash }
}
export type TtrpgOpenTableHostConsequenceV1 = Awaited<ReturnType<typeof readTtrpgOpenTableHostConsequenceV1>>
export async function prepareTtrpgOpenTableConsequenceV1(input: TtrpgOpenTableConsequenceInputV1 & { request: TtrpgOpenPressureEffectRequestV1 }) {
  const { f, cycle, work, operation } = await tableConsequence(input, true)
  const review = await prepareTtrpgOpenPressureEffectV1({ ...input, frozenPlanHash: operation.planHash }, input.owner)
  if ((await readProductRuntimeStateVersion(input.sessionId)).sequence !== f.state.lastSequence || !ttrpgOpenPressureEffectReviewCurrentV1(f.state, f.runtime, f.runtime.openRun!.coordination.activeEpochKey!, review)) throw new TtrpgOpenReadConflictV1('检查后果期间状态已变化，请重新检查')
  const { effects, requiredApprovals } = ttrpgOpenPressureEffectDefinitionV1({ state: f.state, runtime: f.runtime, cycle, work, request: review.request })
  return { reviewKey: review.reviewKey, riskHash: review.riskHash, revision: review.revision, request: structuredClone(review.request), ...tableConsequenceLinesV1(f, effects, true),
    affectedNames: requiredApprovals.filter(a => a.actorKey !== 'gm').map(a => f.state.entities[a.actorKey]?.name ?? '受影响角色') }
}
export async function proposeTtrpgOpenTableConsequenceV1(input: TtrpgOpenTableConsequenceInputV1 & { request: TtrpgOpenPressureEffectRequestV1; reviewKey: string; riskHash: string }) {
  // The core command owns idempotent retries after a proposal has been committed.
  if (!['pressure', 'situations', 'stage'].includes(input.owner)) throw new Error('后果类型无效')
  const f = await humanHostTable(input)
  return proposeTtrpgOpenPressureEffectV1({ ...input, ...await hostOperationCommand(input, f, `${input.owner}.work.${input.workKey}.${input.reviewKey}.propose`) }, input.owner)
}
export async function confirmTtrpgOpenTableConsequenceV1(input: TtrpgOpenTableConsequenceInputV1 & { actorKey: string; reviewKey: string; riskHash: string; decision: 'approve' | 'reject' }) {
  if (!['pressure', 'situations', 'stage'].includes(input.owner)) throw new Error('后果类型无效')
  if (input.actorKey === 'gm') throw new Error('主持裁定须在明确的主持审查界面提交')
  const f = await humanTable(input)
  const command = await operationCommand(input, `${input.owner}.work.${input.workKey}.${input.reviewKey}.approval.${input.actorKey}`)
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, command.commandId]).first()
  if (input.decision === 'approve' && !prior) {
    const view = await readTtrpgOpenPressureEffectApprovalViewV1({ ...input, frozenPlanHash: f.runtime.openRun!.operations.find(o => o.operationKey === input.operationKey)!.planHash }, input.owner)
    if (!tableConsequenceLinesV1(f, view.effects, false).reviewable) throw new Error('本次后果尚不能完整展示，请先由主持人审查')
  }
  return confirmTtrpgOpenPressureEffectV1({ ...input, ...command }, input.owner)
}
/** Closure prompt/private author material is available only after an explicit host read. */
export async function readTtrpgOpenTableStageClosureV1(input: TtrpgOpenTableInputV1 & { operationKey: string }) {
  const f = await humanHostTable(input)
  const op = f.runtime.openRun?.operations.find(o => o.operationKey === input.operationKey)
  if (!op || op.status !== 'executing' || nextTtrpgOpenOperationStepV1(op)?.kind !== 'gates') throw new Error('尚未到可审查阶段收束的步骤')
  const decision = evaluateTtrpgOpenTerminalV1(f.state, f.content)
  return { eligible: decision.closure.eligible, maximumReached: decision.closure.maximumReached, prompt: decision.closure.summaryPrompt, stageClosed: f.runtime.openRun!.stage.status === 'closed' }
}
export async function closeTtrpgOpenTableStageV1(input: TtrpgOpenTableInputV1 & { operationKey: string; summary: string }) {
  const f = await humanHostTable(input)
  return closeTtrpgOpenStageV1({ ...await hostOperationCommand(input, f, 'stage.close'), summary: input.summary })
}
async function sourceForTable(input: Pick<TtrpgOpenTableInputV1, 'scope' | 'sessionId'>) {
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  if (session.kind !== 'ttrpg' || source.runtimeSourceHash !== session.runtimeSourceHash || !source.runtimePackage.ttrpg || !isTtrpgRuntimeContentV2(source.runtimePackage.ttrpg)) throw new Error('当前冒险的冻结来源无效')
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime || runtime.product.rulePackContentHash !== source.runtimePackage.ttrpg.rulePack.contentHash || runtime.product.campaignKey !== source.runtimePackage.ttrpg.campaign.campaignKey) throw new Error('当前冒险与冻结来源不一致')
  await verifyTtrpgOpenSessionSituationHashesV1(runtime.openRun?.situationReceipts ?? [])
  await verifyTtrpgOpenEntityStateV1(state, source.runtimePackage.ttrpg)
  await verifyTtrpgOpenPrivateChoiceHashesV1(runtime.openRun?.operations ?? [])
  await verifyTtrpgOpenManualEpochsV1(runtime.openRun?.coordination.epochs ?? [])
  return { session, content: source.runtimePackage.ttrpg, state, runtime, seats: await readTtrpgSessionParticipantsV2(input.sessionId) }
}
async function humanTable(input: TtrpgOpenTableInputV1) {
  const result = await sourceForTable(input), seat = result.seats.find(s => s.viewerKey === input.viewerKey && s.role === 'player' && s.controller !== 'ai' && s.controller !== 'vacant' && s.assignmentState === 'claimed')
  if (!seat?.actorKey) throw new Error('请先确认并认领自己的真人角色')
  if (result.runtime.authorization) assertTtrpgOpenAuthorizationCurrentV1({ authorization: result.runtime.authorization, participants: result.seats, viewerKey: input.viewerKey })
  return { ...result, seat }
}
async function humanHostTable(input: TtrpgOpenTableInputV1) {
  const result = await sourceForTable(input), seat = result.seats.find(s => s.viewerKey === input.viewerKey && ['human', 'hybrid'].includes(s.controller) && s.assignmentState === 'claimed')
  if (!seat || !result.runtime.authorization) throw new Error('主持审查需要真实已确认的真人身份')
  assertTtrpgOpenAuthorizationCurrentV1({ authorization: result.runtime.authorization, participants: result.seats, viewerKey: input.viewerKey })
  assertTtrpgOpenPressureGmV1(result.runtime.authorization, input.viewerKey)
  return { ...result, seat }
}
/** Independent human GM identity, including the explicit pre-Session-Zero claim. */
async function humanGmTable(input: TtrpgOpenTableInputV1) {
  const f = await sourceForTable(input), seat = f.seats.find(s => s.viewerKey === input.viewerKey && s.role === 'gm' && ['human','hybrid'].includes(s.controller) && s.assignmentState === 'claimed')
  if (!seat || !seat.consent.safetyBoundariesAccepted || !seat.consent.aiIdentityDisclosed) throw new Error('请先确认并认领自己的真人主持席位')
  if (f.runtime.authorization) {
    assertTtrpgOpenAuthorizationCurrentV1({ authorization: f.runtime.authorization,participants: f.seats,viewerKey: input.viewerKey })
    assertTtrpgOpenHumanHostV1(f.runtime.authorization,input.viewerKey)
  }
  return { ...f,seat }
}
async function humanDesk(input: TtrpgOpenTableInputV1) {
  const f = await sourceForTable(input)
  return f.seats.some(s => s.viewerKey === input.viewerKey && s.role === 'gm') ? humanGmTable(input) : humanTable(input)
}
async function hostOperationCommand(input: TtrpgOpenTableInputV1 & { operationKey: string }, f: TableSource, key: string) {
  const operation = f.runtime.openRun?.operations.find(o => o.operationKey === input.operationKey)
  if (!operation) throw new Error('当前行动不存在，请重新读取进度')
  const version = await readProductRuntimeStateVersion(input.sessionId)
  return { sessionId: input.sessionId, viewerKey: input.viewerKey, operationKey: input.operationKey, frozenPlanHash: operation.planHash, commandId: await ttrpgOpenOperationCommandIdV1(f.runtime.sessionKey, operation.operationKey, key), baseSequence: version.sequence, baseStateHash: version.stateHash }
}
async function envelope(sessionId: number, label: string) {
  const version = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, commandId: `open.table.${label}.${crypto.randomUUID()}`, baseSequence: version.sequence, baseStateHash: version.stateHash }
}
async function operationCommand(input: TtrpgOpenTableInputV1 & { operationKey: string }, key: string) {
  const f = await humanTable(input), operation = f.runtime.openRun?.operations.find(o => o.operationKey === input.operationKey)
  if (!operation) throw new Error('当前行动已不存在，请重新读取进度')
  const version = await readProductRuntimeStateVersion(input.sessionId)
  return { sessionId: input.sessionId, viewerKey: input.viewerKey, operationKey: operation.operationKey, frozenPlanHash: operation.planHash,
    commandId: await ttrpgOpenOperationCommandIdV1(f.runtime.sessionKey, operation.operationKey, key), baseSequence: version.sequence, baseStateHash: version.stateHash }
}
export async function readTtrpgOpenTableV1(input: Pick<TtrpgOpenTableInputV1, 'scope' | 'sessionId'> & { viewerKey?: string }) {
  const f = await sourceForTable(input), run = f.runtime.openRun, auth = f.runtime.authorization
  const seats = f.seats.filter(s => s.role === 'player').map(s => ({ seatKey: s.seatKey, viewerKey: s.viewerKey, actorKey: s.actorKey!, controller: s.controller,
    name: f.content.campaign.characterTemplates.find(t => t.characterKey === s.actorKey)?.name ?? '冒险者', claimed: s.assignmentState === 'claimed' }))
  const hostSeats = f.seats.filter(s => s.role === 'gm' && ['human','hybrid'].includes(s.controller)).map(s => ({ seatKey: s.seatKey,viewerKey: s.viewerKey,claimed: s.assignmentState === 'claimed' }))
  const bootstrap = { hostSeats, sequence: f.state.lastSequence, title: f.content.campaign.title, pitch: f.content.campaign.pitch, seats, sessionZeroComplete: Boolean(auth), started: Boolean(run),
    safetyStatus: f.runtime.product.safety.status, requiredItemKeys: [...f.runtime.product.sessionZero.requiredItemKeys], agreement: structuredClone(f.content.campaign.sessionZero) }
  if (!input.viewerKey) return { ...bootstrap, player: null }
  const current = await humanTable({ ...input, viewerKey: input.viewerKey })
  if (!auth || !run) return { ...bootstrap, player: null }
  const own = await loadTtrpgOpenHumanViewV1({ ...input, viewerKey: input.viewerKey, actorKey: current.seat.actorKey! })
  const epoch = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  const pending = run.operations.find(o => ['awaiting-approval', 'executing'].includes(o.status))
  const gateRecovery = tableGateRecoveryV1(current)
  const consequence = locateTableConsequenceV1(current)
  const consequenceApprovals = [] as Array<{ actorKey: string; actorName: string; reviewKey: string; riskHash: string; revision: number; canApprove: boolean; lines: string[]; reviewable: boolean }>
  if (consequence) {
    const review = currentTtrpgOpenPressureEffectReviewV1(consequence.work)
    const applicable = review?.status === 'awaiting-approval' && ttrpgOpenPressureEffectReviewCurrentV1(current.state, current.runtime, run.coordination.activeEpochKey!, review)
    for (const a of applicable ? review.requiredApprovals.filter(a => a.actorKey !== 'gm' && a.allowedSeatKeys.includes(current.seat.seatKey) && !review.decisions.some(d => d.actorKey === a.actorKey)) : []) {
      const scoped = await readTtrpgOpenPressureEffectApprovalViewV1({ sessionId: input.sessionId, viewerKey: input.viewerKey, operationKey: consequence.operation.operationKey, frozenPlanHash: consequence.operation.planHash, cycleKey: consequence.cycle.cycleKey, workKey: consequence.work.workKey, actorKey: a.actorKey }, consequence.owner)
      const display = tableConsequenceLinesV1(current, scoped.effects, false)
      consequenceApprovals.push({ actorKey: a.actorKey, actorName: seats.find(s => s.actorKey === a.actorKey)?.name ?? '受影响角色', reviewKey: scoped.reviewKey, riskHash: scoped.riskHash, revision: scoped.revision, canApprove: scoped.canApprove, ...display })
    }
  }
  const risk = pending ? projectTtrpgOpenTableRiskV1({ state: f.state, content: f.content, operation: pending, actorKey: current.seat.actorKey!, seatKey: current.seat.seatKey }) : null
  const operation = pending ? { operationKey: pending.operationKey, frozenPlanHash: pending.planHash, riskHash: pending.riskHash, status: pending.status, narrationRecorded: pending.businessRefs.some(r => r.stepKey === 'narration'),
    actorKey: pending.plan.request.actorKey, actorName: seats.find(s => s.actorKey === pending.plan.request.actorKey)?.name ?? '行动者',
    targetName: pending.plan.request.targetKey === null ? '无特定对象' : pending.plan.request.targetKey === current.seat.actorKey ? own.view.self.name : own.view.actorsHere.find(a => a.actorKey === pending.plan.request.targetKey)?.name ?? (pending.plan.request.targetKey === own.view.self.locationKey ? f.state.entities[pending.plan.request.targetKey!]?.name : null),
    nextStepKey: nextTtrpgOpenOperationStepV1(pending)?.stepKey ?? null,
    isStarter: epoch?.viewerKey === input.viewerKey,
    approvals: pending.plan.requiredApprovals.filter(a => a.allowedSeatKeys.includes(current.seat.seatKey) && !pending.approvals.some(r => r.actorKey === a.actorKey)).map(a => ({ actorKey: a.actorKey,
      name: seats.find(s => s.actorKey === a.actorKey)?.name ?? '受影响角色' })),
    ruleLabel: pending.plan.interaction?.title ?? (pending.plan.request.route === 'existing-action' ? pending.plan.rulePack.actions.find(a => a.key === pending.plan.request.ruleKey)?.name ?? '当前行动' : pending.plan.genericCheck && ['public', 'party', `actor:${current.seat.actorKey}`].includes(pending.plan.genericCheck.audience) ? pending.plan.genericCheck.title : '未公开的行动'),
    timeCostWorldTurns: pending.plan.timeCostWorldTurns,
    risk: risk!, requiresDetailedReview: !risk!.reviewable } : null
  const runs = await readTtrpgOpenModelCallRunsV1({ ...input, calls: f.runtime.openRun!.coordination.calls })
  const pendingRejections = run.coordination.calls.filter(c => c.intentRejection && run.coordination.epochs.find(e => e.epochKey === c.authorizationEpochKey)?.viewerKey === input.viewerKey).flatMap(c => {
    const owner = runs.find(r => r.contractHash === c.runContractHash)
    return owner?.id && owner.status !== 'failed' ? [{ runId: owner.id, requestKey: c.requestKey, candidateHash: c.intentRejection!.candidateHash }] : []
  })
  const pendingCancellations: string[] = []
  for (const c of run.coordination.calls.filter(c => c.status === 'failed' && c.terminalReason === 'cancelled-before-dispatch'
    && (c.narrationBinding?.viewerKey ?? run.coordination.epochs.find(e => e.epochKey === c.authorizationEpochKey)?.viewerKey) === input.viewerKey)) {
    const direct = runs.find(r => r.contractHash === c.runContractHash)
    const historical = !direct ? await (await import('./open-run-portability')).readTtrpgOpenImportedCallOwnerV1({ ...input, requestKey: c.requestKey }) : null
    const owner = direct ?? historical?.evidence.run
    if (owner && !['failed', 'cancelled'].includes(owner.status)) pendingCancellations.push(c.requestKey)
  }
  const modelNarrationRepairs = (run.narrations ?? []).flatMap(receipt => {
    if (!isTtrpgOpenModelNarrationReceiptV1(receipt) || receipt.binding.viewerKey !== input.viewerKey || receipt.sourceRef.sessionKey !== f.runtime.sessionKey) return []
    const owner = runs.find(r => r.contractHash === receipt.runContractHash)
    return owner?.id && owner.status !== 'completed' ? [{ runId: owner.id, requestKey: receipt.requestKey, candidateHash: receipt.candidateHash }] : []
  })
  const candidateRecoveries: Array<{ runId: number; requestKey: string; purpose: string }> = []
  const historicalResponses = await listTtrpgOpenHistoricalResponsesV1({ ...input, viewerKey: input.viewerKey! })
  const candidates: Array<NonNullable<Awaited<ReturnType<typeof readTtrpgOpenIntentCandidateV1>>> | NonNullable<Awaited<ReturnType<typeof readTtrpgOpenKpCandidateV1>>>> = []
  if (epoch) for (const call of run.coordination.calls.filter(c => c.authorizationEpochKey === epoch.epochKey && c.status === 'succeeded' && ['prose.ttrpg-open-intent', 'prose.ttrpg-open-companion', 'prose.ttrpg-open-kp'].includes(c.skillId))) {
    if (call.intentRejection || (call.narrationBinding?.viewerKey ?? epoch.viewerKey) !== input.viewerKey || run.operations.some(o => o.intentEvidence?.runContractHash === call.runContractHash) || run.narrations?.some(r => r.binding.operationKey === call.narrationBinding?.operationKey)) continue
    const owner = runs.find(r => r.contractHash === call.runContractHash)
    if (!owner?.id || owner.portableRuntimeOriginJson || owner.status === 'failed' || owner.status === 'cancelled') continue
    const read = { ...input, viewerKey: input.viewerKey, runId: owner.id, requestKey: call.requestKey }
    const candidate = call.skillId === 'prose.ttrpg-open-kp' ? await readTtrpgOpenKpCandidateV1(read) : await readTtrpgOpenIntentCandidateV1(read)
    if (candidate) candidates.push(candidate)
    else candidateRecoveries.push({ runId: owner.id, requestKey: call.requestKey, purpose: call.skillId === 'prose.ttrpg-open-kp' ? 'KP 叙述' : call.skillId === 'prose.ttrpg-open-companion' ? '队友行动' : '行动建议' })
  }
  let preauthorizationAvailable = false
  if (pending?.status === 'awaiting-approval' && pending.intentEvidence) {
    const call = run.coordination.calls.find(c => c.runContractHash === pending.intentEvidence!.runContractHash), owner = runs.find(r => r.contractHash === call?.runContractHash)
    if (call && owner?.id && epoch?.viewerKey === input.viewerKey) {
      const candidate = await readTtrpgOpenIntentCandidateV1({ ...input, viewerKey: input.viewerKey, runId: owner.id, requestKey: call.requestKey })
      if (candidate?.intent) try { previewTtrpgOpenCompanionPermissionV1(f.state, f.content, candidate.intent, pending.operationKey);preauthorizationAvailable = true } catch { /* Ordinary risk confirmation is still available. */ }
    }
  }
  let canHumanHost = false
  try { assertTtrpgOpenHumanHostV1(auth, input.viewerKey);canHumanHost = true } catch { /* Other players can still read their own table. */ }
  let canDelegateHosting = false
  if (epoch?.viewerKey === input.viewerKey && !epoch.hostingDelegation && !run.entityOperations?.some(o => !o.resolution)) {
    try { createTtrpgOpenHostingDelegationV1(f.state, { epochKey: epoch.epochKey, viewerKey: input.viewerKey,
      maximumCostUsdPerCall: 0, sequence: f.state.lastSequence + 1 }); canDelegateHosting = true } catch { /* Only the eligible original human host sees the grant. */ }
  }
  const hosting = epoch?.viewerKey === input.viewerKey ? { epochKey: epoch.epochKey, canDelegate: canDelegateHosting,
    permission: epoch.hostingDelegation ?? null, canResume: Boolean(epoch.hostingDelegation && !epoch.hostingDelegation.stoppedRef) } : null
  const situationStopRepairs = canHumanHost && run.coordination.epochs.some(e => e.triggerKind === 'request-situation' && e.status === 'closed' && e.viewerKey === current.seat.viewerKey) ? await readTtrpgOpenSituationStopRepairsV1({ ...input, viewerKey: current.seat.viewerKey }) : []
  const humanNarrationRepairs = await readTtrpgOpenHumanNarrationRepairKeysV1({ ...input, viewerKey: input.viewerKey! })
  let canRequestKp = false
  try { assertTtrpgOpenModelActorV1(auth, 'prose.ttrpg-open-kp', 'gm', input.viewerKey);canRequestKp = true } catch { /* The real GM has a separate identity. */ }
  const pointContext = ttrpgOpenSituationGateContextV1(f.state, f.content, current.seat.actorKey!), availableActions = new Set(own.view.rules.core.actionCatalog.filter(a => a.available).map(a => a.actionKey))
  const affordances = run.situations.active.flatMap(instance => {
    if (!ttrpgOpenSessionSituationActorAccessV1(run, instance.templateKey, current.seat.actorKey!)) return []
    const template = ttrpgOpenSituationCatalogV1(f.content.campaign, f.runtime.openRun).templates.find(t => t.templateKey === instance.templateKey)
    return (template?.interventionPoints ?? []).filter(point => (point.visibleTo === 'public' || point.visibleTo === 'party' || point.visibleTo === 'private' && point.knownByActorKeys.includes(current.seat.actorKey!))
      && (!point.requiresPredicate || evaluateTtrpgPredicateV1(point.requiresPredicate, pointContext))
      && point.targetsObstacleKeys.some(key => !instance.satisfiedObstacleKeys.includes(key))).map(point => ({ key: `${instance.situationKey}:${point.pointKey}`, hint: point.affordanceHint,
      actions: point.suggestedActionKeys.filter(key => availableActions.has(key)).map(key => own.view.rules.actions.find(a => a.actionKey === key)?.name ?? '').filter(Boolean) }))
  })
  const budget = epoch ? ttrpgOpenCallBudgetV1(epoch, run.coordination.calls) : null
  const handoff = run.operations[run.operations.length - 1]?.handoff?.decision ?? null
  const liveCharacter = {
    resources: own.view.rules.core.resources.map(r => ({ key: r.key, name: r.name, value: own.view.self.attributes[`resource.${r.key}`] ?? null })),
    conditions: own.view.self.conditions.map(c => ({ name: f.content.rulePack.content.conditions.find(d => d.key === c.conditionKey)?.name ?? '未命名状态', stacks: c.stacks, remainingRounds: c.duration })),
    abilities: own.view.self.abilityStates.map(a => ({ key: a.abilityKey, name: own.view.rules.actions.find(d => d.actionKey === a.abilityKey)?.name ?? '能力', remainingUses: a.remainingUses, cooldownUntilRound: a.cooldownUntilRound })),
    inventory: own.view.self.inventory.filter(i => i.quantity > 0).map(i => ({ key: i.itemInstanceId, name: i.identification === 'identified' ? f.content.rulePack.content.items.find(d => d.key === i.definitionRef)?.name ?? '已辨识物品' : i.identification === 'partly-known' ? '部分辨识物品' : '尚未辨识的物品', quantity: i.quantity, charges: i.charges, durability: i.durability })),
  }
  const head = await readProductRuntimeStateVersion(input.sessionId)
  if (head.sequence !== f.state.lastSequence || head.sequence !== own.readEvidence.sequence || head.stateHash !== own.readEvidence.stateHash) throw new TtrpgOpenReadConflictV1('读取期间进度已改变，请重新读取冒险')
  return { ...bootstrap, player: { actorKey: current.seat.actorKey!, viewerKey: input.viewerKey, view: own.view,
    aiAllowed: current.seat.consent.aiAdviceAllowed && f.content.campaign.runtimePolicy.enabled && gateRecovery?.status !== 'stopped',
    passivePurpose: epoch && ['request-situation', 'request-public-situation'].includes(epoch.triggerKind) ? 'situation-generation' : epoch?.triggerKind === 'request-brief' ? 'stage-brief' : null,
    passiveRecap: Boolean(epoch && isTtrpgOpenPassiveEpochV1(epoch)), manualEpoch: Boolean(epoch?.manualAction),manualActionPending: epoch?.manualAction && !run.operations.some(o => o.authorizationEpochKey === epoch.epochKey) && epoch.viewerKey === input.viewerKey ? { epochKey: epoch.epochKey,requestHash: epoch.manualAction.requestHash } : null,
    blockedByEntity: Boolean(run.entityOperations?.some(o => !o.resolution)), epochKey: epoch?.epochKey ?? null, isEpochStarter: epoch?.viewerKey === input.viewerKey,
    remainingCalls: gateRecovery?.status === 'stopped' ? 0 : epoch ? Math.max(0, epoch.budget.maximumCalls - budget!.countedRequests) : f.runtime.epochBudget.maximumCalls,
    consequence: consequence ? { owner: consequence.owner, cycleKey: consequence.cycle.cycleKey, workKey: consequence.work.workKey, operationKey: consequence.operation.operationKey } : null, consequenceApprovals,
    situationStopRepairs, situationRequestStatus: run.coordination.calls.find(c => c.skillId === 'prose.ttrpg-open-situation-propose' && c.authorizationEpochKey === epoch?.epochKey)?.status ?? null,
    gateRecovery, stageStatus: run.stage.status, liveCharacter, hosting, canHumanHost, humanNarrationRepairs, modelNarrationRepairs, pendingCancellations, hasPendingModelRequest: Boolean(budget?.pending), hasUnknownModelResult: Boolean(budget?.blockedByUnknown), preauthorizationAvailable, blockedByModel: Boolean(budget?.pending || budget?.blockedByUnknown || budget?.blockedByDenial || candidateRecoveries.length), operation, candidates, candidateRecoveries, historicalResponses, pendingRejections, canRequestKp, hostingAllowed: f.content.campaign.runtimePolicy.enabled, handoff,
    affordances, requests: epoch ? run.coordination.calls.filter(c => !['prose.ttrpg-open-entity-propose', 'prose.ttrpg-open-brief', 'prose.ttrpg-open-situation-propose', 'prose.ttrpg-open-public-situation-propose'].includes(c.skillId) && c.authorizationEpochKey === epoch.epochKey && (c.narrationBinding?.viewerKey ?? epoch.viewerKey) === input.viewerKey && c.status !== 'succeeded').map(c => ({ requestKey: c.requestKey, status: c.status, purpose: c.skillId === 'prose.ttrpg-open-kp' ? 'KP 叙述' : c.skillId === 'prose.ttrpg-open-companion' ? '队友行动' : '行动建议' })) : [],
    narrations: (run.narrations ?? []).filter(r => r.recipientActorKeys.includes(current.seat.actorKey!)).map(r => ({ key: `${r.sourceRef.sessionKey}:${r.sourceRef.sequence}`, paragraphs: r.narration.paragraphs.map(p => p.text), sourceKind: isTtrpgOpenModelNarrationReceiptV1(r) ? 'model' : 'human', unresolvedModelResult: !isTtrpgOpenModelNarrationReceiptV1(r) && r.basis.previousRequests.some(c => c.status === 'unknown') })) } }
}
export type TtrpgOpenTableViewV1 = Awaited<ReturnType<typeof readTtrpgOpenTableV1>>

/** Explicit, receipt-bound inspection. No other POV text or authored secret names. */
export async function readTtrpgOpenTableContextTraceV1(input: TtrpgOpenTableInputV1) {
  const f = await humanTable(input), run = f.runtime.openRun
  if (!run) return null
  const calls = run.coordination.calls.filter(call => (call.narrationBinding?.viewerKey
    ?? run.coordination.epochs.find(epoch => epoch.epochKey === call.authorizationEpochKey)?.viewerKey) === input.viewerKey)
  const call = calls[calls.length - 1]
  if (!call) return null
  if (call.skillId === 'prose.ttrpg-open-entity-propose') throw new Error('实体候选和来源仅沿本次范围的独立请求入口读取，不能借用行动上下文入口。')
  if (['prose.ttrpg-open-situation-propose', 'prose.ttrpg-open-public-situation-propose'].includes(call.skillId)) throw new Error('局势候选与上下文包含尚未公开的内容；请在局势面板查看本人请求状态。')
  const rows = await readTtrpgOpenModelCallRunsV1({ ...input, calls: [call] }), owner = rows.find(row => row.contractHash === call.runContractHash)
  const historical = !owner?.id || owner.portableRuntimeOriginJson !== undefined ? await (await import('./open-run-portability')).readTtrpgOpenImportedCallOwnerV1({ ...input, requestKey: call.requestKey }) : null
  if (!owner?.id && !historical) throw new Error('本次请求的原始运行记录缺失，请先恢复进度。')
  const { verifyTtrpgOpenModelCallEvidenceV1 } = await import('./open-model-call-evidence')
  const evidence = historical?.evidence ?? await verifyTtrpgOpenModelCallEvidenceV1({ ...input, runId: owner!.id!, call, mode: 'finish' })
  const bytes = evidence.artifacts.find(row => row.artifactKind === 'rendered-request' && row.contentHash === call.requestHash)?.content
  if (!bytes) throw new Error('本次请求的原文证据缺失。')
  const rendered = JSON.parse(bytes) as { contextSelection?: import('./open-context-selection').TtrpgOpenContextSelectionReceiptV1 }
  const receipt = rendered.contextSelection
  const actual = await humanTable(input), head = await readProductRuntimeStateVersion(input.sessionId)
  if (actual.seat.seatKey !== f.seat.seatKey || actual.state.lastSequence !== f.state.lastSequence || head.sequence !== f.state.lastSequence) throw new TtrpgOpenReadConflictV1('查看上下文期间身份或进度已变化')
  if (!receipt) return { generation: 'legacy' as const, historical: Boolean(historical), requestKey: call.requestKey, worldTurn: null, contextTokens: null, budgetTokens: null, resourceCount: null, triggerCount: null, tiers: [] }
  const tiers = receipt.tokenBudget.tiers.map(tier => ({ tierKey: tier.tierKey,
    tokens: receipt.selected.filter(row => row.tierKey === tier.tierKey).reduce((sum, row) => sum + row.tokens, 0),
    omitted: tier.demoted || receipt.resourceCountBudget.tiers.some(count => count.tierKey === tier.tierKey && count.demoted) }))
  return { generation: 'p7' as const, historical: Boolean(historical), requestKey: call.requestKey, worldTurn: receipt.worldTurn,
    contextTokens: receipt.selected.reduce((sum, row) => sum + row.tokens, 0), budgetTokens: receipt.budgetTokens,
    resourceCount: receipt.selected.length, triggerCount: receipt.deliveredTriggerKeys.length, tiers,
    inspection: projectTtrpgOpenContextInspectionV1(receipt) }
}
export type TtrpgOpenTableContextTraceV1 = Awaited<ReturnType<typeof readTtrpgOpenTableContextTraceV1>>

export async function readTtrpgOpenManualActionCatalogV1(input: TtrpgOpenTableInputV1) {
  const f = await humanTable(input),run = f.runtime.openRun
  if (!run || !f.runtime.authorization) throw new Error('请先完成开团并开始冒险')
  const own = await loadTtrpgOpenHumanViewV1({ ...input,actorKey: f.seat.actorKey! })
  const catalog = buildTtrpgOpenManualCatalogV1({ state: f.state,content: f.content,runtime: f.runtime,view: own.view,actorKey: f.seat.actorKey! })
  const head = await readProductRuntimeStateVersion(input.sessionId)
  if (head.sequence !== f.state.lastSequence || head.stateHash !== own.readEvidence.stateHash) throw new TtrpgOpenReadConflictV1('读取规则期间状态已变化，请重新读取')
  return { ...catalog,sequence: head.sequence,stateHash: head.stateHash,canPropose: f.runtime.product.safety.status === 'active' && run.stage.status === 'open'
    && !f.runtime.branchLineage?.recoveryTasks.some(t => !['completed','withdrawn'].includes(t.status))
    && run.coordination.activeEpochKey === null && !run.operations.some(o => ['executing','awaiting-approval'].includes(o.status)),
    basisHash: await hashProductProductionValueV2({ sessionId: input.sessionId,viewerKey: input.viewerKey,stateHash: head.stateHash,runtimeSourceHash: f.session.runtimeSourceHash }),
  }
}
async function resumeManualAction(f: TableSource,input: TtrpgOpenTableInputV1,epochKey: string) {
  const epoch = f.runtime.openRun?.coordination.epochs.find(e => e.epochKey === epochKey)
  if (!epoch?.manualAction || epoch.viewerKey !== input.viewerKey || f.seat.actorKey === null) throw new Error('没有本人已保存的人工行动授权')
  const request = await verifyTtrpgOpenManualAuthorizationV1(epoch.manualAction)
  if (request.actorKey !== f.seat.actorKey) throw new Error('人工请求不属于当前玩家')
  const commandId = await ttrpgOpenScopedKeyV1(f.runtime.sessionKey,'manual-operation',[epoch.epochKey,epoch.manualAction.requestHash])
  const existing = f.runtime.openRun!.operations.find(o => o.rootCommandId === commandId)
  if (existing) return { operationKey: existing.operationKey,status: existing.status }
  if (epoch.status !== 'active' || f.runtime.openRun!.coordination.activeEpochKey !== epochKey) throw new Error('人工授权已结束，不能重新执行')
  await startTtrpgOpenOperationV1({ ...await envelope(input.sessionId,'manual-operation'),commandId,viewerKey: input.viewerKey,request })
  const after = await humanTable(input),stored = after.runtime.openRun!.operations.find(o => o.rootCommandId === commandId)
  if (!stored) throw new Error('人工提案回执尚未读取，请重新读取进度')
  return { operationKey: stored.operationKey,status: stored.status }
}
export async function resumeTtrpgOpenManualActionV1(input: TtrpgOpenTableInputV1 & { epochKey: string }) {
  return resumeManualAction(await humanTable(input),input,input.epochKey)
}
export async function proposeTtrpgOpenManualActionV1(input: TtrpgOpenTableInputV1 & {
  request: TtrpgOpenRuleRequestV1; rawInput: string; basisHash: string; submissionKey: string;
}) {
  const f = await humanTable(input),request = parseTtrpgOpenRuleRequestV1(input.request),requestJson = stableProductRuntimeJsonV1(request)
  if (request.actorKey !== f.seat.actorKey || request.controllerMode !== 'human') throw new Error('只能提交本人已认领角色的人工行动')
  const manualAction = { requestJson,requestHash: await hashProductProductionValueV2(request) }
  const commandId = await ttrpgOpenScopedKeyV1(f.runtime.sessionKey,'manual-authorize',[input.submissionKey])
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId,commandId]).first()
  if (prior) {
    const saved = JSON.parse(prior.payloadJson) as { epoch?: { epochKey: string; manualAction?: typeof manualAction }; intent?: { rawInput?: string } }
    if (prior.type !== 'ttrpg.open.epoch.started' || saved.epoch?.manualAction?.requestHash !== manualAction.requestHash || saved.intent?.rawInput !== input.rawInput.trim()) throw new Error('同一提交标识已绑定另一项人工请求')
    return resumeManualAction(f,input,saved.epoch.epochKey)
  }
  const catalog = await readTtrpgOpenManualActionCatalogV1(input),rule = catalog.rules.find(r => r.ruleKey === request.ruleKey && r.route === request.route && r.interactionKey === request.interactionKey)
  if (catalog.basisHash !== input.basisHash || !catalog.canPropose || !rule?.available || !rule.targets.some(t => t.key === request.targetKey)) throw new Error('人工行动或规则目录已变化，请重新读取后选择')
  if (request.discovery && !catalog.discoveries.some(d => d.situationKey === request.discovery!.situationKey && d.evidenceRef === request.discovery!.evidenceRef
    && d.interventionPointKey === request.discovery!.interventionPointKey && d.ruleKey === request.ruleKey && d.route === request.route)) throw new Error('发现路径不在本角色当前可见的规则目录')
  await startTtrpgOpenEpochV1({ sessionId: input.sessionId,baseSequence: catalog.sequence,baseStateHash: catalog.stateHash,commandId,viewerKey: input.viewerKey,
    triggerKind: 'submit-action',rawInput: input.rawInput,manualAction })
  const current = await humanTable(input)
  return resumeManualAction(current,input,current.runtime.openRun!.coordination.activeEpochKey!)
}

/** Private host projection: never pass through a player's actor context or
 * expose profiles, model messages, raw requests, seeds or whole frozen plans. */
export async function readTtrpgOpenHostTableV1(input: TtrpgOpenTableInputV1) {
  const f = await humanGmTable(input), run = f.runtime.openRun
  // Bootstrap is deliberately read without a viewer; a GM has no player actor.
  const publicView = await readTtrpgOpenTableV1({ scope: input.scope,sessionId: input.sessionId })
  if (publicView.sequence !== f.state.lastSequence) throw new TtrpgOpenReadConflictV1('读取主持进度期间状态已变化，请重新读取')
  if (!run || !f.runtime.authorization) return { ...publicView,host: null }
  const operation = run.operations.find(o => ['awaiting-approval','executing'].includes(o.status))
  const epoch = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  const consequence = locateTableConsequenceV1(f)
  const ruleResult = run.ruleReceipts.find(r => r.operationKey === operation?.operationKey)?.result
  const humanNarrationRepairs = await readTtrpgOpenHumanNarrationRepairKeysV1(input)
  if ((await readProductRuntimeStateVersion(input.sessionId)).sequence !== f.state.lastSequence) throw new TtrpgOpenReadConflictV1('读取主持进度期间状态已变化，请重新读取')
  assertTtrpgOpenAuthorizationCurrentV1({ authorization: f.runtime.authorization,participants: await readTtrpgSessionParticipantsV2(input.sessionId),viewerKey: input.viewerKey })
  return { ...publicView,host: {
    historicalResponses: await listTtrpgOpenHistoricalResponsesV1(input),
    canHumanHost: true, blockedByEntity: Boolean(run.entityOperations?.some(o => !o.resolution)), worldTurn: run.worldTime.worldTurn, stageStatus: run.stage.status,
    epochKey: epoch?.epochKey ?? null, isEpochStarter: epoch?.viewerKey === input.viewerKey,
    consequence: consequence ? { owner: consequence.owner,cycleKey: consequence.cycle.cycleKey,workKey: consequence.work.workKey,operationKey: consequence.operation.operationKey } : null,
    consequenceApprovals: [], privateChoiceReviews: tablePrivateChoiceReviewsV1(f),gateRecovery: tableGateRecoveryV1(f),humanNarrationRepairs,
    situations: run.situations.active.map(s => ({ key: s.situationKey,title: ttrpgOpenSituationCatalogV1(f.content.campaign, f.runtime.openRun).templates.find(t => t.templateKey === s.templateKey)?.title ?? '当前局势' })),
    operation: operation ? {
      operationKey: operation.operationKey,nextStepKey: nextTtrpgOpenOperationStepV1(operation)?.kind ?? null,
      status: operation.status,riskHash: operation.riskHash,actorName: f.state.entities[operation.plan.request.actorKey]?.name ?? '行动者',
      ruleLabel: operation.plan.interaction?.title ?? (operation.plan.request.route === 'existing-action' ? operation.plan.rulePack.actions.find(a => a.key === operation.plan.request.ruleKey)?.name ?? '行动' : operation.plan.genericCheck?.title ?? '通用检定'),
      timeCostWorldTurns: operation.plan.timeCostWorldTurns,
      ruleResult: ruleResult ? { outcome: ruleResult.outcome,check: ruleResult.check ? {
        dice: [...ruleResult.check.dice],expression: ruleResult.check.expression,modifier: ruleResult.check.modifier,
        total: ruleResult.check.total,dc: ruleResult.check.dc,
      } : null } : null,
      isStarter: epoch?.viewerKey === input.viewerKey,narrationRecorded: operation.businessRefs.some(r => r.stepKey === 'narration'),
      risk: projectTtrpgOpenTableRiskV1({ state: f.state,content: f.content,operation,actorKey: operation.plan.request.actorKey,seatKey: f.seat.seatKey,host: true }),
      approvals: operation.plan.requiredApprovals.filter(a => a.allowedSeatKeys.includes(f.seat.seatKey) && !operation.approvals.some(done => done.actorKey === a.actorKey)).map(a => ({ actorKey: a.actorKey,name: f.state.entities[a.actorKey]?.name ?? '角色' })),
    } : null,
    narrations: (run.narrations ?? []).filter(r => f.runtime.authorization!.selectedActorKeys.every(a => r.recipientActorKeys.includes(a))).map(r => ({ key: `${r.sourceRef.sessionKey}:${r.sourceRef.sequence}`,paragraphs: r.narration.paragraphs.map(p => p.text) })),
  } }
}
export type TtrpgOpenHostTableViewV1 = Awaited<ReturnType<typeof readTtrpgOpenHostTableV1>>

export async function readTtrpgOpenTablePrivateChoicesV1(input: TtrpgOpenTableInputV1) {
  return tablePrivateChoiceReviewsV1(await humanHostTable(input))
}
export async function prepareTtrpgOpenTablePrivateChoiceV1(input: TtrpgOpenTableInputV1 & { operationKey: string; kind: 'effect' | 'knowledge'; templateKey: string }) {
  const f = await humanHostTable(input),op = f.runtime.openRun?.operations.find(o => o.operationKey === input.operationKey)
  if (!op) throw new Error('当前行动已变化')
  const prepared = await prepareTtrpgOpenPrivateChoiceDisclosureV1({ ...input,frozenPlanHash: op.planHash })
  return { kind: prepared.body.kind,templateKey: prepared.body.templateKey,reviewHash: prepared.reviewHash,
    actorName: f.state.entities[prepared.body.actorKey]?.name ?? '行动者',alternatives: prepared.body.alternatives }
}
export async function discloseTtrpgOpenTablePrivateChoiceV1(input: TtrpgOpenTableInputV1 & { operationKey: string; kind: 'effect' | 'knowledge'; templateKey: string; reviewHash: string }) {
  const f = await humanHostTable(input)
  const event = await discloseTtrpgOpenPrivateChoiceV1({ ...input,...await hostOperationCommand(input,f,`private-disclosure.${input.reviewHash}`) })
  return { eventSequence: event.sequence,reviewHash: input.reviewHash }
}

export async function consentTtrpgOpenHostSeatV1(input: TtrpgOpenTableInputV1) {
  const f = await sourceForTable(input), seat = f.seats.find(s => s.viewerKey === input.viewerKey && s.role === 'gm' && ['human','hybrid'].includes(s.controller))
  if (!seat || f.runtime.authorization) throw new Error('只能在开团前确认自己的真人主持席位')
  return configureTtrpgSessionParticipantV2({ sessionId: input.sessionId,seatKey: seat.seatKey,expectedRevision: seat.revision,
    commandId: `open.host.consent.${crypto.randomUUID()}`,requestedByViewerKey: seat.viewerKey,assignmentState: 'claimed',
    consent: { safetyBoundariesAccepted: true,aiIdentityDisclosed: true,aiAdviceAllowed: false } })
}
export async function confirmTtrpgOpenHostRiskV1(input: TtrpgOpenTableInputV1 & { operationKey: string; actorKey: string; decision: 'approve' | 'reject'; riskHash: string }) {
  const f = await humanGmTable(input), operation = f.runtime.openRun?.operations.find(o => o.operationKey === input.operationKey)
  if (!operation || !operation.plan.requiredApprovals.some(a => a.actorKey === input.actorKey && a.allowedSeatKeys.includes(f.seat.seatKey))) throw new Error('该角色须由开团时确认的本人或批准者确认，主持不能代签')
  const risk = projectTtrpgOpenTableRiskV1({ state: f.state,content: f.content,operation,actorKey: operation.plan.request.actorKey,seatKey: f.seat.seatKey,host: true })
  if (input.decision === 'approve' && !risk.reviewable) throw new Error('后果尚不能完整展示，请先完成审查')
  return confirmTtrpgOpenOperationV1({ ...await hostOperationCommand(input,f,`approval.${input.actorKey}`),actorKey: input.actorKey,decision: input.decision,riskHash: input.riskHash })
}

/** Each human accepts their own role; AI seats retain the frozen controller and own machine identity. */
export async function consentTtrpgOpenTableSeatV1(input: TtrpgOpenTableInputV1 & { aiAdviceAllowed: boolean }) {
  const f = await sourceForTable(input), seat = f.seats.find(s => s.viewerKey === input.viewerKey && s.role === 'player' && ['human', 'hybrid'].includes(s.controller))
  if (!seat || f.runtime.authorization) throw new Error('只能在开团前确认自己的真人角色')
  return configureTtrpgSessionParticipantV2({ sessionId: input.sessionId, seatKey: seat.seatKey, expectedRevision: seat.revision,
    commandId: `open.consent.${crypto.randomUUID()}`, requestedByViewerKey: seat.viewerKey, assignmentState: 'claimed',
    consent: { safetyBoundariesAccepted: true, aiIdentityDisclosed: true, aiAdviceAllowed: input.aiAdviceAllowed } })
}
export async function startTtrpgOpenTableV1(input: TtrpgOpenTableInputV1 & { acceptedItemKeys: string[] }) {
  const f = await humanDesk(input)
  if (!f.runtime.authorization) {
    if (f.seats.some(s => ['human','hybrid'].includes(s.controller) && (s.assignmentState !== 'claimed' || !s.consent.safetyBoundariesAccepted || !s.consent.aiIdentityDisclosed))) throw new Error('请等待其他真人分别确认自己的角色')
    // AI seats accept no human character decision; their machine consent is limited to the frozen policy.
    for (const seat of f.seats.filter(s => s.controller === 'ai')) await configureTtrpgSessionParticipantV2({ sessionId: input.sessionId, seatKey: seat.seatKey,
      expectedRevision: seat.revision, commandId: `open.ai-seat.${seat.seatKey}.${seat.revision}`, requestedByViewerKey: seat.viewerKey,
      assignmentState: 'assigned', consent: { aiIdentityDisclosed: true, aiAdviceAllowed: true } })
    await completeTtrpgOpenSessionZeroV1({ ...await envelope(input.sessionId, 'zero'), viewerKey: input.viewerKey,
      acceptedItemKeys: input.acceptedItemKeys, selectedCharacterKeys: f.seats.filter(s => s.role === 'player' && s.controller !== 'vacant').map(s => s.actorKey!) })
  }
  const latest = await humanDesk(input)
  if (!latest.runtime.openRun) await startTtrpgOpenRunV1({ ...await envelope(input.sessionId, 'start'), viewerKey: input.viewerKey })
  const after = await humanDesk(input)
  // Opening admission is a real, deduplicated event; reloading this reader never starts it.
  for (const templateKey of after.content.campaign.openingSituationKeys) {
    const commandId = await ttrpgOpenScopedKeyV1(after.runtime.sessionKey, 'table.opening', [templateKey])
    if (await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first()) continue
    const current = await humanDesk(input)
    if ([...current.runtime.openRun!.situations.active, ...current.runtime.openRun!.situations.queued, ...(current.runtime.openRun!.situations.history ?? []).map(h => h.instance)].some(s => s.templateKey === templateKey)) continue
    await changeTtrpgSituationV1({ ...await envelope(input.sessionId, 'opening'), commandId, viewerKey: input.viewerKey, templateKey, activationReason: 'opening', mode: 'auto' })
  }
}
export async function requestTtrpgOpenTableCandidateV1(input: TtrpgOpenTableInputV1 & { purpose: 'intent' | 'companion' | 'kp'; rawInput: string; actorKey?: string; aiConfig: AIConfig; maximumCostUsd: number; signal?: AbortSignal }) {
  const f = await humanTable(input), run = f.runtime.openRun
  if (!run) throw new Error('请先完成开团约定并开始冒险')
  const manual = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)?.manualAction
  if (manual && input.purpose !== 'kp') throw new Error('本轮已授权人工行动；请先完成并结束本轮，再明确开始新的 AI 请求')
  if (run.stage.status === 'closed' && input.purpose !== 'kp') throw new Error('本阶段已收束，请完成叙述和保存进度；不能发起新的行动建议')
  if (input.purpose !== 'intent' && !run.coordination.activeEpochKey) throw new Error('原主持窗口已关闭，请由真人明确开始新的行动')
  if (input.purpose === 'intent' && !input.rawInput.trim()) throw new Error('请先写下自己想采取的行动')
  if (!run.coordination.activeEpochKey) await startTtrpgOpenEpochV1({ ...await envelope(input.sessionId, 'epoch'), viewerKey: input.viewerKey,
    triggerKind: input.purpose === 'intent' ? 'submit-action' : 'continue-host', rawInput: input.rawInput })
  const request = { ...await envelope(input.sessionId, 'candidate'), scope: input.scope, viewerKey: input.viewerKey, rawInput: input.rawInput,
    maximumOutputTokens: f.content.campaign.runtimePolicy.maximumOutputTokens, maximumCostUsd: input.maximumCostUsd, aiConfig: input.aiConfig, signal: input.signal }
  if (input.purpose === 'kp') return generateTtrpgOpenKpCandidateV1(request)
  if (input.purpose === 'companion') {
    const handoff = run.operations[run.operations.length - 1]?.handoff?.decision
    if (!handoff || handoff.kind !== 'companion-ready' || handoff.actorKey !== input.actorKey) throw new Error('当前没有交接给这名队友')
    return generateTtrpgOpenCompanionCandidateV1({ ...request, actorKey: input.actorKey! })
  }
  return generateTtrpgOpenIntentCandidateV1({ ...request, actorKey: f.seat.actorKey! })
}
export async function acceptTtrpgOpenTableCandidateV1(input: TtrpgOpenTableInputV1 & { runId: number; requestKey: string; candidateHash: string; kind: 'intent' | 'kp' }) {
  await humanTable(input)
  if (input.kind === 'intent') return startTtrpgOpenIntentCandidateOperationV1({ ...await envelope(input.sessionId, 'admit'), ...input, decision: 'start' })
  const candidate = await readTtrpgOpenKpCandidateV1(input)
  if (!candidate) throw new Error('叙述候选尚未保存完整')
  return acceptTtrpgOpenKpNarrationV1({ ...await operationCommand({ ...input, operationKey: candidate.binding.operationKey }, 'narration'), ...input })
}
export async function confirmTtrpgOpenTableRiskV1(input: TtrpgOpenTableInputV1 & { operationKey: string; actorKey: string; decision: 'approve' | 'reject'; riskHash: string }) {
  if (input.decision === 'approve') {
    const view = await readTtrpgOpenTableV1(input)
    if (view.player?.operation?.operationKey !== input.operationKey || !view.player.operation.risk.reviewable) throw new Error('请先由主持人完成未公开或尚不能完整展示的风险审查')
  }
  const command = await operationCommand(input, `approval.${input.actorKey}`)
  return confirmTtrpgOpenOperationV1({ ...command, actorKey: input.actorKey, decision: input.decision, riskHash: input.riskHash })
}
export async function chooseTtrpgOpenTableConsequenceV1(input: TtrpgOpenTableInputV1 & { operationKey: string; kind: 'effect' | 'knowledge'; templateKey: string; alternativeKey: string; riskHash: string; disclosureHash?: string }) {
  const f = await humanDesk(input), operation = f.runtime.openRun?.operations.find(o => o.operationKey === input.operationKey)
  if (!operation || operation.riskHash !== input.riskHash || !operation.plan.requiredApprovals.some(a => a.actorKey === operation.plan.request.actorKey && a.allowedSeatKeys.includes(f.seat.seatKey))) throw new Error('当前选择无效、尚未公开，或不属于本人的确认范围')
  const recorded = input.kind === 'knowledge' ? operation.discoveryChoices?.find(c => c.templateKey === input.templateKey)?.alternativeKey : input.kind === 'effect' && operation.pendingChoice?.templateKey === input.templateKey ? operation.pendingChoice.selectedAlternativeKey : null
  if (recorded) {
    if (recorded !== input.alternativeKey) throw new Error('当前选择无效：已经确认其他后果')
  } else {
    const op = f.seat.role === 'gm' ? (await readTtrpgOpenHostTableV1(input)).host?.operation : (await readTtrpgOpenTableV1(input)).player?.operation
    const choice = op?.risk.choices.find(c => c.kind === input.kind && c.templateKey === input.templateKey)
    if (op?.operationKey !== input.operationKey || !choice?.canChoose || choice.disclosureHash !== input.disclosureHash || !choice.alternatives.some(a => a.alternativeKey === input.alternativeKey)) throw new Error('当前选择无效、尚未公开，或不属于本人的确认范围')
  }
  const command = await hostOperationCommand(input,f,input.kind === 'effect' ? 'effect-choice' : `knowledge-choice.${input.templateKey}`)
  if (input.kind === 'knowledge') return selectTtrpgOpenDiscoveryEffectV1({ ...command, templateKey: input.templateKey, alternativeKey: input.alternativeKey, riskHash: input.riskHash, ...(input.disclosureHash !== undefined ? { disclosureHash: input.disclosureHash } : {}) })
  return selectTtrpgOpenOperationEffectV1({ ...command, alternativeKey: input.alternativeKey, riskHash: input.riskHash, ...(input.disclosureHash !== undefined ? { disclosureHash: input.disclosureHash } : {}) })
}
export async function preauthorizeTtrpgOpenTableCompanionV1(input: TtrpgOpenTableInputV1 & { operationKey: string }) {
  const f = await humanTable(input), operation = f.runtime.openRun?.operations.find(o => o.operationKey === input.operationKey)
  const call = f.runtime.openRun?.coordination.calls.find(c => c.runContractHash === operation?.intentEvidence?.runContractHash)
  const run = (await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray()).find(r => r.contractHash === call?.runContractHash)
  if (!operation?.intentEvidence || !call || !run?.id) throw new Error('此行动没有原队友候选依据')
  return preauthorizeTtrpgOpenCompanionV1({ ...await operationCommand(input, 'preauthorization'), runId: run.id, requestKey: call.requestKey, candidateHash: operation.intentEvidence.candidateHash })
}
export async function resumeTtrpgOpenTableV1(input: TtrpgOpenTableInputV1 & { operationKey: string }) {
  const f = await humanDesk(input), command = await hostOperationCommand(input,f,'resume')
  return resumeTtrpgOpenPlayV1(command)
}
export async function recoverTtrpgOpenTableGatesV1(input: TtrpgOpenTableInputV1 & { operationKey: string; proof: NonNullable<ReturnType<typeof tableGateRecoveryV1>>['proof'] }) {
  const f = await humanDesk(input), view = tableGateRecoveryV1(f)
  const command = await hostOperationCommand(input,f,'gates.recovery')
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId,command.commandId]).first()
  if (!input.proof || !prior && (!view?.canAttempt || !view.proof || stableProductRuntimeJsonV1(view.proof) !== stableProductRuntimeJsonV1(input.proof))) throw new Error('可修复的实际评估已改变，请重新读取进度')
  await recoverTtrpgOpenOperationGatesV1({ ...input.proof,...command })
  const op = f.runtime.openRun!.operations.find(o => o.operationKey === input.operationKey)!, epoch = f.runtime.openRun!.coordination.epochs.find(e => e.epochKey === op.authorizationEpochKey)
  if (epoch?.viewerKey === input.viewerKey) return resumeTtrpgOpenPlayV1(command)
  return { status: 'awaiting-human-response',nextStepKey: 'gates' }
}

export async function finishTtrpgOpenTableWindowV1(input: TtrpgOpenTableInputV1) {
  const f = await humanDesk(input), epochKey = f.runtime.openRun?.coordination.activeEpochKey
  if (!epochKey) return
  if (f.runtime.openRun!.coordination.epochs.find(e => e.epochKey === epochKey)?.triggerKind === 'request-situation') return finishTtrpgOpenSituationDraftV1({ ...input, epochKey })
  return closeTtrpgOpenEpochV1({ ...await envelope(input.sessionId, 'finish'), viewerKey: input.viewerKey, epochKey, reason: f.runtime.openRun!.coordination.calls.some(c => c.authorizationEpochKey === epochKey && c.status === 'unknown') ? '结果未知，真人明确停止本轮授权；保留原调用及费用未知记录' : '真人明确结束本轮主持，准备下一次输入' })
}

export async function rejectTtrpgOpenTableIntentV1(input: TtrpgOpenTableInputV1 & { runId: number; requestKey: string; candidateHash: string }) {
  await humanTable(input)
  return rejectTtrpgOpenIntentCandidateV1(input)
}

export async function changeTtrpgOpenTableSafetyV1(input: TtrpgOpenTableInputV1 & { status: 'active' | 'paused'; reason: string }) {
  const f = await humanDesk(input)
  return changeTtrpgSafetyStatus({ ...await envelope(input.sessionId, 'safety'), status: input.status, reason: input.reason, changedBy: f.seat.actorKey ?? f.seat.seatKey, viewerKey: input.viewerKey })
}

export async function recordTtrpgOpenTableHumanNarrationV1(input: TtrpgOpenTableInputV1 & { operationKey: string; text: string; reason: import('./open-kp-receipt').TtrpgOpenHumanNarrationReceiptV1['reason'] }) {
  return recordTtrpgOpenHumanNarrationV1({ ...await hostOperationCommand(input,await humanHostTable(input),'narration'), text: input.text, reason: input.reason })
}
export async function repairTtrpgOpenTableHumanNarrationV1(input: TtrpgOpenTableInputV1 & { operationKey: string }) {
  await humanHostTable(input)
  return reconcileTtrpgOpenHumanNarrationV1(input)
}
export async function cancelTtrpgOpenTablePreparedRequestV1(input: TtrpgOpenTableInputV1 & { requestKey: string }) {
  const f = await humanTable(input), call = f.runtime.openRun?.coordination.calls.find(c => c.requestKey === input.requestKey)
  const owner = (await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray()).find(r => r.contractHash === call?.runContractHash)
  const historical = call && !owner ? await (await import('./open-run-portability')).readTtrpgOpenImportedCallOwnerV1(input) : null
  const runId = owner?.id ?? historical?.runId
  if (!call || runId == null) throw new Error('原请求尚未保存完整，无法安全取消')
  return cancelTtrpgOpenPreparedRequestV1({ ...input, runId })
}

export async function repairTtrpgOpenTableModelNarrationV1(input: TtrpgOpenTableInputV1 & { runId: number; requestKey: string; candidateHash: string }) {
  await humanTable(input)
  return reconcileTtrpgOpenKpRunV1(input)
}


/** Viewer-scoped human messages are intentionally absent from model context providers. */
export async function readTtrpgOpenTableConversationV1(input: TtrpgOpenTableInputV1 & { beforeMessageKey?: string }) {
  const f = await humanDesk(input),run = f.runtime.openRun;
  if (!run || !f.runtime.authorization) throw new Error('请先开始冒险再查看本桌讨论');
  const visible = (run.tableMessages ?? []).filter(m => m.recipientViewerKeys.includes(input.viewerKey));
  const end = input.beforeMessageKey ? visible.findIndex(m => m.messageKey === input.beforeMessageKey) : visible.length;
  if (end < 0) throw new Error('讨论页已经变化，请重新读取最新消息');
  const start = Math.max(0,end - 20),page = visible.slice(start,end);
  let host = false;try { assertTtrpgOpenHumanHostV1(f.runtime.authorization,input.viewerKey);host = true } catch { /* A player reads only their intended messages. */ }
  if ((await readProductRuntimeStateVersion(input.sessionId)).sequence !== f.state.lastSequence) throw new TtrpgOpenReadConflictV1('讨论读取期间状态已变化，请重新读取');
  return { sequence: f.state.lastSequence,canAnswer: host,messages: page.map(m => ({
    key: m.messageKey,kind: m.kind,text: m.text,audience: m.audience,questionKey: m.questionKey,
    authorName: m.authorActorKey ? f.state.entities[m.authorActorKey]?.name ?? '原玩家' : '主持',canReply: host && m.kind === 'rules-question',
  })),earlierCursor: start > 0 ? page[0].messageKey : null };
}
export async function sendTtrpgOpenTableMessageV1(input: TtrpgOpenTableInputV1 & { submissionKey: string; request: TtrpgOpenTableMessageRequestV1 }) {
  const f = await humanDesk(input),request = parseTtrpgOpenTableMessageRequestV1(input.request);
  if (!f.runtime.openRun || !f.runtime.authorization) throw new Error('讨论需要已经开始的冒险');
  const version = await readProductRuntimeStateVersion(input.sessionId);
  if (version.sequence !== f.state.lastSequence) throw new TtrpgOpenReadConflictV1('发送前进度已变化，请重新读取');
  const event = await postTtrpgOpenTableMessageV1({ ...input,request,commandId: 'table-message',baseSequence: version.sequence,baseStateHash: version.stateHash });
  const after = await humanDesk(input),message = after.runtime.openRun?.tableMessages?.find(m => m.sourceRef.sessionKey === after.runtime.sessionKey && m.sourceRef.sequence === event.sequence);
  if (!message?.recipientViewerKeys.includes(input.viewerKey)) throw new Error('讨论回执尚未读取，请读取进度后重试原提交');
  return { messageKey: message.messageKey };
}


/** Explicit player recovery finishes only their saved successful response; it cannot adopt or send. */
export async function recoverTtrpgOpenTableResponseV1(input: TtrpgOpenTableInputV1 & { runId: number; requestKey: string }) {
  await humanTable(input)
  const candidate = await recoverTtrpgOpenRuntimeCandidateV1(input)
  if (!candidate) throw new Error('此请求尚无确定的成功响应，请保留原请求并读取进度')
  return candidate
}


export async function delegateTtrpgOpenTableHostingV1(input: TtrpgOpenTableInputV1 & { maximumCostUsdPerCall: number; decision: 'delegate-this-epoch' }) {
  const f = await humanTable(input), epochKey = f.runtime.openRun?.coordination.activeEpochKey
  if (!epochKey) throw new Error('请先明确开始本轮行动，再委托主持')
  await delegateTtrpgOpenHostingV1({ ...await envelope(input.sessionId, 'hosting.grant'), viewerKey: input.viewerKey,
    epochKey, maximumCostUsdPerCall: input.maximumCostUsdPerCall, decision: input.decision })
}
export async function resumeTtrpgOpenTableHostingV1(input: TtrpgOpenTableInputV1 & Pick<TtrpgOpenHostingInputV1, 'aiConfig' | 'runAI' | 'signal'>) {
  const f = await humanTable(input), epoch = f.runtime.openRun?.coordination.epochs.find(e => e.epochKey === f.runtime.openRun!.coordination.activeEpochKey)
  if (!epoch?.hostingDelegation) throw new Error('请先明确委托本轮主持')
  return resumeTtrpgOpenHostingV1({ ...input, epochKey: epoch.epochKey, hostingDelegationRef: epoch.hostingDelegation.sourceRef })
}
export async function stopTtrpgOpenTableHostingV1(input: TtrpgOpenTableInputV1 & { epochKey: string; hostingDelegationRef: import('./open-coordination').TtrpgOpenSourceRefV1 }, onStopped?: () => void | Promise<void>) {
  // Persist revocation before cancelling a local UI signal. CAS retries never send a model request.
  for (let attempt = 0; attempt < 6; attempt++) {
    const f = await humanTable(input), epoch = f.runtime.openRun?.coordination.epochs.find(e => e.epochKey === input.epochKey)
    if (!epoch?.hostingDelegation || epoch.viewerKey !== input.viewerKey
      || stableProductRuntimeJsonV1(epoch.hostingDelegation.sourceRef) !== stableProductRuntimeJsonV1(input.hostingDelegationRef)) throw new Error('不是当前玩家的原主持委托')
    if (epoch.hostingDelegation.stoppedRef || epoch.status !== 'active') break
    try {
      await stopTtrpgOpenHostingV1({ ...await envelope(input.sessionId, 'hosting.stop'), epochKey: epoch.epochKey,
        viewerKey: input.viewerKey, reason: '真人明确停止本轮自动主持，保留既有进度和请求用量' })
      break
    } catch (error) {
      const head = await readProductRuntimeStateVersion(input.sessionId)
      if (head.sequence === f.state.lastSequence || attempt === 5) throw error
    }
  }
  const f = await humanTable(input), epoch = f.runtime.openRun?.coordination.epochs.find(e => e.epochKey === input.epochKey)
  if (!epoch || epoch.status === 'active' && !epoch.hostingDelegation?.stoppedRef) throw new Error('停止回执尚未保存，请读取进度')
  await onStopped?.()
  if (epoch.status !== 'active') return
  const runs = await readTtrpgOpenModelCallRunsV1({ ...input, calls: f.runtime.openRun!.coordination.calls })
  for (const call of f.runtime.openRun!.coordination.calls.filter(c => c.authorizationEpochKey === epoch.epochKey
    && stableProductRuntimeJsonV1(c.hostingDelegationRef) === stableProductRuntimeJsonV1(input.hostingDelegationRef)
    && (c.status === 'prepared' || c.status === 'failed' && c.terminalReason === 'cancelled-before-dispatch'))) {
    const owner = runs.find(r => r.contractHash === call.runContractHash)
    if (!owner?.id) throw new Error('停止已保存，但原未发送请求的运行回执仍需修复')
    await cancelTtrpgOpenPreparedRequestV1({ ...input, runId: owner.id, requestKey: call.requestKey })
  }
  const current = await humanTable(input)
  const proposal = current.runtime.openRun!.operations.find(o => o.authorizationEpochKey === epoch.epochKey
    && stableProductRuntimeJsonV1(o.intentEvidence?.hostingDelegationRef) === stableProductRuntimeJsonV1(input.hostingDelegationRef)
    && ['awaiting-approval', 'executing'].includes(o.status) && !o.approvals.length && !o.businessRefs.length && !o.inheritance)
  if (proposal) await disposeTtrpgOpenIntentV1({ ...await envelope(input.sessionId, 'hosting.dispose'), viewerKey: input.viewerKey,
    operationKey: proposal.operationKey, frozenPlanHash: proposal.planHash,
    commandId: await ttrpgOpenOperationCommandIdV1(current.runtime.sessionKey, proposal.operationKey, 'disposed'),
    reason: '真人停止自动主持，撤销尚未结算的本轮系统提案' })
}

/** Explicit owner-only archive read, without executing a historical candidate. */
export async function readTtrpgOpenTableHistoricalResponseV1(input: TtrpgOpenTableInputV1 & { runId: number; requestKey: string }) {
  return readTtrpgOpenHistoricalResponseV1(input)
}
