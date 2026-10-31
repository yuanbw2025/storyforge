import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'

test('author saves an explicit thread-continuation permission and disabling expansion clears it', async ({page}) => {
  let calls = 0
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/local-codex/v1/requests', async route => {if (route.request().method() === 'POST') {calls++; await route.abort()} else await route.continue()})
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const scope = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts')).seedChatNarrativeProductionFixture()).scope})
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/vision?project=${scope.projectId}&work=${scope.workId}`)
  const follow = page.getByLabel('完成自己的一个目标后，允许角色接续参与中的未完成事项', {exact: true}), expansion = page.getByLabel('允许角色依据未完成事项发展新局面', {exact: true})
  await expect(follow).not.toBeChecked(); await follow.check()
  await page.getByRole('button', {name: '保存方案', exact: true}).click(); await expect(page.getByText('方案已保存', {exact: true})).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(follow).toBeChecked()
  await expansion.uncheck(); await expect(follow).not.toBeChecked(); await expect(follow).toBeDisabled()
  await page.getByRole('button', {name: '保存方案', exact: true}).click(); await expect(page.getByText('方案已保存', {exact: true})).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(follow).not.toBeChecked(); await expect(follow).toBeDisabled(); expect(calls).toBe(0)
})

test('player continues an existing thread after personal closure through a reviewed action and portable history', async ({page}, info) => {
  const calls: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://thread-followup.invalid/v1', model: 'test', apiKey: 'isolated-test-key' })
  await page.route('https://thread-followup.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n'), review = prompt.includes('本次持久化行动候选')
    calls.push(review ? 'review' : 'action')
    expect(prompt).toContain('threadFollowupGoal')
    if (!review) expect(prompt).not.toContain('柜台下')
    const text = '叶岑来到驿站门口察看倒树挡住山路的位置。', output = review
      ? {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '注入工程审查，不是语义质量验收。'})), disclosureChecks: [], commitmentChecks: [], memoryChecks: []}
      : {kind: 'complete', text, goalKey: 'assess-road', evidenceFactKeys: ['road'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: [{factKey: 'route-viewpoint', kind: 'observation', text, evidenceFactKeys: ['road'], evidenceExcerpt: text}], disclosures: [], threadUpdates: [], goalStatus: null,
        threadFollowupGoal: {threadKey: 'investigate', evidenceExcerpt: text, goal: {goalKey: 'assess-road', desire: '判断自己能如何帮助恢复通行', concern: '天黑后处理倒树有危险', boundary: '不要求旅人参与', evidenceFactKeys: ['road']}},
        nextPossibilities: [{text: '判断眼前路况中自己能处理的部分。', evidenceFactKeys: ['road', 'route-viewpoint']}]}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), helper = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const f = await helper.seedChatNarrativeRuntimeFixture({actorThreadFollowup: true, onlyGuard: true}), v = await api.readProductRuntimeStateVersion(f.sessionId)
    await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'initial', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
    const generated = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程夹具：结束寻找，原事项仍含离开需求',
      runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async () => JSON.stringify({kind: 'speak', text: '我不再寻找铜印了。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'abandoned', nextPossibilities: []})),
      runReviewAI: async () => JSON.stringify(helper.chatActionReviewOutputFixture())})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
    return f
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByRole('paragraph').filter({hasText: /^叶岑来到驿站门口察看倒树挡住山路的位置。$/})).toBeVisible()
  expect(calls).toEqual(['action', 'review'])
  const read = () => page.evaluate(async id => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id)).interaction}, f.sessionId)
  const state = await read()
  expect(state.chatNarrative.situation.goals[0].status).toBe('abandoned')
  expect(state.chatNarrative.situation.goals.at(-1)).toMatchObject({goalKey: 'assess-road', actorKey: 'guard', status: 'active'})
  expect(state.chatNarrative.situation.threads).toHaveLength(1); expect(state.chatNarrative.situation.threads[0].status).toBe('open')
  await reloadWithBrowserFixtureAIConfigV1(page); expect(await read()).toEqual(state); expect(calls).toHaveLength(2)
  await page.setViewportSize({width: 390, height: 844})
  await expect(page.getByRole('paragraph').filter({hasText: /^叶岑来到驿站门口察看倒树挡住山路的位置。$/})).toBeVisible()
  await page.screenshot({path: info.outputPath('thread-followup-mobile.png'), fullPage: true})
  const restored = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), backup = await load('/storyforge/src/lib/export/json-export.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const child = await api.branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await api.readProductRuntimeStateVersion(f.sessionId)).sequence, title: '接续分支'})
    const nested = await api.branchProductRuntimeSession({parentSessionId: child.id, throughSequence: (await api.readProductRuntimeStateVersion(child.id)).sequence, title: '接续继承'})
    const expected = (await api.readProductRuntimeState(nested.id)).interaction
    await api.deleteProductRuntimeSession(child.id); await api.deleteProductRuntimeSession(f.sessionId)
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.scope.projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: {title: string}) => s.title === '接续继承')
    const actual = (await api.readProductRuntimeState(session.id)).interaction
    return {equal: JSON.stringify(expected) === JSON.stringify(actual), actual}
  }, f)
  expect(restored.equal).toBe(true); expect(restored.actual.chatNarrative.situation.goals.at(-1).updatedSequence).toBeLessThan(0)
  expect(calls).toHaveLength(2)
})
