import { db } from '../db/schema'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import type { WorkspaceScope, Work } from '../types'
import type { WorkCoverBriefV1, WorkCoverDraftV1 } from './types'
import { parseWorkCoverBriefV1 } from './contracts'

export function coverRecordInScopeV1(scope: WorkspaceScope, row: WorkspaceScope): boolean {
  return row.projectId === scope.projectId && row.worldId === scope.worldId && row.workId === scope.workId
}

export function assertLongformCoverWorkV1(work: Work | undefined, scope: WorkspaceScope): asserts work is Work {
  if (!work || work.id !== scope.workId || work.projectId !== scope.projectId || work.worldId !== scope.worldId
    || work.kind !== 'novel' || work.novelProfile !== 'long') throw new Error('AI封面只用于当前选定的长篇作品。')
}

export async function saveWorkCoverDraftV1(input: {
  scope: WorkspaceScope; prompt: string; expectedRevision: number | null; expectedWorkUpdatedAt: number
}): Promise<WorkCoverDraftV1 & { id: number }> {
  const brief: WorkCoverBriefV1 = { version: 1, prompt: input.prompt.trim(), selectedText: null }
  const briefJson = canonicalStringify(brief)
  parseWorkCoverBriefV1(briefJson)
  const briefHash = await hashCanonicalValue(brief)
  return db.transaction('rw', scopeTransactionTables(db.workCoverDrafts), async () => {
    const scope = await resolveScope({ scope: input.scope })
    const work = await db.works.get(scope.workId)
    assertLongformCoverWorkV1(work, scope)
    if (work.updatedAt !== input.expectedWorkUpdatedAt) throw new Error('作品已修改，请重读后再生成。')
    const old = await db.workCoverDrafts.where('workId').equals(scope.workId).first()
    if (old && (!coverRecordInScopeV1(scope, old) || old.workCode !== work.code)) throw new Error('封面草稿作用域损坏。')
    if ((old?.revision ?? null) !== input.expectedRevision) throw new Error('封面提示词已在另一处修改，请重读。')
    const now = Date.now()
    const row: WorkCoverDraftV1 = {
      ...scope, id: old?.id, version: 1, workCode: work.code, draftKey: old?.draftKey ?? crypto.randomUUID(),
      revision: (old?.revision ?? 0) + 1, expectedWorkUpdatedAt: work.updatedAt,
      briefJson, briefHash, selectedAssetId: old?.selectedAssetId ?? null, adoptedAssetId: old?.adoptedAssetId ?? null,
      layoutJson: 'null', layoutHash: null, renderManifestHash: null,
      pendingAdoptionJson: null, lastRunId: old?.lastRunId ?? null, createdAt: old?.createdAt ?? now, updatedAt: now,
    }
    const id = await db.workCoverDrafts.put(row)
    return { ...row, id }
  })
}
