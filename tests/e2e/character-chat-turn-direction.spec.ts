import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {openChatNarrativeTools} from './helpers/character-chat-ui'
import {test, expect, type Page} from '@playwright/test'

async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-direction.invalid/v1', model: 'test', maxTokens: 8000, apiKey: 'isolated-test-key' })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})})
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  return f
}
const action = (n: number, waiting = false) => ({kind: waiting ? 'attempt' : 'speak', text: waiting ? '后续需要你决定，我先等你。' : `我独自核对第 ${n} 项。`, goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player'], waitingForPlayer: waiting, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
const review = () => ({checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具'}))})

test('defaults to two steps, remembers explicit pacing and stops for player decisions within a three-step allowance', async ({page}) => {
  let actions = 0, calls = 0
  await page.route('https://chat-direction.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    calls++
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const output = prompt.includes('本次持久化行动候选') ? review() : action(++actions, actions === 4)
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  const f = await seed(page)
  const read = () => page.evaluate(async id => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id)).interaction}, f.sessionId)
  await expect(page.getByLabel('演绎节奏', {exact: true})).toHaveValue('2')
  expect(actions).toBe(0)
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByText('我独自核对第 2 项。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  expect(actions).toBe(2); expect(calls).toBe(4)
  expect((await read()).chatNarrative.triggers[0]).toMatchObject({direction: {actorKey: 'guard', actionLimit: 2}, status: 'complete'})
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByLabel('演绎节奏', {exact: true})).toHaveValue('2')
  expect(actions).toBe(2); expect(calls).toBe(4)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await openChatNarrativeTools(page)
  await page.getByLabel('演绎节奏', {exact: true}).selectOption('1')
  expect(actions).toBe(2)
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByText('我独自核对第 3 项。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  expect(actions).toBe(3); expect(calls).toBe(6)
  expect((await read()).chatNarrative.triggers[1]).toMatchObject({direction: {actorKey: 'guard', actionLimit: 1}, status: 'complete'})
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByLabel('演绎节奏', {exact: true})).toHaveValue('1')
  expect(actions).toBe(3)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await openChatNarrativeTools(page)
  await page.getByLabel('演绎节奏', {exact: true}).selectOption('3')
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByText('后续需要你决定，我先等你。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  const state = await read()
  expect(actions).toBe(4); expect(calls).toBe(8)
  expect(state.chatNarrative.triggers[2]).toMatchObject({direction: {actorKey: 'guard', actionLimit: 3}, status: 'waiting-player'})
  expect(state.chatNarrative.triggers[2].actionSequences).toHaveLength(1)
  await openChatNarrativeTools(page)
  await page.getByLabel('演绎节奏', {exact: true}).selectOption('2')
  await page.getByPlaceholder('对当前场景中的角色说话…').fill('我想先听你自己的办法。')
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect(page.getByText('我独自核对第 6 项。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  expect(actions).toBe(6); expect(calls).toBe(12)
  expect((await read()).chatNarrative.triggers[3]).toMatchObject({kind: 'player-response', direction: {actorKey: 'guard', actionLimit: 2}, status: 'complete'})
})

for (const interrupt of ['message', 'stop'] as const) test(`${interrupt} interrupts a bounded run without replaying its committed first action`, async ({page}) => {
  let actions = 0, calls = 0, release!: () => void
  const gate = new Promise<void>(resolve => {release = resolve})
  await page.route('https://chat-direction.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    calls++
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    let output: unknown
    if (prompt.includes('本次持久化行动候选')) output = review()
    else {actions++; if (actions === 2) await gate; output = action(actions)}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  const f = await seed(page)
  await openChatNarrativeTools(page)
  await page.getByLabel('演绎节奏', {exact: true}).selectOption('3')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect.poll(() => actions).toBe(2)
  if (interrupt === 'message') {
    await page.getByPlaceholder('对当前场景中的角色说话…').fill('先停一下，我有新的想法。')
    await page.getByRole('button', {name: '打断并发送', exact: true}).click()
    await expect(page.getByText('先停一下，我有新的想法。', {exact: true})).toBeVisible()
  } else await page.getByRole('button', {name: '取消', exact: true}).click()
  release()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  const read = () => page.evaluate(async id => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id)).interaction}, f.sessionId)
  const state = await read()
  expect(state.messages.map((m: {role: string}) => m.role)).toEqual(interrupt === 'message' ? ['character', 'player'] : ['character'])
  expect(state.chatNarrative.triggers[0]).toMatchObject({direction: {actorKey: 'guard', actionLimit: 3}, status: interrupt === 'message' ? 'cancelled' : 'ready'})
  if (interrupt === 'stop') await expect(page.getByRole('button', {name: '补齐未完成本轮', exact: true})).toBeDisabled()
  expect(actions).toBe(2); expect(calls).toBe(3)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByLabel('演绎节奏', {exact: true})).toHaveValue('3')
  expect(await read()).toEqual(state)
  expect(calls).toBe(3)
})
