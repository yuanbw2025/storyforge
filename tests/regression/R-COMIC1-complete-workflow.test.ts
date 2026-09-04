import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import {
  confirmAdaptationBrief,
  confirmAdaptationPlan,
  confirmComicVisualBible,
  createAdaptation,
  listActiveSourceUnits,
  saveAdaptationBriefDraft,
  saveAdaptationPlanDraft,
  startAdaptationProduction,
} from '../../src/lib/adaptation/source-manifest'
import type { AdaptationBriefV1, AdaptationPlanV1, ComicTargetSpecV1, MediaRightsV1 } from '../../src/lib/types'
import {
  createComicPage,
  listComicPages,
  mergeComicPanelsV1,
  moveComicPanelV1,
  saveComicVisualSubject,
  splitComicPanelV1,
  updateComicPage,
  updateComicPanel,
} from '../../src/lib/comic/service'
import {
  commitUploadedComicAssetV1,
  generateComicPanelCandidatesV1,
  readComicAssetDataUrlV1,
  removeComicMediaAssetV1,
  selectComicMediaAssetV1,
} from '../../src/lib/comic/media-service'
import { generateAdaptationCandidateV1, adoptAdaptationCandidateV1 } from '../../src/lib/agent/run/adaptation-durable'
import type { ComicPageCandidateV1 } from '../../src/lib/comic/adoption'
import { renderComicPageSvgV1 } from '../../src/lib/comic/renderers'
import { inspectComicQualityV1 } from '../../src/lib/comic/qa'
import { completeAdaptationProductionV1, reopenAdaptationProductionV1 } from '../../src/lib/adaptation/completion'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

const targetSpec: ComicTargetSpecV1 = {
  format: 'page-comic', audience: '大众', readingDirection: 'rtl', chapterCount: 3, targetPagesPerChapter: 20,
  pageSize: { width: 1200, height: 1700, unit: 'px', bleed: 30 }, colorMode: 'color', artStyleBrief: '克制的黑色电影漫画', renderCandidatesPerPanel: 2,
  imageCapabilityRequirement: { referenceImage: false, deterministicSeed: false, inpainting: false, commercialUseRequired: false, minimumWidth: 1024, minimumHeight: 1024 },
}
const brief: AdaptationBriefV1 = {
  version: 1, coreTheme: '选择与代价', dominantEmotion: '克制', mustKeep: ['车站结局'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [],
  audience: '大众', rating: 'PG-13', targetScale: '三章页漫', narrativePerspective: '林岚', timeBudget: '', costLimit: '', deviationNotes: '', unresolvedQuestions: [], assumptions: [],
}
const EMPTY_DESIGN = { description: '', silhouette: '', facialFeatures: '', hairAndCostume: '', palette: [] as string[], materials: [] as string[], distinguishingMarks: [] as string[], prohibitedChanges: [] as string[] }

function pngBytes(width = 1024, height = 1536): ArrayBuffer {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height)
  return bytes.buffer
}

function base64(data: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(data)))
}

function rights(source: MediaRightsV1['source']): MediaRightsV1 {
  return { version: 1, source, commercialUse: 'allowed', redistribution: 'allowed', attribution: '', declaration: '测试作者确认拥有测试图片权利。', declaredAt: Date.now() }
}

