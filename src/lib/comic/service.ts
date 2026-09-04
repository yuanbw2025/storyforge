import { nanoid } from 'nanoid'
import { inspectAdaptationFreshness } from '../adaptation/source-manifest'
import { db } from '../db/schema'
import { finalizePendingMediaBlobDeletionV1, markUnreferencedMediaBlobForDeletionV1 } from '../media/blob-store'
import type {
  AdaptationProject,
  ComicPage,
  ComicPanel,
  ComicVisualSubject,
  ComicVisualSubjectDesignV1,
  Location,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { effectiveWorkKind } from '../workspace/work-kind'
import {
  assertComicPageV1,
  assertComicPanelV1,
  assertComicVisualSubjectV1,
  assertPagePanelLayoutV1,
} from './contracts'

export interface ComicPanelDraftV1 extends Pick<ComicPanel, 'frame' | 'shot' | 'action' | 'visualPrompt' | 'negativePrompt' | 'continuityRefs' | 'lettering' | 'sourceUnitIds'> {
  stableKey?: string
}

export interface ComicPageDraftV1 {
  stableKey?: string
  chapterNumber: number
  summary: string
  allowPanelOverlap?: boolean
  panels: ComicPanelDraftV1[]
}

async function requireComic(scopeInput: WorkspaceScope, requireEditable = false): Promise<{ scope: WorkspaceScope; adaptation: AdaptationProject & { id: number } }> {
  const scope = await resolveScope({ scope: scopeInput })
  const [work, adaptation] = await Promise.all([
    db.works.get(scope.workId),
    db.adaptationProjects.where('workId').equals(scope.workId).first(),
  ])
  if (!work || effectiveWorkKind(work) !== 'comic' || !adaptation?.id || adaptation.medium !== 'comic') throw new Error('[comic] 当前 Work 不是有效漫画改编')
  if (adaptation.projectId !== scope.projectId || adaptation.worldId !== scope.worldId) throw new Error('[comic] 改编根越过当前 scope')
  if (requireEditable && adaptation.status === 'complete') throw new Error('[comic] 漫画已正式完稿；请先重新打开审校')
  return { scope, adaptation: adaptation as AdaptationProject & { id: number } }
}

async function dependencies(adaptation: AdaptationProject & { id: number }, manifestVersion = adaptation.activeSourceManifestVersion) {
  const [units, bindings, subjects, geographies] = await Promise.all([
    db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([adaptation.id, manifestVersion]).toArray(),
    db.workCharacterBindings.where('workId').equals(adaptation.workId).toArray(),
    db.comicVisualSubjects.where('adaptationProjectId').equals(adaptation.id).toArray(),
    db.geographies.where('projectId').equals(adaptation.projectId).toArray(),
  ])
  const locations = geographies.flatMap(row => {
    try {
      const parsed = JSON.parse(row.locations) as unknown
      return Array.isArray(parsed) ? parsed.filter((item): item is Location => !!item && typeof item === 'object' && typeof (item as Location).id === 'string') : []
    } catch { return [] }
  })
  return {
    sourceUnitIds: new Set(units.flatMap(unit => unit.id == null ? [] : [unit.id])),
    bindings,
    subjectKeys: new Set(subjects.map(subject => subject.stableKey)),
    locationRefKeys: new Set(locations.map(location => location.id)),
  }
}

export function comicPanelFramesV1(count: number): ComicPanel['frame'][] {
  if (!Number.isInteger(count) || count < 1 || count > 9) throw new Error('[comic] 每页格数必须为 1～9')
  if (count === 1) return [{ x: 0, y: 0, width: 1, height: 1 }]
  if (count === 2) return [{ x: 0, y: 0, width: 1, height: 0.49 }, { x: 0, y: 0.51, width: 1, height: 0.49 }]
  const columns = count <= 4 ? 2 : 3
  const rows = Math.ceil(count / columns)
  const gutter = 0.02
  const width = (1 - gutter * (columns - 1)) / columns
  const height = (1 - gutter * (rows - 1)) / rows
  return Array.from({ length: count }, (_, index) => ({
    x: (index % columns) * (width + gutter),
    y: Math.floor(index / columns) * (height + gutter),
    width,
    height,
  }))
}

export async function listComicPages(scopeInput: WorkspaceScope): Promise<Array<{ page: ComicPage; panels: ComicPanel[] }>> {
  const { scope, adaptation } = await requireComic(scopeInput)
  const pages = (await db.comicPages.where('adaptationProjectId').equals(adaptation.id).sortBy('order')).filter(page => page.projectId === scope.projectId && page.workId === scope.workId)
  const pageIds = pages.flatMap(page => page.id == null ? [] : [page.id])
  const panels = pageIds.length ? await db.comicPanels.where('pageId').anyOf(pageIds).toArray() : []
  return pages.map(page => ({ page, panels: panels.filter(panel => panel.pageId === page.id).sort((left, right) => left.order - right.order) }))
}

export async function createComicPage(scopeInput: WorkspaceScope, draft: ComicPageDraftV1): Promise<{ page: ComicPage; panels: ComicPanel[] }> {
  const { scope, adaptation } = await requireComic(scopeInput, true)
  if (!['producing', 'review'].includes(adaptation.status)) throw new Error('[comic] 请先确认 Brief、Plan、视觉圣经并进入生产')
  if ((await inspectAdaptationFreshness(adaptation.id)).status !== 'unchanged') throw new Error('[comic] 来源已变化或缺失；旧页面仍可编辑，但不能创建新页面')
  if (!draft.panels.length || draft.panels.length > 9) throw new Error('[comic] 每页必须包含 1～9 格')
  const deps = await dependencies(adaptation)
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(db.comicPages, db.comicPanels, db.adaptationProjects, db.adaptationSourceUnits, db.comicVisualSubjects, db.workCharacterBindings), async () => {
    const current = await db.adaptationProjects.get(adaptation.id)
    if (!current || current.revision !== adaptation.revision || current.activeSourceManifestHash !== adaptation.activeSourceManifestHash) throw new Error('[comic] 改编根已变化，请刷新')
    const existing = await db.comicPages.where('adaptationProjectId').equals(adaptation.id).toArray()
    const page: ComicPage = stampNewRecord(scope, 'comicPages', {
      projectId: scope.projectId, workId: scope.workId, adaptationProjectId: adaptation.id,
      stableKey: draft.stableKey ?? `page_${nanoid(16)}`,
      chapterNumber: draft.chapterNumber, order: existing.length,
      allowPanelOverlap: draft.allowPanelOverlap === true, summary: draft.summary.trim(),
      status: 'storyboarded', revision: 1, createdAt: now, updatedAt: now,
    }, { owner: 'work' })
    assertComicPageV1(page, current)
    if (existing.some(row => row.stableKey === page.stableKey)) throw new Error('[comic] 页面 stableKey 重复')
    const pageId = await db.comicPages.add(page) as number
    const savedPage = { ...page, id: pageId }
    const panels = draft.panels.map((item, order): ComicPanel => stampNewRecord(scope, 'comicPanels', {
      projectId: scope.projectId, workId: scope.workId, pageId,
      stableKey: item.stableKey ?? `${page.stableKey}_panel_${order + 1}`,
      order, frame: structuredClone(item.frame), sourceUnitIds: [...item.sourceUnitIds],
      sourceReviewManifestVersion: current.activeSourceManifestVersion,
      shot: structuredClone(item.shot), action: item.action.trim(), visualPrompt: item.visualPrompt.trim(), negativePrompt: item.negativePrompt.trim(),
      continuityRefs: structuredClone(item.continuityRefs), lettering: structuredClone(item.lettering),
      selectedMediaAssetKey: null,
      imageTransform: { fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, rotation: 0 },
      status: 'draft', revision: 1, createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
    if (new Set(panels.map(panel => panel.stableKey)).size !== panels.length) throw new Error('[comic] 格 stableKey 重复')
    panels.forEach(panel => assertComicPanelV1({ panel, page: savedPage, adaptation: current, sourceUnitIds: deps.sourceUnitIds, subjectKeys: deps.subjectKeys }))
    assertPagePanelLayoutV1(savedPage, panels)
    const panelIds = await db.comicPanels.bulkAdd(panels, { allKeys: true }) as number[]
    return { page: savedPage, panels: panels.map((panel, index) => ({ ...panel, id: panelIds[index] })) }
  })
}

export async function updateComicPage(input: {
  scope: WorkspaceScope
  pageId: number
  expectedRevision: number
  patch: Partial<Pick<ComicPage, 'chapterNumber' | 'summary' | 'allowPanelOverlap' | 'status'>>
}): Promise<ComicPage> {
  const { scope, adaptation } = await requireComic(input.scope, true)
  return db.transaction('rw', db.comicPages, db.comicPanels, async () => {
    const page = await db.comicPages.get(input.pageId)
    if (!page || !await assertRecordInScope(scope, 'comicPages', page, { owner: 'work' }) || page.adaptationProjectId !== adaptation.id) throw new Error('[comic] 页面不存在或越界')
    if (page.revision !== input.expectedRevision) throw new Error('[comic] 页面已变化，请刷新')
    if (page.status === 'locked' && input.patch.status !== 'reviewed') throw new Error('[comic] 锁定页面必须先解锁')
    const next = { ...page, ...input.patch, summary: input.patch.summary?.trim() ?? page.summary, revision: page.revision + 1, updatedAt: Date.now() }
    assertComicPageV1(next, adaptation)
    assertPagePanelLayoutV1(next, await db.comicPanels.where('pageId').equals(page.id!).toArray())
    await db.comicPages.put(next)
    return next
  })
}

export async function updateComicPanel(input: {
  scope: WorkspaceScope
  panelId: number
  expectedRevision: number
  patch: Partial<Pick<ComicPanel, 'frame' | 'sourceUnitIds' | 'shot' | 'action' | 'visualPrompt' | 'negativePrompt' | 'continuityRefs' | 'lettering' | 'selectedMediaAssetKey' | 'imageTransform' | 'status'>>
}): Promise<ComicPanel> {
  const { scope, adaptation } = await requireComic(input.scope, true)
  const deps = await dependencies(adaptation)
  return db.transaction('rw', scopeTransactionTables(db.comicPages, db.comicPanels, db.comicMediaAssets, db.adaptationSourceUnits, db.comicVisualSubjects, db.workCharacterBindings), async () => {
    const panel = await db.comicPanels.get(input.panelId)
    const page = panel ? await db.comicPages.get(panel.pageId) : null
    if (!panel || !page || !await assertRecordInScope(scope, 'comicPanels', panel, { owner: 'work' }) || page.adaptationProjectId !== adaptation.id) throw new Error('[comic] 格不存在或越界')
    if (panel.revision !== input.expectedRevision) throw new Error('[comic] 格已变化，请刷新')
    if (panel.status === 'locked' && input.patch.status !== 'reviewed') throw new Error('[comic] 锁定格必须先解锁')
    const next: ComicPanel = { ...panel, ...structuredClone(input.patch), action: input.patch.action?.trim() ?? panel.action, visualPrompt: input.patch.visualPrompt?.trim() ?? panel.visualPrompt, negativePrompt: input.patch.negativePrompt?.trim() ?? panel.negativePrompt, revision: panel.revision + 1, updatedAt: Date.now() }
    if (next.selectedMediaAssetKey) {
      const asset = await db.comicMediaAssets.where('[workId+stableKey]').equals([scope.workId, next.selectedMediaAssetKey]).first()
      if (!asset || asset.disposition !== 'available' || asset.role !== 'panel-render' || asset.panelId !== panel.id) throw new Error('[comic] 所选成图不存在或不属于当前格')
    }
    assertComicPanelV1({ panel: next, page, adaptation, sourceUnitIds: deps.sourceUnitIds, subjectKeys: deps.subjectKeys })
    const siblings = (await db.comicPanels.where('pageId').equals(page.id!).toArray()).map(row => row.id === panel.id ? next : row)
    assertPagePanelLayoutV1(page, siblings)
    await db.comicPanels.put(next)
    return next
  })
}

export async function reorderComicPages(input: { scope: WorkspaceScope; orderedPageIds: number[] }): Promise<ComicPage[]> {
  const { adaptation } = await requireComic(input.scope, true)
  if (new Set(input.orderedPageIds).size !== input.orderedPageIds.length) throw new Error('[comic] 页面排序包含重复 ID')
  return db.transaction('rw', db.comicPages, async () => {
    const pages = await db.comicPages.where('adaptationProjectId').equals(adaptation.id).toArray()
    if (pages.length !== input.orderedPageIds.length || pages.some(page => !input.orderedPageIds.includes(page.id!))) throw new Error('[comic] 页面排序必须覆盖全部页面')
    const byId = new Map(pages.map(page => [page.id!, page])); const now = Date.now()
    const next = input.orderedPageIds.map((id, order) => ({ ...byId.get(id)!, order, revision: byId.get(id)!.revision + 1, updatedAt: now }))
    await db.comicPages.bulkPut(pages.map((page, index) => ({ ...page, order: -(index + 1) })))
    await db.comicPages.bulkPut(next); return next
  })
}

export async function reorderComicPanels(input: { scope: WorkspaceScope; pageId: number; orderedPanelIds: number[] }): Promise<ComicPanel[]> {
  const { scope, adaptation } = await requireComic(input.scope, true)
  if (new Set(input.orderedPanelIds).size !== input.orderedPanelIds.length) throw new Error('[comic] 格排序包含重复 ID')
  return db.transaction('rw', db.comicPages, db.comicPanels, async () => {
    const page = await db.comicPages.get(input.pageId)
    if (!page || page.workId !== scope.workId || page.adaptationProjectId !== adaptation.id || page.status === 'locked') throw new Error('[comic] 页面不存在、越界或已锁定')
    const panels = await db.comicPanels.where('pageId').equals(page.id!).toArray()
    if (panels.length !== input.orderedPanelIds.length || panels.some(panel => !input.orderedPanelIds.includes(panel.id!)) || panels.some(panel => panel.status === 'locked')) throw new Error('[comic] 格排序必须覆盖全部未锁定格')
    const byId = new Map(panels.map(panel => [panel.id!, panel])); const now = Date.now()
    const next = input.orderedPanelIds.map((id, order) => ({ ...byId.get(id)!, order, revision: byId.get(id)!.revision + 1, updatedAt: now }))
    assertPagePanelLayoutV1(page, next)
    await db.comicPanels.bulkPut(panels.map((panel, index) => ({ ...panel, order: -(index + 1) })))
    await db.comicPanels.bulkPut(next); return next
  })
}

export async function applyComicPageTemplateV1(input: { scope: WorkspaceScope; pageId: number; expectedPageRevision: number }): Promise<ComicPanel[]> {
  const { scope, adaptation } = await requireComic(input.scope, true)
  return db.transaction('rw', db.comicPages, db.comicPanels, async () => {
    const page = await db.comicPages.get(input.pageId)
    if (!page || page.workId !== scope.workId || page.adaptationProjectId !== adaptation.id || page.revision !== input.expectedPageRevision || page.status === 'locked') throw new Error('[comic] 页面不存在、越界、已变化或已锁定')
    const panels = await db.comicPanels.where('pageId').equals(page.id!).sortBy('order')
    if (!panels.length || panels.some(panel => panel.status === 'locked')) throw new Error('[comic] 页面没有可套用模板的未锁定格')
    const frames = comicPanelFramesV1(panels.length); const now = Date.now()
    const next = panels.map((panel, index) => ({ ...panel, frame: frames[index], revision: panel.revision + 1, updatedAt: now }))
    assertPagePanelLayoutV1(page, next)
    await db.comicPanels.bulkPut(next); return next
  })
}

export async function splitComicPanelV1(input: { scope: WorkspaceScope; panelId: number; expectedRevision: number; direction: 'horizontal' | 'vertical' }): Promise<ComicPanel[]> {
  const { scope, adaptation } = await requireComic(input.scope, true)
  const deps = await dependencies(adaptation)
  return db.transaction('rw', db.comicPages, db.comicPanels, async () => {
    const panel = await db.comicPanels.get(input.panelId); const page = panel ? await db.comicPages.get(panel.pageId) : null
    if (!panel || !page || panel.workId !== scope.workId || page.adaptationProjectId !== adaptation.id || panel.revision !== input.expectedRevision || panel.status === 'locked' || page.status === 'locked') throw new Error('[comic] 格不存在、越界、已变化或已锁定')
    const siblings = await db.comicPanels.where('pageId').equals(page.id!).sortBy('order')
    if (siblings.length >= 9) throw new Error('[comic] 每页最多 9 格')
    const gap = .01
    const firstFrame = { ...panel.frame }; const secondFrame = { ...panel.frame }
    if (input.direction === 'vertical') {
      if (panel.frame.width < .1) throw new Error('[comic] 格太窄，不能再纵向拆分')
      firstFrame.width = panel.frame.width / 2 - gap / 2; secondFrame.width = firstFrame.width; secondFrame.x = panel.frame.x + firstFrame.width + gap
    } else {
      if (panel.frame.height < .1) throw new Error('[comic] 格太矮，不能再横向拆分')
      firstFrame.height = panel.frame.height / 2 - gap / 2; secondFrame.height = firstFrame.height; secondFrame.y = panel.frame.y + firstFrame.height + gap
    }
    const now = Date.now()
    const first = { ...panel, frame: firstFrame, revision: panel.revision + 1, updatedAt: now }
    const second: ComicPanel = stampNewRecord(scope, 'comicPanels', {
      ...panel, id: undefined, stableKey: `${panel.stableKey}_split_${nanoid(6)}`, order: panel.order + 1, frame: secondFrame,
      action: `${panel.action}（拆分后的延续）`, lettering: [], selectedMediaAssetKey: null,
      status: 'draft', revision: 1, createdAt: now, updatedAt: now,
    }, { owner: 'work' })
    const next = siblings.flatMap(row => row.id === panel.id ? [first, second] : row.order > panel.order ? [{ ...row, order: row.order + 1, revision: row.revision + 1, updatedAt: now }] : [row])
    next.forEach(row => assertComicPanelV1({ panel: row, page, adaptation, sourceUnitIds: deps.sourceUnitIds, subjectKeys: deps.subjectKeys }))
    assertPagePanelLayoutV1(page, next)
    await db.comicPanels.bulkPut(siblings.map((row, index) => ({ ...row, order: -(index + 1) })))
    await db.comicPanels.put(first); const id = await db.comicPanels.add(second) as number
    await db.comicPanels.bulkPut(next.filter(row => row.id && row.id !== first.id))
    return next.map(row => row === second ? { ...second, id } : row)
  })
}

export async function mergeComicPanelsV1(input: { scope: WorkspaceScope; firstPanelId: number; secondPanelId: number; expectedFirstRevision: number; expectedSecondRevision: number }): Promise<ComicPanel> {
  const { scope, adaptation } = await requireComic(input.scope, true)
  const deps = await dependencies(adaptation)
  return db.transaction('rw', db.comicPages, db.comicPanels, db.comicMediaAssets, async () => {
    const [first, second] = await Promise.all([db.comicPanels.get(input.firstPanelId), db.comicPanels.get(input.secondPanelId)])
    const page = first ? await db.comicPages.get(first.pageId) : null
    if (!first || !second || !page || first.pageId !== second.pageId || first.workId !== scope.workId || page.adaptationProjectId !== adaptation.id || first.revision !== input.expectedFirstRevision || second.revision !== input.expectedSecondRevision || first.status === 'locked' || second.status === 'locked' || page.status === 'locked') throw new Error('[comic] 待合并格不存在、越界、已变化或已锁定')
    if (await db.comicMediaAssets.where('panelId').equals(second.id!).count()) throw new Error('[comic] 第二格已有图片候选，请先清理再合格')
    const x = Math.min(first.frame.x, second.frame.x); const y = Math.min(first.frame.y, second.frame.y)
    const frame = { x, y, width: Math.max(first.frame.x + first.frame.width, second.frame.x + second.frame.width) - x, height: Math.max(first.frame.y + first.frame.height, second.frame.y + second.frame.height) - y }
    const now = Date.now(); const letteringIds = new Set(first.lettering.map(item => item.id))
    const merged: ComicPanel = { ...first, frame, sourceUnitIds: [...new Set([...first.sourceUnitIds, ...second.sourceUnitIds])], action: `${first.action}\n${second.action}`.trim(), visualPrompt: `${first.visualPrompt}\n${second.visualPrompt}`.trim(), negativePrompt: `${first.negativePrompt}\n${second.negativePrompt}`.trim(), continuityRefs: [...new Map([...first.continuityRefs, ...second.continuityRefs].map(ref => [ref.subjectKey, ref])).values()], lettering: [...first.lettering, ...second.lettering.map(item => ({ ...item, id: letteringIds.has(item.id) ? `${item.id}_${nanoid(5)}` : item.id }))], revision: first.revision + 1, updatedAt: now }
    const siblings = (await db.comicPanels.where('pageId').equals(page.id!).sortBy('order')).filter(row => row.id !== second.id).map((row, order) => {
      const base = row.id === first.id ? merged : row
      return order === base.order ? base : { ...base, order, revision: base.revision + 1, updatedAt: now }
    })
    const saved = siblings.find(row => row.id === first.id)!
    siblings.forEach(row => assertComicPanelV1({ panel: row, page, adaptation, sourceUnitIds: deps.sourceUnitIds, subjectKeys: deps.subjectKeys }))
    assertPagePanelLayoutV1(page, siblings)
    await db.comicPanels.delete(second.id!)
    await db.comicPanels.bulkPut(siblings.map((row, index) => ({ ...row, order: -(index + 1) })))
    await db.comicPanels.bulkPut(siblings)
    return saved
  })
}

export async function moveComicPanelV1(input: { scope: WorkspaceScope; panelId: number; targetPageId: number; targetOrder: number; targetFrame: ComicPanel['frame']; expectedRevision: number }): Promise<ComicPanel> {
  const { scope, adaptation } = await requireComic(input.scope, true)
  const deps = await dependencies(adaptation)
  return db.transaction('rw', db.comicPages, db.comicPanels, async () => {
    const panel = await db.comicPanels.get(input.panelId)
    const [sourcePage, targetPage] = await Promise.all([panel ? db.comicPages.get(panel.pageId) : null, db.comicPages.get(input.targetPageId)])
    if (!panel || !sourcePage || !targetPage || panel.workId !== scope.workId || sourcePage.adaptationProjectId !== adaptation.id || targetPage.adaptationProjectId !== adaptation.id || panel.revision !== input.expectedRevision || panel.status === 'locked' || sourcePage.status === 'locked' || targetPage.status === 'locked') throw new Error('[comic] 跨页移动目标不存在、越界、已变化或已锁定')
    if (sourcePage.id === targetPage.id) throw new Error('[comic] 同页移动请使用格排序或直接编辑 frame')
    const [sourceRows, targetRows] = await Promise.all([db.comicPanels.where('pageId').equals(sourcePage.id!).sortBy('order'), db.comicPanels.where('pageId').equals(targetPage.id!).sortBy('order')])
    if (sourceRows.length <= 1) throw new Error('[comic] 不能把源页最后一格移走')
    if (targetRows.length >= 9 || input.targetOrder < 0 || input.targetOrder > targetRows.length) throw new Error('[comic] 目标页格数或插入位置非法')
    const now = Date.now()
    const nextSource = sourceRows.filter(row => row.id !== panel.id).map((row, order) => order === row.order ? row : { ...row, order, revision: row.revision + 1, updatedAt: now })
    const moved: ComicPanel = { ...panel, pageId: targetPage.id!, order: input.targetOrder, frame: structuredClone(input.targetFrame), revision: panel.revision + 1, updatedAt: now }
    const nextTarget = [...targetRows]; nextTarget.splice(input.targetOrder, 0, moved)
    let normalizedTarget = nextTarget.map((row, order) => order === row.order && row.id !== panel.id ? row : { ...row, order, revision: row.id === panel.id ? row.revision : row.revision + 1, updatedAt: now })
    normalizedTarget.forEach(row => assertComicPanelV1({ panel: row, page: targetPage, adaptation, sourceUnitIds: deps.sourceUnitIds, subjectKeys: deps.subjectKeys }))
    assertPagePanelLayoutV1(sourcePage, nextSource)
    try { assertPagePanelLayoutV1(targetPage, normalizedTarget) } catch {
      const frames = comicPanelFramesV1(normalizedTarget.length)
      normalizedTarget = normalizedTarget.map((row, order) => ({ ...row, frame: frames[order], revision: row.id === panel.id ? row.revision : row.revision + 1, updatedAt: now }))
      normalizedTarget.forEach(row => assertComicPanelV1({ panel: row, page: targetPage, adaptation, sourceUnitIds: deps.sourceUnitIds, subjectKeys: deps.subjectKeys }))
      assertPagePanelLayoutV1(targetPage, normalizedTarget)
    }
    await db.comicPanels.bulkPut([...sourceRows.map((row, index) => ({ ...row, order: -(index + 1) })), ...targetRows.map((row, index) => ({ ...row, order: -(index + 1) }))])
    await db.comicPanels.bulkPut([...nextSource, ...normalizedTarget])
    return normalizedTarget.find(row => row.id === panel.id)!
  })
}

export async function listComicVisualSubjects(scopeInput: WorkspaceScope): Promise<ComicVisualSubject[]> {
  const { scope, adaptation } = await requireComic(scopeInput)
  return (await db.comicVisualSubjects.where('adaptationProjectId').equals(adaptation.id).toArray()).filter(row => row.workId === scope.workId && row.projectId === scope.projectId)
}

export async function saveComicVisualSubject(input: {
  scope: WorkspaceScope
  subjectId?: number
  expectedRevision?: number
  draft: Pick<ComicVisualSubject, 'stableKey' | 'kind' | 'characterId' | 'locationRefKey' | 'label' | 'sourceUnitIds'> & { design: ComicVisualSubjectDesignV1; status?: ComicVisualSubject['status'] }
}): Promise<ComicVisualSubject> {
  const { scope, adaptation } = await requireComic(input.scope, true)
  if ((await inspectAdaptationFreshness(adaptation.id)).status !== 'unchanged' && input.subjectId == null) throw new Error('[comic] 来源 stale 时不能新增视觉条目')
  const deps = await dependencies(adaptation)
  return db.transaction('rw', scopeTransactionTables(db.comicVisualSubjects, db.workCharacterBindings, db.adaptationSourceUnits, db.characters), async () => {
    const previous = input.subjectId == null ? null : await db.comicVisualSubjects.get(input.subjectId)
    if (input.subjectId != null && (!previous || previous.workId !== scope.workId || previous.adaptationProjectId !== adaptation.id)) throw new Error('[comic] 视觉条目不存在或越界')
    if (previous && previous.revision !== input.expectedRevision) throw new Error('[comic] 视觉条目已变化，请刷新')
    if (previous?.status === 'locked' && input.draft.status !== 'reviewed') throw new Error('[comic] 锁定视觉条目必须先解锁')
    const now = Date.now()
    const subject: ComicVisualSubject = stampNewRecord(scope, 'comicVisualSubjects', {
      ...(previous ?? {}), projectId: scope.projectId, workId: scope.workId, adaptationProjectId: adaptation.id,
      stableKey: input.draft.stableKey, kind: input.draft.kind, characterId: input.draft.characterId, locationRefKey: input.draft.locationRefKey,
      label: input.draft.label.trim(), design: structuredClone(input.draft.design), sourceUnitIds: [...input.draft.sourceUnitIds],
      sourceReviewManifestVersion: adaptation.activeSourceManifestVersion, selectedMediaAssetKey: previous?.selectedMediaAssetKey ?? null,
      status: input.draft.status ?? previous?.status ?? 'draft', revision: (previous?.revision ?? 0) + 1,
      createdAt: previous?.createdAt ?? now, updatedAt: now,
    }, { owner: 'work' })
    assertComicVisualSubjectV1({ subject, adaptation, sourceUnitIds: deps.sourceUnitIds, bindings: deps.bindings, locationRefKeys: deps.locationRefKeys })
    const duplicate = await db.comicVisualSubjects.where('[workId+stableKey]').equals([scope.workId, subject.stableKey]).first()
    if (duplicate && duplicate.id !== previous?.id) throw new Error('[comic] 视觉条目 stableKey 重复')
    const id = await db.comicVisualSubjects.put(subject) as number
    return { ...subject, id: previous?.id ?? id }
  })
}

export async function deleteComicVisualSubject(input: { scope: WorkspaceScope; subjectId: number; clearReferences?: boolean }): Promise<void> {
  const { scope, adaptation } = await requireComic(input.scope, true)
  const blobObjectIds = await db.transaction('rw', db.comicVisualSubjects, db.comicPanels, db.comicMediaAssets, async () => {
    const subject = await db.comicVisualSubjects.get(input.subjectId)
    if (!subject || subject.workId !== scope.workId || subject.adaptationProjectId !== adaptation.id) throw new Error('[comic] 视觉条目不存在或越界')
    if (subject.status === 'locked') throw new Error('[comic] 锁定视觉条目必须先解锁')
    const [panels, assets] = await Promise.all([
      db.comicPanels.where('workId').equals(scope.workId).filter(panel => panel.continuityRefs.some(ref => ref.subjectKey === subject.stableKey)).toArray(),
      db.comicMediaAssets.where('subjectKey').equals(subject.stableKey).toArray(),
    ])
    if ((panels.length || assets.length || subject.selectedMediaAssetKey) && !input.clearReferences) throw new Error('[comic] 视觉条目仍被格或媒体引用，请显式清理引用')
    const now = Date.now()
    await db.comicPanels.bulkPut(panels.map(panel => ({ ...panel, continuityRefs: panel.continuityRefs.filter(ref => ref.subjectKey !== subject.stableKey), revision: panel.revision + 1, updatedAt: now })))
    if (assets.length) await db.comicMediaAssets.bulkDelete(assets.map(asset => asset.id!))
    await db.comicVisualSubjects.delete(subject.id!)
    return [...new Set(assets.map(asset => asset.blobObjectId))]
  })
  for (const blobObjectId of blobObjectIds) {
    const pending = await markUnreferencedMediaBlobForDeletionV1({ scope, blobObjectId })
    if (pending?.deleteReceiptHash) await finalizePendingMediaBlobDeletionV1({ scope, blobObjectId, receiptHash: pending.deleteReceiptHash })
  }
}

export async function deleteComicPage(input: { scope: WorkspaceScope; pageId: number }): Promise<void> {
  const { scope, adaptation } = await requireComic(input.scope, true)
  const blobObjectIds = await db.transaction('rw', db.comicPages, db.comicPanels, db.comicMediaAssets, async () => {
    const page = await db.comicPages.get(input.pageId)
    if (!page || page.workId !== scope.workId || page.adaptationProjectId !== adaptation.id) throw new Error('[comic] 页面不存在或越界')
    if (page.status === 'locked') throw new Error('[comic] 锁定页面必须先解锁')
    const panels = await db.comicPanels.where('pageId').equals(page.id!).toArray()
    if (panels.some(panel => panel.status === 'locked')) throw new Error('[comic] 页面包含锁定格，必须先解锁')
    const panelIds = panels.map(panel => panel.id!)
    const assets = panelIds.length ? await db.comicMediaAssets.where('panelId').anyOf(panelIds).toArray() : []
    if (panelIds.length) {
      if (assets.length) await db.comicMediaAssets.bulkDelete(assets.map(asset => asset.id!))
      await db.comicPanels.bulkDelete(panelIds)
    }
    await db.comicPages.delete(page.id!)
    const remaining = await db.comicPages.where('adaptationProjectId').equals(adaptation.id).sortBy('order')
    await db.comicPages.bulkPut(remaining.map((row, order) => ({ ...row, order, revision: row.revision + 1, updatedAt: Date.now() })))
    return [...new Set(assets.map(asset => asset.blobObjectId))]
  })
  for (const blobObjectId of blobObjectIds) {
    const pending = await markUnreferencedMediaBlobForDeletionV1({ scope, blobObjectId })
    if (pending?.deleteReceiptHash) await finalizePendingMediaBlobDeletionV1({ scope, blobObjectId, receiptHash: pending.deleteReceiptHash })
  }
}
