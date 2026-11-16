import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'

for (const rejected of [false, true]) test(`binds a player-requested promise and displays its original source (rejected=${rejected})`, async ({page}, info) => {
  const requestText = '如果找到新线索，能先来问我，再告诉其他人吗？'
  const terms = '如果找到新线索，我会在告诉其他人之前先来问你是否同意。'
  const calls: string[] = []
  let sessionId = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://promise-request-test.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
  await page.route('https://promise-request-test.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const messages = route.request().postDataJSON().messages as Array<{content: string}>
    const review = messages[1].content.includes('本次持久化行动候选')
    calls.push(review ? 'review' : 'action')
    let value: unknown
    if (review) {
      expect(messages[0].content).toContain('玩家请求约定专审')
      value = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是真实模型验收'})), disclosureChecks: [], commitmentChecks: [{effectIndex: 0, passed: !rejected, reason: '工程注入的来源语义结论'}]}
    } else {
      expect(messages[0].content).toContain('promiseRequest 默认为 null')
      expect(messages[1].content).toContain(requestText)
      const source = await page.evaluate(async id => {const load = new Function('p', 'return import(p)'); const s = await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id); return s.interaction.chatNarrative.triggers.slice(-1)[0].sourceEventSequence}, sessionId)
      value = {kind: 'speak', text: terms, goalKey: 'find-seal', evidenceFactKeys: [], audienceKeys: ['guard', 'player'], waitingForPlayer: true,
        newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null, promiseRequest: {playerEventSequence: source, playerExcerpt: requestText}, commitmentEffects: [{kind: 'promise', terms, evidenceExcerpt: terms}]}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, value)}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({onlyGuard: true})})
  sessionId = f.sessionId
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${sessionId}`)
  await page.getByPlaceholder('对当前场景中的角色说话…').fill(requestText)
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  if (rejected) await expect(page.getByText(/行动语义审查未通过/)).toBeVisible()
  else await expect(page.getByRole('article').getByText(terms, {exact: true})).toBeVisible()
  const read = (): Promise<NonNullable<import('../../src/lib/types').ProductRuntimeState['interaction']>> => page.evaluate(async id => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id)).interaction}, sessionId)
  const before = await read()
  await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  const panel = page.getByTestId('chat-commitment-panel')
  if (rejected) {
    await expect(panel).toContainText('暂无待履行的角色约定')
    expect(before.messages.filter(m => m.role === 'character')).toHaveLength(0)
  } else {
    await panel.getByText('查看原话', {exact: true}).click()
    await expect(panel).toContainText('你的原请求')
    await expect(panel.locator('blockquote')).toHaveText([requestText, terms])
    await page.setViewportSize({width: 390, height: 844}); await panel.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({path: info.outputPath('promise-request-mobile.png')})
  }
  await reloadWithBrowserFixtureAIConfigV1(page); await page.getByTestId('chat-narrative-controls').waitFor({state: 'visible'})
  expect(await read()).toEqual(before); expect(calls).toEqual(['action', 'review'])
})
