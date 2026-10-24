import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {openChatMessageTools} from './helpers/character-chat-ui'
import {test, expect} from '@playwright/test'

test('saving within the selected session keeps the reader scroll position', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()})
  await page.goto(`./chat/history?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByPlaceholder('检查点名称').fill('保留阅读位置')
  await page.locator('.lf-content').evaluate((node: HTMLElement) => {
    const scrollTo = node.scrollTo.bind(node)
    node.dataset.scrollResets = '0'
    node.scrollTo = (...args: [number, number] | [ScrollToOptions?]) => {
      node.dataset.scrollResets = String(Number(node.dataset.scrollResets) + 1)
      if (args.length === 2) scrollTo(args[0], args[1])
      else scrollTo(args[0])
    }
  })
  await page.getByRole('button', {name: '保存', exact: true}).click()
  await expect(page.getByRole('button', {name: /保留阅读位置 · #.* → 分支/})).toBeVisible()
  await expect(page.getByPlaceholder('检查点名称')).toHaveValue('')
  await expect(page.locator('.lf-content')).toHaveAttribute('data-scroll-resets', '0')
  await expect(page).toHaveURL(new RegExp(`session=${f.sessionId}$`))
})

test('editing a character message creates a recoverable draft branch and reconciles only the edited consequences', async ({page}) => {
  const original = '我把灯移到门边。门边亮了起来。', edited = '我先坐下听你说。'
  let actions = 0, reviews = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-edit.invalid/v1', model: 'test', maxTokens: 6000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://chat-edit.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n'), review = prompt.includes('本次持久化行动候选')
    let output: unknown
    if (review) {reviews++; output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是语义验收'}))}}
    else {
      actions++
      if (actions === 2) {expect(prompt).toContain(edited); expect(prompt).not.toContain(original); expect(prompt).not.toContain('lit-door')}
      output = {kind: actions === 1 ? 'complete' : 'pause', text: actions === 1 ? original : edited,
        goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: actions === 1 ? [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}] : [],
        disclosures: [], threadUpdates: [], goalStatus: actions === 1 ? null : 'paused', nextPossibilities: []}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()})
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByText(original, {exact: true})).toBeVisible()
  const parent = await read()
  await openChatMessageTools(page, `改写消息 ${parent.messages[0].eventSequence}`)
  await page.getByRole('button', {name: `改写消息 ${parent.messages[0].eventSequence}`, exact: true}).click()
  await page.getByLabel('改写历史消息', {exact: true}).fill(edited)
  await page.getByRole('button', {name: '建立改写分支', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toBeVisible()
  await expect(page.getByText(original, {exact: true})).toHaveCount(0)
  const branchId = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState().selectedSessionId})
  expect(branchId).not.toBe(f.sessionId)
  // No waiting for background refresh: a visible branch must already have a
  // reload-safe address, even while the final store cleanup is still busy.
  expect(new URL(page.url()).searchParams.get('session')).toBe(String(branchId))
  expect(await read()).toEqual(parent)
  await page.reload()
  await expect(page.getByLabel('待采用的改写', {exact: true})).toHaveValue(edited)
  expect(actions).toBe(1)
  await page.getByRole('button', {name: '审查并采用改写', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toHaveCount(0)
  await expect(page.getByText(edited, {exact: true})).toBeVisible()
  const child = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState().runtimeState.interaction})
  expect(child.messages.map((m: {text: string}) => m.text)).toEqual([edited])
  expect(child.chatNarrative.situation.facts.some((fact: {factKey: string}) => fact.factKey === 'lit-door')).toBe(false)
  expect(actions).toBe(2); expect(reviews).toBe(2)
  expect(await read()).toEqual(parent)
  await page.reload()
  await expect(page.getByText(edited, {exact: true})).toBeVisible()
  expect(actions).toBe(2)
})

test('a player edit preserves private recipients and can be saved without a model', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const v = await api.readProductRuntimeStateVersion(f.sessionId)
    const message = await api.commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'private', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'private', text: '只对守卫说的话。', audienceKeys: ['guard']})
    return {...f, sequence: message.sequence}
  })
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await openChatMessageTools(page, `改写消息 ${f.sequence}`)
  await page.getByRole('button', {name: `改写消息 ${f.sequence}`, exact: true}).click()
  await page.getByLabel('改写历史消息', {exact: true}).fill('我改为等一会儿。')
  await page.evaluate(async parentId => {
    const load = new Function('p', 'return import(p)')
    const store = (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore
    document.body.dataset.branchReloads = '0'
    let loading = store.getState().loading
    store.subscribe((state: {loading: boolean; selectedSessionId: number | null}) => {
      if (state.loading && !loading && state.selectedSessionId !== parentId) document.body.dataset.branchReloads = String(Number(document.body.dataset.branchReloads) + 1)
      loading = state.loading
    })
  }, f.sessionId)
  await page.getByRole('button', {name: '建立改写分支', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toBeVisible()
  await page.getByRole('button', {name: '保存改写消息', exact: true}).click()
  await expect(page.getByTestId('chat-pending-edit')).toHaveCount(0)
  await expect(page.getByText('我改为等一会儿。', {exact: true})).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-branch-reloads', '0')
  const result = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); const s = (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore.getState(); return {id: s.selectedSessionId, state: s.runtimeState.interaction}})
  expect(result.id).not.toBe(f.sessionId)
  expect(result.state.messages[0].audienceKeys).toEqual(['player', 'guard'])
  expect(result.state.messages).toHaveLength(1)
  // A real address/history change must still load the other session, even
  // though an echo of the already-selected branch no longer reloads it.
  await page.evaluate(parentId => {
    const url = new URL(location.href)
    url.searchParams.set('session', String(parentId))
    history.pushState(null, '', url)
    dispatchEvent(new PopStateEvent('popstate'))
  }, f.sessionId)
  await expect(page.getByText('只对守卫说的话。', {exact: true})).toBeVisible()
  await expect(page.getByText('我改为等一会儿。', {exact: true})).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`session=${result.id}$`))
  await expect(page.getByText('我改为等一会儿。', {exact: true})).toBeVisible()
  await page.reload()
  await expect(page.getByText('我改为等一会儿。', {exact: true})).toBeVisible()
})
