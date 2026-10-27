/** Human desk adapter for the registered entity request. Reads never send, repair, adopt or create. */
import type { TtrpgOpenEntityDeskInputV1 } from './open-entity-desk'
import type { TtrpgOpenEntityModelSelectionV1 } from './open-entity-model-contract'
import { parseTtrpgOpenEntityModelSelectionV1 } from './open-entity-model-contract'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { loadTtrpgOpenEntityContextV1 } from './open-entity-context'
import { assertTtrpgOpenEntityHumanReaderV1, readTtrpgOpenEntityCandidateV1 } from './open-entity-candidate'
import { readTtrpgOpenModelCallRunsV1, readTtrpgOpenOriginalLocalCallRunV1 } from './open-model-call-evidence'
import { assertTtrpgOpenModelActorV1 } from './open-model-purpose'
import { generateTtrpgOpenEntityCandidateV1, executeTtrpgOpenEntityRequestV1 } from './open-intent-harness'
import { acceptTtrpgOpenEntityCandidateV1 } from './runtime-commands'
import { closeTtrpgOpenEpochV1 } from './runtime-commands'
import { reconcileTtrpgOpenEntityRunV1 } from './open-entity-adoption'
import { finishTtrpgOpenEntityDraftV1, reconcileTtrpgOpenStoppedEntityV1 } from './open-entity-stop'
import { repairTtrpgOpenEntityResponseReceiptV1, abandonTtrpgOpenEntityWaitV1 } from './open-situation-request-recovery'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import * as p from './open-contract-parse'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
import { ttrpgOpenCallBudgetV1 } from './open-model-calls'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'

