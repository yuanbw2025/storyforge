import Dexie from 'dexie'
import { db } from '../db/schema'
import type { NodeFlow, WorkspaceScope, Worldview, StoryCore } from '../types'
import type { AdoptResult } from '../registry/types'
import type { AgentRunEventPayloadByTypeV1, AgentRunEventTypeV1 } from '../types/agent-run'
import {
  appendAgentRunEventWithSettlementInTransactionV1, readVerifiedAgentRunInTransactionV1,
  withAgentRunMutationLockV1, type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import { createAgentRunCheckpointInTransactionV1 } from '../agent/run/checkpoint'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import {
  adoptRestoredWorldviewFieldCandidate, parseWorldviewFieldCandidateDraft,
  worldviewFieldCandidateIssuesV1, worldviewFieldCandidateMatchesRowV1, type WorldviewAgentField,
} from '../agent/worldview-field-copilot'
import {
  adoptRestoredStoryCoreCandidate, parseStoryCoreCandidateDraft,
  storyCoreCandidateIssuesV1, storyCoreCandidateMatchesRowV1, type StoryCoreField,
} from '../agent/story-core-copilot'
import { adoptionTransactionTablesV1 } from '../registry/adopt'
import { assertRecordInScope, readOwnedRows, resolveScope, scopeTransactionTables } from '../workspace/scope'
import { readNodeFieldCandidateCountV1 } from './domain-execution'
import { executionInput, readNodeFieldProducerPrefixV1, NodeFieldProducerWitnessConflictErrorV1 } from './field-producer'
import { parseAuthoringGraph } from './graph-codec'
import { inspectAuthoringGraphFreshness } from './freshness'
import { assertAuthoringCanonReceipt, authoringConnectionsHash, captureAuthoringCanonReceipt,
  hashAuthoringText, readAuthoringTargetFingerprint, readAuthoringReceiptRows, receiptRecordHash } from './bindings'
import type { AuthoringCandidate, AuthoringInputEnvelope } from './contracts'

const STEP = 'node-field:generate'
type ProducerRead = Awaited<ReturnType<typeof readNodeFieldProducerPrefixV1>>
type Slot = ProducerRead['sealedSlots'][number]
type Payload = ReturnType<typeof parseWorldviewFieldCandidateDraft> | ReturnType<typeof parseStoryCoreCandidateDraft>
export interface NodeFieldAdoptionInputV1 {
  scope: WorkspaceScope
  flow: NodeFlow
  runId: number
  nodeId: string
  selectedVariantIndex: number
  draft: string
}

function fail(message: string): never { throw new Error(`节点字段采纳未完成：${message}；保留原稿和原始证据，不重新调用模型。`) }
function assertOutsideTransaction() {
  if (Dexie.currentTransaction) return fail('正式入口不能包在另一个数据库事务中')
}
function same(left: unknown, right: unknown): boolean { return canonicalStringify(left) === canonicalStringify(right) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('记录结构无法核验')
  return value as Record<string, unknown>
}
function parseObject(text: string): Record<string, unknown> { return object(JSON.parse(text)) }

async function frame(input: NodeFieldAdoptionInputV1, allowAdopted = false) {
  const scope = await resolveScope({ scope: input.scope })
  const flow = input.flow.id == null ? undefined : await db.nodeFlows.get(input.flow.id)
  const run = await db.nodeRuns.get(input.runId)
  if (!flow || !run || run.flowId !== flow.id || run.status === 'running'
    || !await assertRecordInScope(scope, 'nodeFlows', flow, { owner: 'work' })
    || !await assertRecordInScope(scope, 'nodeRuns', run, { owner: 'work' })) return fail('原作品或运行不匹配')
  const graph = parseAuthoringGraph(flow.graphJson), original = parseAuthoringGraph(run.graphSnapshotJson)
  const node = original.nodes.find(value => value.id === input.nodeId)
  if (!node || !same(executionInput(original, node.id), executionInput(graph, node.id))
    || !same(executionInput(graph, node.id), executionInput(parseAuthoringGraph(input.flow.graphJson), node.id))) return fail('执行图已变化')
  const snapshots = parseObject(run.inputSnapshotsJson), candidates = parseObject(run.nodeResultsJson)
  const source = object(snapshots[node.id]), raw = object(candidates[node.id])
  if (!Array.isArray(source.inputs) || !raw.signature || typeof raw.output !== 'string'
    || raw.nodeId !== node.id || !Number.isInteger(input.selectedVariantIndex)
    || input.selectedVariantIndex < 0 || (raw.selectedVariantIndex ?? 0) !== input.selectedVariantIndex
    || raw.output !== input.draft || !['draft', 'candidate', 'blocked', ...(allowAdopted ? ['adopted'] : [])].includes(String(raw.status))
    || (raw.status === 'blocked' && raw.authorEditedAfterArtifact !== true)) return fail('选择、编辑稿或原签名不匹配')
  const read = await readNodeFieldProducerPrefixV1({ scope, nodeRun: run, node,
    requestedCount: readNodeFieldCandidateCountV1(node, source.inputs as AuthoringInputEnvelope[]) }, { includeDecided: true })
  const selected = read.sealedSlots.find(value => value.variantIndex === input.selectedVariantIndex)
  if (!read.prefix || !selected || !same(raw.variants, read.prefix.variants)
    || !same(raw.creativeArtifacts, read.prefix.creativeArtifacts) || !same(raw.domain, read.prefix.domain)) return fail('原候选或版本集合无法核验')
  const candidate = raw as unknown as AuthoringCandidate
  if (candidate.signature!.executorVersion !== 'FLOW-3B.2'
    || candidate.signature!.sourceHash !== selected.core.sourceBinding.sourceHash
    || source.sourceHash !== selected.core.sourceBinding.sourceHash) return fail('原来源签名无法核验')
  return { input, scope, flow, run, graph, node, snapshots, candidates, candidate, read, selected }
}
type Frame = Awaited<ReturnType<typeof frame>>

function payload(f: Frame): Payload {
  const domain = f.selected.core.domain
  if (domain.kind === 'worldview-field') {
    const value = parseWorldviewFieldCandidateDraft(f.input.draft)
    const issues = worldviewFieldCandidateIssuesV1(value, { targetField: domain.targetField as WorldviewAgentField, snapshot: domain.snapshot })
    if (issues.length) return fail(issues.map(issue => issue.message).join('；'))
    return value
  }
  const value = parseStoryCoreCandidateDraft(f.input.draft)
  const issues = storyCoreCandidateIssuesV1(value, { targetField: domain.targetField as StoryCoreField, snapshot: domain.snapshot })
  if (issues.length) return fail(issues.map(issue => issue.message).join('；'))
  return value
}

function target(f: Frame) { return f.selected.core.domain.kind === 'worldview-field' ? 'worldviews' : 'storyCores' }
async function targetRow(f: Frame, original: boolean) {
  const table = target(f), world = table === 'worldviews'
  const rows = await readOwnedRows<Record<string, unknown>>(f.scope, table, { owner: world ? 'world' : 'work' })
  const selected = world ? rows.filter(row => (row.worldGroupId ?? null) === (f.flow.worldGroupId ?? null)) : rows
  if (selected.length > 1) return fail('正式目标存在歧义')
  const row = selected[0] ?? null
  if (original && (row?.id ?? null) !== f.selected.core.domain.snapshot.id) return fail('原目标与正式单值目标不一致')
  return row
}

async function assertFresh(f: Frame) {
  // A valid authored repair is gated by the original field validator above;
  // here the existing checker still evaluates its source/config/upstream facts.
  const candidates = { ...f.candidates, [f.node.id]: { ...f.candidate, status: 'draft' as const } }
  const freshness = await inspectAuthoringGraphFreshness({ flow: f.flow, scope: f.scope,
    snapshots: f.snapshots as Parameters<typeof inspectAuthoringGraphFreshness>[0]['snapshots'],
    candidates: candidates as Parameters<typeof inspectAuthoringGraphFreshness>[0]['candidates'] })
  if (freshness[f.node.id]?.status !== 'fresh') return fail('来源、配置或上游已过期')
  const current = await readAuthoringTargetFingerprint({ node: f.node, scope: f.scope,
    projectId: f.scope.projectId, worldGroupId: f.flow.worldGroupId ?? null })
  if (f.candidate.signature!.targetHash && (!current || current.ambiguous || current.hash !== f.candidate.signature!.targetHash)) return fail('正式目标已变化')
  await targetRow(f, true)
}

async function revision(f: Frame, parsed: Payload) {
  return { version: 1, kind: 'node-field-author-revision', portable: false,
    generatedCoreHash: f.selected.checkpoint.candidateHash,
    previousCandidateHash: f.selected.checkpoint.candidateHash,
    originalManifestHash: f.selected.manifestHash,
    originalBasisHash: await hashCanonicalValue({ domain: f.selected.core.domain, sourceBinding: f.selected.core.sourceBinding }),
    draft: f.input.draft, draftHash: await hashCanonicalValue(f.input.draft), parsedPayload: parsed,
    payloadHash: await hashCanonicalValue(parsed) }
}
async function intent(f: Frame, parsed: Payload, effectiveCandidateHash: string) {
  const excludedSealedCandidates = f.read.sealedSlots.filter(slot => slot.variantIndex !== f.input.selectedVariantIndex)
    .map(slot => ({ variantIndex: slot.variantIndex, generatedCoreHash: slot.checkpoint.candidateHash,
      effectiveCandidateHash: slot.effectiveCandidateHash }))
  return { version: 1, kind: 'node-field-adoption-intent', portable: false,
    family: target(f) === 'worldviews' ? 'worldview' : 'story-core', nodeId: f.node.id,
    selectedVariantIndex: f.input.selectedVariantIndex, generatedCoreHash: f.selected.checkpoint.candidateHash,
    effectiveCandidateHash, frozenContractHash: f.selected.snapshot.run.contractHash,
    originalManifestHash: f.selected.manifestHash, originalManifestArtifactHash: f.selected.manifestArtifactHash,
    originalBasisHash: await hashCanonicalValue({ domain: f.selected.core.domain, sourceBinding: f.selected.core.sourceBinding }),
    originalTargetSnapshotHash: await hashCanonicalValue(f.selected.core.domain.snapshot),
    originalSignature: f.candidate.signature!, originalSignatureHash: await hashCanonicalValue(f.candidate.signature!),
    graphExecutionHash: await hashCanonicalValue(executionInput(f.graph, f.node.id)),
    draft: f.input.draft, draftHash: await hashCanonicalValue(f.input.draft), parsedPayload: parsed,
    payloadHash: await hashCanonicalValue(parsed), excludedSealedCandidates,
    excludedSetHash: await hashCanonicalValue(excludedSealedCandidates) }
}
function exactTool(f: Frame, slot: Slot, hash: string, expected: unknown) {
  const body = f.read.readExactBodyForRun(slot.snapshot.run.id, { artifactKind: 'tool-result',
    contentHash: hash, stepId: STEP, attempt: 1 })
  if (body !== canonicalStringify(expected)) return fail('工具工件正文不匹配')
}

async function existingIntent(f: Frame, parsed: Payload) {
  const starts = f.read.producerSnapshots.flatMap(snapshot => snapshot.events.filter(event => event.type === 'adoption.started'
    && event.payload.stepId === STEP).map(event => ({ snapshot, event })))
  if (!starts.length) return null
  if (starts.length !== 1 || starts[0].snapshot.run.id !== f.selected.snapshot.run.id) return fail('本轮已有另一最终选择')
  const event = starts[0].event
  if (event.type !== 'adoption.started' || !event.payload.intentHash
    || event.payload.candidateHash !== f.selected.effectiveCandidateHash
    || f.selected.snapshot.projection.steps[STEP]?.confirmation !== 'adopt') return fail('首次确认链无法核验')
  const revisions = f.selected.snapshot.events.filter(item => item.type === 'candidate.revised' && item.payload.stepId === STEP)
  const edited = f.input.draft !== f.selected.core.artifact.editableText
  if (revisions.length !== (edited ? 1 : 0)) return fail('作者修订链无法核验')
  if (edited) {
    const body = await revision(f, parsed), hash = await hashCanonicalValue(body), changed = revisions[0]
    if (changed.type !== 'candidate.revised' || changed.payload.previousCandidateHash !== f.selected.checkpoint.candidateHash
      || changed.payload.candidateHash !== hash || hash !== f.selected.effectiveCandidateHash) return fail('作者修订 hash 不匹配')
    await exactTool(f, f.selected, hash, body)
  }
  const body = await intent(f, parsed, f.selected.effectiveCandidateHash)
  if (await hashCanonicalValue(body) !== event.payload.intentHash) return fail('最终选择或编辑稿与首次意图不一致')
  await exactTool(f, f.selected, event.payload.intentHash, body)
  return { body, intentHash: event.payload.intentHash }
}

function tables(f: Frame, parsed: Payload) {
  return scopeTransactionTables(db.nodeFlows, db.nodeRuns, db.agentRuns, db.agentRunEvents,
    db.agentRunArtifacts, db.agentRunCheckpoints, db.temporalFacts,
    ...adoptionTransactionTablesV1(target(f), { [parsed.field]: parsed.value }))
}
async function append<T extends AgentRunEventTypeV1>(f: Frame, snapshot: AgentRunSnapshotV1,
  type: T, eventPayload: AgentRunEventPayloadByTypeV1[T], createdAt = Date.now()) {
  const event = parseAgentRunEventV1({ version: 1, runId: snapshot.run.id, projectId: snapshot.run.projectId,
    worldGroupId: snapshot.run.worldGroupId ?? null, sequence: snapshot.projection.lastSequence + 1,
    generation: snapshot.projection.generation, contractHash: snapshot.run.contractHash,
    type, payload: eventPayload, createdAt })
  return await Dexie.Promise.resolve(appendAgentRunEventWithSettlementInTransactionV1({ scope: f.scope, snapshot, event }))
}

async function reconcileConflict<T>(error: unknown, readAcknowledgement: () => Promise<T | null>): Promise<T> {
  if (!(error instanceof NodeFieldProducerWitnessConflictErrorV1)) throw error
  if (Dexie.currentTransaction) throw error
  let acknowledged: T | null
  try { acknowledged = await readAcknowledgement() } catch (recheckFailure) {
    const messages = [...new Set([error.message, recheckFailure instanceof Error ? recheckFailure.message : String(recheckFailure)])]
    throw Object.assign(new Error(messages.join('\n')), { cause: error, persistenceFailures: [recheckFailure] })
  }
  if (acknowledged !== null) return acknowledged
  throw error
}

/** This commits only the real first author decision, not business success. */
export async function confirmNodeFieldAdoptionIntentV1(input: NodeFieldAdoptionInputV1) {
  assertOutsideTransaction()
  let f = await frame(input), parsed = payload(f)
  const previous = await existingIntent(f, parsed)
  if (previous) return { intentHash: previous.intentHash, snapshot: f.selected.snapshot, created: false }
  if (f.selected.snapshot.projection.state !== 'awaiting_confirmation'
    || f.selected.effectiveCandidateHash !== f.selected.checkpoint.candidateHash) return fail('候选不在首次确认状态')
  await assertFresh(f)
  const edited = input.draft !== f.selected.core.artifact.editableText
  const revised = edited ? await revision(f, parsed) : null
  const effectiveHash = revised ? await hashCanonicalValue(revised) : f.selected.checkpoint.candidateHash
  const body = await intent(f, parsed, effectiveHash), intentHash = await hashCanonicalValue(body)
  // Exact artifacts have their own writer/mutex and are deliberately prepared
  // outside every caller-owned transaction and same-Run lock.
  for (const content of [...(revised ? [revised] : []), body]) await recordAgentRunArtifactV1({ scope: f.scope,
    runId: f.selected.snapshot.run.id, stepId: STEP, attempt: 1, artifactKind: 'tool-result', content: canonicalStringify(content) })
  f = await frame(input); parsed = payload(f)
  const concurrent = await existingIntent(f, parsed)
  if (concurrent) return { intentHash: concurrent.intentHash, snapshot: f.selected.snapshot, created: false }
  if (!same(body, await intent(f, parsed, effectiveHash))) return fail('准备期间的原依据已变化')
  await assertFresh(f)
  try { return await withAgentRunMutationLockV1(f.selected.snapshot.run.id, () => db.transaction('rw', tables(f, parsed), async () => {
    await f.read.assertCurrent()
    let snapshot = await readVerifiedAgentRunInTransactionV1(f.scope, f.selected.snapshot.run.id)
    if (snapshot.projection.state !== 'awaiting_confirmation') return fail('确认状态已变化')
    if (revised) snapshot = await append(f, snapshot, 'candidate.revised', { stepId: STEP, attempt: 1,
      previousCandidateHash: f.selected.checkpoint.candidateHash, candidateHash: effectiveHash })
    snapshot = await append(f, snapshot, 'confirmation.recorded', { stepId: STEP, candidateHash: effectiveHash, decision: 'adopt' })
    snapshot = await append(f, snapshot, 'adoption.started', { stepId: STEP, candidateHash: effectiveHash, intentHash })
    const saved = await createAgentRunCheckpointInTransactionV1({ snapshot, resumePayload: f.selected.checkpoint })
    return { intentHash, snapshot: saved.snapshot, created: true }
  })) } catch (error) {
    return reconcileConflict(error, async () => {
      const observed = await frame(input), acknowledged = await existingIntent(observed, payload(observed))
      if (!acknowledged || acknowledged.intentHash !== intentHash
        || observed.selected.snapshot.run.id !== f.selected.snapshot.run.id) return null
      return { intentHash, snapshot: observed.selected.snapshot, created: false }
    })
  }
}

async function proof(f: Frame, parsed: Payload, intentHash: string) {
  const row = await targetRow(f, false)
  if (!row || typeof row.id !== 'number' || typeof row.ragDocumentId !== 'string' || typeof row.updatedAt !== 'number') return fail('正式写入的目标身份无法核验')
  const matches = target(f) === 'worldviews'
    ? worldviewFieldCandidateMatchesRowV1(parsed as ReturnType<typeof parseWorldviewFieldCandidateDraft>, row as unknown as Worldview)
    : storyCoreCandidateMatchesRowV1(parsed as ReturnType<typeof parseStoryCoreCandidateDraft>, row as unknown as StoryCore)
  if (!matches) return fail('正式目标与冻结编辑稿不一致')
  const canonReceipt: NonNullable<AuthoringCandidate['canonReceipt']> = { version: 1, target: target(f),
    outputHash: hashAuthoringText(f.input.draft), connectionsHash: authoringConnectionsHash(f.graph, f.node.id),
    records: [{ documentId: row.ragDocumentId, fields: [parsed.field], hash: receiptRecordHash(row, [parsed.field]) }] }
  assertAuthoringCanonReceipt(canonReceipt)
  const body = { version: 1, kind: 'node-field-adoption-proof', portable: false, intentHash,
    generatedCoreHash: f.selected.checkpoint.candidateHash, effectiveCandidateHash: f.selected.effectiveCandidateHash,
    target: target(f), field: parsed.field,
    postState: { id: row.id, ragDocumentId: row.ragDocumentId, updatedAt: row.updatedAt, value: row[parsed.field] }, canonReceipt }
  return { body, canonReceipt }
}

/** Read proof without changing a Run, confirming an author or adopting again. */
export async function readNodeFieldAdoptionProofV1(input: NodeFieldAdoptionInputV1) {
  assertOutsideTransaction()
  const f = await frame(input, true), parsed = payload(f), selected = await existingIntent(f, parsed)
  return readProofFrame(f, parsed, selected)
}

async function readProofFrame(f: Frame, parsed: Payload, selected: Awaited<ReturnType<typeof existingIntent>>) {
  // Exact artifact/hash validation stays outside this transaction. The same
  // existing witness then fences its real ledger and target postimage reads.
  return db.transaction('r', tables(f, parsed), async () => {
    await f.read.assertReadCurrent()
    if (!selected) return { state: 'unconfirmed' as const }
    const events = f.selected.snapshot.events.filter(event => event.type === 'adoption.committed' && event.payload.stepId === STEP)
    if (!events.length) return { state: 'intent-only' as const, intentHash: selected.intentHash }
    if (events.length !== 1 || events[0].type !== 'adoption.committed') return fail('业务写入凭据不唯一')
    const post = await proof(f, parsed, selected.intentHash)
    const adoptionHash = await Dexie.waitFor(Dexie.ignoreTransaction(() => hashCanonicalValue(post.body)))
    if (events[0].payload.candidateHash !== f.selected.effectiveCandidateHash || events[0].payload.adoptionHash !== adoptionHash) return fail('当前值没有本次原生写入的归属证明')
    return { state: 'committed' as const, intentHash: selected.intentHash, adoptionHash,
      snapshot: f.selected.snapshot, canonReceipt: post.canonReceipt, postState: post.body.postState,
      proofBody: post.body }
  })
}

/** Pure receipt preparation is outside the Run lock and native transaction.
 * The returned closure must be used in its registered parent RW transaction. */
export async function prepareNodeFieldAdoptionCompletionV1(input: NodeFieldAdoptionInputV1) {
  assertOutsideTransaction()
  const f = await frame(input, true), parsed = payload(f), selected = await existingIntent(f, parsed)
  const committed = await readProofFrame(f, parsed, selected)
  if (!selected || committed.state !== 'committed') return fail('没有本次实际业务写入的凭据')
  const original = f.selected.snapshot
  const accepted = original.events.filter(event => event.type === 'verification.accepted')
  const completed = original.projection.state === 'completed'
  if (accepted.length !== (completed ? 1 : 0)
    || !['running', 'verifying', 'completed'].includes(original.projection.state)) return fail('终验状态无法核验')
  const starts = original.events.filter(event => event.type === 'verification.started')
  const succeeded = original.events.filter(event => event.type === 'step.succeeded' && event.payload.stepId === STEP)
  if (starts.length > 1 || starts.some(event => event.type !== 'verification.started'
    || event.payload.verifierSetVersion !== 'node-field-terminal-v1')
    || succeeded.length > 1 || succeeded.some(event => event.type !== 'step.succeeded'
      || event.payload.attempt !== 1 || event.payload.outputHash !== committed.adoptionHash)
    || (original.projection.state !== 'running' && (starts.length !== 1 || succeeded.length !== 1))) return fail('原终验步骤与实际写入不匹配')
  const acceptedAt = completed ? accepted[0].createdAt : Date.now()
  const postStateHash = await hashCanonicalValue(committed.postState)
  const receipt = await createVerificationReceiptV1({
    version: 1, runId: original.run.id, generation: original.projection.generation,
    contractHash: original.projection.contractHash,
    contextManifestHashes: [f.selected.manifestHash], candidateHashes: [f.selected.effectiveCandidateHash],
    adoptionEventIds: [], postStateHash, verifierSetVersion: 'node-field-terminal-v1',
    criteria: [
      { id: 'node-field.candidate', status: 'passed', evidenceRefs: [`candidate:${f.selected.effectiveCandidateHash}`, `manifest:${f.selected.manifestHash}`] },
      { id: 'node-field.author', status: 'passed', evidenceRefs: [`intent:${selected.intentHash}`] },
      { id: 'node-field.post-state', status: 'passed', evidenceRefs: [`adoption:${committed.adoptionHash}`, `post-state:${postStateHash}`] },
    ], acceptedAt,
  })
  if (completed && (accepted[0].type !== 'verification.accepted'
    || accepted[0].payload.receiptHash !== receipt.receiptHash
    || original.projection.terminalReceiptHash !== receipt.receiptHash)) return fail('原终验回执与本次真实依据不匹配')
  const expectedPost = { body: committed.proofBody, canonReceipt: committed.canonReceipt }
  return {
    tables: tables(f, parsed), runId: original.run.id, completed,
    canonReceipt: committed.canonReceipt, receipt,
    commitInTransaction: async () => {
      await f.read.assertCurrent()
      if (!same(await proof(f, parsed, selected.intentHash), expectedPost)) return fail('终验期间正式目标已变化')
      let snapshot = await readVerifiedAgentRunInTransactionV1(f.scope, original.run.id)
      if (completed) return snapshot
      if (snapshot.projection.steps[STEP]?.status === 'running') snapshot = await append(f, snapshot,
        'step.succeeded', { stepId: STEP, attempt: 1, outputHash: committed.adoptionHash }, acceptedAt)
      if (snapshot.projection.state === 'running') snapshot = await append(f, snapshot,
        'verification.started', { verifierSetVersion: 'node-field-terminal-v1' }, acceptedAt)
      return append(f, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash }, acceptedAt)
    },
  }
}

