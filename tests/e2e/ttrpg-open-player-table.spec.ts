import { expect, test } from '@playwright/test'

/** Isolated actual UI/runtime and deterministic model fixtures; not live provider or human acceptance. */
test('open player desk confirms identity, risk, persisted KP and handoff without exposing other private profiles', async ({ page }) => {
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires explicit isolated open preview flag')
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'), table = await importer('/storyforge/src/lib/ttrpg/open-table-service.ts')
    const f = await helper.readyOpenTtrpgSessionV1('灯塔下的冒险', (pkg: any) => {
      pkg.ttrpg.campaign.title = '灯塔下的冒险';pkg.ttrpg.campaign.runtimePolicy.enabled = true;pkg.ttrpg.campaign.runtimePolicy.maximumEpochTokens = 40000;pkg.ttrpg.rulePack.content.actions[0].effects = []
      pkg.ttrpg.campaign.characterTemplates[0].playerProfile.secret = 'HERO-PRIVATE-BROWSER'
      pkg.ttrpg.campaign.characterTemplates[1].playerProfile.secret = 'OTHER-AI-PRIVATE-BROWSER'
    })
    const input = { scope: f.scope, sessionId: f.sessionId, viewerKey: helper.OPEN_HUMAN_VIEWER }
    await table.startTtrpgOpenTableV1({ ...input, acceptedItemKeys: [] })
    const rawInput = '调查港口'
    await api.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(f.sessionId, 'browser.epoch'), viewerKey: input.viewerKey, triggerKind: 'submit-action', rawInput })
    await api.generateTtrpgOpenIntentCandidateV1({ ...await helper.openEnvelopeV1(f.sessionId, 'browser.intent'), ...input, actorKey: 'hero', rawInput,
      maximumOutputTokens: 800, maximumCostUsd: 0.1, runAI: async () => JSON.stringify({ goal: rawInput, method: '调查', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }) })
    return input
  })
  await page.goto(`./play/session/${fixture.sessionId}`)
  await expect(page.getByRole('heading', { name: '灯塔下的冒险', exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('HERO-PRIVATE-BROWSER')
  await page.getByLabel('我的角色', { exact: true }).selectOption(fixture.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.locator('body')).not.toContainText('OTHER-AI-PRIVATE-BROWSER')
  await page.getByRole('button', { name: '确认这份行动意图', exact: true }).click()
  await page.getByRole('button', { name: '同意以上风险与代价', exact: true }).click()
  await page.getByRole('button', { name: '继续结算已确认的行动', exact: true }).click()
  await expect(page.getByRole('button', { name: '生成本次 KP 叙述', exact: true })).toBeVisible()
  await page.evaluate(async f => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'), helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    await api.generateTtrpgOpenKpCandidateV1({ ...await helper.openEnvelopeV1(f.sessionId, 'browser.kp'), ...f, rawInput: 'UNSHARED-PRIVATE-HUMAN-THOUGHT', maximumOutputTokens: 800, maximumCostUsd: 0.1,
      runAI: async () => JSON.stringify({ paragraphs: [{ text: '你确认了灯塔下留下的调查痕迹。', sourceKeys: ['action.receipt'] }] }) })
  }, fixture)
  await page.getByRole('button', { name: '读取最新进度', exact: true }).click()
  await page.getByRole('button', { name: '确认这份叙述', exact: true }).click()
  await page.getByRole('button', { name: '继续结算已确认的行动', exact: true }).click()
  await expect(page.getByRole('button', { name: '请下一位 AI 队友提出行动', exact: true })).toBeVisible()
  await expect(page.locator('body')).toContainText('你确认了灯塔下留下的调查痕迹。')
  await expect(page.locator('body')).not.toContainText('OTHER-AI-PRIVATE-BROWSER')
  await expect(page.locator('body')).not.toContainText('UNSHARED-PRIVATE-HUMAN-THOUGHT')
  await page.getByRole('button', { name: '暂停冒险', exact: true }).click()
  await expect(page.getByRole('button', { name: '请下一位 AI 队友提出行动', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '恢复冒险', exact: true }).click()
  await expect(page.getByRole('button', { name: '请下一位 AI 队友提出行动', exact: true })).toBeEnabled()
  await page.getByText('我的角色与私密资料', { exact: true }).click()
  await expect(page.getByText('HERO-PRIVATE-BROWSER', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('p3-player-table-browser.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-testid="ttrpg-open-player-table"]')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('p3-player-table-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: '交接给另一位玩家', exact: true }).click()
  await expect(page.getByLabel('我的角色', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('HERO-PRIVATE-BROWSER')
})
