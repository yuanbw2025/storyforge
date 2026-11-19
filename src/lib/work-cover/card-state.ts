import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { readVerifiedMediaBlobV1 } from '../media/blob-store'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { assertLongformCoverWorkV1, coverRecordInScopeV1 } from './drafts'
import { assertWorkCoverPortableRowV1, parseWorkCoverBriefV1 } from './contracts'
import type { WorkCoverAssetV1 } from './types'

/** Product view only. This read cannot acquire credentials or send a request. */
export async function readWorkCoverCardStateV1(scope: WorkspaceScope, includeRun: boolean) {
  return db.transaction('r', scopeTransactionTables(db.workCoverDrafts, db.workCoverAssets, db.workCoverResponseBuffers), async () => {
    await resolveScope({ scope })
    const work = await db.works.get(scope.workId)
    assertLongformCoverWorkV1(work, scope)
    const draft = await db.workCoverDrafts.where('workId').equals(scope.workId).first()
    if (draft && (!coverRecordInScopeV1(scope, draft) || draft.workCode !== work.code)) throw new Error('封面草稿不属于这部作品。')
    const asset = draft?.selectedAssetId == null ? null : await db.workCoverAssets.get(draft.selectedAssetId)
    if (asset && (!coverRecordInScopeV1(scope, asset) || asset.workCode !== work.code)) throw new Error('封面候选不属于这部作品。')
    if (asset) assertWorkCoverPortableRowV1('asset', asset as unknown as Record<string, unknown>)
    const run = includeRun && draft?.lastRunId != null ? await db.workCoverResponseBuffers.where('runId').equals(draft.lastRunId).first() : null
    if (run && !coverRecordInScopeV1(scope, run)) throw new Error('图片运行不属于这部作品。')
    const returnedAsset = run?.state === 'candidate-ready' && run.assetId != null && run.assetId !== draft?.selectedAssetId
      ? await db.workCoverAssets.get(run.assetId) : null
    if (returnedAsset && (!coverRecordInScopeV1(scope, returnedAsset) || returnedAsset.workCode !== work.code
      || returnedAsset.sourceRunId !== run?.runId)) throw new Error('已返回图片不属于原作品与请求。')
    if (returnedAsset) assertWorkCoverPortableRowV1('asset', returnedAsset as unknown as Record<string, unknown>)
    return { work, draft: draft ?? null, brief: draft ? parseWorkCoverBriefV1(draft.briefJson) : null,
      asset: asset ?? null, returnedAsset: returnedAsset ?? null, run: run ? { runId: run.runId, state: run.state, errorCode: run.errorCode,
        httpStatus: run.httpStatus, updatedAt: run.updatedAt } : null }
  })
}

export function canAdoptWorkCoverImageV1(asset: Pick<WorkCoverAssetV1, 'byteSize' | 'width' | 'height' | 'mimeType'>) {
  return asset.byteSize <= 5 * 1024 * 1024 && asset.width * asset.height <= 20_000_000
    && `data:${asset.mimeType};base64,`.length + 4 * Math.ceil(asset.byteSize / 3) <= 7_000_000
}

export async function readWorkCoverPreviewBlobV1(scope: WorkspaceScope, asset: WorkCoverAssetV1) {
  if (!coverRecordInScopeV1(scope, asset)) throw new Error('封面预览不能跨作品。')
  const blob = await readVerifiedMediaBlobV1({ scope, blobObjectId: asset.blobObjectId })
  if (blob.contentHash !== asset.blobHash || blob.byteSize !== asset.byteSize || blob.width !== asset.width
    || blob.height !== asset.height || blob.mimeType !== asset.mimeType) throw new Error('封面原图与候选证据不一致。')
  return new Blob([blob.data], { type: asset.mimeType })
}
