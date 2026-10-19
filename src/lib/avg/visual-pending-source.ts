import type { ProductProductionBriefV3, ProductProductionBriefRecordV1 } from '../types'

/** Explicit pending-Brief edits create a new revision with the registered
 * local locator. Imported historical Brief/Plan bytes stay immutable. The
 * existing save command still verifies the actual scoped WorldRelease and
 * freezes its SourcePlan; this function grants no execution authority. */
export function avgPendingVisualWorldSourceV4(brief: ProductProductionBriefV3,
  record: ProductProductionBriefRecordV1, draftWorldReleaseId: number | null) {
  if (!brief.avgVisualPlanning || record.status !== 'draft' || record.authorizedAt !== null
    || record.sourceWorldReleaseId == null || draftWorldReleaseId !== record.sourceWorldReleaseId
    || record.sourceWorldContentHash !== brief.source.worldContentHash) {
    throw new Error('[avg-visual-source] 待开始方案与草稿的冻结世界来源不一致，请重新准备')
  }
  return { ...brief.source, worldReleaseId: record.sourceWorldReleaseId }
}
