import Dexie from 'dexie'
import { db } from '../db/schema'
import type { AgentRunEventPayloadByTypeV1, AnyAgentRunEventV1, WorkspaceScope } from '../types'
import { appendAgentRunEventWithSettlementInTransactionV1, appendPrivilegedAgentRunEventInTransactionV1,
  createAgentRunV1, readVerifiedAgentRunInTransactionV1, withAgentRunMutationLockV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { createAgentRunCheckpointInTransactionV1 } from '../agent/run/checkpoint'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { prepareMediaBlobV1, readVerifiedMediaBlobV1, sha256BinaryV1 } from '../media/blob-store'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../workspace/scope'
import { assertLongformCoverWorkV1, coverRecordInScopeV1 } from './drafts'
import { readWorkCoverImageBytesV1 } from './materialize'
import { storeWorkCoverOriginalAssetInTransactionV1 } from './assets'
import { appendCoverEvidenceOnceV1, failCoverRunV1 } from './run-evidence'
import { assertLiveRepairedCoverAssetV1, captureCoverSourceV1, coverLedgerWitnessV1, coverRepairBindingV1,
  coverRepairContractV1, coverRepairPostStateV1, COVER_REPAIR_DECODER_V1, COVER_REPAIR_STEP_V1 as STEP,
  type CoverRepairDescriptorV1 } from './repair-proof'
import type { WorkCoverAssetV1, WorkCoverLocalRepairIntentV1, WorkCoverRepairedImageCandidateV1, WorkCoverResponseBufferV1 } from './types'

function fail(message: string): never { throw new Error(`[work-cover] ${message}；不会重新发送。`) }
export function readCoverRepairIntentV1(raw: string | null | undefined): WorkCoverLocalRepairIntentV1 | null {
  if (raw == null) return null
  const value = JSON.parse(raw) as WorkCoverLocalRepairIntentV1
  if (!value || Object.keys(value).sort().join(',') !== 'assetId,draftRevision,expectedWorkUpdatedAt,nonce,operationKey,phase,repairProofHash,runId,sourceWitnessHash,version'
    || value.version !== 1 || !['reserved', 'creating-root', 'bound', 'candidate-ready'].includes(value.phase)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.nonce) || ![value.operationKey, value.sourceWitnessHash, value.repairProofHash].every(hash => /^[a-f0-9]{64}$/.test(hash))
    || !Number.isSafeInteger(value.draftRevision) || value.draftRevision < 1 || !Number.isSafeInteger(value.expectedWorkUpdatedAt) || value.expectedWorkUpdatedAt < 0
    || [value.runId, value.assetId].some(id => id !== null && (!Number.isSafeInteger(id) || id < 1))
    || (['reserved', 'creating-root'].includes(value.phase) && (value.runId !== null || value.assetId !== null))
    || (value.phase === 'bound' && value.assetId !== null)
    || (['bound', 'candidate-ready'].includes(value.phase) && value.runId == null)
    || (value.phase === 'candidate-ready' && value.assetId == null)) fail('本地恢复意图损坏')
  return value
}
function tables() { return scopeTransactionTables(db.workCoverResponseBuffers, db.workCoverDrafts, db.workCoverAssets,
  db.mediaBlobObjects, db.agentRuns, db.agentRunEvents, db.agentRunArtifacts, db.agentRunCheckpoints) }
function eligible(buffer: WorkCoverResponseBufferV1 | undefined, scope: WorkspaceScope): asserts buffer is WorkCoverResponseBufferV1 & { id: number; payload: ArrayBuffer; rawResponseHash: string; httpStatus: number } {
  if (!buffer?.id || !coverRecordInScopeV1(scope, buffer) || buffer.state !== 'failed' || buffer.errorCode !== 'image-response-rejected'
    || !buffer.payload || !buffer.rawResponseHash || buffer.httpStatus == null || buffer.httpStatus < 200 || buffer.httpStatus >= 300) fail('没有可验证的本机失败原答')
}
function event<T extends AnyAgentRunEventV1['type']>(snapshot: AgentRunSnapshotV1, type: T, payload: AgentRunEventPayloadByTypeV1[T]): AnyAgentRunEventV1 {
  return { version: 1, type, payload, runId: snapshot.run.id, projectId: snapshot.run.projectId,
    worldGroupId: null, contractHash: snapshot.run.contractHash, generation: snapshot.run.generation,
    sequence: snapshot.projection.lastSequence + 1, createdAt: Date.now() } as AnyAgentRunEventV1
}

/** Explicit local-only verification. No config, credentials, transport, fetch,
 * model permit or parent FK can enter this API. Lock lifetime covers settlement. */
