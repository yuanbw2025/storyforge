import {expect, test, type Page} from '@playwright/test'
import {chatActionResponseFixture} from './helpers/character-chat-choice'
import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'

const firstReply = '我退回柜台外，将已经核实的线索按时间排好。'
const nextReply = '整理的线索留着，我想先听听你更在意哪一条。'
const privateReason = '仅供审查的本轮结束依据，不应发布为角色台词'
const config = {provider: 'openai' as const, baseUrl: 'https://turn-end-control.invalid/v1', model: 'turn-end-fixture', apiKey: 'isolated-test-key', maxTokens: 9000}
test.beforeEach(async ({page}) => {
  registerBrowserFixtureAIConfigV1(page, config)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
})

async function seed(page: Page) {
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  return page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-turn-end-runtime.ts')).seedChatTurnEndRuntimeFixture()
  })
}
async function open(page: Page, f: Awaited<ReturnType<typeof seed>>) {
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
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
async function provider(page: Page, handoff: unknown, passed = true, unadoptedPause = false) {
  const calls: string[] = []; let expressions = 0
  await page.route('https://turn-end-control.invalid/**', async route => {
    const messages = route.request().postDataJSON().messages, text = JSON.stringify(messages)
    const step = messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? 'choice'
      : text.includes('本次持久化交还控制候选') ? 'review-control'
        : text.includes('本次持久化行动候选') ? 'review-action' : 'result'
    calls.push(step)
    if (step === 'choice' || step === 'result') expect(text).not.toContain('掌柜把铜印留在柜台下')
    if (step === 'review-control' && unadoptedPause) {expect(messages[0].content).toContain('当前待审对象只由 handoff 给出'); expect(text).toContain('草稿：暂缓寻找铜印')}
    if (step === 'result') expressions++
    const output = step === 'choice' ? unadoptedPause && expressions === 0 ? {directions: [{id: 'draft-pause', kind: 'pause', action: '草稿：暂缓寻找铜印', evidenceFactKeys: ['lost'], evidenceMessageIds: [], changes: '草稿：暂停寻找', playerDependency: null, unconfirmedConditions: []}], selectedId: 'draft-pause', decisionSummary: privateReason} : {directions: [], selectedId: null, decisionSummary: privateReason}
      : step === 'result' ? expressions === 1 ? {outcome: 'handoff', action: null, handoff} : {outcome: 'action', handoff: null, action: {
        kind: 'speak', text: nextReply, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: true,
        newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}}
        : {checks: (step === 'review-control' ? ['current-turn-progress', 'local-purpose', 'pending-obligations', 'player-agency', 'visibility']
          : ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'])
          .map(check => ({check, passed: check === 'pending-obligations' ? passed : true, reason: privateReason}))}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  return calls
}

// Injected transport responses establish state/UI behavior, never story quality.
for (const width of [390, 1440]) test(`ends the existing turn without a bubble or goal pause, refreshes and starts a new turn at ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 900})
  const f = await seed(page), calls = await provider(page, f.handoff, true, true)
  await open(page, f)
  const before = await read(page, f)
  await page.getByRole('button', {name: '补齐未完成本轮', exact: true}).click()
  await expect.poll(async () => (await read(page, f)).runs[0]?.status).toBe('completed')
  await expect(page.getByTestId('chat-turn-resume')).toHaveCount(0)
  const after = await read(page, f), story = after.state.interaction.chatNarrative
  expect(after.state.interaction.messages).toEqual(before.state.interaction.messages)
  expect(story.situation).toEqual(before.state.interaction.chatNarrative.situation)
  expect(story.triggers.slice(-1)[0]).toMatchObject({status: 'complete', actionSequences: [f.handoff.source.sequence], controlHandoff: {version: 2}})
  expect(after.state.interaction.remainingDirectorBudget).toBe(before.state.interaction.remainingDirectorBudget - 3)
  expect(after.terminal).toHaveLength(1)
  expect(calls).toEqual(['choice', 'result', 'review-control'])
  await reloadWithBrowserFixtureAIConfigV1(page)
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
  expect(next.situation.goals).toEqual(story.situation.goals)
  expect(calls).toEqual(['choice', 'result', 'review-control', 'choice', 'result', 'review-action'])
})

test('a rejected ending keeps the original action and active goal through reload without retry', async ({page}) => {
  const f = await seed(page), calls = await provider(page, f.handoff, false)
  await open(page, f)
  const before = await read(page, f)
  await page.getByRole('button', {name: '补齐未完成本轮', exact: true}).click()
  await expect.poll(async () => (await read(page, f)).runs[0]?.status).toBe('failed')
  expect((await read(page, f)).state).toEqual(before.state)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText(firstReply, {exact: true})).toHaveCount(1)
  await expect(page.getByRole('button', {name: '补齐未完成本轮', exact: true})).toBeDisabled()
  expect((await read(page, f)).state).toEqual(before.state)
  expect(calls).toEqual(['choice', 'result', 'review-control'])
})

test('refresh resumes a persisted ending using only the missing review', async ({page}) => {
  const f = await seed(page), calls = await provider(page, f.handoff)
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
  await open(page, f); await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByRole('button', {name: `继续本次角色行动 #${runId}`, exact: true})).toBeEnabled()
  expect(calls).toEqual(['choice', 'result'])
  await page.getByRole('button', {name: `继续本次角色行动 #${runId}`, exact: true}).click()
  await expect.poll(async () => (await read(page, f)).runs[0]?.status).toBe('completed')
  expect((await read(page, f)).state.interaction.messages).toHaveLength(1)
  expect(calls).toEqual(['choice', 'result', 'review-control'])
  await expect(page.getByTestId('chat-turn-resume')).toHaveCount(0)
  await expect(page.getByText(privateReason, {exact: false})).toHaveCount(0)
})
