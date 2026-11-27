import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const evidence = resolve(process.env.SCREENPLAY_LAYOUT_EVIDENCE ?? 'test-results/screenplay-layout-022', 'after')
const longTitle = '末班车与等待的人——保留作者原始长标题并验证剧本工作区的多尺寸布局'
const routes = [
  ['source', '原文与范围'], ['source', '原作事实'], ['source', '因果关系'],
  ['brief', '改编要求'], ['brief', '删改决定'], ['brief', '剧本与署名'],
  ['structure', '结构与节拍'], ['scenes', '场次规划'], ['scenes', '成稿目录'],
  ['editor', ''], ['grounding', ''], ['review', ''], ['versions', ''],
] as const

async function seed(page: Page) {
  return page.evaluate(async title => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ createWorkspace }, source, analysis, production, service, { db }] = await Promise.all([
      load('/storyforge/src/lib/workspace/create-workspace.ts'), load('/storyforge/src/lib/adaptation/source-manifest.ts'),
      load('/storyforge/src/lib/adaptation/analysis.ts'), load('/storyforge/src/lib/screenplay/production.ts'),
      load('/storyforge/src/lib/screenplay/service.ts'), load('/storyforge/src/lib/db/schema.ts'),
    ])
    const original = await createWorkspace({ name: title + ' · 原作', description: '', genres: [], status: 'drafting', targetWordCount: 5000 }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long', importedNovelText: '第一章 末班车\n林岚走进旧车站。末班车即将离开，她选择留下等待弟弟。\n第二章 等待\n她在站台上看见弟弟。' })
    const result = await source.createAdaptation({ sourceScope: original.scope, sourceWorkId: original.scope.workId, title, sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: { format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 1, rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'standard', preserveVoiceOver: false, titlePage: { creditLine: '小说改编', authorDisplayName: '测试作者', contactText: '', copyrightNotice: '', draftLabel: '第一稿' }, exportDefaults: ['fountain', 'fdx', 'pdf'] } })
    let root = await db.adaptationProjects.where('workId').equals(result.targetWork.id).first()
    const scope = { projectId: root.projectId, worldId: root.worldId, workId: root.workId }
    const sourceUnits = await source.listActiveSourceUnits(root.id)
    const sourceUnitIndex = sourceUnits.findIndex((row: any) => row.sourceKind === 'chapter')
    if (sourceUnitIndex < 0) throw new Error('隔离来源缺少章节正文')
    const unit = sourceUnits[sourceUnitIndex]
    const common = () => ({ scope, adaptationProjectId: root.id, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion })
    const refresh = async () => { root = await db.adaptationProjects.get(root.id) }
    await analysis.adoptAdaptationSourceFactsV1({ ...common(), items: [
      { authorStatus: 'confirmed', candidate: { stableKey: 'fact.arrival', kind: 'event', statement: '林岚走进旧车站。', subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 } },
      { authorStatus: 'confirmed', candidate: { stableKey: 'fact.wait', kind: 'event', statement: '她选择等待弟弟。', subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 } },
    ] }); await refresh()
    await analysis.adoptAdaptationCausalEdgesV1({ ...common(), items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'edge.wait', fromFactKey: 'fact.arrival', toFactKey: 'fact.wait', relation: 'enables', rationale: '到站使等待成为行动。', sourceUnitKeys: [unit.sourceUnitKey] } }] }); await refresh()
    await analysis.adoptAdaptationDecisionsV1({ ...common(), items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'decision.keep', action: 'keep', sourceFactKeys: ['fact.wait'], targetKeys: ['act-1'], rationale: '保留等待。' } }] }); await refresh()
    root = await source.saveAdaptationBriefDraft({ adaptationProjectId: root.id, expectedRevision: root.revision, brief: { version: 1, coreTheme: '等待与选择', dominantEmotion: '希望', mustKeep: ['等待'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [], audience: '中文观众', rating: 'PG-13', targetScale: '电影', narrativePerspective: '林岚', timeBudget: '60秒', costLimit: '标准', deviationNotes: '', unresolvedQuestions: [], assumptions: [] } })
    root = await source.confirmAdaptationBrief({ adaptationProjectId: root.id, expectedRevision: root.revision })
    await production.adoptScreenplayBeatsV1({ ...common(), candidates: [{ stableKey: 'beat.wait', sectionKey: 'act-1', sectionTitle: '第一幕 · ' + title, scope: 'act', episodeNumber: 1, order: 0, objective: '等待弟弟', conflict: '末班车将离开', turn: '选择留下', outcome: '望向入口', causalFactKeys: ['fact.arrival', 'fact.wait'], decisionKeys: ['decision.keep'], sourceUnitKeys: [unit.sourceUnitKey], estimatedSeconds: 60 }] }); await refresh()
    await production.adoptScreenplaySceneCardsV1({ ...common(), candidates: [{ stableKey: 'scene.wait', beatKey: 'beat.wait', episodeNumber: 1, sceneNumber: 1, order: 0, purpose: title, conflict: '末班车将离开', entryState: '匆忙', exitState: '坚定', visibleAction: '林岚停在站台。', informationReveal: '等待弟弟', sourceUnitKeys: [unit.sourceUnitKey], estimatedSeconds: 60 }] }); await refresh()
    await production.startScreenplayProductionV1(common()); await refresh()
    await service.createScreenplayScene(scope, { stableKey: 'scene.wait', planSectionKey: 'act-1', episodeNumber: 1, sceneNumber: 1, intExt: 'INT', location: title, timeOfDay: '夜', summary: '林岚决定留下等待。', estimatedSeconds: 60, sourceUnitIds: [unit.id], blocks: [{ id: 'action.wait', type: 'action', text: '林岚停在站台，望向入口。' }, { id: 'cue.wait', type: 'character', name: '林岚' }, { id: 'dialogue.wait', type: 'dialogue', text: '我在这里等你。' }] })
    return { workId: scope.workId, sourceWorkId: original.scope.workId, sourceUnitIndex }
  }, longTitle)
}

