/** Human situation desk. Reading never sends, repairs, confirms or activates. */
import type { WorkspaceScope } from '../types'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { assertTtrpgOpenSituationEpochAuthorityV1 } from './open-coordination'
import { assertTtrpgOpenModelActorV1 } from './open-model-purpose'
import { readTtrpgOpenModelCallRunsV1 } from './open-model-call-evidence'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { hashCanonicalValue } from '../agent/run/hash'
import { readTtrpgOpenSituationCandidateV1, readTtrpgOpenSituationCandidateSummaryV1, assertTtrpgOpenSituationHumanGmV1 } from './open-generated-situation-candidate'
import { generateTtrpgOpenSituationCandidateV1, executeTtrpgOpenSituationRequestV1, recoverTtrpgOpenSituationCandidateV1 } from './open-intent-harness'
import { loadTtrpgOpenSituationKernelInputV1 } from './open-generated-situation-context'
import { finishTtrpgOpenSituationDraftV1, reconcileTtrpgOpenStoppedSituationV1, readTtrpgOpenSituationStopRepairsV1 } from './open-generated-situation-stop'
import { reconcileTtrpgOpenSituationRunV1 } from './open-session-situation-adoption'
import { cancelTtrpgOpenPreparedRequestV1 } from './open-request-cancellation'
import { repairTtrpgOpenSituationResponseReceiptV1, abandonTtrpgOpenSituationWaitV1 } from './open-situation-request-recovery'
import { acceptTtrpgOpenSituationV1, activateTtrpgOpenSessionSituationV1, startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1 } from './runtime-commands'
import { createTtrpgOpenRuntimeEntityReferencesV1, type TtrpgOpenSituationRuntimeReferencePolicyV1 } from './open-runtime-entity-references'
import { ttrpgOpenEntityIdentityCatalogV1 } from './open-entity-catalog'

