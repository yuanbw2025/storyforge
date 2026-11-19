import Dexie from 'dexie'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { readVerifiedAgentRunInTransactionV1 } from '../agent/run/event-store'
import { assertWorkCoverCandidateHashV1 } from './contracts'
import { db } from '../db/schema'
import { prepareMediaBlobV1, putPreparedMediaBlobV1, type PreparedMediaBlobV1 } from '../media/blob-store'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../workspace/scope'
import type { WorkspaceScope } from '../types'
import type { WorkCoverAssetV1, WorkCoverImageCandidateV1 } from './types'
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
  origin: { kind: 'upload' } | { kind: 'model'; runId: number; candidate: WorkCoverImageCandidateV1 },
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
  const blob = await putPreparedMediaBlobV1(scope, image)
  const row: WorkCoverAssetV1 = { ...scope, version: 1, workCode: work.code,
    assetKey: origin.kind === 'model' ? origin.candidate.assetKey : crypto.randomUUID(),
    role: origin.kind === 'model' ? 'generated-original' : 'uploaded-original',
    blobObjectId: blob.id, blobHash: image.contentHash, mimeType: image.mimeType,
    width: image.width, height: image.height, byteSize: image.data.byteLength,
    sourceRunId: origin.kind === 'model' ? origin.runId : null, ordinal: 0, parentAssetId: null, layoutHash: null,
    rights: origin.kind === 'model' ? 'provider-terms-unverified' : 'author-upload',
    candidateJson: origin.kind === 'model' ? canonicalStringify(origin.candidate) : null,
    exactArtifactRefsJson: refs, createdAt }
  const id = await db.workCoverAssets.add(row)
  return { ...row, id }
}
