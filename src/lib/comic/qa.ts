import { db } from '../db/schema'
import type { ComicMediaAsset, ComicPanel, WorkspaceScope } from '../types'
import { resolveScope } from '../workspace/scope'
import { readVerifiedMediaBlobV1 } from '../media/blob-store'
import { assertComicMediaAssetV1, assertComicMediaReferenceGraphV1, assertComicReadingOrderV1, framesOverlap } from './contracts'

export interface ComicQualityIssueV1 {
  level: 'error' | 'warning'
  code: string
  message: string
  pageKey?: string
  panelKey?: string
}

export interface ComicQualityReportV1 {
  version: 1
  checkedAt: number
  pageCount: number
  panelCount: number
  selectedPanelCount: number
  issues: ComicQualityIssueV1[]
  storyboardBlockers: string[]
  visualBlockers: string[]
  canStoryboardRelease: boolean
  canVisualRelease: boolean
  /** Compatibility alias: a formal illustrated export requires the visual tier. */
  canFormalExport: boolean
}

function push(issues: ComicQualityIssueV1[], issue: ComicQualityIssueV1): void {
  if (!issues.some(item => item.code === issue.code && item.pageKey === issue.pageKey && item.panelKey === issue.panelKey && item.message === issue.message)) issues.push(issue)
}

function letteringCapacity(panel: ComicPanel, index: number): number {
  const item = panel.lettering[index]
  const widthPx = item.frame.width * panel.frame.width * 1200
  const heightPx = item.frame.height * panel.frame.height * 1700
  return Math.max(1, Math.floor(widthPx / (item.fontSize * .9)) * Math.floor(heightPx / (item.fontSize * 1.2)))
}

