import Dexie from 'dexie'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { readVerifiedAgentRunInTransactionV1 } from '../agent/run/event-store'
import { assertWorkCoverCandidateHashV1, assertWorkCoverPortableRowV1 } from './contracts'
import { db } from '../db/schema'
import { prepareMediaBlobV1, putPreparedMediaBlobV1, type PreparedMediaBlobV1 } from '../media/blob-store'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../workspace/scope'
import type { WorkspaceScope } from '../types'
import type { WorkCoverAssetV1, WorkCoverImageCandidateV1, WorkCoverLocalRepairIntentV1, WorkCoverRepairedImageCandidateV1 } from './types'
import { assertLiveRepairedCoverAssetV1, captureCoverSourceV1, coverRepairBindingV1, coverRepairContractV1,
  type CoverRepairDescriptorV1, type CoverRepairEvidenceV1, type CoverSourceWitnessV1 } from './repair-proof'
import { assertLongformCoverWorkV1, coverRecordInScopeV1 } from './drafts'

/** Uploads have the same Work-owned asset/CAS path, with no synthetic model Run. */
export async function uploadWorkCoverAssetV1(input: {
  scope: WorkspaceScope; draftId: number; expectedDraftRevision: number; data: ArrayBuffer
}): Promise<WorkCoverAssetV1 & { id: number }> {
  const prepared = await prepareMediaBlobV1(input.data)
  return db.transaction('rw', scopeTransactionTables(db.workCoverDrafts, db.workCoverAssets, db.mediaBlobObjects), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const work = await db.works.get(scope.workId)
    assertLongformCoverWorkV1(work, scope)
    const draft = await db.workCoverDrafts.get(input.draftId)
    if (!draft || !coverRecordInScopeV1(scope, draft) || draft.workCode !== work.code || !await assertRecordInScope(scope, 'workCoverDrafts', draft, { owner: 'work' })
      || draft.revision !== input.expectedDraftRevision || draft.expectedWorkUpdatedAt !== work.updatedAt) throw new Error('作品或封面草稿已修改，请重读后上传。')
    const asset = await storeWorkCoverOriginalAssetInTransactionV1(scope, prepared, { kind: 'upload' })
    const id = asset.id
    await db.workCoverDrafts.update(input.draftId, { selectedAssetId: id, revision: draft.revision + 1,
      pendingAdoptionJson: null, renderManifestHash: null, updatedAt: Date.now() })
    return asset
  })
}

/** One Work-owned asset factory serves uploads and governed image materialization.
 * It never accepts a role, Blob locator or producer provenance from model JSON. */
