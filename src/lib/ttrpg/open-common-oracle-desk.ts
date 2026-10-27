import { verifyTtrpgOpenOracleJournalV1 } from './open-oracle-contract'
import { verifyTtrpgOpenFactLedger } from './open-fact-ledger'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { verifyTtrpgOpenModelCallEvidenceV1 } from './open-model-call-evidence'
import { readTtrpgOpenImportedCallOwnerV1 } from './open-run-portability'
import { reviewTtrpgOpenCommonOracleDeliveryV1 } from './open-common-oracle-delivery'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
/** Minimal current-human projection. No GM desk, private prompt, implicit send, repair or adoption. */
import { db } from '../db/schema'
import type { TtrpgOpenFactDeskInputV1 as Input } from './open-fact-desk'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { loadTtrpgOpenCommonOracleContextV1 } from './open-common-oracle-context'
import { assertTtrpgOpenCommonOracleEpochAuthorityV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { assertTtrpgOpenOracleInterpretationSlotV1 } from './open-model-calls'
import { assertTtrpgOpenCommonOracleArchiveReaderV1 } from './open-common-oracle-archive-contract'
import { prepareTtrpgOpenCommonOracleArchiveForKernelV1, archiveTtrpgOpenUnresumableCommonOracleWindowV1 } from './open-common-oracle-archive'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readTtrpgOpenCommonOracleCandidateV1 } from './open-common-oracle-candidate'
import { verifyTtrpgOpenCommonOracleAuthorizationV1 } from './open-common-oracle-authorization-proof'
import { startTtrpgOpenCommonOracleWindowV1, finishTtrpgOpenEmptyCommonOracleWindowV1 } from './open-common-oracle-window'
import { prepareTtrpgOpenCommonOracleInputV1 } from './open-intent-input'
import { executeTtrpgOpenCommonOracleRequestV1 } from './open-intent-harness'
import { reviewTtrpgOpenCommonOracleCandidateV1 } from './runtime-commands'
import { closeTtrpgOpenReviewedCommonOracleWindowV1 } from './open-common-oracle-close'
import { reconcileTtrpgOpenOracleFactRunV1, TtrpgOpenOracleReceiptPendingError } from './open-oracle-adoption'
import { finishTtrpgOpenCommonOracleDraftV1, reconcileTtrpgOpenStoppedCommonOracleV1 } from './open-runtime-draft-stop'
import { repairTtrpgOpenCommonOracleResponseReceiptV1, abandonTtrpgOpenCommonOracleWaitV1 } from './open-situation-request-recovery'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { resolveRequestConfig } from '../ai/client'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { TTRPG_FACT_PREDICATE_LABELS_V1 as predicates, ttrpgOpenFactScalarLabelV1 as scalar } from './open-fact-desk-contract'
import type { TtrpgOpenOracleFactProposalV1 } from './open-fact-ledger'
import type { TtrpgOpenOracleReviewChoiceV1 } from './open-oracle-review'
import { verifyTtrpgOpenOracleReviewHashesV1 } from './open-oracle-review'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import * as p from './open-contract-parse'

type Transport = Pick<Parameters<typeof executeTtrpgOpenCommonOracleRequestV1>[0], 'aiConfig' | 'runAI' | 'signal'>
const formatFact = (row: TtrpgOpenOracleFactProposalV1, index: number) => ({ index, subject: row.subjectRef, predicate: predicates[row.predicateKey],
  object: row.objectRef, value: scalar(row.canonicalValue), detail: row.detail, audience: row.audience, recipients: row.knownByActorKeys,
  sources: row.sourceFactRefs, supersedes: row.supersedes, supersedeReason: row.supersedeReason })
