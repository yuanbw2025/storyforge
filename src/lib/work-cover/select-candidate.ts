import { db } from '../db/schema'
import { canonicalStringify } from '../agent/run/hash'
import type { WorkspaceScope } from '../types'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { assertLongformCoverWorkV1, coverRecordInScopeV1 } from './drafts'
import { assertWorkCoverCandidateHashV1, assertWorkCoverPortableRowV1, parseWorkCoverImageCandidateV1 } from './contracts'
import { readWorkCoverPreviewBlobV1 } from './card-state'

/** Author requests a saved late result for review against the current Work.
 * Selection has its own CAS and never changes the official cover or dispatches. */
export async function selectReturnedWorkCoverCandidateV1(input: {
  scope: WorkspaceScope; draftId: number; expectedDraftRevision: number; expectedWorkUpdatedAt: number; assetId: number
}) {
  const scope = await resolveScope({ scope: input.scope }), asset = await db.workCoverAssets.get(input.assetId)
  if (!asset || !coverRecordInScopeV1(scope, asset) || !asset.candidateJson) throw new Error('已保存候选不属于此作品。')
  assertWorkCoverPortableRowV1('asset', asset as unknown as Record<string, unknown>)
  await assertWorkCoverCandidateHashV1(parseWorkCoverImageCandidateV1(asset.candidateJson))
  await readWorkCoverPreviewBlobV1(scope, asset)
  return db.transaction('rw', scopeTransactionTables(db.workCoverAssets, db.workCoverDrafts, db.workCoverResponseBuffers), async () => {
    await resolveScope({ scope })
    const work = await db.works.get(scope.workId), draft = await db.workCoverDrafts.get(input.draftId)
    assertLongformCoverWorkV1(work, scope)
    const current = await db.workCoverAssets.get(input.assetId)
    const response = asset.sourceRunId == null ? null : await db.workCoverResponseBuffers.where('runId').equals(asset.sourceRunId).first()
    if (!draft || !coverRecordInScopeV1(scope, draft) || draft.workCode !== work.code || asset.workCode !== work.code
      || draft.revision !== input.expectedDraftRevision || work.updatedAt !== input.expectedWorkUpdatedAt
      || draft.lastRunId !== asset.sourceRunId || canonicalStringify(current) !== canonicalStringify(asset)
      || !response || !coverRecordInScopeV1(scope, response) || response.state !== 'candidate-ready'
      || response.assetId !== asset.id) throw new Error('作品、候选或原请求已变化，请重新载入。')
    await db.workCoverDrafts.update(draft.id!, { selectedAssetId: asset.id!, expectedWorkUpdatedAt: work.updatedAt,
      revision: draft.revision + 1, pendingAdoptionJson: null, renderManifestHash: null, updatedAt: Date.now() })
  })
}
