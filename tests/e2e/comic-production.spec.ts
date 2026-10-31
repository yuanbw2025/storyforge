import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import { createLongform } from './helpers/product-entry'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('小说转漫画从独立产品入口冻结来源，经十二步正式数据发布不可变分镜版', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './')

  await createLongform(page,'E2E 漫画来源小说')
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

  await gotoWithBrowserFixtureAIConfigV1(page, './comic/library')
  await page.getByRole('button',{name:'新建漫画改编',exact:true}).click()
  await page.getByLabel('小说来源').selectOption({label:'E2E 漫画来源小说'})
  await page.getByLabel('漫画名称',{exact:true}).fill('E2E 旧站页漫')
  await page.getByLabel('阅读方向').selectOption('rtl')
  await page.getByLabel('漫画章节数').fill('1')
  await page.getByLabel('每章页数').fill('1')
  await page.getByLabel('色彩模式').selectOption('monochrome')
  await page.getByLabel('画风要求').fill('高反差黑白墨线、清晰阅读顺序、稳定人物设计')
  await page.getByRole('button',{name:'冻结来源并创建漫画',exact:true}).click()
  await expect(page).toHaveURL(/comic\/source\?work=\d+/)
  const workId=new URL(page.url()).searchParams.get('work')!
  const categories=page.getByRole('navigation',{name:'漫画页面导航'})
  await expect(categories.getByRole('button')).toHaveText(['作品库','漫画制作台','阅读预览','版本与导出','通用设置'])
  await expect(categories.getByText(/生成|发布|采纳/)).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'作品规格'})).toBeVisible()
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

  await gotoWithBrowserFixtureAIConfigV1(page, `./comic/layout?work=${workId}`)
  await expect(page.locator('.comic-page-thumbnail')).toHaveCount(1)
  await expect(page.getByTestId('comic-showcase')).toHaveCount(0)
  const panelHitbox=page.getByRole('button',{name:/选择第 1 格/})
  await panelHitbox.click()
  await expect(page.getByLabel('画布缩放')).toHaveValue('85')
  await expect(page.getByLabel('这一格的定格瞬间')).toBeVisible()
  // Navigation categories load their real editors without duplicating primary actions in the sidebar.
  await gotoWithBrowserFixtureAIConfigV1(page, `./comic/lettering?work=${workId}`)
  await page.getByLabel('排字内容 1',{exact:true}).fill('黎明之前，新的对白')
  await expect.poll(()=>page.evaluate(async()=>{const m=await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))();return (await m.db.agentEvents.toArray()).some((e:any)=>e.content.includes('新的对白'))})).toBe(true)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByLabel('排字内容 1',{exact:true})).toHaveValue('黎明之前，新的对白')
  await page.getByRole('button',{name:'保存格、排字与裁切'}).click()
  await expect(page.getByText('格已保存',{exact:true})).toBeVisible()
  await gotoWithBrowserFixtureAIConfigV1(page, `./comic/review?work=${workId}`)
  await page.getByRole('button',{name:'展开专业流程',exact:true}).click()
  await page.getByRole('button',{name:'作者确认本页叙事无问题',exact:true}).click()
  await expect(page.getByText('可发布专业分镜版',{exact:true})).toBeVisible()
  await gotoWithBrowserFixtureAIConfigV1(page, `./comic/versions?work=${workId}`)
  const publish = page.getByRole('button', { name: '发布不可变分镜版', exact: true })
  await expect(publish).toBeEnabled()
  await publish.click()
  await expect(page.getByRole('button',{name:'查看版本 v1',exact:true})).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '分镜脚本', exact: true }).click()
  const artifact = await download
  const path = await artifact.path()
  expect(path).not.toBeNull()
  const storyboard = await readFile(path!, 'utf8')
  expect(storyboard).toContain('E2E 旧站页漫')
  expect(storyboard).toContain('林岚松手')
  expect(storyboard).toContain('黎明之前')

  await reloadWithBrowserFixtureAIConfigV1(page)
  await page.getByRole('button',{name:'查看版本 v1',exact:true}).click()
  await expect(page.getByRole('heading',{name:'版本 v1 · 分镜资料'})).toBeVisible()
  const frozenDownload=page.waitForEvent('download')
  await page.getByRole('button',{name:'导出此版本 JSON',exact:true}).click()
  const frozen=JSON.parse(await readFile((await (await frozenDownload).path())!,'utf8'))
  expect(frozen.pages[0].panels[0].lettering[0].text).toContain('新的对白')
  await page.getByRole('button',{name:'重新打开审校',exact:true}).click()
  await gotoWithBrowserFixtureAIConfigV1(page, `./comic/lettering?work=${workId}`)
  await page.getByLabel('排字内容 1',{exact:true}).fill('工作稿后来修改')
  await page.getByRole('button',{name:'保存格、排字与裁切'}).click()
  await expect(page.getByText('格已保存',{exact:true})).toBeVisible()
  await gotoWithBrowserFixtureAIConfigV1(page, `./comic/versions?work=${workId}`)
  await page.getByRole('button',{name:'查看版本 v1',exact:true}).click()
  await expect(page.locator('.cp-release-history svg')).toContainText('新的对白')
  await expect(page.locator('.cp-release-history svg')).not.toContainText('工作稿后来修改')
  await page.screenshot({path:test.info().outputPath('comic-versions.png'),fullPage:true})
})

 test('漫画无作品可浏览分类，导入原作后编辑稿持久保存',async({page})=>{
  await gotoWithBrowserFixtureAIConfigV1(page, './comic/library')
  await page.getByRole('navigation',{name:'漫画页面导航'}).getByRole('button',{name:'漫画制作台',exact:true}).click()
  await page.getByRole('navigation',{name:'漫画内容分类'}).getByRole('button',{name:'页格分镜',exact:true}).click()
  await expect(page.getByRole('heading',{name:'页格分镜'}).first()).toBeVisible()
  await page.getByRole('button',{name:'选择或创建漫画',exact:true}).last().click()
  await page.getByLabel('漫画名称',{exact:true}).fill('手工改编')
  await page.getByLabel('来源方式').selectOption('import')
  await page.getByLabel('导入原作内容').fill('雨夜，林岚走进车站。黎明，她决定留下。')
  await page.getByLabel('每章页数').fill('1')
  await page.getByRole('button',{name:'冻结来源并创建漫画'}).click()
  await expect(page).toHaveURL(/comic\/source\?work=\d+/)
  const workId=new URL(page.url()).searchParams.get('work')!
  await gotoWithBrowserFixtureAIConfigV1(page, `./comic/facts?work=${workId}`)
  await page.getByRole('button',{name:'添加原作事实',exact:true}).click()
  await page.getByLabel('第1项 原作事实',{exact:true}).fill('林岚走进车站。')
  await page.getByRole('button',{name:'确认原作事实',exact:true}).click()
  await expect(page.getByText('原作事实已确认',{exact:true})).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByLabel('第1项 原作事实',{exact:true})).toHaveValue('林岚走进车站。')
  await page.screenshot({path:test.info().outputPath('comic-facts.png'),fullPage:true})

  // Finish a storyboard using only the actual author forms and production actions.
  await page.getByRole('button',{name:'添加原作事实',exact:true}).click()
  await page.getByLabel('第2项 原作事实',{exact:true}).fill('林岚决定留下。')
  await page.getByRole('button',{name:'确认原作事实',exact:true}).click()
  await expect.poll(()=>page.evaluate(async()=>{const {db}=await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))();return db.adaptationSourceFacts.count()})).toBe(2)
  const go=async(id:string)=>{await gotoWithBrowserFixtureAIConfigV1(page, `./comic/${id}?work=${workId}`)}
  const confirm=async(name:string)=>{await page.getByRole('button',{name,exact:true}).click();await expect(page.getByText(name.replace(/^确认/,'')+'已确认',{exact:true})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0)}
  await go('causal');await page.getByRole('button',{name:'添加因果关系',exact:true}).click();await page.getByLabel('第1项 取舍理由').fill('到站后才做出留下的决定。');await confirm('确认因果关系')
  await go('brief');await page.getByLabel('核心主题',{exact:true}).fill('归属与选择');await page.getByLabel('主导情绪',{exact:true}).fill('温暖');await confirm('确认改编方案')
  await go('decisions');await page.getByRole('button',{name:'添加删改决定',exact:true}).click();await page.getByLabel('第1项 取舍理由').fill('保留人物到站的行动。');await confirm('确认删改决定')
  await go('script');await page.getByRole('button',{name:'添加漫画脚本',exact:true}).click();await page.getByLabel('第1项 视觉动作').fill('林岚推开车站的门。');await page.getByLabel('第1项 对白意图').fill('以动作表达迟疑。');await page.getByLabel('第1项 情绪',{exact:true}).fill('迟疑');await confirm('确认漫画脚本')
  await go('rhythm');await page.getByRole('button',{name:'添加分页节奏',exact:true}).click();await page.getByLabel('第1项 本页目标').fill('展现到站的一瞬间。');await page.getByLabel('第1项 页末揭示').fill('门内的灯光。');await confirm('确认分页节奏')
  await go('layout');await page.getByRole('button',{name:'作者建立基础分镜',exact:true}).click();await expect(page.locator('.comic-page-thumbnail')).toHaveCount(1)
  await page.screenshot({path:test.info().outputPath('comic-layout.png'),fullPage:true})
  await go('visual');await page.getByLabel('全局画风 美术方向').fill('清晰的钢笔线稿');await page.getByLabel('全局画风 线条').fill('克制');await page.getByLabel('全局画风 光线').fill('柔和顶光');await page.getByLabel('全局画风 色板').fill('黑色\n米白');await page.getByLabel('全局画风 镜头语言').fill('先建立场景，再切近景');await page.getByLabel('全局画风 时代与材质').fill('现代车站');await page.getByRole('button',{name:'添加视觉主体'}).click()
  await page.getByLabel('段落 第1项 名称',{exact:true}).fill('林岚');await page.getByLabel('段落 第1项 外观设计 设计描述').fill('短发旅人');await page.getByLabel('段落 第1项 外观设计 轮廓').fill('窄肩');await page.getByLabel('段落 第1项 外观设计 面部特征').fill('圆脸');await page.getByLabel('段落 第1项 外观设计 发型与服装').fill('短发风衣');await confirm('确认视觉圣经')
  await page.getByRole('button',{name:'进入图片生产',exact:true}).click();await expect(page.getByRole('button',{name:'进入图片生产',exact:true})).toHaveCount(0)
  await go('review');await page.getByRole('button',{name:'展开专业流程',exact:true}).click();await page.getByRole('button',{name:'作者确认本页叙事无问题',exact:true}).click();await expect(page.getByText('可发布专业分镜版',{exact:true})).toBeVisible()
  await go('versions');await page.getByRole('button',{name:'发布不可变分镜版',exact:true}).click();await page.getByRole('button',{name:'查看版本 v1',exact:true}).click();await expect(page.getByRole('heading',{name:'版本 v1 · 分镜资料'})).toBeVisible()
  await go('references');await expect(page.locator('.comic-visual-layout')).toBeVisible();await page.locator('.comic-visual-layout').screenshot({path:test.info().outputPath('comic-references.png')})
  await go('media');await expect(page.getByRole('heading',{name:'图片候选',exact:true})).toBeVisible();await page.getByRole('heading',{name:'图片候选',exact:true}).locator('..').screenshot({path:test.info().outputPath('comic-media.png')})
})


