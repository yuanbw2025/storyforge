import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createAdaptation, listActiveSourceUnits, saveAdaptationBriefDraft, confirmAdaptationBrief,
  saveAdaptationPlanDraft, confirmAdaptationPlan, confirmComicVisualBible, startAdaptationProduction } from '../../src/lib/adaptation/source-manifest'
import { createComicPage, saveComicVisualSubject } from '../../src/lib/comic/service'
import { adoptComicReviewIssuesV1 } from '../../src/lib/comic/production'
import { commitUploadedComicAssetV1, selectComicMediaAssetV1 } from '../../src/lib/comic/media-service'
import { adopt } from '../../src/lib/registry/adopt'
import { readOwnedRows, stampNewRecord } from '../../src/lib/workspace/scope'
import type { AdaptationBriefV1, AdaptationPlanV1, Chapter, ComicTargetSpecV1, ComicVisualBibleCandidateV1, ComicVisualSubjectDesignV1, Geography, Location, MediaRightsV1, WorkCharacterBinding } from '../../src/lib/types'

const targetSpec: ComicTargetSpecV1 = {
  format: 'page-comic', audience: '青少年及以上', readingDirection: 'ltr', chapterCount: 1,
  targetPagesPerChapter: 1, pageSize: { width: 1200, height: 1700, unit: 'px', bleed: 0 },
  colorMode: 'color', artStyleBrief: '冷蓝电影感', renderCandidatesPerPanel: 2,
  imageCapabilityRequirement: { referenceImage: false, deterministicSeed: false, inpainting: false,
    commercialUseRequired: false, minimumWidth: 512, minimumHeight: 512 },
}
const design: ComicVisualSubjectDesignV1 = {
  description: '短发、深色风衣', silhouette: '窄肩', facialFeatures: '直眉', hairAndCostume: '黑色短发、长风衣',
  palette: ['冷蓝'], materials: ['呢料'], distinguishingMarks: ['银色票夹'], prohibitedChanges: ['发型'],
}

