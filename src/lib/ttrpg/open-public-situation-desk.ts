/** Player-host desk: explicit once delegation, opaque candidate, original-run recovery. Reads never mutate. */
import type { TtrpgOpenSituationDeskInputV1 } from './open-situation-desk-service'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { assertTtrpgOpenSituationEpochAuthorityV1 } from './open-coordination'
import { assertTtrpgOpenModelActorV1 } from './open-model-purpose'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { resolveRequestConfig } from '../ai/client'
import { hashCanonicalValue } from '../agent/run/hash'
import { createTtrpgOpenPublicSituationAuthorizationV1 } from './open-public-situation-authorization'
import { generateTtrpgOpenPublicSituationCandidateV1, recoverTtrpgOpenPublicSituationCandidateV1 } from './open-intent-harness'
import { readTtrpgOpenPublicSituationCandidateSummaryV1 } from './open-public-situation-candidate'
import { readTtrpgOpenRuntimeCandidateForKernelV1 } from './open-runtime-candidate'
import { acceptTtrpgOpenPublicSituationV1, activateTtrpgOpenSessionSituationV1 } from './runtime-commands'
import { reconcileTtrpgOpenPublicSituationRunV1 } from './open-public-situation-adoption'
import { finishTtrpgOpenPublicSituationDraftV1, readTtrpgOpenPublicSituationStopRepairsV1 } from './open-public-situation-stop'
import { ttrpgOpenSessionSituationActorAccessV1 } from './open-session-situation-catalog'
import { repairTtrpgOpenPublicSituationResponseReceiptV1, abandonTtrpgOpenPublicSituationWaitV1 } from './open-situation-request-recovery'
import { ttrpgOpenEntityIdentityCatalogV1, ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'

type Input = TtrpgOpenSituationDeskInputV1
type Transport = Pick<Parameters<typeof generateTtrpgOpenPublicSituationCandidateV1>[0], 'aiConfig' | 'runAI' | 'signal'>
async function envelope(sessionId: number, commandId: string) { return { sessionId, commandId, ...await readProductRuntimeStateVersion(sessionId).then(v => ({ baseSequence: v.sequence, baseStateHash: v.stateHash })) } }
function key(value: string) { if (!/^[a-zA-Z0-9._-]{1,96}$/.test(value)) throw new Error('操作标识无效，请重新读取本桌进度。'); return value }
export async function readTtrpgOpenPublicSituationDeskV1(input: Input) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  if (!loaded.humanHost || loaded.seat?.role !== 'player') return null
  const { runtime, content } = loaded, run = runtime.openRun!
  const active = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  const own = run.coordination.epochs.filter(e => e.publicSituation && e.viewerKey === input.viewerKey)
  const epoch = active?.publicSituation && active.viewerKey === input.viewerKey ? active : own[own.length - 1], grant = epoch?.publicSituation
  const call = grant && run.coordination.calls.find(c => c.requestKey === grant.basis.requestKey)
  let snapshot: Awaited<ReturnType<typeof readInstanceAgentRunV1>> | null = null
  if (grant) try {
    const original = await readInstanceAgentRunV1(input.scope, grant.run.runId)
    if (!original.run.portableRuntimeOriginJson && original.run.productRuntimeSessionId === input.sessionId
      && original.run.contractHash === grant.run.contractHash && original.run.contractJson === grant.run.contractJson) snapshot = original
  } catch { /* Imported/deleted history never gains a replacement. */ }
  const read = grant && snapshot ? { ...input, runId: snapshot.run.id!, requestKey: grant.basis.requestKey } : null
  const summary = read && call?.status === 'succeeded' ? await readTtrpgOpenPublicSituationCandidateSummaryV1(read) : null
  const adopted = grant && run.situationReceipts?.find(r => r.model.requestKey === grant.basis.requestKey)
  const currentWindow = Boolean(epoch && active?.epochKey === epoch.epochKey)
  let canRequest = false, unavailable = ''
  try {
    if (!content.campaign.runtimePolicy.enabled || content.campaign.gmMode !== 'ai') throw new Error('本桌未启用 AI 主持共同局势拟定。')
    assertTtrpgOpenModelActorV1(runtime.authorization!, 'prose.ttrpg-open-public-situation-propose', 'gm', input.viewerKey)
    assertTtrpgOpenSituationEpochAuthorityV1(runtime, input.viewerKey)
    if (active) throw new Error('请先处理并结束当前窗口。')
    canRequest = true
  } catch (cause) { unavailable = cause instanceof Error ? cause.message : String(cause) }
  const observed = snapshot?.events.some(e => (e.type === 'model.responded' || e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')
    && e.payload.stepId === call?.stepId && e.payload.attempt === call?.attempt)
  const accepted = (run.situationReceipts ?? []).filter(r => r.version === 2 && ttrpgOpenSessionSituationActorAccessV1(run, r.template.templateKey, loaded.seat!.actorKey!))
    .map(r => ({ templateKey: r.template.templateKey, title: r.template.title, status: run.situations.active.some(i => i.templateKey === r.template.templateKey) ? 'active' as const
      : run.situations.queued.some(i => i.templateKey === r.template.templateKey) ? 'queued' as const : 'saved' as const }))
  const canEnable = !active && runtime.product.safety.status === 'active' && run.stage.status === 'open'
    && !run.operations.some(o => ['awaiting-approval', 'executing'].includes(o.status)) && !run.coordination.calls.some(c => ['prepared', 'dispatched'].includes(c.status))
    && !runtime.branchLineage?.recoveryTasks.some(t => !['completed', 'withdrawn'].includes(t.status))
  const stopRepairs = own.length ? await readTtrpgOpenPublicSituationStopRepairsV1(input) : []
  await loaded.assertCurrent()
  return { sequence: loaded.state.lastSequence, canRequest, unavailable, currentWindow, epochKey: epoch?.epochKey ?? null,
    runtimeInstanceCount: ttrpgOpenEntityIdentityCatalogV1(content, run.entityOperations ?? []).filter(row => row.dynamic && runtime.authorization!.selectedActorKeys.every(actor =>
      ttrpgOpenEntityReferenceVisibleV1(row.audience, row.recipientActorKeys, actor, false, true))).length,
    request: grant ? { read, local: Boolean(read), status: call?.status ?? 'authorized',
      responseRecovery: read && currentWindow && call?.status === 'dispatched' ? observed ? 'saved-response' as const : 'unobserved' as const : null } : null,
    summary, adopted: Boolean(adopted), receiptPending: Boolean(adopted && read && snapshot?.projection.state !== 'completed'),
    canFinalize: Boolean(currentWindow && read && !adopted && summary && ['ready', 'usable-with-warnings'].includes(summary.status)
      && !summary.stopped && grant?.basis.delegation.decision === 'adopt-this-one-candidate' && runtime.product.safety.status === 'active'),
    accepted, canEnable, stopRepairs }
}
async function original(input: Input) {
  const page = await readTtrpgOpenPublicSituationDeskV1(input), read = page?.request?.read
  if (!page || !read || !page.epochKey) throw new Error('原共同请求只供历史查阅，不能恢复发送或采用权限。')
  return { page, read }
}
/** No transport: repair the saved candidate/commit using only the original once grant. */
export async function finalizeTtrpgOpenPublicSituationDeskV1(input: Input) {
  const { page, read } = await original(input)
  if (page.request?.status !== 'succeeded') throw new Error('原请求尚无成功保存的回答。')
  await recoverTtrpgOpenPublicSituationCandidateV1(read)
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(e => e.epochKey === page.epochKey)!, grant = epoch.publicSituation!
  const adopted = loaded.runtime.openRun!.situationReceipts?.find(r => r.model.requestKey === read.requestKey)
  const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(read, 'public-situation-proposal')
  if (candidate?.schema !== 'storyforge.ttrpg-open-public-situation-candidate') throw new Error('原候选尚未完整保存，请保留原记录。')
  if (adopted) await reconcileTtrpgOpenPublicSituationRunV1({ ...read, candidateHash: adopted.model.candidateHash })
  else {
    if (!page.currentWindow || !candidate.review || !['ready', 'usable-with-warnings'].includes(candidate.artifact.status)) throw new Error('本次候选未通过检查或授权窗口已经结束。')
    await acceptTtrpgOpenPublicSituationV1({ ...await envelope(input.sessionId, 'public.situation.desk.accept'), ...read,
      candidateHash: candidate.candidateHash, templateHash: await hashCanonicalValue(candidate.review.proposal.template), authorizationBasisHash: grant.basisHash })
  }
  if (page.currentWindow) await finishTtrpgOpenPublicSituationDraftV1({ ...input, epochKey: page.epochKey! })
}
export async function requestTtrpgOpenPublicSituationDeskV1(input: Input & Transport & { submissionKey: string; rawInput: string; maximumCostUsd: number;
  sharingDecision: 'share-this-request-with-current-party'; delegationDecision: 'adopt-this-one-candidate'; includeRuntimeEntities?: boolean }) {
  if (input.includeRuntimeEntities !== undefined && typeof input.includeRuntimeEntities !== 'boolean') throw new Error('请明确选择是否使用共同可知的已创建实例。')
  if (input.signal?.aborted) throw input.signal.reason ?? new Error('本次请求已停止。')
  // Validate both decisions before preparing a Run or touching an epoch.
  if (input.sharingDecision !== 'share-this-request-with-current-party' || input.delegationDecision !== 'adopt-this-one-candidate') throw new Error('请明确共享本次输入，并委托 AI 主持采用本次这一个候选。')
  const page = await readTtrpgOpenPublicSituationDeskV1(input)
  if (!page?.canRequest) throw new Error(page?.unavailable ?? '只有当前真人主持可以请求共同局势。')
  if (!input.aiConfig && !input.runAI) throw new Error('请先配置明确的模型。')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const maximumOutputTokens = Math.min(getAgentSkillV1('prose.ttrpg-open-public-situation-propose').maxOutputTokens, loaded.content.campaign.runtimePolicy.maximumOutputTokens)
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, { category: 'runtime.ttrpg-open.public-situation-propose', projectId: input.scope.projectId,
    configOverrides: { maxTokens: maximumOutputTokens }, contextOverflowPolicy: 'reject' }) : null
  const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' } : { provider: resolved!.config.provider, model: resolved!.config.model }
  if (!input.runAI && modelIdentity.provider === 'poe') throw new Error('当前模型不支持本次输出上限。')
  await createTtrpgOpenPublicSituationAuthorizationV1({ ...input, ...await envelope(input.sessionId, 'public.situation.desk.' + key(input.submissionKey)), modelIdentity, maximumOutputTokens })
  return resumeTtrpgOpenPublicSituationDeskV1(input)
}
export async function resumeTtrpgOpenPublicSituationDeskV1(input: Input & Transport) {
  const { page, read } = await original(input)
  if (!page.currentWindow || !['authorized', 'prepared'].includes(page.request!.status)) throw new Error('只能明确继续原来尚未发送的共同请求。')
  const result = await generateTtrpgOpenPublicSituationCandidateV1({ ...input, ...read })
  if (input.signal?.aborted) throw input.signal.reason ?? new Error('本次请求已停止。')
  if (result.status === 'candidate' && ['ready', 'usable-with-warnings'].includes(result.summary.status)) await finalizeTtrpgOpenPublicSituationDeskV1(input)
  return result
}
export async function repairTtrpgOpenPublicSituationDeskResponseV1(input: Input) { const { read } = await original(input); return repairTtrpgOpenPublicSituationResponseReceiptV1(read) }
export async function abandonTtrpgOpenPublicSituationDeskWaitV1(input: Input & { decision: 'abandon-wait-as-unknown' }) { const { read } = await original(input); return abandonTtrpgOpenPublicSituationWaitV1({ ...read, decision: input.decision }) }
export async function finishTtrpgOpenPublicSituationDeskV1(input: Input) {
  const page = await readTtrpgOpenPublicSituationDeskV1(input)
  if (!page?.epochKey) throw new Error('没有本人可结束的共同请求。')
  return finishTtrpgOpenPublicSituationDraftV1({ ...input, epochKey: page.epochKey })
}
export async function enableTtrpgOpenPublicSituationDeskV1(input: Input & { templateKey: string; submissionKey: string }) {
  const page = await readTtrpgOpenPublicSituationDeskV1(input)
  if (!page?.canEnable || !page.accepted.some(r => r.templateKey === input.templateKey)) throw new Error('请先结束当前窗口和待结算业务，再单独启用已保存局势。')
  return activateTtrpgOpenSessionSituationV1({ ...await envelope(input.sessionId, 'public.situation.enable.' + key(input.submissionKey)), viewerKey: input.viewerKey, templateKey: input.templateKey })
}
