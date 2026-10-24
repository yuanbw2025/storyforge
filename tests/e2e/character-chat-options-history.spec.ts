import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {openChatNarrativeTools, openChatMessageTools} from './helpers/character-chat-ui'
import {test, expect} from '@playwright/test'

test('switches an older reviewed alternative in a refreshed branch, preserves its audience and retains the original history', async ({page}) => {
  const original = '我把灯移到门边，门边亮了起来。', alternate = '我轻轻关上窗，窗户关上了。', future = '后来窗户被我推开了。'
  const calls: string[] = []
  const checks = () => ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，柜台下的信息不进入玩家预览'}))
  const action = (kind: 'original' | 'alternate' | 'future') => ({kind: 'complete', text: kind === 'original' ? original : kind === 'alternate' ? alternate : future,
    goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: kind === 'alternate' ? ['guard', 'player', 'artisan'] : ['guard', 'player'], waitingForPlayer: false,
    newFacts: [{factKey: kind === 'original' ? 'light' : kind === 'alternate' ? 'closed' : 'opened', kind: 'observation', text: kind === 'original' ? '门边亮了起来。' : kind === 'alternate' ? '窗户关上了。' : future,
      evidenceFactKeys: ['lost'], evidenceExcerpt: kind === 'original' ? '门边亮了起来。' : kind === 'alternate' ? '窗户关上了。' : future}], disclosures: [], threadUpdates: [], goalStatus: null})
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-history-options.invalid/v1', model: 'test', maxTokens: 8000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://chat-history-options.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    let output: unknown
    if (prompt.includes('本次持久化行动候选组')) {calls.push('options-review'); output = {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, checks: checks()}))}}
    else if (prompt.includes('本次持久化行动候选')) {calls.push('action-review'); output = {checks: checks()}}
    else if (prompt.includes('互斥行动候选')) {calls.push('options'); output = {options: [action('original'), action('alternate')]}}
    else {
      const selected = prompt.includes('"mode":"option"')
      calls.push(selected ? 'alternate' : 'future')
      if (selected) {expect(prompt).toContain(alternate); expect(prompt).not.toContain(future)}
      expect(prompt).not.toContain('柜台下')
      output = action(selected ? 'alternate' : 'future')
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()})
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await openChatNarrativeTools(page)
  await page.getByRole('button', {name: '比较两种行动', exact: true}).click()
  await page.getByRole('button', {name: '采用行动 1', exact: true}).click()
  await expect(page.getByText(original, {exact: true})).toBeVisible()
  await page.getByPlaceholder('对当前场景中的角色说话…').fill('后来，我想换个办法。')
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect(page.getByRole('paragraph').filter({hasText: future})).toBeVisible()
  const readParent = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  const parent = await readParent()
  await openChatMessageTools(page, `历史候选 ${parent.messages[0].eventSequence}`)
  const historyButton = page.getByRole('button', {name: `历史候选 ${parent.messages[0].eventSequence}`, exact: true})
  await expect(page.getByRole('button', {name: /^历史候选 /})).toHaveCount(1)
  await historyButton.click()
  const preview = page.getByTestId('chat-historical-options')
  await expect(preview).toContainText('之后的 2 条消息')
  await expect(preview).toContainText('听众：叶岑、你、程素')
  await expect(page.getByText(/柜台下/)).toHaveCount(0)
  await page.getByRole('button', {name: '取消查看历史候选', exact: true}).click()
  await expect(preview).toHaveCount(0)
  expect(calls).toHaveLength(4)
  expect(await readParent()).toEqual(parent)
  await historyButton.click()
  await page.getByRole('button', {name: '选择候选 2 并分支', exact: true}).click()
  await expect(page.getByLabel('已选历史候选', {exact: true})).toHaveValue(alternate)
  const branchId = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState().selectedSessionId})
  expect(branchId).not.toBe(f.sessionId)
  expect(new URL(page.url()).searchParams.get('session')).toBe(String(branchId))
  await expect(page.getByLabel('已选历史候选', {exact: true})).toHaveJSProperty('readOnly', true)
  await expect(page.getByText(future, {exact: true})).toHaveCount(0)
  expect(calls).toHaveLength(4)
  await page.reload()
  await expect(page.getByLabel('已选历史候选', {exact: true})).toHaveValue(alternate)
  expect(calls).toHaveLength(4)
  await page.getByRole('button', {name: '审查并采用所选候选', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toHaveCount(0)
  await expect(page.getByText(alternate, {exact: true})).toBeVisible()
  const child = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); const s = (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState(); return {id: s.selectedSessionId, state: s.runtimeState.interaction}})
  expect(child.id).not.toBe(f.sessionId)
  expect(child.state.messages.map((m: {text: string}) => m.text)).toEqual([alternate])
  expect(child.state.messages[0].audienceKeys).toEqual(['guard', 'player', 'artisan'])
  expect(child.state.chatNarrative.situation.facts.filter((fact: {factKey: string}) => ['light', 'closed', 'opened'].includes(fact.factKey)).map((fact: {factKey: string}) => fact.factKey)).toEqual(['closed'])
  expect(await readParent()).toEqual(parent)
  expect(calls).toEqual(['options', 'options-review', 'future', 'action-review', 'alternate', 'action-review'])
  await page.reload()
  await expect(page.getByText(alternate, {exact: true})).toBeVisible()
  await openChatMessageTools(page, `历史候选 ${child.state.messages[0].eventSequence}`)
  await page.getByRole('button', {name: `历史候选 ${child.state.messages[0].eventSequence}`, exact: true}).click()
  await expect(preview).toContainText('候选 2 · 原时间线已采用')
  await expect(preview.getByRole('button', {name: '选择候选 1 并分支', exact: true})).toBeEnabled()
  await page.getByRole('button', {name: '取消查看历史候选', exact: true}).click()
  expect(calls).toHaveLength(6)
})
