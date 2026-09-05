import type {
  AdaptationProject,
  ComicLetteringItemV1,
  ComicMediaAsset,
  ComicNormalizedFrameV1,
  ComicPage,
  ComicPanel,
  ComicVisualSubject,
  MediaBlobObject,
  MediaBlobObjectRecordV1,
  WorkCharacterBinding,
} from '../types'

const STABLE_KEY = /^[a-z0-9][a-z0-9._-]{0,95}$/i
const COLOR = /^(#[0-9a-f]{6}|rgba?\([^)]{1,80}\)|transparent)$/i

function assertText(value: unknown, label: string, max: number, required = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`[comic] ${label} 非法`)
}

export function assertNormalizedFrameV1(frame: ComicNormalizedFrameV1, label: string, minimum = 0.01): void {
  if (!frame || ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) throw new Error(`[comic] ${label} 必须使用有限数值`)
  if (frame.x < 0 || frame.y < 0 || frame.width < minimum || frame.height < minimum || frame.x + frame.width > 1.000001 || frame.y + frame.height > 1.000001) {
    throw new Error(`[comic] ${label} 越过页面边界或尺寸过小`)
  }
}

export function framesOverlap(left: ComicNormalizedFrameV1, right: ComicNormalizedFrameV1): boolean {
  const overlapWidth = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  const overlapHeight = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  return overlapWidth > 0.0001 && overlapHeight > 0.0001
}

export function assertComicLetteringV1(items: ComicLetteringItemV1[]): void {
  if (!Array.isArray(items) || items.length > 80) throw new Error('[comic] 每格排字最多 80 项')
  const ids = new Set<string>()
  for (const [index, item] of items.entries()) {
    if (!item || !STABLE_KEY.test(item.id) || ids.has(item.id)) throw new Error(`[comic] 排字 ${index + 1} id 非法或重复`)
    ids.add(item.id)
    if (!['speech', 'thought', 'caption', 'sfx'].includes(item.kind)) throw new Error('[comic] 排字类型非法')
    assertText(item.text, `排字 ${item.id} 文本`, 2_000, true)
    assertNormalizedFrameV1(item.frame, `排字 ${item.id} frame`, 0.02)
    if (!['horizontal', 'vertical'].includes(item.direction) || !['storyforge-sans', 'storyforge-serif'].includes(item.fontFamily)) throw new Error('[comic] 排字方向或字体非法')
    if (!Number.isFinite(item.fontSize) || item.fontSize < 6 || item.fontSize > 144 || !Number.isFinite(item.strokeWidth) || item.strokeWidth < 0 || item.strokeWidth > 20) throw new Error('[comic] 排字号或描边非法')
    if (![item.textColor, item.fillColor, item.strokeColor].every(color => typeof color === 'string' && COLOR.test(color))) throw new Error('[comic] 排字颜色非法')
    if (item.tail && (!Number.isFinite(item.tail.x) || !Number.isFinite(item.tail.y) || item.tail.x < 0 || item.tail.x > 1 || item.tail.y < 0 || item.tail.y > 1)) throw new Error('[comic] 气泡尾锚点非法')
    if (!Number.isInteger(item.zIndex) || item.zIndex < 0 || item.zIndex > 999) throw new Error('[comic] 排字层级非法')
  }
}

export function assertComicPageV1(page: ComicPage, adaptation: AdaptationProject): void {
  if (adaptation.medium !== 'comic' || page.adaptationProjectId !== adaptation.id || page.workId !== adaptation.workId || page.projectId !== adaptation.projectId) throw new Error('[comic] 页面 owner 或媒介不匹配')
  if (!STABLE_KEY.test(page.stableKey) || !Number.isInteger(page.chapterNumber) || page.chapterNumber < 1 || page.chapterNumber > adaptation.targetSpec.chapterCount || !Number.isInteger(page.order) || page.order < 0) throw new Error('[comic] 页面 stableKey、章节号或顺序非法')
  assertText(page.summary, '页面摘要', 8_000)
  if (!['planned', 'storyboarded', 'reviewed', 'locked'].includes(page.status) || !Number.isInteger(page.revision) || page.revision < 1) throw new Error('[comic] 页面状态或 revision 非法')
}