test('漫画 AI 候选保留作者编辑与排除选择，刷新后明确采纳',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('storyforge_guide_completed','e2e')
 })
 registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://comic-test.invalid/v1', model: 'gpt-4o', temperature: .2, maxTokens: 4000, apiKey: 'isolated-test-key' })
 let calls=0
 await page.route('https://comic-test.invalid/**',async route=>{
  calls++;const request=JSON.stringify(route.request().postDataJSON());const key=request.match(/asu_[A-Za-z0-9_-]{8,64}/)?.[0];expect(key).toBeTruthy()
  const facts=[{stableKey:'fact.arrival',kind:'event',statement:'林岚到达车站。',subjectKeys:[],sourceUnitKeys:[key],confidence:1},{stableKey:'fact.wait',kind:'event',statement:'她决定等待。',subjectKeys:[],sourceUnitKeys:[key],confidence:1}]
  await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(facts)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})})
 })
 await gotoWithBrowserFixtureAIConfigV1(page, './comic/library?create=1')
 await page.getByLabel('漫画名称',{exact:true}).fill('候选恢复漫画')
 await page.getByLabel('来源方式',{exact:true}).selectOption('import')
 await page.getByLabel('导入原作内容').fill('林岚走进车站。她决定等待。')
 await page.getByRole('button',{name:'冻结来源并创建漫画',exact:true}).click()
 await expect(page).toHaveURL(/comic\/source\?work=\d+/)
 await page.getByRole('navigation',{name:'漫画内容分类'}).getByRole('button',{name:'原作事实',exact:true}).click()
 await page.locator('.comic-pipeline-steps').getByRole('button',{name:/来源事实/}).click()
 const candidate=page.locator('.comic-professional-candidate')
 await expect(candidate).toBeVisible()
 await candidate.locator('.comic-candidate-items input').nth(1).uncheck()
 await candidate.getByLabel('第1项 原作事实',{exact:true}).fill('作者核对：林岚到达旧车站。')
 await page.getByRole('navigation',{name:'漫画内容分类'}).getByRole('button',{name:'改编方案',exact:true}).click()
 await expect(page).toHaveURL(/comic\/brief\?work=\d+/)
 await reloadWithBrowserFixtureAIConfigV1(page)
 await expect(candidate.getByLabel('第1项 原作事实',{exact:true})).toHaveValue('作者核对：林岚到达旧车站。')
 await expect(candidate.locator('.comic-candidate-items input').nth(1)).not.toBeChecked()
 expect(calls).toBe(1)
 await candidate.getByRole('button',{name:'作者确认并采纳',exact:true}).click()
 await expect(candidate).toHaveCount(0)
 await page.getByRole('navigation',{name:'漫画内容分类'}).getByRole('button',{name:'原作事实',exact:true}).click()
 await expect(page.getByLabel('第1项 原作事实',{exact:true})).toHaveValue('作者核对：林岚到达旧车站。')
 await expect(page.getByLabel('第2项 原作事实',{exact:true})).toHaveCount(0)
 expect(calls).toBe(1)
})
