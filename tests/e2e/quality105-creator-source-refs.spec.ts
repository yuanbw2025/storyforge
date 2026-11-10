import { expect, test } from '@playwright/test'

test('SFQA105 real reused NPC selection, visible fields, author confirmation and child Build preserve target ownership', async ({ page, context }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa105'))
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('./')
  await page.waitForFunction(() => Boolean(document.querySelector('#root')?.childElementCount))
  const fixture = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const helper = await importer<typeof import('../helpers/sfqa105-creator-source-refs')>('/storyforge/tests/helpers/sfqa105-creator-source-refs.ts')
    return helper.seedSfqa105GovernedBuild()
  })
  await page.goto(`./openworld/runtime?project=${fixture.scope.projectId}&mode=production`)
  const browser = page.getByTestId('text-open-world-creator-artifact-browser')
  await expect(browser).toBeVisible({ timeout: 30_000 })
  await expect(browser).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await browser.getByRole('searchbox', { name: /安全搜索/ }).fill(fixture.entityIdentity.split(':').slice(1).join(':'))
  await browser.getByRole('list', { name: '内容实体列表', exact: true })
    .locator(`[data-open-world-artifact-locator="entity:${fixture.entityIdentity}"]`).click()
  await expect(browser.getByTestId('text-open-world-creator-entity-detail')).toContainText(fixture.name)
  const editor = browser.getByTestId('text-open-world-creator-artifact-editor')
  await expect(editor).toBeVisible({ timeout: 30_000 })
  const biographyLabel = `actors[${fixture.demandNumber}].biography`
  const biography = editor.getByRole('textbox', { name: biographyLabel, exact: true })
  await expect(biography).toHaveValue(fixture.biography)
  await expect(editor.getByRole('textbox')).toHaveCount(3)
  const edited = '作者仅修订所选保留角色的身世，确认后仍由同一稳定角色拥有。'
  await biography.fill(edited)
  await editor.getByRole('button', { name: '生成修改候选', exact: true }).click()
  const confirm = editor.getByRole('button', { name: '确认修改方案并进入影响分析', exact: true })
  await expect(confirm).toBeEnabled({ timeout: 30_000 })
  await confirm.click()
  const repair = editor.getByTestId('text-open-world-creator-repair-impact')
  await expect(repair).toBeVisible({ timeout: 30_000 })
  await repair.getByRole('checkbox', { name: /我已核对：直接修改会在新 Build 中采用/ }).check()
  await repair.getByRole('button', { name: '确认范围并创建修复 Build', exact: true }).click()
  await expect.poll(async () => page.evaluate(async data => {
    const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await importer<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return db.productBuilds.where('[productionId+buildNumber]').equals([data.productionId, data.buildNumber + 1]).count()
  }, fixture), { timeout: 30_000 }).toBe(1)
  const adopted = await page.evaluate(async data => {
    const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const helper = await importer<typeof import('../helpers/sfqa105-creator-source-refs')>('/storyforge/tests/helpers/sfqa105-creator-source-refs.ts')
    return helper.adoptSfqa105RepairTarget(data)
  }, fixture)
  const key = fixture.entityIdentity.slice('character:'.length)
  expect(adopted.catalog.actors.find(row => row.key === key)?.biography).toBe(edited)
  expect(adopted.catalog.actors.filter(row => row.key !== key)).toEqual(fixture.catalog.actors.filter(row => row.key !== key))
  expect(adopted.catalog.factions).toEqual(fixture.catalog.factions)
  expect(adopted.catalog.schedules).toEqual(fixture.catalog.schedules)
  expect(adopted.parentBuildHash).toBe(fixture.buildHash)
  expect(adopted.parentArtifactsHash).toBe(fixture.artifactsHash)
  expect(adopted.modelResponses).toBe(fixture.modelResponses)
  expect(adopted.childNumber).toBe(fixture.buildNumber + 1)
  expect(adopted.transportCalls).toBe(0)
  expect(adopted.targetState).toBe('completed')
  expect(adopted.targetReceiptMatches).toBe(true)
  await page.reload()
  const reloaded = await page.evaluate(async ({ scope, childId }) => {
    const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { readAcceptedBuildArtifacts } = await importer<typeof import('../../src/lib/product-production/artifact-store')>('/storyforge/src/lib/product-production/artifact-store.ts')
    const rows = await readAcceptedBuildArtifacts({ scope, buildId: childId })
    return rows.find(row => row.artifactKey === 'text-open-world.npc-runtime-catalog')?.payloadJson
  }, { scope: fixture.scope, childId: adopted.childId })
  expect(reloaded ? JSON.parse(reloaded) : null).toEqual(adopted.catalog)
  expect(errors).toEqual([])
})
