/** Current human-GM adapter. Reading never sends, starts a window, confirms facts or repairs a receipt. */
import { loadTtrpgOpenFactDeskOwnerV1, type TtrpgOpenFactDeskInputV1 } from './open-fact-desk'
import { createTtrpgOpenOracleRuntimeReferencePolicyV1, ttrpgOpenOracleRuntimeReferenceKeysV1,
  createTtrpgOpenNormalizationRuntimeReferencePolicyV1, verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1 } from './open-runtime-entity-references'
import { verifyTtrpgOpenEntityStateV1 } from './open-entity-proof'
import { assertTtrpgOpenOracleRuntimeEpochAuthorityV1, frozenTtrpgOpenEpochBudgetV1, TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1, TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1,
  type TtrpgOpenSourceRefV1, type TtrpgOpenEpochV1 } from './open-coordination'
import { assertTtrpgOpenOracleInterpretationSlotV1, assertTtrpgOpenSupportSlotV1, ttrpgOpenCallBudgetV1, type TtrpgOpenModelCallV1 } from './open-model-calls'
import { readTtrpgOpenModelCallRunsV1, readTtrpgOpenOriginalLocalCallRunV1 } from './open-model-call-evidence'
import { readTtrpgOpenOracleCandidateV1, readTtrpgOpenFactNormalizationCandidateV1 } from './open-oracle-candidate'
import { loadTtrpgOpenGmOracleContextV1 } from './open-gm-oracle-context'
import { generateTtrpgOpenOracleCandidateV2, executeTtrpgOpenOracleRequestV1, generateTtrpgOpenFactNormalizationCandidateV2, executeTtrpgOpenFactNormalizationRequestV1 } from './open-intent-harness'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, reviewTtrpgOpenOracleCandidateV1 } from './runtime-commands'
import { reconcileTtrpgOpenOracleFactRunV1 } from './open-oracle-adoption'
import { finishTtrpgOpenOracleInstanceDraftV1, reconcileTtrpgOpenStoppedOracleInstanceV1,
  finishTtrpgOpenNormalizationInstanceDraftV1, reconcileTtrpgOpenStoppedNormalizationInstanceV1 } from './open-runtime-draft-stop'
import { repairTtrpgOpenOracleInstanceResponseReceiptV1, abandonTtrpgOpenOracleInstanceWaitV1,
  repairTtrpgOpenNormalizationInstanceResponseReceiptV1, abandonTtrpgOpenNormalizationInstanceWaitV1 } from './open-situation-request-recovery'
import { readProductRuntimeStateVersion } from '../product/runtime-core'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { TTRPG_FACT_PREDICATE_LABELS_V1, ttrpgOpenFactScalarLabelV1 } from './open-fact-desk-contract'
import type { TtrpgOpenOracleReviewChoiceV1, TtrpgOpenOracleReviewV1 } from './open-oracle-review'
import { verifyTtrpgOpenOracleReviewHashesV1 } from './open-oracle-review'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgOpenAudience, TtrpgOpenEntityKind } from './open-contract'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'

type Input = TtrpgOpenFactDeskInputV1
type Purpose = 'oracle' | 'normalization'
type Transport = Pick<Parameters<typeof generateTtrpgOpenOracleCandidateV2>[0], 'aiConfig' | 'runAI' | 'signal'>
type Loaded = NonNullable<Awaited<ReturnType<typeof loadTtrpgOpenFactDeskOwnerV1>>>
interface CatalogRow {
  oracleSourceRef: TtrpgOpenSourceRefV1; question: string; audience: 'public' | 'party' | 'gm-only'; snapshotHash: string; recipients: string[];
  entities: Array<{ name: string; kind: TtrpgOpenEntityKind; audience: TtrpgOpenAudience; recipients: string[] }>;
  reviewSourceRef?: TtrpgOpenSourceRefV1; reviewHash?: string; interpretation?: string; discarded?: Array<{ detail: string; reason: string }>;
}
const scopeOf = (call: TtrpgOpenModelCallV1, purpose: Purpose) => purpose === 'oracle' ? call.oracleInterpretation?.runtimeReferencePolicy : call.supportSlot?.runtimeReferencePolicy?.oraclePolicy
const epochMatches = (epoch: TtrpgOpenEpochV1, purpose: Purpose) => Boolean(purpose === 'oracle' ? epoch.oracleRuntimeReferencePolicy : epoch.normalizationRuntimeReferencePolicy)
const sourceRun = (runtime: TtrpgRuntimeStateV2, ref: TtrpgOpenSourceRefV1) => ref.sessionKey === runtime.sessionKey ? runtime.openRun
  : runtime.branchLineage?.ancestors.find(row => row.sessionKey === ref.sessionKey)?.snapshot.openRun
