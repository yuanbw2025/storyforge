import Dexie from 'dexie'
import { db } from '../db/schema'
import type { AdoptInput, AdoptResult } from '../registry/types'
import { adopt } from '../registry/adopt'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../workspace/scope'
import type { WorkspaceScope } from '../types'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { binaryDataUrlV1, readVerifiedMediaBlobV1, sha256BinaryV1 } from '../media/blob-store'
import { assertLongformCoverWorkV1, coverRecordInScopeV1 } from './drafts'
import { assertWorkCoverCandidateHashV1, parseWorkCoverImageCandidateV1 } from './contracts'
import type { WorkCoverAdoptionV1 } from './types'

export interface WorkCoverIdentityV1 {
  rendererId: 'identity-v1'
  sourceBlobHash: string
  outputBlobHash: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  byteSize: number
}
interface CoverAdoptionIntentV1 {
  version: 1
  operationKey: string
  workCode: string
  draftKey: string
  draftRevision: number
  expectedWorkUpdatedAt: number
  assetKey: string
  candidateHash: string
  oldCoverHash: string
  newCoverHash: string
  renderManifestJson: string
  renderManifestHash: string
}

/** U3/U5: validation only. The verified original is the final image; no canvas,
 * byte conversion, fabricated rendered asset, text layer or font requirement. */
export async function renderWorkCoverV1(input: { scope: WorkspaceScope; assetId: number }) {
  const scope = await resolveScope({ scope: input.scope })
  const asset = await db.workCoverAssets.get(input.assetId)
  if (!asset?.id || !coverRecordInScopeV1(scope, asset) || !await assertRecordInScope(scope, 'workCoverAssets', asset, { owner: 'work' })) throw new Error('封面候选不存在或不属于此作品。')
  const blob = await readVerifiedMediaBlobV1({ scope, blobObjectId: asset.blobObjectId })
  if (blob.contentHash !== asset.blobHash || blob.byteSize !== asset.byteSize || blob.mimeType !== asset.mimeType
    || blob.width !== asset.width || blob.height !== asset.height) throw new Error('封面原图与候选证据不一致。')
  if (blob.byteSize > 5 * 1024 * 1024 || asset.width * asset.height > 20_000_000) throw new Error('图片已保留；封面须在 5 MiB、2000 万像素以内，请另选图片。')
  const dataUrl = binaryDataUrlV1(blob.data, asset.mimeType)
  if (dataUrl.length > 7_000_000) throw new Error('图片已保留；封面编码超过保存上限，请另选图片。')
  const descriptor: WorkCoverIdentityV1 = {
    rendererId: 'identity-v1', sourceBlobHash: blob.contentHash, outputBlobHash: blob.contentHash,
    mimeType: asset.mimeType, width: asset.width, height: asset.height, byteSize: asset.byteSize,
  }
  const renderManifestJson = canonicalStringify(descriptor)
  return { asset, blob, dataUrl, renderManifestJson, renderManifestHash: await hashCanonicalValue(descriptor) }
}

/** Explicit author confirmation freezes a durable intent before the atomic
 * adoption. Refresh can recover this exact operation; it never rebases CAS. */
export async function prepareWorkCoverAdoptionV1(input: {
  scope: WorkspaceScope; draftId: number; expectedDraftRevision: number; assetId: number; expectedWorkUpdatedAt: number
}): Promise<{ draftId: number; operationKey: string }> {
  const rendered = await renderWorkCoverV1(input)
  const candidateHash = rendered.asset.candidateJson
    ? parseWorkCoverImageCandidateV1(rendered.asset.candidateJson).candidateHash
    : await hashCanonicalValue({ origin: 'upload', assetKey: rendered.asset.assetKey, blobHash: rendered.asset.blobHash })
  return db.transaction('rw', scopeTransactionTables(db.workCoverDrafts, db.workCoverAssets), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const work = await db.works.get(scope.workId)
    assertLongformCoverWorkV1(work, scope)
    const draft = await db.workCoverDrafts.get(input.draftId)
    const asset = await db.workCoverAssets.get(input.assetId)
    if (!draft || !asset || !coverRecordInScopeV1(scope, draft) || !coverRecordInScopeV1(scope, asset) || asset.workCode !== draft.workCode || !await assertRecordInScope(scope, 'workCoverDrafts', draft, { owner: 'work' })
      || !await assertRecordInScope(scope, 'workCoverAssets', asset, { owner: 'work' })
      || draft.revision !== input.expectedDraftRevision || draft.expectedWorkUpdatedAt !== input.expectedWorkUpdatedAt
      || work.updatedAt !== input.expectedWorkUpdatedAt || draft.selectedAssetId !== input.assetId
      || canonicalStringify(asset) !== canonicalStringify(rendered.asset)) throw new Error('作品或候选已修改，请重读后重新确认。')
    const operationKey = crypto.randomUUID()
    const intent: CoverAdoptionIntentV1 = {
      version: 1, operationKey, workCode: work.code, draftKey: draft.draftKey, draftRevision: draft.revision,
      expectedWorkUpdatedAt: work.updatedAt, assetKey: asset.assetKey, candidateHash,
      oldCoverHash: await Dexie.waitFor(hashCanonicalValue(work.coverImage ?? '')),
      newCoverHash: asset.blobHash, renderManifestJson: rendered.renderManifestJson, renderManifestHash: rendered.renderManifestHash,
    }
    await db.workCoverDrafts.update(input.draftId, { pendingAdoptionJson: canonicalStringify(intent), updatedAt: Date.now() })
    return { draftId: input.draftId, operationKey }
  })
}

