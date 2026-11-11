import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {expect, test} from '@playwright/test'

for (const rejectRevision of [false, true]) test(`explicitly revises rejected consequence bookkeeping once and refresh never retries (${rejectRevision})`, async ({page}) => {
  test.setTimeout(120000)
  const text = '寻找铜印的事情先暂停，等通道恢复再继续。'
  const action = {kind: 'pause', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'artisan', 'player'],
    waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'paused'}
  let calls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'isolated-revision')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-revision.invalid/v1', model: 'test', maxTokens: 4000, apiKey: 'isolated-fixture-key' })
  await page.route('https://chat-revision.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    calls++
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const reviewing = prompt.includes('本次持久化行动候选')
    if (!reviewing) {expect(prompt).not.toContain('柜台下'); expect(prompt).not.toContain('审查私有理由')}
    const output = reviewing ? {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction']
      .map(check => ({check, passed: !(check === 'consequences' && (calls === 2 || rejectRevision)), reason: '审查私有理由：柜台下。工程夹具，不是质量评分。'}))}
      : calls === 1 ? action : {...action, threadUpdates: [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: text}]}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()})
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByTestId('chat-action-revision')).toBeVisible()
  await expect(page.getByText(text, {exact: true})).toHaveCount(0)
  await expect(page.getByText('审查私有理由', {exact: false})).toHaveCount(0)
  expect(calls).toBe(2)
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-action-revision')).toBeVisible(); expect(calls).toBe(2)
  await page.setViewportSize({width: 390, height: 844})
  await page.getByRole('button', {name: '修订未通过回复', exact: true}).click()
  await expect.poll(() => calls).toBe(4)
  await expect(page.getByTestId('chat-action-revision')).toHaveCount(0)
  if (!rejectRevision) await expect(page.getByText(text, {exact: true})).toBeVisible()
  else await expect(page.getByText(/行动语义审查未通过/)).toBeVisible()
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db;
    return {state: await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId), statuses: (await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).toArray()).map((r: {status: string}) => r.status)}}, f)
  const result = await read()
  expect(result.statuses).toEqual(['failed', rejectRevision ? 'failed' : 'completed'])
  expect(result.state.interaction.messages).toHaveLength(rejectRevision ? 0 : 1)
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(result); expect(calls).toBe(4)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