function projectCommonPacket(packet: Record<string, unknown>) {
  const describe = (fact: Record<string, unknown>) => {
    if (typeof fact.detail === 'string') return fact.detail
    const value = fact.canonicalValue
    if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') throw new Error('共同事实值无效')
    const predicate = p.key(fact.predicateKey, 'common fact predicate'), label = Object.entries(predicates).find(([key]) => key === predicate)?.[1] ?? predicate
    return p.key(fact.subjectRef, 'common fact subject') + ' · ' + label + '：' + scalar(value)
  }
  const facts = [
    ...p.list(packet.permittedFrozenFacts, 'common frozen facts', value => '发行版本资料：' + describe(p.object(value, 'common frozen fact')), 10000, 0),
    ...p.list(packet.permittedSessionFacts, 'common session facts', value => '本局已确认记录：' + describe(p.object(value, 'common session fact')), 10000, 0),
  ]
  return { facts, entities: p.list(packet.permittedEntityRefs, 'common identities', value => {
    const identity = p.object(value, 'common identity')
    return { name: typeof identity.name === 'string' ? identity.name : p.key(identity.entityRef, 'common identity key'), kind: p.key(identity.kind, 'common identity kind') }
  }, 10000, 0) }
}
async function humanOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch (error) {
    if (error instanceof TtrpgOpenReadConflictV1) throw new TtrpgOpenReadConflictV1('共同事实进度已变化，请重新读取。')
    if (error instanceof TtrpgOpenOracleReceiptPendingError) throw new Error('原共同审阅决定已保存，终验回执尚待补齐；请读取原进度。')
    throw new Error('原共同操作尚未完成，请读取进度并核对身份、原记录、资料或模型配置。')
  }
}
async function envelope(sessionId: number, commandId: string) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, commandId, baseSequence: v.sequence, baseStateHash: v.stateHash }
}
async function owner(input: Input) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  if (!loaded.humanHost || loaded.authorization.seats.find(row => row.role === 'gm')?.controller !== 'ai') return null
  const { runtime, content, source } = loaded, run = runtime.openRun!
  await verifyTtrpgOpenOracleJournalV1({ receipts: run.oracleReceipts ?? [], rulePack: content.rulePack.content, sessionKey: runtime.sessionKey,
    seed: loaded.session.seed, ancestors: runtime.branchLineage?.ancestors ?? [] })
  await verifyTtrpgOpenFactLedger({ ledger: run.factLedger, content, runtimeSourceHash: source.runtimeSourceHash,
    oracleReceipts: run.oracleReceipts ?? [], entityOperations: run.entityOperations, storyFacts: runtime.product.effectLedger.storyFacts })
  await verifyTtrpgOpenOracleReviewHashesV1(run.oracleReviews ?? [])
  await loaded.assertCurrent()
  return loaded
}
export async function readTtrpgOpenCommonOracleDeskV1(input: Input & { requestKey?: string }) {
  try { return await readDesk(input) } catch (error) {
    if (error instanceof TtrpgOpenReadConflictV1) throw new TtrpgOpenReadConflictV1('共同事实进度在读取期间变化，请重新读取。')
    throw new Error('当前不能读取本人的共同事实进度，请核对身份与原记录。')
  }
}
async function readDesk(input: Input & { requestKey?: string }) {
  const loaded = await owner(input)
  if (!loaded) return null
  const { runtime } = loaded, run = runtime.openRun!
  const epochs = run.coordination.epochs.filter(epoch => {
    if (!epoch.commonOracle) return false
    try { assertTtrpgOpenCommonOracleArchiveReaderV1(runtime, epoch, input.viewerKey); return true } catch { return false }
  })
  const epoch = input.requestKey ? epochs.find(row => row.commonOracle!.requestKey === input.requestKey)
    : epochs.find(row => row.epochKey === run.coordination.activeEpochKey) ?? epochs[epochs.length - 1]
  if (input.requestKey && !epoch) throw new Error('原共同请求不属于当前本人')
  const grant = epoch?.commonOracle, call = run.coordination.calls.find(row => row.requestKey === grant?.requestKey)
  const currentWindow = Boolean(epoch && epoch.status === 'active' && epoch.epochKey === run.coordination.activeEpochKey)
  const row = grant ? await db.agentRuns.get(grant.run.runId) : undefined
  const localRow = row && row.projectId === input.scope.projectId && row.productRuntimeSessionId === input.sessionId && row.portableRuntimeOriginJson === undefined
    && row.contractJson === grant!.run.contractJson && row.contractHash === grant!.run.contractHash
  const snapshot = localRow ? await readInstanceAgentRunV1(input.scope, row.id!) : null
  const local = Boolean(snapshot && !snapshot.events.some(event => event.type === 'run.cancelled' && event.payload.reason === 'project-import-nonportable-checkpoint'))
  const read = local && grant ? { ...input, runId: grant.run.runId, requestKey: grant.requestKey } : null
  const review = grant && run.oracleReviews?.find(row => row.requestKey === grant.requestKey)
  if (review) await verifyTtrpgOpenOracleReviewHashesV1([review])
  const adopted = run.factLedger?.entries.filter(row => row.modelCandidate?.requestKey === grant?.requestKey) ?? []
  const committed = Boolean(review || adopted.length), committedHash = review?.candidateHash ?? adopted[0]?.modelCandidate?.candidateHash ?? null
  const observed = Boolean(call && snapshot?.events.some(event => (event.type === 'model.responded' || event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')
    && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt))
  const live = Boolean(local && snapshot && !['completed', 'failed', 'cancelled'].includes(snapshot.projection.state))
  let candidate: Awaited<ReturnType<typeof readTtrpgOpenCommonOracleCandidateV1>> = null, canResume = false, canReview = false
  if (read && !committed && grant) {
    if (currentWindow && (!call || call.status === 'prepared')) {
      try { await verifyTtrpgOpenCommonOracleAuthorizationV1({ ...input, authorization: grant, phase: 'prepare' }); canResume = true } catch { /* No renewed send permission. */ }
    } else if (call?.status === 'succeeded') {
      try {
        candidate = await readTtrpgOpenCommonOracleCandidateV1(read)
        if (currentWindow && candidate?.facts && candidate.interpretation && ['ready', 'usable-with-warnings'].includes(candidate.artifact.status)) {
          await verifyTtrpgOpenCommonOracleAuthorizationV1({ ...input, authorization: grant, phase: 'review' }); canReview = true
        }
      } catch { /* A stale or unsupported candidate is kept; explicit repair/stop remains separate. */ }
    }
  }
  let originalSource: ReturnType<typeof projectCommonPacket> | null = null
  let historicalResponse: { text: string } | null = null
  if (grant && call) {
    try {
      const imported = !read ? await readTtrpgOpenImportedCallOwnerV1({ ...input, requestKey: grant.requestKey }) : null
      if (imported && (imported.origin.sourceRunId !== grant.run.runId || imported.origin.contractHash !== grant.run.contractHash || imported.origin.contractJson !== grant.run.contractJson)) throw new Error('原共同请求的准确导入来源不一致')
      const proof = read ? await verifyTtrpgOpenModelCallEvidenceV1({ ...read, call, mode: 'finish' }) : imported?.evidence
      if (proof) {
        const artifacts = [...new Map(proof.artifacts.map(row => [row.artifactKind + ':' + row.contentHash, row])).values()]
        const manifests = artifacts.flatMap(row => {
          if (row.artifactKind !== 'source-snapshot') return []
          if (typeof row.content !== 'string') throw new Error('原完整共同工件不可用')
          const value = JSON.parse(row.content) as Partial<TtrpgOpenInputEvidenceV1>
          return value.schema === 'storyforge.ttrpg-open-input-evidence' && value.manifest?.manifestHash === call.inputManifestHash ? [value as TtrpgOpenInputEvidenceV1] : []
        })
        if (manifests.length !== 1) throw new Error('原共同输入证明不唯一')
        const snapshots = manifests[0].preflight.artifacts.filter(ref => ref.role === 'source-snapshot').map(ref => {
          const artifact = artifacts.find(row => row.artifactKind === ref.artifactKind && row.contentHash === ref.contentHash)
          if (!artifact || typeof artifact.content !== 'string') throw new Error('缺少原完整共同资料')
          return { sourceKey: ref.sourceKey, content: (JSON.parse(artifact.content) as { content: unknown }).content }
        })
        const delivered = await reviewTtrpgOpenCommonOracleDeliveryV1({ basis: grant.basis, content: loaded.content, snapshots })
        originalSource = projectCommonPacket(delivered.packet)
        if (imported && ['succeeded', 'dispatched'].includes(call.status)) {
          const refs = imported.origin.events.flatMap(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response'
            && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt ? [event.payload] : [])
          const hashes = [...new Set(refs.map(row => row.contentHash))]
          if (hashes.length > 1 || hashes.length === 1 && call.responseArtifactHash !== null && call.responseArtifactHash !== hashes[0]) throw new Error('原共同回答存在冲突')
          if (hashes.length === 1) {
            const text = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: hashes[0] })
            if (refs.some(row => row.byteLength !== new TextEncoder().encode(text).byteLength)) throw new Error('原共同回答字节不完整')
            historicalResponse = { text }
          }
        }
      }
    } catch { /* Missing historical bodies never become fresh input or inferred private data. */ }
    if (!originalSource) canReview = false
  }
  let unavailable = '', catalog: Array<{ oracleSourceRef: TtrpgOpenSourceRefV1; question: string; audience: 'public' | 'party'; contentHash: string; snapshotHash: string | null; result: string; facts: string[];
    recipients: string[]; entities: Array<{ name: string; kind: string }> }> = []
  try {
    if (!loaded.content.campaign.runtimePolicy.enabled) throw new Error('冻结作品尚未启用模型咨询。')
    assertTtrpgOpenCommonOracleEpochAuthorityV1(runtime, input.viewerKey)
    assertTtrpgOpenOracleInterpretationSlotV1(runtime, run.worldTime.worldTurn)
    if (run.coordination.activeEpochKey) throw new Error('请先处理并结束原来的活动窗口。')
    const source = await loadTtrpgOpenCommonOracleContextV1({ ...input, actorKey: 'gm' })
    catalog = source.directory.map(item => {
      const packet = p.object(source.resources.find(row => row.suffix === item.suffix)!.value, 'common source packet')
      const oracle = run.oracleReceipts!.find(row => stable(row.sourceRef) === stable(item.oracleSourceRef))!, outcome = oracle.resolution.outcome.rawResult
      const table = loaded.content.rulePack.content.oracles.find(row => row.oracleKey === oracle.resolution.outcome.oracleKey)!
      const result = typeof outcome === 'string' ? ({ yes: '是', 'yes-but': '是，但是…', 'no-but': '否，但是…', no: '否' }[outcome]) : table.entries?.find(row => row.entryKey === outcome.entryKey)?.text ?? '原结果已保存'
      return { oracleSourceRef: item.oracleSourceRef, question: item.question, audience: p.oneOf(item.audience, ['public', 'party'], 'common audience'), contentHash: item.contentHash,
        snapshotHash: item.snapshotHash, result, ...projectCommonPacket(packet), recipients: item.recipientActorKeys }
    })
    if (!catalog.length) unavailable = '还没有全体当前角色共同可读的原咨询。'
  } catch (error) { unavailable = error instanceof Error ? error.message : '当前不能请求共同事实。' }
  let canArchive = false
  if (grant && call && currentWindow && !local) {
    try { await prepareTtrpgOpenCommonOracleArchiveForKernelV1({ ...input, epochKey: epoch!.epochKey, requestKey: grant.requestKey, sequence: loaded.state.lastSequence + 1 }); canArchive = true } catch { /* Corrupt/ambiguous evidence must be checked separately. */ }
  }
  const reviewedTerminal = Boolean(committed && snapshot && (snapshot.projection.state === 'completed' || review?.interpretationDecision === 'reject'
    && snapshot.projection.state === 'failed' && snapshot.events.some(event => event.type === 'run.failed' && event.payload.code === 'oracle-interpretation-rejected')))
  await loaded.assertCurrent()
  return { sequence: loaded.state.lastSequence, catalog, unavailable, canRequest: !unavailable && catalog.length > 0, maximumCostUsd: runtime.epochBudget.maximumCostUsd,
    requests: epochs.map(row => ({ requestKey: row.commonOracle!.requestKey, audience: row.commonOracle!.basis.audience,
      status: run.coordination.calls.find(call => call.requestKey === row.commonOracle!.requestKey)?.status ?? 'authorized' as const, closed: row.status === 'closed' })),
    request: epoch && grant ? { requestKey: grant.requestKey, epochKey: epoch.epochKey, status: call?.status ?? 'authorized' as const, local, currentWindow,
      closed: epoch.status === 'closed', archived: Boolean(epoch.commonOracleArchive), modelIdentity: grant.basis.modelIdentity, audience: grant.basis.audience, recipients: grant.basis.recipientActorKeys,
      oracle: run.oracleReceipts?.find(row => stable(row.sourceRef) === stable(grant.basis.oracleSourceRef))?.resolution.outcome.question ?? '原共同咨询',
      failure: call?.status === 'failed' ? call.terminalReason === 'provider-denied-no-retry' ? '服务商拒绝本次调用，请核对权限、余额及模型配置；原请求不会自动重发。' : '原调用已失败或明确结束，记录保持；请核对回执后结束原窗口。' : null,
      source: originalSource, historicalResponse, observed, committed, committedHash, usage: call?.usage ? structuredClone(call.usage) : null, canResume,
      canReview, canRepairResponse: Boolean(read && live && !committed && call && (call.status === 'succeeded' && !candidate || call.status === 'dispatched' && observed)),
      canRepairReview: Boolean(read && committed && !reviewedTerminal), canRepairStop: Boolean(read && live && epoch.status === 'closed' && !committed),
      canFinish: Boolean(currentWindow && !committed && (local || !call)), canCloseReviewed: Boolean(read && currentWindow && committed), canArchive,
      candidate: candidate ? { candidateHash: candidate.candidateHash, status: candidate.artifact.status, interpretation: candidate.interpretation, facts: candidate.facts?.map(formatFact) ?? null } : null,
      review: review ? { candidateHash: review.candidateHash, interpretation: review.interpretation, interpretationDecision: review.interpretationDecision,
        interpretationReason: review.interpretationReason, choices: structuredClone(review.choices), facts: review.proposals.map(formatFact), adoptedCount: review.adoptedFactKeys.length } : null,
      confirmedFactDetails: adopted.map(row => row.fact.detail) } : null }
}

