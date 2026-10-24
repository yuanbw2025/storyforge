import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {openChatNarrativeTools} from './helpers/character-chat-ui'
import {test, expect} from '@playwright/test'

test('compares two actions, keeps the choice over refresh, and applies only the chosen consequences', async ({page}) => {
  const texts = ['我把灯移到门边。门边亮了起来。', '我先坐下听你说。']
  const calls: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-options.invalid/v1', model: 'test', maxTokens: 8000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://chat-options.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const review = prompt.includes('本次持久化行动候选组')
    calls.push(review ? 'review' : 'options')
    if (!review) {expect(prompt).not.toContain('柜台下'); expect(prompt).toContain('互斥行动候选')}
    const output = review ? {options: ['option-1', 'option-2'].map(optionKey => ({optionKey,
      checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具；柜台下的幕后秘密只用于审查'}))}))}
      : {options: texts.map((text, i) => ({kind: i === 0 ? 'complete' : 'pause', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'],
        waitingForPlayer: false, newFacts: i === 0 ? [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}] : [],
        disclosures: [], threadUpdates: [], goalStatus: i === 0 ? null : 'paused', nextPossibilities: []}))}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})})
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await openChatNarrativeTools(page)
  await page.getByRole('button', {name: '比较两种行动', exact: true}).click()
  const choices = page.getByTestId('chat-narrative-options')
  await expect(choices.getByText(texts[0], {exact: true})).toBeVisible()
  await expect(choices.getByText(texts[1], {exact: true})).toBeVisible()
  await expect(page.getByText(/柜台下/)).toHaveCount(0)
  expect(calls).toEqual(['options', 'review'])
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  expect((await read()).messages).toEqual([])
  await page.reload()
  await expect(choices).toBeVisible()
  await expect(page.getByRole('button', {name: /^恢复 Run/})).toHaveCount(0)
  expect(calls).toHaveLength(2)
  await choices.getByRole('button', {name: '采用行动 2', exact: true}).click()
  await expect(choices).toHaveCount(0)
  await expect(page.getByText(texts[1], {exact: true})).toBeVisible()
  await expect(page.getByText(texts[0], {exact: true})).toHaveCount(0)
  const state = await read()
  expect(state.messages.map((m: {text: string}) => m.text)).toEqual([texts[1]])
  expect(state.chatNarrative.situation.facts.some((fact: {factKey: string}) => fact.factKey === 'lit-door')).toBe(false)
  expect(state.chatNarrative.situation.goals.find((goal: {goalKey: string}) => goal.goalKey === 'find-seal').status).toBe('paused')
  await page.reload()
  await expect(page.getByText(texts[1], {exact: true})).toBeVisible()
  expect(await read()).toEqual(state)
  expect(calls).toHaveLength(2)
})
