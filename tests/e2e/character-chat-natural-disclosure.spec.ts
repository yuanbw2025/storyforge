import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'

for (const rejected of [false, true]) test(`natural disclosure updates knowledge only after per-fact review (rejected=${rejected})`, async ({page}) => {
  const spoken = '我以前错怪过一个无辜的旅人，一直很后悔，所以这次想查清楚再说。'
  const calls: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://natural-disclosure.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
  await page.route('https://natural-disclosure.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const messages = route.request().postDataJSON().messages as Array<{content: string}>
    const review = messages[1].content.includes('本次持久化行动候选')
    calls.push(review ? 'review' : 'action')
    let value: unknown
    if (review) {
      expect(messages[0].content).toContain('含义双向等同')
      value = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，语义能力须另行验收'})),
        disclosureChecks: [{factKey: 'regret', passed: !rejected, reason: '此例验证逐条审查结果的实际采用边界'}]}
    } else {
      expect(messages[0].content).toContain('wording:"equivalent"')
      expect(messages[1].content).not.toContain('柜台下')
      value = {kind: 'speak', text: spoken, goalKey: 'find-seal', evidenceFactKeys: ['regret'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: [], disclosures: [{factKey: 'regret', toParticipantKeys: ['player'], evidenceExcerpt: spoken, wording: 'equivalent'}], threadUpdates: [], goalStatus: null}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, value)}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()})
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  const before = await read(), original = before.chatNarrative.situation.facts.find((x: {factKey: string}) => x.factKey === 'regret')
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  if (rejected) {
    await expect(page.getByText(/行动语义审查未通过/)).toBeVisible()
    await expect(page.getByRole('article').getByText(spoken, {exact: true})).toHaveCount(0)
  } else await expect(page.getByRole('article').getByText(spoken, {exact: true})).toBeVisible()
  await expect(page.getByRole('article').getByText(original.text, {exact: true})).toHaveCount(0)
  const after = await read(), changed = after.chatNarrative.situation.facts.find((x: {factKey: string}) => x.factKey === 'regret')
  expect(changed).toEqual({...original, audienceKeys: rejected ? ['guard'] : ['guard', 'player']})
  expect(after.chatNarrative.situation.facts).toHaveLength(before.chatNarrative.situation.facts.length)
  expect(after.messages).toHaveLength(rejected ? 0 : 1)
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(after)
  expect(calls).toEqual(['action', 'review'])
})
