import {expect, test, type Page} from '@playwright/test'
import {chatActionResponseFixture} from './helpers/character-chat-choice'

const firstReply = '我先暂缓寻找铜印。它还没找回，未查明的部分也不能算作谁的过错。'
const nextReply = '铜印还没找回。我恢复寻找，先问清能从哪份现存记录核对。'
const privateReason = '仅供审查的维持暂停依据，不应发布为角色台词'
const config = {provider: 'openai', baseUrl: 'https://maintained-pause.invalid/v1', model: 'turn-end-fixture', apiKey: 'isolated-test-key', maxTokens: 9000}
test.beforeEach(async ({page}) => {
  await page.addInitScript(config => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    const {apiKey, ...saved} = config
    localStorage.setItem('storyforge-ai-config', JSON.stringify(saved))
    sessionStorage.setItem('storyforge-ai-api-key-session', apiKey)
  }, config)
})

async function seed(page: Page, prepare = false) {
  await page.goto('./chat/library')
  return page.evaluate(async prepare => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-maintained-pause.ts')).seedChatMaintainedPauseRuntimeFixture(prepare ? 'continue' : null)
  }, prepare)
}
async function open(page: Page, f: Awaited<ReturnType<typeof seed>>) {
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
}
async function read(page: Page, f: Awaited<ReturnType<typeof seed>>) {
  return page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts'), ledger = await load('/storyforge/src/lib/agent/run/event-store.ts')
    const receipt = await load('/storyforge/src/lib/character-interaction/action-terminal-receipt.ts')
    const runs = (await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).toArray()).filter((r: {id: number}) => r.id !== f.actionRunId)
    const terminal = []
    for (const run of runs.filter((r: {status: string}) => r.status === 'completed')) terminal.push(await receipt.readChatActionTerminalReceiptV1(f.scope, await ledger.readInstanceAgentRunV1(f.scope, run.id)))
    return {state: await api.readProductRuntimeState(f.sessionId), runs, terminal}
  }, f)
}
async function provider(page: Page, handoff: unknown, passed = true) {
  const calls: string[] = []; let expressions = 0
  await page.route('https://maintained-pause.invalid/**', async route => {
    const messages = route.request().postDataJSON().messages, text = JSON.stringify(messages)
    const step = messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? 'choice'
      : text.includes('本次持久化交还控制候选') ? 'review-control'
        : text.includes('本次持久化行动候选') ? 'review-action' : 'result'
    calls.push(step)
    if (step === 'choice' || step === 'result') expect(text).not.toContain('掌柜把铜印留在柜台下')
    if (step === 'result') expressions++
    const output = step === 'choice' ? {directions: [], selectedId: null, decisionSummary: privateReason}
      : step === 'result' ? expressions === 1 ? {outcome: 'handoff', action: null, handoff} : {outcome: 'action', handoff: null, action: {
        kind: 'speak', text: nextReply, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: true,
        newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'active'}}
        : {checks: (step === 'review-control' ? ['current-pause', 'current-opportunity', 'pending-obligations', 'available-direction', 'player-agency', 'visibility']
          : ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'])
          .map(check => ({check, passed: check === 'pending-obligations' ? passed : true, reason: privateReason}))}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  return calls
}

// Injected transport responses establish state/UI behavior, never story quality.
for (const width of [390, 1440]) test(`maintains an adopted pause silently, refreshes and permits new action at ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 900})
  const f = await seed(page), calls = await provider(page, f.handoff)
  await open(page, f)
  const before = await read(page, f)
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect.poll(async () => (await read(page, f)).runs[0]?.status).toBe('completed')
  await expect(page.getByTestId('chat-turn-resume')).toHaveCount(0)
  const after = await read(page, f), story = after.state.interaction.chatNarrative
  expect(after.state.interaction.messages).toEqual(before.state.interaction.messages)
  expect(story.situation).toEqual(before.state.interaction.chatNarrative.situation)
  expect(story.triggers.slice(-1)[0]).toMatchObject({status: 'complete', actionSequences: [], controlHandoff: {version: 3}})
  expect(after.state.interaction.remainingDirectorBudget).toBe(before.state.interaction.remainingDirectorBudget - 3)
  expect(after.terminal).toHaveLength(1)
  expect(calls).toEqual(['choice', 'result', 'review-control'])
  await expect(page.getByText('角色暂时保持原来的安排。你可以继续交谈，或提出新的情境。', {exact: true})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText(firstReply, {exact: true})).toHaveCount(1)
  await expect(page.getByText(privateReason, {exact: false})).toHaveCount(0)
  await expect(page.getByText('草稿：暂缓寻找铜印', {exact: false})).toHaveCount(0)
  expect((await read(page, f)).state).toEqual(after.state)
  expect(calls).toEqual(['choice', 'result', 'review-control'])
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByText(nextReply, {exact: true})).toBeVisible()
  await expect.poll(async () => (await read(page, f)).runs[1]?.status).toBe('completed')
  const next = (await read(page, f)).state.interaction.chatNarrative
  expect(next.triggers.slice(-2)[0].status).toBe('complete')
  expect(next.triggers.slice(-1)[0]).toMatchObject({status: 'waiting-player', kind: 'continue'})
  expect(next.triggers.slice(-1)[0].actionSequences).toHaveLength(1)
  expect(next.situation.goals.find((g: {goalKey: string}) => g.goalKey === 'find-seal').status).toBe('active')
  expect(calls).toEqual(['choice', 'result', 'review-control', 'choice', 'result', 'review-action'])
})

test('a rejected maintenance preserves the pause and failure through reload without retry', async ({page}) => {
  const f = await seed(page), calls = await provider(page, f.handoff, false)
  await open(page, f)
  const before = await read(page, f)
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect.poll(async () => (await read(page, f)).runs[0]?.status).toBe('failed')
  const failed = (await read(page, f)).state
  expect(failed.interaction.messages).toEqual(before.state.interaction.messages)
  expect(failed.interaction.chatNarrative.situation).toEqual(before.state.interaction.chatNarrative.situation)
  await page.reload()
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText(firstReply, {exact: true})).toHaveCount(1)
  await expect(page.getByRole('button', {name: '补齐未完成本轮', exact: true})).toBeDisabled()
  expect((await read(page, f)).state).toEqual(failed)
  expect(calls).toEqual(['choice', 'result', 'review-control'])
})

test('refresh resumes a persisted maintenance using only the missing review', async ({page}) => {
  const f = await seed(page, true), calls = await provider(page, f.handoff)
  const runId = await page.evaluate(async ({f, config}) => {
    const load = new Function('p', 'return import(p)'), harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    let id: number | null = null
    try {
      await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
        objective: '承接本轮已经完成的行动', aiConfig: config, onRunCreated: (runId: number) => {id = runId},
        onActionExpressionBoundary: (name: string) => {if (name === 'candidate.persisted') throw Error('expected-turn-end-interruption')}})
    } catch (error) {if (!String(error).includes('expected-turn-end-interruption')) throw error}
    if (id == null) throw Error('missing turn-end run')
    return id
  }, {f, config})
  await open(page, f); await page.reload()
  await expect(page.getByRole('button', {name: `继续本次角色行动 #${runId}`, exact: true})).toBeEnabled()
  expect(calls).toEqual(['choice', 'result'])
  await page.getByRole('button', {name: `继续本次角色行动 #${runId}`, exact: true}).click()
  await expect.poll(async () => (await read(page, f)).runs[0]?.status).toBe('completed')
  expect((await read(page, f)).state.interaction.messages).toHaveLength(1)
  expect(calls).toEqual(['choice', 'result', 'review-control'])
  await expect(page.getByTestId('chat-turn-resume')).toHaveCount(0)
  await expect(page.getByText(privateReason, {exact: false})).toHaveCount(0)
})
