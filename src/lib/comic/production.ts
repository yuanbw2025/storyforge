import { db } from '../db/schema'
import { inspectAdaptationFreshness, startAdaptationProduction } from '../adaptation/source-manifest'
import type {
  AdaptationProject,
  ComicImageRequestCandidateV1,
  ComicPage,
  ComicPagePlanCandidateV1,
  ComicPagePlanV1,
  ComicPanel,
  ComicPanelPlanCandidateV1,
  ComicRepairRequestCandidateV1,
  ComicReviewIssueCandidateV1,
  ComicReviewIssueV1,
  ComicScriptBeatCandidateV1,
  ComicScriptBeatV1,
  ComicVisualBibleCandidateV1,
  ComicVisualSubject,
  WorkspaceScope,
} from '../types'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { assertComicReadingOrderV1, assertComicVisualSubjectV1 } from './contracts'
import {
  assertComicCandidateBatchV1,
  assertComicImageRequestCandidateV1,
  assertComicPagePlanCandidateV1,
  assertComicPanelPlanCandidateV1,
  assertComicRepairRequestCandidateV1,
  assertComicReviewIssueCandidateV1,
  assertComicScriptBeatCandidateV1,
  assertComicVisualBibleCandidateV1,
} from './production-contracts'

export interface ComicProductionSnapshotV1 {
  scriptBeats: ComicScriptBeatV1[]
  pagePlans: ComicPagePlanV1[]
  reviewIssues: ComicReviewIssueV1[]
}

async function requireRoot(scopeInput: WorkspaceScope, expectedRevision?: number, editable = true): Promise<{ scope: WorkspaceScope; root: AdaptationProject & { id: number; medium: 'comic' } }> {
  const scope = await resolveScope({ scope: scopeInput })
  const root = await db.adaptationProjects.where('workId').equals(scope.workId).first()
  if (!root?.id || root.medium !== 'comic' || root.projectId !== scope.projectId || root.worldId !== scope.worldId) throw new Error('[comic-production] 当前 Work 不是有效漫画改编')
  if (expectedRevision != null && root.revision !== expectedRevision) throw new Error('[comic-production] 改编根已变化，请刷新')
  if (editable && root.status === 'complete') throw new Error('[comic-production] 已发布漫画必须先重新打开审校')
  return { scope, root: root as AdaptationProject & { id: number; medium: 'comic' } }
}

async function requireFresh(root: AdaptationProject & { id: number }): Promise<void> {
  if ((await inspectAdaptationFreshness(root.id)).status !== 'unchanged') throw new Error('[comic-production] 来源已变化或缺失，候选 stale')
}

function assertRootCas(current: AdaptationProject | undefined, expected: AdaptationProject & { id: number }): asserts current is AdaptationProject & { id: number; medium: 'comic' } {
  if (!current?.id || current.revision !== expected.revision || current.activeSourceManifestVersion !== expected.activeSourceManifestVersion || current.activeSourceManifestHash !== expected.activeSourceManifestHash) throw new Error('[comic-production] CAS 失败：改编根或来源版本已变化')
}

export async function listComicProductionV1(scopeInput: WorkspaceScope): Promise<ComicProductionSnapshotV1> {
  const { root } = await requireRoot(scopeInput, undefined, false)
  const key = [root.id, root.activeSourceManifestVersion] as [number, number]
  const [scriptBeats, pagePlans, reviewIssues] = await Promise.all([
    db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
    db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
    db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('createdAt'),
  ])
  return { scriptBeats, pagePlans, reviewIssues }
}