type Input = TtrpgOpenEntityDeskInputV1
type Transport = Pick<Parameters<typeof generateTtrpgOpenEntityCandidateV1>[0], 'aiConfig' | 'runAI' | 'signal'>
const activeRun = (status: string) => !['cancelled', 'failed', 'completed'].includes(status)
async function exactOwner(input: Input, call: TtrpgOpenModelCallV1, rows: Awaited<ReturnType<typeof readTtrpgOpenModelCallRunsV1>>) {
  return readTtrpgOpenOriginalLocalCallRunV1({ ...input, call, runs: rows })
}
async function envelope(sessionId: number, commandId: string) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, commandId, baseSequence: v.sequence, baseStateHash: v.stateHash }
}
export async function readTtrpgOpenEntityModelDeskV1(input: Input & { requestKey?: string }) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  if (!loaded.humanHost) return null
  const { runtime } = loaded, run = runtime.openRun!
  const epoch = run.coordination.epochs.find(e => e.epochKey === run.coordination.activeEpochKey)
  const budget = epoch ? ttrpgOpenCallBudgetV1(epoch, run.coordination.calls) : null
  const own = run.coordination.calls.filter(c => c.entityProposal && run.coordination.epochs.some(e => e.epochKey === c.authorizationEpochKey && e.viewerKey === input.viewerKey))
  let modelAllowed = loaded.content.campaign.runtimePolicy.enabled
  try { assertTtrpgOpenModelActorV1(loaded.authorization, 'prose.ttrpg-open-entity-propose', 'gm', input.viewerKey) } catch { modelAllowed = false }
  if (!modelAllowed && !own.length) { await loaded.assertCurrent(); return null }
  const readable = own.filter(call => { try { assertTtrpgOpenEntityHumanReaderV1(loaded, call, input.viewerKey); return true } catch { return false } })
  const owners = readable.length ? await readTtrpgOpenModelCallRunsV1({ ...input, calls: readable }) : []
  const requests = own.map(call => ({ requestKey: call.requestKey, status: call.status,
    audience: readable.includes(call) ? call.entityProposal!.scope.audience : 'restricted' as const }))
  const call = input.requestKey ? own.find(c => c.requestKey === input.requestKey) : own[own.length - 1]
  const snapshot = call && readable.includes(call) ? await exactOwner(input, call, owners) : null
  const read = call && snapshot ? { ...input, requestKey: call.requestKey, runId: snapshot.run.id! } : null
  const originalEpoch = call && run.coordination.epochs.find(e => e.epochKey === call.authorizationEpochKey)
  const currentWindow = Boolean(call && epoch?.epochKey === call.authorizationEpochKey && epoch?.viewerKey === input.viewerKey)
  let modelIdentity: { provider: string; model: string } | null = null
  if (read && call) {
    const rendered = p.object(p.json(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'rendered-request', contentHash: call.requestHash })), 'original entity request')
    const model = p.record(rendered.modelIdentity, ['provider', 'model'], 'original entity model')
    modelIdentity = { provider: p.text(model.provider, 'original provider', 64), model: p.text(model.model, 'original model', 200) }
  }
  const adopted = call && run.entityOperations?.find(o => o.plan.version === 2 && o.plan.modelOrigin.call.requestKey === call.requestKey)
  let candidate = null, candidateUnavailable = false
  if (read && call?.status === 'succeeded') {
    try { candidate = await readTtrpgOpenEntityCandidateV1(read) } catch { candidateUnavailable = true }
  }
  let context: Awaited<ReturnType<typeof loadTtrpgOpenEntityContextV1>> | null = null, unavailable = ''
  try {
    if (!modelAllowed) throw new Error('当前没有新模型起草授权。')
    if (!epoch || epoch.viewerKey !== input.viewerKey) throw new Error('请先开始本次实体咨询并保存原结果。')
    context = await loadTtrpgOpenEntityContextV1({ ...input, actorKey: 'gm' })
    if (context.readEvidence.sequence !== loaded.state.lastSequence || context.readEvidence.stateHash !== loaded.stateHash) throw new TtrpgOpenReadConflictV1('读取实体起草资料期间进度已变化。')
    if (budget?.pending || budget?.blockedByUnknown) unavailable = '请先处理原模型请求及尚未确认的结果。'
    else if (budget?.blockedByDenial) unavailable = '原模型请求被拒绝，本次窗口不再发送；请保留原记录并结束咨询。'
    else if (budget && (budget.countedRequests >= epoch.budget.maximumCalls || budget.committedOrReservedTokens >= epoch.budget.maximumTokens)) unavailable = '本次原咨询的模型预算已用完，请处理已有候选并结束咨询。'
  } catch (error) {
    if (error instanceof TtrpgOpenReadConflictV1) throw error
    unavailable = '当前不能新起草：请核对本桌 AI 授权、原咨询、暂停或待确认计划。'
  }
  const catalog = context?.directory.map(d => ({ oracleSourceRef: d.sourceRef, scope: d.scope,
    epochInputRevision: context!.epochInputRevision,
    recipientNames: d.scope.recipientActorKeys.map(key => loaded.state.entities[key]?.name ?? '已授权角色'),
    templates: d.templates.map(t => {
      const value = p.object(context!.resources.find(r => r.suffix === t.suffix)!.value, 'entity desk template')
      return { key: t.templateKey, kind: p.oneOf(value.kind, ['actor', 'location', 'item'], 'entity desk kind'),
        description: p.text(value.description, 'entity desk description'), instanceCost: p.integer(value.instanceCost, 'entity desk cost', 1, 3),
        remaining: p.integer(value.remainingInstances, 'entity desk remaining', 1, Number.MAX_SAFE_INTEGER) }
    }),
    placements: d.placements.map(t => {
      const value = p.object(context!.resources.find(r => r.suffix === t.suffix)!.value, 'entity desk placement')
      return { key: t.entityKey, name: p.text(value.name, 'entity desk placement name'), use: p.oneOf(value.use, ['location', 'inventory-owner'], 'entity desk placement use') }
    }) })) ?? []
  const observed = Boolean(call && snapshot?.events.some(e => (e.type === 'model.responded' || e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')
    && e.payload.stepId === call.stepId && e.payload.attempt === call.attempt))
  const live = Boolean(snapshot && activeRun(snapshot.projection.state))
  const usable = Boolean(candidate?.proposals?.length && ['ready', 'usable-with-warnings'].includes(candidate.artifact.status))
  const fresh = Boolean(context && call && context.visibilityHash === call.visibilityHash && context.admissionStateHash === call.admissionStateHash)
  const unused = readable.filter(c => !run.entityOperations?.some(o => o.plan.version === 2 && o.plan.modelOrigin.call.requestKey === c.requestKey))
  const canCloseWindow = Boolean(epoch?.viewerKey === input.viewerKey && unused.some(c => c.authorizationEpochKey === epoch.epochKey)
    && !epoch.manualAction && !(epoch.hostingDelegation && !epoch.hostingDelegation.stoppedRef)
    && !run.entityOperations?.some(o => !o.resolution) && !run.operations.some(o => ['executing', 'awaiting-approval'].includes(o.status))
    && !run.coordination.calls.some(c => c.authorizationEpochKey === epoch.epochKey && ['prepared', 'dispatched'].includes(c.status)))
  let stopRepairCount = 0
  if (originalEpoch?.status === 'closed') for (const other of unused.filter(c => c.authorizationEpochKey === originalEpoch.epochKey)) {
    const original = other === call ? snapshot : await exactOwner(input, other, owners)
    if (original && activeRun(original.projection.state)) stopRepairCount++
  }
  if (!catalog.length && !unavailable) unavailable = '原咨询目前没有可用的实体模板或创建名额。'
  await loaded.assertCurrent()
  return { sequence: loaded.state.lastSequence, requests, catalog, canRequest: Boolean(context && !unavailable && catalog.length), unavailable,
    closeWindowEpochKey: canCloseWindow ? epoch!.epochKey : null,
    budget: budget && epoch ? { remainingCalls: Math.max(0, epoch.budget.maximumCalls - budget.countedRequests),
      remainingCostUsd: Math.max(0, epoch.budget.maximumCostUsd - budget.committedOrReservedCostUsd) } : null,
    request: call ? { requestKey: call.requestKey, status: call.status, local: Boolean(read), modelIdentity, currentWindow, observed,
      adopted: Boolean(adopted), canResume: Boolean(read && live && currentWindow && context && call.status === 'prepared'),
      canRepairResponse: Boolean(read && live && !adopted && (call.status === 'succeeded' && (!candidate || candidateUnavailable) || currentWindow && call.status === 'dispatched' && observed)),
      canAdopt: Boolean(read && live && currentWindow && fresh && usable && !adopted && !budget?.pending && !budget?.blockedByUnknown),
      canFinish: Boolean(read && currentWindow && !adopted),
      canRepairStop: Boolean(read && stopRepairCount),
      canRepairAdoption: Boolean(read && adopted && snapshot?.projection.state !== 'completed'),
      candidate: candidate ? { candidateHash: candidate.candidateHash, status: candidate.artifact.status,
        items: (candidate.proposals ?? []).map(proposal => {
          const template = loaded.content.campaign.dynamicEntityTemplates.find(t => t.templateKey === proposal.templateKey)
          if (!template) throw new Error('原实体候选的冻结模板不可读取，请保留原记录。')
          const target = proposal.ownerRef ?? proposal.locationRef
          const name = target ? loaded.state.entities[target]?.name ?? '原已授权对象' : ''
          return { kind: template.kind, name: proposal.name, description: proposal.description, parameterValues: Object.values(proposal.parameters),
            placement: proposal.ownerRef ? `加入${name}的库存` : proposal.locationRef ? `位于${name}` : '建立独立地点' }
        }),
        audience: candidate.selection.scope.audience, recipients: candidate.selection.scope.recipientActorKeys.map(key => loaded.state.entities[key]?.name ?? '原接收者') } : null } : null }
}
async function original(input: Input & { requestKey: string }) {
  const page = await readTtrpgOpenEntityModelDeskV1(input), request = page?.request
  if (!page || !request || request.requestKey !== input.requestKey || !request.local) throw new Error('原实体请求仅供历史查阅，不能恢复发送或采用权限。')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const call = loaded.runtime.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey)!
  assertTtrpgOpenEntityHumanReaderV1(loaded, call, input.viewerKey)
  const owners = await readTtrpgOpenModelCallRunsV1({ ...input, calls: [call] })
  const owner = await exactOwner(input, call, owners)
  if (!owner) throw new Error('原本地实体请求不存在，不创建替代请求。')
  await loaded.assertCurrent()
  return { page, request, read: { ...input, runId: owner.run.id! }, call }
}
export async function requestTtrpgOpenEntityModelDeskV1(input: Input & Transport & {
  submissionKey: string; expectedSequence: number; selection: TtrpgOpenEntityModelSelectionV1; maximumCostUsd: number;
  decision: 'request-this-entity-draft'; onPrepared?: (requestKey: string) => void | Promise<void>;
}) {
  if (input.decision !== 'request-this-entity-draft') throw new Error('请明确同意按本次范围、模板和预算起草。')
  if (!/^[a-zA-Z0-9._-]{1,96}$/.test(input.submissionKey)) throw new Error('操作标识无效，请重新读取。')
  const page = await readTtrpgOpenEntityModelDeskV1(input), selection = parseTtrpgOpenEntityModelSelectionV1(input.selection)
  const maximumCostUsd = p.number(input.maximumCostUsd, '本次实体起草预留上限', 0, 1000)
  if (!page?.canRequest || page.sequence !== input.expectedSequence
    || maximumCostUsd > (page.budget?.remainingCostUsd ?? 0)
    || !page.catalog.some(d => d.scope.scopeKey === selection.scope.scopeKey && d.oracleSourceRef.sessionKey === selection.oracleSourceRef.sessionKey
      && d.oracleSourceRef.sequence === selection.oracleSourceRef.sequence && d.epochInputRevision === selection.epochInputRevision)) throw new Error('实体起草的原咨询或资料已变化，请重新读取并确认。')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  if (loaded.state.lastSequence !== page.sequence) throw new TtrpgOpenReadConflictV1('准备实体起草期间进度已变化。')
  const maximumOutputTokens = Math.min(getAgentSkillV1('prose.ttrpg-open-entity-propose').maxOutputTokens, loaded.content.campaign.runtimePolicy.maximumOutputTokens)
  await loaded.assertCurrent()
  const result = await generateTtrpgOpenEntityCandidateV1({ ...input, selection, maximumCostUsd, maximumOutputTokens,
    commandId: 'entity.model.desk.' + input.submissionKey, baseSequence: loaded.state.lastSequence, baseStateHash: loaded.stateHash,
    onPrepared: request => input.onPrepared?.(request.requestKey) })
  return { requestKey: result.prepared.requestKey }
}
export async function resumeTtrpgOpenEntityModelDeskV1(input: Input & Transport & { requestKey: string }) {
  const f = await original(input)
  if (!f.request.canResume) throw new Error('原实体请求当前不能继续发送；请核对原状态与模型。')
  return executeTtrpgOpenEntityRequestV1({ ...input, ...f.read }).then(() => ({ requestKey: input.requestKey }))
}
export async function acceptTtrpgOpenEntityModelDeskV1(input: Input & { requestKey: string; candidateHash: string; decision: 'reviewed-this-model-entity-candidate' }) {
  const f = await original(input)
  if (!f.request.canAdopt || f.request.candidate?.candidateHash !== input.candidateHash) throw new Error('原实体候选或资料已变化，当前不能采用。')
  const event = await acceptTtrpgOpenEntityCandidateV1({ ...await envelope(input.sessionId, 'entity.model.desk.adopt'), ...f.read,
    candidateHash: input.candidateHash, decision: input.decision })
  return { sequence: event.sequence }
}
export async function repairTtrpgOpenEntityModelDeskV1(input: Input & { requestKey: string }) {
  const f = await original(input)
  if (f.request.canRepairAdoption) {
    const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
    const plan = loaded.runtime.openRun!.entityOperations!.find(o => o.plan.version === 2 && o.plan.modelOrigin.call.requestKey === input.requestKey)!.plan
    if (plan.version !== 2) throw new Error('原模型实体计划不存在。')
    await reconcileTtrpgOpenEntityRunV1({ ...f.read, candidateHash: plan.modelOrigin.candidateHash })
  } else if (f.request.canRepairStop) await reconcileClosedUnusedWindow(input, f.call.authorizationEpochKey)
  else if (f.request.canRepairResponse) await repairTtrpgOpenEntityResponseReceiptV1(f.read)
  else throw new Error('原实体请求没有需要补齐的本地回执。')
}
export async function finishTtrpgOpenEntityModelDeskV1(input: Input & { requestKey: string; decision: 'discard-this-entity-request-and-close-window' }) {
  if (input.decision !== 'discard-this-entity-request-and-close-window') throw new Error('请明确放弃本次 AI 起草并结束原咨询，保留原回答与费用。')
  let f = await original(input)
  if (f.request.adopted) throw new Error('原候选已保存为待确认计划，请单独确认或放弃该计划。')
  if (f.request.canRepairStop) return reconcileClosedUnusedWindow(input, f.call.authorizationEpochKey)
  if (!f.request.canFinish) throw new Error('本次原咨询已经结束。')
  if (f.call.status === 'dispatched' && f.request.observed) { await repairTtrpgOpenEntityResponseReceiptV1(f.read); f = await original(input) }
  if (f.call.status === 'dispatched') await abandonTtrpgOpenEntityWaitV1({ ...f.read, decision: 'abandon-wait-as-unknown' })
  else await finishTtrpgOpenEntityDraftV1({ ...f.read, decision: input.decision })
  await reconcileClosedUnusedWindow(input, f.call.authorizationEpochKey)
}
/** The original saved close receipt authorizes cleanup of that window's unused local drafts only. */
async function reconcileClosedUnusedWindow(input: Input, epochKey: string) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const run = loaded.runtime.openRun!, epoch = run.coordination.epochs.find(e => e.epochKey === epochKey)
  if (!loaded.humanHost || epoch?.viewerKey !== input.viewerKey || epoch.status !== 'closed' || !epoch.closedRef) throw new Error('原咨询没有本人的实际结束回执。')
  const calls = run.coordination.calls.filter(c => c.entityProposal && c.authorizationEpochKey === epochKey
    && !run.entityOperations?.some(o => o.plan.version === 2 && o.plan.modelOrigin.call.requestKey === c.requestKey))
  const permitted = calls.filter(c => { try { assertTtrpgOpenEntityHumanReaderV1(loaded, c, input.viewerKey); return true } catch { return false } })
  const owners = permitted.length ? await readTtrpgOpenModelCallRunsV1({ ...input, calls: permitted }) : []
  await loaded.assertCurrent()
  for (const call of permitted) {
    const original = await exactOwner(input, call, owners)
    if (original && activeRun(original.projection.state)) await reconcileTtrpgOpenStoppedEntityV1({ ...input, requestKey: call.requestKey, runId: original.run.id! })
  }
}
export async function closeTtrpgOpenEntityModelWindowDeskV1(input: Input & {
  epochKey: string; decision: 'close-this-consultation-and-discard-unused-ai-drafts';
}) {
  if (input.decision !== 'close-this-consultation-and-discard-unused-ai-drafts') throw new Error('请明确结束本次咨询，保留所有原回答与费用，并放弃未采用草稿。')
  const page = await readTtrpgOpenEntityModelDeskV1(input)
  if (page?.closeWindowEpochKey !== input.epochKey) throw new Error('本次原咨询不能结束，请先处理当前请求、行动或待确认计划。')
  await closeTtrpgOpenEpochV1({ ...await envelope(input.sessionId, 'entity.model.desk.close.' + input.epochKey), viewerKey: input.viewerKey,
    epochKey: input.epochKey, reason: '真人明确结束本次实体咨询并放弃未采用 AI 草稿；保留原回答、实际费用和已采用计划。' })
  await reconcileClosedUnusedWindow(input, input.epochKey)
}