async function original(input: Input & { requestKey: string }) {
  const page = await readTtrpgOpenCommonOracleDeskV1(input), request = page?.request
  if (!page || !request || request.requestKey !== input.requestKey) throw new Error('请重新读取本人的准确原共同请求。')
  const loaded = await owner(input), epoch = loaded?.runtime.openRun!.coordination.epochs.find(row => row.epochKey === request.epochKey)
  if (!loaded || !epoch?.commonOracle) throw new Error('当前不能处理原共同请求。')
  assertTtrpgOpenCommonOracleArchiveReaderV1(loaded.runtime, epoch, input.viewerKey)
  await loaded.assertCurrent()
  return { page, request, loaded, epoch, read: { ...input, runId: epoch.commonOracle.run.runId } }
}
async function requestDesk(input: Input & Transport & { expectedSequence: number; submissionKey: string; oracleSourceRef: TtrpgOpenSourceRefV1;
  contentHash: string; snapshotHash: string | null; maximumCostUsd: number; decision: 'request-this-one-common-oracle-candidate'; onAuthorized?: (requestKey: string) => void | Promise<void> }) {
  if (input.signal?.aborted) throw new Error('本次共同请求已停止。')
  const page = await readTtrpgOpenCommonOracleDeskV1(input), selected = page?.catalog.find(row => stable(row.oracleSourceRef) === stable(input.oracleSourceRef))
  if (input.decision !== 'request-this-one-common-oracle-candidate' || !/^[A-Za-z0-9._-]{1,96}$/.test(input.submissionKey) || !page?.canRequest
    || page.sequence !== input.expectedSequence || selected?.contentHash !== input.contentHash || selected.snapshotHash !== input.snapshotHash) throw new Error('请重新核对原共同咨询、资料、进度和一次明确授权。')
  if (!input.aiConfig && !input.runAI) throw new Error('请先配置本次模型。')
  const loaded = await owner(input)
  if (!loaded || loaded.state.lastSequence !== page.sequence) throw new TtrpgOpenReadConflictV1('共同事实准备期间进度已变化。')
  const maximumOutputTokens = Math.min(getAgentSkillV1('prose.ttrpg-open-common-oracle-interpret').maxOutputTokens, loaded.content.campaign.runtimePolicy.maximumOutputTokens)
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, { category: 'runtime.ttrpg-open.common-oracle-interpret', projectId: input.scope.projectId,
    configOverrides: { maxTokens: maximumOutputTokens }, contextOverflowPolicy: 'reject' }) : null
  const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' } : { provider: resolved!.config.provider, model: resolved!.config.model }
  if (modelIdentity.provider === 'poe') throw new Error('当前模型不支持本次输出上限。')
  const maximumInputTokens = Math.min(loaded.runtime.epochBudget.maximumTokens - maximumOutputTokens, (resolved?.config.contextWindow ?? 32000) - maximumOutputTokens)
  const authorized = await startTtrpgOpenCommonOracleWindowV1({ ...input, sessionId: input.sessionId, commandId: 'common.oracle.desk.' + input.submissionKey,
    baseSequence: loaded.state.lastSequence, baseStateHash: loaded.stateHash, oracleInputHash: input.contentHash, modelIdentity, basisVersion: 2,maximumInputTokens, maximumOutputTokens })
  await input.onAuthorized?.(authorized.requestKey)
  if (input.signal?.aborted) throw new Error('原共同窗口已保留，请读取进度并明确收尾。')
  const read = { ...input, runId: authorized.runId, requestKey: authorized.requestKey }
  await prepareTtrpgOpenCommonOracleInputV1(read)
  await executeTtrpgOpenCommonOracleRequestV1(read)
  return { requestKey: authorized.requestKey }
}
async function resumeDesk(input: Input & Transport & { requestKey: string }) {
  const f = await original(input)
  if (!f.request.local || !f.request.canResume) throw new Error('只能明确继续本人的原本地未发送共同请求。')
  const read = { ...input, ...f.read }
  await prepareTtrpgOpenCommonOracleInputV1(read)
  const result = await executeTtrpgOpenCommonOracleRequestV1(read)
  return { status: result.status }
}
async function reviewDesk(input: Input & { requestKey: string; candidateHash: string; interpretationDecision: 'accept' | 'reject'; interpretationReason: string | null;
  choices: TtrpgOpenOracleReviewChoiceV1[]; decision: 'reviewed-this-original-common-oracle-candidate' }) {
  if (input.decision !== 'reviewed-this-original-common-oracle-candidate') throw new Error('请明确审阅本版本共同解释与每项事实。')
  const f = await original(input)
  if (!f.request.local || !f.request.canReview && !f.request.committed || (f.request.candidate?.candidateHash ?? f.request.committedHash) !== input.candidateHash) throw new Error('原共同候选不可确认，请读取原状态。')
  return reviewTtrpgOpenCommonOracleCandidateV1({ ...input, ...f.read, ...await envelope(input.sessionId, 'common.oracle.desk.review') })
}
async function repairDesk(input: Input & { requestKey: string }) {
  const f = await original(input)
  if (!f.request.local) throw new Error('历史共同请求不恢复本地执行或修复权。')
  if (f.request.canRepairReview) { await reconcileTtrpgOpenOracleFactRunV1({ ...f.read, candidateHash: f.request.committedHash! }); return }
  if (f.request.canRepairStop) {
    if (f.request.status === 'authorized') await finishTtrpgOpenEmptyCommonOracleWindowV1({ ...input, epochKey: f.epoch.epochKey, decision: 'close-this-empty-common-oracle-window' })
    else await reconcileTtrpgOpenStoppedCommonOracleV1(f.read)
    return
  }
  if (f.request.canRepairResponse) { await repairTtrpgOpenCommonOracleResponseReceiptV1(f.read); return }
  throw new Error('原共同请求没有可补齐的回执。')
}
export async function finishTtrpgOpenCommonOracleDeskV1(input: Parameters<typeof finishOriginal>[0]) { await humanOperation(() => finishOriginal(input)) }
async function finishOriginal(input: Input & { requestKey: string; decision: 'discard-this-common-oracle-request-and-close-window' }) {
  if (input.decision !== 'discard-this-common-oracle-request-and-close-window') throw new Error('请明确放弃原共同请求并结束窗口。')
  let f = await original(input)
  if (f.request.committed) throw new Error('原共同事实已有明确决定，请核对回执后结束窗口。')
  if (f.request.canRepairStop) return reconcileTtrpgOpenStoppedCommonOracleV1(f.read)
  if (!f.request.canFinish) throw new Error('当前原共同请求不能按本地停止路径结束。')
  if (f.request.status === 'authorized') return finishTtrpgOpenEmptyCommonOracleWindowV1({ ...input, epochKey: f.epoch.epochKey, decision: 'close-this-empty-common-oracle-window' })
  if (f.request.status === 'dispatched' && f.request.observed) { await repairTtrpgOpenCommonOracleResponseReceiptV1(f.read); f = await original(input) }
  if (f.request.status === 'dispatched') return abandonTtrpgOpenCommonOracleWaitV1({ ...f.read, decision: 'abandon-wait-as-unknown' })
  return finishTtrpgOpenCommonOracleDraftV1({ ...f.read, decision: input.decision })
}
async function closeDesk(input: Input & { requestKey: string; decision: 'close-this-reviewed-common-oracle-window' }) {
  const f = await original(input)
  if (input.decision !== 'close-this-reviewed-common-oracle-window' || !f.request.local || !f.request.committed) throw new Error('请先处理原共同审阅与终验。')
  return closeTtrpgOpenReviewedCommonOracleWindowV1({ ...input, epochKey: f.epoch.epochKey })
}
async function archiveDesk(input: Input & { requestKey: string; decision: 'archive-this-unresumable-common-oracle-window' }) {
  const f = await original(input)
  return archiveTtrpgOpenUnresumableCommonOracleWindowV1({ ...input, epochKey: f.epoch.epochKey })
}

export async function requestTtrpgOpenCommonOracleDeskV1(input: Parameters<typeof requestDesk>[0]) { return humanOperation(() => requestDesk(input)) }

export async function resumeTtrpgOpenCommonOracleDeskV1(input: Parameters<typeof resumeDesk>[0]) { return humanOperation(() => resumeDesk(input)) }

export async function reviewTtrpgOpenCommonOracleDeskV1(input: Parameters<typeof reviewDesk>[0]) { return humanOperation(() => reviewDesk(input)) }

export async function repairTtrpgOpenCommonOracleDeskV1(input: Parameters<typeof repairDesk>[0]) { return humanOperation(() => repairDesk(input)) }

export async function closeTtrpgOpenCommonOracleDeskV1(input: Parameters<typeof closeDesk>[0]) { return humanOperation(() => closeDesk(input)) }

export async function archiveTtrpgOpenCommonOracleDeskV1(input: Parameters<typeof archiveDesk>[0]) { return humanOperation(() => archiveDesk(input)) }
