import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'

test('one visible action settles its reviewed direction and survives import before a short reply receives actual progress', async ({page}) => {
  const direction = '检查后门门闩，补足局部线索，不预设铜印已经找到。'
  const calls: string[] = []
  let actions = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-progression.invalid/v1', model: 'test', maxTokens: 6000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://chat-progression.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const actionReview = prompt.includes('本次持久化行动候选'), situationReview = prompt.includes('本次持久化情境候选')
    const construction = !situationReview && prompt.includes('你是 StoryForge 受治理的幕后情境构建器')
    calls.push(actionReview ? 'action-review' : situationReview ? 'situation-review' : construction ? 'construction' : 'action')
    let output: unknown
    if (actionReview || situationReview) output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', ...(actionReview ? ['consequences'] : []), 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是语义质量验收'}))}
    else if (construction) {
      expect(prompt).toContain(direction)
      expect(prompt).toContain('continued-thread')
      output = {kind: 'chat-situation', title: '门闩的线索', location: '驿站', timeLabel: '傍晚',
        newFacts: [{factKey: 'latch', kind: 'object', text: '后门门闩有一处松动。', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['lost'], seedExcerpt: '检查后门门闩'}],
        newGoals: [], newThreads: [], possibilities: [{actorKey: 'guard', text: '可以继续查看，也可以暂停。', evidenceFactKeys: ['latch']}]}
    } else {
      actions++
      expect(prompt).not.toContain('柜台下')
      if (actions === 2) expect(prompt).toContain('后门门闩有一处松动。')
      output = {kind: actions === 1 ? 'speak' : 'complete', text: actions === 1 ? '我想先独自检查后门门闩。你可以留在这里。' : '你不用动手。我独自拧紧松动的门闩，门扇现在可以合上。',
        goalKey: 'find-seal', evidenceFactKeys: [actions === 1 ? 'lost' : 'latch'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: actions === 1 ? [] : [{factKey: 'door-fixed', kind: 'observation', text: '门扇现在可以合上。', evidenceFactKeys: ['latch'], evidenceExcerpt: '门扇现在可以合上。'}], disclosures: [], threadUpdates: [], goalStatus: null,
        situationRequest: actions === 1 ? {threadKey: 'investigate', direction, evidenceFactKeys: ['lost'], evidenceExcerpt: '我想先独自检查后门门闩。'} : null}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  let f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})})
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByText('我想先独自检查后门门闩。你可以留在这里。', {exact: true})).toBeVisible()
  await expect.poll(() => calls).toEqual(['action', 'action-review', 'construction', 'situation-review'])
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  await page.reload()
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  await expect.poll(() => calls).toEqual(['action', 'action-review', 'construction', 'situation-review'])
  f = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), backup = await load('/storyforge/src/lib/export/json-export.ts')
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.scope.projectId))
    const db = (await load('/storyforge/src/lib/db/schema.ts')).db
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    return {scope: {projectId, worldId: session.worldId, workId: session.workId}, sessionId: session.id, sceneSequence: f.sceneSequence}
  }, f)
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  await expect(page.getByRole('button', {name: /^恢复 Run/})).toHaveCount(0)
  await expect.poll(() => calls).toEqual(['action', 'action-review', 'construction', 'situation-review'])
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByLabel('发送给角色的消息').fill('我在听，还是不参与调查。')
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect(page.getByText('你不用动手。我独自拧紧松动的门闩，门扇现在可以合上。', {exact: true})).toBeVisible()
  expect(calls).toEqual(['action', 'action-review', 'construction', 'situation-review', 'action', 'action-review'])
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  const before = await read()
  expect(before.messages.map((m: {role: string}) => m.role)).toEqual(['character', 'player', 'character'])
  expect(before.chatNarrative.situation.facts.some((fact: {factKey: string}) => fact.factKey === 'door-fixed')).toBe(true)
  expect(before.chatNarrative.situation.seed.origin).toBe('continued-thread')
  expect(before.chatNarrative.pendingSituation).toBeUndefined()
  await page.reload()
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(before)
  expect(calls).toHaveLength(6)
  await page.getByText('当前已知的局面', {exact: true}).click()
  await expect(page.getByRole('listitem').filter({hasText: /^后门门闩有一处松动。$/})).toBeVisible()
  await expect(page.getByText('掌柜把铜印留在柜台下的木箱里。', {exact: true})).toHaveCount(0)
})
