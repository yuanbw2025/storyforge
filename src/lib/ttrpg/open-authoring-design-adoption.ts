/** Author-confirmed S2 adoption. The original Run, canonical draft and
 * immutable post-state checkpoint commit together; terminal repair never writes a draft. */
import Dexie, { type Transaction } from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import type { AdoptInput, AdoptResult } from '../registry/types'
import { adopt } from '../registry/adopt'
import { creativeArtifactCanAdoptV1 } from '../agent/creative-reliability'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { assertFormalAIEntrySnapshotIntegrityV1 } from '../agent/formal-ai-entry'
import type { AgentSkillDefinitionV1 } from '../agent/skill-registry'
import { readAgentRunV1, readVerifiedAgentRunInTransactionV1, appendPrivilegedAgentRunEventInTransactionV1,
  appendAgentRunEventV1, withAgentRunMutationLockV1, agentRunScopeTransactionTablesV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import { createAgentRunCheckpointInTransactionV1, verifyAgentRunCheckpointV1, completeAgentRunRecoveryV1 } from '../agent/run/checkpoint'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { readContextGatewayManifestV3ForAttemptV1 } from '../context-gateway/attempt-evidence'
import { assertWorldSemanticReleaseCurrentV1, worldSemanticReleaseTransactionTablesV1 } from '../context-gateway/world-release-client'
import { readTtrpgDraft, saveTtrpgDraft } from './authoring-service'
import { serializeTtrpgSettings, type TtrpgAuthoringDraftV1 } from './authoring-contract'
import type { TtrpgAuthoringSettingsV2 } from './authoring-contract-v2'
import { readTtrpgOpenAuthoringDesignReviewV1, TTRPG_OPEN_DESIGN_STEP_V1 } from './open-authoring-design-harness'
import { composeTtrpgOpenAuthoringDesignV1, parseTtrpgOpenAuthoringDesignProposalsV1, ttrpgOpenDesignProfileForSkillV1 } from './open-authoring-design-contract'
import { verifyTtrpgOpenAuthoringSourceProvenanceV1 } from './open-source-provenance'
import { hashProductProductionValueV2 } from '../product-production/hash'
import * as p from './open-contract-parse'
import { withTtrpgOpenDesignOwnerV1 } from './open-authoring-design-owner'

const STEP = TTRPG_OPEN_DESIGN_STEP_V1, TARGET = 'ttrpgAuthoringDrafts'
const SCHEMA = 'storyforge.ttrpg-open-authoring-design-adoption'
const VERIFIER = 'ttrpg-open-authoring-design-adoption-v1'
type Settings = Extract<TtrpgAuthoringSettingsV2, { runFormat: 'open' }>
export interface TtrpgOpenDesignAdoptionV1 {
  schema: typeof SCHEMA; version: 1; portable: false; runId: number; candidateHash: string; sourceBasisHash: string
  selection: Record<string, string>; confirmedFactKeys: string[]; intentHash: string
  sourceRevision: number; targetRevision: number; adoptedAt: number
  postState: { draft: TtrpgAuthoringDraftV1; workTitle: string }; postStateHash: string; adoptionHash: string
}
export interface TtrpgOpenDesignAdoptionInputV1 {
  scope: WorkspaceScope; runId: number; candidateHash: string; selection: unknown; confirmedFactKeys: unknown
  confirmation: 'confirm-design-selection-v1'
}
interface Authority { transaction: Transaction; scope: WorkspaceScope; revision: number; draftId: number; json: string; settings: Settings; title: string }
const authorities = new WeakMap<object, Authority>()
function fail(message: string): never { throw new Error(`[ttrpg-design-adoption] ${message}`) }
const equal = (left: unknown, right: unknown) => canonicalStringify(left) === canonicalStringify(right)

/** Only adopt() may delegate this payload while the issuing business transaction
 * is live. Possessing settings JSON, IDs or a Run hash is not a write capability. */
export async function adoptTtrpgOpenAuthoringDesignPayloadV1(input: AdoptInput): Promise<AdoptResult> {
  const token = authorities.get(input.data)
  if (!token || Dexie.currentTransaction !== token.transaction || input.target !== TARGET || input.mode !== 'replace'
    || input.recordId !== token.draftId || input.compareAndSet || !equal(input.scope, token.scope)
    || Array.isArray(input.data) || !equal(Object.keys(input.data), ['settingsJson']) || input.data.settingsJson !== token.json) {
    fail('设计写回必须来自已核对的原候选、本人确认和同一采纳事务')
  }
  authorities.delete(input.data)
  const saved = await saveTtrpgDraft(token.scope, token.revision, token.settings, token.title)
  if (saved.id !== token.draftId || saved.settingsJson !== token.json) fail('正式保存结果与确认的设计不一致')
  return { written: [{ id: saved.id!, fields: ['settingsJson'] }], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
}
async function assertWriteAuthority(snapshot: AgentRunSnapshotV1): Promise<void> {
  const binding = snapshot.contract.executionBindings?.find(row => row.stepId === STEP)
  const profile = binding && ttrpgOpenDesignProfileForSkillV1(binding.skillId)
  if (binding?.version !== 2 || !binding.formalEntry || !profile) fail('原设计缺少冻结采纳权限')
  const definition = { ...JSON.parse(binding.skillDefinitionJson), version: 1 } as AgentSkillDefinitionV1
  const entry = await assertFormalAIEntrySnapshotIntegrityV1(binding.formalEntry, new Map([[binding.skillId, definition]]))
  if (!entry.adoptAllowed || entry.entryId !== profile.entryId || !equal(entry.adoptionTargets, [TARGET])
    || binding.writeTargets.length !== 1 || !equal(binding.writeTargets[0], { table: TARGET, fields: ['settingsJson'], mode: 'author-confirmed' })) {
    fail('这份旧设计只允许参考；请明确发起具有采纳权限的新请求')
  }
}
function choices(input: TtrpgOpenDesignAdoptionInputV1, keys: string[]) {
  if (input.confirmation !== 'confirm-design-selection-v1') fail('请明确确认所选设计')
  const row = p.record(input.selection, keys, 'design adoption selection')
  const selection = Object.fromEntries(keys.map(key => [key, p.key(row[key], key)]))
  const confirmedFactKeys = p.unique(p.keys(input.confirmedFactKeys, 'explicitly confirmed new facts', 20_000), 'confirmed facts').sort()
  return { selection, confirmedFactKeys }
}
async function intentHash(candidateHash: string, value: { selection: Record<string, string>; confirmedFactKeys: string[] }) {
  return hashCanonicalValue({ candidateHash, ...value })
}
async function committed(input: { scope: WorkspaceScope; runId: number }): Promise<TtrpgOpenDesignAdoptionV1 | null> {
  const rows = await db.agentRunCheckpoints.where('runId').equals(input.runId).toArray()
  let result: TtrpgOpenDesignAdoptionV1 | null = null
  for (const row of rows) {
    if (!row.resumePayloadJson?.includes(SCHEMA)) continue
    if (!await verifyAgentRunCheckpointV1(input.scope, row.id!)) fail('设计提交检查点无法校验')
    const value = JSON.parse(row.resumePayloadJson!) as TtrpgOpenDesignAdoptionV1
    if (value?.schema !== SCHEMA) continue
    if (await hashCanonicalValue(value) !== row.resumePayloadHash) fail('设计提交检查点载荷已变化')
    const snapshot = await readAgentRunV1(input.scope, input.runId)
    await assertWriteAuthority(snapshot)
    const { adoptionHash, ...body } = value
    if (value.version !== 1 || value.portable !== false || value.runId !== input.runId
      || value.postState.draft.workId !== input.scope.workId || value.postState.draft.projectId !== input.scope.projectId
      || value.postState.draft.worldId !== input.scope.worldId || value.targetRevision !== value.sourceRevision + 1
      || value.postState.draft.revision !== value.targetRevision
      || adoptionHash !== await hashCanonicalValue(body) || value.postStateHash !== await hashCanonicalValue(value.postState)) fail('已提交设计回执损坏或属于另一作品')
    const events = snapshot.events.filter(event => event.type === 'adoption.committed' && event.payload.stepId === STEP)
    if (events.length !== 1 || events[0].type !== 'adoption.committed' || events[0].payload.adoptionHash !== adoptionHash
      || events[0].payload.candidateHash !== value.candidateHash) fail('设计回执缺少同一原子提交事件')
    if (result && result.adoptionHash !== adoptionHash) fail('存在冲突的设计采纳回执')
    result = value
  }
  return result
}
async function appendInTransaction(snapshot: AgentRunSnapshotV1, type: 'confirmation.recorded' | 'adoption.started' | 'adoption.committed' | 'step.succeeded', payload: unknown) {
  return appendPrivilegedAgentRunEventInTransactionV1(snapshot, parseAgentRunEventV1({ version: 1, runId: snapshot.run.id,
    sequence: snapshot.projection.lastSequence + 1, generation: snapshot.run.generation, projectId: snapshot.run.projectId,
    worldGroupId: snapshot.run.worldGroupId ?? null, contractHash: snapshot.run.contractHash, type, payload, createdAt: Date.now() }))
}

export async function adoptTtrpgOpenAuthoringDesignV1(input: TtrpgOpenDesignAdoptionInputV1) {
  try { return await commitOrRead(input) }
  catch (error) {
    // Another author tab may have committed the same explicit choice while
    // this tab was proving the old basis. Reconcile only that existing write.
    const saved = await committed(input)
    if (!saved) throw error
    const picked = choices(input, Object.keys(saved.selection))
    if (saved.candidateHash !== input.candidateHash || saved.intentHash !== await intentHash(input.candidateHash, picked)) throw error
    return finish(input, saved)
  }
}
async function commitOrRead(input: TtrpgOpenDesignAdoptionInputV1) {
  const prior = await committed(input)
  const reuse = async (value: TtrpgOpenDesignAdoptionV1) => {
    const picked = choices(input, Object.keys(value.selection))
    if (input.candidateHash !== value.candidateHash || await intentHash(input.candidateHash, picked) !== value.intentHash) fail('已提交的选择不能用另一组设计重复写入')
    return finish(input, value)
  }
  if (prior) return reuse(prior)
  const review = await readTtrpgOpenAuthoringDesignReviewV1(input), snapshot = await readAgentRunV1(input.scope, input.runId)
  await assertWriteAuthority(snapshot)
  if (!review.current || snapshot.run.status !== 'awaiting_confirmation' || input.candidateHash !== review.candidate.candidateHash
    || !creativeArtifactCanAdoptV1(review.candidate.artifact) || !review.candidate.proposals) fail('原候选不可采纳，请保留参考并重新核对当前方案')
  const raw = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: review.candidate.rawResponseHash })
  const context = { request: review.request, base: review.source.settings.openAuthoring, readWorldResourceKeys: review.readWorldResourceKeys, ruleRefs: review.ruleRefs }
  const parsed = parseTtrpgOpenAuthoringDesignProposalsV1(raw, context)
  if (!equal(parsed, review.candidate.proposals) || review.candidate.artifact.originalText !== raw
    || review.candidate.artifact.callEvidence.length !== 1 || review.candidate.artifact.callEvidence[0].outputHash !== await hashCanonicalValue(raw)) fail('候选不是原始回答的同一解析结果')
  const manifest = (await readContextGatewayManifestV3ForAttemptV1({ ...input, stepId: STEP, attempt: 1 })).manifest
  const actualReads = [...new Set(manifest.artifacts.filter(ref => ref.role === 'source-snapshot' && ref.sourceKey === 'worldRelease').map(ref => ref.resourceKey).filter(Boolean))].sort()
  if (!equal(actualReads, [...review.readWorldResourceKeys].sort()) || manifest.candidate.rawResponseArtifactHash !== review.candidate.rawResponseHash
    || manifest.candidate.candidateHash !== input.candidateHash) fail('原候选缺少同一实际读取和回答证明')
  const picked = choices(input, review.request.sections)
  const openAuthoring = composeTtrpgOpenAuthoringDesignV1(parsed, picked.selection, context)
  const originalKeys = new Set(context.base.factPolicy.map(item => item.fact.factKey))
  const newKeys = new Set(openAuthoring.factPolicy.filter(item => !originalKeys.has(item.fact.factKey)).map(item => item.fact.factKey))
  if (picked.confirmedFactKeys.some(key => !newKeys.has(key))) fail('本人事实确认只能指向当前选中的新增事实')
  openAuthoring.factPolicy = openAuthoring.factPolicy.map(item => originalKeys.has(item.fact.factKey) ? item
    : { ...item, authorConfirmed: picked.confirmedFactKeys.includes(item.fact.factKey) })
  await verifyTtrpgOpenAuthoringSourceProvenanceV1({ sourcePlan: review.source.sourcePlan, facts: openAuthoring.factPolicy.map(item => item.fact) })
  const settings: Settings = { ...review.source.settings, openAuthoring }, json = serializeTtrpgSettings(settings).settingsJson
  const chosenIntentHash = await intentHash(input.candidateHash, picked)
  const result = await withAgentRunMutationLockV1(input.runId, async () => {
    const raced = await committed(input)
    if (raced) { if (raced.intentHash !== chosenIntentHash) fail('另一份选择已经提交'); return raced }
    return db.transaction('rw', agentRunScopeTransactionTablesV1(input.runId, db.ttrpgAuthoringDrafts, db.ttrpgRulePacks,
      db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, db.agentRunArtifacts, ...worldSemanticReleaseTransactionTablesV1()), async () => {
      let current = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      if (current.projection.lastSequence !== snapshot.projection.lastSequence || current.projection.steps[STEP]?.candidateHash !== input.candidateHash
        || current.run.status !== 'awaiting_confirmation') fail('设计运行已变化，未写入草稿')
      const draft = await readTtrpgDraft(input.scope), rule = await db.ttrpgRulePacks.get(review.source.rulePackId), work = await db.works.get(input.scope.workId)
      if (!rule || !work || work.kind !== 'ttrpg' || draft.id !== review.source.draftId || draft.revision !== review.source.revision
        || await hashProductProductionValueV2(draft) !== review.source.draftRecordHash
        || await hashProductProductionValueV2(rule) !== review.source.ruleRecordHash) fail('原草稿或规则已变化，未写入设计')
      await assertWorldSemanticReleaseCurrentV1({ localReleaseRecordId: review.source.worldReference.localReleaseRecordId,
        expectedProjectId: input.scope.projectId, expectedWorldId: input.scope.worldId, expectedReleaseHash: review.source.worldReference.releaseHash })
      // Locked artifact bytes must still match the proof prepared outside this transaction.
      await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: review.candidate.rawResponseHash })
      current = await appendInTransaction(current, 'confirmation.recorded', { stepId: STEP, candidateHash: input.candidateHash, decision: 'adopt' })
      current = await appendInTransaction(current, 'adoption.started', { stepId: STEP, candidateHash: input.candidateHash, intentHash: chosenIntentHash })
      const data = { settingsJson: json }
      authorities.set(data, { transaction: Dexie.currentTransaction!, scope: input.scope, revision: draft.revision,
        draftId: draft.id!, json, settings, title: work.title })
      try {
        const written = await adopt({ projectId: input.scope.projectId, scope: input.scope, target: TARGET, recordId: draft.id, mode: 'replace', data })
        if (written.written.length !== 1 || written.written[0].id !== draft.id) fail('设计未完整写入，事务回滚')
      } finally { authorities.delete(data) }
      const saved = await readTtrpgDraft(input.scope), postState = { draft: saved, workTitle: (await db.works.get(input.scope.workId))!.title }
      if (saved.revision !== draft.revision + 1 || saved.settingsJson !== json || postState.workTitle !== work.title) fail('设计提交后状态不一致')
      const body: Omit<TtrpgOpenDesignAdoptionV1, 'adoptionHash'> = { schema: SCHEMA, version: 1, portable: false, runId: input.runId,
        candidateHash: input.candidateHash, sourceBasisHash: review.source.basisHash, ...picked, intentHash: chosenIntentHash,
        sourceRevision: draft.revision, targetRevision: saved.revision, adoptedAt: Date.now(), postState, postStateHash: await Dexie.waitFor(hashCanonicalValue(postState)) }
      const receipt = { ...body, adoptionHash: await Dexie.waitFor(hashCanonicalValue(body)) }
      current = await appendInTransaction(current, 'adoption.committed', { stepId: STEP, candidateHash: input.candidateHash, adoptionHash: receipt.adoptionHash })
      current = await appendInTransaction(current, 'step.succeeded', { stepId: STEP, attempt: 1, outputHash: input.candidateHash })
      await createAgentRunCheckpointInTransactionV1({ snapshot: current, resumePayload: receipt, now: receipt.adoptedAt })
      return receipt
    })
  })
  return finish(input, result)
}

