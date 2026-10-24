import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {openChatMessageTools} from './helpers/character-chat-ui'
import {test, expect} from '@playwright/test'

test('exclusion previews retained consequences, survives refresh and affects the next real request; restore is reversible', async ({page}) => {
  const original = '检索标记甲：我把灯移到门边。门边亮了起来。'
  let actions = 0, reviews = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-retrieval.invalid/v1', model: 'test', maxTokens: 6000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://chat-retrieval.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    let output: unknown
    if (prompt.includes('本次持久化行动候选')) {
      reviews++
      if (reviews === 2) {expect(prompt).not.toContain('检索标记甲'); expect(prompt).toContain('lit-door')}
      output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是语义验收'}))}
    } else {
      actions++
      if (actions === 2) {expect(prompt).not.toContain('检索标记甲'); expect(prompt).toContain('用户排除对话=1'); expect(prompt).toContain('lit-door')}
      if (actions === 3) expect(prompt).toContain(original)
      output = {kind: actions === 1 ? 'complete' : 'speak', text: actions === 1 ? original : actions === 2 ? '灯还亮着，我先看看桌下。' : '我接着看看窗边。',
        goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: actions === 1 ? [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}] : [],
        disclosures: [], threadUpdates: [], goalStatus: null}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()})
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByText(original, {exact: true})).toBeVisible()
  const read = () => page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState().runtimeState.interaction})
  const before = await read(), sequence = before.messages[0].eventSequence
  await openChatMessageTools(page, `上下文设置 ${sequence}`)
  await page.getByRole('button', {name: `上下文设置 ${sequence}`, exact: true}).click()
  const preview = page.getByTestId('chat-message-retrieval-preview')
  await expect(preview).toContainText('事实 1')
  await expect(preview).toContainText('已经确认的事实、记忆、约定和关系仍可作为背景')
  await expect(preview).toContainText('排除原话不会撤销承诺或履约记录')
  await expect(preview).not.toContainText('柜台下')
  await page.getByRole('button', {name: '仅排除对话上下文', exact: true}).click()
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId('chat-message-excluded')).toBeVisible()
  expect((await read()).chatNarrative.situation).toEqual(before.chatNarrative.situation)
  expect((await read()).remainingDirectorBudget).toBe(before.remainingDirectorBudget)
  expect(actions).toBe(1); expect(reviews).toBe(1)
  await page.reload()
  await expect(page.getByTestId('chat-message-excluded')).toBeVisible()
  await expect(page.getByText(original, {exact: true})).toBeVisible()
  expect(actions).toBe(1)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByText('灯还亮着，我先看看桌下。', {exact: true})).toBeVisible()
  await openChatMessageTools(page, `上下文设置 ${sequence}`)
  await page.getByRole('button', {name: `上下文设置 ${sequence}`, exact: true}).click()
  await page.getByRole('button', {name: '确认恢复上下文', exact: true}).click()
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId('chat-message-excluded')).toHaveCount(0)
  expect(actions).toBe(2); expect(reviews).toBe(2)
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByText('我接着看看窗边。', {exact: true})).toBeVisible()
  expect((await read()).chatNarrative.situation.facts.filter((fact: {factKey: string}) => fact.factKey === 'lit-door')).toHaveLength(1)
  expect(actions).toBe(3); expect(reviews).toBe(3)
})

test('canceling a preview changes nothing, and correcting history goes through a separate edit branch', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), v = await api.readProductRuntimeStateVersion(f.sessionId)
    const event = await api.commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'private', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'private', text: '只对守卫说的话。', audienceKeys: ['guard']})
    return {...f, sequence: event.sequence}
  })
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await openChatMessageTools(page, `上下文设置 ${f.sequence}`)
  await page.getByRole('button', {name: `上下文设置 ${f.sequence}`, exact: true}).click()
  await page.getByTestId('chat-message-retrieval-preview').getByRole('button', {name: '取消', exact: true}).click()
  await expect(page.getByTestId('chat-message-excluded')).toHaveCount(0)
  await openChatMessageTools(page, `上下文设置 ${f.sequence}`)
  await page.getByRole('button', {name: `上下文设置 ${f.sequence}`, exact: true}).click()
  await page.getByRole('button', {name: '改为改写并分支', exact: true}).click()
  await expect(page.getByTestId('chat-message-retrieval-preview')).toHaveCount(0)
  await page.getByLabel('改写历史消息', {exact: true}).fill('我在这里等。')
  await page.getByRole('button', {name: '建立改写分支', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toBeVisible()
  const original = await page.evaluate(async sessionId => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(sessionId)).interaction}, f.sessionId)
  expect(original.messages[0].text).toBe('只对守卫说的话。')
  expect(original.chatNarrative.excludedMessageIds).toBeUndefined()
  const after = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState().selectedSessionId})
  expect(after).not.toBe(f.sessionId)
})