export function assertComicPanelV1(input: {
  panel: ComicPanel
  page: ComicPage
  adaptation: AdaptationProject
  sourceUnitIds: ReadonlySet<number>
  subjectKeys?: ReadonlySet<string>
}): void {
  const { panel, page, adaptation } = input
  if (adaptation.medium !== 'comic' || panel.pageId !== page.id || panel.workId !== page.workId || panel.projectId !== page.projectId || page.adaptationProjectId !== adaptation.id) throw new Error('[comic] 格 owner 或父页不匹配')
  if (!STABLE_KEY.test(panel.stableKey) || !Number.isInteger(panel.order) || panel.order < 0 || !Number.isInteger(panel.revision) || panel.revision < 1) throw new Error('[comic] 格 stableKey、顺序或 revision 非法')
  if (panel.nextPanelKey != null && !STABLE_KEY.test(panel.nextPanelKey)) throw new Error('[comic] 下一格引用非法')
  assertNormalizedFrameV1(panel.frame, `格 ${panel.stableKey} frame`, 0.04)
  if (!Array.isArray(panel.sourceUnitIds) || !panel.sourceUnitIds.length || new Set(panel.sourceUnitIds).size !== panel.sourceUnitIds.length || panel.sourceUnitIds.some(id => !input.sourceUnitIds.has(id))) throw new Error(`[comic] 格 ${panel.stableKey} 来源证据越界或重复`)
  if (panel.sourceReviewManifestVersion !== adaptation.activeSourceManifestVersion) throw new Error('[comic] 格来源审阅版本不是活动 manifest')
  if (!['extreme-wide', 'wide', 'full', 'medium', 'close-up', 'extreme-close-up', 'insert'].includes(panel.shot?.size) || !['eye-level', 'high', 'low', 'overhead', 'dutch'].includes(panel.shot?.angle) || !['static', 'pan', 'tilt', 'track', 'zoom', 'handheld'].includes(panel.shot?.movement)) throw new Error('[comic] 镜头合同非法')
  assertText(panel.shot.composition, '镜头构图', 2_000)
  assertText(panel.action, '格动作', 8_000, true)
  if (panel.narrativeFunction != null) assertText(panel.narrativeFunction, '格叙事功能', 1_000)
  if (panel.moment != null) assertText(panel.moment, '格冻结瞬间', 8_000)
  assertText(panel.visualPrompt, '视觉 Prompt', 8_000)
  assertText(panel.negativePrompt, '负向 Prompt', 4_000)
  if (!Array.isArray(panel.continuityRefs) || panel.continuityRefs.length > 100) throw new Error('[comic] 连续性引用非法')
  const continuity = new Set<string>()
  for (const ref of panel.continuityRefs) {
    if (!STABLE_KEY.test(ref.subjectKey) || continuity.has(ref.subjectKey) || (input.subjectKeys && !input.subjectKeys.has(ref.subjectKey))) throw new Error(`[comic] 连续性引用不存在或重复：${ref.subjectKey}`)
    continuity.add(ref.subjectKey); assertText(ref.note, `连续性 ${ref.subjectKey}`, 2_000)
  }
  assertComicLetteringV1(panel.lettering)
  if (panel.subjectStates != null) {
    if (!Array.isArray(panel.subjectStates) || panel.subjectStates.length > 100 || new Set(panel.subjectStates.map(state => state.subjectKey)).size !== panel.subjectStates.length) throw new Error('[comic] 格 subject state 非法或重复')
    for (const state of panel.subjectStates) {
      if (!STABLE_KEY.test(state.subjectKey) || (input.subjectKeys && !input.subjectKeys.has(state.subjectKey)) || !Array.isArray(state.props)) throw new Error('[comic] 格 subject state 引用非法')
      assertText(state.costume, 'subject costume', 2_000); assertText(state.condition, 'subject condition', 2_000); assertText(state.position, 'subject position', 2_000)
    }
  }
  if (panel.protectedAreas != null) {
    if (!Array.isArray(panel.protectedAreas) || panel.protectedAreas.length > 20) throw new Error('[comic] 格 protected areas 非法')
    panel.protectedAreas.forEach((frame, index) => assertNormalizedFrameV1(frame, `格 ${panel.stableKey} protectedAreas[${index}]`, .01))
  }
  if (!panel.imageTransform || !['cover', 'contain'].includes(panel.imageTransform.fit) || ![panel.imageTransform.scale, panel.imageTransform.offsetX, panel.imageTransform.offsetY, panel.imageTransform.rotation].every(Number.isFinite) || panel.imageTransform.scale < 0.1 || panel.imageTransform.scale > 10 || Math.abs(panel.imageTransform.offsetX) > 2 || Math.abs(panel.imageTransform.offsetY) > 2 || Math.abs(panel.imageTransform.rotation) > 180) throw new Error('[comic] 图片裁切变换非法')
  if (panel.visualReviewBasis != null && !['author-visual', 'model-multimodal'].includes(panel.visualReviewBasis)) throw new Error('[comic] 视觉审查依据非法')
  if (panel.visualReviewedAt != null && (!Number.isFinite(panel.visualReviewedAt) || panel.visualReviewedAt <= 0)) throw new Error('[comic] 视觉审查时间非法')
  if ((panel.visualReviewRevision == null) !== (panel.visualReviewBasis == null) || (panel.visualReviewRevision == null) !== (panel.visualReviewedAt == null)) throw new Error('[comic] 视觉审查证据不完整')
  if (!['draft', 'reviewed', 'locked'].includes(panel.status)) throw new Error('[comic] 格状态非法')
}