/** Reconcile original committed evidence even if the author has edited again.
 * This path contains no model call, adopt(), save or mutable post-state rewrite. */
export async function reconcileTtrpgOpenAuthoringDesignAdoptionV1(input: { scope: WorkspaceScope; runId: number }) {
  const receipt = await committed(input)
  if (!receipt) fail('没有可恢复的已提交设计，未写入草稿')
  return finish(input, receipt)
}
export async function readTtrpgOpenAuthoringDesignAdoptionV1(input: { scope: WorkspaceScope; runId: number }) {
  return committed(input)
}

/** Explicit author dismissal closes a retained request, never its provider job.
 * A running transport must first finish/abort locally; an unknown paused result
 * requires the author's separate acknowledgement before another request. */
export async function dismissTtrpgOpenAuthoringDesignRequestV1(input: {
  scope: WorkspaceScope; runId: number; confirmation: 'discard-design-request-v1'; acknowledgeUnknown?: boolean
}) {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  return withTtrpgOpenDesignOwnerV1(input.scope, () => dismissOwned(input), ['running', 'recovering'].includes(snapshot.run.status))
}
async function dismissOwned(input: Parameters<typeof dismissTtrpgOpenAuthoringDesignRequestV1>[0]) {
  if (input.confirmation !== 'discard-design-request-v1') fail('请明确确认结束这份请求')
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!snapshot.contract.executionBindings?.some(binding => binding.stepId === STEP && !!ttrpgOpenDesignProfileForSkillV1(binding.skillId))
    || snapshot.run.productRuntimeSessionId != null || snapshot.run.productBuildId != null) fail('不是当前作品的作者设计请求')
  if (['completed', 'cancelled', 'failed'].includes(snapshot.run.status)) return snapshot.run.status
  const step = snapshot.projection.steps[STEP]
  if (step?.adoptionHash) fail('这份设计已经保存，请补齐回执，不能按未采用请求结束')
  if (snapshot.run.status === 'awaiting_confirmation' && step?.candidateHash) {
    snapshot = await appendAgentRunEventV1({ ...input, type: 'confirmation.recorded', payload: { stepId: STEP, candidateHash: step.candidateHash, decision: 'reject' },
      expectedLastSequence: snapshot.projection.lastSequence })
  } else if (['paused', 'running', 'recovering'].includes(snapshot.run.status)) {
    if (!input.acknowledgeUnknown) fail('请先核对原请求，并明确确认结束结果未知的等待')
    if (snapshot.run.status === 'recovering') {
      snapshot = await completeAgentRunRecoveryV1({ ...input, checkpointHash: snapshot.projection.lastCheckpointHash!,
        expectedLastSequence: snapshot.projection.lastSequence })
    }
  } else if (snapshot.run.status !== 'planned' && step?.confirmation !== 'reject') fail('请求仍在执行，请先停止本机等待并保留原结果')
  snapshot = await appendAgentRunEventV1({ ...input, type: 'run.cancelled', payload: { reason: '作者明确结束设计请求，原始回答和证据保留' },
    expectedLastSequence: snapshot.projection.lastSequence })
  return snapshot.run.status
}
async function finish(input: { scope: WorkspaceScope; runId: number }, adoption: TtrpgOpenDesignAdoptionV1) {
  try { return { adoption, receiptPending: false, terminalReceiptHash: await finalize(input, adoption), terminalError: '' } }
  catch (error) { return { adoption, receiptPending: true, terminalReceiptHash: null, terminalError: error instanceof Error ? error.message : String(error) } }
}
async function finalize(input: { scope: WorkspaceScope; runId: number }, adoption: TtrpgOpenDesignAdoptionV1): Promise<string> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const append = async (type: 'verification.started' | 'verification.accepted', payload: unknown) => {
    snapshot = await appendAgentRunEventV1({ ...input, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
  }
  if (snapshot.run.status === 'running') await append('verification.started', { verifierSetVersion: VERIFIER })
  if (!['verifying', 'completed'].includes(snapshot.run.status)) fail('已提交设计的运行终态不可恢复')
  const manifests = snapshot.events.filter(event => event.type === 'context.assembled').map(event => event.type === 'context.assembled' ? event.payload.manifestHash : '')
  const receipt = await createVerificationReceiptV1({ version: 1, runId: input.runId, generation: snapshot.run.generation,
    contractHash: snapshot.run.contractHash, contextManifestHashes: manifests, candidateHashes: [adoption.candidateHash], adoptionEventIds: [],
    postStateHash: adoption.postStateHash, verifierSetVersion: VERIFIER, acceptedAt: adoption.adoptedAt,
    criteria: [
      { id: 'design.candidate-valid', status: 'passed', evidenceRefs: [`candidate:${adoption.candidateHash}`] },
      { id: 'design.source-current', status: 'passed', evidenceRefs: [`source:${adoption.sourceBasisHash}`] },
      { id: 'design.author-adopted', status: 'passed', evidenceRefs: [`adoption:${adoption.adoptionHash}`, `post:${adoption.postStateHash}`] },
    ] })
  const existing = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'source-snapshot')
  let retained = false
  for (const event of existing) {
    if (event.type !== 'evidence.artifact.recorded') continue
    let value: { schema?: string; adoptionHash?: string; receipt?: unknown }
    try { value = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: event.payload.contentHash })) }
    catch (error) { if (error instanceof SyntaxError) continue; throw error }
    if (value.schema !== 'storyforge.ttrpg-open-design-adoption-verification') continue
    if (value.adoptionHash !== adoption.adoptionHash || !equal(value.receipt, receipt)) fail('已保存终验与原采纳不一致')
    retained = true
  }
  if (!retained) snapshot = (await recordAgentRunArtifactV1({ ...input, stepId: STEP, attempt: 1, artifactKind: 'source-snapshot',
    content: JSON.stringify({ schema: 'storyforge.ttrpg-open-design-adoption-verification', version: 1, adoptionHash: adoption.adoptionHash, receipt }),
    expectedLastSequence: snapshot.projection.lastSequence })).snapshot
  if (snapshot.run.status !== 'completed') await append('verification.accepted', { receiptHash: receipt.receiptHash })
  if (snapshot.projection.terminalReceiptHash !== receipt.receiptHash) fail('终态回执与原采纳不一致')
  return receipt.receiptHash
}
