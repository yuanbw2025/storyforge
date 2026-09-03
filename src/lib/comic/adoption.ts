import { db } from '../db/schema'
import type { ComicPage, ComicPanel, WorkspaceScope } from '../types'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { inspectAdaptationFreshness } from '../adaptation/source-manifest'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { assertComicPageV1, assertComicPanelV1, assertPagePanelLayoutV1 } from './contracts'

export interface ComicPanelCandidateV1 extends Pick<ComicPanel, 'stableKey' | 'frame' | 'shot' | 'action' | 'visualPrompt' | 'negativePrompt' | 'continuityRefs' | 'lettering'> {
  sourceUnitKeys: string[]
}

export interface ComicPageCandidateV1 {
  stableKey: string
  chapterNumber: number
  summary: string
  panels: ComicPanelCandidateV1[]
}

function exactKeys(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[comic-adoption] ${label} 必须是对象`)
  const keys = Object.keys(value)
  if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key))) throw new Error(`[comic-adoption] ${label} 字段不在允许闭集`)
}

export function assertComicStoryboardCandidateV1(value: unknown): asserts value is ComicPageCandidateV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new Error('[comic-adoption] 每批必须包含 1～12 页')
  value.forEach((page, pageIndex) => {
    exactKeys(page, ['stableKey', 'chapterNumber', 'summary', 'panels'], `pages[${pageIndex}]`)
    if (!Array.isArray(page.panels) || page.panels.length < 1 || page.panels.length > 9) throw new Error(`[comic-adoption] pages[${pageIndex}].panels 必须包含 1～9 格`)
    page.panels.forEach((panel: unknown, panelIndex: number) => {
      const label = `pages[${pageIndex}].panels[${panelIndex}]`
      exactKeys(panel, ['stableKey', 'frame', 'shot', 'action', 'visualPrompt', 'negativePrompt', 'continuityRefs', 'lettering', 'sourceUnitKeys'], label)
      exactKeys(panel.frame, ['x', 'y', 'width', 'height'], `${label}.frame`)
      exactKeys(panel.shot, ['size', 'angle', 'movement', 'composition'], `${label}.shot`)
      if (!Array.isArray(panel.continuityRefs) || !Array.isArray(panel.lettering) || !Array.isArray(panel.sourceUnitKeys)) throw new Error(`[comic-adoption] ${label} 的引用、排字或来源不是数组`)
      panel.continuityRefs.forEach((ref: unknown, refIndex: number) => exactKeys(ref, ['subjectKey', 'note'], `${label}.continuityRefs[${refIndex}]`))
      panel.lettering.forEach((item: unknown, letteringIndex: number) => {
        const letteringLabel = `${label}.lettering[${letteringIndex}]`
        exactKeys(item, ['id', 'kind', 'text', 'frame', 'direction', 'fontFamily', 'fontSize', 'textColor', 'fillColor', 'strokeColor', 'strokeWidth', 'tail', 'zIndex'], letteringLabel)
        exactKeys(item.frame, ['x', 'y', 'width', 'height'], `${letteringLabel}.frame`)
        if (item.tail !== null) exactKeys(item.tail, ['x', 'y'], `${letteringLabel}.tail`)
      })
    })
  })
}

function assertPortable(value: ComicPageCandidateV1[]): void {
  const forbidden = new Set(['projectId', 'worldId', 'workId', 'adaptationProjectId', 'pageId', 'sourceUnitIds', 'sourceReviewManifestVersion', 'selectedMediaAssetKey', 'imageTransform', 'status', 'revision', 'createdAt', 'updatedAt', 'allowPanelOverlap', 'characterId', 'blobObjectId'])
  const visit = (item: unknown, path: string) => {
    if (Array.isArray(item)) return item.forEach((child, index) => visit(child, `${path}[${index}]`))
    if (!item || typeof item !== 'object') return
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (forbidden.has(key)) throw new Error(`[comic-adoption] 候选不得写系统字段 ${path}.${key}`)
      visit(child, `${path}.${key}`)
    }
  }
  visit(value, 'pages')
}

export async function adoptComicStoryboardBatchV1(input: {
  scope: WorkspaceScope
  adaptationProjectId: number
  expectedAdaptationRevision: number
  sourceManifestVersion: number
  expectedPlanHash: string
  expectedVisualBibleHash: string
  candidates: ComicPageCandidateV1[]
}): Promise<Array<{ page: ComicPage; panels: ComicPanel[] }>> {
  assertComicStoryboardCandidateV1(input.candidates)
  assertPortable(input.candidates)
  const pageKeys = input.candidates.map(page => page.stableKey)
  const panelKeys = input.candidates.flatMap(page => page.panels.map(panel => panel.stableKey))
  if (new Set(pageKeys).size !== pageKeys.length || new Set(panelKeys).size !== panelKeys.length || input.candidates.some(page => !page.panels.length || page.panels.length > 9)) throw new Error('[comic-adoption] 页/格 stableKey 重复或格数非法')
  const scope = await resolveScope({ scope: input.scope })
  const rootBefore = await db.adaptationProjects.get(input.adaptationProjectId)
  if (!rootBefore?.id || rootBefore.medium !== 'comic' || rootBefore.workId !== scope.workId || rootBefore.projectId !== scope.projectId || rootBefore.worldId !== scope.worldId) throw new Error('[comic-adoption] 改编项目越界或媒介不匹配')
  if (rootBefore.revision !== input.expectedAdaptationRevision || rootBefore.activeSourceManifestVersion !== input.sourceManifestVersion || !rootBefore.plan || await hashCanonicalValue(rootBefore.plan) !== input.expectedPlanHash || !rootBefore.visualBible || await hashCanonicalValue(rootBefore.visualBible) !== input.expectedVisualBibleHash) throw new Error('[comic-adoption] 改编根、计划或视觉圣经已变化')
  if (rootBefore.planSourceManifestVersion !== input.sourceManifestVersion || rootBefore.visualBibleSourceManifestVersion !== input.sourceManifestVersion || !['producing', 'review'].includes(rootBefore.status)) throw new Error('[comic-adoption] 计划/视觉圣经尚未确认或未进入生产')
  if ((await inspectAdaptationFreshness(rootBefore.id)).status !== 'unchanged') throw new Error('[comic-adoption] 来源已变化或缺失，候选已 stale')

  return db.transaction('rw', scopeTransactionTables(db.comicPages, db.comicPanels, db.comicVisualSubjects, db.adaptationProjects, db.adaptationSourceUnits, db.workCharacterBindings), async () => {
    const root = await db.adaptationProjects.get(rootBefore.id!)
    if (!root || root.revision !== input.expectedAdaptationRevision || root.activeSourceManifestHash !== rootBefore.activeSourceManifestHash || JSON.stringify(root.plan) !== JSON.stringify(rootBefore.plan) || JSON.stringify(root.visualBible) !== JSON.stringify(rootBefore.visualBible)) throw new Error('[comic-adoption] CAS 失败：改编根已变化')
    const [units, subjects, existingPages, existingPanels] = await Promise.all([
      db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([root.id!, input.sourceManifestVersion]).toArray(),
      db.comicVisualSubjects.where('adaptationProjectId').equals(root.id!).toArray(),
      db.comicPages.where('adaptationProjectId').equals(root.id!).toArray(),
      db.comicPanels.where('workId').equals(scope.workId).toArray(),
    ])
    const unitByKey = new Map(units.map(unit => [unit.sourceUnitKey, unit]))
    const sourceUnitIds = new Set(units.flatMap(unit => unit.id == null ? [] : [unit.id]))
    const subjectKeys = new Set(subjects.map(subject => subject.stableKey))
    const matchedPages = input.candidates.map(candidate => existingPages.find(page => page.stableKey === candidate.stableKey))
    const matchedPanels = input.candidates.flatMap(candidate => candidate.panels.map(panel => existingPanels.find(row => row.stableKey === panel.stableKey)))
    if (matchedPages.some(Boolean) || matchedPanels.some(Boolean)) {
      if (matchedPages.some(page => !page) || matchedPanels.some(panel => !panel)) throw new Error('[comic-adoption] 既有页格只匹配候选的一部分，拒绝恢复以避免半批覆盖')
      const restored = input.candidates.map((candidate, pageIndex) => {
        const page = matchedPages[pageIndex]!
        const panels = candidate.panels.map(panelCandidate => existingPanels.find(panel => panel.stableKey === panelCandidate.stableKey)!)
        const expectedSourceIds = (panelCandidate: ComicPanelCandidateV1) => panelCandidate.sourceUnitKeys.map(key => {
          const unit = unitByKey.get(key)
          if (!unit?.id) throw new Error(`[comic-adoption] 来源 key 不属于冻结 manifest：${key}`)
          return unit.id
        })
        const pageMatches = page.chapterNumber === candidate.chapterNumber && page.summary === candidate.summary.trim() && page.allowPanelOverlap === false && page.status === 'storyboarded'
        const panelsMatch = panels.every((panel, panelIndex) => {
          const expected = candidate.panels[panelIndex]
          return panel.pageId === page.id && panel.order === panelIndex && panel.sourceReviewManifestVersion === input.sourceManifestVersion && panel.selectedMediaAssetKey === null
            && canonicalStringify({ frame: panel.frame, shot: panel.shot, action: panel.action, visualPrompt: panel.visualPrompt, negativePrompt: panel.negativePrompt, continuityRefs: panel.continuityRefs, lettering: panel.lettering, sourceUnitIds: panel.sourceUnitIds })
              === canonicalStringify({ frame: expected.frame, shot: expected.shot, action: expected.action.trim(), visualPrompt: expected.visualPrompt.trim(), negativePrompt: expected.negativePrompt.trim(), continuityRefs: expected.continuityRefs, lettering: expected.lettering, sourceUnitIds: expectedSourceIds(expected) })
        })
        if (!pageMatches || !panelsMatch) throw new Error('[comic-adoption] stableKey 已存在但内容与可恢复采纳意图不一致')
        return { page, panels }
      })
      return restored
    }
    const now = Date.now()
    const staged = input.candidates.map((candidate, pageIndex) => {
      const temporaryPageId = -(pageIndex + 1)
      const page: ComicPage = stampNewRecord(scope, 'comicPages', {
        projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id!, stableKey: candidate.stableKey,
        chapterNumber: candidate.chapterNumber, order: existingPages.length + pageIndex, allowPanelOverlap: false,
        summary: candidate.summary.trim(), status: 'storyboarded', revision: 1, createdAt: now, updatedAt: now,
      }, { owner: 'work' })
      page.id = temporaryPageId
      assertComicPageV1(page, root)
      const panels = candidate.panels.map((panelCandidate, order): ComicPanel => {
        const ids = panelCandidate.sourceUnitKeys.map(key => {
          const unit = unitByKey.get(key)
          if (!unit?.id) throw new Error(`[comic-adoption] 来源 key 不属于冻结 manifest：${key}`)
          return unit.id
        })
        if (!ids.length || new Set(ids).size !== ids.length) throw new Error(`[comic-adoption] 格来源为空或重复：${panelCandidate.stableKey}`)
        const panel: ComicPanel = stampNewRecord(scope, 'comicPanels', {
          projectId: scope.projectId, workId: scope.workId, pageId: temporaryPageId, stableKey: panelCandidate.stableKey,
          order, frame: structuredClone(panelCandidate.frame), sourceUnitIds: ids, sourceReviewManifestVersion: input.sourceManifestVersion,
          shot: structuredClone(panelCandidate.shot), action: panelCandidate.action.trim(), visualPrompt: panelCandidate.visualPrompt.trim(), negativePrompt: panelCandidate.negativePrompt.trim(),
          continuityRefs: structuredClone(panelCandidate.continuityRefs), lettering: structuredClone(panelCandidate.lettering),
          selectedMediaAssetKey: null, imageTransform: { fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, rotation: 0 },
          status: 'draft', revision: 1, createdAt: now, updatedAt: now,
        }, { owner: 'work' })
        assertComicPanelV1({ panel, page, adaptation: root, sourceUnitIds, subjectKeys })
        return panel
      })
      assertPagePanelLayoutV1(page, panels)
      return { page, panels }
    })

    const saved: Array<{ page: ComicPage; panels: ComicPanel[] }> = []
    for (const item of staged) {
      const { id: _temporaryId, ...pageWithoutId } = item.page
      const pageId = await db.comicPages.add(pageWithoutId) as number
      const panels = item.panels.map(panel => ({ ...panel, pageId }))
      const panelIds = await db.comicPanels.bulkAdd(panels, { allKeys: true }) as number[]
      saved.push({ page: { ...item.page, id: pageId }, panels: panels.map((panel, index) => ({ ...panel, id: panelIds[index] })) })
    }
    return saved
  })
}