const discardedDecisions = (review: TtrpgOpenOracleReviewV1) => review.choices.filter(row => row.decision === 'discard')
  .map(row => ({ detail: review.proposals[row.proposalIndex].detail, reason: row.reason! }))
async function sources(loaded: Loaded, purpose: Purpose, name: (key: string) => string) {
  const { runtime, content } = loaded, run = runtime.openRun!, catalog: CatalogRow[] = []
  const consumerRef = { sessionKey: runtime.sessionKey, sequence: loaded.state.lastSequence + 1 }
  let unavailableSources = 0
  if (purpose === 'oracle') for (const oracle of run.oracleReceipts ?? []) {
    const source = { content, operations: run.entityOperations ?? [], runtimeSourceHash: loaded.source.runtimeSourceHash,
      oracle, recipientActorKeys: runtime.authorization!.selectedActorKeys, consumerRef }
    if (!ttrpgOpenOracleRuntimeReferenceKeysV1(source).length) continue
    const policy = await createTtrpgOpenOracleRuntimeReferencePolicyV1(source)
    catalog.push({ oracleSourceRef: oracle.sourceRef, question: oracle.resolution.outcome.question, audience: oracle.audience, snapshotHash: policy.references.snapshotHash,
      recipients: policy.recipientActorKeys.map(name), entities: policy.references.references.map(row => ({ name: name(row.entityRef), kind: row.kind, audience: row.audience,
        recipients: row.recipientActorKeys.map(name) })) })
  }
  else {
    const reviews = new Map([...runtime.branchLineage?.ancestors.flatMap(row => row.snapshot.openRun?.oracleReviews ?? []) ?? [], ...run.oracleReviews ?? []]
      .map(row => [stable(row.sourceRef), row] as const))
    // Integrity failures remain visible; a legitimate but currently unreadable historical source is kept, never modified or granted.
    await verifyTtrpgOpenOracleReviewHashesV1([...reviews.values()])
    for (const review of reviews.values()) {
      if (review.interpretationDecision !== 'accept' || review.normalizationOf) continue
      const origin = sourceRun(runtime, review.sourceRef), call = origin?.coordination.calls.find(row => row.requestKey === review.requestKey)
      const originalPolicy = call?.oracleInterpretation?.runtimeReferencePolicy
      if (!originalPolicy) continue
      await verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1(originalPolicy)
      let policy: Awaited<ReturnType<typeof createTtrpgOpenNormalizationRuntimeReferencePolicyV1>>
      try { policy = await createTtrpgOpenNormalizationRuntimeReferencePolicyV1({ content, runtime, runtimeSourceHash: loaded.source.runtimeSourceHash, reviewSourceRef: review.sourceRef, consumerRef }) }
      catch { unavailableSources++; continue }
      const oracle = origin?.oracleReceipts?.find(row => stable(row.sourceRef) === stable(review.oracleSourceRef))
      if (!oracle) throw new Error('原已接受解释缺少实际咨询，不能列为模型归一来源。')
      catalog.push({ oracleSourceRef: oracle.sourceRef, question: oracle.resolution.outcome.question, audience: oracle.audience,
        snapshotHash: policy.oraclePolicy.references.snapshotHash, recipients: policy.recipientActorKeys.map(name),
        entities: policy.oraclePolicy.references.references.map(row => ({ name: name(row.entityRef), kind: row.kind, audience: row.audience, recipients: row.recipientActorKeys.map(name) })),
        reviewSourceRef: review.sourceRef, reviewHash: review.reviewHash, interpretation: review.interpretation, discarded: discardedDecisions(review) })
    }
  }
  return { catalog, unavailableSources }
}
const liveRun = (state: string) => !['completed', 'failed', 'cancelled'].includes(state)
async function envelope(sessionId: number, commandId: string) {
  const version = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, commandId, baseSequence: version.sequence, baseStateHash: version.stateHash }
}
export async function readTtrpgOpenOracleModelDeskV1(input: Input & { requestKey?: string }) {
  return readModelDesk(input, 'oracle')
}
export async function readTtrpgOpenNormalizationModelDeskV1(input: Input & { requestKey?: string }) {
  return readModelDesk(input, 'normalization')
}
async function readModelDesk(input: Input & { requestKey?: string }, purpose: Purpose) {
  const loaded = await loadTtrpgOpenFactDeskOwnerV1(input)
  if (!loaded) return null
  const { runtime, content } = loaded, run = runtime.openRun!, epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)
  await verifyTtrpgOpenEntityStateV1(loaded.state, content)
  const name = (key: string) => key === 'gm' ? '主持' : loaded.state.entities[key]?.name ?? '原已授权对象'
  const modelConsent = Boolean(loaded.seat?.consent.aiAdviceAllowed && loaded.seat?.consent.aiIdentityDisclosed)
  const running = runtime.product.safety.status === 'active' && run.stage.status === 'open'
  const own = run.coordination.calls.filter(call => scopeOf(call, purpose)
    && run.coordination.epochs.some(row => row.epochKey === call.authorizationEpochKey && row.viewerKey === input.viewerKey))
  const call = input.requestKey ? own.find(row => row.requestKey === input.requestKey) : own[own.length - 1]
  const rows = call ? await readTtrpgOpenModelCallRunsV1({ ...input, calls: [call] }) : []
  const snapshot = call ? await readTtrpgOpenOriginalLocalCallRunV1({ ...input, call, runs: rows }) : null
  const read = call && snapshot ? { ...input, requestKey: call.requestKey, runId: snapshot.run.id! } : null
  const originalEpoch = call && run.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)
  const currentWindow = Boolean(call && epoch?.epochKey === call.authorizationEpochKey && epoch?.viewerKey === input.viewerKey)
  const review = call && run.oracleReviews?.find(row => row.requestKey === call.requestKey)
  const acceptedSource = purpose === 'normalization' && call?.supportSlot ? sourceRun(runtime, call.supportSlot.sourceRef)?.oracleReviews?.find(row => stable(row.sourceRef) === stable(call.supportSlot!.sourceRef)) : undefined
  if (acceptedSource) await verifyTtrpgOpenOracleReviewHashesV1([acceptedSource])
  const fact = call && run.factLedger?.entries.find(row => row.modelCandidate?.requestKey === call.requestKey)
  const committed = Boolean(review || fact), committedHash = review?.candidateHash ?? fact?.modelCandidate?.candidateHash ?? null
  const observed = Boolean(call && snapshot?.events.some(event => (event.type === 'model.responded'
    || event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')
    && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt))
  const active = Boolean(snapshot && liveRun(snapshot.projection.state))
  let candidate = null, candidateUnavailable = false
  if (read && call?.status === 'succeeded') {
    try { candidate = await (purpose === 'oracle' ? readTtrpgOpenOracleCandidateV1 : readTtrpgOpenFactNormalizationCandidateV1)(read) } catch { candidateUnavailable = true }
  }
  let fresh = false
  if (candidate && currentWindow && !committed && modelConsent) {
    const context = await loadTtrpgOpenGmOracleContextV1({ ...input, actorKey: 'gm' })
    fresh = context.visibilityHash === call!.visibilityHash && context.admissionStateHash === call!.admissionStateHash
  }
  let modelIdentity: { provider: string; model: string } | null = null
  if (read && call) {
    const rendered = p.object(p.json(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'rendered-request', contentHash: call.requestHash })), 'original Oracle request')
    const model = p.record(rendered.modelIdentity, ['provider', 'model'], 'original Oracle model')
    modelIdentity = { provider: p.text(model.provider, 'original provider', 64), model: p.text(model.model, 'original model', 200) }
  }
  let unavailable = ''
  try {
    if (!content.campaign.runtimePolicy.enabled) throw new Error('冻结作品尚未启用模型咨询。')
    assertTtrpgOpenOracleRuntimeEpochAuthorityV1(runtime, input.viewerKey)
    if (purpose === 'oracle') assertTtrpgOpenOracleInterpretationSlotV1(runtime, run.worldTime.worldTurn)
    else assertTtrpgOpenSupportSlotV1(runtime, run.worldTime.worldTurn)
    if (epoch) throw new Error('请先处理并结束原咨询、行动或拟定窗口。')
  } catch (error) { unavailable = error instanceof Error ? error.message : '当前不能发起模型事实咨询。' }
  const { catalog, unavailableSources } = unavailable ? { catalog: [] as CatalogRow[], unavailableSources: 0 } : await sources(loaded, purpose, name)
  if (!catalog.length && !unavailable) unavailable = purpose === 'oracle' ? '原咨询没有符合本次范围的已创建对象；可先使用人工事实面板。' : '没有可在当前准确范围内整理的已接受实例解释；原决定保持。'
  const budget = epoch ? ttrpgOpenCallBudgetV1(epoch, run.coordination.calls) : null
  const originalCalls = epoch && run.coordination.calls.filter(row => row.authorizationEpochKey === epoch.epochKey)
  const reviewedTerminal = Boolean(committed && snapshot && (review?.interpretationDecision === 'reject' ? snapshot.projection.state === 'failed' : snapshot.projection.state === 'completed'))
  const closeWindow = epoch && epochMatches(epoch, purpose) && epoch.viewerKey === input.viewerKey && !epoch.reservedCalls
    && (!originalCalls?.length || currentWindow && reviewedTerminal)
  const sourceLabel = (key: string) => {
    const entry = run.factLedger?.entries.find(row => row.fact.factKey === key), frozen = content.campaign.frozenWorldPredicateIndex.entries.find(row => row.factKey === key)
    return entry?.fact.detail ?? (frozen ? name(frozen.subjectRef) + ' · ' + TTRPG_FACT_PREDICATE_LABELS_V1[frozen.predicateKey] + '：' + ttrpgOpenFactScalarLabelV1(frozen.canonicalValue) : '原实际来源')
  }
  await loaded.assertCurrent()
  return { ...(purpose === 'normalization' ? { unavailableSources } : {}), sequence: loaded.state.lastSequence, catalog, canRequest: !unavailable && catalog.length > 0, unavailable,
    maximumCostUsd: frozenTtrpgOpenEpochBudgetV1(content.campaign).maximumCostUsd,
    closeWindowEpochKey: closeWindow ? epoch.epochKey : null,
    requests: own.map(row => ({ requestKey: row.requestKey, status: row.status, audience: scopeOf(row, purpose)!.audience })),
    request: call ? { requestKey: call.requestKey, status: call.status, local: Boolean(read), modelIdentity, currentWindow, observed, committed, committedHash,
      ...(acceptedSource ? { source: { interpretation: acceptedSource.interpretation, discarded: discardedDecisions(acceptedSource),
        audience: acceptedSource.audience, recipients: call.supportSlot!.runtimeReferencePolicy!.recipientActorKeys.map(name) } } : {}),
      oracle: (purpose === 'oracle' ? run : sourceRun(runtime, call.supportSlot!.sourceRef))?.oracleReceipts?.find(row => stable(row.sourceRef) === stable(scopeOf(call, purpose)!.oracleSourceRef))?.resolution.outcome.question ?? '原已保存咨询',
      canResume: Boolean(read && active && currentWindow && modelConsent && running && call.status === 'prepared'),
      canReview: Boolean(read && active && currentWindow && modelConsent && running && fresh && !committed && candidate?.facts !== null && candidate?.interpretation
        && ['ready', 'usable-with-warnings'].includes(candidate.artifact.status) && !budget?.pending && !budget?.blockedByUnknown),
      canRepairResponse: Boolean(read && active && !committed && (call.status === 'succeeded' && (!candidate || candidateUnavailable) || currentWindow && call.status === 'dispatched' && observed)),
      canRepairReview: Boolean(read && committed && !reviewedTerminal),
      canRepairStop: Boolean(read && active && originalEpoch?.status === 'closed' && !committed),
      canFinish: Boolean(read && currentWindow && !committed),
      candidate: candidate ? { candidateHash: candidate.candidateHash, status: candidate.artifact.status, interpretation: candidate.interpretation,
        facts: candidate.facts?.map((row, index) => ({ index, subject: name(row.subjectRef), predicate: TTRPG_FACT_PREDICATE_LABELS_V1[row.predicateKey],
          object: row.objectRef ? name(row.objectRef) : null, value: ttrpgOpenFactScalarLabelV1(row.canonicalValue), detail: row.detail,
          audience: row.audience, recipients: row.knownByActorKeys.map(name), sources: row.sourceFactRefs.map(sourceLabel),
          supersedes: row.supersedes ? sourceLabel(row.supersedes) : null, supersedeReason: row.supersedeReason })) ?? null } : null,
      review: review ? { interpretationDecision: review.interpretationDecision, interpretationReason: review.interpretationReason, choices: review.choices,
        adoptedCount: review.adoptedFactKeys.length } : null } : null }
}
async function original(input: Input & { requestKey: string }, purpose: Purpose) {
  const page = await readModelDesk(input, purpose), request = page?.request
  if (!request?.local || request.requestKey !== input.requestKey) throw new Error('原本地实例事实请求不存在；历史记录不恢复发送或确认权限。')
  const loaded = await loadTtrpgOpenFactDeskOwnerV1(input)
  if (!loaded) throw new Error('仅当前本人真人 GM 可以处理原实例事实请求。')
  const call = loaded.runtime.openRun!.coordination.calls.find(row => row.requestKey === input.requestKey)!
  const owner = await readTtrpgOpenOriginalLocalCallRunV1({ ...input, call })
  if (!owner) throw new Error('原 Run 不存在，不创建替代请求。')
  await loaded.assertCurrent()
  return { page: page!, request, call, read: { ...input, runId: owner.run.id! } }
}
type RequestBase = Input & Transport & { submissionKey: string; expectedSequence: number; snapshotHash: string; maximumCostUsd: number;
  onPrepared?: (requestKey: string) => void | Promise<void> }
