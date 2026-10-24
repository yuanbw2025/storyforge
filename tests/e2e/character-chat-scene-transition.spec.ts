import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'

for (const accepted of [true, false]) test(`known-place arrival and scene header remain atomic after reload/import (${accepted})`, async ({page}, info) => {
  test.setTimeout(120000)
  const request = '我们一起去后院看看，但今天不拆东西，也不买东西。', arrived = '我们已经一起走到后院。'
  let sessionId = 0, sourceSequence = 0; const calls: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://scene-transition.invalid/v1', model: 'test'}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  const read = () => page.evaluate(async id => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id)).interaction}, sessionId)
  await page.route('https://scene-transition.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const messages = route.request().postDataJSON().messages as Array<{content: string}>, review = messages[1].content.includes('本次持久化行动候选')
    calls.push(review ? 'review' : 'action'); let value: unknown
    if (review) {
      expect(messages[0].content).toContain('转场专审')
      value = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程注入，非模型质量验收。'})),
        disclosureChecks: [], memoryChecks: [], commitmentChecks: [], sceneTransitionCheck: {destinationFactKey: 'courtyard', arrivalFactKey: 'arrival-1', playerEventSequence: sourceSequence, passed: accepted, reason: accepted ? '工程注入：真实请求与到达。' : '工程注入：拒绝到达判定。'}}
    } else {
      expect(messages[1].content).not.toContain('柜台下'); expect(messages[1].content).toContain(request); expect(messages[1].content).toContain('后院就在驿站旁边')
      sourceSequence = (await read()).chatNarrative.triggers.at(-1).sourceEventSequence
      value = {kind: 'complete', text: arrived, goalKey: 'find-seal', evidenceFactKeys: ['courtyard'], audienceKeys: ['player', 'guard'], waitingForPlayer: false,
        newFacts: [{factKey: 'arrival-1', kind: 'observation', text: arrived, evidenceExcerpt: arrived, evidenceFactKeys: ['courtyard']}], disclosures: [], goalStatus: null, threadUpdates: [],
        sceneTransition: {destinationFactKey: 'courtyard', destinationExcerpt: '后院', arrivalFactKey: 'arrival-1', evidenceExcerpt: arrived, playerEventSequence: sourceSequence, playerExcerpt: request}}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, value)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  let f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({onlyGuard: true, knownDestination: true})
  })
  sessionId = f.sessionId
  const open = async () => {await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${sessionId}`); await expect(page.getByPlaceholder('对当前场景中的角色说话…')).toBeVisible()}
  await open(); await page.getByPlaceholder('对当前场景中的角色说话…').fill(request)
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  if (accepted) await expect(page.getByRole('article').getByText(arrived, {exact: true})).toBeVisible()
  else await expect(page.getByText(/行动语义审查未通过/)).toBeVisible()
  const expected = await read(), location = accepted ? '后院' : '驿站'
  expect(expected.activeScene.location).toBe(location); expect(expected.chatNarrative.situation.location).toBe(location)
  expect(expected.chatNarrative.sceneTransitions?.length ?? 0).toBe(accepted ? 1 : 0)
  expect(calls).toEqual(['action', 'review'])
  await page.reload()
  await expect(page.getByText(accepted ? '后院 · 后院 · 傍晚' : '暴雨驿站 · 驿站 · 傍晚', {exact: true})).toBeVisible()
  expect(await read()).toEqual(expected)
  f = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), backup = await load('/storyforge/src/lib/export/json-export.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const before = (await api.readProductRuntimeState(f.sessionId)).interaction
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    if (JSON.stringify((await api.readProductRuntimeState(imported.id)).interaction) !== JSON.stringify(before)) throw Error('transfer state changed on import')
    return {...f, sessionId: imported.id, scope: {projectId, worldId: imported.worldId, workId: imported.workId}}
  }, f)
  sessionId = f.sessionId; await open()
  await expect(page.getByText(accepted ? '后院 · 后院 · 傍晚' : '暴雨驿站 · 驿站 · 傍晚', {exact: true})).toBeVisible()
  expect(await read()).toEqual(expected)
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath('scene-transfer-mobile.png')}); expect(calls).toHaveLength(2)
})
