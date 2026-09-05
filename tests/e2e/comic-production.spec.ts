import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('小说转漫画从独立产品入口冻结来源，经十二步正式数据发布不可变分镜版', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')

  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /长篇小说/ }).click()
  await page.getByLabel('名称').fill('E2E 漫画来源小说')
  await page.getByRole('button', { name: '创建长篇小说', exact: true }).click()
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+\?module=outline$/)
  await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { stampNewRecord }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/workspace/scope.ts'),
    ])
    const project = (await db.projects.toArray()).find((row: any) => row.name === 'E2E 漫画来源小说')
    if (!project?.id || !project.activeWorldId || !project.activeWorkId) throw new Error('E2E 小说 scope 缺失')
    const scope = { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
    const now = Date.now()
    await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      projectId: project.id,
      workId: project.activeWorkId,
      worldGroupId: null,
      parentId: null,
      type: 'volume',
      title: '暴雨旧站',
      summary: '暴雨中，林岚走进旧车站。停摆的时钟在黎明前重新走动，她决定留下。',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }))
  })

  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /小说转漫画/ }).click()
  await expect(page.getByLabel('小说来源')).toContainText('E2E 漫画来源小说')
  await page.getByLabel('小说来源').selectOption({ label: 'E2E 漫画来源小说 · E2E 漫画来源小说' })
  await page.getByLabel('名称').fill('E2E 旧站页漫')
  await page.getByLabel('阅读方向').selectOption('rtl')
  await page.getByLabel('漫画章节数').fill('1')
  await page.getByLabel('每章页数').fill('1')
  await page.getByLabel('色彩模式').selectOption('monochrome')
  await page.getByLabel('画风要求').fill('高反差黑白墨线、清晰阅读顺序、稳定人物设计')
  await page.getByRole('button', { name: '创建漫画项目', exact: true }).click()

  await expect(page.getByRole('heading', { name: '漫画工作台', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '十二步小说转漫画', exact: true })).toBeVisible()
  for (const stage of ['1 来源事实', '2 因果图', '3 改编 Brief', '4 删改决定', '5 漫画脚本', '6 分页节奏', '7 页格分镜', '8 视觉圣经', '9 图片请求', '10 视觉监修', '11 定点修复', '12 页级审校']) {
    await expect(page.locator('.comic-pipeline-steps').getByText(stage, { exact: true })).toBeVisible()
  }
  await expect(page.getByText('候选 · 尚未写入')).toHaveCount(0)

  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { listActiveSourceUnits, saveAdaptationBriefDraft, confirmAdaptationBrief },
      { adoptAdaptationSourceFactsV1, adoptAdaptationCausalEdgesV1, adoptAdaptationDecisionsV1 },
      { adoptComicScriptBeatsV1, adoptComicPagePlansV1, adoptComicPanelPlansV1, adoptComicVisualBibleV1, startComicProductionV1, adoptComicReviewIssuesV1 },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/adaptation/source-manifest.ts'),
      importer('/storyforge/src/lib/adaptation/analysis.ts'),
      importer('/storyforge/src/lib/comic/production.ts'),
    ])
    const work = (await db.works.toArray()).find((row: any) => row.title === 'E2E 旧站页漫')
    if (!work?.id) throw new Error('E2E 漫画 Work 缺失')
    let root = await db.adaptationProjects.where('workId').equals(work.id).first()
    if (!root?.id) throw new Error('E2E 漫画根缺失')
    const scope = { projectId: root.projectId, worldId: root.worldId, workId: root.workId }
    const unit = (await listActiveSourceUnits(root.id)).find((row: any) => row.sourceKind !== 'work')
    if (!unit?.id) throw new Error('E2E 冻结来源单元缺失')

    await adoptAdaptationSourceFactsV1({
      scope,
      adaptationProjectId: root.id,
      expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion,
      items: [
        { authorStatus: 'confirmed', candidate: { stableKey: 'fact_arrival', kind: 'event', statement: '林岚在暴雨中走进旧车站。', subjectKeys: ['hero'], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 } },
        { authorStatus: 'confirmed', candidate: { stableKey: 'fact_choice', kind: 'character-state', statement: '林岚在黎明前决定留下。', subjectKeys: ['hero'], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 } },
      ],
    })
    root = await db.adaptationProjects.get(root.id)
    await adoptAdaptationCausalEdgesV1({ scope, adaptationProjectId: root.id, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'edge_choice', fromFactKey: 'fact_arrival', toFactKey: 'fact_choice', relation: 'enables', rationale: '进入车站使抉择发生。', sourceUnitKeys: [unit.sourceUnitKey] } }] })
    root = await db.adaptationProjects.get(root.id)
    root = await saveAdaptationBriefDraft({ adaptationProjectId: root.id, expectedRevision: root.revision, brief: { version: 1, coreTheme: '选择与代价', dominantEmotion: '克制', mustKeep: ['黎明前的选择'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: ['可视化时钟意象'], audience: '青少年及以上', rating: 'PG-13', targetScale: '一章一页', narrativePerspective: '林岚', timeBudget: '', costLimit: '', deviationNotes: '', unresolvedQuestions: [], assumptions: [] } })
    root = await confirmAdaptationBrief({ adaptationProjectId: root.id, expectedRevision: root.revision })
    await adoptAdaptationDecisionsV1({ scope, adaptationProjectId: root.id, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'decision_keep', action: 'keep', sourceFactKeys: ['fact_arrival', 'fact_choice'], targetKeys: ['beat_choice'], rationale: '保留进入与选择的因果链。' } }] })
    root = await db.adaptationProjects.get(root.id)
    await adoptComicScriptBeatsV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidates: [{ stableKey: 'beat_choice', sectionKey: 'chapter_1', chapterNumber: 1, order: 0, narrativeFunction: 'turn', visualAction: '林岚推开车站门，看见停摆时钟重新走动，随后放下车票。', dialogueIntent: '不用对白，以动作完成选择。', emotion: '迟疑转为坚定', causalFactKeys: ['fact_arrival', 'fact_choice'], decisionKeys: ['decision_keep'], sourceUnitKeys: [unit.sourceUnitKey], estimatedPanels: 1 }] })
    root = await db.adaptationProjects.get(root.id)
    await adoptComicPagePlansV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidates: [{ stableKey: 'page_plan_1', chapterNumber: 1, pageNumber: 1, order: 0, goal: '在单页内呈现人物选择。', beatKeys: ['beat_choice'], endReveal: '时钟重新走动。', pageTurn: 'cliffhanger', expectedPanelCount: 1, textBudget: 30 }] })
    root = await db.adaptationProjects.get(root.id)
    await adoptComicPanelPlansV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidates: [{ pagePlanKey: 'page_plan_1', stableKey: 'panel_1', order: 0, nextPanelKey: null, frame: { x: 0, y: 0, width: 1, height: 1 }, narrativeFunction: 'turn', moment: '林岚松手，车票落下，背景时钟指针刚开始移动。', shot: { size: 'wide', angle: 'eye-level', movement: 'static', composition: '人物位于右下，时钟位于左上，符合右到左阅读方向。' }, subjectStates: [{ subjectKey: 'hero', costume: '深色风衣', condition: '雨湿但完整', props: ['车票'], position: '画面右下' }], protectedAreas: [{ x: .58, y: .05, width: .35, height: .14 }], continuityRefs: [{ subjectKey: 'hero', note: '保持短发、深色风衣与车票。' }], lettering: [{ id: 'caption_1', kind: 'caption', text: '黎明之前。', frame: { x: .58, y: .05, width: .35, height: .14 }, direction: 'horizontal', fontFamily: 'storyforge-serif', fontSize: 28, textColor: '#111111', fillColor: '#ffffff', strokeColor: '#111111', strokeWidth: 2, tail: null, zIndex: 1 }], sourceUnitKeys: [unit.sourceUnitKey] }] })
    root = await db.adaptationProjects.get(root.id)
    await adoptComicVisualBibleV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidate: { global: { version: 1, artDirection: '高反差黑白页漫', linework: '有重量的墨线', palette: ['墨黑', '纸白'], lighting: '高反差逆光', periodAndMaterials: '当代旧车站与湿润混凝土', cameraLanguage: ['使用道具完成选择'], prohibitedDepictions: ['成图文字', '水印'] }, subjects: [{ stableKey: 'hero', kind: 'character', label: '林岚', design: { description: '二十多岁，短发，克制神情', silhouette: '窄肩长风衣', facialFeatures: '细长眼与直眉', hairAndCostume: '黑色短发、深色风衣', palette: ['墨黑', '纸白'], materials: ['湿呢料'], distinguishingMarks: ['银色旧车票夹'], prohibitedChanges: ['发型', '风衣长度'] }, sourceUnitKeys: [unit.sourceUnitKey] }] } })
    root = await db.adaptationProjects.get(root.id)
    root = await startComicProductionV1({ scope, expectedAdaptationRevision: root.revision })
    const comicPage = await db.comicPages.where('adaptationProjectId').equals(root.id).first()
    const panel = await db.comicPanels.where('pageId').equals(comicPage.id).first()
    await adoptComicReviewIssuesV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, reviewKind: 'page', targetPageKeys: [comicPage.stableKey], expectedPanelRevisions: { [panel.stableKey]: panel.revision }, candidates: [] })
    return { pageKey: comicPage.stableKey, panelKey: panel.stableKey }
  })
  expect(seeded).toEqual({ pageKey: 'page_1', panelKey: 'panel_1' })

  await page.reload()
  await page.getByTestId('product-tab-novel').click()
  await expect(page.getByLabel('目标页')).toHaveValue('page_1')
  await page.getByRole('button', { name: 'QA 与导出', exact: true }).click()
  await expect(page.getByText('可发布专业分镜版', { exact: true })).toBeVisible()
  const publish = page.getByRole('button', { name: '发布不可变分镜版', exact: true })
  await expect(publish).toBeEnabled()
  await publish.click()
  await expect(page.getByText(/v1 · 分镜版 · E2E 旧站页漫 分镜版 v1/)).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '分镜脚本', exact: true }).click()
  const artifact = await download
  const path = await artifact.path()
  expect(path).not.toBeNull()
  const storyboard = await readFile(path!, 'utf8')
  expect(storyboard).toContain('E2E 旧站页漫')
  expect(storyboard).toContain('林岚松手')
  expect(storyboard).toContain('黎明之前')

  await page.reload()
  await page.getByTestId('product-tab-novel').click()
  await page.getByRole('button', { name: 'QA 与导出', exact: true }).click()
  await expect(page.getByText(/v1 · 分镜版 · E2E 旧站页漫 分镜版 v1/)).toBeVisible()
})
