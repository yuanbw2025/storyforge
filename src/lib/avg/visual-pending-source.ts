import type { ProductBuildRecordV1, ProductProductionBriefV3, ProductProductionBriefRecordV1 } from '../types'
import type { AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { parseProductProductionBriefV3 } from '../product-production/contracts'

/** Only the new, unstarted Brief is editable. A frozen ordinary assembly can
 * parent a later visual batch; a frozen professional batch still requires the
 * explicit Stage-retention boundary before its protocol can change. */
export async function assertAvgPendingVisualParentV1(input: {
  build?: ProductBuildRecordV1 | null; parentRecord?: ProductProductionBriefRecordV1
  brief: ProductProductionBriefV3; workspace: AvgAuthorWorkspaceV1
}) {
  const { build, parentRecord, brief, workspace } = input
  if (!build) return
  if (!build.previewHash) {
    if (!['cancelled', 'failed', 'recovery-required'].includes(build.status)) {
      throw new Error('[avg-visual-parent] 父版本尚未结束，不能修改待开始图片方案')
    }
    return
  }
  if (!parentRecord || parentRecord.productionId !== build.productionId || parentRecord.revision !== build.briefRevision
    || parentRecord.briefHash !== build.briefHash || parentRecord.authorizedAt !== build.authorizedAt
    || !['authorized', 'superseded'].includes(parentRecord.status)) {
    throw new Error('[avg-visual-parent] 冻结父版本缺少准确授权方案')
  }
  const parentBrief = parseProductProductionBriefV3(parentRecord.briefJson)
  if (!['preview-ready', 'release-ready', 'released'].includes(build.status)
    || !parentBrief.avgAssembly || parentBrief.avgVisualPlanning
    || workspace.basePreviewHash !== build.previewHash
    || brief.avgVisualPlanning?.assembly.basePackageHash !== build.packageHash
    || parentBrief.source.worldContentHash !== brief.source.worldContentHash) {
    throw new Error('[avg-visual-parent] 待开始图片方案的冻结父版本或修订基线不一致')
  }
  const { verifyStoredProductBuildPreview } = await import('../product-production/preview-manifest')
  const preview = await verifyStoredProductBuildPreview(build)
  if (!preview || preview.previewHash !== build.previewHash || preview.packageHash !== build.packageHash) {
    throw new Error('[avg-visual-parent] 冻结父版本缺少准确可玩来源')
  }
}

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