/** No terminal receipt or Node adopted flag is minted by this bounded primitive. */
export async function commitNodeFieldBusinessV1(input: NodeFieldAdoptionInputV1) {
  assertOutsideTransaction()
  const known = await readNodeFieldAdoptionProofV1(input)
  if (known.state === 'committed') return { ...known, result: null, writtenNow: false }
  if (known.state !== 'intent-only') return fail('尚未记录作者首次确认')
  const f = await frame(input), parsed = payload(f), selected = await existingIntent(f, parsed)
  if (!selected || selected.intentHash !== known.intentHash) return fail('首次意图已变化')
  await assertFresh(f)
  try { return await withAgentRunMutationLockV1(f.selected.snapshot.run.id, () => db.transaction('rw', tables(f, parsed), async () => {
    await f.read.assertCurrent()
    const snapshot = await readVerifiedAgentRunInTransactionV1(f.scope, f.selected.snapshot.run.id)
    if (snapshot.projection.steps[STEP]?.confirmation !== 'adopt' || snapshot.projection.steps[STEP]?.adoptionHash) return fail('业务状态已变化')
    await targetRow(f, true)
    const beforeIds = new Set((await readAuthoringReceiptRows(f.scope, target(f)))
      .flatMap(row => typeof row.id === 'number' ? [row.id] : []))
    const domain = f.selected.core.domain
    const result: AdoptResult = domain.kind === 'worldview-field'
      ? await adoptRestoredWorldviewFieldCandidate({ projectId: f.scope.projectId, scope: f.scope,
        worldGroupId: f.flow.worldGroupId ?? null, snapshot: domain.snapshot,
        targetField: domain.targetField as WorldviewAgentField, draft: input.draft })
      : await adoptRestoredStoryCoreCandidate({ projectId: f.scope.projectId, scope: f.scope,
        snapshot: domain.snapshot, targetField: domain.targetField as StoryCoreField, draft: input.draft })
    if (result.written.length !== 1 || !same(result.written[0].fields, [parsed.field])
      || result.unknown.length || result.typeErrors.length || result.fkErrors.length || result.skipped.length) return fail('原 adopter 未完整写入')
    const post = await proof(f, parsed, selected.intentHash)
    if (result.written[0].id !== post.body.postState.id) return fail('原 adopter 写入身份不匹配')
    const actualReceipt = await captureAuthoringCanonReceipt({ scope: f.scope, target: target(f),
      beforeIds, result, output: input.draft, graph: f.graph, nodeId: f.node.id })
    if (!actualReceipt || !same(actualReceipt, post.canonReceipt)) return fail('原节点采纳回执投影不匹配')
    // Only this pure hash is awaited here; child DB operations stay in their
    // original Dexie zone and all child stores are subsets of the parent.
    const adoptionHash = await Dexie.waitFor(Dexie.ignoreTransaction(() => hashCanonicalValue(post.body)))
    const next = await append(f, snapshot, 'adoption.committed', { stepId: STEP,
      candidateHash: f.selected.effectiveCandidateHash, adoptionHash })
    return { state: 'committed' as const, intentHash: selected.intentHash, adoptionHash,
      result, writtenNow: true, snapshot: next, canonReceipt: post.canonReceipt, postState: post.body.postState }
  })) } catch (error) {
    return reconcileConflict(error, async () => {
      const observed = await readNodeFieldAdoptionProofV1(input)
      if (observed.state !== 'committed' || observed.intentHash !== selected.intentHash
        || observed.snapshot.run.id !== f.selected.snapshot.run.id
        || observed.snapshot.projection.steps[STEP]?.candidateHash !== f.selected.effectiveCandidateHash) return null
      return { ...observed, result: null, writtenNow: false }
    })
  }
}
