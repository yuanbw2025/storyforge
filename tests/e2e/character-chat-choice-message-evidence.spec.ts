import {expect, test, type Page} from '@playwright/test'
import {chatActionResponseFixture} from './helpers/character-chat-choice'

const playerText = '我只想知道铜印在哪里，不帮你取。'
const reply = '好，我会先弄清铜印在哪里，不把取回铜印的事交给你。'
const preferenceReply = '明白，你只想知道铜印的去向，没有答应替我取回。'

async function setup(page: Page, invalid = false, completedResponse = false) {
  const responseText = completedResponse ? preferenceReply : reply
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://choice-messages.invalid/v1', model: 'test', maxTokens: 8000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  const calls: string[] = []
  let citedMessageId: string | undefined
  await page.route('https://choice-messages.invalid/**', async route => {
    const messages = route.request().postDataJSON().messages, text = JSON.stringify(messages)
    const step = messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? 'choice'
      : text.includes('本次持久化行动候选') ? 'review' : 'expression'
    calls.push(step)
    if (step !== 'review') expect(text).not.toContain('掌柜把铜印留在柜台下')
    if (step === 'choice') {
      const rows = messages[1].content.split('\n').filter((line: string) => line.startsWith('- {"messageId":'))
        .map((line: string) => JSON.parse(line.slice(2)))
      citedMessageId = rows.find((row: {text: string}) => row.text === playerText)?.messageId
      expect(citedMessageId).toBeTruthy()
    }
    if (step === 'expression') expect(messages[2].content).toContain(`"evidenceMessageIds":["${citedMessageId}"]`)
    const output = step === 'choice' ? {directions: [{id: 'respond', action: '根据实际偏好说明自己后续的调查安排', evidenceFactKeys: [],
      evidenceMessageIds: [invalid ? 'undelivered-message' : citedMessageId], changes: '不把取回任务分派给玩家', playerDependency: null,
      unconfirmedConditions: [], kind: 'own-action'}], selectedId: 'respond', decisionSummary: '仅供选择使用的内部说明'}
      : step === 'expression' ? {kind: 'speak', text: responseText, goalKey: 'find-seal', evidenceFactKeys: completedResponse ? [] : ['lost'], audienceKeys: ['guard', 'player'],
        waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
        ...(completedResponse ? {nextPossibilities: null, turnCompletion: {version: 1, purpose: '确认玩家偏好，不把回应当作参与许可', evidenceExcerpt: preferenceReply}} : {})}
      : {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，非体验评分'})),
        ...(completedResponse ? {turnCompletionCheck: {passed: true, reason: '工程注入：本次偏好回应已完成，原目标和未决许可保留'}} : {})}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async maxActionsPerTrigger => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({maxActionsPerTrigger, onlyGuard: true})
  }, completedResponse ? 2 : 1)
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  const read = () => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {state: await api.readProductRuntimeState(id), runs: await db.agentRuns.where('productRuntimeSessionId').equals(id).toArray()}
  }, f.sessionId)
  return {calls, read, responseText}
}

for (const width of [390, 1440]) for (const completedResponse of [false, true]) test(`responds to actual message evidence and reloads without new calls at ${width}, completed response ${completedResponse}`, async ({page}) => {
  await page.setViewportSize({width, height: 900})
  const {calls, read, responseText} = await setup(page, false, completedResponse), before = await read()
  await page.getByPlaceholder('对当前场景中的角色说话…').fill(playerText)
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect(page.getByText(responseText, {exact: true})).toBeVisible()
  await expect.poll(async () => (await read()).runs[0]?.status).toBe('completed')
  const after = await read()
  expect(after.state.interaction.chatNarrative.situation).toEqual(before.state.interaction.chatNarrative.situation)
  if (completedResponse) expect(after.state.interaction.chatNarrative.triggers.at(-1)).toMatchObject({status: 'complete', direction: {actionLimit: 2}})
  expect(calls).toEqual(['choice', 'expression', 'review'])
  expect(await page.locator('body').innerText()).not.toContain('仅供选择使用的内部说明')
  await page.reload()
  await expect(page.getByText(responseText, {exact: true})).toBeVisible()
  expect((await read()).state).toEqual(after.state)
  expect(calls).toEqual(['choice', 'expression', 'review'])
})

test('rejects an undelivered message before expression and preserves the failure without retry on refresh', async ({page}) => {
  const {calls, read} = await setup(page, true), before = await read()
  await page.getByPlaceholder('对当前场景中的角色说话…').fill(playerText)
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect.poll(async () => (await read()).runs[0]?.status).toBe('failed')
  await expect(page.getByText(reply, {exact: true})).toHaveCount(0)
  const after = await read()
  expect(after.state.interaction.messages.map((message: {role: string}) => message.role)).toEqual(['player'])
  expect(after.state.interaction.chatNarrative.situation).toEqual(before.state.interaction.chatNarrative.situation)
  await page.reload()
  await expect(page.getByText(playerText, {exact: true})).toBeVisible()
  expect((await read()).state).toEqual(after.state)
  expect(calls).toEqual(['choice'])
})