export async function adoptComicScriptBeatsV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; sourceManifestVersion: number; candidates: ComicScriptBeatCandidateV1[]; allowReplaceDownstream?: boolean }): Promise<ComicScriptBeatV1[]> {
  assertComicCandidateBatchV1(input.candidates, assertComicScriptBeatCandidateV1, 'script beat', 1_000)
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  if (root.briefSourceManifestVersion !== input.sourceManifestVersion || root.activeSourceManifestVersion !== input.sourceManifestVersion) throw new Error('[comic-production] 当前来源版本的 Brief 尚未确认')
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.adaptationSourceUnits, db.adaptationSourceFacts, db.adaptationDecisions, db.comicScriptBeats, db.comicPagePlans, db.comicPages, db.comicPanels, db.comicReviewIssues), async () => {
    assertRootCas(await db.adaptationProjects.get(root.id), root)
    const key = [root.id, input.sourceManifestVersion] as [number, number]
    const [units, facts, decisions, plans, pages] = await Promise.all([
      db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.comicPages.where('adaptationProjectId').equals(root.id).toArray(),
    ])
    if ((plans.length || pages.length) && !input.allowReplaceDownstream) throw new Error('[comic-production] 重做漫画脚本会清除分页、页格和审查，必须显式确认')
    const unitKeys = new Set(units.map(row => row.sourceUnitKey)); const factKeys = new Set(facts.filter(row => row.authorStatus === 'confirmed').map(row => row.stableKey)); const decisionKeys = new Set(decisions.filter(row => row.authorStatus === 'confirmed').map(row => row.stableKey))
    if (!factKeys.size || !decisionKeys.size) throw new Error('[comic-production] 请先确认来源事实与改编决定')
    const now = Date.now(); const rows = input.candidates.map(candidate => {
      if (candidate.chapterNumber > root.targetSpec.chapterCount || candidate.sourceUnitKeys.some(key => !unitKeys.has(key)) || candidate.causalFactKeys.some(key => !factKeys.has(key)) || candidate.decisionKeys.some(key => !decisionKeys.has(key))) throw new Error(`[comic-production] script beat ${candidate.stableKey} 引用越界`)
      return stampNewRecord(scope, 'comicScriptBeats', { ...structuredClone(candidate), projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id, manifestVersion: input.sourceManifestVersion, authorStatus: 'confirmed' as const, revision: 1, createdAt: now, updatedAt: now }, { owner: 'work' }) as ComicScriptBeatV1
    })
    const pageIds = pages.flatMap(page => page.id == null ? [] : [page.id])
    if (pageIds.length) await db.comicPanels.where('pageId').anyOf(pageIds).delete()
    await Promise.all([db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).delete(), db.comicPages.where('adaptationProjectId').equals(root.id).delete(), db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).delete(), db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).delete()])
    await db.comicScriptBeats.bulkAdd(rows); await db.adaptationProjects.update(root.id, { plan: null, planSourceManifestVersion: null, status: 'planning', revision: root.revision + 1, updatedAt: now })
    return db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order')
  })
}

export async function adoptComicPagePlansV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; sourceManifestVersion: number; candidates: ComicPagePlanCandidateV1[]; allowReplaceDownstream?: boolean }): Promise<ComicPagePlanV1[]> {
  assertComicCandidateBatchV1(input.candidates, assertComicPagePlanCandidateV1, 'page plan', 5_000)
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  const expectedPages = root.targetSpec.chapterCount * root.targetSpec.targetPagesPerChapter
  if (input.candidates.length !== expectedPages) throw new Error(`[comic-production] 分页必须覆盖目标 ${expectedPages} 页`)
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.comicScriptBeats, db.comicPagePlans, db.comicPages, db.comicPanels, db.comicReviewIssues), async () => {
    assertRootCas(await db.adaptationProjects.get(root.id), root)
    const key = [root.id, input.sourceManifestVersion] as [number, number]
    const [beats, pages] = await Promise.all([db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), db.comicPages.where('adaptationProjectId').equals(root.id).toArray()])
    if (!beats.length) throw new Error('[comic-production] 请先确认漫画脚本节拍')
    if (pages.length && !input.allowReplaceDownstream) throw new Error('[comic-production] 重做分页会清除页格和审查，必须显式确认')
    const beatKeys = new Set(beats.map(row => row.stableKey)); const pageNumbers = new Set<number>(); const now = Date.now()
    const rows = input.candidates.map((candidate, order) => {
      if (candidate.order !== order || candidate.pageNumber !== order + 1 || candidate.chapterNumber > root.targetSpec.chapterCount || candidate.beatKeys.some(key => !beatKeys.has(key)) || pageNumbers.has(candidate.pageNumber)) throw new Error(`[comic-production] page plan ${candidate.stableKey} 顺序或引用非法`)
      pageNumbers.add(candidate.pageNumber)
      return stampNewRecord(scope, 'comicPagePlans', { ...structuredClone(candidate), projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id, manifestVersion: input.sourceManifestVersion, authorStatus: 'confirmed' as const, revision: 1, createdAt: now, updatedAt: now }, { owner: 'work' }) as ComicPagePlanV1
    })
    const pageIds = pages.flatMap(page => page.id == null ? [] : [page.id]); if (pageIds.length) await db.comicPanels.where('pageId').anyOf(pageIds).delete()
    await Promise.all([db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).delete(), db.comicPages.where('adaptationProjectId').equals(root.id).delete(), db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).delete()])
    await db.comicPagePlans.bulkAdd(rows)
    const plan = { version: 1 as const, premise: root.brief?.coreTheme ?? '漫画改编', sections: rows.map(row => ({ stableKey: row.stableKey, title: `第 ${row.pageNumber} 页`, summary: row.goal, order: row.order, episodeNumber: row.chapterNumber, sourceUnitKeys: [...new Set(beats.filter(beat => row.beatKeys.includes(beat.stableKey)).flatMap(beat => beat.sourceUnitKeys))] })), globalAssumptions: root.plan?.globalAssumptions ?? [] }
    await db.adaptationProjects.update(root.id, { plan, planSourceManifestVersion: input.sourceManifestVersion, status: 'planning', revision: root.revision + 1, updatedAt: now })
    return db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order')
  })
}

