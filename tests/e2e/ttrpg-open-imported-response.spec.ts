import { expect, test } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated experimental preview required'))
test('native imported response remains exact, refreshable and read-only before a fresh human risk proposal', async ({ page }, testInfo) => {
  test.setTimeout(120000)
  let sends = 0
  await page.route('https://imported-response.invalid/**', async route => { sends++;await route.abort() })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-portability.ts'), table = await importer('/storyforge/src/lib/ttrpg/open-table-service.ts')
    const harness = await importer('/storyforge/src/lib/ttrpg/open-intent-harness.ts'), io = await importer('/storyforge/src/lib/export/json-export.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'), scopeApi = await importer('/storyforge/src/lib/workspace/scope.ts')
    const api = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const source = await helper.preparePortableOpenRequestV1('历史回答与真人接手', undefined, async (ready: any) => {
      await table.startTtrpgOpenTableV1({ scope: ready.scope, sessionId: ready.sessionId, viewerKey: 'viewer.seat.hero', acceptedItemKeys: [] })
    })
    const text = JSON.stringify({ goal: '历史回答：检查河港 <img src=x onerror=alert(1)>', method: '复核现场', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
    await harness.executeTtrpgOpenIntentRequestV1({ ...source.input, ...source.prepared, sessionId: source.sessionId, runAI: async () => text })
    const original = await api.readProductRuntimeState(source.sessionId), projectId = await io.importProjectJSON(await io.exportProjectJSON(source.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await scopeApi.resolveScope({ scope: { projectId, worldId: session.worldId, workId: session.workId } })
    return { scope, sessionId: session.id, viewerKey: 'viewer.seat.hero', sourceSessionId: source.sessionId, original, text }
  })
  async function enter() {
    await page.getByLabel('我的角色', { exact: true }).selectOption(f.viewerKey)
    await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  }
  await page.goto(`./play/session/${f.sessionId}`);await enter()
  await expect(page.getByLabel('待确认候选', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('待恢复的模型回复', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '查看行动建议原回复', exact: true }).click()
  const archive = page.getByLabel('历史回复原文', { exact: true })
  await expect(archive.locator('pre')).toHaveText(f.text)
  await expect(archive.locator('img,script')).toHaveCount(0)
  await expect(archive).toContainText('查看不会调用模型或新增行动')
  await page.screenshot({ path: testInfo.outputPath('imported-response-read-only.png'), fullPage: true })
  await page.reload();await enter()
  await expect(page.getByLabel('历史回复原文', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '查看行动建议原回复', exact: true }).click()
  await expect(page.getByLabel('历史回复原文').locator('pre')).toHaveText(f.text)
  await page.getByRole('button', { name: '结束本轮主持，准备下一次行动', exact: true }).click()
  await expect(page.getByLabel('行动规则', { exact: true })).toBeVisible()
  const selection = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const table = await importer('/storyforge/src/lib/ttrpg/open-table-service.ts'),catalog = await table.readTtrpgOpenManualActionCatalogV1(f)
    const rule = catalog.rules.find((r: any) => r.route === 'existing-action' && r.available && r.targets.length)
    return { rule: JSON.stringify([rule.route,rule.ruleKey]),target: JSON.stringify(rule.targets[0].key),parameters: rule.parameters.map((p: any) => JSON.stringify(p.options[0]?.key ?? null)) }
  }, f)
  await page.getByLabel('行动规则', { exact: true }).selectOption(selection.rule)
  await page.getByLabel('行动对象', { exact: true }).selectOption(selection.target)
  for (let i=0;i<selection.parameters.length;i++) await page.getByLabel(`行动后果对象 ${i+1}`, { exact: true }).selectOption(selection.parameters[i])
  await page.getByLabel('人工行动说明', { exact: true }).fill('核对历史回答后，我明确按当前规则检查现场。')
  await page.getByRole('button', { name: '提出行动，查看风险', exact: true }).click()
  await expect(page.getByRole('button', { name: '同意以上风险与代价', exact: true })).toBeVisible()
  const final = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/product/runtime-core.ts')
    return { source: await api.readProductRuntimeState(f.sourceSessionId), copy: await api.readProductRuntimeState(f.sessionId) }
  }, f)
  expect(final.source).toEqual(f.original)
  expect(final.copy.entities).toEqual(f.original.entities)
  expect(final.copy.ttrpg.openRun.coordination.calls).toEqual(f.original.ttrpg.openRun.coordination.calls)
  expect(sends).toBe(0)
})
