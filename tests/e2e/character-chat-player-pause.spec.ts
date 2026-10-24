import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'

test('player pause survives portable branches, ignores continue and weak assent, then resumes from explicit confirmation', async ({page}, info) => {
  test.setTimeout(120000)
  const stop = '先别去检查山路，等我确认可以再去。', ack = '好，在你明确说可以之前，我先不去检查山路。'
  const release = '现在可以去检查了，我留在这里。', done = '我按你的确认查看了门外的山路，倒树仍挡在路上。', waiting = '不急，我还在这里等。'
  let sessionId = 0, actions = 0; const calls: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://player-pause.invalid/v1', model: 'test'}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  const read = () => page.evaluate(async id => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id)).interaction}, sessionId)
  await page.route('https://player-pause.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const messages = route.request().postDataJSON().messages as Array<{content: string}>, review = messages[1].content.includes('本次持久化行动候选')
    calls.push(review ? 'review' : 'action'); let value: unknown
    if (review) {
      expect(messages[0].content).toContain('玩家暂停及恢复专审')
      value = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程注入判定，非模型语义质量验收。'})),
        disclosureChecks: [], memoryChecks: [], commitmentChecks: actions === 2 || actions === 3 ? [] : [{effectIndex: 0, passed: true, reason: '工程注入约定检查'}]}
    } else {
      actions++; const state = await read(), seq = state.chatNarrative.triggers.at(-1).sourceEventSequence
      expect(messages[1].content).not.toContain('柜台下')
      const base = {kind: 'speak', text: ack, goalKey: 'assess-road', evidenceFactKeys: ['road'], audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: true, newFacts: [], disclosures: [], goalStatus: null, threadUpdates: []}
      if (actions === 1) value = {...base, goalStatus: 'paused', threadUpdates: [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: ack}],
        commitmentEffects: [{kind: 'promise', terms: ack, evidenceExcerpt: ack}], nextPossibilities: [],
        threadFollowupGoal: {threadKey: 'investigate', evidenceExcerpt: ack, pauseRequest: {playerEventSequence: seq, playerExcerpt: stop},
          goal: {goalKey: 'assess-road', desire: '判断自己能如何帮助恢复通行', concern: '天黑后处理倒树有危险', boundary: '等玩家明确确认再检查，不要求玩家同行', evidenceFactKeys: ['road']}}}
      else if (actions === 2 || actions === 3) value = {...base, text: actions === 2 ? waiting : '好，不急。', evidenceFactKeys: []}
      else {
        expect(messages[1].content).toContain('playerPause'); expect(messages[1].content).toContain(stop)
        value = {...base, kind: 'complete', text: done, waitingForPlayer: false, goalStatus: 'fulfilled',
          newFacts: [{factKey: 'road-checked', kind: 'observation', text: done, evidenceFactKeys: ['road'], evidenceExcerpt: done}],
          threadUpdates: [{threadKey: 'investigate', status: 'open', evidenceExcerpt: done}], resumeGoal: {playerEventSequence: seq, playerExcerpt: actions === 3 ? '嗯。' : release},
          commitmentEffects: [{kind: 'fulfill', commitmentKey: state.chatNarrative.situation.goals.at(-1).commitments[0].commitmentKey, evidenceExcerpt: done}]}
      }
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, value)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  let f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), helper = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const f = await helper.seedChatNarrativeRuntimeFixture({actorThreadFollowup: true}), v = await api.readProductRuntimeStateVersion(f.sessionId)
    await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'initial', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
    const run = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '注入工程前缀：结束寻找，离开事项仍在',
      runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async () => JSON.stringify({kind: 'speak', text: '我不再寻找铜印了。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'abandoned', nextPossibilities: []})),
      runReviewAI: async () => JSON.stringify(helper.chatActionReviewOutputFixture())})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: run.snapshot.run.id}); return f
  })
  sessionId = f.sessionId
  const open = async () => {await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${sessionId}`); await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')}
  const send = async (text: string) => {await page.getByPlaceholder('对当前场景中的角色说话…').fill(text); await page.getByRole('button', {name: '发送并生成', exact: true}).click()}
  await open(); await send(stop)
  await expect(page.getByRole('article').getByText(ack, {exact: true})).toBeVisible()
  const held = await read(); expect(held.chatNarrative.situation.goals[0].status).toBe('abandoned'); expect(held.chatNarrative.situation.goals.at(-1).status).toBe('paused')
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
  expect((await read()).chatNarrative.situation.goals.at(-1).playerPause.requested.sequence).toBeLessThan(0)
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByRole('article').getByText(waiting, {exact: true})).toBeVisible()
  expect((await read()).chatNarrative.situation.goals.at(-1).status).toBe('paused')
  await send('嗯。'); await expect(page.getByRole('article').getByText('好，不急。', {exact: true})).toBeVisible()
  expect((await read()).chatNarrative.situation.goals.at(-1).status).toBe('paused')
  await send(release); await expect(page.getByRole('article').getByText(done, {exact: true})).toBeVisible()
  const after = await read(); expect(after.chatNarrative.situation.goals.at(-1).status).toBe('fulfilled'); expect(after.chatNarrative.situation.goals.at(-1)).not.toHaveProperty('playerPause')
  expect(after.chatNarrative.situation.goals).toHaveLength(3); expect(after.chatNarrative.situation.threads).toHaveLength(1)
  expect(calls).toEqual(['action', 'review', 'action', 'review', 'action', 'review', 'action', 'review'])
  await page.reload(); await expect(page.getByRole('article').getByText(done, {exact: true})).toBeVisible(); expect(await read()).toEqual(after)
  await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
  const panel = page.getByTestId('chat-commitment-panel'); await panel.getByText('已处理的约定（1）', {exact: true}).click(); await expect(panel).toContainText('已履行')
  await page.setViewportSize({width: 390, height: 844}); await panel.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath('player-pause-mobile.png')}); expect(calls).toHaveLength(8)
})
