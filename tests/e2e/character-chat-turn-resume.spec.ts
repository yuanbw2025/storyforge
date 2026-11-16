import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect, type Page} from '@playwright/test'

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-resume.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
})

async function seed(page: Page, mode: 'partial' | 'unknown' | 'player') {
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async mode => {
    const load = new Function('p', 'return import(p)')
    const fixture = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')
    const f = await fixture.seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const v = await api.readProductRuntimeStateVersion(f.sessionId)
    const command = {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
    if (mode === 'player') {
      await api.commitInteractionPlayerMessage({...command, messageId: 'player', text: '我想先休息。'})
      return f
    }
    await api.requestChatNarrativeTrigger({...command, kind: 'scene-start', sourceEventSequence: v.sequence})
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    try {
      const first = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '首段工程夹具',
        runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async () => {
          if (mode === 'unknown') throw new Error('fixture response unknown')
          return JSON.stringify({kind: 'complete', text: '我把灯移到门边，门边亮了起来。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
            newFacts: [{factKey: 'light', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}], disclosures: [], threadUpdates: [], goalStatus: null})
        }), runReviewAI: async () => JSON.stringify(fixture.chatActionReviewOutputFixture()),
      })
      await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: first.snapshot.run.id})
    } catch (error) {if (mode !== 'unknown' || !(error instanceof Error) || error.message !== 'fixture response unknown') throw error}
    return f
  }, mode)
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  return f
}

test('refresh keeps an unfinished turn and explicitly completes only its remaining actions with the original role', async ({page}) => {
  let actions = 0, reviews = 0
  await page.route('https://chat-resume.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    let output: unknown
    if (prompt.includes('本次持久化行动候选')) {
      reviews++
      output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具'}))}
    } else {
      actions++
      expect(prompt).toContain('门边亮了起来。')
      expect(prompt).not.toContain('柜台下')
      output = {kind: actions <= 2 ? 'speak' : 'pause', text: actions <= 2 ? `我继续核对第 ${actions} 项。` : '下一轮我先停下等你。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
        audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await seed(page, 'partial')
  await expect(page.getByTestId('chat-turn-resume')).toContainText('最多 2 次行动额度')
  await expect(page.getByRole('button', {name: '补齐未完成本轮', exact: true})).toBeEnabled()
  expect(actions).toBe(0)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByTestId('chat-turn-resume')).toContainText('叶岑')
  expect(actions).toBe(0)
  // Selection for a new turn must not change who completes the existing one.
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('artisan')
  await page.getByRole('button', {name: '补齐未完成本轮', exact: true}).click()
  await expect(page.getByText('我继续核对第 2 项。', {exact: true})).toBeVisible()
  await expect(page.getByTestId('chat-turn-resume')).toHaveCount(0)
  const read = () => page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState().runtimeState.interaction})
  const state = await read()
  expect(state.messages.map((m: {speakerKey: string}) => m.speakerKey)).toEqual(['guard', 'guard', 'guard'])
  expect(state.chatNarrative.triggers).toHaveLength(1)
  expect(state.chatNarrative.triggers[0].actionSequences).toHaveLength(3)
  expect(state.remainingDirectorBudget).toBe(91)
  expect(actions).toBe(2); expect(reviews).toBe(2)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByText('我继续核对第 2 项。', {exact: true})).toBeVisible()
  expect(actions).toBe(2)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByText('下一轮我先停下等你。', {exact: true})).toBeVisible()
  expect((await read()).chatNarrative.triggers).toHaveLength(2)
  expect(actions).toBe(3); expect(reviews).toBe(3)
})

test('an unknown request remains visible after refresh and cannot be resent through completing the turn', async ({page}) => {
  let calls = 0
  await page.route('https://chat-resume.invalid/**', async route => {calls++; await route.abort()})
  await seed(page, 'unknown')
  await expect(page.getByTestId('chat-turn-resume')).toContainText('结果未知')
  await expect(page.getByRole('button', {name: '补齐未完成本轮', exact: true})).toBeDisabled()
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByTestId('chat-turn-resume')).toContainText('原调用可能已经计费')
  await expect(page.getByRole('button', {name: '补齐未完成本轮', exact: true})).toBeDisabled()
  expect(calls).toBe(0)
})

test('a saved player message starts one response and a waiting role offers no misleading reply-resume button', async ({page}) => {
  let calls = 0
  await page.route('https://chat-resume.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    calls++
    const review = route.request().postDataJSON().messages.some((m: {content: string}) => m.content.includes('本次持久化行动候选'))
    const output = review ? {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具'}))}
      : {kind: 'attempt', text: '可以先休息；等你想说时再告诉我。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await seed(page, 'player')
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '生成本轮回复', exact: true}).click()
  await expect(page.getByText('可以先休息；等你想说时再告诉我。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '生成本轮回复', exact: true})).toHaveCount(0)
  await expect(page.getByRole('button', {name: '生成或继续此轮回复', exact: true})).toHaveCount(0)
  await expect(page.getByTestId('chat-turn-resume')).toHaveCount(0)
  expect(calls).toBe(2)
})
