import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture} from './helpers/character-chat-choice'
import {expect, test, type Page} from '@playwright/test'

// Exercise the actual application default with injected engineering responses.
// This does not establish real-model semantic quality.
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://control-handoff.invalid/v1', model: 'control-fixture', maxTokens: 9000, apiKey: 'isolated-test-key' })

})

const permission = '查看你的包裹需要你明确同意，暂时不用回答。'
const privateReason = '交还控制内部依据标记，不应成为角色气泡'
const choice = {directions: [{id: 'wait', action: '等待玩家决定是否允许查看包裹', evidenceFactKeys: ['lost'], evidenceMessageIds: [], changes: '保留玩家许可', playerDependency: '是否同意',
  unconfirmedConditions: ['尚未回答'], kind: 'wait'}], selectedId: 'wait', decisionSummary: privateReason}

async function seed(page: Page) {
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  return page.evaluate(async text => {
    const load = new Function('p', 'return import(p)')
    const fixture = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const skills = await load('/storyforge/src/lib/agent/skill-registry.ts')
    if (skills.getAgentSkillV1('character.chat-narrative-action').promptVersion !== 'chat-narrative-action-v72'
      || skills.getAgentSkillV1('character.chat-narrative-action-review').promptVersion !== 'chat-narrative-action-review-v42') throw Error('unexpected default control contract')
    const f = await fixture.seedChatNarrativeRuntimeFixture({directorBudget: 30})
    const version = await api.readProductRuntimeStateVersion(f.sessionId)
    const trigger = await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'opening', baseSequence: version.sequence, baseStateHash: version.stateHash,
      kind: 'scene-start', sourceEventSequence: f.sceneSequence})
    const base = await api.readProductRuntimeStateVersion(f.sessionId)
    const action = {kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: true,
      newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
    const event = await api.commitChatNarrativeAction({sessionId: f.sessionId, commandId: 'permission', baseSequence: base.sequence, baseStateHash: base.stateHash,
      actorKey: 'guard', triggerSequence: trigger.sequence, messageId: 'permission', action, review: fixture.chatActionReviewFixture(action)})
    return {...f, handoff: {version: 1, kind: 'yield-to-player', reason: 'awaiting-player-decision', source: {messageId: 'permission', sequence: event.sequence,
      excerpt: '查看你的包裹需要你明确同意'}, decision: '玩家是否允许查看包裹', dependentStep: '打开包裹查看'}}
  }, permission)
}

async function provider(page: Page, handoff: {version: number; source: {messageId: string; sequence: number}}) {
  const calls: string[] = []
  await page.route('https://control-handoff.invalid/**', async route => {
    const request = route.request().postDataJSON(), text = JSON.stringify(request.messages)
    const step = request.messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? 'choice'
      : text.includes('本次持久化交还控制候选') ? 'review' : 'result'
    calls.push(step)
    if (step !== 'review') expect(text).not.toContain('掌柜把铜印留在柜台下')
    if (step !== 'review') {
      const rows = request.messages[1].content.split('\n').filter((line: string) => line.startsWith('- {"messageId":')).map((line: string) => JSON.parse(line.slice(2)))
      const delivered = rows.find((row: {messageId: string}) => row.messageId === handoff.source.messageId)
      expect(delivered).toMatchObject({messageId: handoff.source.messageId, sequence: handoff.source.sequence, speakerKey: 'guard', text: permission})
    }
    if (step === 'result') expect(request.messages[2].content).toContain('outcome/action/handoff')
    if (step === 'review' && handoff.version === 4) {
      expect(request.messages[0].content).toContain('latest-player-response')
      expect(text).toContain('嗯，我在听。')
    }
    const output = step === 'choice' ? choice : step === 'result' ? {outcome: 'handoff', action: null, handoff}
      : {checks: ['current-decision', 'actual-dependency', 'available-direction', 'player-agency', 'visibility',
        ...(handoff.version === 4 ? ['latest-player-response'] : [])].map(check => ({check, passed: true, reason: privateReason}))}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  return calls
}

async function open(page: Page, f: Awaited<ReturnType<typeof seed>>) {
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
}
async function read(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts'), ledger = await load('/storyforge/src/lib/agent/run/event-store.ts')
    const receipts = await load('/storyforge/src/lib/character-interaction/action-terminal-receipt.ts'), session = await db.productRuntimeSessions.get(id)
    const runs = await db.agentRuns.where('productRuntimeSessionId').equals(id).toArray(), terminal = []
    const scope = {projectId: session.projectId, worldId: session.worldId, workId: session.workId}
    for (const run of runs.filter((row: {status: string}) => row.status === 'completed')) terminal.push(await receipts.readChatActionTerminalReceiptV1(scope, await ledger.readInstanceAgentRunV1(scope, run.id)))
    return {state: await api.readProductRuntimeState(id), runs, terminal}
  }, sessionId)
}

