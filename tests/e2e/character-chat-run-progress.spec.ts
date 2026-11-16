import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect, type Page} from '@playwright/test'

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-progress.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
})
async function seed(page: Page) {
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 1})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  return f
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => {release = resolve})
  return {promise, release}
}
const text = '我先查看门边，再和你商量。'
const action = {kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
const review = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具：柜台下的秘密不向玩家披露'}))}

test('shows actual generation and review phases without displaying the unadopted reply or private review', async ({page}, testInfo) => {
  const generation = gate(), checking = gate()
  let calls = 0
  await page.route('https://chat-progress.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const check = ++calls === 2
    await (check ? checking : generation).promise
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, check ? review : action)}, finish_reason: 'stop'}]})})
  })
  try {
    await seed(page)
    await page.getByRole('button', {name: '让角色继续', exact: true}).click()
    const progress = page.getByTestId('chat-run-progress')
    await expect(progress).toContainText('等待角色行动')
    await expect(progress).toContainText('本阶段已等待')
    await expect(page.getByText(text, {exact: true})).toHaveCount(0)
    expect(calls).toBe(1)
    generation.release()
    await expect(progress).toContainText('正在核对候选与故事后果')
    await expect(page.getByText(text, {exact: true})).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('柜台下')
    await page.setViewportSize({width: 390, height: 844})
    await progress.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({path: testInfo.outputPath('progress-mobile.png')})
    expect(calls).toBe(2)
    checking.release()
    await expect(page.getByText(text, {exact: true})).toBeVisible()
    await expect(progress).toHaveCount(0)
    await reloadWithBrowserFixtureAIConfigV1(page)
    await expect(page.getByText(text, {exact: true})).toBeVisible()
    expect(calls).toBe(2)
  } finally {generation.release(); checking.release()}
})

for (const phase of ['choice', 'expression'] as const) test(`refresh labels the persisted ${phase} request as history and does not restart it`, async ({page}) => {
  const generation = gate()
  const stage = phase === 'choice' ? '正在选择角色的下一步行动' : '等待角色行动'
  const expectedCalls = phase === 'choice' ? 1 : 2
  let calls = 0
  await page.route('https://chat-progress.invalid/**', async route => {
    calls++
    if (phase === 'expression' && await fulfillChatActionChoiceFixture(route)) return
    await generation.promise
    await route.abort()
  })
  try {
    await seed(page)
    await page.getByRole('button', {name: '让角色继续', exact: true}).click()
    await expect(page.getByTestId('chat-run-progress')).toContainText(stage)
    await expect.poll(() => calls).toBe(expectedCalls)
    await reloadWithBrowserFixtureAIConfigV1(page)
    const progress = page.getByTestId('chat-run-progress')
    await expect(progress).toContainText(`上次保存的阶段：${stage}`)
    await expect(progress).toContainText('不代表模型仍在运行')
    await expect(progress).not.toContainText('本阶段已等待')
    await expect(page.getByRole('button', {name: '补齐未完成本轮', exact: true})).toBeDisabled()
    await reloadWithBrowserFixtureAIConfigV1(page)
    await expect(page.getByTestId('chat-run-progress')).toContainText('上次保存的阶段')
    expect(calls).toBe(expectedCalls)
  } finally {generation.release()}
})

test('cancelling during review stops local progress and cannot apply the late response', async ({page}) => {
  const checking = gate()
  let calls = 0
  await page.route('https://chat-progress.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const check = ++calls === 2
    if (check) await checking.promise
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, check ? review : action)}, finish_reason: 'stop'}]})})
  })
  try {
    const f = await seed(page)
    await page.getByRole('button', {name: '让角色继续', exact: true}).click()
    await expect(page.getByTestId('chat-run-progress')).toContainText('正在核对候选与故事后果')
    await page.getByRole('button', {name: '取消', exact: true}).click()
    await expect(page.getByTestId('chat-run-progress')).toHaveCount(0)
    checking.release()
    await reloadWithBrowserFixtureAIConfigV1(page)
    await expect(page.getByTestId('chat-turn-resume')).toContainText('不会重发')
    await expect(page.getByText(text, {exact: true})).toHaveCount(0)
    expect(await page.evaluate(async sessionId => {
      const load = new Function('p', 'return import(p)')
      return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(sessionId)).interaction.messages.length
    }, f.sessionId)).toBe(0)
    expect(calls).toBe(2)
  } finally {checking.release()}
})