export async function inspectComicQualityV1(scopeInput: WorkspaceScope): Promise<ComicQualityReportV1> {
  const scope = await resolveScope({ scope: scopeInput })
  const root = await db.adaptationProjects.where('workId').equals(scope.workId).first()
  if (!root?.id || root.medium !== 'comic') throw new Error('[comic-qa] 当前 Work 不是漫画改编')
  const key = [root.id, root.activeSourceManifestVersion] as [number, number]
  const [pages, assets, subjects, facts, decisions, beats, pagePlans, reviewIssues] = await Promise.all([
    db.comicPages.where('adaptationProjectId').equals(root.id).sortBy('order'),
    db.comicMediaAssets.where('adaptationProjectId').equals(root.id).toArray(),
    db.comicVisualSubjects.where('adaptationProjectId').equals(root.id).toArray(),
    db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').toArray(),
    db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').toArray(),
    db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
    db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
    db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
  ])
  const pageIds = pages.flatMap(page => page.id == null ? [] : [page.id])
  const panels = pageIds.length ? await db.comicPanels.where('pageId').anyOf(pageIds).toArray() : []
  const issues: ComicQualityIssueV1[] = []
  if (pages.some((page, index) => page.order !== index)) push(issues, { level: 'error', code: 'page-order-gap', message: '页面顺序必须从 0 连续。' })
  if (new Set(pages.map(page => page.stableKey)).size !== pages.length || new Set(panels.map(panel => panel.stableKey)).size !== panels.length) push(issues, { level: 'error', code: 'stable-key-duplicate', message: '页或格 stableKey 重复。' })
  try { assertComicMediaReferenceGraphV1(assets) } catch (error) { push(issues, { level: 'error', code: 'asset-reference-graph', message: error instanceof Error ? error.message : '媒资参考图关系非法。' }) }
  const assetByKey = new Map(assets.map(asset => [asset.stableKey, asset]))
  const subjectByKey = new Map(subjects.map(subject => [subject.stableKey, subject]))
  for (const subject of subjects) if (subject.selectedMediaAssetKey) {
    const asset = assetByKey.get(subject.selectedMediaAssetKey)
    const expectedRole = subject.kind === 'character' ? 'character-sheet' : subject.kind === 'location' ? 'location-sheet' : subject.kind === 'prop' ? 'prop-sheet' : 'style-reference'
    if (!asset || asset.disposition !== 'available' || asset.subjectKey !== subject.stableKey || asset.role !== expectedRole || asset.workId !== scope.workId) push(issues, { level: 'error', code: 'subject-selected-media-invalid', message: `${subject.label} 所选设定图不存在、不可用或角色不匹配。` })
  }
  const selectedUsage = new Map<string, string[]>()
  for (const page of pages) {
    const rows = panels.filter(panel => panel.pageId === page.id).sort((left, right) => left.order - right.order)
    try { assertComicReadingOrderV1(page, rows, root.targetSpec.readingDirection) } catch (error) { push(issues, { level: 'error', code: 'page-layout', pageKey: page.stableKey, message: error instanceof Error ? error.message : '页面布局或阅读顺序非法。' }) }
    if (!rows.length) push(issues, { level: 'error', code: 'empty-page', pageKey: page.stableKey, message: '页面没有漫画格。' })
    if (rows.length > 8) push(issues, { level: 'warning', code: 'dense-page', pageKey: page.stableKey, message: '单页格数较多，建议检查阅读节奏与文字负担。' })
    for (const panel of rows) {
      if (!panel.selectedMediaAssetKey) push(issues, { level: 'error', code: 'missing-selected-media', pageKey: page.stableKey, panelKey: panel.stableKey, message: '该格尚未选择成图。' })
      else {
        const asset = assetByKey.get(panel.selectedMediaAssetKey)
        if (!asset || asset.disposition !== 'available' || asset.role !== 'panel-render' || asset.panelId !== panel.id || asset.workId !== scope.workId) push(issues, { level: 'error', code: 'selected-media-invalid', pageKey: page.stableKey, panelKey: panel.stableKey, message: '所选成图不存在、不可用或不属于当前格。' })
        else {
          selectedUsage.set(asset.stableKey, [...(selectedUsage.get(asset.stableKey) ?? []), panel.stableKey])
          try {
            assertComicMediaAssetV1(asset)
            const blob = await readVerifiedMediaBlobV1({ scope, blobObjectId: asset.blobObjectId })
            if (blob.width !== asset.quality.width || blob.height !== asset.quality.height || blob.mimeType !== asset.quality.mimeType) throw new Error('asset 与 Blob 尺寸/MIME 不一致')
            if (blob.width < root.targetSpec.imageCapabilityRequirement.minimumWidth || blob.height < root.targetSpec.imageCapabilityRequirement.minimumHeight) throw new Error('所选成图低于目标规格最小尺寸')
            if (asset.rights.commercialUse !== 'allowed' || asset.rights.redistribution !== 'allowed') throw new Error('所选成图未明确允许商用与再分发')
            const expectedReferences = panel.continuityRefs.flatMap(ref => subjectByKey.get(ref.subjectKey)?.selectedMediaAssetKey ?? [])
            if (asset.origin === 'generated' && expectedReferences.some(key => !asset.referenceAssetKeys.includes(key))) throw new Error('生成请求未实际传输所选 Subject 参考图，不能作为视觉成品证据')
          } catch (error) { push(issues, { level: 'error', code: 'selected-blob-invalid', pageKey: page.stableKey, panelKey: panel.stableKey, message: error instanceof Error ? error.message : '所选成图 Blob 校验失败。' }) }
        }
      }
      for (const ref of panel.continuityRefs) {
        const subject = subjectByKey.get(ref.subjectKey)
        if (!subject) push(issues, { level: 'error', code: 'continuity-subject-missing', pageKey: page.stableKey, panelKey: panel.stableKey, message: `连续性条目不存在：${ref.subjectKey}` })
        else if (!subject.selectedMediaAssetKey) push(issues, { level: 'warning', code: 'continuity-reference-image-missing', pageKey: page.stableKey, panelKey: panel.stableKey, message: `${subject.label} 尚未选定设定图，人物/地点一致性只能依赖文字。` })
      }
      panel.lettering.forEach((item, index) => {
        if ([...item.text].length > letteringCapacity(panel, index)) push(issues, { level: 'warning', code: 'lettering-overflow', pageKey: page.stableKey, panelKey: panel.stableKey, message: `排字 ${item.id} 可能超出气泡或文字框。` })
        if (item.frame.x < .02 || item.frame.y < .02 || item.frame.x + item.frame.width > .98 || item.frame.y + item.frame.height > .98) push(issues, { level: 'warning', code: 'lettering-safe-area', pageKey: page.stableKey, panelKey: panel.stableKey, message: `排字 ${item.id} 靠近格边界。` })
        for (let right = index + 1; right < panel.lettering.length; right++) if (framesOverlap(item.frame, panel.lettering[right].frame)) push(issues, { level: 'warning', code: 'lettering-overlap', pageKey: page.stableKey, panelKey: panel.stableKey, message: `排字 ${item.id} 与 ${panel.lettering[right].id} 重叠。` })
      })
      if (!panel.visualPrompt.trim()) push(issues, { level: 'warning', code: 'visual-prompt-empty', pageKey: page.stableKey, panelKey: panel.stableKey, message: '视觉 Prompt 为空，只能上传图片。' })
      if (panel.narrativeReviewRevision !== panel.revision) push(issues, { level: 'error', code: 'narrative-review-stale', pageKey: page.stableKey, panelKey: panel.stableKey, message: '该格尚未在当前修订上完成页级叙事/阅读顺序/排字审查。' })
      if (panel.selectedMediaAssetKey && (panel.visualReviewRevision !== panel.revision || !panel.visualReviewBasis || !panel.visualReviewedAt)) push(issues, { level: 'error', code: 'visual-review-stale', pageKey: page.stableKey, panelKey: panel.stableKey, message: '该格尚未在当前修订上完成带依据的实际画面审查。' })
    }
  }
  for (const [assetKey, panelKeys] of selectedUsage) if (panelKeys.length > 1) push(issues, { level: 'warning', code: 'selected-image-reused', message: `同一成图 ${assetKey} 被多格复用：${panelKeys.join('、')}` })
  const selectedPanelCount = panels.filter(panel => panel.selectedMediaAssetKey).length
  const storyboardBlockers: string[] = []
  if (root.briefSourceManifestVersion !== root.activeSourceManifestVersion || !root.brief) storyboardBlockers.push('当前来源版本的改编 Brief 未确认')
  if (!facts.length) storyboardBlockers.push('没有已确认来源事实')
  if (!decisions.length) storyboardBlockers.push('没有已确认改编决定')
  if (!beats.length) storyboardBlockers.push('没有已确认漫画脚本节拍')
  const expectedPages = root.targetSpec.chapterCount * root.targetSpec.targetPagesPerChapter
  if (pagePlans.length !== expectedPages || pages.length !== expectedPages) storyboardBlockers.push(`分页未覆盖目标 ${expectedPages} 页`)
  if (!panels.length) storyboardBlockers.push('没有漫画格')
  if (root.visualBibleSourceManifestVersion !== root.activeSourceManifestVersion || !root.visualBible || !subjects.length) storyboardBlockers.push('视觉圣经或 Subject 未确认')
  const narrativeErrorCodes = new Set(['page-order-gap', 'stable-key-duplicate', 'page-layout', 'empty-page', 'narrative-review-stale'])
  for (const issue of issues.filter(row => row.level === 'error' && narrativeErrorCodes.has(row.code))) storyboardBlockers.push(issue.message)
  if (reviewIssues.some(issue => issue.status === 'open' && ['narrative', 'reading-order', 'lettering'].includes(issue.category) && ['critical', 'major'].includes(issue.severity))) storyboardBlockers.push('仍有 critical/major 页级审查问题未处理')
  const visualBlockers = [...storyboardBlockers]
  for (const issue of issues.filter(row => row.level === 'error' && !narrativeErrorCodes.has(row.code))) visualBlockers.push(issue.message)
  if (selectedPanelCount !== panels.length) visualBlockers.push('并非所有漫画格都已选择成图')
  if (reviewIssues.some(issue => issue.status === 'open' && ['continuity', 'rights', 'media-integrity'].includes(issue.category) && ['critical', 'major'].includes(issue.severity))) visualBlockers.push('仍有 critical/major 视觉审查问题未处理')
  const uniqueStoryboard = [...new Set(storyboardBlockers)]; const uniqueVisual = [...new Set(visualBlockers)]
  return { version: 1, checkedAt: Date.now(), pageCount: pages.length, panelCount: panels.length, selectedPanelCount, issues, storyboardBlockers: uniqueStoryboard, visualBlockers: uniqueVisual, canStoryboardRelease: uniqueStoryboard.length === 0, canVisualRelease: uniqueVisual.length === 0, canFormalExport: uniqueVisual.length === 0 }
}

export function selectedAssetsForPanelsV1(panels: ComicPanel[], assets: ComicMediaAsset[]): ComicMediaAsset[] {
  const byKey = new Map(assets.map(asset => [asset.stableKey, asset]))
  return panels.flatMap(panel => panel.selectedMediaAssetKey && byKey.has(panel.selectedMediaAssetKey) ? [byKey.get(panel.selectedMediaAssetKey)!] : [])
}