export function assertPagePanelLayoutV1(page: ComicPage, panels: ComicPanel[]): void {
  const sorted = [...panels].sort((left, right) => left.order - right.order)
  if (sorted.some((panel, index) => panel.pageId !== page.id || panel.order !== index)) throw new Error('[comic] 页面格顺序必须从 0 连续')
  if (!page.allowPanelOverlap) {
    for (let left = 0; left < sorted.length; left++) for (let right = left + 1; right < sorted.length; right++) {
      if (framesOverlap(sorted[left].frame, sorted[right].frame)) throw new Error(`[comic] 页面 ${page.stableKey} 的格发生重叠`)
    }
  }
}

export function assertComicReadingOrderV1(page: ComicPage, panels: ComicPanel[], direction: 'ltr' | 'rtl'): void {
  const sorted = [...panels].sort((left, right) => left.order - right.order)
  assertPagePanelLayoutV1(page, sorted)
  const byKey = new Map(sorted.map(panel => [panel.stableKey, panel]))
  if (byKey.size !== sorted.length) throw new Error('[comic] 页面 panel stableKey 重复')
  for (const [index, panel] of sorted.entries()) {
    const expected = sorted[index + 1]?.stableKey ?? null
    if ((panel.nextPanelKey ?? null) !== expected) throw new Error(`[comic] ${panel.stableKey} 的 nextPanelKey 与阅读顺序不一致`)
    const next = sorted[index + 1]
    if (!next) continue
    const sameBand = Math.abs(panel.frame.y - next.frame.y) < Math.min(panel.frame.height, next.frame.height) * .35
    if (sameBand && direction === 'ltr' && next.frame.x + .001 < panel.frame.x) throw new Error('[comic] LTR 同行格顺序必须从左向右')
    if (sameBand && direction === 'rtl' && next.frame.x > panel.frame.x + .001) throw new Error('[comic] RTL 同行格顺序必须从右向左')
  }
}

export function assertComicVisualSubjectV1(input: {
  subject: ComicVisualSubject
  adaptation: AdaptationProject
  sourceUnitIds: ReadonlySet<number>
  bindings: WorkCharacterBinding[]
  locationRefKeys?: ReadonlySet<string>
  allowMissingExternalRef?: boolean
}): void {
  const { subject, adaptation } = input
  if (adaptation.medium !== 'comic' || subject.adaptationProjectId !== adaptation.id || subject.workId !== adaptation.workId || subject.projectId !== adaptation.projectId || !STABLE_KEY.test(subject.stableKey)) throw new Error('[comic] 视觉条目 owner 或 stableKey 非法')
  if (subject.kind === 'character') {
    if (subject.characterId == null && !input.allowMissingExternalRef) throw new Error('[comic] 新角色视觉条目必须绑定目标 Work 角色')
    if (subject.characterId != null && !input.bindings.some(binding => binding.workId === subject.workId && binding.characterId === subject.characterId)) throw new Error('[comic] 视觉条目角色尚未绑定目标 Work')
    if (subject.locationRefKey != null) throw new Error('[comic] 角色视觉条目不能携带地点引用')
  } else if (subject.kind === 'location') {
    if (!subject.locationRefKey && !input.allowMissingExternalRef) throw new Error('[comic] 新地点视觉条目必须绑定地点 key')
    if (subject.locationRefKey && input.locationRefKeys && !input.locationRefKeys.has(subject.locationRefKey) && !input.allowMissingExternalRef) throw new Error('[comic] 地点视觉条目的 locationRefKey 当前不可解析')
    if (subject.characterId != null) throw new Error('[comic] 地点视觉条目不能携带角色引用')
  } else if (subject.characterId != null || subject.locationRefKey != null) throw new Error('[comic] 道具/风格条目不能携带外部实体引用')
  assertText(subject.label, '视觉条目名称', 500, true)
  if (!subject.design || typeof subject.design !== 'object') throw new Error('[comic] 视觉设计非法')
  for (const [key, value] of Object.entries(subject.design)) {
    if (Array.isArray(value)) {
      if (value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 1_000)) throw new Error(`[comic] 视觉设计 ${key} 非法`)
    } else assertText(value, `视觉设计 ${key}`, 8_000)
  }
  if (!subject.sourceUnitIds.length || new Set(subject.sourceUnitIds).size !== subject.sourceUnitIds.length || subject.sourceUnitIds.some(id => !input.sourceUnitIds.has(id)) || subject.sourceReviewManifestVersion !== adaptation.activeSourceManifestVersion) throw new Error('[comic] 视觉条目来源证据非法')
  if (!['draft', 'reviewed', 'locked'].includes(subject.status) || !Number.isInteger(subject.revision) || subject.revision < 1) throw new Error('[comic] 视觉条目状态非法')
}

