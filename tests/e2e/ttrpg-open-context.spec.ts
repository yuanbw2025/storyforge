import { expect, test } from '@playwright/test'

test('native context receipt survives refresh, stays read-only, and follows the actual human identity', async ({ page }, testInfo) => {
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated experimental preview required')
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const h = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts'), context = await importer('/storyforge/tests/helpers/open-ttrpg-context.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'), table = await importer('/storyforge/src/lib/ttrpg/open-table-service.ts')
    const inputs = await importer('/storyforge/src/lib/ttrpg/open-intent-input.ts'), { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const f = await h.readyOpenTtrpgSessionV1('情境记录原生验收', (pkg: any) => {
      pkg.ttrpg.campaign.title = '情境记录原生验收'; pkg.ttrpg.campaign.runtimePolicy.enabled = true; pkg.ttrpg.campaign.runtimePolicy.maximumEpochTokens = 20000
      pkg.ttrpg.campaign.characterTemplates[1].controller = 'hybrid'
      const p = context.openContextPolicyFixtureV1()
      p.triggers[0].trigger = { ...p.triggers[0].trigger, logic: 'always', textPatterns: [], predicate: null,
        audience: 'private', knownByActorKeys: ['hero'], injectText: 'NATIVE-HERO-GUIDANCE-PRIVATE' }
      pkg.ttrpg.campaign.contextPolicy = p
    })
    const input = { scope: f.scope, sessionId: f.sessionId, viewerKey: h.OPEN_HUMAN_VIEWER }
    await table.startTtrpgOpenTableV1({ ...input, acceptedItemKeys: [] })
    await api.startTtrpgOpenEpochV1({ ...await h.openEnvelopeV1(f.sessionId, 'context.epoch'), viewerKey: input.viewerKey, triggerKind: 'submit-action', rawInput: '调查河港' })
    const prepared = await inputs.prepareTtrpgOpenIntentInputV1({ ...await h.openEnvelopeV1(f.sessionId, 'context.prepare'), ...input, actorKey: 'hero', rawInput: '调查河港',
      maximumOutputTokens: 800, maximumCostUsd: 0.1, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    if (!JSON.stringify(prepared.messages).includes('NATIVE-HERO-GUIDANCE-PRIVATE')) throw new Error('missing actual private guidance')
    const other = (await db.ttrpgSessionParticipants.where('sessionId').equals(f.sessionId).toArray()).find((seat: any) => seat.actorKey === 'companion.1')
    return { ...input, otherViewer: other.viewerKey, before: await api.readProductRuntimeState(f.sessionId), expected: prepared.evidence.contextSelection.selected.length }
  })
  await page.goto(`./play/session/${fixture.sessionId}`)
  await page.getByLabel('我的角色', { exact: true }).selectOption(fixture.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await page.getByRole('button', { name: '查看最近一次上下文记录', exact: true }).click()
  await expect(page.getByLabel('实际上下文记录', { exact: true })).toContainText(`实际交付 ${fixture.expected} 条资料`)
  await expect(page.getByLabel('实际上下文记录', { exact: true })).toContainText('采用 1 条情境指引')
  await page.getByText('查看实际资料与触发依据', { exact: true }).click()
  await expect(page.getByLabel('实际交付资料').getByRole('listitem')).toHaveCount(fixture.expected)
  await expect(page.getByLabel('实际指引触发依据')).toContainText('作者设置的固定指引')
  await expect(page.getByLabel('实际交付资料')).toContainText('冻结规则与本人状态')
  await expect(page.getByText('NATIVE-HERO-GUIDANCE-PRIVATE', { exact: true })).toHaveCount(0)
  await page.getByLabel('实际上下文记录', { exact: true }).screenshot({ path: testInfo.outputPath('context-receipt.png') })
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption(fixture.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await page.getByRole('button', { name: '查看最近一次上下文记录', exact: true }).click()
  await expect(page.getByLabel('实际上下文记录', { exact: true })).toContainText('采用 1 条情境指引')
  const state = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    return api.readProductRuntimeState(f.sessionId)
  }, fixture)
  expect(state).toEqual(fixture.before)
  await page.getByRole('button', { name: '交接给另一位玩家', exact: true }).click()
  await page.getByLabel('我的角色', { exact: true }).selectOption(fixture.otherViewer)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByLabel('实际上下文记录', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '查看最近一次上下文记录', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('当前身份还没有模型请求记录')
  await expect(page.getByLabel('实际上下文记录', { exact: true })).toHaveCount(0)
})
