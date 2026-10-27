import { expect,test,type Page } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1','requires isolated open preview') })
async function player(page: Page,viewer = 'viewer.seat.hero') {
  await page.getByLabel('我的角色',{ exact: true }).selectOption(viewer)
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
}
async function discussion(page: Page) {
  const card = page.getByTestId('ttrpg-open-table-conversation')
  await card.locator('summary').click();await expect(card.getByLabel('讨论内容',{ exact: true })).toBeVisible();return card
}
for (const humanGm of [true,false]) test(`private table question and human answer survive role handoff and reload (human GM: ${humanGm})`,async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('./')
  const f = await page.evaluate(async humanGm => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const x = await (await importer('/storyforge/tests/helpers/open-ttrpg-table-conversation.ts')).seedTableConversationV1(humanGm)
    return { sessionId: x.f.sessionId }
  },humanGm)
  await page.goto(`./play/session/${f.sessionId}`);await player(page)
  let card = await discussion(page)
  await card.getByLabel('讨论类型',{ exact: true }).selectOption('rules-question')
  await card.getByLabel('讨论可见范围',{ exact: true }).selectOption('host-private')
  await card.getByLabel('讨论内容',{ exact: true }).fill('仅向主持询问：这条规则是否需要先确认代价？')
  await card.getByRole('button',{ name: '发送讨论',exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('讨论已保存。')
  await page.getByRole('button',{ name: '交接给另一位玩家',exact: true }).click();await player(page,'viewer.seat.companion.1')
  card = await discussion(page)
  await expect(card.getByRole('region',{ name: '当前身份可见的本桌讨论' })).not.toContainText('仅向主持询问')
  await page.getByRole('button',{ name: '交接给另一位玩家',exact: true }).click()
  if (humanGm) {
    await page.getByLabel('我的主持席位',{ exact: true }).selectOption('viewer.gm')
    await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。',{ exact: true }).check()
    await page.getByRole('button',{ name: '确认主持身份并进入',exact: true }).click()
  } else await player(page)
  card = await discussion(page)
  await expect(card.getByRole('region',{ name: '当前身份可见的本桌讨论' })).toContainText('仅向主持询问')
  await card.getByRole('button',{ name: '回复这个规则问题',exact: true }).click()
  await card.getByLabel('讨论内容',{ exact: true }).fill('是的，仍须由对应玩家确认冻结规则展示的实际代价。')
  await card.getByRole('button',{ name: '保存主持答复',exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('讨论已保存。')
  await card.scrollIntoViewIfNeeded()
  if (humanGm) await expect(page.getByText('正在读取主持进度…',{ exact: true })).toHaveCount(0)
  if (humanGm) await page.screenshot({ path: test.info().outputPath('p3-table-talk-human-host.png'),fullPage: true })
  await page.reload();await player(page);card = await discussion(page)
  await expect(card.getByRole('region',{ name: '当前身份可见的本桌讨论' })).toContainText('确认冻结规则展示的实际代价')
  const final = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    return (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId)
  },f)
  expect(final.ttrpg.openRun.worldTime.worldTurn).toBe(0)
  expect(final.ttrpg.openRun.coordination.epochs).toEqual([]);expect(final.ttrpg.openRun.coordination.calls).toEqual([])
  expect(final.ttrpg.openRun.tableMessages).toHaveLength(2)
})
