import { markUnreferencedMediaBlobForDeletionV1, finalizePendingMediaBlobDeletionV1 } from '../media/blob-store'
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
  Character,
  Geography,
  WorkCharacterBinding,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, readOwnedRows, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { assertComicReadingOrderV1, assertComicVisualSubjectV1 } from './contracts'
import { canonicalStringify } from '../agent/run/hash'
import { comicVisualSubjectReviewSignatureV1, invalidateComicVisualReviewsInTransactionV1 } from './service'
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

async function clearReplacedPanels(scope: WorkspaceScope, pages: ComicPage[], garbage: Set<number>): Promise<void> {
  if (pages.some(p => p.status === 'locked')) throw new Error('[comic-production] 请先解锁要重新规划的页面')
  const ids = pages.map(p => p.id!); if (!ids.length) return
  const panels = await db.comicPanels.where('pageId').anyOf(ids).toArray()
  if (panels.some(p => p.status === 'locked')) throw new Error('[comic-production] 请先解锁要重新规划的页格')
  const assets = panels.length ? await db.comicMediaAssets.where('panelId').anyOf(panels.map(p => p.id!)).toArray() : []
  const keys = new Set(assets.map(a => a.stableKey))
  const refs = await db.comicMediaAssets.where('workId').equals(scope.workId).filter(a => a.referenceAssetKeys.some(k => keys.has(k))).toArray()
  await db.comicMediaAssets.bulkPut(refs.map(a => ({...a, referenceAssetKeys:a.referenceAssetKeys.filter(k => !keys.has(k)),updatedAt:Date.now()})))
  for (const asset of assets) garbage.add(asset.blobObjectId)
  await db.comicMediaAssets.bulkDelete(assets.map(a => a.id!))
  await db.comicPanels.bulkDelete(panels.map(p => p.id!))
}
async function sweepReplacedBlobs(scope: WorkspaceScope, garbage: Set<number>): Promise<void> {
  for (const blobObjectId of garbage) {
    const pending = await markUnreferencedMediaBlobForDeletionV1({scope,blobObjectId})
    if (pending?.deleteReceiptHash) await finalizePendingMediaBlobDeletionV1({scope,blobObjectId,receiptHash:pending.deleteReceiptHash})
  }
}

export async function adoptComicScriptBeatsV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; sourceManifestVersion: number; candidates: ComicScriptBeatCandidateV1[]; allowReplaceDownstream?: boolean }): Promise<ComicScriptBeatV1[]> {
  assertComicCandidateBatchV1(input.candidates, assertComicScriptBeatCandidateV1, 'script beat', 1_000)
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  if (root.briefSourceManifestVersion !== input.sourceManifestVersion || root.activeSourceManifestVersion !== input.sourceManifestVersion) throw new Error('[comic-production] 当前来源版本的 Brief 尚未确认')
  const garbage = new Set<number>()
  const result = await db.transaction('rw', scopeTransactionTables(db.comicMediaAssets, db.adaptationProjects, db.adaptationSourceUnits, db.adaptationSourceFacts, db.adaptationDecisions, db.comicScriptBeats, db.comicPagePlans, db.comicPages, db.comicPanels, db.comicReviewIssues), async () => {
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
    await clearReplacedPanels(scope, pages, garbage)
    await Promise.all([db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).delete(), db.comicPages.where('adaptationProjectId').equals(root.id).delete(), db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).delete(), db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).delete()])
    await db.comicScriptBeats.bulkAdd(rows); await db.adaptationProjects.update(root.id, { plan: null, planSourceManifestVersion: null, status: 'planning', revision: root.revision + 1, updatedAt: now })
    return db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order')
  })
  await sweepReplacedBlobs(scope, garbage)
  return result
}

