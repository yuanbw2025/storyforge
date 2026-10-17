/** Human recap desk. Reads never send, repair, adopt, or inherit an imported Run's authority. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { assertTtrpgOpenBriefEpochAuthorityV1 } from './open-coordination'
import { assertTtrpgOpenModelActorV1 } from './open-model-purpose'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, acceptTtrpgOpenBriefMemoryV1 } from './runtime-commands'
import { generateTtrpgOpenBriefCandidateV1, executeTtrpgOpenBriefRequestV1, recoverTtrpgOpenRuntimeCandidateV1 } from './open-intent-harness'
import { readTtrpgOpenBriefCandidateV1 } from './open-brief-candidate'
import { reconcileTtrpgOpenBriefMemoryRunV1 } from './open-brief-adoption'
import { cancelTtrpgOpenPreparedRequestV1 } from './open-request-cancellation'
import { readTtrpgOpenImportedCallOwnerV1 } from './open-run-portability'
import { readInstanceAgentRunV1, appendAgentRunEventV1, AgentRunStoreError } from '../agent/run/event-store'

export interface TtrpgOpenBriefDeskInputV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string }
type Transport = Pick<Parameters<typeof generateTtrpgOpenBriefCandidateV1>[0], 'aiConfig' | 'runAI' | 'signal'>
async function envelope(sessionId: number, commandId: string) {
  const current = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, commandId, baseSequence: current.sequence, baseStateHash: current.stateHash }
}
export async function readTtrpgOpenBriefDeskV1(input: TtrpgOpenBriefDeskInputV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  if (!loaded.humanHost) return null
  const { runtime, content } = loaded, run = runtime.openRun!
  const active = run.coordination.epochs.find(epoch => epoch.epochKey === run.coordination.activeEpochKey)
  const epochs = run.coordination.epochs.filter(epoch => epoch.triggerKind === 'request-brief' && epoch.viewerKey === input.viewerKey)
  const epoch = active?.triggerKind === 'request-brief' && active.viewerKey === input.viewerKey ? active : epochs[epochs.length - 1]
  const call = epoch && run.coordination.calls.find(call => call.authorizationEpochKey === epoch.epochKey)
  const owners = call ? (await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray())
    .filter(row => row.contractHash === call.runContractHash && !row.portableRuntimeOriginJson) : []
  if (owners.length > 1) throw new Error('复盘原请求不能唯一定位，请先核对原记录。')
  const owner = owners[0], id = call && owner?.id ? { ...input, runId: owner.id, requestKey: call.requestKey } : null
  const snapshot = id ? await readInstanceAgentRunV1(input.scope, id.runId) : null
  const candidate = id && call?.status === 'succeeded' ? await readTtrpgOpenBriefCandidateV1(id) : null
  const saved = call ? run.memoryReceipts?.find(receipt => receipt.version === 2 && receipt.model.requestKey === call.requestKey) : undefined
  const rejected = Boolean(call && snapshot?.projection.steps[call.stepId]?.confirmation === 'reject')
  let canRequest = false, unavailable = ''
  try {
    if (!content.campaign.runtimePolicy.enabled || runtime.product.safety.status !== 'active') throw new Error('当前冒险尚未允许 AI 复盘，或已暂停。')
    assertTtrpgOpenModelActorV1(runtime.authorization!, 'prose.ttrpg-open-brief', 'gm', input.viewerKey)
    if (active) throw new Error(active.triggerKind === 'request-brief' ? '请先处理或结束当前复盘。' : '请先完成并结束当前主持窗口，再请求复盘。')
    assertTtrpgOpenBriefEpochAuthorityV1(runtime, input.viewerKey)
    canRequest = true
  } catch (cause) { unavailable = cause instanceof Error ? cause.message : String(cause) }
  await loaded.assertCurrent()
  return { sequence: loaded.state.lastSequence, canRequest, unavailable, actors: content.campaign.characterTemplates.map(actor => ({ key: actor.characterKey, name: actor.name })),
    currentWindow: Boolean(epoch && active?.epochKey === epoch.epochKey),
    request: call ? { requestKey: call.requestKey, status: call.status, local: Boolean(id), read: id } : null,
    candidate, rejected, saved: Boolean(saved), receiptPending: Boolean(saved && snapshot?.projection.state !== 'completed' && id),
    canConfirm: Boolean(id && candidate?.brief && ['ready', 'usable-with-warnings'].includes(candidate.artifact.status)
      && active?.epochKey === candidate.epochKey && !saved && !rejected) }
}
export async function requestTtrpgOpenBriefDeskV1(input: TtrpgOpenBriefDeskInputV1 & Transport & { submissionKey: string; rawInput: string; maximumCostUsd: number }) {
  if (input.signal?.aborted) throw input.signal.reason ?? new Error('复盘已取消。')
  const page = await readTtrpgOpenBriefDeskV1(input)
  if (!page?.canRequest) throw new Error(page?.unavailable ?? '只有当前真人主持可以请求共同复盘。')
  if (!/^[a-zA-Z0-9._-]{1,96}$/.test(input.submissionKey) || !Number.isFinite(input.maximumCostUsd) || input.maximumCostUsd < 0 || input.maximumCostUsd > 1000) throw new Error('请填写有效的调用预留上限。')
  if (!input.aiConfig && !input.runAI) throw new Error('请先配置明确的模型。')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const maximumOutputTokens = Math.min(getAgentSkillV1('prose.ttrpg-open-brief').maxOutputTokens, loaded.content.campaign.runtimePolicy.maximumOutputTokens)
  await startTtrpgOpenEpochV1({ ...await envelope(input.sessionId, `brief.desk.${input.submissionKey}`), viewerKey: input.viewerKey, triggerKind: 'request-brief', rawInput: input.rawInput })
  return generateTtrpgOpenBriefCandidateV1({ ...input, ...await envelope(input.sessionId, `brief.prepare.${input.submissionKey}`), maximumOutputTokens })
}
async function currentRead(input: TtrpgOpenBriefDeskInputV1) {
  const page = await readTtrpgOpenBriefDeskV1(input), read = page?.request?.read
  if (!page || !read) throw new Error('原复盘仅供历史查阅，或当前身份没有原请求权限。')
  return { page, read }
}
export async function resumeTtrpgOpenBriefDeskV1(input: TtrpgOpenBriefDeskInputV1 & Transport) {
  const { page, read } = await currentRead(input)
  if (page.request?.status !== 'prepared' || !page.currentWindow) throw new Error('只能明确继续原来尚未发送的复盘请求。')
  return executeTtrpgOpenBriefRequestV1({ ...read, ...input })
}
export async function recoverTtrpgOpenBriefDeskCandidateV1(input: TtrpgOpenBriefDeskInputV1) {
  const { page, read } = await currentRead(input)
  if (page.request?.status !== 'succeeded') throw new Error('只有已保存成功回答的复盘可以恢复候选。')
  return recoverTtrpgOpenRuntimeCandidateV1(read)
}
export async function confirmTtrpgOpenBriefDeskV1(input: TtrpgOpenBriefDeskInputV1 & { candidateHash: string }) {
  const { page, read } = await currentRead(input)
  if (page.candidate?.candidateHash !== input.candidateHash || !page.canConfirm && !page.saved) throw new Error('复盘版本已变化、不可确认或已被放弃。')
  return acceptTtrpgOpenBriefMemoryV1({ ...read, ...await envelope(input.sessionId, 'brief.desk.confirm'), candidateHash: input.candidateHash })
}
export async function repairTtrpgOpenBriefDeskReceiptV1(input: TtrpgOpenBriefDeskInputV1 & { candidateHash: string }) {
  const { page, read } = await currentRead(input)
  if (!page.saved || page.candidate?.candidateHash !== input.candidateHash) throw new Error('没有此版本已保存的复盘记忆。')
  return reconcileTtrpgOpenBriefMemoryRunV1({ ...read, candidateHash: input.candidateHash })
}
export async function rejectTtrpgOpenBriefDeskV1(input: TtrpgOpenBriefDeskInputV1 & { candidateHash: string }) {
  const { page, read } = await currentRead(input)
  if (page.saved || page.candidate?.candidateHash !== input.candidateHash) throw new Error('已保存的复盘或其他版本不能被改写为放弃。')
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await readInstanceAgentRunV1(input.scope, read.runId), step = snapshot.projection.steps['ttrpg.open.brief']
    if (step?.confirmation === 'adopt' || snapshot.projection.state === 'completed') throw new Error('此复盘已经确认保存。')
    if (snapshot.projection.state === 'cancelled') return
    try {
      if (step?.confirmation !== 'reject') await appendAgentRunEventV1({ ...read, productRuntimeSessionId: input.sessionId, type: 'confirmation.recorded', payload: { stepId: 'ttrpg.open.brief', candidateHash: input.candidateHash, decision: 'reject' }, expectedLastSequence: snapshot.projection.lastSequence })
      else await appendAgentRunEventV1({ ...read, productRuntimeSessionId: input.sessionId, type: 'run.cancelled', payload: { reason: 'human-declined-stage-recap' }, expectedLastSequence: snapshot.projection.lastSequence })
    } catch (cause) { if (!(cause instanceof AgentRunStoreError && cause.code === 'sequence_conflict')) throw cause }
  }
  throw new Error('放弃记录正在保存，请读取后重试；不会再次发送。')
}
export async function cancelTtrpgOpenBriefDeskPreparedV1(input: TtrpgOpenBriefDeskInputV1) {
  const page = await readTtrpgOpenBriefDeskV1(input), requestKey = page?.request?.requestKey
  if (!requestKey || page.request?.status !== 'prepared') throw new Error('只能取消原来尚未发送的复盘。')
  const read = page.request.read ?? (await readTtrpgOpenImportedCallOwnerV1({ ...input, requestKey }))
  if (!read) throw new Error('原请求证明不完整，不能取消记账。')
  return cancelTtrpgOpenPreparedRequestV1({ ...input, requestKey, runId: read.runId })
}
export async function finishTtrpgOpenBriefDeskV1(input: TtrpgOpenBriefDeskInputV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(epoch => epoch.epochKey === loaded.runtime.openRun!.coordination.activeEpochKey)
  if (!loaded.humanHost || !epoch || epoch.triggerKind !== 'request-brief' || epoch.viewerKey !== input.viewerKey) throw new Error('当前没有本人可结束的复盘。')
  return closeTtrpgOpenEpochV1({ ...await envelope(input.sessionId, 'brief.desk.finish'), viewerKey: input.viewerKey, epochKey: epoch.epochKey,
    reason: loaded.runtime.openRun!.coordination.calls.some(call => call.authorizationEpochKey === epoch.epochKey && call.status === 'unknown')
      ? '真人明确结束结果未知的复盘，保留原请求与费用待核对，不重发' : '真人明确结束本次复盘' })
}