for (const width of [390, 1440]) test(`reviewed handoff adds no bubble and survives native refresh at ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 900})
  const f = await seed(page), calls = await provider(page, f.handoff)
  await open(page, f)
  const before = await read(page, f.sessionId)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect.poll(async () => (await read(page, f.sessionId)).runs[0]?.status).toBe('completed')
  const after = await read(page, f.sessionId)
  expect(after.state.interaction.messages).toEqual(before.state.interaction.messages)
  expect(after.state.interaction.chatNarrative.situation).toEqual(before.state.interaction.chatNarrative.situation)
  expect(after.state.interaction.chatNarrative.triggers.slice(-1)[0]).toMatchObject({status: 'waiting-player', actionSequences: [], controlHandoff: {sourceMessageId: 'permission'}})
  expect(after.state.interaction.remainingDirectorBudget).toBe(before.state.interaction.remainingDirectorBudget - 3)
  expect(after.terminal).toHaveLength(1)
  expect(calls).toEqual(['choice', 'result', 'review'])
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByTestId('chat-narrative-controls')).toContainText('角色正在等你的回应')
  expect((await read(page, f.sessionId)).state).toEqual(after.state)
  expect(calls).toEqual(['choice', 'result', 'review'])
  await expect(page.getByText(permission, {exact: true})).toHaveCount(1)
  await expect(page.getByText(privateReason, {exact: false})).toHaveCount(0)
})

test('sending a non-decision acknowledgement retains the player message without a repeated question after refresh', async ({page}) => {
  await page.setViewportSize({width: 390, height: 900})
  const f = await seed(page), calls = await provider(page, {...f.handoff, version: 4})
  await open(page, f)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  const before = await read(page, f.sessionId)
  await page.getByLabel('发送给角色的消息', {exact: true}).fill('嗯，我在听。')
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect.poll(async () => (await read(page, f.sessionId)).runs[0]?.status).toBe('completed')
  const after = await read(page, f.sessionId)
  expect(after.state.interaction.messages).toHaveLength(before.state.interaction.messages.length + 1)
  expect(after.state.interaction.messages.slice(-1)[0]).toMatchObject({role: 'player', text: '嗯，我在听。'})
  expect(after.state.interaction.chatNarrative.situation).toEqual(before.state.interaction.chatNarrative.situation)
  expect(after.state.interaction.chatNarrative.triggers.slice(-1)[0]).toMatchObject({kind: 'player-response', status: 'waiting-player',
    actionSequences: [], controlHandoff: {version: 4, sourceMessageId: 'permission'}})
  expect(after.terminal).toHaveLength(1)
  expect(calls).toEqual(['choice', 'result', 'review'])
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByTestId('chat-narrative-controls')).toContainText('角色正在等你的回应')
  await expect(page.getByText(permission, {exact: true})).toHaveCount(1)
  await expect(page.getByText('嗯，我在听。', {exact: true})).toHaveCount(1)
  await expect(page.getByText(privateReason, {exact: false})).toHaveCount(0)
  expect((await read(page, f.sessionId)).state).toEqual(after.state)
  expect(calls).toEqual(['choice', 'result', 'review'])
})

test('refresh resumes a saved control result through review without repeating selection or expression', async ({page}) => {
  const f = await seed(page), calls = await provider(page, f.handoff)
  const runId = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts'), base = await api.readProductRuntimeStateVersion(f.sessionId)
    await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'continue', baseSequence: base.sequence, baseStateHash: base.stateHash,
      kind: 'continue', sourceEventSequence: base.sequence, direction: {actorKey: 'guard', actionLimit: 1}})
    let runId: number | null = null
    try {
      await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
        objective: '核验静默交还控制恢复', aiConfig: {provider: 'openai', baseUrl: 'https://control-handoff.invalid/v1', model: 'control-fixture', apiKey: 'isolated-test-key', maxTokens: 9000},
        onRunCreated: (id: number) => {runId = id}, onActionExpressionBoundary: (name: string) => {if (name === 'candidate.persisted') throw Error('expected-control-interruption')}})
    } catch (error) {if (!String(error).includes('expected-control-interruption')) throw error}
    if (runId == null) throw Error('missing run')
    return runId
  }, f)
  await open(page, f)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByRole('button', {name: `继续本次角色行动 #${runId}`, exact: true})).toBeEnabled()
  expect(calls).toEqual(['choice', 'result'])
  await page.getByRole('button', {name: `继续本次角色行动 #${runId}`, exact: true}).click()
  await expect.poll(async () => (await read(page, f.sessionId)).runs[0].status).toBe('completed')
  expect(calls).toEqual(['choice', 'result', 'review'])
  expect((await read(page, f.sessionId)).state.interaction.messages).toHaveLength(1)
  await expect(page.getByTestId('chat-action-resume')).toHaveCount(0)
  await expect(page.getByText(privateReason, {exact: false})).toHaveCount(0)
})