export async function adoptComicPagePlansV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; sourceManifestVersion: number; candidates: ComicPagePlanCandidateV1[]; allowReplaceDownstream?: boolean }): Promise<ComicPagePlanV1[]> {
  assertComicCandidateBatchV1(input.candidates, assertComicPagePlanCandidateV1, 'page plan', 5_000)
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  const expectedPages = root.targetSpec.chapterCount * root.targetSpec.targetPagesPerChapter
  if (input.candidates.length !== expectedPages) throw new Error(`[comic-production] 分页必须覆盖目标 ${expectedPages} 页`)
  const garbage = new Set<number>()
  const result = await db.transaction('rw', scopeTransactionTables(db.comicMediaAssets, db.adaptationProjects, db.comicScriptBeats, db.comicPagePlans, db.comicPages, db.comicPanels, db.comicReviewIssues), async () => {
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
    await clearReplacedPanels(scope, pages, garbage)
    await Promise.all([db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).delete(), db.comicPages.where('adaptationProjectId').equals(root.id).delete(), db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).delete()])
    await db.comicPagePlans.bulkAdd(rows)
    const plan = { version: 1 as const, premise: root.brief?.coreTheme ?? '漫画改编', sections: rows.map(row => ({ stableKey: row.stableKey, title: `第 ${row.pageNumber} 页`, summary: row.goal, order: row.order, episodeNumber: row.chapterNumber, sourceUnitKeys: [...new Set(beats.filter(beat => row.beatKeys.includes(beat.stableKey)).flatMap(beat => beat.sourceUnitKeys))] })), globalAssumptions: root.plan?.globalAssumptions ?? [] }
    await db.adaptationProjects.update(root.id, { plan, planSourceManifestVersion: input.sourceManifestVersion, status: 'planning', revision: root.revision + 1, updatedAt: now })
    return db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order')
  })
  await sweepReplacedBlobs(scope, garbage)
  return result
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
  const garbage = new Set<number>()
  const result = await db.transaction('rw', scopeTransactionTables(db.comicMediaAssets, db.adaptationProjects, db.adaptationSourceUnits, db.comicPagePlans, db.comicPages, db.comicPanels, db.comicReviewIssues), async () => {
    assertRootCas(await db.adaptationProjects.get(root.id), root)
    const key = [root.id, input.sourceManifestVersion] as [number, number]
    const [units, plans, existingPages] = await Promise.all([db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'), db.comicPages.where('adaptationProjectId').equals(root.id).toArray()])
    if (!plans.length || plans.length !== root.targetSpec.chapterCount * root.targetSpec.targetPagesPerChapter) throw new Error('[comic-production] 请先确认完整分页计划')
    if (existingPages.length && !input.allowReplaceExisting) throw new Error('[comic-production] 重做 panel plan 会清除页格、图片候选和审查，必须显式确认')
    const planByKey = new Map(plans.map(row => [row.stableKey, row])); const unitByKey = new Map(units.flatMap(unit => unit.id == null ? [] : [[unit.sourceUnitKey, unit.id] as const]))
    const grouped = new Map<string, ComicPanelPlanCandidateV1[]>(); for (const item of input.candidates) grouped.set(item.pagePlanKey, [...(grouped.get(item.pagePlanKey) ?? []), item])
    if (grouped.size !== plans.length || [...grouped.keys()].some(value => !planByKey.has(value))) throw new Error('[comic-production] panel plan 必须覆盖每个页面')
    const now = Date.now(); await clearReplacedPanels(scope, existingPages, garbage)
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
  await sweepReplacedBlobs(scope, garbage)
  return result
}

export async function adoptComicVisualBibleV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; sourceManifestVersion: number; candidate: ComicVisualBibleCandidateV1; allowReplaceExisting?: boolean }): Promise<void> {
  input = structuredClone(input)
  assertComicVisualBibleCandidateV1(input.candidate)
  const { scope, root } = await requireRoot(input.scope, input.expectedAdaptationRevision); await requireFresh(root)
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.adaptationSourceUnits, db.comicVisualSubjects, db.comicPages, db.comicPanels, db.comicMediaAssets, db.workCharacterBindings, db.characters, db.geographies), async () => {
    assertRootCas(await db.adaptationProjects.get(root.id), root)
    const key = [root.id, input.sourceManifestVersion] as [number, number]
    const [units, existing, workBindings, characters] = await Promise.all([
      db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
      db.comicVisualSubjects.where('adaptationProjectId').equals(root.id).toArray(),
      readOwnedRows<WorkCharacterBinding>(scope, 'workCharacterBindings', { owner: 'work' }),
      readOwnedRows<Character>(scope, 'characters', { owner: 'world' }),
    ])
    const characterIds = new Set(characters.flatMap(character => character.id == null ? [] : [character.id]))
    const bindings = workBindings.filter(binding => characterIds.has(binding.characterId))
    const locationRefKeys = new Set<string>(existing.some(subject => subject.locationRefKey)
      ? (await readOwnedRows<Geography>(scope, 'geographies', { owner: 'world' })).flatMap(geography => {
        let locations: unknown
        try { locations = JSON.parse(geography.locations) }
        catch { throw new Error('[comic-production] 地点原始数据无法解析，请先核查绑定来源') }
        if (!Array.isArray(locations)) throw new Error('[comic-production] 地点来源不是有效列表')
        return locations.flatMap((location: unknown) => location && typeof location === 'object'
          && 'id' in location && typeof location.id === 'string' ? [location.id] : [])
      }) : [])
    const owned = await Promise.all([
      ...units.map(row => assertRecordInScope(scope, 'adaptationSourceUnits', row, { owner: 'work' })),
      ...existing.map(row => assertRecordInScope(scope, 'comicVisualSubjects', row, { owner: 'work' })),
    ])
    if (owned.some(value => !value)) throw new Error('[comic-production] 视觉主体或来源越过目标 Work')
    // Validate retained references before a candidate can change the kind or
    // clear an invalid reference. Unbound professional subjects stay allowed.
    for (const previous of existing) {
      if (previous.characterId != null && !bindings.some(binding => binding.characterId === previous.characterId)) throw new Error('[comic-production] 已有角色绑定已失效或越过目标 Work/World')
      if (previous.locationRefKey && !locationRefKeys.has(previous.locationRefKey)) throw new Error('[comic-production] 已有地点绑定已失效或越过目标 World')
    }
    if (existing.length && !input.allowReplaceExisting) throw new Error('[comic-production] 重做视觉圣经会清除视觉条目，必须显式确认')
    const existingAssets = await db.comicMediaAssets.where('adaptationProjectId').equals(root.id).toArray()
    if ((await Promise.all(existingAssets.map(asset => assertRecordInScope(scope, 'comicMediaAssets', asset, { owner: 'work' })))).some(value => !value)) throw new Error('[comic-production] 参考媒资越过目标 Work')
    for (const previous of existing) {
      if (previous.selectedMediaAssetKey && !existingAssets.some(asset => asset.stableKey === previous.selectedMediaAssetKey && asset.subjectKey === previous.stableKey)) throw new Error('[comic-production] 已选参考媒资已失效或不属于原主体')
    }
    const nextKeys = new Set(input.candidate.subjects.map(s => s.stableKey))
    if (existingAssets.some(a => a.subjectKey && !nextKeys.has(a.subjectKey))) throw new Error('[comic-production] 移除视觉主体前请先在参考图页面清理其媒资')
    if (existing.some(s => s.status === 'locked')) throw new Error('[comic-production] 请先解锁视觉主体')
    const unitByKey = new Map(units.flatMap(unit => unit.id == null ? [] : [[unit.sourceUnitKey, unit.id] as const])); const now = Date.now()
    const subjects: ComicVisualSubject[] = input.candidate.subjects.map(candidate => {
      const row = stampNewRecord(scope, 'comicVisualSubjects', { projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id, stableKey: candidate.stableKey, kind: candidate.kind, characterId: null, locationRefKey: null, label: candidate.label, design: structuredClone(candidate.design), sourceUnitIds: candidate.sourceUnitKeys.map(key => { const id = unitByKey.get(key); if (!id) throw new Error(`[comic-production] visual subject ${candidate.stableKey} 来源越界`); return id }), sourceReviewManifestVersion: input.sourceManifestVersion, selectedMediaAssetKey: null, status: 'reviewed', revision: 1, createdAt: now, updatedAt: now }, { owner: 'work' }) as ComicVisualSubject
      const previous = existing.find(s => s.stableKey === row.stableKey)
      if(previous && previous.kind !== row.kind && existingAssets.some(a=>a.subjectKey===row.stableKey)) throw new Error('[comic-production] 修改主体类型前请先清理其参考图')
      if (previous) Object.assign(row, {id:previous.id, characterId:row.kind==='character'?previous.characterId:null,locationRefKey:row.kind==='location'?previous.locationRefKey:null, selectedMediaAssetKey:previous.selectedMediaAssetKey, revision:previous.revision+1, createdAt:previous.createdAt})
      assertComicVisualSubjectV1({ subject: row, adaptation: root, sourceUnitIds: new Set(unitByKey.values()), bindings, locationRefKeys,
        allowMissingExternalRef: row.kind === 'character' ? row.characterId == null : row.kind === 'location' ? !row.locationRefKey : false }); return row
    })
    const panelRefs = await db.comicPanels.where('workId').equals(scope.workId).toArray(); const subjectKeys = new Set(subjects.map(row => row.stableKey))
    if (panelRefs.some(panel => [...(panel.continuityRefs ?? []), ...(panel.subjectStates ?? [])].some(ref => !subjectKeys.has(ref.subjectKey)))) throw new Error('[comic-production] 视觉圣经没有覆盖 panel 引用的 subject key')
    const changedSubjectKeys = new Set(subjects.filter(subject => {
      const previous = existing.find(row => row.stableKey === subject.stableKey)
      return !previous || comicVisualSubjectReviewSignatureV1(previous) !== comicVisualSubjectReviewSignatureV1(subject)
    }).map(subject => subject.stableKey))
    await invalidateComicVisualReviewsInTransactionV1({ scope, adaptationProjectId: root.id, changedSubjectKeys,
      allPanels: canonicalStringify(root.visualBible) !== canonicalStringify(input.candidate.global)
        || root.visualBibleSourceManifestVersion !== input.sourceManifestVersion })
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
      if (!pageKeys.has(candidate.pageKey)) throw new Error(`[comic-production] issue ${candidate.stableKey} pageKey 越界：${candidate.pageKey}；允许 ${[...pageKeys].join('、')}`)
      if (candidate.panelKey && !panel) throw new Error(`[comic-production] issue ${candidate.stableKey} panelKey 越界：${candidate.panelKey}；允许 ${[...panelByKey.keys()].join('、')}`)
      if (candidate.subjectKey && !subjectKeys.has(candidate.subjectKey)) throw new Error(`[comic-production] issue ${candidate.stableKey} subjectKey 越界：${candidate.subjectKey}`)
      if (candidate.assetKey && !assetKeys.has(candidate.assetKey)) throw new Error(`[comic-production] issue ${candidate.stableKey} assetKey 越界：${candidate.assetKey}`)
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
