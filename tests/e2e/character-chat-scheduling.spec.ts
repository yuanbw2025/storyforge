import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {openChatNarrativeTools} from './helpers/character-chat-ui'
import {test, expect, type Page} from '@playwright/test'

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-scheduling.invalid/v1', model: 'test', maxTokens: 8000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
})

async function seed(page: Page, partial = false) {
  await page.goto('./chat/library')
  const f = await page.evaluate(async partial => {
    const load = new Function('p', 'return import(p)')
    const fixture = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')
    const f = await fixture.seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
    if (partial) {
      const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
      const v = await api.readProductRuntimeStateVersion(f.sessionId)
      await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash,
        kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 2, scheduling: {mode: 'round-robin', participantKeys: ['guard', 'artisan']}}})
      const harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
      const first = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '已完成第一位角色的工程夹具',
        runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async () => JSON.stringify({kind: 'speak', text: '我已核对铜印的保管记录。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'artisan', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})),
        runReviewAI: async () => JSON.stringify(fixture.chatActionReviewOutputFixture())})
      await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: first.snapshot.run.id})
    }
    return f
  }, partial)
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await expect(page.getByLabel('角色接续方式', {exact: true})).toHaveValue('manual')
  return f
}

async function provider(page: Page, waiting = false) {
  const receipt = {actors: [] as string[], calls: 0}
  await page.route('https://chat-scheduling.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    receipt.calls++
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    let output: unknown
    if (prompt.includes('本次持久化行动候选')) output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具'}))}
    else {
      const key = prompt.match(/｜key=(guard|artisan)｜/)?.[1]
      expect(key).toBeTruthy()
      receipt.actors.push(key!)
      expect(prompt).not.toContain('柜台下')
      expect(prompt).not.toContain(key === 'guard' ? '天黑后不宜' : '无辜旅人')
      if (receipt.actors.length > 1) expect(prompt).toContain(`第 ${receipt.actors.length - 1} 步`)
      output = {kind: waiting ? 'attempt' : 'speak', text: waiting ? '接下来需要你决定，我先等你。' : `${key === 'guard' ? '叶岑核对铜印' : '程素检查山路'}，第 ${receipt.actors.length} 步。`,
        goalKey: key === 'guard' ? 'find-seal' : 'fix-road', evidenceFactKeys: [key === 'guard' ? 'lost' : 'road'], audienceKeys: ['guard', 'artisan', 'player'], waitingForPlayer: waiting, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  return receipt
}

async function read(page: Page, sessionId: number) {
  return page.evaluate(async id => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id)).interaction}, sessionId)
}