type OracleRequest = RequestBase & { oracleSourceRef: TtrpgOpenSourceRefV1; decision: 'request-this-oracle-instance-candidate' }
type NormalizationRequest = RequestBase & { reviewSourceRef: TtrpgOpenSourceRefV1; reviewHash: string; decision: 'request-this-normalization-instance-candidate' }
export async function requestTtrpgOpenOracleModelDeskV1(input: OracleRequest) { return requestModelDesk({ ...input, purpose: 'oracle' }) }
export async function requestTtrpgOpenNormalizationModelDeskV1(input: NormalizationRequest) { return requestModelDesk({ ...input, purpose: 'normalization' }) }
async function requestModelDesk(input: OracleRequest & { purpose: 'oracle' } | NormalizationRequest & { purpose: 'normalization' }) {
  const expected = input.purpose === 'oracle' ? 'request-this-oracle-instance-candidate' : 'request-this-normalization-instance-candidate'
  if (input.decision !== expected || !/^[A-Za-z0-9._-]{1,96}$/.test(input.submissionKey)) throw new Error('请明确选择原咨询、对象范围和一次请求的预留上限。')
  if (!input.aiConfig && !input.runAI) throw new Error('请先配置本次模型。')
  const page = await readModelDesk(input, input.purpose)
  const selection = page?.catalog.find(row => row.snapshotHash === input.snapshotHash && (input.purpose === 'oracle'
    ? stable(row.oracleSourceRef) === stable(input.oracleSourceRef) : stable(row.reviewSourceRef) === stable(input.reviewSourceRef) && row.reviewHash === input.reviewHash))
  const cost = p.number(input.maximumCostUsd, '本次实例事实预留上限', 0, 1000)
  if (!page?.canRequest || page.sequence !== input.expectedSequence || !selection || cost > page.maximumCostUsd) throw new Error('原咨询、对象范围或进度已变化，请重新读取并确认。')
  const loaded = await loadTtrpgOpenFactDeskOwnerV1(input)
  if (!loaded || loaded.state.lastSequence !== page.sequence) throw new TtrpgOpenReadConflictV1('准备实例事实咨询期间进度已变化。')
  const consumerRef = { sessionKey: loaded.runtime.sessionKey, sequence: loaded.state.lastSequence + 1 }
  const window = { sessionId: input.sessionId, commandId: input.purpose + '.model.desk.start.' + input.submissionKey, baseSequence: loaded.state.lastSequence,
    baseStateHash: loaded.stateHash, viewerKey: input.viewerKey, triggerKind: 'continue-host' as const }
  if (input.purpose === 'oracle') {
    const oracle = loaded.runtime.openRun!.oracleReceipts!.find(row => stable(row.sourceRef) === stable(input.oracleSourceRef))!
    const policy = await createTtrpgOpenOracleRuntimeReferencePolicyV1({ content: loaded.content, operations: loaded.runtime.openRun!.entityOperations ?? [],
      runtimeSourceHash: loaded.source.runtimeSourceHash, oracle, recipientActorKeys: loaded.authorization.selectedActorKeys, consumerRef })
    await loaded.assertCurrent()
    await startTtrpgOpenEpochV1({ ...window, rawInput: TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1, oracleRuntimeReferencePolicy: policy })
  } else {
    const policy = await createTtrpgOpenNormalizationRuntimeReferencePolicyV1({ content: loaded.content, runtime: loaded.runtime,
      runtimeSourceHash: loaded.source.runtimeSourceHash, reviewSourceRef: input.reviewSourceRef, consumerRef })
    await loaded.assertCurrent()
    await startTtrpgOpenEpochV1({ ...window, rawInput: TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1, normalizationRuntimeReferencePolicy: policy })
  }
  const { purpose, ...args } = input
  const common = { ...args, ...await envelope(input.sessionId, input.purpose + '.model.desk.prepare.' + input.submissionKey), maximumCostUsd: cost,
    maximumOutputTokens: Math.min(getAgentSkillV1(purpose === 'oracle' ? 'prose.ttrpg-open-oracle-interpret' : 'prose.ttrpg-open-fact-normalize').maxOutputTokens, loaded.content.campaign.runtimePolicy.maximumOutputTokens),
    onPrepared: (prepared: { requestKey: string }) => input.onPrepared?.(prepared.requestKey) }
  const result = input.purpose === 'oracle' ? await generateTtrpgOpenOracleCandidateV2({ ...common, oracleSourceRef: input.oracleSourceRef, referencePolicy: 'recorded-oracle-instances-v1' })
    : await generateTtrpgOpenFactNormalizationCandidateV2({ ...common, reviewSourceRef: input.reviewSourceRef, referencePolicy: 'accepted-interpretation-instances-v1' })
  return { requestKey: result.prepared.requestKey }
}
export async function resumeTtrpgOpenOracleModelDeskV1(input: Input & Transport & { requestKey: string }) {
  return resumeModelDesk(input, 'oracle')
}
export async function resumeTtrpgOpenNormalizationModelDeskV1(input: Input & Transport & { requestKey: string }) { return resumeModelDesk(input, 'normalization') }
async function resumeModelDesk(input: Input & Transport & { requestKey: string }, purpose: Purpose) {
  const f = await original(input, purpose)
  if (!f.request.canResume) throw new Error('原请求当前不能继续发送，请读取原状态与模型。')
  return (purpose === 'oracle' ? executeTtrpgOpenOracleRequestV1 : executeTtrpgOpenFactNormalizationRequestV1)({ ...input, ...f.read })
}
type ReviewInput = Input & { requestKey: string; candidateHash: string; interpretationDecision: 'accept' | 'reject'; interpretationReason: string | null; choices: TtrpgOpenOracleReviewChoiceV1[] }
export async function reviewTtrpgOpenOracleModelDeskV1(input: ReviewInput & { decision: 'reviewed-this-original-oracle-candidate' }) { return reviewModelDesk(input, 'oracle') }
export async function reviewTtrpgOpenNormalizationModelDeskV1(input: ReviewInput & { decision: 'reviewed-this-original-normalization-candidate' }) { return reviewModelDesk(input, 'normalization') }
async function reviewModelDesk(input: ReviewInput & { decision: 'reviewed-this-original-oracle-candidate' | 'reviewed-this-original-normalization-candidate' }, purpose: Purpose) {
  if (input.decision !== (purpose === 'oracle' ? 'reviewed-this-original-oracle-candidate' : 'reviewed-this-original-normalization-candidate')) throw new Error('请明确审阅原解释和每一项事实提案。')
  const f = await original(input, purpose)
  if (!f.request.canReview && !f.request.committed || (f.request.candidate?.candidateHash ?? f.request.committedHash) !== input.candidateHash) throw new Error('原候选已变化、不能确认或已不在本次窗口。')
  return reviewTtrpgOpenOracleCandidateV1({ ...input, ...f.read, ...await envelope(input.sessionId, purpose + '.model.desk.review') })
}
export async function repairTtrpgOpenOracleModelDeskV1(input: Input & { requestKey: string }) {
  return repairModelDesk(input, 'oracle')
}
export async function repairTtrpgOpenNormalizationModelDeskV1(input: Input & { requestKey: string }) { return repairModelDesk(input, 'normalization') }
async function repairModelDesk(input: Input & { requestKey: string }, purpose: Purpose) {
  const f = await original(input, purpose)
  if (f.request.canRepairReview) return reconcileTtrpgOpenOracleFactRunV1({ ...f.read, candidateHash: f.request.committedHash! })
  if (f.request.canRepairStop) return (purpose === 'oracle' ? reconcileTtrpgOpenStoppedOracleInstanceV1 : reconcileTtrpgOpenStoppedNormalizationInstanceV1)(f.read)
  if (f.request.canRepairResponse) return (purpose === 'oracle' ? repairTtrpgOpenOracleInstanceResponseReceiptV1 : repairTtrpgOpenNormalizationInstanceResponseReceiptV1)(f.read)
  throw new Error('本原请求没有需要补齐的回执。')
}
export async function finishTtrpgOpenOracleModelDeskV1(input: Input & { requestKey: string; decision: 'discard-this-oracle-instance-request-and-close-window' }) {
  return finishModelDesk(input, 'oracle')
}
export async function finishTtrpgOpenNormalizationModelDeskV1(input: Input & { requestKey: string; decision: 'discard-this-normalization-instance-request-and-close-window' }) { return finishModelDesk(input, 'normalization') }
async function finishModelDesk(input: Input & { requestKey: string; decision: 'discard-this-oracle-instance-request-and-close-window' | 'discard-this-normalization-instance-request-and-close-window' }, purpose: Purpose) {
  if (input.decision !== (purpose === 'oracle' ? 'discard-this-oracle-instance-request-and-close-window' : 'discard-this-normalization-instance-request-and-close-window')) throw new Error('请明确放弃本次候选并结束原窗口，保留回答和费用。')
  let f = await original(input, purpose)
  if (f.request.committed) throw new Error('原候选已确认或拒绝，请核对原审阅回执后结束，不能改记为放弃。')
  if (f.request.canRepairStop) return (purpose === 'oracle' ? reconcileTtrpgOpenStoppedOracleInstanceV1 : reconcileTtrpgOpenStoppedNormalizationInstanceV1)(f.read)
  if (!f.request.canFinish) throw new Error('原窗口已结束；请保留已有记录。')
  if (f.call.status === 'dispatched' && f.request.observed) { await (purpose === 'oracle' ? repairTtrpgOpenOracleInstanceResponseReceiptV1 : repairTtrpgOpenNormalizationInstanceResponseReceiptV1)(f.read); f = await original(input, purpose) }
  if (f.call.status === 'dispatched') return (purpose === 'oracle' ? abandonTtrpgOpenOracleInstanceWaitV1 : abandonTtrpgOpenNormalizationInstanceWaitV1)({ ...f.read, decision: 'abandon-wait-as-unknown' })
  return purpose === 'oracle' ? finishTtrpgOpenOracleInstanceDraftV1({ ...f.read, decision: 'discard-this-oracle-instance-request-and-close-window' })
    : finishTtrpgOpenNormalizationInstanceDraftV1({ ...f.read, decision: 'discard-this-normalization-instance-request-and-close-window' })
}
export async function closeTtrpgOpenOracleModelWindowDeskV1(input: Input & { epochKey: string; decision: 'close-this-original-oracle-window' }) {
  return closeModelWindow(input, 'oracle')
}
export async function closeTtrpgOpenNormalizationModelWindowDeskV1(input: Input & { epochKey: string; decision: 'close-this-original-normalization-window' }) { return closeModelWindow(input, 'normalization') }
async function closeModelWindow(input: Input & { epochKey: string; decision: 'close-this-original-oracle-window' | 'close-this-original-normalization-window' }, purpose: Purpose) {
  const page = await readModelDesk(input, purpose)
  if (input.decision !== (purpose === 'oracle' ? 'close-this-original-oracle-window' : 'close-this-original-normalization-window') || page?.closeWindowEpochKey !== input.epochKey) throw new Error('请先处理原请求及终验，再明确结束本人的原窗口。')
  return closeTtrpgOpenEpochV1({ ...await envelope(input.sessionId, purpose + '.model.window.close.' + input.epochKey), viewerKey: input.viewerKey,
    epochKey: input.epochKey, reason: '真人明确结束本次实例事实窗口；原咨询、回答、审阅、费用和确认事实保留。' })
}