export async function adoptWorkCoverV1(scope: WorkspaceScope, confirmation: { draftId: number; operationKey: string }) {
  return adopt({ projectId: scope.projectId, scope, target: 'works', recordId: scope.workId, mode: 'replace', data: {}, workCoverAdoption: confirmation })
}

/** Called only by the registered adopt extension. A repeated operation returns
 * evidence first, without rewriting the Work after any later author edit. */
export async function commitWorkCoverAdoptionV1(input: AdoptInput): Promise<AdoptResult> {
  const scope = await resolveScope(input)
  const confirmation = input.workCoverAdoption!
  if (input.recordId !== scope.workId) throw new Error('封面采用目标与作用域不一致。')
  const priorReceipt = await db.workCoverAdoptions.where('[workId+operationKey]').equals([scope.workId, confirmation.operationKey]).first()
  if (priorReceipt) {
    await verifyWorkCoverReceiptV1(scope, confirmation.draftId, priorReceipt)
    return { written: [{ id: scope.workId, fields: ['coverImage'] }], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
  }
  const draft = await db.workCoverDrafts.get(confirmation.draftId)
  if (!draft?.pendingAdoptionJson || !coverRecordInScopeV1(scope, draft) || !await assertRecordInScope(scope, 'workCoverDrafts', draft, { owner: 'work' })) throw new Error('封面采用确认不存在或已失效。')
  const intent = JSON.parse(draft.pendingAdoptionJson) as CoverAdoptionIntentV1
  if (intent.version !== 1 || intent.operationKey !== confirmation.operationKey || intent.workCode !== draft.workCode || intent.draftKey !== draft.draftKey) throw new Error('封面采用确认不匹配。')
  const result = (): AdoptResult => ({ written: [{ id: scope.workId, fields: ['coverImage'] }], unknown: [], typeErrors: [], fkErrors: [], skipped: [] })
  const existing = await db.workCoverAdoptions.where('[workId+operationKey]').equals([scope.workId, intent.operationKey]).first()
  if (existing) { await verifyExisting(existing); return result() }
  if (draft.selectedAssetId == null) throw new Error('请选择已保存的封面候选。')
  const rendered = await renderWorkCoverV1({ scope, assetId: draft.selectedAssetId })
  if (rendered.asset.candidateJson) await assertWorkCoverCandidateHashV1(parseWorkCoverImageCandidateV1(rendered.asset.candidateJson))
  const actualCandidateHash = rendered.asset.candidateJson ? parseWorkCoverImageCandidateV1(rendered.asset.candidateJson).candidateHash
    : await hashCanonicalValue({ origin: 'upload', assetKey: rendered.asset.assetKey, blobHash: rendered.asset.blobHash })
  if (intent.candidateHash !== actualCandidateHash || intent.assetKey !== rendered.asset.assetKey || intent.newCoverHash !== rendered.asset.blobHash
    || intent.renderManifestJson !== rendered.renderManifestJson || intent.renderManifestHash !== rendered.renderManifestHash) throw new Error('封面采用内容与冻结确认不一致。')
  return db.transaction('rw', scopeTransactionTables(db.workCoverDrafts, db.workCoverAssets, db.mediaBlobObjects, db.workCoverAdoptions), async () => {
    const prior = await db.workCoverAdoptions.where('[workId+operationKey]').equals([scope.workId, intent.operationKey]).first()
    if (prior) { await verifyExisting(prior); return result() }
    await resolveScope({ scope })
    const work = await db.works.get(scope.workId)
    assertLongformCoverWorkV1(work, scope)
    const current = await db.workCoverDrafts.get(confirmation.draftId)
    const asset = await db.workCoverAssets.get(rendered.asset.id!)
    const blob = await db.mediaBlobObjects.get(rendered.blob.id!)
    if (input.recordId !== scope.workId || work.code !== intent.workCode || work.updatedAt !== intent.expectedWorkUpdatedAt
      || !current || !coverRecordInScopeV1(scope, current) || current.pendingAdoptionJson !== draft.pendingAdoptionJson || current.revision !== intent.draftRevision
      || current.selectedAssetId !== rendered.asset.id || current.expectedWorkUpdatedAt !== intent.expectedWorkUpdatedAt
      || canonicalStringify(asset) !== canonicalStringify(rendered.asset) || !blob || blob.disposition !== 'available' || blob.storageState !== 'ready'
      || await Dexie.waitFor(sha256BinaryV1(blob.data!)) !== intent.newCoverHash
      || await Dexie.waitFor(hashCanonicalValue(work.coverImage ?? '')) !== intent.oldCoverHash) throw new Error('作品已修改，旧封面已保留；请重读后重新确认候选。')
    const adoptedAt = Date.now()
    const receipt: WorkCoverAdoptionV1 = {
      ...scope, version: 1, workCode: work.code, operationKey: intent.operationKey,
      draftId: confirmation.draftId, draftKey: intent.draftKey, draftRevision: intent.draftRevision,
      originalAssetId: rendered.asset.id!, finalAssetId: rendered.asset.id!, candidateHash: intent.candidateHash, layoutHash: null,
      oldCoverHash: intent.oldCoverHash, newCoverHash: intent.newCoverHash, sourceRunId: rendered.asset.sourceRunId,
      adoptedAt, expectedWorkUpdatedAt: intent.expectedWorkUpdatedAt, renderManifestJson: intent.renderManifestJson,
      renderManifestHash: intent.renderManifestHash, receiptHash: await Dexie.waitFor(hashCanonicalValue({ ...intent, adoptedAt })),
      exactArtifactRefsJson: rendered.asset.exactArtifactRefsJson,
    }
    const updatedAt = Math.max(adoptedAt, work.updatedAt + 1)
    await db.works.update(scope.workId, { coverImage: rendered.dataUrl, updatedAt })
    await db.workCoverDrafts.update(confirmation.draftId, { adoptedAssetId: rendered.asset.id!, revision: current.revision + 1,
      expectedWorkUpdatedAt: updatedAt, renderManifestHash: intent.renderManifestHash, updatedAt })
    await db.workCoverAdoptions.add(receipt)
    return result()
  })

  async function verifyExisting(receipt: WorkCoverAdoptionV1) {
    if (!await assertRecordInScope(scope, 'workCoverAdoptions', receipt, { owner: 'work' }) || receipt.draftId !== confirmation.draftId
      || receipt.candidateHash !== intent.candidateHash || receipt.newCoverHash !== intent.newCoverHash
      || receipt.renderManifestHash !== intent.renderManifestHash || receipt.receiptHash !== await Dexie.waitFor(hashCanonicalValue({ ...intent, adoptedAt: receipt.adoptedAt }))) throw new Error('相同采用编号对应了不同内容。')
  }
}

async function verifyWorkCoverReceiptV1(scope: WorkspaceScope, draftId: number, receipt: WorkCoverAdoptionV1) {
  const [work, draft, asset] = await Promise.all([db.works.get(scope.workId), db.workCoverDrafts.get(draftId), db.workCoverAssets.get(receipt.finalAssetId)])
  assertLongformCoverWorkV1(work, scope)
  if (!draft || !asset || !coverRecordInScopeV1(scope, draft) || !coverRecordInScopeV1(scope, asset) || !coverRecordInScopeV1(scope, receipt) || asset.workCode !== draft.workCode || !await assertRecordInScope(scope, 'workCoverAdoptions', receipt, { owner: 'work' })
    || !await assertRecordInScope(scope, 'workCoverDrafts', draft, { owner: 'work' })
    || !await assertRecordInScope(scope, 'workCoverAssets', asset, { owner: 'work' })
    || receipt.draftId !== draftId || receipt.draftKey !== draft.draftKey || receipt.workCode !== work.code
    || receipt.originalAssetId !== receipt.finalAssetId || receipt.newCoverHash !== asset.blobHash) throw new Error('采用回执作用域或原图不匹配。')
  const intent: CoverAdoptionIntentV1 = { version: 1, operationKey: receipt.operationKey, workCode: receipt.workCode,
    draftKey: receipt.draftKey, draftRevision: receipt.draftRevision, expectedWorkUpdatedAt: receipt.expectedWorkUpdatedAt,
    assetKey: asset.assetKey, candidateHash: receipt.candidateHash, oldCoverHash: receipt.oldCoverHash, newCoverHash: receipt.newCoverHash,
    renderManifestJson: receipt.renderManifestJson, renderManifestHash: receipt.renderManifestHash }
  if (receipt.receiptHash !== await Dexie.waitFor(hashCanonicalValue({ ...intent, adoptedAt: receipt.adoptedAt }))) throw new Error('采用回执证据损坏。')
  if (draft.pendingAdoptionJson) {
    const pending = JSON.parse(draft.pendingAdoptionJson) as CoverAdoptionIntentV1
    if (pending.operationKey === receipt.operationKey && canonicalStringify(pending) !== canonicalStringify(intent)) throw new Error('相同采用编号对应了不同内容。')
  }
}
