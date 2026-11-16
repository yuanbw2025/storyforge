import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {openChatMessageTools} from './helpers/character-chat-ui'
import {test, expect} from '@playwright/test'

test('continues the current reply with an immutable prefix in a refreshed branch, then advances a separate next action', async ({page}) => {
  const prefix = '我把灯移到门边，门边亮了起来。', suffix = '我再推开窗，窗户现在开着。'
  let actions = 0, reviews = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-continuation.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
  await page.route('https://chat-continuation.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    let output: unknown
    if (prompt.includes('本次持久化行动候选')) {
      reviews++
      output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是语义验收'}))}
    } else {
      actions++
      if (actions === 2) {expect(prompt).toContain(prefix); expect(prompt).toContain('"mode":"continue"'); expect(prompt).not.toContain('柜台下')}
      output = {kind: actions < 3 ? 'complete' : 'speak', text: actions === 1 ? prefix : actions === 2 ? prefix + suffix : '现在我再检查一下门槛。',
        goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: actions < 3 ? [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'},
          ...(actions === 2 ? [{factKey: 'open-window', kind: 'observation', text: '窗户现在开着。', evidenceFactKeys: ['lost'], evidenceExcerpt: '窗户现在开着。'}] : [])] : [],
        disclosures: [], threadUpdates: [], goalStatus: null}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()})
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByText(prefix, {exact: true})).toBeVisible()
  const read = () => page.evaluate(async () => {const load = new Function('p', 'return import(p)'); const s = (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState(); return {sessionId: s.selectedSessionId, state: s.runtimeState.interaction}})
  const parent = await read()
  // Switching from an edited textarea must reset it to the actual immutable prefix.
  await openChatMessageTools(page, `改写消息 ${parent.state.messages[0].eventSequence}`)
  await page.getByRole('button', {name: `改写消息 ${parent.state.messages[0].eventSequence}`, exact: true}).click()
  await page.getByLabel('改写历史消息', {exact: true}).fill('尚未保存的另一个开头。')
  await openChatMessageTools(page, `续写消息 ${parent.state.messages[0].eventSequence}`)
  await page.getByRole('button', {name: `续写消息 ${parent.state.messages[0].eventSequence}`, exact: true}).click()
  await expect(page.getByLabel('续写原文', {exact: true})).toHaveValue(prefix)
  await expect(page.getByLabel('续写原文', {exact: true})).toHaveJSProperty('readOnly', true)
  await page.getByRole('button', {name: '建立续写分支', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toBeVisible()
  expect((await read()).sessionId).not.toBe(f.sessionId)
  expect(actions).toBe(1); expect(reviews).toBe(1)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByLabel('已保存的续写原文', {exact: true})).toHaveValue(prefix)
  await expect(page.getByLabel('已保存的续写原文', {exact: true})).toHaveJSProperty('readOnly', true)
  expect(actions).toBe(1)
  await page.getByRole('button', {name: '生成并审查续写', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toHaveCount(0)
  await expect(page.getByText(prefix + suffix, {exact: true})).toBeVisible()
  const child = await read()
  expect(child.state.messages.map((m: {text: string}) => m.text)).toEqual([prefix + suffix])
  expect(child.state.chatNarrative.situation.facts.filter((fact: {factKey: string}) => ['lit-door', 'open-window'].includes(fact.factKey))).toHaveLength(2)
  expect(actions).toBe(2); expect(reviews).toBe(2)
  const original = await page.evaluate(async sessionId => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(sessionId)).interaction}, f.sessionId)
  expect(original).toEqual(parent.state)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByText(prefix + suffix, {exact: true})).toBeVisible()
  expect(actions).toBe(2)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByText('现在我再检查一下门槛。', {exact: true})).toBeVisible()
  expect((await read()).state.messages.map((m: {text: string}) => m.text)).toEqual([prefix + suffix, '现在我再检查一下门槛。'])
  await expect(page.getByRole('button', {name: `续写消息 ${child.state.messages[0].eventSequence}`, exact: true, includeHidden: true})).toHaveCount(0)
  expect(actions).toBe(3); expect(reviews).toBe(3)
})