export interface TtrpgOpenSituationDeskInputV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string }
type Transport = Pick<Parameters<typeof generateTtrpgOpenSituationCandidateV1>[0], 'aiConfig' | 'runAI' | 'signal'>
const DECLINED = 'human-declined-situation:'
async function envelope(sessionId: number, commandId: string) {
  const version = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, commandId, baseSequence: version.sequence, baseStateHash: version.stateHash }
}
function submissionKey(key: string) {
  if (!/^[a-zA-Z0-9._-]{1,96}$/.test(key)) throw new Error('操作标识无效，请重新读取本桌进度。')
  return key
}
export async function readTtrpgOpenSituationDeskV1(input: TtrpgOpenSituationDeskInputV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  if (!loaded.humanHost) return null
  const { runtime, content } = loaded, run = runtime.openRun!, privateGm = loaded.seat?.role === 'gm' && loaded.seat.controller !== 'ai'
  const active = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  const own = run.coordination.epochs.filter(e => e.triggerKind === 'request-situation' && e.viewerKey === input.viewerKey)
  const epoch = active?.triggerKind === 'request-situation' && active.viewerKey === input.viewerKey ? active : own[own.length - 1]
  if (!privateGm && !epoch) return null // AI-host fresh requests use the explicit common-input desk.
  const call = epoch && run.coordination.calls.find(c => c.authorizationEpochKey === epoch.epochKey)
  const owners = call ? (await readTtrpgOpenModelCallRunsV1({ ...input, calls: [call] })).filter(r => r.contractHash === call.runContractHash && !r.portableRuntimeOriginJson) : []
  if (owners.length > 1) throw new Error('原局势请求不能唯一定位，请核对原记录。')
  const owner = owners[0], read = call && owner?.id ? { ...input, runId: owner.id, requestKey: call.requestKey } : null
  const snapshot = read ? await readInstanceAgentRunV1(input.scope, read.runId) : null
  const summary = read && call?.status === 'succeeded' ? await readTtrpgOpenSituationCandidateSummaryV1(read) : null
  const candidate = privateGm && read && call?.status === 'succeeded' ? await readTtrpgOpenSituationCandidateV1(read) : null
  const adopted = call ? run.situationReceipts?.find(r => r.model.requestKey === call.requestKey) : undefined
  const declined = Boolean(candidate && epoch?.stopReason === DECLINED + candidate.candidateHash)
  const currentWindow = Boolean(epoch && active?.epochKey === epoch.epochKey)
  const templateHash = candidate?.review ? await hashCanonicalValue(candidate.review.proposal.template) : null
  let canRequest = false, unavailable = '', canConfirm = false, confirmationUnavailable = ''
  try {
    if (!privateGm) throw new Error('此处仅保留原私域请求；新局势请使用共同资料拟定入口。')
    if (!content.campaign.runtimePolicy.enabled) throw new Error('本桌尚未允许 AI 局势拟定。')
    assertTtrpgOpenModelActorV1(runtime.authorization!, 'prose.ttrpg-open-situation-propose', 'gm', input.viewerKey)
    assertTtrpgOpenSituationEpochAuthorityV1(runtime, input.viewerKey)
    if (active) throw new Error('请先处理并结束当前窗口，再主动请求新局势。')
    canRequest = true
  } catch (cause) { unavailable = cause instanceof Error ? cause.message : String(cause) }
  if (privateGm && read && candidate?.review && !adopted && !declined && currentWindow
    && ['ready', 'usable-with-warnings'].includes(candidate.artifact.status) && !['cancelled', 'failed'].includes(snapshot!.projection.state)) {
    try {
      const current = await loadTtrpgOpenSituationKernelInputV1({ ...input, actorKey: 'gm' })
      if (candidate.admissionStateHash !== current.context.admissionStateHash || candidate.visibilityHash !== current.context.visibilityHash) throw new Error('当前来源或权限已变化，此候选不能采用。')
      canConfirm = candidate.review.evaluation.accepted
    } catch (cause) { confirmationUnavailable = cause instanceof Error ? cause.message : String(cause) }
  }
  const canEnable = privateGm && !active && runtime.product.safety.status === 'active' && run.stage.status === 'open'
    && !run.operations.some(o => ['awaiting-approval', 'executing'].includes(o.status))
    && !run.coordination.calls.some(c => ['prepared', 'dispatched'].includes(c.status))
    && !runtime.branchLineage?.recoveryTasks.some(t => !['completed', 'withdrawn'].includes(t.status))
  const accepted = privateGm ? (run.situationReceipts ?? []).filter(r => r.version === 1).map(r => ({ templateKey: r.template.templateKey, title: r.template.title,
    receiptHash: r.receiptHash, status: run.situations.active.some(i => i.templateKey === r.template.templateKey) ? 'active' as const
      : run.situations.queued.some(i => i.templateKey === r.template.templateKey) ? 'queued' as const : 'saved' as const })) : []
  const stopRepairs = await readTtrpgOpenSituationStopRepairsV1(input)
  const observedResponse = snapshot?.events.some(e => (e.type === 'model.responded' || e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')
    && e.payload.stepId === call?.stepId && e.payload.attempt === call?.attempt)
  const labels = privateGm ? [
    ...Object.values(loaded.state.entities).map(e => ({ key: e.entityKey, title: e.name })),
    ...content.campaign.characterTemplates.map(c => ({ key: c.characterKey, title: c.name })),
    ...content.rulePack.content.actions.map(a => ({ key: a.key, title: a.name })),
    ...content.rulePack.content.genericChecks.map(c => ({ key: c.checkKey, title: c.title })),
    ...content.campaign.clocks.map(c => ({ key: c.clockKey, title: c.title })),
    ...content.campaign.fronts.map(f => ({ key: f.frontKey, title: f.title })),
    ...[...content.campaign.situationTemplates, ...(run.situationReceipts ?? []).map(r => r.template)].flatMap(t => [
      { key: t.templateKey, title: t.title }, ...t.evidence.map(e => ({ key: e.clueRef, title: e.title }))]),
  ] : []
  await loaded.assertCurrent()
  return { sequence: loaded.state.lastSequence, privateGm, canRequest, unavailable, currentWindow, epochKey: epoch?.epochKey ?? null,
    runtimeInstanceCount: privateGm ? ttrpgOpenEntityIdentityCatalogV1(content, run.entityOperations ?? []).filter(row => row.dynamic).length : 0,
    request: call ? { status: call.status, local: Boolean(read), read,
      responseRecovery: read && currentWindow && call.status === 'dispatched' ? observedResponse ? 'saved-response' as const : 'unobserved' as const : null } : null, summary, candidate, templateHash,
    adopted: Boolean(adopted), declined, stopped: epoch?.status === 'closed', canConfirm, confirmationUnavailable,
    receiptPending: Boolean(adopted && read && snapshot?.projection.state !== 'completed'),
    accepted, canEnable: Boolean(canEnable), stopRepairs, labels }
}
export async function requestTtrpgOpenSituationDeskV1(input: TtrpgOpenSituationDeskInputV1 & Transport & { submissionKey: string; rawInput: string; maximumCostUsd: number; includeRuntimeEntities?: boolean }) {
  if (input.includeRuntimeEntities !== undefined && typeof input.includeRuntimeEntities !== 'boolean') throw new Error('请明确选择是否使用本局已创建实例。')
  if (input.signal?.aborted) throw input.signal.reason ?? new Error('局势请求已停止。')
  const page = await readTtrpgOpenSituationDeskV1(input)
  if (!page?.canRequest) throw new Error(page?.unavailable ?? '只有当前真人主持可以请求局势。')
  const key = submissionKey(input.submissionKey)
  if (!Number.isFinite(input.maximumCostUsd) || input.maximumCostUsd < 0 || input.maximumCostUsd > 1000) throw new Error('请填写有效的调用预留上限。')
  if (!input.aiConfig && !input.runAI) throw new Error('请先配置明确的模型。')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  let runtimeEntityReferencePolicy: TtrpgOpenSituationRuntimeReferencePolicyV1 | undefined
  if (input.includeRuntimeEntities) {
    const references = await createTtrpgOpenRuntimeEntityReferencesV1({ content: loaded.content, operations: loaded.runtime.openRun!.entityOperations ?? [], runtimeSourceHash: loaded.source.runtimeSourceHash })
    if (!references.references.length) throw new Error('本局尚无实际创建实例；可以按原冻结资料请求局势。')
    runtimeEntityReferencePolicy = { schema: 'storyforge.ttrpg-open-situation-runtime-reference-policy', version: 1, consumer: 'private-gm', references }
  }
  const maximumOutputTokens = Math.min(getAgentSkillV1('prose.ttrpg-open-situation-propose').maxOutputTokens, loaded.content.campaign.runtimePolicy.maximumOutputTokens)
  await startTtrpgOpenEpochV1({ ...await envelope(input.sessionId, 'situation.desk.' + key), viewerKey: input.viewerKey, triggerKind: 'request-situation', rawInput: input.rawInput,
    ...(runtimeEntityReferencePolicy ? { runtimeEntityReferencePolicy } : {}) })
  return generateTtrpgOpenSituationCandidateV1({ ...input, ...await envelope(input.sessionId, 'situation.prepare.' + key), maximumOutputTokens })
}
async function original(input: TtrpgOpenSituationDeskInputV1) {
  const page = await readTtrpgOpenSituationDeskV1(input), read = page?.request?.read
  if (!page || !read) throw new Error('原请求只供历史查阅，或当前身份没有原请求权限。')
  return { page, read }
}
export async function resumeTtrpgOpenSituationDeskV1(input: TtrpgOpenSituationDeskInputV1 & Transport) {
  const { page, read } = await original(input)
  if (!page.currentWindow || page.request?.status !== 'prepared') throw new Error('只能明确继续原来尚未发送的局势请求。')
  return executeTtrpgOpenSituationRequestV1({ ...input, ...read })
}
export async function recoverTtrpgOpenSituationDeskV1(input: TtrpgOpenSituationDeskInputV1) {
  const { page, read } = await original(input)
  if (page.request?.status !== 'succeeded') throw new Error('原请求没有已保存的成功回答。')
  return recoverTtrpgOpenSituationCandidateV1(read)
}
export async function repairTtrpgOpenSituationDeskResponseV1(input: TtrpgOpenSituationDeskInputV1) {
  const { page, read } = await original(input)
  if (page.request?.responseRecovery !== 'saved-response' && page.request?.status !== 'succeeded') throw new Error('没有本地原回答可补齐，请保留原请求。')
  return repairTtrpgOpenSituationResponseReceiptV1(read)
}
export async function abandonTtrpgOpenSituationDeskWaitV1(input: TtrpgOpenSituationDeskInputV1 & { decision: 'abandon-wait-as-unknown' }) {
  const { page, read } = await original(input)
  if (page.request?.responseRecovery !== 'unobserved' && page.request?.status !== 'unknown') throw new Error('已有回答时请恢复原回答回执；当前不能记为未知。')
  return abandonTtrpgOpenSituationWaitV1({ ...read, decision: input.decision })
}
export async function confirmTtrpgOpenSituationDeskV1(input: TtrpgOpenSituationDeskInputV1 & { candidateHash: string; templateHash: string; disclosure: 'player-and-discovery-text-reviewed' }) {
  const { page, read } = await original(input)
  if (!page.canConfirm || page.candidate?.candidateHash !== input.candidateHash || page.templateHash !== input.templateHash) throw new Error('局势版本已变化、当前不可确认或已经处理。')
  return acceptTtrpgOpenSituationV1({ ...await envelope(input.sessionId, 'situation.desk.confirm'), ...read,
    candidateHash: input.candidateHash, templateHash: input.templateHash, disclosure: input.disclosure })
}
export async function repairTtrpgOpenSituationDeskV1(input: TtrpgOpenSituationDeskInputV1 & { candidateHash: string }) {
  await assertTtrpgOpenSituationHumanGmV1(input)
  const { page, read } = await original(input)
  if (!page.adopted || page.candidate?.candidateHash !== input.candidateHash) throw new Error('没有该精确候选的已提交采用记录。')
  return reconcileTtrpgOpenSituationRunV1({ ...read, candidateHash: input.candidateHash })
}
export async function declineTtrpgOpenSituationDeskV1(input: TtrpgOpenSituationDeskInputV1 & { candidateHash: string }) {
  await assertTtrpgOpenSituationHumanGmV1(input)
  const { page } = await original(input)
  if (page.adopted || page.candidate?.candidateHash !== input.candidateHash || !page.epochKey || !page.currentWindow && !page.declined) throw new Error('已采用、其他版本或已结束的候选不能改写为放弃。')
  // Closing competes atomically with adoption before cancelling an unadopted Run.
  if (!page.declined) await closeTtrpgOpenEpochV1({ ...await envelope(input.sessionId, 'situation.decline.' + input.candidateHash),
    viewerKey: input.viewerKey, epochKey: page.epochKey, reason: DECLINED + input.candidateHash })
  return reconcileTtrpgOpenStoppedSituationV1({ ...input, epochKey: page.epochKey })
}
export async function cancelTtrpgOpenSituationDeskPreparedV1(input: TtrpgOpenSituationDeskInputV1) {
  const { page, read } = await original(input)
  if (page.request?.status !== 'prepared') throw new Error('只能取消原来尚未发送的请求。')
  return cancelTtrpgOpenPreparedRequestV1(read)
}
export async function finishTtrpgOpenSituationDeskV1(input: TtrpgOpenSituationDeskInputV1) {
  const page = await readTtrpgOpenSituationDeskV1(input)
  if (!page?.epochKey) throw new Error('没有本人可结束的局势窗口。')
  return finishTtrpgOpenSituationDraftV1({ ...input, epochKey: page.epochKey })
}
export async function enableTtrpgOpenSituationDeskV1(input: TtrpgOpenSituationDeskInputV1 & { templateKey: string; submissionKey: string }) {
  const page = await readTtrpgOpenSituationDeskV1(input)
  if (!page?.canEnable || !page.accepted.some(r => r.templateKey === input.templateKey)) throw new Error('请先结束生成窗口和待结算业务，再由真人 GM 启用已采用定义。')
  return activateTtrpgOpenSessionSituationV1({ ...await envelope(input.sessionId, 'situation.enable.' + submissionKey(input.submissionKey)),
    viewerKey: input.viewerKey, templateKey: input.templateKey })
}