/**
 * Author-invoked deterministic fallback for providers that cannot return a
 * complete nested panel batch. It only materializes confirmed beats/page plans
 * into an editable vertical storyboard; it does not claim AI authorship or
 * visual-release quality.
 */
export async function createComicPanelScaffoldFromConfirmedPlanV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; sourceManifestVersion: number }): Promise<Array<{ page: ComicPage; panels: ComicPanel[] }>> {
  const { root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  if (root.activeSourceManifestVersion !== input.sourceManifestVersion) throw new Error('[comic-production] 基础分镜来源版本已变化')
  const key = [root.id, input.sourceManifestVersion] as [number, number]
  const [plans, beats, facts] = await Promise.all([
    db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
    db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
    db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').toArray(),
  ])
  if (!plans.length || plans.length !== root.targetSpec.chapterCount * root.targetSpec.targetPagesPerChapter) throw new Error('[comic-production] 请先确认完整分页计划')
  const beatByKey = new Map(beats.map(row => [row.stableKey, row])); const factByKey = new Map(facts.map(row => [row.stableKey, row]))
  const candidates = plans.flatMap(plan => {
    const pageBeats = plan.beatKeys.map(beatKey => beatByKey.get(beatKey)).filter((row): row is ComicScriptBeatV1 => Boolean(row))
    if (!pageBeats.length) throw new Error(`[comic-production] ${plan.stableKey} 没有可用于基础分镜的已确认节拍`)
    const panelKeys = Array.from({ length: plan.expectedPanelCount }, (_, index) => `${plan.stableKey}_panel_${index + 1}`)
    return panelKeys.map((stableKey, order): ComicPanelPlanCandidateV1 => {
      const beat = pageBeats[Math.min(order, pageBeats.length - 1)]
      const subjectKeys = [...new Set(beat.causalFactKeys.flatMap(factKey => factByKey.get(factKey)?.subjectKeys ?? []))]
      const height = 1 / plan.expectedPanelCount
      return {
        pagePlanKey: plan.stableKey, stableKey, order, nextPanelKey: panelKeys[order + 1] ?? null,
        frame: { x: 0, y: order * height, width: 1, height }, narrativeFunction: beat.narrativeFunction, moment: beat.visualAction,
        shot: { size: order === 0 ? 'wide' : order === plan.expectedPanelCount - 1 ? 'close-up' : 'medium', angle: 'eye-level', movement: 'static', composition: `第 ${order + 1} 格采用全宽纵向分带，按 ${root.targetSpec.readingDirection.toUpperCase()} 顺序阅读。` },
        subjectStates: subjectKeys.map(subjectKey => ({ subjectKey, costume: '', condition: '', props: [], position: '' })),
        protectedAreas: [], continuityRefs: subjectKeys.map(subjectKey => ({ subjectKey, note: '保持当前页及相邻页的身份、服装、道具与状态连续。' })), lettering: [], sourceUnitKeys: [...beat.sourceUnitKeys],
      }
    })
  })
  return adoptComicPanelPlansV1({ scope: input.scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: input.sourceManifestVersion, candidates })
}

export async function adoptComicPanelPlansV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; sourceManifestVersion: number; candidates: ComicPanelPlanCandidateV1[]; allowReplaceExisting?: boolean }): Promise<Array<{ page: ComicPage; panels: ComicPanel[] }>> {
  assertComicCandidateBatchV1(input.candidates, assertComicPanelPlanCandidateV1, 'panel plan', 20_000)
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.adaptationSourceUnits, db.comicPagePlans, db.comicPages, db.comicPanels, db.comicMediaAssets, db.comicReviewIssues), async () => {
    assertRootCas(await db.adaptationProjects.get(root.id), root)
    const key = [root.id, input.sourceManifestVersion] as [number, number]
    const [units, plans, existingPages] = await Promise.all([db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'), db.comicPages.where('adaptationProjectId').equals(root.id).toArray()])
    if (!plans.length || plans.length !== root.targetSpec.chapterCount * root.targetSpec.targetPagesPerChapter) throw new Error('[comic-production] 请先确认完整分页计划')
    if (existingPages.length && !input.allowReplaceExisting) throw new Error('[comic-production] 重做 panel plan 会清除页格、图片候选和审查，必须显式确认')
    const planByKey = new Map(plans.map(row => [row.stableKey, row])); const unitByKey = new Map(units.flatMap(unit => unit.id == null ? [] : [[unit.sourceUnitKey, unit.id] as const]))
    const grouped = new Map<string, ComicPanelPlanCandidateV1[]>(); for (const item of input.candidates) grouped.set(item.pagePlanKey, [...(grouped.get(item.pagePlanKey) ?? []), item])
    if (grouped.size !== plans.length || [...grouped.keys()].some(value => !planByKey.has(value))) throw new Error('[comic-production] panel plan 必须覆盖每个页面')
    const now = Date.now(); const pageIds = existingPages.flatMap(page => page.id == null ? [] : [page.id]); const existingAssets = pageIds.length ? await db.comicPanels.where('pageId').anyOf(pageIds).toArray().then(rows => rows.flatMap(row => row.id == null ? [] : [row.id])) : []
    if (existingAssets.length && await db.comicMediaAssets.where('panelId').anyOf(existingAssets).count()) throw new Error('[comic-production] 已有图片候选时不能批量替换 panel plan，请先清理媒资')
    if (pageIds.length) await db.comicPanels.where('pageId').anyOf(pageIds).delete()
    await Promise.all([db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).delete(), db.comicPages.where('adaptationProjectId').equals(root.id).delete()])
    const saved: Array<{ page: ComicPage; panels: ComicPanel[] }> = []
    for (const plan of plans) {
      const candidates = [...(grouped.get(plan.stableKey) ?? [])].sort((a, b) => a.order - b.order)
      if (candidates.length !== plan.expectedPanelCount || candidates.some((row, index) => row.order !== index || (row.nextPanelKey ?? null) !== (candidates[index + 1]?.stableKey ?? null))) throw new Error(`[comic-production] ${plan.stableKey} 格数或显式阅读链不匹配`)
      const page: ComicPage = stampNewRecord(scope, 'comicPages', { projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id, stableKey: `page_${plan.pageNumber}`, pagePlanKey: plan.stableKey, chapterNumber: plan.chapterNumber, order: plan.order, allowPanelOverlap: false, summary: plan.goal, status: 'storyboarded', revision: 1, createdAt: now, updatedAt: now }, { owner: 'work' })
      const pageId = await db.comicPages.add(page) as number; const savedPage = { ...page, id: pageId }
      const panels = candidates.map(candidate => {
        const sourceUnitIds = candidate.sourceUnitKeys.map(sourceKey => { const id = unitByKey.get(sourceKey); if (!id) throw new Error(`[comic-production] panel ${candidate.stableKey} 来源越界`); return id })
        return stampNewRecord(scope, 'comicPanels', { projectId: scope.projectId, workId: scope.workId, pageId, stableKey: candidate.stableKey, order: candidate.order, nextPanelKey: candidate.nextPanelKey, frame: structuredClone(candidate.frame), sourceUnitIds, sourceReviewManifestVersion: input.sourceManifestVersion, shot: structuredClone(candidate.shot), narrativeFunction: candidate.narrativeFunction, moment: candidate.moment, action: candidate.moment, visualPrompt: '', negativePrompt: 'no text, no letters, no speech balloons, no captions, no watermark', continuityRefs: structuredClone(candidate.continuityRefs), subjectStates: structuredClone(candidate.subjectStates), protectedAreas: structuredClone(candidate.protectedAreas), lettering: structuredClone(candidate.lettering), selectedMediaAssetKey: null, imageTransform: { fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, rotation: 0 }, status: 'draft', narrativeReviewRevision: null, visualReviewRevision: null, visualReviewBasis: null, visualReviewedAt: null, revision: 1, createdAt: now, updatedAt: now }, { owner: 'work' }) as ComicPanel
      })
      assertComicReadingOrderV1(savedPage, panels, root.targetSpec.readingDirection); const ids = await db.comicPanels.bulkAdd(panels, { allKeys: true }) as number[]
      saved.push({ page: savedPage, panels: panels.map((panel, index) => ({ ...panel, id: ids[index] })) })
    }
    await db.adaptationProjects.update(root.id, { revision: root.revision + 1, updatedAt: now })
    return saved
  })
}

