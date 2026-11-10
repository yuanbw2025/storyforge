import {expect, test, type Page} from '@playwright/test'
import Ajv from 'ajv'
import {readFileSync} from 'node:fs'
import {chatActionResponseFixture} from './helpers/character-chat-choice'
import {openChatNarrativeTools} from './helpers/character-chat-ui'
import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'

const reply = '叶岑把油灯移到门边。门边亮了起来。“入口先照亮了，我会自己继续找，不要求你帮忙。”'
const purpose = '仅供结束审查的内部局部目的'
const conflict = JSON.parse(readFileSync(new URL('../fixtures/character-chat-completion-conflict-v315.json', import.meta.url), 'utf8'))
const action = {kind: 'complete', text: reply, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'],
  waitingForPlayer: false, newFacts: [{factKey: 'lit-entry', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}],
  disclosures: [], threadUpdates: [], goalStatus: null, turnCompletion: {version: 1, purpose, evidenceExcerpt: '门边亮了起来。'}}

async function setup(page: Page, passed = true, provider: 'openai' | 'agnes' = 'openai') {
  registerBrowserFixtureAIConfigV1(page, { provider, baseUrl: 'https://turn-completion.invalid/v1', model: 'test', maxTokens: 8000, apiKey: 'isolated-test-key' })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  const calls: string[] = []
  await page.route('https://turn-completion.invalid/**', async route => {
    const messages = route.request().postDataJSON().messages, text = JSON.stringify(messages)
    const step = messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? 'choice'
      : text.includes('本次持久化行动候选') ? 'review' : 'expression'
    calls.push(step)
    if (step !== 'review') expect(text).not.toContain('掌柜把铜印留在柜台下')
    const output = step === 'choice' ? {directions: [], selectedId: null, decisionSummary: '工程夹具，不证明剧情质量'}
      : step === 'expression' ? action : {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction']
        .map(check => ({check, passed: true, reason: '工程夹具'})), turnCompletionCheck: {passed, reason: '工程注入的局部结束判定'}}
    let content = chatActionResponseFixture(route, output)
    if (step === 'expression' && provider === 'agnes') {
      const format = route.request().postDataJSON().response_format
      expect(format).toMatchObject({type: 'json_schema', json_schema: {name: 'chat_narrative_outcome_v4', strict: true}})
      const response = JSON.parse(content)
      response.action = {goalUpdates: [], commitmentEffects: [], relationshipUpdates: [], nextPossibilities: null, beliefUpdates: [],
        situationRequest: null, followupGoal: null, threadFollowupGoal: null, resumeGoal: null, promiseRequest: null, pauseGoal: null, sceneTransition: null,
        ...response.action, expressionMode: 'self-action-performed'}
      delete response.action.kind; delete response.action.waitingForPlayer
      const validate = new Ajv().compile(format.json_schema.schema)
      expect(validate(conflict.response)).toBe(false)
      expect(validate(response)).toBe(true)
      content = JSON.stringify(response)
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 2, onlyGuard: true})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  await openChatNarrativeTools(page)
  const read = () => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {state: await api.readProductRuntimeState(id), runs: await db.agentRuns.where('productRuntimeSessionId').equals(id).toArray()}
  }, f.sessionId)
  return {calls, read}
}

for (const width of [390, 1440]) test(`local completion leaves an active goal without filling the second action at ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 900})
  const {calls, read} = await setup(page, true, width === 390 ? 'agnes' : 'openai')
  await expect(page.getByLabel('演绎节奏', {exact: true})).toHaveValue('2')
  const before = await read()
  await page.getByPlaceholder('对当前场景中的角色说话…').fill('我不想帮忙，你自己安排吧。')
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect(page.getByText(reply, {exact: true})).toBeVisible()
  await expect.poll(async () => (await read()).runs[0]?.status).toBe('completed')
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  const after = await read(), story = after.state.interaction.chatNarrative
  expect(story.triggers.at(-1)).toMatchObject({kind: 'player-response', status: 'complete', direction: {actionLimit: 2}})
  expect(story.triggers.at(-1).actionSequences).toHaveLength(1)
  expect(story.situation.goals).toEqual(before.state.interaction.chatNarrative.situation.goals)
  expect(calls).toEqual(['choice', 'expression', 'review'])
  expect(after.state.interaction.remainingDirectorBudget).toBe(before.state.interaction.remainingDirectorBudget - 3)
  expect(await page.locator('body').innerText()).not.toContain(purpose)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByText(reply, {exact: true})).toBeVisible()
  expect((await read()).state).toEqual(after.state)
  expect(calls).toEqual(['choice', 'expression', 'review'])
})

test('a failed local completion review preserves the player message and original active goal across reload', async ({page}) => {
  const {calls, read} = await setup(page, false), before = await read()
  await page.getByPlaceholder('对当前场景中的角色说话…').fill('我不想帮忙，你自己安排吧。')
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect.poll(async () => (await read()).runs[0]?.status).toBe('failed')
  await expect(page.getByText(reply, {exact: true})).toHaveCount(0)
  const after = await read()
  expect(after.state.interaction.messages.map((message: {role: string}) => message.role)).toEqual(['player'])
  expect(after.state.interaction.chatNarrative.situation).toEqual(before.state.interaction.chatNarrative.situation)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByText('我不想帮忙，你自己安排吧。', {exact: true})).toBeVisible()
  expect((await read()).state).toEqual(after.state)
  expect(calls).toEqual(['choice', 'expression', 'review'])
})