export async function repairSavedWorkCoverImageV1(input: {
  scope: WorkspaceScope; sourceRunId: number; draftId: number; expectedDraftRevision: number; expectedWorkUpdatedAt: number
}): Promise<WorkCoverAssetV1 & { id: number }> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) fail('当前环境不支持跨标签页恢复锁')
  const scope = await resolveScope({ scope: input.scope })
  const initial = await db.workCoverResponseBuffers.where('runId').equals(input.sourceRunId).first()
  if (!initial || !coverRecordInScopeV1(scope, initial)) fail('没有本机原答')
  return navigator.locks.request(`storyforge:work-cover-repair:${initial.workCode}:${initial.dispatchKey}`, { mode: 'exclusive' }, async () => {
    // Committed original identity wins before any new decoder intent or CAS.
    const existing = await db.workCoverAssets.where('[workId+assetKey]').equals([scope.workId, initial.assetKey]).first()
    if (existing?.id) {
      if (!coverRecordInScopeV1(scope, existing) || existing.sourceRunId !== input.sourceRunId) fail('原图身份冲突')
      const evidence = await assertLiveRepairedCoverAssetV1(scope, existing)
      if (evidence.source.responseHash !== initial.rawResponseHash || evidence.source.dispatchKey !== initial.dispatchKey) fail('原答与已保存结果不一致')
      const blob = await readVerifiedMediaBlobV1({ scope, blobObjectId: existing.blobObjectId })
      if (blob.contentHash !== existing.blobHash) fail('已保存原图损坏')
      return existing as WorkCoverAssetV1 & { id: number }
    }
    const frozen = await db.transaction('r', tables(), async () => {
      const buffer = await db.workCoverResponseBuffers.get(initial.id!)
      eligible(buffer, scope)
      if (buffer.dispatchKey !== initial.dispatchKey || buffer.assetKey !== initial.assetKey
        || buffer.rawResponseHash !== initial.rawResponseHash || await Dexie.waitFor(sha256BinaryV1(buffer.payload)) !== buffer.rawResponseHash) fail('原答绑定或内容已变化')
      const work = await db.works.get(scope.workId), draft = await db.workCoverDrafts.get(input.draftId)
      assertLongformCoverWorkV1(work, scope)
      if (!draft || !coverRecordInScopeV1(scope, draft) || buffer.workCode !== work.code || draft.workCode !== work.code
        || buffer.draftId !== input.draftId || draft.lastRunId !== input.sourceRunId || draft.revision !== input.expectedDraftRevision
        || work.updatedAt !== input.expectedWorkUpdatedAt || draft.expectedWorkUpdatedAt !== work.updatedAt) fail('作品或草稿已变化，请重读后明确恢复')
      const source = await captureCoverSourceV1(scope, buffer)
      return { buffer, work, draft, source }
    })
    const image = await prepareMediaBlobV1(readWorkCoverImageBytesV1(frozen.buffer.payload))
    const sourceWitnessHash = await hashCanonicalValue(frozen.source)
    const operationKey = await hashCanonicalValue({ workCode: initial.workCode, dispatchKey: initial.dispatchKey,
      responseHash: initial.rawResponseHash, decoderVersion: COVER_REPAIR_DECODER_V1 })
    const priorIntent = readCoverRepairIntentV1(frozen.buffer.localRepairJson)
    const nonce = priorIntent?.nonce ?? crypto.randomUUID()
    const descriptor: CoverRepairDescriptorV1 = { schema: 'storyforge.work-cover.local-image-proof@1',
      decoderVersion: COVER_REPAIR_DECODER_V1, operationKey, nonce, sourceWitnessHash, workCode: initial.workCode,
      assetKey: initial.assetKey, dispatchKey: initial.dispatchKey, briefHash: initial.briefHash, routeHash: initial.routeHash,
      responseHash: initial.rawResponseHash!, blobHash: image.contentHash, mimeType: image.mimeType,
      width: image.width, height: image.height, byteSize: image.data.byteLength,
      draftKey: frozen.draft.draftKey, draftRevision: input.expectedDraftRevision, expectedWorkUpdatedAt: input.expectedWorkUpdatedAt }
    const repairProofHash = await hashCanonicalValue(descriptor)
    const proposed: WorkCoverLocalRepairIntentV1 = { version: 1, operationKey, nonce, phase: 'reserved', runId: null, assetId: null,
      sourceWitnessHash, repairProofHash, draftRevision: input.expectedDraftRevision, expectedWorkUpdatedAt: input.expectedWorkUpdatedAt }
    let intent = await db.transaction('rw', tables(), async () => {
      const buffer = await db.workCoverResponseBuffers.get(initial.id!)
      eligible(buffer, scope)
      if (buffer.localRepairJson !== frozen.buffer.localRepairJson || buffer.rawResponseHash !== initial.rawResponseHash) fail('恢复意图已由另一处修改')
      if (priorIntent) {
        for (const key of ['operationKey', 'nonce', 'sourceWitnessHash', 'repairProofHash', 'draftRevision', 'expectedWorkUpdatedAt'] as const) {
          if (priorIntent[key] !== proposed[key]) fail('旧恢复输入已变化，不能重置或另建运行')
        }
        return priorIntent
      }
      await db.workCoverResponseBuffers.update(buffer.id, { localRepairJson: canonicalStringify(proposed) })
      return proposed
    })
    const contract = coverRepairContractV1(scope.projectId, await coverRepairBindingV1(descriptor))
    const contractHash = await hashCanonicalValue(contract)
    const changeIntent = async (next: WorkCoverLocalRepairIntentV1) => {
      await db.transaction('rw', tables(), async () => {
        const row = await db.workCoverResponseBuffers.get(initial.id!)
        if (!row || row.localRepairJson !== canonicalStringify(intent)) fail('恢复意图 CAS 失败')
        if (intent.phase === 'reserved' && await db.agentRuns.where('workId').equals(scope.workId).filter(run => run.contractHash === contractHash).count()) fail('保留意图已有运行，创建结果待检查')
        await db.workCoverResponseBuffers.update(initial.id!, { localRepairJson: canonicalStringify(next) })
      })
      intent = next
    }
    if (intent.phase === 'creating-root') {
      // Same-storage Web Lock + enlisted IDB write barrier waits out a prior
      // creator. No settled root is not permission to create another one.
      const matches = await db.transaction('rw', tables(), async () => {
        const row = await db.workCoverResponseBuffers.get(initial.id!)
        if (row?.localRepairJson !== canonicalStringify(intent)) fail('恢复创建意图已变化')
        return db.agentRuns.where('workId').equals(scope.workId).filter(run => run.contractHash === contractHash).toArray()
      })
      if (matches.length !== 1 || !matches[0].id) fail('本地运行创建结果未知，已停止创建，请保留此记录检查')
      await changeIntent({ ...intent, phase: 'bound', runId: matches[0].id })
    }
    if (intent.phase === 'reserved') {
      await changeIntent({ ...intent, phase: 'creating-root' })
      const root = await createAgentRunV1({ scope, contract })
      try { await changeIntent({ ...intent, phase: 'bound', runId: root.run.id }) }
      catch (error) {
        const current = readCoverRepairIntentV1((await db.workCoverResponseBuffers.get(initial.id!))?.localRepairJson)
        if (current?.nonce !== intent.nonce) await failCoverRunV1(scope, root.run.id, 'cover-repair-claim-lost')
        throw error
      }
    }
    if (intent.phase !== 'bound' || !intent.runId) fail('本地恢复状态不能继续')
    const runId = intent.runId
    await appendCoverEvidenceOnceV1(scope, runId, 'step.scheduled', { stepId: STEP })
    await appendCoverEvidenceOnceV1(scope, runId, 'step.started', { stepId: STEP, attempt: 1 })
    await appendCoverEvidenceOnceV1(scope, runId, 'tool.called', { stepId: STEP, attempt: 1, toolName: 'validate-saved-cover-image', callHash: sourceWitnessHash })
    const preimage: Omit<WorkCoverRepairedImageCandidateV1, 'candidateHash'> = {
      schema: 'storyforge.work-cover.repaired-image-candidate@1', workCode: initial.workCode, assetKey: initial.assetKey,
      dispatchKey: initial.dispatchKey, briefHash: initial.briefHash, routeHash: initial.routeHash, responseHash: initial.rawResponseHash!,
      blobHash: image.contentHash, attempt: 1, ordinal: 0, rights: 'provider-terms-unverified', sourceWitnessHash, repairProofHash,
      decoderVersion: COVER_REPAIR_DECODER_V1 }
    const candidate: WorkCoverRepairedImageCandidateV1 = { ...preimage, candidateHash: await hashCanonicalValue(preimage) }
    for (const [artifactKind, content] of [['source-snapshot', canonicalStringify(frozen.source)],
      ['tool-result', canonicalStringify(descriptor)], ['tool-result', canonicalStringify(candidate)]] as const) {
      await recordAgentRunArtifactV1({ scope, runId, artifactKind, content, stepId: STEP, attempt: 1 })
    }
    return withAgentRunMutationLockV1(runId, () => db.transaction('rw', tables(), async () => {
      const buffer = await db.workCoverResponseBuffers.get(initial.id!)
      eligible(buffer, scope)
      if (buffer.localRepairJson !== canonicalStringify(intent) || buffer.rawResponseHash !== initial.rawResponseHash
        || await Dexie.waitFor(sha256BinaryV1(buffer.payload)) !== initial.rawResponseHash) fail('原答或恢复意图已变化')
      const work = await db.works.get(scope.workId), draft = await db.workCoverDrafts.get(input.draftId)
      assertLongformCoverWorkV1(work, scope)
      if (work.updatedAt !== input.expectedWorkUpdatedAt || !draft || !coverRecordInScopeV1(scope, draft)
        || draft.revision !== input.expectedDraftRevision || draft.lastRunId !== input.sourceRunId
        || draft.expectedWorkUpdatedAt !== work.updatedAt || draft.draftKey !== descriptor.draftKey) fail('作品或草稿已变化')
      const asset = await Dexie.Promise.resolve(storeWorkCoverOriginalAssetInTransactionV1(scope, image, {
        kind: 'repaired-model', runId: input.sourceRunId, materializationRunId: runId, candidate, source: frozen.source, descriptor,
        finalize: async pending => {
          const actual = await db.workCoverAssets.get(pending.id), blob = await db.mediaBlobObjects.get(pending.blobObjectId)
          if (canonicalStringify(actual) !== canonicalStringify(pending) || !blob || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })
            || blob.storageState !== 'ready' || blob.disposition !== 'available' || !blob.data
            || await Dexie.waitFor(sha256BinaryV1(blob.data)) !== candidate.blobHash || blob.contentHash !== candidate.blobHash
            || blob.mimeType !== descriptor.mimeType || blob.width !== descriptor.width || blob.height !== descriptor.height
            || blob.byteSize !== descriptor.byteSize || blob.data.byteLength !== descriptor.byteSize) fail('实际原图结果不匹配')
          let live = await readVerifiedAgentRunInTransactionV1(scope, runId)
          live = await appendPrivilegedAgentRunEventInTransactionV1(live, event(live, 'tool.returned', { stepId: STEP, attempt: 1, toolName: 'validate-saved-cover-image', resultHash: repairProofHash }))
          live = await appendPrivilegedAgentRunEventInTransactionV1(live, event(live, 'candidate.persisted', { stepId: STEP, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: false }))
          live = await appendPrivilegedAgentRunEventInTransactionV1(live, event(live, 'step.succeeded', { stepId: STEP, attempt: 1, outputHash: candidate.candidateHash }))
          live = await appendPrivilegedAgentRunEventInTransactionV1(live, event(live, 'verification.started', { verifierSetVersion: 'work-cover-local-repair-v1' }))
          const receipt = await Dexie.waitFor(createVerificationReceiptV1({ version: 1, runId, generation: 1,
            contractHash: live.run.contractHash, contextManifestHashes: [], candidateHashes: [], adoptionEventIds: [],
            postStateHash: await Dexie.waitFor(hashCanonicalValue(coverRepairPostStateV1(pending, candidate))),
            verifierSetVersion: 'work-cover-local-repair-v1', criteria: [{ id: 'cover.local-bytes', status: 'passed',
              evidenceRefs: [`candidate:${candidate.candidateHash}`, `proof:${repairProofHash}`] }], acceptedAt: Date.now(),
            zeroModelCommit: { contractJson: live.run.contractJson,
              inputArtifactHashes: [sourceWitnessHash, repairProofHash, await Dexie.waitFor(hashCanonicalValue(candidate))] } }))
          live = (await createAgentRunCheckpointInTransactionV1({ snapshot: live, resumePayload: {
            version: 1, kind: 'work-cover.local-repair-ready', portable: false, candidate, receipt,
          } })).snapshot
          live = await appendAgentRunEventWithSettlementInTransactionV1({ snapshot: live, scope,
            event: event(live, 'verification.accepted', { receiptHash: receipt.receiptHash }) })
          return { schema: 'storyforge.work-cover.repair-evidence@1', source: frozen.source, descriptor, proof: coverLedgerWitnessV1(live), receipt }
        },
      }))
      // Explicit current CAS permits selecting this candidate, never adopting.
      await db.workCoverDrafts.update(input.draftId, { selectedAssetId: asset.id, revision: draft.revision + 1,
        pendingAdoptionJson: null, renderManifestHash: null, updatedAt: Date.now() })
      await db.workCoverResponseBuffers.update(initial.id!, { localRepairJson: canonicalStringify({ ...intent, phase: 'candidate-ready', assetId: asset.id }), payload: null })
      return asset
    }))
  })
}