export async function adoptComicVisualBibleV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; sourceManifestVersion: number; candidate: ComicVisualBibleCandidateV1; allowReplaceExisting?: boolean }): Promise<void> {
  assertComicVisualBibleCandidateV1(input.candidate)
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.adaptationSourceUnits, db.comicVisualSubjects, db.comicPanels, db.comicMediaAssets), async () => {
    assertRootCas(await db.adaptationProjects.get(root.id), root)
    const key = [root.id, input.sourceManifestVersion] as [number, number]; const [units, existing] = await Promise.all([db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), db.comicVisualSubjects.where('adaptationProjectId').equals(root.id).toArray()])
    if (existing.length && !input.allowReplaceExisting) throw new Error('[comic-production] 重做视觉圣经会清除视觉条目，必须显式确认')
    const assetCount = await db.comicMediaAssets.where('adaptationProjectId').equals(root.id).count(); if (assetCount) throw new Error('[comic-production] 已有媒体候选时不能替换视觉圣经')
    const unitByKey = new Map(units.flatMap(unit => unit.id == null ? [] : [[unit.sourceUnitKey, unit.id] as const])); const now = Date.now()
    const subjects: ComicVisualSubject[] = input.candidate.subjects.map(candidate => {
      const row = stampNewRecord(scope, 'comicVisualSubjects', { projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id, stableKey: candidate.stableKey, kind: candidate.kind, characterId: null, locationRefKey: null, label: candidate.label, design: structuredClone(candidate.design), sourceUnitIds: candidate.sourceUnitKeys.map(key => { const id = unitByKey.get(key); if (!id) throw new Error(`[comic-production] visual subject ${candidate.stableKey} 来源越界`); return id }), sourceReviewManifestVersion: input.sourceManifestVersion, selectedMediaAssetKey: null, status: 'reviewed', revision: 1, createdAt: now, updatedAt: now }, { owner: 'work' }) as ComicVisualSubject
      assertComicVisualSubjectV1({ subject: row, adaptation: root, sourceUnitIds: new Set(unitByKey.values()), bindings: [], allowMissingExternalRef: true }); return row
    })
    const panelRefs = await db.comicPanels.where('workId').equals(scope.workId).toArray(); const subjectKeys = new Set(subjects.map(row => row.stableKey))
    if (panelRefs.some(panel => [...(panel.continuityRefs ?? []), ...(panel.subjectStates ?? [])].some(ref => !subjectKeys.has(ref.subjectKey)))) throw new Error('[comic-production] 视觉圣经没有覆盖 panel 引用的 subject key')
    await db.comicVisualSubjects.where('adaptationProjectId').equals(root.id).delete(); await db.comicVisualSubjects.bulkAdd(subjects)
    await db.adaptationProjects.update(root.id, { visualBible: structuredClone(input.candidate.global), visualBibleSourceManifestVersion: input.sourceManifestVersion, revision: root.revision + 1, updatedAt: now })
  })
}

