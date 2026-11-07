import { deflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adoptAdaptationDecisionsV1, adoptAdaptationSourceFactsV1 } from '../../src/lib/adaptation/analysis'
import { confirmAdaptationBrief, saveAdaptationBriefDraft } from '../../src/lib/adaptation/source-manifest'
import { reopenAdaptationProductionV1 } from '../../src/lib/adaptation/completion'
import * as sourceManifest from '../../src/lib/adaptation/source-manifest'
import { adoptComicPagePlansV1, adoptComicReviewIssuesV1, adoptComicScriptBeatsV1,
  adoptComicVisualBibleV1, createComicPanelScaffoldFromConfirmedPlanV1, startComicProductionV1 } from '../../src/lib/comic/production'
import { commitUploadedComicAssetV1, selectComicMediaAssetV1 } from '../../src/lib/comic/media-service'
import { saveComicVisualSubject, updateComicPanel } from '../../src/lib/comic/service'
import { publishComicReleaseV1, readComicReleaseManifestV1 } from '../../src/lib/comic/release'
import * as qa from '../../src/lib/comic/qa'
import type { AdaptationBriefV1, ComicVisualSubject, MediaRightsV1 } from '../../src/lib/types'
import { createSfqa043ComicFixtureV1 } from '../helpers/sfqa043-comic'
import { installRasterDecoderForVitestV1 } from '../helpers/raster-decoder-vitest'

installRasterDecoderForVitestV1()

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

// A complete PNG with pixels and valid chunk CRCs; no dimension or QA stubs.
function png512(): ArrayBuffer {
  const chunk = (kind: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(kind), data])
    let crc = 0xffffffff
    for (const byte of body) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, body, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(512, 0); header.writeUInt32BE(512, 4)
  header[8] = 8; header[9] = 2
  const pixels = Buffer.alloc((512 * 3 + 1) * 512)
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const offset = y * 1537 + 1 + x * 3
    pixels[offset] = x % 256; pixels[offset + 1] = y % 256; pixels[offset + 2] = 96
  }
  return Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', new Uint8Array())])).buffer
}

