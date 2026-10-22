import { expect, test } from '@playwright/test'
/** Actual isolated browser/DB/player controls, with a deliberately invalid deterministic provider response. */
test('an exhausted model window can finish through explicit human prose without re-sending or rerolling', async ({ page }) => {
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires explicit isolated preview flag')
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-checks.ts'), envelope = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const f = await helper.setupChecksFixtureV1({ ai: true, maximumCalls: 1 })
    await api.resumeTtrpgOpenPlayV1(f.command)
    await api.generateTtrpgOpenKpCandidateV1({ ...await envelope.openEnvelopeV1(f.command.sessionId, 'invalid.kp'), scope: f.f.scope, viewerKey: f.command.viewerKey,
      rawInput: '当前公开结果', maximumOutputTokens: 800, maximumCostUsd: 0.1, runAI: async () => 'retained invalid KP response' })
    return { command: f.command, before: await api.readProductRuntimeState(f.command.sessionId) }
  })
  await page.goto(`./play/session/${f.command.sessionId}`)
  await page.getByLabel('我的角色', { exact: true }).selectOption(f.command.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.locator('body')).toContainText('这份结果需要修订，尚不能执行')
  await expect(page.getByRole('button', { name: '生成本次 KP 叙述', exact: true })).toBeDisabled()
  await page.getByText('改由真人主持补写叙述', { exact: true }).click()
  await page.getByLabel('补写原因', { exact: true }).selectOption('budget-exhausted')
  await page.getByLabel('人工叙述', { exact: true }).fill('你们核对了本次调查留下的痕迹，接下来的选择仍由你们决定。')
  await page.getByRole('button', { name: '确认保存人工叙述', exact: true }).click()
  await expect(page.locator('body')).toContainText('真人主持补写')
  await page.getByRole('button', { name: '继续结算已确认的行动', exact: true }).click()
  await expect(page.getByRole('button', { name: '结束本轮主持，准备下一次行动', exact: true })).toBeVisible()
  const after = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    return (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(sessionId)
  }, f.command.sessionId)
  expect(after.entities).toEqual(f.before.entities)
  expect(after.ttrpg.openRun.worldTime).toEqual(f.before.ttrpg.openRun.worldTime)
  expect(after.ttrpg.openRun.ruleReceipts).toEqual(f.before.ttrpg.openRun.ruleReceipts)
  expect(after.ttrpg.openRun.coordination).toEqual(f.before.ttrpg.openRun.coordination)
  expect(after.ttrpg.openRun.narrations[0]).toMatchObject({ sourceKind: 'human', reason: 'budget-exhausted', basis: { previousRequests: [{ status: 'succeeded' }] } })
  expect(after.ttrpg.openRun.narrations[0]).not.toHaveProperty('rawResponseHash')
  expect(after.ttrpg.openRun.operations[0].status).toBe('completed')
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption(f.command.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.locator('body')).toContainText('你们核对了本次调查留下的痕迹')
  await expect(page.locator('body')).toContainText('真人主持补写')
})