export async function startComicProductionV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number }): Promise<AdaptationProject> {
  const { root } = await requireRoot(input.scope, input.expectedAdaptationRevision); const key = [root.id, root.activeSourceManifestVersion] as [number, number]
  const [plans, pages, subjects] = await Promise.all([db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), db.comicPages.where('adaptationProjectId').equals(root.id).toArray(), db.comicVisualSubjects.where('adaptationProjectId').equals(root.id).toArray()])
  if (!plans.length || plans.length !== pages.length || !subjects.length || root.visualBibleSourceManifestVersion !== root.activeSourceManifestVersion) throw new Error('[comic-production] 完整分页、页格与视觉圣经尚未确认')
  return startAdaptationProduction({ adaptationProjectId: root.id, expectedRevision: root.revision })
}

async function applyImageRequest(scopeInput: WorkspaceScope, expectedAdaptationRevision: number, candidate: ComicImageRequestCandidateV1): Promise<ComicPanel> {
  assertComicImageRequestCandidateV1(candidate); const { scope, root } = await requireRoot(scopeInput, expectedAdaptationRevision); await requireFresh(root)
  return db.transaction('rw', db.comicPanels, db.comicVisualSubjects, async () => {
    const panel = await db.comicPanels.where('[workId+stableKey]').equals([scope.workId, candidate.panelKey]).first()
    if (!panel || panel.revision !== candidate.expectedPanelRevision || panel.status === 'locked') throw new Error('[comic-production] 图片请求目标格不存在、已变化或已锁定')
    const expectedFrames = (panel.protectedAreas ?? []).map(row => [row.x, row.y, row.width, row.height]); const actualFrames = candidate.protectedAreas.map(row => [row.x, row.y, row.width, row.height])
    if (JSON.stringify(actualFrames) !== JSON.stringify(expectedFrames)) throw new Error('[comic-production] 图片请求不得改写目标格 protectedAreas')
    const subjects = await db.comicVisualSubjects.where('adaptationProjectId').equals(root.id).toArray(); const subjectKeys = new Set(subjects.map(row => row.stableKey))
    if (candidate.referenceSubjectKeys.some(key => !subjectKeys.has(key))) throw new Error('[comic-production] 图片请求引用未知 visual subject')
    const refs = candidate.referenceSubjectKeys.map(subjectKey => ({ subjectKey, note: '图片请求必须实际使用已选参考图；缺失能力时阻断 visual release。' }))
    const nextRevision = panel.revision + 1
    const next: ComicPanel = { ...panel, visualPrompt: candidate.visualPrompt.trim(), negativePrompt: candidate.negativePrompt.trim(), continuityRefs: refs, protectedAreas: structuredClone(candidate.protectedAreas), narrativeReviewRevision: panel.narrativeReviewRevision === panel.revision ? nextRevision : panel.narrativeReviewRevision, visualReviewRevision: null, visualReviewBasis: null, visualReviewedAt: null, status: 'draft', revision: nextRevision, updatedAt: Date.now() }
    await db.comicPanels.put(next); return next
  })
}

