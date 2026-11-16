import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'
import {openChatNarrativeTools} from './helpers/character-chat-ui'

test('three independent role consequences survive a local failure and explicit continuation through the player UI', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', model: 'test', baseUrl: 'https://chat-ensemble.invalid/v1', maxTokens: 6000, apiKey: 'isolated-test-key' })
  const actors: string[] = []
  let calls = 0
  await page.route('https://chat-ensemble.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    calls++
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const review = prompt.includes('本次持久化行动候选')
    let output: unknown
    if (review) output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程注入，不作为文学质量或真人评分'}))}
    else {
      const actor = prompt.match(/｜key=(guard|artisan|courier)｜/)?.[1]
      expect(actor).toBeTruthy(); actors.push(actor!)
      if (actor !== 'guard') expect(prompt).not.toContain('无辜旅人')
      expect(prompt).not.toContain('柜台下的木箱')
      const data = actor === 'guard' ? ['find-seal', '我把散开的账页压在镇纸下。', '账页已被镇纸压住。']
        : actor === 'artisan' ? ['fix-road', '我把门边的备用绳索收拢成束。', '备用绳索已收拢成束。']
        : ['care-courier', '我把门边的药箱抬到旁边木凳上。', '药箱已移到木凳上。']
      const text = `${data[1]}${data[2]}`
      output = {kind: 'complete', text, goalKey: data[0], evidenceFactKeys: [`prepared-${actor}`],
        audienceKeys: actors.length === 2 ? ['player', actor, 'unknown-role'] : ['player', 'guard', 'artisan', 'courier'], waitingForPlayer: false,
        newFacts: [{factKey: `consequence-${actor}`, kind: 'observation', text: data[2], evidenceFactKeys: [`prepared-${actor}`], evidenceExcerpt: data[2]}],
        disclosures: [], threadUpdates: [], goalStatus: null}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-ensemble-fixture.ts')).seedChatEnsembleFixture()
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await openChatNarrativeTools(page)
  await page.getByLabel('角色接续方式', {exact: true}).selectOption('round-robin')
  await page.getByLabel('演绎节奏', {exact: true}).selectOption('3')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByRole('alert').filter({hasText: /场外人物|听众/}).first()).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  expect(actors).toEqual(['guard', 'artisan']); expect(calls).toBe(3)
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(calls).toBe(3)
  await openChatNarrativeTools(page)
  await page.getByLabel('角色接续方式', {exact: true}).selectOption('round-robin')
  await page.getByLabel('演绎节奏', {exact: true}).selectOption('2')
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText('我把门边的药箱抬到旁边木凳上。药箱已移到木凳上。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  expect(actors).toEqual(['guard', 'artisan', 'artisan', 'courier']); expect(calls).toBe(7)
  const read = () => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const state = (await api.readProductRuntimeState(id)).interaction
    return {state, failed: (await db.agentRuns.toArray()).filter((run: {status: string}) => run.status === 'failed').length}
  }, f.sessionId)
  const before = await read()
  expect(before.state.messages.map((m: {speakerKey: string}) => m.speakerKey)).toEqual(['guard', 'artisan', 'courier'])
  expect(before.state.chatNarrative.situation.facts.filter((fact: {factKey: string}) => fact.factKey.startsWith('consequence-'))).toHaveLength(3)
  expect(before.failed).toBe(1)
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(before); expect(calls).toBe(7)
})