async function fixture() {
  const source = await createWorkspace({ name: '漫画来源', genres: ['other'], status: 'drafting', description: '暴雨旧站', targetWordCount: 10_000, enableMultiWorld: false }, { kind: 'novel', novelProfile: 'short' })
  const chapter = await db.chapters.where('projectId').equals(source.scope.projectId).filter(row => row.workId === source.scope.workId).first()
  await db.chapters.update(chapter!.id!, { content: '<p>暴雨中，林岚走进旧车站，末班车迟迟未到。</p>', summary: '进入旧站', updatedAt: Date.now() })
  const created = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '旧站漫画', sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec })
  const unit = (await listActiveSourceUnits(created.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
  const plan: AdaptationPlanV1 = { version: 1, premise: '林岚必须在黎明前作出选择。', sections: [{ stableKey: 'chapter-1', title: '旧站', summary: '进入困局', order: 0, episodeNumber: 1, sourceUnitKeys: [unit.sourceUnitKey] }], globalAssumptions: [] }
  let root = await saveAdaptationBriefDraft({ adaptationProjectId: created.adaptation.id!, brief, expectedRevision: 1 })
  root = await confirmAdaptationBrief({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  root = await saveAdaptationPlanDraft({ adaptationProjectId: root.id!, plan, expectedRevision: root.revision })
  root = await confirmAdaptationPlan({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  root = await confirmComicVisualBible({ adaptationProjectId: root.id!, expectedRevision: root.revision, visualBible: { version: 1, artDirection: '黑色电影', linework: '有重量的墨线', palette: ['炭黑', '冷蓝'], lighting: '高反差', periodAndMaterials: '当代旧车站', cameraLanguage: ['建立镜头后切近景'], prohibitedDepictions: ['无文字成图'] } })
  root = await startAdaptationProduction({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  return { ...created, source, root, unit }
}

function pageDraft(unitId: number, key = 'page-1') {
  return {
    stableKey: key, chapterNumber: 1, summary: '林岚进入旧站。', panels: [
      { stableKey: `${key}-panel-1`, frame: { x: 0, y: 0, width: 1, height: .49 }, shot: { size: 'wide' as const, angle: 'eye-level' as const, movement: 'static' as const, composition: '车站全景' }, action: '林岚走进候车室。', visualPrompt: 'old station, no text', negativePrompt: 'text, watermark', continuityRefs: [], lettering: [], sourceUnitIds: [unitId] },
      { stableKey: `${key}-panel-2`, frame: { x: 0, y: .51, width: 1, height: .49 }, shot: { size: 'close-up' as const, angle: 'eye-level' as const, movement: 'static' as const, composition: '眼神近景' }, action: '她看向停摆的时钟。', visualPrompt: 'clock close-up, no text', negativePrompt: 'text, watermark', continuityRefs: [], lettering: [], sourceUnitIds: [unitId] },
    ],
  }
}

describe('COMIC-1/2 · complete comic production workflow', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); db.close() })

  it('页格创建原子校验重叠，并支持拆格、合格与跨页移动', async () => {
    const item = await fixture()
    const first = await createComicPage(item.scope, pageDraft(item.unit.id!))
    const before = await db.comicPages.count()
    const invalid = pageDraft(item.unit.id!, 'overlap')
    invalid.panels[1].frame = { x: 0, y: .2, width: 1, height: .5 }
    await expect(createComicPage(item.scope, invalid)).rejects.toThrow('重叠')
    expect(await db.comicPages.count()).toBe(before)
    expect(await db.comicPanels.where('workId').equals(item.scope.workId).count()).toBe(2)

    const split = await splitComicPanelV1({ scope: item.scope, panelId: first.panels[0].id!, expectedRevision: 1, direction: 'vertical' })
    expect(split).toHaveLength(3)
    const merged = await mergeComicPanelsV1({ scope: item.scope, firstPanelId: split[0].id!, secondPanelId: split[1].id!, expectedFirstRevision: split[0].revision, expectedSecondRevision: split[1].revision })
    expect(merged.frame.width).toBeCloseTo(1)
    const second = await createComicPage(item.scope, pageDraft(item.unit.id!, 'page-2'))
    const currentFirst = (await listComicPages(item.scope))[0]
    const moved = await moveComicPanelV1({ scope: item.scope, panelId: currentFirst.panels[0].id!, targetPageId: second.page.id!, targetOrder: 2, targetFrame: { x: 0, y: .82, width: 1, height: .18 }, expectedRevision: currentFirst.panels[0].revision })
    expect(moved.pageId).toBe(second.page.id)
    expect((await listComicPages(item.scope)).map(group => group.panels.length)).toEqual([1, 3])
  })

  it('视觉条目验证角色绑定、Geography 地点 key 与来源 manifest', async () => {
    const item = await fixture(); const now = Date.now()
    const characterId = await db.characters.add({
      projectId: item.scope.projectId,
      worldId: item.scope.worldId,
      name: '林岚',
      roleWeight: 'main',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      shortDescription: '',
      appearance: '',
      personality: '',
      background: '',
      motivation: '',
      abilities: '',
      relationships: '',
      arc: '',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await expect(saveComicVisualSubject({ scope: item.scope, draft: { stableKey: 'hero', kind: 'character', characterId, locationRefKey: null, label: '林岚', design: EMPTY_DESIGN, sourceUnitIds: [item.unit.id!], status: 'reviewed' } })).rejects.toThrow('尚未绑定')
    await db.workCharacterBindings.add({ projectId: item.scope.projectId, workId: item.scope.workId, characterId, role: 'protagonist', createdAt: now, updatedAt: now })
    const hero = await saveComicVisualSubject({ scope: item.scope, draft: { stableKey: 'hero', kind: 'character', characterId, locationRefKey: null, label: '林岚', design: { ...EMPTY_DESIGN, description: '短发、深色风衣' }, sourceUnitIds: [item.unit.id!], status: 'reviewed' } })
    expect(hero.characterId).toBe(characterId)
    await db.geographies.add({ projectId: item.scope.projectId, overview: '', locations: JSON.stringify([{ id: 'old-station', name: '旧车站', type: 'building', description: '', significance: '', parentId: null, order: 0 }]), createdAt: now, updatedAt: now })
    const location = await saveComicVisualSubject({ scope: item.scope, draft: { stableKey: 'station', kind: 'location', characterId: null, locationRefKey: 'old-station', label: '旧车站', design: { ...EMPTY_DESIGN, description: '废弃候车室' }, sourceUnitIds: [item.unit.id!], status: 'reviewed' } })
    expect(location.locationRefKey).toBe('old-station')
    await expect(saveComicVisualSubject({ scope: item.scope, draft: { stableKey: 'missing-place', kind: 'location', characterId: null, locationRefKey: 'missing', label: '不存在', design: EMPTY_DESIGN, sourceUnitIds: [item.unit.id!] } })).rejects.toThrow('不可解析')
  })

  it('durable 漫画分镜候选在确认前零写入，formal.written 中断后可幂等恢复', async () => {
    const item = await fixture()
    const candidate: ComicPageCandidateV1[] = [{
      stableKey: 'ai-page-1', chapterNumber: 1, summary: 'AI 分镜页', panels: [{
        stableKey: 'ai-panel-1', frame: { x: 0, y: 0, width: 1, height: 1 }, shot: { size: 'wide', angle: 'eye-level', movement: 'static', composition: '旧站全景' }, action: '林岚走入旧站。', visualPrompt: 'old station, cinematic comic, no text, no bubbles, no watermark', negativePrompt: 'text, letters, watermark', continuityRefs: [], sourceUnitKeys: [item.unit.sourceUnitKey],
        lettering: [{ id: 'caption-1', kind: 'caption', text: '凌晨一点。', frame: { x: .05, y: .05, width: .3, height: .12 }, direction: 'horizontal', fontFamily: 'storyforge-sans', fontSize: 28, textColor: '#111111', fillColor: '#ffffff', strokeColor: '#111111', strokeWidth: 2, tail: null, zIndex: 1 }],
      }],
    }]
    const generated = await generateAdaptationCandidateV1({ scope: item.scope, adaptationProjectId: item.root.id!, artifactKind: 'comic-storyboard', selectedPlanSectionKeys: ['chapter-1'], runAI: async () => JSON.stringify(candidate) })
    expect(await db.comicPages.count()).toBe(0)
    await expect(adoptAdaptationCandidateV1<'comic-storyboard'>({ scope: item.scope, runId: generated.snapshot.run.id, onDurableBoundary: boundary => { if (boundary === 'formal.written') throw new Error('simulated crash') } })).rejects.toThrow('simulated crash')
    expect(await db.comicPages.count()).toBe(1)
    const resumed = await adoptAdaptationCandidateV1<'comic-storyboard'>({ scope: item.scope, runId: generated.snapshot.run.id })
    expect(resumed.snapshot.projection.state).toBe('completed')
    expect(await db.comicPages.count()).toBe(1)
    expect((await db.comicPanels.toArray())[0]).toMatchObject({ sourceUnitIds: [item.unit.id], sourceReviewManifestVersion: 1 })
  })

  it('非法 AI 页格使整批零落库，候选协议拒绝系统字段', async () => {
    const item = await fixture()
    const invalid = pageDraft(item.unit.id!, 'bad') as any
    invalid.panels[0].sourceUnitKeys = [item.unit.sourceUnitKey]; delete invalid.panels[0].sourceUnitIds
    invalid.panels[1].sourceUnitKeys = [item.unit.sourceUnitKey]; delete invalid.panels[1].sourceUnitIds
    invalid.panels[1].frame = { x: 0, y: .2, width: 1, height: .6 }
    const run = await generateAdaptationCandidateV1({ scope: item.scope, adaptationProjectId: item.root.id!, artifactKind: 'comic-storyboard', selectedPlanSectionKeys: ['chapter-1'], runAI: async () => JSON.stringify([invalid]) })
    await expect(adoptAdaptationCandidateV1<'comic-storyboard'>({ scope: item.scope, runId: run.snapshot.run.id })).rejects.toThrow('重叠')
    expect(await db.comicPages.count()).toBe(0)
    await expect(generateAdaptationCandidateV1({ scope: item.scope, adaptationProjectId: item.root.id!, artifactKind: 'comic-storyboard', selectedPlanSectionKeys: ['chapter-1'], runAI: async () => JSON.stringify([{ ...invalid, projectId: 7 }]) })).rejects.toThrow('允许闭集')
  })

  it('provider 失败/低尺寸响应零落库；成功请求幂等、选片与回收闭合', async () => {
    const item = await fixture(); const created = await createComicPage(item.scope, pageDraft(item.unit.id!)); const panel = created.panels[0]
    const aiConfig = { provider: 'openai' as const, baseUrl: 'https://api.example.test/v1', apiKey: 'secret-test-key', model: 'gpt-5-test', temperature: .7, maxTokens: 1000 }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(generateComicPanelCandidatesV1({ scope: item.scope, panelId: panel.id!, expectedPanelRevision: panel.revision, aiConfig, count: 2, rights: rights('provider-generated') })).rejects.toThrow('network down')
    expect(await db.comicMediaAssets.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)

    const low = base64(pngBytes(100, 100))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'low', data: [{ b64_json: low }, { b64_json: low }] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(generateComicPanelCandidatesV1({ scope: item.scope, panelId: panel.id!, expectedPanelRevision: panel.revision, aiConfig, count: 2, rights: rights('provider-generated') })).rejects.toThrow('最小尺寸')
    expect(await db.comicMediaAssets.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)

    const valid = base64(pngBytes())
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'request-1', data: [{ b64_json: valid }, { b64_json: valid }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await generateComicPanelCandidatesV1({ scope: item.scope, panelId: panel.id!, expectedPanelRevision: panel.revision, aiConfig, count: 2, rights: rights('provider-generated') })
    const replay = await generateComicPanelCandidatesV1({ scope: item.scope, panelId: panel.id!, expectedPanelRevision: panel.revision, aiConfig, count: 2, rights: rights('provider-generated') })
    expect(replay.reused).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.assets).toHaveLength(2); expect(await db.mediaBlobObjects.count()).toBe(1)
    const selected = await selectComicMediaAssetV1({ scope: item.scope, assetKey: first.assets[0].stableKey, panelId: panel.id!, expectedRevision: panel.revision })
    expect((selected as any).selectedMediaAssetKey).toBe(first.assets[0].stableKey)
    await removeComicMediaAssetV1({ scope: item.scope, assetKey: first.assets[1].stableKey, clearReferences: true })
    expect(await db.mediaBlobObjects.count()).toBe(1)
    await removeComicMediaAssetV1({ scope: item.scope, assetKey: first.assets[0].stableKey, clearReferences: true })
    expect(await db.mediaBlobObjects.count()).toBe(0)
  })

  it('上传、SVG 排字渲染与 v9 完整备份往返保留选片、rights 和 Blob hash', async () => {
    const item = await fixture(); const created = await createComicPage(item.scope, pageDraft(item.unit.id!)); let panel = created.panels[0]
    panel = await updateComicPanel({ scope: item.scope, panelId: panel.id!, expectedRevision: panel.revision, patch: { lettering: [{ id: 'speech-1', kind: 'speech', text: '你终于来了。', frame: { x: .55, y: .08, width: .35, height: .25 }, direction: 'vertical', fontFamily: 'storyforge-serif', fontSize: 28, textColor: '#111111', fillColor: '#ffffff', strokeColor: '#111111', strokeWidth: 2, tail: { x: .6, y: .6 }, zIndex: 2 }] } })
    const asset = await commitUploadedComicAssetV1({ scope: item.scope, data: pngBytes(), panelId: panel.id!, rights: rights('author-upload') })
    panel = await selectComicMediaAssetV1({ scope: item.scope, assetKey: asset.stableKey, panelId: panel.id!, expectedRevision: panel.revision }) as typeof panel
    const dataUrl = (await readComicAssetDataUrlV1({ scope: item.scope, assetKey: asset.stableKey })).dataUrl
    const svg = renderComicPageSvgV1({ page: created.page, panels: [panel, created.panels[1]], targetSpec, assetDataUrls: { [asset.stableKey]: dataUrl }, mode: 'storyboard' })
    expect(svg).toContain('data-storyforge-comic-page="1"'); expect(svg).toContain('你'); expect(svg).toContain('readingDirection')

    const backup = await exportProjectJSON(item.scope.projectId)
    expect(backup.version).toBe(10); expect(backup.comicMediaAssets?.[0].rights.declaration).toContain('测试作者')
    const cyclic = structuredClone(backup)
    const firstAsset = cyclic.comicMediaAssets![0]
    firstAsset.referenceAssetKeys = ['cycle-copy']
    cyclic.comicMediaAssets!.push({ ...structuredClone(firstAsset), _exportId: 999, stableKey: 'cycle-copy', referenceAssetKeys: [firstAsset.stableKey] })
    await expect(importProjectJSON(cyclic)).rejects.toThrow('形成环')
    const tampered = structuredClone(backup)
    tampered.mediaBlobObjects![0].contentHash = '0'.repeat(64)
    await expect(importProjectJSON(tampered)).rejects.toThrow('哈希')
    const importedId = await importProjectJSON(structuredClone(backup))
    const importedPanel = await db.comicPanels.where('projectId').equals(importedId).filter(row => !!row.selectedMediaAssetKey).first()
    const importedAsset = await db.comicMediaAssets.where('projectId').equals(importedId).first()
    const importedBlob = await db.mediaBlobObjects.where('projectId').equals(importedId).first()
    expect(importedPanel?.selectedMediaAssetKey).toBe(importedAsset?.stableKey)
    expect(importedAsset?.blobObjectId).toBe(importedBlob?.id)
    expect(importedBlob?.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(importedBlob?.data.byteLength).toBe(32)
  })

  it('正式 QA 阻止缺图完稿；全部格选片并审定后可完稿', async () => {
    const item = await fixture(); const created = await createComicPage(item.scope, pageDraft(item.unit.id!))
    expect((await inspectComicQualityV1(item.scope)).canFormalExport).toBe(false)
    for (const initial of created.panels) {
      const asset = await commitUploadedComicAssetV1({ scope: item.scope, data: pngBytes(), panelId: initial.id!, rights: rights('author-upload') })
      let panel = await selectComicMediaAssetV1({ scope: item.scope, assetKey: asset.stableKey, panelId: initial.id!, expectedRevision: initial.revision }) as typeof initial
      panel = await updateComicPanel({ scope: item.scope, panelId: panel.id!, expectedRevision: panel.revision, patch: { status: 'reviewed' } })
      expect(panel.status).toBe('reviewed')
    }
    const page = await updateComicPage({ scope: item.scope, pageId: created.page.id!, expectedRevision: created.page.revision, patch: { status: 'reviewed' } })
    expect((await inspectComicQualityV1(item.scope)).canFormalExport).toBe(true)
    const completed = await completeAdaptationProductionV1({ scope: item.scope, expectedRevision: item.root.revision })
    expect(completed.status).toBe('complete'); expect((await db.works.get(item.scope.workId))?.status).toBe('completed')
    expect(page.status).toBe('reviewed')
    await expect(updateComicPage({ scope: item.scope, pageId: page.id!, expectedRevision: page.revision, patch: { summary: '完稿后静默改写' } })).rejects.toThrow('重新打开审校')
    const reopened = await reopenAdaptationProductionV1({ scope: item.scope, expectedRevision: completed.revision })
    expect(reopened.status).toBe('review'); expect((await db.works.get(item.scope.workId))?.status).toBe('ongoing')
    const revised = await updateComicPage({ scope: item.scope, pageId: page.id!, expectedRevision: page.revision, patch: { summary: '作者重新审校' } })
    expect(revised.summary).toBe('作者重新审校')
  })
})