export async function adoptComicImageRequestV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; candidate: ComicImageRequestCandidateV1 }): Promise<ComicPanel> {
  return applyImageRequest(input.scope, input.expectedAdaptationRevision, input.candidate)
}

export async function adoptComicRepairRequestV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; candidate: ComicRepairRequestCandidateV1 }): Promise<ComicPanel> {
  assertComicRepairRequestCandidateV1(input.candidate)
  const { root } = await requireRoot(input.scope, input.expectedAdaptationRevision); const issues = await db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals([root.id, root.activeSourceManifestVersion]).toArray()
  if (input.candidate.issueKeys.some(key => !issues.some(issue => issue.stableKey === key && issue.status === 'open' && issue.panelKey === input.candidate.panelKey))) throw new Error('[comic-production] 修复请求包含不存在、非开放或跨格问题')
  if (input.candidate.repairMode !== 'full-regenerate') throw new Error('[comic-production] 当前图片 provider 未登记 image edit/inpainting；只能显式降级为 full-regenerate')
  return applyImageRequest(input.scope, input.expectedAdaptationRevision, input.candidate)
}

export async function adoptComicReviewIssuesV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; sourceManifestVersion: number; reviewKind: 'page' | 'visual'; targetPageKeys: string[]; expectedPanelRevisions: Record<string, number>; candidates: ComicReviewIssueCandidateV1[]; visualInspectionConfirmed?: boolean }): Promise<ComicReviewIssueV1[]> {
  assertComicCandidateBatchV1(input.candidates, assertComicReviewIssueCandidateV1, 'review issue', 2_000, true)
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.comicPages, db.comicPanels, db.comicVisualSubjects, db.comicMediaAssets, db.comicReviewIssues), async () => {
    assertRootCas(await db.adaptationProjects.get(root.id), root); const key = [root.id, input.sourceManifestVersion] as [number, number]
    const [pages, subjects, assets] = await Promise.all([db.comicPages.where('adaptationProjectId').equals(root.id).toArray(), db.comicVisualSubjects.where('adaptationProjectId').equals(root.id).toArray(), db.comicMediaAssets.where('adaptationProjectId').equals(root.id).toArray()])
    const targetPages = pages.filter(page => input.targetPageKeys.includes(page.stableKey)); if (targetPages.length !== new Set(input.targetPageKeys).size) throw new Error('[comic-production] 审查页面不存在')
    const targetIds = targetPages.map(page => page.id!); const panels = targetIds.length ? await db.comicPanels.where('pageId').anyOf(targetIds).toArray() : []
    if (panels.some(panel => input.expectedPanelRevisions[panel.stableKey] !== panel.revision)) throw new Error('[comic-production] 审查目标格已变化')
    if (input.reviewKind === 'visual' && (!input.visualInspectionConfirmed || panels.some(panel => !panel.selectedMediaAssetKey))) throw new Error('[comic-production] 视觉审查必须由作者确认已查看目标页全部实际成图')
    const pageKeys = new Set(targetPages.map(row => row.stableKey)); const panelByKey = new Map(panels.map(row => [row.stableKey, row])); const subjectKeys = new Set(subjects.map(row => row.stableKey)); const assetKeys = new Set(assets.map(row => row.stableKey))
    const now = Date.now(); const rows = input.candidates.map(candidate => {
      const panel = candidate.panelKey ? panelByKey.get(candidate.panelKey) : null
      if (!pageKeys.has(candidate.pageKey) || (candidate.panelKey && !panel) || (candidate.subjectKey && !subjectKeys.has(candidate.subjectKey)) || (candidate.assetKey && !assetKeys.has(candidate.assetKey))) throw new Error(`[comic-production] issue ${candidate.stableKey} 定位越界`)
      if (input.reviewKind === 'page' && !['narrative', 'reading-order', 'lettering'].includes(candidate.category)) throw new Error('[comic-production] page review 不能写视觉类问题')
      if (input.reviewKind === 'visual' && !['continuity', 'rights', 'media-integrity'].includes(candidate.category)) throw new Error('[comic-production] visual review 不能写叙事类问题')
      return stampNewRecord(scope, 'comicReviewIssues', { ...structuredClone(candidate), projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id, manifestVersion: input.sourceManifestVersion, reviewedPanelRevision: panel?.revision ?? null, status: 'open' as const, createdAt: now, updatedAt: now }, { owner: 'work' }) as ComicReviewIssueV1
    })
    const categories = input.reviewKind === 'page' ? ['narrative', 'reading-order', 'lettering'] : ['continuity', 'rights', 'media-integrity']
    await db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).filter(issue => categories.includes(issue.category) && pageKeys.has(issue.pageKey)).delete()
    if (rows.length) await db.comicReviewIssues.bulkAdd(rows)
    await db.comicPanels.bulkPut(panels.map(panel => ({ ...panel, [input.reviewKind === 'page' ? 'narrativeReviewRevision' : 'visualReviewRevision']: panel.revision, ...(input.reviewKind === 'visual' ? { visualReviewBasis: 'author-visual' as const, visualReviewedAt: now } : {}), status: input.reviewKind === 'page' ? 'reviewed' as const : panel.status, updatedAt: now })))
    if (input.reviewKind === 'page') await db.comicPages.bulkPut(targetPages.map(page => ({ ...page, status: 'reviewed' as const, revision: page.revision + 1, updatedAt: now })))
    await db.adaptationProjects.update(root.id, { status: 'review', revision: root.revision + 1, updatedAt: now })
    return db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).toArray()
  })
}

export async function updateComicReviewIssueStatusV1(input: { scope: WorkspaceScope; issueId: number; status: 'resolved' | 'dismissed' }): Promise<ComicReviewIssueV1> {
  const { scope, root } = await requireRoot(input.scope)
  const issue = await db.comicReviewIssues.get(input.issueId)
  if (!issue || issue.workId !== scope.workId || issue.adaptationProjectId !== root.id || issue.status !== 'open') throw new Error('[comic-production] 审查问题不存在、越界或已处理')
  const next = { ...issue, status: input.status, updatedAt: Date.now() }; await db.comicReviewIssues.put(next); return next
}