export async function storeWorkCoverOriginalAssetInTransactionV1(
  scope: WorkspaceScope, image: PreparedMediaBlobV1,
  origin: { kind: 'upload' } | { kind: 'model'; runId: number; candidate: WorkCoverImageCandidateV1 }
    | { kind: 'repaired-model'; runId: number; materializationRunId: number; candidate: WorkCoverRepairedImageCandidateV1;
      source: CoverSourceWitnessV1; descriptor: CoverRepairDescriptorV1;
      finalize: (pending: Readonly<WorkCoverAssetV1 & { id: number }>) => Promise<CoverRepairEvidenceV1> },
): Promise<WorkCoverAssetV1 & { id: number }> {
  const transaction = Dexie.currentTransaction
  if (!transaction?.active || transaction.db !== db || transaction.mode !== 'readwrite'
    || !['works', 'workCoverAssets', 'mediaBlobObjects'].every(name => transaction.storeNames.includes(name))) throw new Error('封面原图必须在完整的原子资产事务内保存。')
  const work = await db.works.get(scope.workId)
  assertLongformCoverWorkV1(work, scope)
  let refs = '[]', createdAt = Date.now()
  if (origin.kind === 'model') {
    const candidate = origin.candidate
    await Dexie.waitFor(assertWorkCoverCandidateHashV1(candidate))
    const run = await readVerifiedAgentRunInTransactionV1(scope, origin.runId)
    const response = await db.workCoverResponseBuffers.where('runId').equals(origin.runId).first()
    const candidateDescriptorHash = await Dexie.waitFor(hashCanonicalValue(candidate))
    const artifactRefs = run.events.flatMap(item => item.type === 'evidence.artifact.recorded'
      ? [{ artifactKind: item.payload.artifactKind, contentHash: item.payload.contentHash }] : [])
    if (!response || !coverRecordInScopeV1(scope, response) || !['response-observed', 'materializing'].includes(response.state)
      || response.workCode !== work.code || response.dispatchKey !== candidate.dispatchKey || response.assetKey !== candidate.assetKey
      || response.briefHash !== candidate.briefHash || response.routeHash !== candidate.routeHash || response.rawResponseHash !== candidate.responseHash
      || candidate.workCode !== work.code || candidate.blobHash !== image.contentHash || run.contract.runtimeBindingHash !== candidate.routeHash
      || !run.contract.executionBindings?.some(binding => binding.skillId === 'inspiration.work-cover-image-v1')
      || !run.events.some(item => item.type === 'model.requested' && item.payload.bindingHash === candidate.routeHash)
      || !artifactRefs.some(ref => ref.artifactKind === 'raw-response' && ref.contentHash === candidate.providerReceiptHash)
      || !artifactRefs.some(ref => ref.artifactKind === 'tool-result' && ref.contentHash === candidateDescriptorHash)) throw new Error('图片资产缺少同一原运行/原答/候选的完整来源证明。')
    refs = canonicalStringify(artifactRefs); createdAt = response.createdAt
  }
  if (origin.kind === 'repaired-model') {
    if (!['workCoverResponseBuffers', 'agentRuns', 'agentRunEvents', 'agentRunArtifacts', 'agentRunCheckpoints'].every(name => transaction.storeNames.includes(name))) throw new Error('本地恢复必须拥有完整结果事务。')
    const response = await db.workCoverResponseBuffers.where('runId').equals(origin.runId).first()
    const intent = response?.localRepairJson ? JSON.parse(response.localRepairJson) as WorkCoverLocalRepairIntentV1 : null
    const proof = await readVerifiedAgentRunInTransactionV1(scope, origin.materializationRunId)
    await Dexie.waitFor(assertWorkCoverCandidateHashV1(origin.candidate))
    if (!response || !coverRecordInScopeV1(scope, response) || !response.payload || response.state !== 'failed'
      || response.errorCode !== 'image-response-rejected' || !intent || intent.phase !== 'bound'
      || intent.runId !== origin.materializationRunId || intent.nonce !== origin.descriptor.nonce
      || intent.operationKey !== origin.descriptor.operationKey || intent.repairProofHash !== origin.candidate.repairProofHash
      || proof.projection.state !== 'running' || origin.materializationRunId === origin.runId
      || canonicalStringify(proof.contract) !== canonicalStringify(coverRepairContractV1(scope.projectId, await Dexie.waitFor(coverRepairBindingV1(origin.descriptor))))
      || canonicalStringify(await captureCoverSourceV1(scope, response)) !== canonicalStringify(origin.source)
      || origin.candidate.workCode !== work.code || origin.candidate.blobHash !== image.contentHash
      || origin.candidate.assetKey !== response.assetKey) throw new Error('本地恢复缺少有效原答与独立零模型运行。')
    const events = [...origin.source.ledger.events, ...proof.events]
    const artifactRefs = events.flatMap(event => event.type === 'evidence.artifact.recorded'
      ? [{ artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash }] : [])
    refs = canonicalStringify([...new Map(artifactRefs.map(ref => [canonicalStringify(ref), ref])).values()])
    createdAt = response.createdAt
  }
  const generated = origin.kind !== 'upload'
  const blob = await putPreparedMediaBlobV1(scope, image)
  const row: WorkCoverAssetV1 = { ...scope, version: 1, workCode: work.code,
    assetKey: generated ? origin.candidate.assetKey : crypto.randomUUID(),
    role: generated ? 'generated-original' : 'uploaded-original',
    blobObjectId: blob.id, blobHash: image.contentHash, mimeType: image.mimeType,
    width: image.width, height: image.height, byteSize: image.data.byteLength,
    sourceRunId: generated ? origin.runId : null, ordinal: 0, parentAssetId: null, layoutHash: null,
    rights: generated ? 'provider-terms-unverified' : 'author-upload',
    candidateJson: generated ? canonicalStringify(origin.candidate) : null,
    ...(origin.kind === 'repaired-model' ? { materializationRunId: origin.materializationRunId, repairEvidenceJson: null } : {}),
    exactArtifactRefsJson: refs, createdAt }
  const id = await db.workCoverAssets.add(row)
  if (origin.kind === 'repaired-model') {
    // Pending admission cannot escape this factory. The callback proves actual
    // poststate and terminalizes inside this same owning transaction first.
    const evidence = await Dexie.Promise.resolve(origin.finalize(Object.freeze({ ...row, id })))
    const actual = await db.workCoverAssets.get(id)
    if (canonicalStringify(actual) !== canonicalStringify({ ...row, id })) throw new Error('恢复中的原图记录已变化。')
    row.repairEvidenceJson = canonicalStringify(evidence)
    assertWorkCoverPortableRowV1('asset', row as unknown as Record<string, unknown>)
    await Dexie.Promise.resolve(assertLiveRepairedCoverAssetV1(scope, row))
    await db.workCoverAssets.update(id, { repairEvidenceJson: row.repairEvidenceJson })
  }
  return { ...row, id }
}
