import { expect, test } from '@playwright/test'
test('the player reviews real risk, selects a discovery cost and sees persisted live resources', async ({ page }) => {
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated preview')
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const h = await importer('/storyforge/tests/helpers/open-ttrpg-knowledge.ts'), e = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts'), a = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const f = await h.setup({ generic: true, cost: true, failForward: true }, (pkg: any) => {
      pkg.ttrpg.campaign.informationPolicy.hiddenDice = 'never'
      const t = pkg.ttrpg.campaign.effectPlanTemplates.find((t: any) => t.planKey === 'plan.discovery.cost')
      t.alternatives = [{ alternativeKey: 'small', title: '少量消耗', effects: t.effects }, { alternativeKey: 'large', title: '更多消耗', effects: t.effects.map((x: any) => ({ ...x, amount: 2 })) }];t.effects = []
    })
    await a.startTtrpgOpenOperationV1({ ...await e.openEnvelopeV1(f.sessionId, 'browser.risk.start'), viewerKey: e.OPEN_HUMAN_VIEWER, request: f.request })
    const resource = f.runtimePackage.ttrpg.rulePack.content.resources[0]
    return { sessionId: f.sessionId, viewerKey: e.OPEN_HUMAN_VIEWER, resourceKey: resource.key, resourceName: resource.name, initial: Number((await a.readProductRuntimeState(f.sessionId)).entities.hero.attributes[`resource.${resource.key}`]) }
  })
  await page.goto(`./play/session/${f.sessionId}`)
  await page.getByLabel('我的角色', { exact: true }).selectOption(f.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByRole('region', { name: '本次行动风险与后果', exact: true })).toContainText('消耗 2')
  await expect(page.getByRole('region', { name: '我的当前状态', exact: true })).toContainText(`${f.resourceName}：${f.initial}`)
  for (let n = 0; n < 3 && await page.getByRole('button', { name: '同意以上风险与代价', exact: true }).count(); n++) {
    const buttons = page.getByRole('button', { name: '同意以上风险与代价', exact: true }), count = await buttons.count()
    await buttons.first().click();await expect(buttons).toHaveCount(count - 1)
  }
  await expect(page.getByRole('button', { name: '同意以上风险与代价', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '继续结算已确认的行动', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择「更多消耗」', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '选择「更多消耗」', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择「更多消耗」', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '继续结算已确认的行动', exact: true }).click()
  await expect(page.getByRole('region', { name: '我的当前状态', exact: true })).toContainText(`${f.resourceName}：${f.initial - 2}`)
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption(f.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByRole('region', { name: '我的当前状态', exact: true })).toContainText(`${f.resourceName}：${f.initial - 2}`)
  const state = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    return (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(sessionId)
  }, f.sessionId)
  expect(state.ttrpg.openRun.operations[0].discoveryChoices).toMatchObject([{ templateKey: 'plan.discovery.cost', alternativeKey: 'large' }])
  expect(state.ttrpg.openRun.knowledge).toHaveLength(1)
  expect(state.ttrpg.openRun.coordination.calls).toEqual([])
})
