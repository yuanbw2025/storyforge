import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect, type Page} from '@playwright/test'
import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'

const input = (page: Page) => page.getByRole('textbox', {name: '发送给角色的消息', exact: true})
const audience = (page: Page) => page.getByLabel('对话范围', {exact: true})
const saved = (page: Page) => page.getByText('草稿已保存，仅在此存档可见', {exact: true})
async function setup(page: Page, model = false) {
  registerBrowserFixtureAIConfigV1(page.context(), { provider: 'openai', model: 'test', baseUrl: 'https://chat-private.invalid/v1', apiKey: model ? 'isolated-test-key' : '' })
  await page.context().addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
  })
  const url = `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`
  await gotoWithBrowserFixtureAIConfigV1(page, url); await expect(input(page)).toBeEnabled()
  return {...f, url}
}

for (const width of [390, 1440]) test(`private drafts retain recipients through refresh, absence and return at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 844})
  let calls = 0
  page.on('request', request => {if (request.method() === 'POST' && /completions|local-codex/.test(request.url())) calls++})
  const f = await setup(page)
  const send = page.getByRole('button', {name: '仅保存消息', exact: true})
  await audience(page).selectOption(JSON.stringify(['guard']))
  await input(page).fill('这段私聊只有叶岑可以听见。'); await expect(saved(page)).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(input(page)).toHaveValue('这段私聊只有叶岑可以听见。')
  await expect(audience(page)).toHaveValue(JSON.stringify(['guard']))
  await page.getByText('在场角色', {exact: true}).click()
  await page.getByRole('button', {name: '让 叶岑 离场', exact: true}).click()
  await expect(page.getByText('收件人已离场。', {exact: false})).toBeVisible()
  await expect(send).toBeDisabled(); await expect(input(page)).toHaveValue('这段私聊只有叶岑可以听见。')
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(audience(page)).toHaveValue(JSON.stringify(['guard'])); await expect(send).toBeDisabled()
  await page.getByText('在场角色', {exact: true}).click()
  await page.getByRole('button', {name: '让 叶岑 回归', exact: true}).click()
  await expect(send).toBeEnabled(); await send.click(); await expect(input(page)).toHaveValue('')
  await expect(audience(page)).toHaveValue(JSON.stringify(['guard']))
  const view = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), runtime = await load('/storyforge/src/lib/character-interaction/runtime.ts')
    const state = (await api.readProductRuntimeState(f.sessionId)).interaction
    return {messages: state.messages, otherMessages: runtime.interactionVisibilityView(state, 'artisan').messages}
  }, f)
  expect(view.messages).toHaveLength(1); expect(view.messages[0].audienceKeys).toEqual(['player', 'guard']); expect(view.otherMessages).toHaveLength(0)
  expect(view.messages[0].playerConversation).toBe('private')
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText('听众：叶岑', {exact: true})).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect(calls).toBe(0)
})

test('two pages resolve recipient-only conflicts without silently publishing identical text', async ({page, context}) => {
  const f = await setup(page)
  await input(page).fill('相同的文字，不同的收件人。'); await expect(saved(page)).toBeVisible()
  const other = await context.newPage(); await gotoWithBrowserFixtureAIConfigV1(other, f.url); await expect(input(other)).toHaveValue('相同的文字，不同的收件人。')
  await audience(page).selectOption(JSON.stringify(['guard'])); await expect(saved(page)).toBeVisible()
  await audience(other).selectOption(JSON.stringify(['artisan']))
  const alert = other.getByRole('alert').filter({hasText: '另一页面已经修改'})
  await expect(alert).toBeVisible()
  await expect(other.getByRole('button', {name: '仅保存消息', exact: true})).toBeDisabled()
  await alert.getByText('查看另一份已保存草稿', {exact: true}).click()
  await expect(alert.getByText('收件人：叶岑', {exact: true})).toBeVisible()
  await alert.getByRole('button', {name: '使用已保存草稿', exact: true}).click()
  await expect(audience(other)).toHaveValue(JSON.stringify(['guard']))
  await other.getByRole('button', {name: '仅保存消息', exact: true}).click(); await expect(input(other)).toHaveValue('')
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(input(page)).toHaveValue(''); await expect(audience(page)).toHaveValue(JSON.stringify(['guard']))
  await other.close()
})

test('private reply and continuation keep the original conversation through import without automatic model calls', async ({page}) => {
  const calls: string[] = []
  await page.route('https://chat-private.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const review = prompt.includes('本次持久化行动候选')
    calls.push(review ? 'review' : 'action')
    if (!review) {expect(prompt).toContain('conversationBoundary'); expect(prompt).toContain('这段私聊只有叶岑可以听见。')}
    const output = review ? {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是质量验收'}))}
      : {kind: 'speak', text: calls.length === 1 ? '我压低声音回应，先自己核对账簿。' : '我继续轻声说明自己的核对办法。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  const f = await setup(page, true)
  await audience(page).selectOption(JSON.stringify(['guard']))
  await input(page).fill('这段私聊只有叶岑可以听见。'); await expect(saved(page)).toBeVisible()
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect(page.getByText('我压低声音回应，先自己核对账簿。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  expect(calls).toEqual(['action', 'review'])
  const restored = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), exp = await load('/storyforge/src/lib/export/json-export.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const projectId = await exp.importProjectJSON(await exp.exportProjectJSON(f.scope.projectId))
    const session = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    return {projectId, workId: session.workId, sessionId: session.id}
  }, f)
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${restored.projectId}&work=${restored.workId}&session=${restored.sessionId}`)
  await expect(audience(page)).toHaveValue(JSON.stringify(['guard'])); expect(calls).toHaveLength(2)
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByText('我继续轻声说明自己的核对办法。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  const read = () => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), runtime = await load('/storyforge/src/lib/character-interaction/runtime.ts')
    const state = (await api.readProductRuntimeState(id)).interaction
    return {state, other: runtime.interactionVisibilityView(state, 'artisan')}
  }, restored.sessionId)
  const before = await read(); expect(before.state.messages).toHaveLength(3); expect(before.other.messages).toHaveLength(0)
  expect(before.state.chatNarrative.triggers.every((t: {direction: {audienceParticipantKeys: string[]; conversationMode: string}}) => t.direction.audienceParticipantKeys.join() === 'guard' && t.direction.conversationMode === 'private')).toBe(true)
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(audience(page)).toHaveValue(JSON.stringify(['guard']))
  expect(await read()).toEqual(before); expect(calls).toEqual(['action', 'review', 'action', 'review'])
})
