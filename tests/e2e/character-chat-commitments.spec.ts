import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'

for (const rejected of [false, true]) test(`records promises only after review and preserves their public history (rejected=${rejected})`, async ({page}, info) => {
  test.setTimeout(120000)
  const terms = '我答应检查后门后把结果告诉你，你不必跟过来。'
  const fulfilled = '叶岑查看了后门，回来告诉你：“门闩完好，没有撬动痕迹。”'
  const calls: string[] = []
  let promiseKey = '', actions = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://commitment-test.invalid/v1', model: 'test', maxTokens: 6000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://commitment-test.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const messages = route.request().postDataJSON().messages as Array<{content: string}>
    const review = messages[1].content.includes('本次持久化行动候选')
    calls.push(review ? 'review' : 'action')
    let value: unknown
    if (review) {
      expect(messages[0].content).toContain('承诺专审')
      value = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，非模型质量验收'})),
        disclosureChecks: [], commitmentChecks: [{effectIndex: 0, passed: !rejected, reason: '工程注入判定'}]}
    } else {
      actions++
      expect(messages[0].content).toContain('commitmentEffects')
      expect(messages[1].content).not.toContain('柜台下')
      if (actions > 1) {expect(messages[1].content).toContain(terms); expect(promiseKey).not.toBe('')}
      value = {kind: actions === 1 ? 'speak' : 'complete', text: actions === 1 ? terms : fulfilled, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: actions === 1 ? [] : [{factKey: 'checked-door', kind: 'observation', text: '门闩完好，没有撬动痕迹。', evidenceFactKeys: ['lost'], evidenceExcerpt: fulfilled}],
        disclosures: [], threadUpdates: [], goalStatus: null, commitmentEffects: actions === 1 ? [{kind: 'promise', terms, evidenceExcerpt: terms}] : [{kind: 'fulfill', commitmentKey: promiseKey, evidenceExcerpt: fulfilled}]}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, value)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()})
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  if (rejected) await expect(page.getByText(/行动语义审查未通过/)).toBeVisible()
  else await expect(page.getByRole('article').getByText(terms, {exact: true})).toBeVisible()
  await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  const panel = page.getByTestId('chat-commitment-panel')
  await expect(panel).toBeVisible()
  await expect(panel).not.toContainText('担心再次错怪人')
  await expect(panel).not.toContainText('工程注入判定')
  if (rejected) {
    await expect(panel).toContainText('暂无待履行的角色约定')
    expect((await read()).messages).toHaveLength(0)
    expect(calls).toEqual(['action', 'review'])
    return
  }
  await expect(panel).toContainText('待履行')
  await expect(panel).toContainText(terms)
  await panel.getByText('查看原话', {exact: true}).click()
  await expect(panel.locator('blockquote')).toHaveText(terms)
  promiseKey = (await read()).chatNarrative.situation.goals[0].commitments[0].commitmentKey
  await page.setViewportSize({width: 390, height: 844})
  await panel.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath('promise-mobile.png')})
  await page.reload(); await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  await expect(panel).toContainText(terms)
  expect(calls).toEqual(['action', 'review'])
  await page.getByRole('button', {name: '开始对话', exact: true}).click()
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByRole('article').getByText(fulfilled, {exact: true})).toBeVisible()
  await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  await panel.getByText('已处理的约定（1）', {exact: true}).click()
  await expect(panel).toContainText('已履行')
  await panel.getByText('查看原话', {exact: true}).click()
  await expect(panel.locator('blockquote')).toHaveText([terms, fulfilled])
  const after = await read()
  expect(after.messages).toHaveLength(2)
  await page.reload(); await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  await panel.getByText('已处理的约定（1）', {exact: true}).click()
  await expect(panel).toContainText('已履行')
  expect(await read()).toEqual(after)
  await page.getByRole('button', {name: '开始对话', exact: true}).click()
  await page.getByRole('button', {name: '查看本次上下文', exact: true}).click()
  await expect(page.getByTestId('chat-context-commitments')).toContainText('当时待履行')
  await expect(page.getByTestId('chat-context-commitments')).toContainText(terms)
  await expect(page.getByTestId('chat-context-inspector')).not.toContainText('担心再次错怪人')
  expect(calls).toEqual(['action', 'review', 'action', 'review'])
})
