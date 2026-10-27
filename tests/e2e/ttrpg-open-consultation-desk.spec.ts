import { expect, test, type Page } from '@playwright/test'

test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
async function enter(page: Page, sessionId: number) {
  await page.goto('./play/session/' + sessionId)
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  const panel = page.getByTestId('ttrpg-open-consultation-desk')
  await expect(panel).toBeVisible({ timeout: 30000 })
  await panel.locator('summary').click()
  return panel
}

test('a normal player consults without entity templates and retains the exact result and turn quota after reload', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto('./')
  const original = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const h = await load('/storyforge/tests/helpers/open-ttrpg-session.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const f = await h.readyOpenTtrpgSessionV1('normal consultation without entities', (pkg: any) => {
      pkg.ttrpg.campaign.dynamicEntityTemplates = []
      pkg.ttrpg.campaign.characterTemplates.find((c: any) => c.characterKey === 'keeper').gmProfile.secret = 'CONSULTATION-GM-SECRET'
      const secret = structuredClone(pkg.ttrpg.rulePack.content.oracles[0])
      secret.oracleKey = 'oracle.gm.secret'; secret.title = 'CONSULTATION-SECRET-TABLE'; secret.audience = 'gm-only'
      pkg.ttrpg.rulePack.content.oracles.push(secret)
    })
    return { sessionId: f.sessionId, state: await core.readProductRuntimeState(f.sessionId), world: await db.worldReleases.toArray(), builds: await db.productBuilds.toArray() }
  })
  let panel = await enter(page, original.sessionId)
  await expect(page.locator('body')).not.toContainText('CONSULTATION-GM-SECRET')
  await expect(panel).not.toContainText('CONSULTATION-SECRET-TABLE')
  await panel.getByRole('button', { name: '开始本次咨询与交流', exact: true }).click()
  await expect(panel.getByLabel('Oracle 咨询表', { exact: true })).toBeEnabled({ timeout: 30000 })
  await panel.getByLabel('Oracle 咨询表', { exact: true }).selectOption('oracle.yes')
  await panel.getByLabel('Oracle 可能性', { exact: true }).selectOption('even')
  await panel.getByLabel('Oracle 咨询问题', { exact: true }).fill('码头是否会下雨？')
  await panel.getByRole('button', { name: '确认问题并咨询一次', exact: true }).click()
  await expect(panel.getByRole('region', { name: '已保存的咨询结果' })).toContainText('码头是否会下雨？', { timeout: 30000 })
  const first = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)
  }, original.sessionId)
  await page.reload(); panel = await enter(page, original.sessionId)
  await expect(panel.getByRole('region', { name: '已保存的咨询结果' })).toContainText('码头是否会下雨？')
  await panel.getByLabel('Oracle 咨询表', { exact: true }).selectOption('oracle.yes')
  await panel.getByLabel('Oracle 可能性', { exact: true }).selectOption('even')
  await panel.getByLabel('Oracle 咨询问题', { exact: true }).fill('潮水是否会涨高？')
  await panel.getByRole('button', { name: '确认问题并咨询一次', exact: true }).click()
  await expect(panel.getByRole('region', { name: '已保存的咨询结果' })).toContainText('潮水是否会涨高？', { timeout: 30000 })
  await expect(panel.getByRole('button', { name: '确认问题并咨询一次', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: '结束本次咨询与交流', exact: true }).click()
  await expect(panel.getByRole('button', { name: '开始本次咨询与交流', exact: true })).toBeEnabled({ timeout: 30000 })
  await panel.getByRole('button', { name: '开始本次咨询与交流', exact: true }).click()
  await expect(panel.getByRole('button', { name: '确认问题并咨询一次', exact: true })).toBeDisabled()
  const final = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { state: await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id), world: await db.worldReleases.toArray(), builds: await db.productBuilds.toArray(), calls: await db.agentRuns.count() }
  }, original.sessionId)
  expect(final.state.ttrpg.openRun.oracleReceipts).toHaveLength(2)
  expect(final.state.ttrpg.openRun.oracleReceipts[0]).toEqual(first.ttrpg.openRun.oracleReceipts[0])
  expect(final.state.ttrpg.openRun.worldTime).toEqual(original.state.ttrpg.openRun.worldTime)
  expect(final.state.entities).toEqual(original.state.entities)
  expect(final.world).toEqual(original.world); expect(final.builds).toEqual(original.builds); expect(final.calls).toBe(0)
})

