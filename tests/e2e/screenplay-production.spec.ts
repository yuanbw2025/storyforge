import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('小说转剧本从产品入口冻结来源，经专业生产数据发布并导出 Fountain', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')

  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /长篇小说/ }).click()
  await page.getByLabel('名称').fill('E2E 剧本来源小说')
  await page.getByRole('button', { name: '创建长篇小说', exact: true }).click()
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+\?module=outline$/)
  await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { stampNewRecord }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/workspace/scope.ts'),
    ])
    const project = (await db.projects.toArray()).find((row: any) => row.name === 'E2E 剧本来源小说')
    if (!project?.id || !project.activeWorldId || !project.activeWorkId) throw new Error('E2E 小说 scope 缺失')
    const scope = { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
    const now = Date.now()
    await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      projectId: project.id,
      workId: project.activeWorkId,
      worldGroupId: null,
      parentId: null,
      type: 'volume',
      title: '青云山门',
      summary: '林惊羽踏入青云山门，必须在复仇冲动与守护责任之间作出选择。',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }))
  })

  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /小说转剧本/ }).click()
  await expect(page.getByLabel('小说来源')).toContainText('E2E 剧本来源小说')
  await page.getByLabel('名称').fill('E2E 山门电影剧本')
  await page.getByLabel('剧本类型').selectOption('film')
  await page.getByLabel('单集目标分钟').fill('1')
  await page.getByRole('button', { name: '创建剧本项目', exact: true }).click()

  await expect(page.getByRole('heading', { name: '正规剧本工作台', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '十步小说转剧本', exact: true })).toBeVisible()
  for (const stage of ['1 来源事实', '2 因果图', '3 改编 Brief', '4 删改决定', '5 Beat Sheet', '6 Scene Cards', '7 逐场写作', '8 来源审查', '9 戏剧审查', '10 定点修订']) {
    await expect(page.locator('.screenplay-pipeline-steps').getByText(stage, { exact: true })).toBeVisible()
  }
  await expect(page.getByText('候选 · 尚未写入')).toHaveCount(0)

  const result = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { listActiveSourceUnits, saveAdaptationBriefDraft, confirmAdaptationBrief },
      { adoptAdaptationSourceFactsV1, adoptAdaptationCausalEdgesV1, adoptAdaptationDecisionsV1 },
      { adoptScreenplayBeatsV1, adoptScreenplaySceneCardsV1, startScreenplayProductionV1, adoptScreenplayReviewIssuesV1 },
      { createScreenplayScene, updateScreenplayScene },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/adaptation/source-manifest.ts'),
      importer('/storyforge/src/lib/adaptation/analysis.ts'),
      importer('/storyforge/src/lib/screenplay/production.ts'),
      importer('/storyforge/src/lib/screenplay/service.ts'),
    ])
    const work = (await db.works.toArray()).find((row: any) => row.title === 'E2E 山门电影剧本')
    if (!work?.id) throw new Error('E2E 剧本 Work 缺失')
    let root = await db.adaptationProjects.where('workId').equals(work.id).first()
    if (!root?.id) throw new Error('E2E 剧本根缺失')
    const scope = { projectId: root.projectId, worldId: root.worldId, workId: root.workId }
    const unit = (await listActiveSourceUnits(root.id)).find((row: any) => row.sourceKind !== 'work')
    if (!unit?.id) throw new Error('E2E 冻结来源单元缺失')

    await adoptAdaptationSourceFactsV1({
      scope,
      adaptationProjectId: root.id,
      expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion,
      items: [
        { authorStatus: 'confirmed', candidate: { stableKey: 'fact.enter-gate', kind: 'event', statement: '林惊羽踏入青云山门。', subjectKeys: ['character.lin-jingyu'], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 } },
        { authorStatus: 'confirmed', candidate: { stableKey: 'fact.choose', kind: 'character-state', statement: '林惊羽必须在复仇与守护之间选择。', subjectKeys: ['character.lin-jingyu'], sourceUnitKeys: [unit.sourceUnitKey], confidence: 0.9 } },
      ],
    })
    root = await db.adaptationProjects.get(root.id)
    await adoptAdaptationCausalEdgesV1({
      scope,
      adaptationProjectId: root.id,
      expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion,
      items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'edge.gate-choice', fromFactKey: 'fact.enter-gate', toFactKey: 'fact.choose', relation: 'enables', rationale: '踏入山门让选择进入当下行动。', sourceUnitKeys: [unit.sourceUnitKey] } }],
    })
    root = await db.adaptationProjects.get(root.id)
    await adoptAdaptationDecisionsV1({
      scope,
      adaptationProjectId: root.id,
      expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion,
      items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'decision.keep-choice', action: 'keep', sourceFactKeys: ['fact.choose'], targetKeys: ['act-1'], rationale: '保留核心选择作为戏剧主轴。' } }],
    })
    root = await db.adaptationProjects.get(root.id)
    root = await saveAdaptationBriefDraft({
      adaptationProjectId: root.id,
      expectedRevision: root.revision,
      brief: {
        version: 1,
        coreTheme: '选择与代价',
        dominantEmotion: '克制',
        mustKeep: ['山门抉择'],
        mayCut: [],
        mayMerge: [],
        mayReorder: [],
        allowedAdditions: [],
        audience: '大众电影观众',
        rating: 'PG-13',
        targetScale: '一分钟验证短片',
        narrativePerspective: '林惊羽',
        timeBudget: '60 秒',
        costLimit: '单场景',
        deviationNotes: '',
        unresolvedQuestions: [],
        assumptions: [],
      },
    })
    root = await confirmAdaptationBrief({ adaptationProjectId: root.id, expectedRevision: root.revision })
    await adoptScreenplayBeatsV1({
      scope,
      expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion,
      candidates: [{
        stableKey: 'beat-1', sectionKey: 'act-1', sectionTitle: '第一幕', scope: 'act', episodeNumber: 1, order: 0,
        objective: '林惊羽进入山门。', conflict: '复仇冲动与守护责任冲突。', turn: '山门危机出现。', outcome: '他先守护山门。',
        causalFactKeys: ['fact.enter-gate', 'fact.choose'], decisionKeys: ['decision.keep-choice'], sourceUnitKeys: [unit.sourceUnitKey], estimatedSeconds: 60,
      }],
    })
    root = await db.adaptationProjects.get(root.id)
    await adoptScreenplaySceneCardsV1({
      scope,
      expectedAdaptationRevision: root.revision,
      sourceManifestVersion: root.activeSourceManifestVersion,
      candidates: [{
        stableKey: 'scene-1', beatKey: 'beat-1', episodeNumber: 1, sceneNumber: 1, order: 0,
        purpose: '建立空间并完成选择。', conflict: '复仇冲动与守护责任冲突。', entryState: '只追寻复仇。', exitState: '选择守护。',
        visibleAction: '林惊羽踏上石阶并挡在山门前。', informationReveal: '危机与仇敌有关。', sourceUnitKeys: [unit.sourceUnitKey], estimatedSeconds: 60,
      }],
    })
    root = await db.adaptationProjects.get(root.id)
    root = await startScreenplayProductionV1({ scope, expectedAdaptationRevision: root.revision })
    let scene = await createScreenplayScene(scope, {
      stableKey: 'scene-1', planSectionKey: 'act-1', episodeNumber: 1, sceneNumber: 1, intExt: 'EXT', location: '青云山门', timeOfDay: '晨',
      summary: '林惊羽踏入山门并选择守护。', estimatedSeconds: 60, sourceUnitIds: [unit.id],
      blocks: [
        { id: 'action-1', type: 'action', text: '云海散开。林惊羽踏上石阶，挡在震动的山门之前。' },
        { id: 'cue-1', type: 'character', name: '林惊羽' },
        { id: 'dialogue-1', type: 'dialogue', text: '先守住这里。' },
      ],
    })
    await adoptScreenplayReviewIssuesV1({
      scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion,
      category: 'grounding', targetSceneKeys: ['scene-1'], expectedSceneRevisions: { 'scene-1': scene.revision }, candidates: [],
    })
    root = await db.adaptationProjects.get(root.id)
    await adoptScreenplayReviewIssuesV1({
      scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion,
      category: 'dramaturgy', targetSceneKeys: ['scene-1'], expectedSceneRevisions: { 'scene-1': scene.revision }, candidates: [],
    })
    scene = await db.screenplayScenes.get(scene.id)
    scene = await updateScreenplayScene({ scope, sceneId: scene.id, expectedRevision: scene.revision, patch: { status: 'reviewed' } })
    return { status: scene.status, revision: scene.revision }
  })
  expect(result.status).toBe('reviewed')

  await page.reload()
  await page.getByTestId('product-tab-novel').click()
  await expect(page.getByText('EXT 青云山门 - 晨', { exact: true })).toBeVisible()
  const publish = page.getByRole('button', { name: '发布不可变版本', exact: true })
  await expect(publish).toBeEnabled()
  await publish.click()
  await expect(page.getByRole('button', { name: '已发布 v1', exact: true })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Fountain', exact: true }).click()
  const artifact = await download
  const path = await artifact.path()
  expect(path).not.toBeNull()
  const fountain = await readFile(path!, 'utf8')
  expect(fountain).toContain('Title: E2E 山门电影剧本')
  expect(fountain).toContain('EXT. 青云山门 - 晨')
  expect(fountain).toContain('林惊羽')

  await page.reload()
  await page.getByTestId('product-tab-novel').click()
  await expect(page.getByRole('button', { name: '已发布 v1', exact: true })).toBeVisible()

  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /小说转剧本/ }).click()
  await page.getByLabel('名称').fill('E2E 三集剧')
  await page.getByLabel('剧本类型').selectOption('series')
  await page.getByLabel('集数').fill('3')
  await page.getByLabel('单集目标分钟').fill('45')
  await page.getByRole('button', { name: '创建剧本项目', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'E2E 三集剧', exact: true })).toBeVisible()
  await expect(page.getByText('剧集 · 结构化正规剧本', { exact: true })).toBeVisible()

  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /小说转剧本/ }).click()
  await page.getByLabel('名称').fill('E2E 短剧')
  await page.getByLabel('剧本类型').selectOption('short-drama')
  await page.getByLabel('集数').fill('12')
  await page.getByLabel('单集目标分钟').fill('2')
  await page.getByRole('button', { name: '创建剧本项目', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'E2E 短剧', exact: true })).toBeVisible()
  await expect(page.getByText('短剧 · 结构化正规剧本', { exact: true })).toBeVisible()
})
