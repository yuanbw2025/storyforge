import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'

test('existing goal holds its source through report, return, weak assent and explicit resumption', async ({page}, info) => {
  test.setTimeout(120000)
  const stop = '先别找铜印，等我明确说可以再继续。', ack = '好，在你明确同意前，我暂停寻找铜印。'
  const release = '现在可以继续寻找铜印了。', done = '按你的确认，我查看了门边，门边没有发现铜印。', waiting = '不急，我还在这里等。'
  let sessionId = 0, actions = 0; const calls: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://player-pause.invalid/v1', model: 'test', apiKey: 'isolated-test-key' })
  const read = () => page.evaluate(async id => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id)).interaction}, sessionId)
  await page.route('https://player-pause.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const messages = route.request().postDataJSON().messages as Array<{content: string}>, review = messages[1].content.includes('本次持久化行动候选')
    calls.push(review ? 'review' : 'action'); let value: unknown
    if (review) {
      expect(messages[0].content).toContain('已有目标暂停专审')
      value = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程注入判定，非模型语义质量验收。'})),
        disclosureChecks: [], memoryChecks: [], commitmentChecks: []}
    } else {
      actions++; const state = await read(), seq = state.chatNarrative.triggers.at(-1).sourceEventSequence
      expect(messages[1].content).not.toContain('柜台下')
      const base = {kind: 'speak', text: ack, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: true, newFacts: [], disclosures: [], goalStatus: null, threadUpdates: []}
      if (actions === 1) value = {...base, text: ack + '铜印还未找到。', goalStatus: 'paused',
        commitmentEffects: [], nextPossibilities: [],
        pauseGoal: {threadKey: 'investigate', playerEventSequence: seq, playerExcerpt: stop, evidenceExcerpt: ack}}
      else if (actions === 2 || actions === 3) value = {...base, text: actions === 2 ? waiting : '好，不急。', evidenceFactKeys: []}
      else {
        expect(messages[1].content).toContain('playerPause'); expect(messages[1].content).toContain(stop)
        value = {...base, kind: 'complete', text: done, waitingForPlayer: false, goalStatus: 'active',
          newFacts: [{factKey: 'door-checked', kind: 'observation', text: done, evidenceFactKeys: ['lost'], evidenceExcerpt: done}],
          threadUpdates: [], resumeGoal: {playerEventSequence: seq, playerExcerpt: release},
          commitmentEffects: []}
      }
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, value)}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  let f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
  })
  sessionId = f.sessionId
  const open = async () => {await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${sessionId}`); await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')}
  const send = async (text: string) => {await page.getByPlaceholder('对当前场景中的角色说话…').fill(text); await page.getByRole('button', {name: '发送并生成', exact: true}).click()}
  await open(); await send(stop)
  await expect(page.getByRole('article').getByText(ack + '铜印还未找到。', {exact: true})).toBeVisible()
  const held = await read(); expect(held.chatNarrative.situation.goals).toHaveLength(2); expect(held.chatNarrative.situation.goals[0].status).toBe('paused')
  expect(held.chatNarrative.situation.goals[0].commitments ?? []).toEqual([])
  expect(calls).toEqual(['action', 'review'])
  f = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), backup = await load('/storyforge/src/lib/export/json-export.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const child = await api.branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await api.readProductRuntimeState(f.sessionId)).lastSequence, title: '暂停分支'})
    const nested = await api.branchProductRuntimeSession({parentSessionId: child.id, throughSequence: (await api.readProductRuntimeState(child.id)).lastSequence, title: '暂停继承'})
    const before = (await api.readProductRuntimeState(nested.id)).interaction
    await api.deleteProductRuntimeSession(child.id); await api.deleteProductRuntimeSession(f.sessionId)
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: {title: string}) => s.title === '暂停继承')
    if (JSON.stringify((await api.readProductRuntimeState(imported.id)).interaction) !== JSON.stringify(before)) throw Error('pause did not survive import')
    return {...f, sessionId: imported.id, scope: {projectId, worldId: imported.worldId, workId: imported.workId}}
  }, f)
  sessionId = f.sessionId; await open()
  expect((await read()).chatNarrative.situation.goals[0].playerPause.requested.sequence).toBeLessThan(0)
  await page.getByRole('button', {name: '从上次局面继续', exact: true}).click()
  await expect(page.getByRole('article').getByText(waiting, {exact: true})).toBeVisible()
  expect((await read()).chatNarrative.situation.goals[0].status).toBe('paused')
  await send('嗯。'); await expect(page.getByRole('article').getByText('好，不急。', {exact: true})).toBeVisible()
  expect((await read()).chatNarrative.situation.goals[0].status).toBe('paused')
  await send(release); await expect(page.getByRole('article').getByText(done, {exact: true})).toBeVisible()
  const after = await read(); expect(after.chatNarrative.situation.goals[0].status).toBe('active'); expect(after.chatNarrative.situation.goals[0]).not.toHaveProperty('playerPause')
  expect(after.chatNarrative.situation.goals).toHaveLength(2); expect(after.chatNarrative.situation.threads).toHaveLength(1)
  expect(calls).toEqual(['action', 'review', 'action', 'review', 'action', 'review', 'action', 'review'])
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByRole('article').getByText(done, {exact: true})).toBeVisible(); expect(await read()).toEqual(after)
  await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  const panel = page.getByTestId('chat-commitment-panel'); await expect(panel).toContainText('暂无待履行的角色约定。')
  await page.setViewportSize({width: 390, height: 844}); await panel.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath('existing-goal-pause-mobile.png')}); expect(calls).toHaveLength(8)
})
