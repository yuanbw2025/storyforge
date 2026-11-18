import { db } from '../db/schema'
import { prepareMediaBlobV1, putPreparedMediaBlobV1 } from '../media/blob-store'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../workspace/scope'
import type { WorkspaceScope } from '../types'
import type { WorkCoverAssetV1 } from './types'
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
    // Asset and Blob are committed atomically, so GC never sees an unleased gap.
    const blob = await putPreparedMediaBlobV1(scope, prepared)
    const row: WorkCoverAssetV1 = {
      ...scope, version: 1, workCode: work.code, assetKey: crypto.randomUUID(), role: 'uploaded-original',
      blobObjectId: blob.id, blobHash: prepared.contentHash, mimeType: prepared.mimeType,
      width: prepared.width, height: prepared.height, byteSize: prepared.data.byteLength,
      sourceRunId: null, ordinal: 0, parentAssetId: null, layoutHash: null, rights: 'author-upload',
      candidateJson: null, exactArtifactRefsJson: '[]', createdAt: Date.now(),
    }
    const id = await db.workCoverAssets.add(row)
    await db.workCoverDrafts.update(input.draftId, { selectedAssetId: id, revision: draft.revision + 1,
      pendingAdoptionJson: null, renderManifestHash: null, updatedAt: Date.now() })
    return { ...row, id }
  })
}
