import { expect, test, type Page } from '@playwright/test'

interface Seed { scope: { projectId: number; worldId: number; workId: number }; subjectId: number; panelId: number }

async function snapshot(page: Page, seed: Seed) {
  return page.evaluate(async item => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const result = { subject: await db.comicVisualSubjects.get(item.subjectId), panel: await db.comicPanels.get(item.panelId),
      assets: await db.comicMediaAssets.where('workId').equals(item.scope.workId).toArray(),
      blobs: await db.mediaBlobObjects.where('workId').equals(item.scope.workId).toArray() }
    return JSON.parse(JSON.stringify(result, (_key, value: unknown) => value instanceof ArrayBuffer
      ? { bytes: Array.from(new Uint8Array(value)) } : value)) as typeof result
  }, seed)
}

test('034/039 实际视觉编辑固定身份，显示名保留验图，设计修改在刷新后仍要求重新验图', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('034039 requires its isolated loopback server')
  const base = new URL(baseURL)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('034039 refuses author or external origins')
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const forbidden: string[] = []
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url())
    if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else { forbidden.push(`${request.method()} ${url.origin}`); await route.abort() }
  })
  try {
    await context.addInitScript(() => { localStorage.setItem('storyforge_guide_completed', 'quality034039-isolated') })
    const page = await context.newPage()
    await page.goto('./', { waitUntil: 'domcontentloaded' })
    const seed: Seed = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      if (await db.projects.count()) throw new Error('034039 requires empty isolated storage')
      const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
      const source = await createWorkspace({ name: 'QUALITY034039原作', description: '', genres: [], status: 'drafting', targetWordCount: 10_000 },
        { kind: 'novel', novelProfile: 'long', importedNovelText: '清晨，林岚收好车票，走入旧车站。' })
      const manifest = await load<typeof import('../../src/lib/adaptation/source-manifest')>('/storyforge/src/lib/adaptation/source-manifest.ts')
      const { defaultComicTargetSpec } = await load<typeof import('../../src/lib/comic/authoring')>('/storyforge/src/lib/comic/authoring.ts')
      const service = await load<typeof import('../../src/lib/comic/service')>('/storyforge/src/lib/comic/service.ts')
      const media = await load<typeof import('../../src/lib/comic/media-service')>('/storyforge/src/lib/comic/media-service.ts')
      const { adoptComicReviewIssuesV1 } = await load<typeof import('../../src/lib/comic/production')>('/storyforge/src/lib/comic/production.ts')
      const comic = await manifest.createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId,
        title: 'QUALITY034039漫画', sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec: defaultComicTargetSpec() })
      const unit = (await manifest.listActiveSourceUnits(comic.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
      const subject = await service.saveComicVisualSubject({ scope: comic.scope, draft: { stableKey: 'ticket', kind: 'prop',
        characterId: null, locationRefKey: null, label: 'QUALITY034039车票', sourceUnitIds: [unit.id!], status: 'reviewed',
        design: { description: '原创矩形车票', silhouette: '矩形', facialFeatures: '', hairAndCostume: '蓝色票面',
          palette: ['蓝'], materials: ['纸'], distinguishingMarks: [], prohibitedChanges: [] } } })
      let root = (await db.adaptationProjects.get(comic.adaptation.id!))!
      root = await manifest.saveAdaptationBriefDraft({ adaptationProjectId: root.id!, expectedRevision: root.revision,
        brief: { version: 1, coreTheme: '选择与代价', dominantEmotion: '克制', mustKeep: ['车票'], mayCut: [], mayMerge: [], mayReorder: [],
          allowedAdditions: [], audience: '大众', rating: 'PG-13', targetScale: '一页', narrativePerspective: '林岚',
          timeBudget: '', costLimit: '', deviationNotes: '', unresolvedQuestions: [], assumptions: [] } })
      root = await manifest.confirmAdaptationBrief({ adaptationProjectId: root.id!, expectedRevision: root.revision })
      root = await manifest.saveAdaptationPlanDraft({ adaptationProjectId: root.id!, expectedRevision: root.revision,
        plan: { version: 1, premise: '林岚收好车票', sections: [{ stableKey: 'chapter1', title: '旧站', summary: '车票抉择', order: 0,
          episodeNumber: 1, sourceUnitKeys: [unit.sourceUnitKey] }], globalAssumptions: [] } })
      root = await manifest.confirmAdaptationPlan({ adaptationProjectId: root.id!, expectedRevision: root.revision })
      root = await manifest.confirmComicVisualBible({ adaptationProjectId: root.id!, expectedRevision: root.revision,
        visualBible: { version: 1, artDirection: '原创漫画', linework: '墨线', palette: ['蓝'], lighting: '清晨',
          periodAndMaterials: '当代车站', cameraLanguage: ['近景'], prohibitedDepictions: ['水印'] } })
      await manifest.startAdaptationProduction({ adaptationProjectId: root.id!, expectedRevision: root.revision })
      const { page: comicPage, panels } = await service.createComicPage(comic.scope, { chapterNumber: 1, summary: '收好车票', panels: [{
        frame: { x: 0, y: 0, width: 1, height: 1 }, shot: { size: 'close-up', angle: 'eye-level', movement: 'static', composition: '手中车票' },
        action: '收好车票', visualPrompt: 'ticket, no text', negativePrompt: 'watermark',
        continuityRefs: [{ subjectKey: 'ticket', note: '同一张蓝色车票' }], lettering: [], sourceUnitIds: [unit.id!] }] })
      const data = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQMar4DwAC2gG+nphhRgAAAABJRU5ErkJggg=='), value => value.charCodeAt(0)).buffer
      const rights = { version: 1 as const, source: 'author-upload' as const, commercialUse: 'allowed' as const,
        redistribution: 'allowed' as const, attribution: '', declaration: '合成工程测试图片', declaredAt: Date.now() }
      const reference = await media.commitUploadedComicAssetV1({ scope: comic.scope, subjectId: subject.id!, data, rights })
      await media.selectComicMediaAssetV1({ scope: comic.scope, subjectId: subject.id!, assetKey: reference.stableKey, expectedRevision: subject.revision })
      const image = await media.commitUploadedComicAssetV1({ scope: comic.scope, panelId: panels[0].id!, data, rights })
      await media.selectComicMediaAssetV1({ scope: comic.scope, panelId: panels[0].id!, assetKey: image.stableKey, expectedRevision: panels[0].revision })
      root = (await db.adaptationProjects.get(root.id!))!
      const panel = (await db.comicPanels.get(panels[0].id!))!
      await adoptComicReviewIssuesV1({ scope: comic.scope, expectedAdaptationRevision: root.revision,
        sourceManifestVersion: root.activeSourceManifestVersion, reviewKind: 'visual', targetPageKeys: [comicPage.stableKey],
        expectedPanelRevisions: { [panel.stableKey]: panel.revision }, candidates: [], visualInspectionConfirmed: true })
      return { scope: comic.scope, subjectId: subject.id!, panelId: panel.id! }
    })
    await page.goto(`./comic/references?work=${seed.scope.workId}`)
    const visual = page.locator('.comic-visual-layout')
    await expect(visual.getByRole('heading', { name: 'QUALITY034039车票', exact: true })).toBeVisible()
    await expect(visual.getByLabel(/稳定 key/)).toHaveAttribute('readonly', '')
    await expect.poll(() => visual.getByRole('img', { name: 'QUALITY034039车票 当前参考图', exact: true })
      .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 1)).toBe(true)
    const before = await snapshot(page, seed)
    expect(before.panel?.visualReviewBasis).toBe('author-visual')
    await visual.getByLabel('名称', { exact: true }).fill('QUALITY034039显示名')
    await visual.getByRole('button', { name: '保存视觉条目', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, seed)).subject?.label).toBe('QUALITY034039显示名')
    await expect(visual.getByRole('heading', { name: 'QUALITY034039显示名', exact: true })).toBeVisible()
    expect((await snapshot(page, seed)).panel).toEqual(before.panel)
    await visual.getByRole('textbox', { name: '发型与服装', exact: true }).fill('改为红色票面')
    await visual.getByRole('button', { name: '保存视觉条目', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, seed)).subject?.design.hairAndCostume).toBe('改为红色票面')
    const after = await snapshot(page, seed)
    expect(after.subject?.stableKey).toBe('ticket')
    expect(after.panel?.visualReviewRevision).toBeNull()
    expect(after.panel?.visualReviewBasis).toBeNull()
    expect(after.panel?.selectedMediaAssetKey).toBe(before.panel?.selectedMediaAssetKey)
    expect(after.assets).toEqual(before.assets); expect(after.blobs).toEqual(before.blobs)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(visual.getByRole('textbox', { name: '发型与服装', exact: true })).toHaveValue('改为红色票面')
    expect((await snapshot(page, seed)).panel?.visualReviewRevision).toBeNull()
    await expect(page.locator('.comic-error')).toHaveCount(0)
    expect(forbidden).toEqual([])
  } finally { await context.close() }
})
