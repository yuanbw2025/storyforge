import { test, expect, type Page, type Locator } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
async function enter(page: Page, sessionId: number) {
  await page.goto('./play/session/' + sessionId)
  await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
  await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  const card = page.getByTestId('ttrpg-open-fact-desk'); await expect(card).toBeVisible({ timeout: 30000 })
  await card.locator('summary').first().click(); return card
}
async function fill(card: Locator, f: { npc: string; place: string; heroName: string }, detail: string) {
  await card.getByLabel('本次事实允许引用本局已实际创建的对象。', { exact: true }).check()
  await card.getByLabel('事实主体', { exact: true }).selectOption(f.npc)
  await card.getByLabel('事实含义', { exact: true }).selectOption('knows')
  await card.getByLabel('事实关联对象', { exact: true }).selectOption(f.place)
  await card.getByLabel('事实正文', { exact: true }).fill(detail)
  await card.getByRole('group', { name: '事实来源（最多 100 条）', exact: true }).getByRole('checkbox').first().check()
  await card.getByLabel('事实知情范围', { exact: true }).selectOption('private')
  await card.getByRole('group', { name: '本次事实接收者', exact: true }).getByLabel(f.heroName, { exact: true }).check()
}
async function approve(card: Locator) {
  const region = card.getByRole('region', { name: '本版本事实审阅', exact: true }), button = region.getByRole('button', { name: '确认本版本事实变更', exact: true })
  await expect(button).toBeVisible(); await expect(button).toBeDisabled()
  await region.getByLabel('我已核对本版本全文、依据和准确知情范围，明确确认本次变更。', { exact: true }).check()
  await button.click()
}
test('native GM reviews an instance fact, loses only an unconfirmed draft on reload, retries exact storage cut, supersedes/retires and backs up without model calls', async ({ page }) => {
  test.setTimeout(240000); let sends = 0
  page.on('request', request => { if (request.url().includes('/chat/completions')) sends++ })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const s = await (await load('/storyforge/tests/helpers/open-instance-situation.ts')).setupInstanceSituationV1(true)
    return { input: s.deskInput, npc: s.npc, place: s.place, heroName: s.before.entities.hero.name, originalEntities: JSON.stringify(s.before.entities), originalProduct: JSON.stringify(s.before.ttrpg.product) }
  })
  let card = await enter(page, f.input.sessionId)
  await expect(card.getByLabel('本次事实允许引用本局已实际创建的对象。', { exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: '明确开始本次事实咨询', exact: true }).click()
  await expect(card.getByLabel('事实主体', { exact: true })).toBeVisible()
  await expect(card.getByLabel('事实主体', { exact: true }).locator(`option[value="${f.npc}"]`)).toHaveCount(0)
  await fill(card, f, 'PRIVATE-NATIVE-HUMAN-FACT')
  await card.getByRole('button', { name: '准备并审阅本条事实', exact: true }).click()
  await expect(card.getByRole('region', { name: '本版本事实审阅', exact: true })).toContainText('新守灯人')
  await page.reload(); card = await enter(page, f.input.sessionId)
  await expect(card.getByRole('region', { name: '本版本事实审阅', exact: true })).toHaveCount(0)
  await expect(card.getByLabel('事实正文', { exact: true })).toHaveValue('')
  await expect(card.getByLabel('本次事实允许引用本局已实际创建的对象。', { exact: true })).not.toBeChecked()
  await fill(card, f, 'PRIVATE-NATIVE-HUMAN-FACT')
  await card.getByRole('button', { name: '准备并审阅本条事实', exact: true }).click()
  await expect(card.getByRole('region', { name: '本版本事实审阅', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), original = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    db.productRuntimeEvents.add = async (row: any, ...args: any[]) => { if (row.type === 'ttrpg.fact.asserted') { db.productRuntimeEvents.add = original; throw new Error('NATIVE-HUMAN-FACT-STORAGE-CUT') } return original(row, ...args) }
  })
  await approve(card)
  await expect(card.getByRole('button', { name: '核对并重试原事实确认', exact: true })).toBeEnabled()
  await expect(card.getByRole('region', { name: '本局事实记录', exact: true })).not.toContainText('PRIVATE-NATIVE-HUMAN-FACT')
  await card.getByRole('button', { name: '核对并重试原事实确认', exact: true }).click()
  const records = card.getByRole('region', { name: '本局事实记录', exact: true })
  await expect(records).toContainText('PRIVATE-NATIVE-HUMAN-FACT')
  const firstKey = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).ttrpg.openRun.factLedger.entries[0].fact.factKey
  }, f.input.sessionId)
  await fill(card, f, 'PRIVATE-NATIVE-HUMAN-FACT-CORRECTED')
  await card.getByLabel('事实取值', { exact: true }).selectOption('false')
  await card.getByLabel('替代旧事实', { exact: true }).selectOption(firstKey)
  await card.getByLabel('事实替代理由', { exact: true }).fill('核对后更正原判断')
  await card.getByRole('button', { name: '准备并审阅本条事实', exact: true }).click(); await approve(card)
  await expect(records).toContainText('PRIVATE-NATIVE-HUMAN-FACT-CORRECTED')
  await expect(records.getByText('退休或替代理由：核对后更正原判断', { exact: true })).toHaveCount(1)
  await records.getByRole('button', { name: '准备退休这条事实', exact: true }).click()
  await card.getByLabel('事实退休理由', { exact: true }).fill('本条判断不再适用，保留原历史')
  await card.getByRole('button', { name: '准备退休审阅', exact: true }).click(); await approve(card)
  await expect(records.getByRole('button', { name: '准备退休这条事实', exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: '结束本次事实咨询', exact: true }).click()
  await expect(card.getByRole('button', { name: '明确开始本次事实咨询', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('human-fact-desk-mobile.png'), fullPage: true })
  await page.reload()
  const actual = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts'), backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const state = await core.readProductRuntimeState(f.input.sessionId), run = state.ttrpg.openRun
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.input.scope.projectId)), imported = await db.productRuntimeSessions.where('projectId').equals(projectId).first(), restored = await core.readProductRuntimeState(imported.id)
    return { sameLedger: JSON.stringify(run.factLedger) === JSON.stringify(restored.ttrpg.openRun.factLedger), sameEntities: JSON.stringify(state.entities) === f.originalEntities,
      sameProduct: JSON.stringify(state.ttrpg.product) === f.originalProduct, facts: run.factLedger.entries.length, retirements: run.factLedger.retirements.length,
      worldTurn: run.worldTime.worldTurn, calls: run.coordination.calls.length, agentRuns: await db.agentRuns.count(), epoch: run.coordination.activeEpochKey }
  }, f)
  expect(actual).toMatchObject({ sameLedger: true, sameEntities: true, sameProduct: true, facts: 2, retirements: 2, worldTurn: 0, calls: 0, agentRuns: 0, epoch: null }); expect(sends).toBe(0)
})
test('native frozen-only consultation works without templates or model settings and clears private content before entering a player identity', async ({ page }) => {
  test.setTimeout(180000); let sends = 0
  page.on('request', request => { if (request.url().includes('/chat/completions')) sends++ })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, helper = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const s = await helper.readyOpenTtrpgSessionV1('Native human fact consultation', (pkg: any) => { pkg.ttrpg.campaign.gmMode = 'human' })
    return { sessionId: s.sessionId, oracleKey: s.runtimePackage.ttrpg.rulePack.content.oracles[0].oracleKey, tier: s.runtimePackage.ttrpg.rulePack.content.oracles[0].likelihood?.tiers[0].tierKey }
  })
  const card = await enter(page, f.sessionId)
  await card.getByRole('button', { name: '明确开始本次事实咨询', exact: true }).click()
  await card.getByLabel('事实咨询表', { exact: true }).selectOption(f.oracleKey)
  if (f.tier) await card.getByLabel('事实咨询可能性', { exact: true }).selectOption(f.tier)
  await card.getByLabel('事实咨询问题', { exact: true }).fill('守灯人是否了解港口？')
  await card.getByRole('button', { name: '明确进行本次事实咨询', exact: true }).click()
  await expect(card.getByLabel('事实主体', { exact: true })).toBeVisible()
  await card.getByLabel('本次事实允许引用本局已实际创建的对象。', { exact: true }).check()
  await card.getByLabel('事实主体', { exact: true }).selectOption('keeper'); await card.getByLabel('事实含义', { exact: true }).selectOption('knows')
  await card.getByLabel('事实关联对象', { exact: true }).selectOption('harbor'); await card.getByLabel('事实正文', { exact: true }).fill('PRIVATE-FROZEN-FACT-UI')
  await card.getByRole('button', { name: '准备并审阅本条事实', exact: true }).click()
  await expect(card.getByRole('region', { name: '本版本事实审阅', exact: true })).toContainText('仅原冻结对象')
  await approve(card)
  await expect(card.getByRole('region', { name: '本局事实记录', exact: true })).toContainText('PRIVATE-FROZEN-FACT-UI')
  await card.getByRole('button', { name: '结束本次事实咨询', exact: true }).click()
  await expect(card.getByRole('button', { name: '明确开始本次事实咨询', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回身份选择', exact: true }).click()
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero'); await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-player-table')).toBeVisible(); await expect(page.getByTestId('ttrpg-open-fact-desk')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('PRIVATE-FROZEN-FACT-UI'); expect(sends).toBe(0)
})
