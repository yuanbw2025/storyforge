import {expect, test} from '@playwright/test'
import {chatCharacterCardFixture} from '../helpers/chat-character-card-fixture'
import {CHAT_CARD_PNG_FIXTURE} from '../helpers/chat-character-card-png-fixture'

for (const format of ['json', 'png'] as const) test(`isolated ${format} card conversion requires confirmation and preserves external origin`, async ({page}, info) => {
  await page.setViewportSize({width: format === 'json' ? 390 : 1440, height: 844})
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  let calls = 0
  for (const pattern of ['**/chat/completions', '**/images/generations', '**/local-codex/v1/requests']) await page.route(pattern, async route => {
    if (route.request().method() === 'POST') {calls++; await route.abort()} else await route.continue()
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), f = await (await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts')).seedChatNarrativeProductionFixture()
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {scope: f.scope, settings: f.settings, world: JSON.stringify(await db.worldReleases.toArray())}
  })
  const read = () => page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const row = await db.chatAuthoringDrafts.where('workId').equals(scope.workId).first()
    return {settings: JSON.parse(row.settingsJson), world: JSON.stringify(await db.worldReleases.toArray()), media: await db.mediaBlobObjects.count()}
  }, f.scope)
  await page.goto(`./chat/cast?project=${f.scope.projectId}&work=${f.scope.workId}`)
  const importer = page.getByLabel('外部角色卡转换', {exact: true})
  await importer.locator('summary').first().click()
  await expect(importer.getByLabel('角色卡文件', {exact: true})).toBeDisabled()
  await page.getByRole('checkbox', {name: '参与本次聊天', exact: true, checked: true}).uncheck()
  await importer.getByLabel('角色卡文件', {exact: true}).setInputFiles({name: `角色.${format}`, mimeType: format === 'json' ? 'application/json' : 'image/png',
    buffer: format === 'json' ? Buffer.from(JSON.stringify(chatCharacterCardFixture())) : Buffer.from(CHAT_CARD_PNG_FIXTURE, 'base64')})
  await expect(importer.getByRole('heading', {name: '桥灯 · 外部卡片设定', exact: true})).toBeVisible()
  const confirm = importer.getByRole('button', {name: '确认映射并加入角色草稿', exact: true})
  await expect(confirm).toBeDisabled()
  expect((await read()).settings).toEqual(f.settings)
  await importer.getByLabel('导入角色的身份', {exact: true}).fill('本体验中的修灯人')
  await confirm.click()
  await expect(page.getByLabel('新角色 1 姓名', {exact: true})).toHaveValue('桥灯')
  await expect(page.getByLabel('新角色 1 身份', {exact: true})).toHaveValue('本体验中的修灯人')
  expect((await read()).settings).toEqual(f.settings)
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await expect(page.getByText('方案已保存', {exact: true})).toBeVisible()
  const saved = await read()
  expect(saved.settings.privateCharacters[0].cardOrigin).toMatchObject({format, fileName: `角色.${format}`})
  expect(saved.settings.sourceReview).toBeNull()
  expect(saved.settings.openingSituation).toBe(f.settings.openingSituation)
  expect(saved.world).toBe(f.world); expect(saved.media).toBe(0)
  await page.reload()
  await expect(page.getByLabel('新角色 1 姓名', {exact: true})).toHaveValue('桥灯')
  await page.getByText(`外部卡片来源 · 角色.${format}`, {exact: true}).click()
  await expect(page.getByText(/这是外部卡片设定，没有世界原作证据/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath(`chat-card-${format}.png`), fullPage: false})
  expect(await read()).toEqual(saved)
  expect(calls).toBe(0)
})