for (const width of [1728, 1366, 390]) test(`022 all screenplay routes and secondary pages at ${width}px`, async ({ page }) => {
  test.setTimeout(180000)
  await mkdir(evidence, { recursive: true })
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  // This context has no author profile, credentials or real model traffic.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto('./script/library', { waitUntil: 'networkidle' })
  await expect(page.getByRole('button', { name: '新建剧本改编', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '新建剧本改编', exact: true }).click()
  await page.getByRole('button', { name: '冻结来源并创建剧本', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('请填写剧本名称')
  await page.screenshot({ path: resolve(evidence, `${width}-create-error.png`), fullPage: true })
  await page.getByLabel('剧本名称', { exact: true }).fill(longTitle)
  await page.getByLabel('来源方式', { exact: true }).selectOption('import')
  await page.getByLabel('导入原作内容').fill('这是隔离的原作预览，不提交。')
  await page.screenshot({ path: resolve(evidence, `${width}-create-import.png`), fullPage: true })
  const fixture = await seed(page)
  const measurements: unknown[] = []
  for (const [route, sub] of routes) {
    await page.goto(`./script/${route}?work=${fixture.workId}`)
    await expect(page.locator('.screenplay-top')).toBeVisible()
    if (sub) await page.getByRole('navigation', { name: '页面内导航', exact: true }).getByRole('button', { name: sub, exact: true }).click()
    if (route === 'source' && sub === '原文与范围') {
      await page.locator('.sp-source-layout nav button').nth(fixture.sourceUnitIndex).click()
      await expect(page.locator('.sp-source-layout pre')).toContainText('林岚')
    } else if (sub && sub !== '成稿目录') await expect(page.locator('.sp-planning fieldset')).toBeVisible()
    else if (route === 'editor' || sub === '成稿目录') await expect(page.getByPlaceholder('地点', { exact: true })).toBeVisible()
    else await expect(page.locator(route === 'versions' ? '.screenplay-toolbar' : '.screenplay-pipeline')).toBeVisible()
    const geometry = await page.evaluate(() => {
      const main = document.querySelector('.lf-main')!
      const content = document.querySelector('.screenplay-editor') ?? document.querySelector('.sp-planning, .sp-source, .screenplay-pipeline, .screenplay-toolbar')!
      const writing = document.querySelector('.screenplay-blocks textarea')
      return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth, contentTop: content.getBoundingClientRect().top, writingTop: writing?.getBoundingClientRect().top ?? null,
        overflowingControls: [...document.querySelectorAll('.screenplay-studio input,.screenplay-studio select,.screenplay-studio textarea')].filter(el => { const box = el.getBoundingClientRect(); return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1) }).length }
    })
    measurements.push({ route, sub, ...geometry })
    expect(geometry.documentWidth).toBeLessThanOrEqual(width)
    expect(geometry.mainScrollWidth).toBeLessThanOrEqual(geometry.mainWidth + 1)
    expect(geometry.overflowingControls).toBe(0)
    expect(geometry.contentTop).toBeLessThan(width === 390 ? 620 : 450)
    if (geometry.writingTop !== null) expect(geometry.writingTop).toBeLessThan(geometry.height)
    await page.screenshot({ path: resolve(evidence, `${width}-${route}-${sub || 'main'}.png`), fullPage: true })
  }
  await writeFile(resolve(evidence, `${width}-routes.json`), JSON.stringify(measurements, null, 2))
  // Empty search and no-work routes remain reachable, without creating more Works.
  await page.goto('./script/library')
  await page.getByLabel('搜索剧本').fill('不存在的作品')
  await page.screenshot({ path: resolve(evidence, `${width}-library-no-results.png`), fullPage: true })
  for (const route of ['source', 'brief', 'structure', 'scenes', 'editor', 'grounding', 'review', 'versions']) {
    await page.goto(`./script/${route}`)
    await expect(page.locator('.sp-empty')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await page.screenshot({ path: resolve(evidence, `${width}-no-work.png`), fullPage: true })
})

test('022 shared settings route remains reachable without changing settings', async ({ page }) => {
  await mkdir(evidence, { recursive: true })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto('./script/settings', { waitUntil: 'networkidle' })
  await expect(page.locator('.lf-heading h2')).toHaveText('通用设置')
  await expect(page.getByText('示例作品库', { exact: true })).toBeAttached()
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: resolve(evidence, `${width}-settings.png`), fullPage: true })
  }
})
