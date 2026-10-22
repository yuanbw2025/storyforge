import { expect, test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated open preview') })

/** Real author UI, native IndexedDB and governed production/publish; HTTP outputs are explicit fixtures. */
test('the author reviews original facts and numeric mappings through normal controls, then publishes with three model requests', async ({ page }, info) => {
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await load('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
    const f = await helper.seedOpenBrowserProductionV1()
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const details = await (await load('/storyforge/src/lib/product-production/service.ts')).readProductProductionDetailsV1(f.scope, f.productionId)
    const data = await (await load('/storyforge/tests/helpers/open-ttrpg-production-artifacts.ts')).openProductionCompilerFixtureV1(true, { ...f, brief: details.executionBrief })
    const project = await db.projects.get(f.scope.projectId)
    await (await load('/storyforge/src/lib/workspace/works.ts')).updateWorkspace(f.scope.projectId,
      { productPlatformOptIns: { ...project.productPlatformOptIns, productProductionV3: true } })
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'fixture-author-review',
      baseUrl: location.origin + '/fixture-author-review/v1', apiKey: 'fixture-only-not-a-real-key',
      maxTokens: 24000, contextWindow: 131072 })
    return { ...f, data, buildId: details.build.id, worlds: await db.worldReleases.toArray() }
  })
  const seen: string[] = []
  await page.route('**/fixture-author-review/v1/chat/completions', async route => {
    const system = route.request().postDataJSON().messages.find((message: { role: string }) => message.role === 'system').content
    const key = system.includes('storyforge.ttrpg-open-source-facts') ? 'sourceFacts'
      : system.includes('storyforge.ttrpg-open-rule-system') ? 'ruleSystem'
        : system.includes('storyforge.ttrpg-open-situation-layer') ? 'situationLayer' : null
    if (!key) throw Error('Unexpected fixture provider request')
    seen.push(key)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify(f.data[key]) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    }) })
  })
  await page.goto(`./ttrpg/production?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
  const review = page.getByTestId('ttrpg-open-production-review')
  await expect(review).toBeVisible({ timeout: 30000 })
  await expect(review.getByRole('heading', { name: '核对来源事实', exact: true })).toBeVisible()
  // The review shell can render before the first asynchronous request starts.
  await expect.poll(() => seen).toEqual(['sourceFacts'])
  await review.getByRole('button', { name: '读取本任务待审稿', exact: true }).click()
  await expect(review.getByRole('checkbox').first()).toBeVisible()
  for (const checkbox of await review.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked()
  await review.getByRole('checkbox').first().check()
  await page.reload()
  await expect(review).toBeVisible()
  await review.getByRole('button', { name: '读取本任务待审稿', exact: true }).click()
  await expect(review.getByRole('checkbox').first()).toBeVisible()
  for (const checkbox of await review.getByRole('checkbox').all()) { await expect(checkbox).not.toBeChecked(); await checkbox.check() }
  expect(seen).toEqual(['sourceFacts'])
  await page.getByRole('button', { name: '修正后继续制作', exact: true }).click()
  await expect(review.getByRole('heading', { name: '核对角色属性', exact: true })).toBeVisible({ timeout: 30000 })
  expect(seen).toEqual(['sourceFacts', 'ruleSystem'])
  await review.getByRole('button', { name: '读取本任务待审稿', exact: true }).click()
  await expect(review.getByRole('checkbox').first()).toBeVisible()
  expect(await review.getByRole('checkbox').count()).toBeGreaterThan(1)
  await review.getByRole('checkbox').first().check()
  await page.getByText('直接修订任务草稿（高级）', { exact: true }).click()
  const editor = page.getByLabel('作者修订的完整任务 JSON', { exact: true })
  const authorDraft = JSON.parse(await editor.inputValue())
  authorDraft.characterTemplates[0].description += ' 作者保留的修订说明。'
  await editor.fill(JSON.stringify(authorDraft))
  const previousEpoch = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    return (await db.productBuilds.get(f.buildId)).controlEpoch
  }, f)
  await page.getByRole('button', { name: '修正后继续制作', exact: true }).click()
  await expect.poll(() => page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.get(f.buildId)
    return { epoch: build.controlEpoch, status: build.status, code: JSON.parse(build.failureJson).code }
  }, f)).toEqual({ epoch: previousEpoch + 1, status: 'recovery-required', code: 'task-draft-rejected' })
  await page.reload()
  await review.getByRole('button', { name: '读取本任务待审稿', exact: true }).click()
  await expect(review.getByRole('checkbox').first()).toBeVisible()
  await expect(review).toContainText('作者保留的修订说明。')
  expect(seen).toEqual(['sourceFacts', 'ruleSystem'])
  for (const checkbox of await review.getByRole('checkbox').all()) { await expect(checkbox).not.toBeChecked(); await checkbox.check() }
  await page.screenshot({ path: info.outputPath('author-reviewed-original-numeric-mappings.png'), fullPage: true })
  await page.getByRole('button', { name: '修正后继续制作', exact: true }).click()
  await expect(page.getByRole('button', { name: '复验并原子发布', exact: true })).toBeVisible({ timeout: 30000 })
  expect(seen).toEqual(['sourceFacts', 'ruleSystem', 'situationLayer'])
  await page.getByRole('button', { name: '复验并原子发布', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/play/, { timeout: 20000 })
  const after = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { build: await db.productBuilds.get(f.buildId), releases: await db.productReleases.where('workId').equals(f.scope.workId).toArray(),
      worlds: await db.worldReleases.toArray(), commands: await db.productProductionCommands.where('productionId').equals(f.productionId).toArray() }
  }, f)
  expect(after.worlds).toEqual(f.worlds); expect(after.build.status).toBe('released'); expect(after.releases).toHaveLength(1)
  const edits = after.commands.filter((row: any) => row.type === 'resolve-blocker' && JSON.parse(row.resultJson).action === 'author-edit')
  expect(edits).toHaveLength(3)
  expect(JSON.parse(after.build.budgetLedgerJson).attempts.reduce((n: number, row: any) => n + (row.usage?.modelCalls ?? 0), 0)).toBe(3)
  await info.attach('three-fixture-calls-three-explicit-author-revisions-with-input-recovery', { contentType: 'application/json',
    body: JSON.stringify({ seen, buildId: f.buildId, commands: edits, provider: 'fixture HTTP only', independentHumanAcceptance: false }) })
})
