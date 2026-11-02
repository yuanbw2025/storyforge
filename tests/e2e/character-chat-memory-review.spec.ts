import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {test, expect} from '@playwright/test'

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-memory-review.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
})

test('hides unchecked legacy memory text and blocks adoption, while reviewed proposals remain a player choice after reload', async ({page}, testInfo) => {
  let calls = 0
  await page.route('https://chat-memory-review.invalid/**', async route => {calls++; await route.abort()})
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const message = await api.commitInteractionPlayerMessage({...await command(), messageId: 'rest', text: '我想先休息。'})
    await api.proposeInteractionMemory({...await command(), memoryId: 'legacy', participantKey: 'guard', kind: 'key-memory', content: '角色担心再次错怪人。',
      importance: 60, sourceEventSequences: [message.sequence], evidenceExcerpt: '先休息'})
    const result = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.interaction-memory-curator', objective: '隔离浏览器记忆检查',
      runAI: async () => JSON.stringify({kind: 'memory-curator', memoryKind: 'key-memory', content: '玩家表示想先休息。', importance: 60, sourceEventSequences: [message.sequence], evidenceExcerpt: '先休息'}),
      runReviewAI: async () => JSON.stringify({checks: ['source-fidelity', 'player-visibility', 'no-private-inference'].map(check => ({check, passed: true, reason: '不显示这段私有审查理由'}))})})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
    return {...f, memoryId: result.candidate.memoryId}
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  await expect(page.getByText('玩家表示想先休息。', {exact: true})).toBeVisible()
  await expect(page.locator('body')).not.toContainText('担心再次错怪人')
  await expect(page.locator('body')).not.toContainText('不显示这段私有审查理由')
  const unchecked = page.locator('article').filter({hasText: '这条旧记忆尚未完成正文检查'})
  await expect(unchecked.getByRole('button', {name: '采用', exact: true})).toBeDisabled()
  const proposal = page.locator('article').filter({has: page.getByText('玩家表示想先休息。', {exact: true})})
  await expect(proposal.getByRole('button', {name: '采用', exact: true})).toBeEnabled()
  await reloadWithBrowserFixtureAIConfigV1(page)
  await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  await expect(proposal.getByRole('button', {name: '采用', exact: true})).toBeVisible()
  await page.setViewportSize({width: 390, height: 844})
  await proposal.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: testInfo.outputPath('memory-review-mobile.png')})
  await proposal.getByRole('button', {name: '采用', exact: true}).click()
  await expect(proposal.getByRole('button', {name: '采用', exact: true})).toHaveCount(0)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  expect(await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)')
    const current = (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction
    return current.memories.map((m: {memoryId: string; status: string}) => ({id: m.memoryId, status: m.status}))
  }, f)).toEqual([{id: 'legacy', status: 'proposed'}, {id: f.memoryId, status: 'accepted'}])
  expect(calls).toBe(0)
})

test('review failure preserves the scene and lets the player explicitly end without another memory call', async ({page}) => {
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const v = await api.readProductRuntimeStateVersion(f.sessionId)
    const message = await api.commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'rest', text: '我想先休息。'})
    return {...f, sequence: message.sequence}
  })
  let calls = 0
  await page.route('https://chat-memory-review.invalid/**', async route => {
    const review = ++calls === 2
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify(review
      ? {checks: ['source-fidelity', 'player-visibility', 'no-private-inference'].map(check => ({check, passed: false, reason: '角色担心再次错怪人，来源不支持'}))}
      : {kind: 'memory-curator', memoryKind: 'key-memory', content: '角色担心再次错怪人。', importance: 60, sourceEventSequences: [f.sequence], evidenceExcerpt: '先休息'})}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByRole('button', {name: '结束场景', exact: true}).click()
  await expect(page.getByText(/记忆整理未完成，场景保留以供恢复/)).toBeVisible()
  await expect(page.locator('body')).not.toContainText('担心再次错怪人')
  await expect(page.getByRole('button', {name: '结束场景', exact: true})).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByRole('button', {name: '结束场景', exact: true})).toBeVisible()
  expect(calls).toBe(2)
  await page.getByRole('button', {name: '结束且跳过记忆整理', exact: true}).click()
  await expect(page.getByText('当前场景已结束', {exact: true})).toBeVisible()
  expect(calls).toBe(2)
})

test('refresh exposes an unfinished memory generation for explicit cancellation without sending a replacement request', async ({page}) => {
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const v = await api.readProductRuntimeStateVersion(f.sessionId)
    await api.commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'rest', text: '我想先休息。'})
    return f
  })
  let release!: () => void
  const waiting = new Promise<void>(resolve => {release = resolve})
  let calls = 0
  await page.route('https://chat-memory-review.invalid/**', async route => {calls++; await waiting; await route.abort()})
  try {
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
    await page.getByRole('button', {name: '结束场景', exact: true}).click()
    await expect(page.getByTestId('chat-run-progress')).toContainText('等待记忆候选')
    await expect.poll(() => calls).toBe(1)
    await reloadWithBrowserFixtureAIConfigV1(page)
    await expect(page.getByTestId('chat-run-progress')).toContainText('上次保存的阶段：等待记忆候选')
    await page.getByRole('button', {name: /取消未完成处理 #/}).click()
    await expect(page.getByRole('button', {name: /取消未完成处理 #/})).toHaveCount(0)
    await expect(page.getByRole('button', {name: '结束场景', exact: true})).toBeVisible()
    expect(calls).toBe(1)
  } finally {release()}
})
