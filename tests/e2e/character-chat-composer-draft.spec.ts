import {test, expect, type Page} from '@playwright/test'

async function setup(page: Page) {
  await page.context().addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', model: 'test', baseUrl: 'https://chat-composer.invalid/v1', apiKey: ''}))
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
  })
  const url = `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`
  await page.goto(url)
  await expect(input(page)).toBeEnabled()
  return {...f, url}
}
const input = (page: Page) => page.getByRole('textbox', {name: '发送给角色的消息', exact: true})
const saved = (page: Page) => page.getByText('草稿已保存，仅在此存档可见', {exact: true})
const send = (page: Page) => page.getByRole('button', {name: '仅保存消息', exact: true})

test('drafts survive leaving the page, reload and backup import without becoming messages or model input', async ({page}) => {
  let calls = 0
  page.on('request', req => {if (req.method() === 'POST' && /completions|local-codex/.test(req.url())) calls++})
  const f = await setup(page), text = '  我还没决定怎么回应。\n这句话只在草稿里。  '
  await input(page).fill(text); await expect(saved(page)).toBeVisible()
  await page.goto(`./chat/history?project=${f.scope.projectId}&work=${f.scope.workId}`)
  await page.goto(f.url)
  await expect(input(page)).toHaveValue(text)
  await page.reload(); await expect(input(page)).toHaveValue(text)
  const restored = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), exports = await load('/storyforge/src/lib/export/json-export.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const projectId = await exports.importProjectJSON(await exports.exportProjectJSON(scope.projectId))
    const session = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    return {projectId, workId: session.workId, sessionId: session.id}
  }, f.scope)
  await page.goto(`./chat/play?project=${restored.projectId}&work=${restored.workId}&session=${restored.sessionId}`)
  await expect(input(page)).toHaveValue(text)
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText(text.trim(), {exact: true})).toHaveCount(0)
  await send(page).click(); await expect(input(page)).toHaveValue('')
  await page.reload(); await expect(input(page)).toHaveValue('')
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText(text.trim(), {exact: true})).toBeVisible()
  await page.goto(f.url); await expect(input(page)).toHaveValue(text)
  expect(calls).toBe(0)
})

test('two pages retain both edits and require a choice; an already-consumed draft cannot send twice', async ({page, context}) => {
  const f = await setup(page), other = await context.newPage()
  await other.goto(f.url); await expect(input(other)).toBeEnabled()
  await input(page).fill('页面一的文字'); await expect(saved(page)).toBeVisible()
  await input(other).fill('页面二的文字')
  await expect(other.getByRole('alert').filter({hasText: '另一页面已经修改'})).toBeVisible()
  await expect(input(other)).toHaveValue('页面二的文字'); await expect(send(other)).toBeDisabled()
  await other.getByRole('button', {name: '使用已保存草稿', exact: true}).click()
  await expect(input(other)).toHaveValue('页面一的文字')
  await input(page).fill('页面一的后续修改'); await expect(saved(page)).toBeVisible()
  await input(other).fill('页面二明确保留的文字')
  await expect(other.getByRole('alert').filter({hasText: '另一页面已经修改'})).toBeVisible()
  await other.getByRole('button', {name: '保留此处文字并覆盖草稿', exact: true}).click(); await expect(saved(other)).toBeVisible()
  await send(page).click()
  await expect(page.getByRole('alert').filter({hasText: '另一页面已经修改'})).toBeVisible()
  await expect(input(page)).toHaveValue('页面一的后续修改')
  await page.getByRole('button', {name: '使用已保存草稿', exact: true}).click()
  await expect(input(page)).toHaveValue('页面二明确保留的文字')
  await send(other).click(); await expect(input(other)).toHaveValue('')
  await send(page).click()
  await expect(page.getByRole('alert').filter({hasText: '另一页面已经修改'})).toBeVisible()
  await page.getByRole('button', {name: '使用已保存草稿', exact: true}).click()
  await expect(input(page)).toHaveValue('')
  await page.reload()
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText('页面二明确保留的文字', {exact: true})).toHaveCount(1)
  await other.close()
})

test('a failed save keeps local input and retries explicitly; a failed send clears neither the draft nor the transaction', async ({page}) => {
  await setup(page)
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const update = db.productRuntimeSessions.update.bind(db.productRuntimeSessions); let failSave = true, failSend = true
    db.productRuntimeSessions.update = async (key: number, changes: {chatComposerDraft?: {text: string}}) => {
      if (changes.chatComposerDraft?.text && failSave) {failSave = false; throw new Error('模拟草稿保存失败')}
      if (changes.chatComposerDraft?.text === '' && failSend) {failSend = false; throw new Error('模拟发送保存失败')}
      return update(key, changes)
    }
  })
  await input(page).fill('这段文字不能因保存失败丢失')
  await expect(page.getByRole('alert').filter({hasText: '模拟草稿保存失败'})).toBeVisible()
  await expect(input(page)).toHaveValue('这段文字不能因保存失败丢失'); await expect(send(page)).toBeDisabled()
  await page.getByRole('button', {name: '重试保存草稿', exact: true}).click(); await expect(saved(page)).toBeVisible()
  await send(page).click()
  await expect(page.getByRole('alert').filter({hasText: '模拟发送保存失败'})).toBeVisible()
  await expect(input(page)).toHaveValue('这段文字不能因保存失败丢失')
  const messages = page.getByRole('region', {name: '对话记录', exact: true}).getByText('这段文字不能因保存失败丢失', {exact: true})
  await expect(messages).toHaveCount(0)
  await send(page).click(); await expect(input(page)).toHaveValue(''); await expect(messages).toHaveCount(1)
  await page.reload(); await expect(input(page)).toHaveValue(''); await expect(messages).toHaveCount(1)
})