export function assertMediaBlobObjectV1(blob: MediaBlobObjectRecordV1): asserts blob is MediaBlobObject {
  if (!(blob.data instanceof ArrayBuffer)
    || typeof blob.width !== 'number'
    || typeof blob.height !== 'number'
    || !/^[a-f0-9]{64}$/.test(blob.contentHash)
    || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.mimeType)
    || blob.byteSize !== blob.data.byteLength
    || blob.byteSize < 16
    || blob.byteSize > 25 * 1024 * 1024
    || !Number.isInteger(blob.width)
    || !Number.isInteger(blob.height)
    || blob.width < 1
    || blob.height < 1
    || blob.width > 16384
    || blob.height > 16384) throw new Error('[media] Blob 元数据、尺寸或体积非法')
}

export function assertComicMediaAssetV1(asset: ComicMediaAsset): void {
  if (!STABLE_KEY.test(asset.stableKey) || !['panel-render', 'character-sheet', 'location-sheet', 'prop-sheet', 'style-reference'].includes(asset.role)) throw new Error('[media] 漫画 asset stableKey 或 role 非法')
  if (asset.role === 'panel-render' ? (asset.panelId == null || asset.subjectKey != null) : (asset.panelId != null || !asset.subjectKey)) throw new Error('[media] 漫画 asset role/owner 组合非法')
  if (asset.origin === 'generated') {
    if (!asset.requestHash || !asset.promptHash || !asset.providerReceipt) throw new Error('[media] generated asset 缺少请求证据')
  } else if (asset.requestHash != null || asset.promptHash != null || asset.providerReceipt != null) throw new Error('[media] uploaded asset 不能伪造 provider 证据')
  if (!Number.isInteger(asset.candidateIndex) || asset.candidateIndex < 0 || asset.candidateIndex > 99 || !Array.isArray(asset.referenceAssetKeys) || new Set(asset.referenceAssetKeys).size !== asset.referenceAssetKeys.length || asset.referenceAssetKeys.includes(asset.stableKey)) throw new Error('[media] asset 候选序号或参考引用非法')
  if (!asset.rights || asset.rights.version !== 1 || !asset.rights.declaration.trim() || !Number.isInteger(asset.rights.declaredAt)) throw new Error('[media] 媒体 rights 声明不完整')
  if (!asset.quality || !Number.isInteger(asset.quality.width) || !Number.isInteger(asset.quality.height) || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.quality.mimeType)) throw new Error('[media] 媒体质量元数据非法')
}

export function assertComicMediaReferenceGraphV1(assets: ComicMediaAsset[]): void {
  const byKey = new Map(assets.map(asset => [asset.stableKey, asset]))
  if (byKey.size !== assets.length) throw new Error('[media] asset stableKey 重复')
  const visiting = new Set<string>(); const visited = new Set<string>()
  const visit = (key: string) => {
    if (visiting.has(key)) throw new Error(`[media] asset 参考图形成环：${key}`)
    if (visited.has(key)) return
    const asset = byKey.get(key)
    if (!asset) throw new Error(`[media] asset 参考图不存在：${key}`)
    visiting.add(key)
    for (const ref of asset.referenceAssetKeys) {
      const target = byKey.get(ref)
      if (!target || target.workId !== asset.workId || target.disposition !== 'available') throw new Error(`[media] asset 参考图不存在、不可用或越过 Work：${ref}`)
      visit(ref)
    }
    visiting.delete(key); visited.add(key)
  }
  assets.forEach(asset => visit(asset.stableKey))
}