type Fixture = Awaited<ReturnType<typeof createSfqa043ComicFixtureV1>>
async function root(f: Fixture) {
  const row = await db.adaptationProjects.get(f.adaptation.id!)
  if (!row?.id) throw new Error('missing actual comic root')
  return row
}
async function review(f: Fixture, kind: 'page' | 'visual') {
  const r = await root(f)
  const pages = await db.comicPages.where('adaptationProjectId').equals(r.id!).toArray()
  const panels = await db.comicPanels.where('pageId').anyOf(pages.map(page => page.id!)).toArray()
  return adoptComicReviewIssuesV1({ scope: f.scope, expectedAdaptationRevision: r.revision,
    sourceManifestVersion: r.activeSourceManifestVersion, reviewKind: kind,
    targetPageKeys: pages.map(page => page.stableKey),
    expectedPanelRevisions: Object.fromEntries(panels.map(panel => [panel.stableKey, panel.revision])),
    candidates: [], visualInspectionConfirmed: kind === 'visual' })
}
async function ready(panelCount = 1) {
  const f = await createSfqa043ComicFixtureV1()
  const brief: AdaptationBriefV1 = { version: 1, coreTheme: '选择与代价', dominantEmotion: '克制',
    mustKeep: ['旧站抉择'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [], audience: '青少年及以上',
    rating: 'PG-13', targetScale: '一页', narrativePerspective: '林岚', timeBudget: '', costLimit: '',
    deviationNotes: '', unresolvedQuestions: [], assumptions: [] }
  let r = await root(f)
  r = await saveAdaptationBriefDraft({ adaptationProjectId: r.id!, expectedRevision: r.revision, brief })
  r = await confirmAdaptationBrief({ adaptationProjectId: r.id!, expectedRevision: r.revision })
  await adoptAdaptationSourceFactsV1({ scope: f.scope, adaptationProjectId: r.id!, expectedAdaptationRevision: r.revision,
    sourceManifestVersion: 1, items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'fact_choice', kind: 'event',
      statement: '林岚在旧站决定留下。', subjectKeys: ['hero'], sourceUnitKeys: [f.unit.sourceUnitKey], confidence: 1 } }] })
  r = await root(f)
  await adoptAdaptationDecisionsV1({ scope: f.scope, adaptationProjectId: r.id!, expectedAdaptationRevision: r.revision,
    sourceManifestVersion: 1, items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'decision_keep', action: 'keep',
      sourceFactKeys: ['fact_choice'], targetKeys: ['beat_choice'], rationale: '保留旧站抉择' } }] })
  r = await root(f)
  await adoptComicScriptBeatsV1({ scope: f.scope, expectedAdaptationRevision: r.revision, sourceManifestVersion: 1,
    candidates: [{ stableKey: 'beat_choice', sectionKey: 'chapter_1', chapterNumber: 1, order: 0,
      narrativeFunction: 'turn', visualAction: '林岚在旧站放下车票。', dialogueIntent: '动作表达', emotion: '坚定',
      causalFactKeys: ['fact_choice'], decisionKeys: ['decision_keep'], sourceUnitKeys: [f.unit.sourceUnitKey], estimatedPanels: 1 }] })
  r = await root(f)
  await adoptComicPagePlansV1({ scope: f.scope, expectedAdaptationRevision: r.revision, sourceManifestVersion: 1,
    candidates: [{ stableKey: 'page_plan_1', chapterNumber: 1, pageNumber: 1, order: 0, goal: '完成抉择',
      beatKeys: ['beat_choice'], endReveal: '放下车票', pageTurn: 'cliffhanger', expectedPanelCount: panelCount, textBudget: 30 }] })
  r = await root(f)
  await adoptComicVisualBibleV1({ scope: f.scope, expectedAdaptationRevision: r.revision, sourceManifestVersion: 1,
    candidate: f.candidate, allowReplaceExisting: true })
  r = await root(f)
  const [page] = await createComicPanelScaffoldFromConfirmedPlanV1({ scope: f.scope,
    expectedAdaptationRevision: r.revision, sourceManifestVersion: 1 })
  r = await root(f)
  await startComicProductionV1({ scope: f.scope, expectedAdaptationRevision: r.revision })
  const rights: MediaRightsV1 = { version: 1, source: 'author-upload', commercialUse: 'allowed', redistribution: 'allowed',
    attribution: '', declaration: '程序合成像素测试图，仅验证工程发布链。', declaredAt: Date.now() }
  const subject = (await db.comicVisualSubjects.get(f.subject.id!))!
  const subjectAsset = await commitUploadedComicAssetV1({ scope: f.scope, subjectId: subject.id!, data: png512(), rights })
  await selectComicMediaAssetV1({ scope: f.scope, assetKey: subjectAsset.stableKey, subjectId: subject.id!, expectedRevision: subject.revision })
  for (const panel of page.panels) {
    const panelAsset = await commitUploadedComicAssetV1({ scope: f.scope, panelId: panel.id!, data: png512(), rights })
    await selectComicMediaAssetV1({ scope: f.scope, assetKey: panelAsset.stableKey, panelId: panel.id!, expectedRevision: panel.revision })
  }
  await review(f, 'page'); await review(f, 'visual')
  const report = await qa.inspectComicQualityV1(f.scope)
  expect(report.visualBlockers).toEqual([])
  expect(report.canVisualRelease).toBe(true)
  return { ...f, page: page.page, panelId: page.panels[0].id!, panelIds: page.panels.map(panel => panel.id!) }
}
async function edit(f: Fixture, patch: Partial<ComicVisualSubject> = {}) {
  const subject = (await db.comicVisualSubjects.get(f.subject.id!))!
  return saveComicVisualSubject({ scope: f.scope, subjectId: subject.id, expectedRevision: subject.revision,
    draft: { ...subject, design: { ...subject.design, hairAndCostume: '短发、浅色雨衣' }, ...patch } })
}
async function state() {
  return { roots: await db.adaptationProjects.toArray(), subjects: await db.comicVisualSubjects.toArray(),
    pages: await db.comicPages.toArray(), panels: await db.comicPanels.toArray(), assets: await db.comicMediaAssets.toArray(),
    blobs: await db.mediaBlobObjects.toArray(), releases: await db.creationReleases.toArray(), pins: await db.creationReleaseAssets.toArray() }
}