test('a discovered private clue reaches companions only after the player reviews and explicitly shares the exact text', async ({ page }) => {
  test.setTimeout(180000)
  let modelPosts = 0
  page.on('request', request => { if (request.method() === 'POST' && /chat\/completions|local-codex\/v1\/requests/.test(request.url())) modelPosts++ })
  await page.goto('./')
  const original = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const h = await load('/storyforge/tests/helpers/open-consultation-runtime.ts'), core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const s = await h.setupClueSharingDeskV1()
    return { input: s.input, root: s.root, state: await core.readProductRuntimeState(s.f.sessionId) }
  })
  let panel = await enter(page, original.input.sessionId)
  await panel.getByRole('button', { name: '开始本次咨询与交流', exact: true }).click()
  await expect(panel.getByLabel('要分享的线索', { exact: true })).toBeEnabled({ timeout: 30000 })
  await panel.getByLabel('要分享的线索', { exact: true }).selectOption(JSON.stringify([original.root.knowledgeKey, 'hero']))
  await panel.getByRole('button', { name: '审阅这次线索分享', exact: true }).click()
  await expect(panel.getByRole('region', { name: '线索分享确认' })).toBeVisible({ timeout: 30000 })
  await expect(panel.getByRole('button', { name: '明确分享这段线索', exact: true })).toBeDisabled()
  const beforeConsent = await page.evaluate(async input => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const actor = await load('/storyforge/src/lib/ttrpg/open-player-context.ts')
    return { state: await core.readProductRuntimeState(input.sessionId), recipient: (await actor.loadTtrpgOpenPlayerContextV1({ scope: input.scope, sessionId: input.sessionId, actorKey: 'companion.1' })).view.knowledge }
  }, original.input)
  expect(beforeConsent.state.ttrpg.openRun.knowledge).toHaveLength(1); expect(beforeConsent.recipient).toEqual([])
  await page.reload(); panel = await enter(page, original.input.sessionId)
  await expect(panel.getByRole('region', { name: '线索分享确认' })).toHaveCount(0)
  await expect(panel.getByLabel('要分享的线索', { exact: true })).toBeEnabled({ timeout: 30000 })
  await panel.getByLabel('要分享的线索', { exact: true }).selectOption(JSON.stringify([original.root.knowledgeKey, 'hero']))
  await panel.getByRole('button', { name: '审阅这次线索分享', exact: true }).click()
  const review = panel.getByRole('region', { name: '线索分享确认' })
  await expect(review).toContainText('当前全队', { timeout: 30000 })
  await review.getByLabel('我已核对这段线索文字、分享范围和接收者。', { exact: true }).check()
  await review.getByRole('button', { name: '明确分享这段线索', exact: true }).click()
  await expect(panel).toContainText('这段线索已按指定范围分享', { timeout: 30000 })
  await expect(page.locator('body')).not.toContainText('CLUE-SHARING-GM-SECRET')
  await page.reload(); panel = await enter(page, original.input.sessionId)
  await expect(panel.getByLabel('要分享的线索', { exact: true })).toBeEnabled({ timeout: 30000 })
  const final = await page.evaluate(async input => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const actors = await load('/storyforge/src/lib/ttrpg/open-player-context.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const views = await Promise.all(['companion.1', 'companion.2'].map(async actorKey => (await actors.loadTtrpgOpenPlayerContextV1({ scope: input.scope, sessionId: input.sessionId, actorKey })).view.knowledge))
    return { state: await core.readProductRuntimeState(input.sessionId), views, runs: await db.agentRuns.count() }
  }, original.input)
  expect(final.state.ttrpg.openRun.knowledge).toHaveLength(2)
  expect(final.state.ttrpg.openRun.knowledge[0]).toEqual(original.root)
  for (const view of final.views) { expect(view).toHaveLength(1); expect(view[0].reliability).toBe('hearsay') }
  expect(final.state.entities).toEqual(original.state.entities)
  expect(final.state.ttrpg.openRun.worldTime).toEqual(original.state.ttrpg.openRun.worldTime)
  expect(final.runs).toBe(0); expect(modelPosts).toBe(0)
})