export async function createSfqa043ComicFixtureV1() {
  const source = await createWorkspace({ name: 'SFQA043小说来源', genres: ['other'], status: 'drafting',
    description: '旧站抉择', targetWordCount: 10_000, enableMultiWorld: false }, { kind: 'novel', novelProfile: 'short' })
  const chapter = (await readOwnedRows<Chapter>(source.scope, 'chapters', { owner: 'work' }))[0]
  if (chapter?.id == null) throw new Error('missing real novel chapter')
  await db.chapters.update(chapter.id, { content: '<p>林岚走进旧车站，决定在黎明前留下。</p>', summary: '旧站抉择', updatedAt: Date.now() })
  const createdCharacter = await adopt({ projectId: source.scope.projectId, scope: source.scope,
    target: 'characters', mode: 'add', data: { name: '林岚', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral' } })
  const characterId = createdCharacter.written[0]?.id
  if (characterId == null) throw new Error(`registered character creation failed: ${JSON.stringify(createdCharacter)}`)
  const location: Location = { id: `station-location-${source.scope.worldId}`, name: '旧车站', type: 'building', description: '旧站候车室',
    significance: '抉择的场所', parentId: null, order: 0 }
  const geographyId = await db.geographies.add(stampNewRecord<Geography>(source.scope, 'geographies', {
    projectId: source.scope.projectId, overview: '车站周边', locations: JSON.stringify([location]),
    createdAt: Date.now(), updatedAt: Date.now(),
  }, { owner: 'world' }))
  const created = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId,
    title: 'SFQA043漫画', sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec })
  const unit = (await listActiveSourceUnits(created.adaptation.id!)).find(row => row.sourceKind === 'chapter')
  if (unit?.id == null) throw new Error('missing frozen chapter source unit')
  const now = Date.now()
  const binding = stampNewRecord<WorkCharacterBinding>(created.scope, 'workCharacterBindings', {
    projectId: created.scope.projectId, workId: created.scope.workId, characterId, createdAt: now, updatedAt: now,
  }, { owner: 'work' })
  const bindingId = await db.workCharacterBindings.add(binding)
  const subject = await saveComicVisualSubject({ scope: created.scope, draft: {
    stableKey: 'hero', kind: 'character', characterId, locationRefKey: null, label: '林岚',
    sourceUnitIds: [unit.id], design: structuredClone(design), status: 'reviewed',
  } })
  const candidate: ComicVisualBibleCandidateV1 = {
    global: { version: 1, artDirection: '冷蓝电影感', linework: '墨线', palette: ['冷蓝'],
      lighting: '逆光', periodAndMaterials: '当代旧车站', cameraLanguage: ['建立镜头'], prohibitedDepictions: ['水印'] },
    subjects: [{ stableKey: 'hero', kind: 'character', label: '林岚',
      design: { ...structuredClone(design), description: '专业更新后的短发与深色风衣' }, sourceUnitKeys: [unit.sourceUnitKey] }],
  }
  return { ...created, source, unit, characterId, bindingId, subject, candidate, geographyId, location }
}

export async function addSfqa043MediaAndPageV1(f: Awaited<ReturnType<typeof createSfqa043ComicFixtureV1>>) {
  const brief: AdaptationBriefV1 = { version: 1, coreTheme: '选择与代价', dominantEmotion: '克制', mustKeep: ['旧站抉择'],
    mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [], audience: '青少年及以上', rating: 'PG-13', targetScale: '一页',
    narrativePerspective: '林岚', timeBudget: '', costLimit: '', deviationNotes: '', unresolvedQuestions: [], assumptions: [] }
  const plan: AdaptationPlanV1 = { version: 1, premise: '林岚决定留下', sections: [{ stableKey: 'chapter-one', title: '旧站',
    summary: '旧站抉择', order: 0, episodeNumber: 1, sourceUnitKeys: [f.unit.sourceUnitKey] }], globalAssumptions: [] }
  let root = await db.adaptationProjects.get(f.adaptation.id!)
  if (!root?.id) throw new Error('missing adaptation root')
  root = await saveAdaptationBriefDraft({ adaptationProjectId: root.id, expectedRevision: root.revision, brief })
  root = await confirmAdaptationBrief({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  root = await saveAdaptationPlanDraft({ adaptationProjectId: root.id!, expectedRevision: root.revision, plan })
  root = await confirmAdaptationPlan({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  root = await confirmComicVisualBible({ adaptationProjectId: root.id!, expectedRevision: root.revision, visualBible: f.candidate.global })
  root = await startAdaptationProduction({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  const page = await createComicPage(f.scope, { stableKey: 'sfqa043-page', chapterNumber: 1, summary: '林岚在站台停下。', panels: [{
    stableKey: 'sfqa043-panel', frame: { x: 0, y: 0, width: 1, height: 1 },
    shot: { size: 'wide', angle: 'eye-level', movement: 'static', composition: '站台中的人物' },
    action: '林岚停在站台', visualPrompt: 'no text', negativePrompt: 'text, watermark',
    continuityRefs: [{ subjectKey: 'hero', note: '保持风衣轮廓' }], lettering: [], sourceUnitIds: [f.unit.id!],
  }] })
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'), value => value.charCodeAt(0)).buffer
  const rights: MediaRightsV1 = { version: 1, source: 'author-upload', commercialUse: 'allowed', redistribution: 'allowed',
    attribution: '', declaration: '原创合成测试图片，仅验证存储与引用。', declaredAt: Date.now() }
  const subjectAsset = await commitUploadedComicAssetV1({ scope: f.scope, subjectId: f.subject.id!, data: bytes, rights })
  await selectComicMediaAssetV1({ scope: f.scope, assetKey: subjectAsset.stableKey, subjectId: f.subject.id!, expectedRevision: f.subject.revision })
  const panelAsset = await commitUploadedComicAssetV1({ scope: f.scope, panelId: page.panels[0].id!, data: bytes, rights })
  await selectComicMediaAssetV1({ scope: f.scope, assetKey: panelAsset.stableKey, panelId: page.panels[0].id!, expectedRevision: page.panels[0].revision })
  const panel = await db.comicPanels.get(page.panels[0].id!)
  root = await db.adaptationProjects.get(root.id!)
  if (!panel || !root) throw new Error('missing actual selected page')
  await adoptComicReviewIssuesV1({ scope: f.scope, expectedAdaptationRevision: root.revision,
    sourceManifestVersion: root.activeSourceManifestVersion, reviewKind: 'visual', targetPageKeys: [page.page.stableKey],
    expectedPanelRevisions: { [panel.stableKey]: panel.revision }, candidates: [], visualInspectionConfirmed: true })
  return { page: page.page, panelId: panel.id!, subjectAsset, panelAsset }
}