test('bounded round-robin passes visible consequences between roles; natural replies choose the addressed role', async ({page}) => {
  const receipt = await provider(page), f = await seed(page)
  await expect(page.getByLabel('演绎节奏', {exact: true})).toHaveValue('2')
  await expect(page.getByRole('button', {name: '让角色开场', exact: true})).toBeDisabled()
  await openChatNarrativeTools(page)
  await page.getByLabel('角色接续方式', {exact: true}).selectOption('round-robin')
  await expect(page.getByLabel('本轮行动角色', {exact: true})).toHaveCount(0)
  await openChatNarrativeTools(page)
  await page.getByLabel('演绎节奏', {exact: true}).selectOption('3')
  expect(receipt.calls).toBe(0)
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByText('叶岑核对铜印，第 3 步。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  expect(receipt.actors).toEqual(['guard', 'artisan', 'guard'])
  expect(receipt.calls).toBe(6)
  expect((await read(page, f.sessionId)).chatNarrative.triggers[0]).toMatchObject({status: 'complete', direction: {actionLimit: 3, scheduling: {mode: 'round-robin', participantKeys: ['guard', 'artisan']}}})
  await page.reload()
  await expect(page.getByLabel('角色接续方式', {exact: true})).toHaveValue('manual')
  await expect(page.getByLabel('演绎节奏', {exact: true})).toHaveValue('3')
  expect(receipt.calls).toBe(6)
  await openChatNarrativeTools(page)
  await page.getByLabel('角色接续方式', {exact: true}).selectOption('natural')
  await page.getByLabel('演绎节奏', {exact: true}).selectOption('1')
  await page.getByPlaceholder('对当前场景中的角色说话…').fill('程素，山路何时恢复通行？')
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect(page.getByText('程素检查山路，第 4 步。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  expect(receipt.actors).toEqual(['guard', 'artisan', 'guard', 'artisan'])
  expect(receipt.calls).toBe(8)
  expect((await read(page, f.sessionId)).chatNarrative.triggers[1]).toMatchObject({kind: 'player-response', status: 'complete', direction: {actorKey: 'artisan', actionLimit: 1, scheduling: {mode: 'natural'}}})
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await expect(page.getByText(/柜台下|无辜旅人|天黑后不宜/)).toHaveCount(0)
})

test('refresh and changed new-turn controls preserve the scheduled next actor and remaining allowance', async ({page}) => {
  const receipt = await provider(page), f = await seed(page, true)
  await expect(page.getByTestId('chat-turn-resume')).toContainText('最多 1 次行动额度')
  await expect(page.getByTestId('chat-turn-resume')).toContainText('下一位是 程素')
  await page.reload()
  await expect(page.getByLabel('角色接续方式', {exact: true})).toHaveValue('manual')
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await openChatNarrativeTools(page)
  await page.getByLabel('演绎节奏', {exact: true}).selectOption('3')
  expect(receipt.calls).toBe(0)
  await page.getByRole('button', {name: '补齐未完成本轮', exact: true}).click()
  await expect(page.getByText('程素检查山路，第 1 步。', {exact: true})).toBeVisible()
  await expect(page.getByTestId('chat-turn-resume')).toHaveCount(0)
  const state = await read(page, f.sessionId)
  expect(state.messages.map((m: {speakerKey: string}) => m.speakerKey)).toEqual(['guard', 'artisan'])
  expect(state.chatNarrative.triggers).toHaveLength(1)
  expect(state.chatNarrative.triggers[0].actionSequences).toHaveLength(2)
  expect(receipt.actors).toEqual(['artisan']); expect(receipt.calls).toBe(2)
})

test('waiting for the player stops the entire group without generating the next role', async ({page}) => {
  const receipt = await provider(page, true), f = await seed(page)
  await openChatNarrativeTools(page)
  await page.getByLabel('角色接续方式', {exact: true}).selectOption('round-robin')
  await openChatNarrativeTools(page)
  await page.getByLabel('演绎节奏', {exact: true}).selectOption('3')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByText('接下来需要你决定，我先等你。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  expect((await read(page, f.sessionId)).chatNarrative.triggers[0].status).toBe('waiting-player')
  expect(receipt.actors).toEqual(['guard']); expect(receipt.calls).toBe(2)
  await page.reload()
  await expect(page.getByTestId('chat-turn-resume')).toHaveCount(0)
  expect(receipt.calls).toBe(2)
})

test('a player can interrupt resumed automatic scheduling without selecting a new manual actor', async ({page}) => {
  let calls = 0, release!: () => void
  const gate = new Promise<void>(resolve => {release = resolve})
  await page.route('https://chat-scheduling.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    calls++
    await gate
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, {kind: 'speak', text: '这条已打断的回复不能进入故事。', goalKey: 'fix-road', evidenceFactKeys: ['road'], audienceKeys: ['guard', 'artisan', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})}, finish_reason: 'stop'}]})})
  })
  const f = await seed(page, true)
  await expect(page.getByLabel('本轮行动角色', {exact: true})).toHaveValue('')
  await page.getByRole('button', {name: '补齐未完成本轮', exact: true}).click()
  await expect.poll(() => calls).toBe(1)
  await page.getByPlaceholder('对当前场景中的角色说话…').fill('先停一下，我要补充一件事。')
  await page.getByRole('button', {name: '打断并发送', exact: true}).click()
  release()
  await expect(page.getByText('先停一下，我要补充一件事。', {exact: true})).toBeVisible()
  await expect(page.getByLabel('角色接续方式', {exact: true})).toBeEnabled()
  const state = await read(page, f.sessionId)
  expect(state.messages.map((m: {role: string}) => m.role)).toEqual(['character', 'player'])
  expect(state.chatNarrative.triggers[0].status).toBe('cancelled')
  expect(calls).toBe(1)
  await page.reload()
  await expect(page.getByText('先停一下，我要补充一件事。', {exact: true})).toBeVisible()
  await expect(page.getByText('这条已打断的回复不能进入故事。', {exact: true})).toHaveCount(0)
  expect(await read(page, f.sessionId)).toEqual(state)
  expect(calls).toBe(1)
})
