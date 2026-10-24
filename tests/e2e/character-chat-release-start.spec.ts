import {test, expect} from '@playwright/test'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'

for (const width of [390, 1440]) for (const limit of [1, 2]) test(`release details keep secrets private and start the selected actor at ${width}px (limit ${limit})`, async ({page}) => {
  await page.setViewportSize({width, height: 844})
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', model: 'test', baseUrl: 'https://chat-entry.invalid/v1', apiKey: ''}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  const calls: string[] = []
  await page.route('https://chat-entry.invalid/**', async route => {
    if (await fulfillChatActionChoiceFixture(route)) {calls.push('choice'); return}
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const review = prompt.includes('本次持久化行动候选')
    calls.push(review ? 'review' : 'action')
    const output = review ? {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是质量验收'}))}
      : {kind: 'speak', text: calls.filter(call => call === 'action').length === 1 ? '天黑后不宜搬动倒树，我先考虑白天可行的办法。' : '天黑后先留在驿站，等天亮再检查山路。', goalKey: 'fix-road', evidenceFactKeys: ['road'], audienceKeys: ['artisan', 'player'], waitingForPlayer: false,
        newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async maxActionsPerTrigger => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-library-fixture.ts')).seedChatLibraryFixture({maxActionsPerTrigger})
  }, limit)
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByRole('button', {name: '作品与存档', exact: false}).click()
  const card = page.getByRole('article', {name: '驿站工程核验 · 版本 1', exact: true})
  await expect(card.getByText('你将扮演 沈禾', {exact: false})).toBeVisible()
  await card.getByText('你已知道的开场背景', {exact: true}).click()
  await expect(card.getByText('铜印失踪。', {exact: true})).toBeVisible()
  const secretTexts = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const manifest = JSON.parse((await db.productReleases.get(id)).manifestJson)
    return manifest.runtimePackage.interaction.chatNarrative.initialSituation.facts.filter((f: {audienceKeys: string[]}) => !f.audienceKeys.includes('player')).map((f: {text: string}) => f.text)
  }, f.releaseId)
  for (const text of secretTexts) await expect(card).not.toContainText(text)
  expect(calls).toHaveLength(0)
  await card.getByLabel('开场行动角色').selectOption('artisan')
  await expect(card.getByText(`新建后角色最多连续行动 ${limit} 步`, {exact: false})).toBeVisible()
  expect(calls).toHaveLength(0)
  await card.getByRole('button', {name: '新建会话', exact: true}).click()
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText('天黑后不宜搬动倒树，我先考虑白天可行的办法。', {exact: true})).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState().busy
  })).toBe(false)
  expect(calls).toEqual(Array.from({length: limit}, () => ['choice', 'action', 'review']).flat())
  const state = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const state = (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState()
    return {sessionId: state.selectedSessionId, interaction: state.runtimeState.interaction}
  })
  expect(state.sessionId).not.toBe(f.sessionId)
  expect(state.interaction.messages.map((m: {speakerKey: string}) => m.speakerKey)).toEqual(Array.from({length: limit}, () => 'artisan'))
  expect(state.interaction.chatNarrative.triggers[0].direction.actorKey).toBe('artisan')
  expect(state.interaction.chatNarrative.triggers[0].direction.actionLimit).toBe(limit)
  await page.reload()
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText('天黑后不宜搬动倒树，我先考虑白天可行的办法。', {exact: true})).toBeVisible()
  await expect(page.getByLabel('演绎节奏', {exact: true})).toHaveValue(String(limit))
  expect(calls).toHaveLength(3 * limit)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})
