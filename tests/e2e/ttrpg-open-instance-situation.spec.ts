import { expect, test } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
for (const humanGm of [true, false]) test(`${humanGm ? 'private GM' : 'common party'}: explicit instance opt-in reaches actual HTTP, adoption, separate activation, reload and backup`, async ({ page }) => {
  test.setTimeout(240000)
  await page.goto('./')
  const f = await page.evaluate(async humanGm => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const s = await (await load('/storyforge/tests/helpers/open-instance-situation.ts')).setupInstanceSituationV1(humanGm)
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'native-instance-situation', apiKey: 'test-only-key',
      baseUrl: 'https://ttrpg-instance-situation.invalid/v1', maxTokens: 8000, contextWindow: 50000 })
    return { input: s.deskInput, npc: s.npc, place: s.place }
  }, humanGm)
  const sends: string[] = []
  await page.route('https://ttrpg-instance-situation.invalid/v1/chat/completions', async route => {
    sends.push(route.request().postData() ?? '')
    const value = await page.evaluate(async ({ f, humanGm }) => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      let kernel: any, value: any
      if (humanGm) {
        kernel = await (await load('/storyforge/src/lib/ttrpg/open-generated-situation-context.ts')).loadTtrpgOpenSituationKernelInputV1({ ...f.input, actorKey: 'gm' })
        value = (await load('/storyforge/tests/helpers/open-situation-generation.ts')).situationGenerationOutputV1(kernel.basis)
        value.template.preconditions = [{ op: 'actor-at', actorKey: f.npc, locationRef: 'harbor' }]
        value.template.obstacles[0].ref = f.place; value.template.sourceRefs.push(f.place)
      } else {
        const run = (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.input.sessionId)).ttrpg.openRun
        const epoch = run.coordination.epochs.find((row: any) => row.epochKey === run.coordination.activeEpochKey)
        kernel = await (await load('/storyforge/src/lib/ttrpg/open-public-situation-kernel.ts')).loadTtrpgOpenPublicSituationKernelV1({ ...f.input, actorKey: 'gm' }, epoch.publicSituation)
        value = (await load('/storyforge/tests/helpers/open-public-situation-generation.ts')).publicSituationOutputV1(kernel)
        value.template.obstacles[0].ref = f.npc
        value.template.obstacles.forEach((row: any) => { row.predicate = { op: 'world-turn-at-least', value: 20 } })
      }
      value.template.driverBinding = { kind: 'npc', characterKey: f.npc }; value.template.sourceRefs.push(f.npc)
      return value
    }, { f, humanGm })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'native-instance-situation', model: 'native-instance-situation',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } }) })
  })
  await page.goto('./play/session/' + f.input.sessionId)
  if (humanGm) {
    await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
    await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
    await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  } else {
    await page.getByLabel('我的角色', { exact: true }).selectOption(f.input.viewerKey)
    await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  }
  const card = page.getByTestId(humanGm ? 'ttrpg-open-situation-desk' : 'ttrpg-open-public-situation-desk')
  await expect(card).toBeVisible(); await card.locator('summary').first().click()
  const optIn = card.getByRole('checkbox', { name: humanGm ? /本次允许引用本局已创建的对象/ : /本次允许引用全队共同可知的已创建对象/ })
  await expect(optIn).not.toBeChecked(); await expect(optIn).toBeEnabled()
  await card.getByLabel(humanGm ? '局势拟定要求' : '本次共同局势要求', { exact: true }).fill(humanGm
    ? '结合港口、英雄身份、新守灯人及新候选地点，拟定由新守灯人驱动的局势。完整读取人物、地点与原授权模板。'
    : '结合大家已知的新守灯人和港口，为英雄拟定新局势。')
  if (!humanGm) {
    await card.getByLabel('我同意把以上本次输入共享给当前队伍。', { exact: true }).check()
    await card.getByLabel('我委托 AI 主持在检查通过后采用本次这一个候选，保存局势定义。', { exact: true }).check()
  }
  await optIn.check()
  if (!humanGm) {
    await expect(card.getByLabel('我同意把以上本次输入共享给当前队伍。', { exact: true })).not.toBeChecked()
    await expect(card.getByLabel('我委托 AI 主持在检查通过后采用本次这一个候选，保存局势定义。', { exact: true })).not.toBeChecked()
    await card.getByLabel('我同意把以上本次输入共享给当前队伍。', { exact: true }).check()
    await card.getByLabel('我委托 AI 主持在检查通过后采用本次这一个候选，保存局势定义。', { exact: true }).check()
  }
  await card.getByRole('button', { name: humanGm ? '请求 AI 拟定局势' : '请求并保存一个共同局势', exact: true }).click()
  if (humanGm) {
    const accept = card.getByRole('button', { name: '确认披露并采用局势', exact: true })
    await expect(accept).toBeVisible({ timeout: 60000 }); await expect(accept).toBeDisabled()
    await card.getByLabel('我已审阅本版本的玩家标题、提示、线索正文和披露条件，同意保存此版本。', { exact: true }).check()
    await accept.click()
    const end = card.getByRole('button', { name: '结束本次局势拟定', exact: true }); await expect(end).toBeEnabled(); await end.click()
  } else await expect(card.getByText('局势定义已保存，尚未启用时可在下方单独启用。', { exact: true })).toBeVisible({ timeout: 60000 })
  const enable = card.getByRole('region', { name: humanGm ? '本局已采用局势' : '本局共同局势', exact: true }).getByRole('button')
  await expect(enable).toBeEnabled({ timeout: 30000 }); await enable.click()
  await expect(card.getByText('该局势已启用。', { exact: true })).toBeVisible({ timeout: 30000 })
  expect(sends).toHaveLength(1); expect(sends[0]).toContain(f.npc)
  if (!humanGm) for (const hidden of [f.place, f.npc + '.equipment.0', 'INSTANCE-SITUATION-PRIVATE-NPC-PROFILE', 'gmProfile', 'dynamicTemplateKey', 'frozenContentJson']) expect(sends[0]).not.toContain(hidden)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: test.info().outputPath(`instance-situation-${humanGm ? 'gm' : 'party'}-mobile.png`), fullPage: true })
  await page.reload()
  const result = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const core = await load('/storyforge/src/lib/product/runtime-core.ts'), backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const original = (await core.readProductRuntimeState(f.input.sessionId)).ttrpg.openRun
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.input.scope.projectId))
    const session = await db.productRuntimeSessions.where('projectId').equals(projectId).first(), imported = (await core.readProductRuntimeState(session.id)).ttrpg.openRun
    return { refs: original.situationReceipts[0].runtimeEntityReferences.references.map((row: any) => row.entityRef),
      sameReceipt: JSON.stringify(original.situationReceipts) === JSON.stringify(imported.situationReceipts),
      sameSituations: JSON.stringify(original.situations) === JSON.stringify(imported.situations),
      active: original.situations.active.length, worldTurn: original.worldTime.worldTurn, knowledge: original.knowledge.length, calls: original.coordination.calls.length }
  }, f)
  expect(result).toMatchObject({ sameReceipt: true, sameSituations: true, active: 1, worldTurn: 0, knowledge: 0, calls: 1 })
  expect(result.refs.sort()).toEqual((humanGm ? [f.npc, f.place] : [f.npc]).sort()); expect(sends).toHaveLength(1)
})
