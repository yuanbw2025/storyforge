import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { parseAndVerifyCreationReleaseManifestV1 } from '../creation-release/contracts'
import { db } from '../db/schema'
import { readVerifiedMediaBlobV1 } from '../media/blob-store'
import type { ComicMediaAsset, ComicReleaseManifestV1, ComicReleaseTierV1, CreationReleaseAssetV1, CreationReleaseV1, WorkspaceScope } from '../types'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { inspectComicQualityV1 } from './qa'
import { assertComicReleaseManifestV1 } from './release-contracts'

function omitSystem<T extends Record<string, any>>(row: T): Record<string, any> {
  const { id: _id, projectId: _projectId, worldId: _worldId, workId: _workId, adaptationProjectId: _adaptationProjectId, pageId: _pageId, createdAt: _createdAt, updatedAt: _updatedAt, ...portable } = row
  return structuredClone(portable)
}

export async function publishComicReleaseV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; tier: ComicReleaseTierV1; label?: string }): Promise<CreationReleaseV1 & { id: number }> {
  const scope = await resolveScope({ scope: input.scope })
  const [root, work, report] = await Promise.all([db.adaptationProjects.where('workId').equals(scope.workId).first(), db.works.get(scope.workId), inspectComicQualityV1(scope)])
  if (!root?.id || root.medium !== 'comic' || !work || root.projectId !== scope.projectId || root.worldId !== scope.worldId) throw new Error('[comic-release] 漫画改编不存在或越界')
  if (root.revision !== input.expectedAdaptationRevision) throw new Error('[comic-release] 改编根已变化，请刷新')
  const blockers = input.tier === 'visual' ? report.visualBlockers : report.storyboardBlockers
  if (blockers.length) throw new Error(`[comic-release] 尚未达到 ${input.tier} 发布条件：${blockers.join('；')}`)
  if (!root.brief || !root.visualBible) throw new Error('[comic-release] 缺少已确认 Brief 或视觉圣经')
  const key = [root.id, root.activeSourceManifestVersion] as [number, number]
  const [sourceUnits, facts, causalEdges, decisions, scriptBeats, pagePlans, pages, subjects, issues, allAssets, latest] = await Promise.all([
    db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'), db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey'), db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey'), db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey'),
    db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'), db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'), db.comicPages.where('adaptationProjectId').equals(root.id).sortBy('order'), db.comicVisualSubjects.where('adaptationProjectId').equals(root.id).sortBy('stableKey'), db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('createdAt'), db.comicMediaAssets.where('adaptationProjectId').equals(root.id).toArray(),
    db.creationReleases.where('[workId+productKind+version]').between([scope.workId, 'comic', 0], [scope.workId, 'comic', Number.MAX_SAFE_INTEGER]).last(),
  ])
  const pageIds = pages.flatMap(page => page.id == null ? [] : [page.id]); const panels = pageIds.length ? await db.comicPanels.where('pageId').anyOf(pageIds).toArray() : []
  const unitKeyById = new Map(sourceUnits.flatMap(unit => unit.id == null ? [] : [[unit.id, unit.sourceUnitKey] as const])); const pageById = new Map(pages.flatMap(page => page.id == null ? [] : [[page.id, page] as const])); const assetByKey = new Map(allAssets.map(asset => [asset.stableKey, asset]))
  const selectedPanelAssets = input.tier === 'visual' ? panels.map(panel => assetByKey.get(panel.selectedMediaAssetKey ?? '')).filter(Boolean) as ComicMediaAsset[] : []
  const selectedSubjectAssets = input.tier === 'visual' ? subjects.map(subject => assetByKey.get(subject.selectedMediaAssetKey ?? '')).filter(Boolean) as ComicMediaAsset[] : []
  const referencedAssets = input.tier === 'visual' ? selectedPanelAssets.flatMap(asset => asset.referenceAssetKeys.map(key => assetByKey.get(key)).filter(Boolean) as ComicMediaAsset[]) : []
  const frozenAssets = [...new Map([...selectedPanelAssets, ...selectedSubjectAssets, ...referencedAssets].map(asset => [asset.stableKey, asset])).values()]
  const blobByAsset = new Map<string, Awaited<ReturnType<typeof readVerifiedMediaBlobV1>>>()
  for (const asset of frozenAssets) blobByAsset.set(asset.stableKey, await readVerifiedMediaBlobV1({ scope, blobObjectId: asset.blobObjectId }))
  const createdAt = Date.now()
  const manifest: ComicReleaseManifestV1 = {
    schema: 'storyforge.comic-release', version: 1, productKind: 'comic', tier: input.tier,
    work: { code: work.code, title: work.title, description: work.description, genres: [...work.genres] },
    adaptation: { revision: root.revision, targetSpec: structuredClone(root.targetSpec), brief: structuredClone(root.brief), sourceManifestVersion: root.activeSourceManifestVersion, sourceManifestHash: root.activeSourceManifestHash },
    sourceUnits: sourceUnits.map(unit => ({ sourceUnitKey: unit.sourceUnitKey, label: unit.label, order: unit.order, contentHash: unit.contentHash, wordCount: unit.wordCount })),
    facts: facts.map(omitSystem), causalEdges: causalEdges.map(omitSystem), decisions: decisions.map(omitSystem), scriptBeats: scriptBeats.map(omitSystem), pagePlans: pagePlans.map(omitSystem),
    pages: pages.map(page => ({ ...omitSystem(page), panels: panels.filter(panel => panel.pageId === page.id).sort((a, b) => a.order - b.order).map(panel => { const portable = omitSystem(panel); const { sourceUnitIds, selectedMediaAssetKey: selected, ...body } = portable; const sourceUnitKeys = sourceUnitIds.map((id: number) => unitKeyById.get(id)).filter(Boolean); if (sourceUnitKeys.length !== sourceUnitIds.length) throw new Error(`[comic-release] 格 ${panel.stableKey} 来源引用无法冻结`); return { ...body, sourceUnitKeys, selectedMediaAssetKey: input.tier === 'visual' ? selected : null } }) })),
    visualBible: structuredClone(root.visualBible),
    visualSubjects: subjects.map(subject => { const portable = omitSystem(subject); const { sourceUnitIds, selectedMediaAssetKey: selected, characterId: _characterId, ...body } = portable; const sourceUnitKeys = sourceUnitIds.map((id: number) => unitKeyById.get(id)).filter(Boolean); if (sourceUnitKeys.length !== sourceUnitIds.length) throw new Error(`[comic-release] Subject ${subject.stableKey} 来源引用无法冻结`); return { ...body, sourceUnitKeys, selectedMediaAssetKey: input.tier === 'visual' ? selected : null } }),
    reviewIssues: issues.map(omitSystem),
    assets: frozenAssets.map(asset => { const blob = blobByAsset.get(asset.stableKey)!; const page = asset.panelId == null ? null : pageById.get(panels.find(panel => panel.id === asset.panelId)?.pageId ?? -1); const panel = asset.panelId == null ? null : panels.find(row => row.id === asset.panelId); return { stableKey: asset.stableKey, role: asset.role, pageKey: page?.stableKey ?? null, panelKey: panel?.stableKey ?? null, subjectKey: asset.subjectKey, contentHash: blob.contentHash, mimeType: blob.mimeType, width: blob.width, height: blob.height, origin: asset.origin, referenceAssetKeys: [...asset.referenceAssetKeys], rights: structuredClone(asset.rights), providerReceipt: structuredClone(asset.providerReceipt) } }),
    verification: { blockers: [], warnings: report.issues.filter(issue => issue.level === 'warning').map(issue => issue.message), reviewedAt: createdAt }, createdAt,
  }
  assertComicReleaseManifestV1(manifest, work.code, root.revision)
  const manifestJson = canonicalStringify(manifest); const contentHash = await hashCanonicalValue(manifest)
  const draftGuard = canonicalStringify({ rootRevision: root.revision, pages: pages.map(row => [row.stableKey, row.revision]), panels: panels.map(row => [row.stableKey, row.revision, row.selectedMediaAssetKey]), subjects: subjects.map(row => [row.stableKey, row.revision, row.selectedMediaAssetKey]), issues: issues.map(row => [row.stableKey, row.status, row.updatedAt]) })
  return db.transaction('rw', scopeTransactionTables(db.adaptationProjects, db.works, db.creationReleases, db.creationReleaseAssets, db.comicPages, db.comicPanels, db.comicVisualSubjects, db.comicReviewIssues, db.comicMediaAssets, db.mediaBlobObjects), async () => {
    const currentRoot = await db.adaptationProjects.get(root.id!); const currentPages = await db.comicPages.where('adaptationProjectId').equals(root.id!).sortBy('order'); const currentPanels = currentPages.length ? await db.comicPanels.where('pageId').anyOf(currentPages.map(row => row.id!)).toArray() : []; const currentSubjects = await db.comicVisualSubjects.where('adaptationProjectId').equals(root.id!).sortBy('stableKey'); const currentIssues = await db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('createdAt')
    const currentGuard = canonicalStringify({ rootRevision: currentRoot?.revision, pages: currentPages.map(row => [row.stableKey, row.revision]), panels: currentPanels.map(row => [row.stableKey, row.revision, row.selectedMediaAssetKey]), subjects: currentSubjects.map(row => [row.stableKey, row.revision, row.selectedMediaAssetKey]), issues: currentIssues.map(row => [row.stableKey, row.status, row.updatedAt]) })
    if (!currentRoot || currentRoot.activeSourceManifestHash !== root.activeSourceManifestHash || currentGuard !== draftGuard) throw new Error('[comic-release] 发布 CAS 失败：漫画产物已变化')
    for (const asset of frozenAssets) { const current = await db.comicMediaAssets.get(asset.id!); const blob = await db.mediaBlobObjects.get(asset.blobObjectId); if (!current || current.disposition !== 'available' || current.stableKey !== asset.stableKey || !blob || blob.disposition !== 'available' || blob.contentHash !== blobByAsset.get(asset.stableKey)!.contentHash) throw new Error('[comic-release] 发布 CAS 失败：媒资或 Blob 已变化') }
    const version = (latest?.version ?? 0) + 1; const row: CreationReleaseV1 = { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, productKind: 'comic', version, label: input.label?.trim() || `${work.title} ${input.tier === 'visual' ? '视觉版' : '分镜版'} v${version}`, parentReleaseId: latest?.id ?? null, sourceRevision: root.revision, manifestJson, contentHash, createdAt }
    const id = await db.creationReleases.add(row) as number
    if (input.tier === 'visual') { const pins: CreationReleaseAssetV1[] = frozenAssets.map(asset => stampNewRecord(scope, 'creationReleaseAssets', { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, releaseId: id, assetKey: asset.stableKey, role: asset.role, pageKey: manifest.assets.find(row => row.stableKey === asset.stableKey)?.pageKey as string | null, panelKey: manifest.assets.find(row => row.stableKey === asset.stableKey)?.panelKey as string | null, blobObjectId: asset.blobObjectId, contentHash: blobByAsset.get(asset.stableKey)!.contentHash, referenceAssetKeys: [...asset.referenceAssetKeys], createdAt }, { owner: 'work' }) as CreationReleaseAssetV1); await db.creationReleaseAssets.bulkAdd(pins) }
    await db.adaptationProjects.update(root.id!, { status: 'complete', revision: root.revision + 1, updatedAt: createdAt }); await db.works.update(work.id!, { status: 'completed', updatedAt: createdAt }); return { ...row, id }
  })
}

export async function listComicReleasesV1(scopeInput: WorkspaceScope): Promise<CreationReleaseV1[]> { const scope = await resolveScope({ scope: scopeInput }); return db.creationReleases.where('[workId+productKind+version]').between([scope.workId, 'comic', 0], [scope.workId, 'comic', Number.MAX_SAFE_INTEGER]).sortBy('version') }
export async function readComicReleaseManifestV1(scopeInput: WorkspaceScope, releaseId: number): Promise<ComicReleaseManifestV1> { const scope = await resolveScope({ scope: scopeInput }); const [release, work] = await Promise.all([db.creationReleases.get(releaseId), db.works.get(scope.workId)]); if (!release || release.productKind !== 'comic' || release.projectId !== scope.projectId || release.worldId !== scope.worldId || release.workId !== scope.workId || !work) throw new Error('[comic-release] Release 不存在或越界'); const manifest = await parseAndVerifyCreationReleaseManifestV1(release, work.code); assertComicReleaseManifestV1(manifest, work.code, release.sourceRevision); return manifest }