describe.sequential('SFQA039 · 手工视觉编辑撤销实际视觉复核并阻止旧结果通过', () => {
  it('完整发布链从可发布变为必须重新验图，媒体与叙事复核保留；作者复核后恢复', async () => {
    const f = await ready()
    const before = await state()
    await edit(f)
    const panel = (await db.comicPanels.get(f.panelId))!
    expect(panel).toMatchObject({ visualReviewRevision: null, visualReviewBasis: null, visualReviewedAt: null,
      selectedMediaAssetKey: before.panels[0].selectedMediaAssetKey,
      narrativeReviewRevision: before.panels[0].narrativeReviewRevision })
    expect((await qa.inspectComicQualityV1(f.scope)).canVisualRelease).toBe(false)
    await expect(publishComicReleaseV1({ scope: f.scope, expectedAdaptationRevision: (await root(f)).revision,
      tier: 'visual' })).rejects.toThrow(/审查|发布条件/)
    expect(await db.comicMediaAssets.toArray()).toEqual(before.assets)
    expect(await db.mediaBlobObjects.toArray()).toEqual(before.blobs)
    await review(f, 'visual')
    expect((await qa.inspectComicQualityV1(f.scope)).canVisualRelease).toBe(true)
    const release = await publishComicReleaseV1({ scope: f.scope, expectedAdaptationRevision: (await root(f)).revision, tier: 'visual' })
    expect(release.id).toBeGreaterThan(0)
  })

  it('subjectStates单独引用也撤销复核，另一个Work的同名主体及页格不变', async () => {
    const f = await ready(); const other = await ready()
    const panel = (await db.comicPanels.get(f.panelId))!
    await updateComicPanel({ scope: f.scope, panelId: panel.id!, expectedRevision: panel.revision,
      patch: { continuityRefs: [], subjectStates: [{ subjectKey: 'hero', costume: '风衣', condition: '', props: [], position: '' }] } })
    await review(f, 'page'); await review(f, 'visual')
    const before = await state()
    await edit(f)
    expect((await db.comicPanels.get(f.panelId))?.visualReviewRevision).toBeNull()
    expect(await db.comicPanels.get(other.panelId)).toEqual(before.panels.find(row => row.id === other.panelId))
    expect(await db.comicVisualSubjects.get(other.subject.id!)).toEqual(before.subjects.find(row => row.id === other.subject.id))
  })

  it('依赖并集中的全部页格失效，不依赖该主体的页格逐字段保留', async () => {
    const f = await ready(3)
    for (const [index, panelId] of f.panelIds.entries()) {
      const panel = (await db.comicPanels.get(panelId))!
      await updateComicPanel({ scope: f.scope, panelId, expectedRevision: panel.revision,
        patch: { continuityRefs: index === 0 ? [{ subjectKey: 'hero', note: '仅连续性引用' }] : [],
          subjectStates: index === 1 ? [{ subjectKey: 'hero', costume: '风衣', condition: '', props: [], position: '' }] : [] } })
    }
    await review(f, 'page'); await review(f, 'visual')
    const before = await db.comicPanels.bulkGet(f.panelIds)
    await edit(f)
    const after = await db.comicPanels.bulkGet(f.panelIds)
    expect(after.slice(0, 2).every(panel => panel?.visualReviewRevision === null)).toBe(true)
    expect(after[2]).toEqual(before[2])
    expect(after.map(panel => panel?.narrativeReviewRevision)).toEqual(before.map(panel => panel?.narrativeReviewRevision))
  })

  it('专业入口仅改显示名称保留复核，真实设计修改使用同一失效规则', async () => {
    const f = await ready()
    const r = await root(f); const subject = (await db.comicVisualSubjects.get(f.subject.id!))!
    const candidate = { global: structuredClone(r.visualBible!), subjects: [{ stableKey: subject.stableKey,
      kind: subject.kind, label: '仅显示名更新', design: structuredClone(subject.design), sourceUnitKeys: [f.unit.sourceUnitKey] }] }
    const before = await db.comicPanels.toArray()
    await adoptComicVisualBibleV1({ scope: f.scope, expectedAdaptationRevision: r.revision,
      sourceManifestVersion: 1, candidate, allowReplaceExisting: true })
    expect(await db.comicPanels.toArray()).toEqual(before)
    expect((await qa.inspectComicQualityV1(f.scope)).canVisualRelease).toBe(true)
    candidate.subjects[0].design.description = '改穿浅色雨衣'
    await adoptComicVisualBibleV1({ scope: f.scope, expectedAdaptationRevision: (await root(f)).revision,
      sourceManifestVersion: 1, candidate, allowReplaceExisting: true })
    expect((await db.comicPanels.get(f.panelId))?.visualReviewRevision).toBeNull()
    expect((await qa.inspectComicQualityV1(f.scope)).canVisualRelease).toBe(false)
  })

  it('最终根写入失败时主体和全部视觉复核都回滚', async () => {
    const f = await ready(2); const before = await state()
    vi.spyOn(db.adaptationProjects, 'update').mockRejectedValueOnce(new Error('injected final root write failure'))
    await expect(edit(f)).rejects.toThrow('injected final root write failure')
    expect(await state()).toEqual(before)
  })

  it('真实发布后重新打开并编辑，历史Release、Blob固定引用和原字节保持不变', async () => {
    const f = await ready()
    const release = await publishComicReleaseV1({ scope: f.scope, expectedAdaptationRevision: (await root(f)).revision, tier: 'visual' })
    const manifest = await readComicReleaseManifestV1(f.scope, release.id)
    const before = await state()
    await reopenAdaptationProductionV1({ scope: f.scope, expectedRevision: (await root(f)).revision })
    const subject = (await db.comicVisualSubjects.get(f.subject.id!))!
    await expect(saveComicVisualSubject({ scope: f.scope, subjectId: subject.id, expectedRevision: subject.revision,
      draft: { ...subject, stableKey: 'new-identity' } })).rejects.toThrow(/稳定/)
    await edit(f)
    const after = await state()
    expect(after.releases).toEqual(before.releases); expect(after.pins).toEqual(before.pins)
    expect(after.assets).toEqual(before.assets); expect(after.blobs).toEqual(before.blobs)
    expect(await readComicReleaseManifestV1(f.scope, release.id)).toEqual(manifest)
    expect((await qa.inspectComicQualityV1(f.scope)).canVisualRelease).toBe(false)
  })

  it.each(['page', 'panel', 'subject'] as const)('锁定%s时阻止编辑并完整回滚', async locked => {
    const f = await ready()
    if (locked === 'page') await db.comicPages.update(f.page.id!, { status: 'locked' })
    if (locked === 'panel') await db.comicPanels.update(f.panelId, { status: 'locked' })
    if (locked === 'subject') await db.comicVisualSubjects.update(f.subject.id!, { status: 'locked' })
    const before = await state()
    await expect(edit(f, locked === 'subject' ? { status: 'reviewed' } : {})).rejects.toThrow(/锁定|解锁/)
    expect(await state()).toEqual(before)
  })

  it('真实质量报告完成后暂停ACK，手工编辑后旧报告不能发布新设计', async () => {
    const f = await ready()
    const actual = qa.inspectComicQualityV1
    let acknowledge!: () => void; const held = new Promise<void>(resolve => { acknowledge = resolve })
    let reached!: () => void; const entered = new Promise<void>(resolve => { reached = resolve })
    vi.spyOn(qa, 'inspectComicQualityV1').mockImplementationOnce(async scope => {
      const report = await actual(scope)
      expect(report.canVisualRelease).toBe(true)
      reached(); await held; return report
    })
    const publishing = publishComicReleaseV1({ scope: f.scope, expectedAdaptationRevision: (await root(f)).revision, tier: 'visual' })
    const result = publishing.then(value => ({ value, error: null }), (error: unknown) => ({ value: null, error }))
    await entered
    try { await edit(f) } finally { acknowledge() }
    expect((await result).error).toBeInstanceOf(Error)
    expect(await db.creationReleases.count()).toBe(0)
    expect((await qa.inspectComicQualityV1(f.scope)).canVisualRelease).toBe(false)
  })

  it('真实来源核验完成后暂停旧视觉复核ACK，手工编辑使其CAS失败', async () => {
    const f = await ready()
    const r = await root(f); const panel = (await db.comicPanels.get(f.panelId))!
    const actual = sourceManifest.inspectAdaptationFreshness
    let acknowledge!: () => void; const held = new Promise<void>(resolve => { acknowledge = resolve })
    let reached!: () => void; const entered = new Promise<void>(resolve => { reached = resolve })
    vi.spyOn(sourceManifest, 'inspectAdaptationFreshness').mockImplementationOnce(async id => {
      const freshness = await actual(id); reached(); await held; return freshness
    })
    const reviewing = adoptComicReviewIssuesV1({ scope: f.scope, expectedAdaptationRevision: r.revision,
      sourceManifestVersion: r.activeSourceManifestVersion, reviewKind: 'visual', targetPageKeys: [f.page.stableKey],
      expectedPanelRevisions: { [panel.stableKey]: panel.revision }, candidates: [], visualInspectionConfirmed: true })
    const result = reviewing.then(value => ({ value, error: null }), (error: unknown) => ({ value: null, error }))
    await entered
    try { await edit(f) } finally { acknowledge() }
    expect((await result).error).toBeInstanceOf(Error)
    expect((await db.comicPanels.get(f.panelId))?.visualReviewRevision).toBeNull()
  })
})
