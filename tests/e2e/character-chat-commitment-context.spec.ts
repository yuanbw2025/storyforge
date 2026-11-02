import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {test, expect} from '@playwright/test'

test('explains 18 retained promises beyond the former storage limit, retains exact historical evidence and keeps promises when dialogue is excluded', async ({page}, info) => {
  test.setTimeout(120_000)
  let calls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://promise-context.invalid/v1', model: 'test', maxTokens: 8000, apiKey: 'isolated-test-key' })
  await page.route('https://promise-context.invalid/**', async route => {calls++; await route.abort()})
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const fixture = await load('/storyforge/tests/helpers/chat-commitment-history-runtime.ts')
    const promise = await load('/storyforge/tests/helpers/chat-commitment-fixture.ts')
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const f = await fixture.seedChatCommitmentHistoryRuntimeFixture({count: 18})
    const action = {...promise.chatPromiseActionFixture(), text: '地图的约定已经撤回，眼下这项整理约定还在。', commitmentEffects: []}
    const generated = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '核对历史输入',
      runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async (messages: Array<{content: string}>) => {
        if (!messages[1].content.includes('靛蓝地图') || !messages[1].content.includes('withdrawn')) throw new Error('角色未读到相关原约和处置')
        return JSON.stringify(action)
      }), runReviewAI: async () => JSON.stringify(promise.chatCommitmentReviewOutputFixture(action))})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
    const state = (await api.readProductRuntimeState(f.sessionId)).interaction
    const open = state.chatNarrative.situation.goals[0].commitments.find((c: {resolution: unknown}) => c.resolution === null)
    return {...f, runId: generated.snapshot.run.id, openMessageId: open.declared.messageId, openSequence: open.declared.sequence, openTerms: open.terms}
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByRole('button', {name: '查看本次上下文', exact: true}).click()
  const inspector = page.getByTestId('chat-context-inspector'), selection = page.getByTestId('chat-context-selection')
  const summary = selection.locator('summary').filter({hasText: '约定历史的选入与省略'})
  const commitments = summary.locator('..'), more = commitments.getByRole('button', {name: '再显示 12 条资料', exact: true})
  await expect(summary).toContainText(/本轮省略 [1-9]\d* 条/)
  await summary.click()
  // The fixed 18-entry fixture needs one page beyond the initial 12. Wait for
  // the toggle render and its button instead of observing an immediate count.
  await more.click()
  await expect(more).toHaveCount(0)
  await expect(commitments).toContainText(f.openTerms)
  await expect(selection).toContainText('已选入 · 尚未处理的约定，每轮保留')
  await expect(selection).toContainText('已选入 · 这件事最近一次履行或撤回')
  await expect(selection).toContainText('我答应修补靛蓝地图后还给你。')
  await expect(page.getByTestId('chat-context-commitments')).toContainText('当时已撤回')
  for (const secret of ['柜台下', '无辜旅人', '担心再次错怪人']) await expect(inspector).not.toContainText(secret)
  await page.setViewportSize({width: 390, height: 844})
  await summary.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath('promise-selection-mobile.png')})
  const history = await inspector.innerText()
  await reloadWithBrowserFixtureAIConfigV1(page)
  await page.getByRole('button', {name: '查看本次上下文', exact: true}).click()
  await summary.click()
  await more.click()
  await expect(more).toHaveCount(0)
  await expect(commitments).toContainText(f.openTerms)
  expect(await inspector.innerText()).toBe(history)
  const article = page.getByRole('article').filter({hasText: f.openTerms})
  await article.getByLabel(`消息操作 ${f.openSequence}`, {exact: true}).click()
  await article.getByLabel(`上下文设置 ${f.openSequence}`, {exact: true}).click()
  const preview = page.getByTestId('chat-message-retrieval-preview')
  await expect(preview).toContainText('排除原话不会撤销承诺或履约记录')
  await preview.getByRole('button', {name: '仅排除对话上下文', exact: true}).click()
  // The click starts a durable update; the preview closes only after it is saved.
  await expect(preview).toHaveCount(0)
  const result = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const runtime = await load('/storyforge/src/lib/character-interaction/runtime.ts')
    const state = (await api.readProductRuntimeState(f.sessionId)).interaction, view = runtime.buildInteractionContextWindow(state, 'guard')
    return {rawSelected: view.messages.some((m: {messageId: string}) => m.messageId === f.openMessageId), historyCount: state.chatNarrative.situation.goals[0].commitments.length,
      open: view.chatNarrative.goals[0].commitments.find((c: {resolution: unknown}) => c.resolution === null)?.terms}
  }, f)
  expect(result).toEqual({rawSelected: false, historyCount: 18, open: f.openTerms})
  expect(calls).toBe(0)
})
