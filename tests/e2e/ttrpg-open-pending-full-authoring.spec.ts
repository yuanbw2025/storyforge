import { expect, test } from '@playwright/test'
test.setTimeout(120000)
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open author preview') })

/** Existing release fixture replies are explicit simulations. All new POSTs blocked. */
test('normal author imports a new rule and explicitly saves the full pending version without starting or changing the old save', async ({ page }, info) => {
  const posts: string[] = []
  await page.route('**/*', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    posts.push(new URL(route.request().url()).pathname); return route.abort('blockedbyclient')
  })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts'), helper = await load('/storyforge/tests/helpers/open-ttrpg-production-browser.ts'), service = await load('/storyforge/src/lib/product-production/service.ts')
    const f = await helper.seedOpenBrowserProductionV1({ runtimeAIEnabled: true })
    let result = await helper.runOpenBrowserProductionV1(f)
    for (let i = 0; i < 2 && !result.terminal; i++) result = await helper.runOpenBrowserProductionV1(f, true)
    if (!result.terminal) throw Error('explicit simulated initial production incomplete')
    const published = await service.publishProductProductionV1(f)
    const session = await (await load('/storyforge/src/lib/product/runtime-instances.ts')).createProductRuntimeInstanceFromSource({ scope: f.scope,
      source: { kind: 'release', productReleaseId: published.receipt.productReleaseId }, title: '保留原版存档', seed: 'full.author.native.old' })
    await service.beginProductProductionEvolutionV1({ ...f, userText: '作者明确改动新版本的合作开场和规则，旧发布与存档保留。', affectedLanes: ['runtime'] })
    const project = await db.projects.get(f.scope.projectId)
    await (await load('/storyforge/src/lib/workspace/works.ts')).updateWorkspace(f.scope.projectId,
      { productPlatformOptIns: { ...project.productPlatformOptIns, productProductionV3: true } })
    const p = await db.productProductions.get(f.productionId), row = await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, p.currentBriefRevision]).first()
    const brief = JSON.parse(row.briefJson), rule = structuredClone(brief.ttrpgOpen.rulePack)
    rule.ruleSystemVersion = '3.0.1'; rule.description += ' 本版本的作者规则说明已修订。'
    return { ...f, rule, oldRules: await db.ttrpgRulePacks.toArray(), oldReleases: await db.productReleases.toArray(), oldBuilds: await db.productBuilds.toArray(), oldRuns: await db.agentRuns.toArray(),
      worldReleases: await db.worldReleases.toArray(), production: p, row, brief, sessionId: session.id,
      state: await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(session.id) }
  })
  const url = (step: string) => `./ttrpg/${step}?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`
  await page.goto(url('rules'))
  await page.getByLabel('开放跑团规则文件', { exact: true }).setInputFiles({ name: 'author-rule-3.0.1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(f.rule)) })
  await expect(page.getByTestId('ttrpg-open-rule-candidate')).toContainText('3.0.1')
  await page.getByRole('button', { name: '确认并使用这份规则', exact: true }).click()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByText('制作配置已保存', { exact: true })).toBeVisible()
  await page.goto(url('vision'))
  await page.getByRole('textbox', { name: /^开场与核心目标/ }).fill('三名调查员在共同集合点公开协商独立复核的方法，不预设已经取得实物或查阅许可。')
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByText('制作配置已保存', { exact: true })).toBeVisible()
  await page.goto(url('confirm'))
  await page.getByRole('button', { name: '生成或更新审查方案', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('只支持调整')
  await page.getByRole('button', { name: '为待开始的新版本更新完整方案', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/agent/)
  const after = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const p = await db.productProductions.get(f.productionId), row = await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, p.currentBriefRevision]).first()
    return { production: p, row, brief: JSON.parse(row.briefJson), oldRules: await Promise.all(f.oldRules.map((r: any) => db.ttrpgRulePacks.get(r.id))),
      releases: await db.productReleases.toArray(), builds: await db.productBuilds.toArray(), runs: await db.agentRuns.toArray(), worlds: await db.worldReleases.toArray(),
      state: await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId) }
  }, f)
  expect(after.production.status).toBe('brief-ready'); expect(after.production.currentBuildNumber).toBe(f.production.currentBuildNumber)
  expect(after.row.revision).toBe(f.row.revision + 1); expect(after.row.status).toBe('draft'); expect(after.row.authorizedAt).toBeNull()
  expect(after.brief.ttrpgOpen.rulePack.ruleSystemVersion).toBe('3.0.1'); expect(after.brief.ttrpgOpen.settings.openingSituation).toContain('共同集合点')
  expect(after.brief.productionBudget).toEqual(f.brief.productionBudget); expect(after.brief.ttrpgOpen.sourcePlan).toEqual(f.brief.ttrpgOpen.sourcePlan)
  expect(after.oldRules).toEqual(f.oldRules); expect(after.releases).toEqual(f.oldReleases); expect(after.builds).toEqual(f.oldBuilds)
  expect(after.runs).toEqual(f.oldRuns); expect(after.worlds).toEqual(f.worldReleases); expect(after.state).toEqual(f.state); expect(posts).toEqual([])
  await page.screenshot({ path: info.outputPath('full-authoring-pending-review.png'), fullPage: true })
})
