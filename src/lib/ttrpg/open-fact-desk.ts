/** Human-GM fact desk; all writes delegate to the existing formal fact/Oracle commands. */
import type { WorkspaceScope } from '../types'
import { db } from '../db/schema'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { verifyTtrpgOpenOracleJournalV1, type TtrpgOpenOracleReceiptV1 } from './open-oracle-contract'
import { verifyTtrpgOpenOracleReviewHashesV1 } from './open-oracle-review'
import { verifyTtrpgOpenFactLedger,
  ttrpgOpenSessionFactsV1, hashTtrpgOpenOracleFactCandidateV1, parseTtrpgOpenOracleFactProposalV1, type TtrpgOpenOracleFactProposalV1 } from './open-fact-ledger'
import { isTtrpgOpenPassiveEpochV1, assertTtrpgOpenSituationWindowEventV1, parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { ttrpgOpenEntityIdentityCatalogV1 } from './open-entity-catalog'
import { startTtrpgOpenEpochV1, consultTtrpgOracleV1, closeTtrpgOpenEpochV1, previewTtrpgOpenHumanFactCommandV1,
  commitTtrpgOpenOracleFactV1, commitTtrpgOpenOracleRuntimeEntityFactV1, retireTtrpgOpenSessionFactV1 } from './runtime-commands'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { canonicalStringify as stable } from '../agent/run/hash'
import { parseTtrpgOpenFactDeskReviewV1, ttrpgOpenFactScalarLabelV1, TTRPG_FACT_PREDICATE_LABELS_V1 as predicates, TTRPG_FACT_AUDIENCE_LABELS_V1 as audiences,
  type TtrpgOpenFactDeskChangeV1, type TtrpgOpenFactDeskReviewV1 } from './open-fact-desk-contract'
import * as p from './open-contract-parse'

export interface TtrpgOpenFactDeskInputV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string }
type Loaded = Awaited<ReturnType<typeof loadTtrpgOpenMemoryReadStateV1>>
const submission = (value: string) => { if (!/^[A-Za-z0-9._-]{1,96}$/.test(value)) p.fail('事实操作标识无效'); return value }
export async function loadTtrpgOpenFactDeskOwnerV1(input: TtrpgOpenFactDeskInputV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  if (!loaded.humanHost || loaded.seat?.role !== 'gm' || loaded.seat.controller === 'ai') return null
  const { runtime, content, source } = loaded, run = runtime.openRun!
  await verifyTtrpgOpenOracleJournalV1({ receipts: run.oracleReceipts ?? [], rulePack: content.rulePack.content, sessionKey: runtime.sessionKey,
    seed: loaded.session.seed, ancestors: runtime.branchLineage?.ancestors ?? [] })
  await verifyTtrpgOpenFactLedger({ ledger: run.factLedger, content, runtimeSourceHash: source.runtimeSourceHash,
    oracleReceipts: run.oracleReceipts ?? [], entityOperations: run.entityOperations, storyFacts: runtime.product.effectLedger.storyFacts })
  await verifyTtrpgOpenOracleReviewHashesV1(run.oracleReviews ?? [])
  await loaded.assertCurrent()
  return loaded
}
async function human(input: TtrpgOpenFactDeskInputV1) { return await loadTtrpgOpenFactDeskOwnerV1(input) ?? p.fail('事实确认面板仅允许当前本人真人 GM；兼任主持不取得私域资料') }
function envelope(loaded: Loaded, commandId: string) { return { sessionId: loaded.session.id!, commandId, baseSequence: loaded.state.lastSequence, baseStateHash: loaded.stateHash } }
function name(loaded: Loaded, ref: string) { return loaded.state.entities[ref]?.name ?? ref }
function sourceLabel(loaded: Loaded, key: string) {
  const current = loaded.runtime.openRun!.factLedger?.entries.find(row => row.fact.factKey === key)
  if (current) return current.fact.detail
  const original = loaded.content.campaign.frozenWorldPredicateIndex.entries.find(row => row.factKey === key)
  return original ? name(loaded, original.subjectRef) + ' · ' + predicates[original.predicateKey] + '：' + ttrpgOpenFactScalarLabelV1(original.canonicalValue) : key
}
function oracleLabel(loaded: Loaded, oracle: TtrpgOpenOracleReceiptV1) {
  const result = oracle.resolution.outcome.rawResult, table = loaded.content.rulePack.content.oracles.find(row => row.oracleKey === oracle.resolution.outcome.oracleKey)!
  return typeof result === 'string' ? ({ yes: '是', 'yes-but': '是，但是…', 'no-but': '否，但是…', no: '否' }[result]) : table.entries?.find(row => row.entryKey === result.entryKey)?.text ?? '原结果已保存'
}
function available(loaded: Loaded, input: TtrpgOpenFactDeskInputV1) {
  const run = loaded.runtime.openRun!, epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)
  const active = run.stage.status === 'open' && loaded.runtime.product.safety.status === 'active'
  const idle = !run.operations.some(row => ['awaiting-approval', 'executing'].includes(row.status)) && !run.entityOperations?.some(row => !row.resolution)
    && !run.coordination.calls.some(row => row.authorizationEpochKey === epoch?.epochKey && ['prepared', 'dispatched', 'unknown'].includes(row.status))
    && !loaded.runtime.branchLineage?.recoveryTasks.some(row => !['completed', 'withdrawn'].includes(row.status))
  const own = Boolean(epoch && epoch.status === 'active' && epoch.viewerKey === input.viewerKey && !isTtrpgOpenPassiveEpochV1(epoch))
  const canPrepare = active && idle && own
  return { epoch, canPrepare, canStart: active && idle && !epoch,
    canConsult: canPrepare && run.consultedThisWorldTurn < 2,
    canClose: canPrepare && !epoch!.reservedCalls && !run.coordination.calls.some(row => row.authorizationEpochKey === epoch!.epochKey),
    unavailable: !active ? '请先恢复冒险并进入进行中的阶段。' : !idle ? '请先处理当前实体、行动、原请求或继承恢复。'
      : !own ? '请先明确开始本人的普通咨询；局势或复盘窗口不能确认事实。' : '' }
}
export async function readTtrpgOpenFactDeskV1(input: TtrpgOpenFactDeskInputV1) {
  const loaded = await loadTtrpgOpenFactDeskOwnerV1(input)
  if (!loaded) return null
  const { runtime, content } = loaded, run = runtime.openRun!, flags = available(loaded, input)
  const entriesByKey = new Map(run.factLedger?.entries.map(row => [row.fact.factKey, row])), oraclesByRef = new Map(run.oracleReceipts?.map(row => [stable(row.sourceRef), row]))
  const facts = ttrpgOpenSessionFactsV1(run.factLedger).map(fact => {
    const entry = entriesByKey.get(fact.factKey)!, oracle = oraclesByRef.get(stable(entry.oracleSourceRef))!
    return { fact, subjectName: name(loaded, fact.subjectRef), objectName: fact.objectRef ? name(loaded, fact.objectRef) : null,
      origin: entry.modelCandidate ? 'model' as const : 'human' as const, sourceRef: entry.sourceRef, oracleSourceRef: entry.oracleSourceRef,
      question: oracle.resolution.outcome.question, retirementReason: run.factLedger!.retirements.find(row => row.factKey === fact.factKey)?.reason ?? null }
  })
  await loaded.assertCurrent()
  return { sequence: loaded.state.lastSequence, canPrepare: flags.canPrepare, canStart: flags.canStart, canConsult: flags.canConsult,
    canClose: flags.canClose, unavailable: flags.unavailable, epochKey: flags.epoch?.epochKey ?? null,
    entities: ttrpgOpenEntityIdentityCatalogV1(content, run.entityOperations ?? []).map(row => ({ key: row.entityKey, name: name(loaded, row.entityKey),
      kind: row.kind, dynamic: row.dynamic, audience: row.audience, recipientActorKeys: row.recipientActorKeys })),
    predicates: content.rulePack.content.factPolicy.filter(row => row.authority.session === 'semantic-fact').map(row => ({ ...row, label: predicates[row.predicateKey] })),
    recipients: runtime.authorization!.selectedActorKeys.map(key => ({ key, name: name(loaded, key) })), facts,
    sources: [...content.campaign.frozenWorldPredicateIndex.entries.map(row => ({ key: row.factKey, label: name(loaded, row.subjectRef) + ' · ' + predicates[row.predicateKey] + '：' + ttrpgOpenFactScalarLabelV1(row.canonicalValue) })),
      ...facts.filter(row => !row.fact.retired).map(row => ({ key: row.fact.factKey, label: row.fact.detail }))],
    oracles: [...(run.oracleReceipts ?? [])].reverse().map(row => ({ sourceRef: row.sourceRef, question: row.resolution.outcome.question,
      result: oracleLabel(loaded, row), audience: row.audience, worldTurn: row.worldTurn })),
    tables: content.rulePack.content.oracles.map(row => ({ key: row.oracleKey, title: row.title, tiers: row.likelihood?.tiers.map(tier => ({ key: tier.tierKey, label: tier.label })) ?? [] })) }
}
async function prepare(loaded: Loaded, input: TtrpgOpenFactDeskInputV1, commandId: string, change: TtrpgOpenFactDeskChangeV1): Promise<TtrpgOpenFactDeskReviewV1> {
  const flags = available(loaded, input)
  if (!flags.canPrepare) throw new Error(flags.unavailable)
  const original = envelope(loaded, commandId)
  assertTtrpgOpenSituationWindowEventV1(loaded.runtime, change.kind === 'assert' ? 'ttrpg.fact.asserted' : 'ttrpg.fact.retired')
  await previewTtrpgOpenHumanFactCommandV1({ state: loaded.state, session: loaded.session, sequence: loaded.state.lastSequence + 1,
    ttrpgContent: loaded.content, participants: await readTtrpgSessionParticipantsV2(input.sessionId) }, { viewerKey: input.viewerKey,
    action: change.kind === 'retire' ? change : { ...change, baseStateHash: original.baseStateHash, referencePolicy: change.referencePolicy === 'release-only-v1' ? undefined : change.referencePolicy } })
  const rows: TtrpgOpenFactDeskReviewV1['rows'] = []
  const add = (label: string, value: string) => rows.push({ label, value })
  if (change.kind === 'assert') {
    const fact = change.proposal, oracle = loaded.runtime.openRun!.oracleReceipts!.find(row => stable(row.sourceRef) === stable(change.oracleSourceRef))!
    add('本次操作', fact.supersedes ? '以新记录替代旧事实，保留原历史' : '确认一条新的本局语义事实')
    add('咨询依据', oracle.resolution.outcome.question + '；原结果：' + oracleLabel(loaded, oracle))
    add('主体与含义', name(loaded, fact.subjectRef) + ' · ' + predicates[fact.predicateKey] + (fact.objectRef ? ' · ' + name(loaded, fact.objectRef) : ''))
    add('准确取值', loaded.content.rulePack.content.factPolicy.find(row => row.predicateKey === fact.predicateKey)?.valueType === 'entity-ref' ? name(loaded, String(fact.canonicalValue)) : ttrpgOpenFactScalarLabelV1(fact.canonicalValue)); add('事实全文', fact.detail)
    add('来源', fact.sourceFactRefs.map(key => sourceLabel(loaded, key)).join('；') || '仅原咨询依据')
    add('受众', audiences[fact.audience]); add('实际接收者', fact.knownByActorKeys.map(key => name(loaded, key)).join('、') || (fact.audience === 'public' ? '公开' : '仅主持'))
    add('对象引用', change.referencePolicy === 'release-only-v1' ? '仅原冻结对象' : '包含已实际创建的本局对象；保留原创建和接收者证据')
    if (fact.supersedes) add('替代理由', fact.supersedeReason!)
  } else {
    const fact = ttrpgOpenSessionFactsV1(loaded.runtime.openRun!.factLedger).find(row => row.factKey === change.factKey)!
    add('本次操作', '退休本条事实，保留原记录和依据'); add('原事实全文', fact.detail); add('退休理由', change.reason)
    add('原受众', audiences[fact.audience]); add('原接收者', fact.knownBy.map(key => name(loaded, key)).join('、') || '按原公开或主持范围')
  }
  // Only the canonical original validator above determines validity; no domain payload is exposed by this desk.
  const body = { schema: 'storyforge.ttrpg-open-human-fact-review' as const, version: 1 as const, scope: { ...input.scope }, sessionId: input.sessionId,
    sessionKey: loaded.runtime.sessionKey, viewerKey: input.viewerKey, runtimeSourceHash: loaded.source.runtimeSourceHash,
    envelope: { commandId: original.commandId, baseSequence: original.baseSequence, baseStateHash: original.baseStateHash }, change, rows }
  await loaded.assertCurrent()
  return parseTtrpgOpenFactDeskReviewV1({ ...body, reviewHash: await hash(body) })
}
export async function prepareTtrpgOpenFactDeskAssertionV1(input: TtrpgOpenFactDeskInputV1 & { submissionKey: string; proposal: TtrpgOpenOracleFactProposalV1;
  oracleSourceRef: TtrpgOpenSourceRefV1; includeRuntimeEntities: boolean }) {
  const loaded = await human(input), proposal = parseTtrpgOpenOracleFactProposalV1(input.proposal), oracleSourceRef = parseTtrpgOpenSourceRefV1(input.oracleSourceRef)
  if (typeof input.includeRuntimeEntities !== 'boolean') p.fail('请明确选择本次对象引用范围')
  const candidateHash = await hashTtrpgOpenOracleFactCandidateV1({ proposal, oracleSourceRef, runtimeSourceHash: loaded.source.runtimeSourceHash,
    viewerKey: input.viewerKey, baseStateHash: loaded.stateHash })
  const needsRuntimeReferences = [proposal.subjectRef, proposal.objectRef].some(ref => ref !== null
    && !loaded.content.campaign.entityBindings.some(binding => binding.bindingKey === ref))
  return prepare(loaded, input, 'fact.desk.assert.' + submission(input.submissionKey), { kind: 'assert', proposal, oracleSourceRef, candidateHash,
    referencePolicy: input.includeRuntimeEntities && needsRuntimeReferences ? 'committed-runtime-entities-v1' : 'release-only-v1' })
}
export async function prepareTtrpgOpenFactDeskRetirementV1(input: TtrpgOpenFactDeskInputV1 & { submissionKey: string; factKey: string; reason: string }) {
  return prepare(await human(input), input, 'fact.desk.retire.' + submission(input.submissionKey), { kind: 'retire', factKey: p.key(input.factKey, 'retired fact'), reason: p.text(input.reason, 'retirement reason', 1000) })
}
export async function confirmTtrpgOpenFactDeskV1(input: TtrpgOpenFactDeskInputV1 & { review: TtrpgOpenFactDeskReviewV1; decision: 'confirm-this-exact-fact-change' }) {
  if (input.decision !== 'confirm-this-exact-fact-change') p.fail('请先完整审阅并明确确认本版本事实变更')
  const loaded = await human(input), review = parseTtrpgOpenFactDeskReviewV1(input.review), { reviewHash, ...body } = review
  if (stable(review.scope) !== stable(input.scope) || review.sessionId !== input.sessionId || review.viewerKey !== input.viewerKey
    || review.sessionKey !== loaded.runtime.sessionKey || review.runtimeSourceHash !== loaded.source.runtimeSourceHash || reviewHash !== await hash(body)) p.fail('本次事实审阅不属于准确本人、作用域、来源或原版本')
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, review.envelope.commandId]).first()
  if (!prior) {
    if (review.envelope.baseSequence !== loaded.state.lastSequence || review.envelope.baseStateHash !== loaded.stateHash) p.fail('事实审阅基线已变化，请重新准备并审阅')
    if (stable(await prepare(loaded, input, review.envelope.commandId, review.change)) !== stable(review)) p.fail('事实显示内容不是当前准确原版本')
  }
  const command = { ...review.envelope, sessionId: input.sessionId, viewerKey: input.viewerKey }, change = review.change
  const event = change.kind === 'retire' ? await retireTtrpgOpenSessionFactV1({ ...command, factKey: change.factKey, reason: change.reason })
    : change.referencePolicy === 'release-only-v1' ? await commitTtrpgOpenOracleFactV1({ ...command, ...change })
      : await commitTtrpgOpenOracleRuntimeEntityFactV1({ ...command, ...change, referencePolicy: change.referencePolicy })
  return { sequence: event.sequence }
}
export async function startTtrpgOpenFactDeskConsultationV1(input: TtrpgOpenFactDeskInputV1 & { submissionKey: string; decision: 'start-this-fact-consultation' }) {
  const loaded = await human(input)
  if (input.decision !== 'start-this-fact-consultation' || !available(loaded, input).canStart) p.fail('请在空闲且未暂停时明确开始本次事实咨询')
  const event = await startTtrpgOpenEpochV1({ ...envelope(loaded, 'fact.desk.start.' + submission(input.submissionKey)), viewerKey: input.viewerKey,
    triggerKind: 'continue-host', rawInput: '真人 GM 明确开始本次 Oracle 咨询与事实审阅' })
  return { sequence: event.sequence }
}
export async function consultTtrpgOpenFactDeskV1(input: TtrpgOpenFactDeskInputV1 & { submissionKey: string; oracleKey: string; question: string; likelihoodTierKey: string | null; decision: 'consult-this-once' }) {
  const loaded = await human(input)
  if (input.decision !== 'consult-this-once' || !available(loaded, input).canConsult) p.fail('当前不能进行新的事实咨询，请保留原结果')
  const event = await consultTtrpgOracleV1({ ...envelope(loaded, 'fact.desk.oracle.' + submission(input.submissionKey)), viewerKey: input.viewerKey,
    oracleKey: input.oracleKey, question: input.question, likelihoodTierKey: input.likelihoodTierKey, askedBy: 'gm' })
  return { sequence: event.sequence }
}
export async function closeTtrpgOpenFactDeskV1(input: TtrpgOpenFactDeskInputV1 & { submissionKey: string; decision: 'close-this-fact-consultation' }) {
  const loaded = await human(input), flags = available(loaded, input)
  if (input.decision !== 'close-this-fact-consultation' || !flags.canClose) p.fail('请先处理原行动或模型请求，并在原请求面板完成收尾')
  const event = await closeTtrpgOpenEpochV1({ ...envelope(loaded, 'fact.desk.close.' + submission(input.submissionKey)), viewerKey: input.viewerKey,
    epochKey: flags.epoch!.epochKey, reason: '真人 GM 明确结束本次事实咨询与审阅，保留已确认记录' })
  return { sequence: event.sequence }
}
