import {chatActionResponseFixture} from './helpers/character-chat-choice'
import {expect, test, type Page} from '@playwright/test'
import Ajv from 'ajv'
import { registerBrowserFixtureAIConfigV1, unregisterBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'

// Exercise the actual application default in isolated browser data.
test.beforeEach(async ({page}) => {
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-choice.invalid/v1', model: 'choice-fixture', maxTokens: 9000, apiKey: 'isolated-test-key' }, { ifAbsent: true })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
})

const privateDraft = '选择草稿专用标记：先询问已有线索，不预定玩家回答。'
const reply = '你愿意说说铜印最后出现的地方吗？'
const choice = {directions: [{id: 'ask', action: privateDraft, evidenceFactKeys: ['lost'], evidenceMessageIds: [], changes: '澄清尚未得知的线索，不预定答案',
  playerDependency: '玩家是否愿意回答', unconfirmedConditions: [], kind: 'question'}], selectedId: 'ask', decisionSummary: '先询问当前目标缺少的线索。'}
const action = {kind: 'speak', text: reply, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player', 'artisan'],
  waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
type Phase = 'fresh' | 'choice-raw' | 'choice-saved' | 'expression-raw' | 'candidate-saved' | 'choice-unknown' | 'expression-unknown'

async function provider(page: Page, malformedReview = false, strictChoice = false) {
  const calls: string[] = []
  await page.route('https://chat-choice.invalid/**', async route => {
    const request = route.request().postDataJSON(), prompt = JSON.stringify(request.messages)
    const step = request.messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? 'choice'
      : prompt.includes('本次持久化行动候选') ? 'review' : 'expression'
    calls.push(step)
    if (strictChoice && step === 'choice') {
      expect(request.response_format).toMatchObject({type: 'json_schema', json_schema: {name: 'chat_action_choice_v4', strict: true}})
      const validate = new Ajv().compile(request.response_format.json_schema.schema)
      expect(validate(JSON.parse(chatActionResponseFixture(route, choice)))).toBe(true)
      expect(validate(JSON.parse(chatActionResponseFixture(route, {...choice, directions: [{...choice.directions[0], kind: 'own-action'}]})))).toBe(false)
    }
    expect(request.max_tokens).toBe(step === 'choice' ? 2000 : step === 'review' ? 8000 : 4000)
    if (step !== 'review') expect(prompt).not.toContain('掌柜把铜印留在柜台下')
    if (step === 'expression') expect(prompt).toContain(privateDraft)
    const output = step === 'choice' ? choice : step === 'expression' ? action
      : {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，非模型质量验收'}))}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant',
      content: malformedReview && step === 'review' ? '幕后：铜印在柜台底下。不是合法审查 JSON。' : chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  return calls
}

async function seed(page: Page, phase: Phase, directorBudget = 3) {
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async ({phase, directorBudget}) => {
    const load = new Function('p', 'return import(p)')
    const fixture = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')
    const skills = await load('/storyforge/src/lib/agent/skill-registry.ts')
    if (skills.getAgentSkillV1('character.chat-narrative-action').promptVersion !== 'chat-narrative-action-v72') throw Error('current default must use the choice contract')
    const f = await fixture.seedChatNarrativeRuntimeFixture({directorBudget})
    if (phase === 'fresh') return {...f, runId: null}
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const version = await api.readProductRuntimeStateVersion(f.sessionId)
    await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: version.sequence, baseStateHash: version.stateHash,
      kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 1}})
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    let runId: number | null = null, interrupted = false
    try {
      await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
        skillId: 'character.chat-narrative-action', objective: '隔离浏览器中断恢复夹具',
        aiConfig: {provider: 'openai', baseUrl: 'https://chat-choice.invalid/v1', model: 'choice-fixture', apiKey: 'isolated-test-key', temperature: .2, maxTokens: 9000},
        onRunCreated: (id: number) => {runId = id},
        onActionChoiceBoundary: (boundary: string) => {
          if (phase === 'choice-raw' && boundary === 'raw-response.saved' || phase === 'choice-saved' && boundary === 'choice.saved'
            || phase === 'choice-unknown' && boundary === 'model.requested') throw Error('e2e-durable-interruption')
        },
        onActionExpressionBoundary: (boundary: string) => {
          if (phase === 'expression-raw' && boundary === 'raw-response.saved' || phase === 'candidate-saved' && boundary === 'candidate.persisted'
            || phase === 'expression-unknown' && boundary === 'model.requested') throw Error('e2e-durable-interruption')
        },
      })
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('e2e-durable-interruption')) throw error
      interrupted = true
    }
    if (!interrupted || runId == null) throw Error('expected durable interruption did not occur')
    return {...f, runId}
  }, {phase, directorBudget})
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  return f
}
async function read(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const load = new Function('p', 'return import(p)')
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const runs = await db.agentRuns.where('productRuntimeSessionId').equals(id).toArray(), session = await db.productRuntimeSessions.get(id)
    const store = await load('/storyforge/src/lib/agent/run/event-store.ts'), receipts = await load('/storyforge/src/lib/character-interaction/action-terminal-receipt.ts')
    const scope = {projectId: session.projectId, worldId: session.worldId, workId: session.workId}, terminalReceipts = []
    for (const run of runs.filter((row: {status: string}) => row.status === 'completed')) {
      terminalReceipts.push(await receipts.readChatActionTerminalReceiptV1(scope, await store.readInstanceAgentRunV1(scope, run.id)))
    }
    return {state: await api.readProductRuntimeState(id), events: await db.productRuntimeEvents.where('sessionId').equals(id).sortBy('sequence'),
      runs, terminalReceipts}
  }, sessionId)
}
async function privateContentAbsent(page: Page) {
  expect(await page.locator('body').innerText()).not.toContain(privateDraft)
  expect(await page.locator('body').innerText()).not.toContain('掌柜把铜印留在柜台下')
}

for (const phase of ['choice-raw', 'choice-saved', 'expression-raw', 'candidate-saved'] as const) test(`reload and explicit continuation reuse ${phase} without resending saved output`, async ({page}) => {
  const calls = await provider(page), f = await seed(page, phase), before = await read(page, f.sessionId)
  const initialCalls = phase.startsWith('choice') ? ['choice'] : ['choice', 'expression']
  expect(calls).toEqual(initialCalls)
  expect(before.state.interaction.messages).toHaveLength(0)
  expect(before.state.interaction.remainingDirectorBudget).toBe(3)
  await expect(page.getByTestId('chat-action-resume')).toContainText('尚未改变故事')
  await privateContentAbsent(page)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByRole('button', {name: `继续本次角色行动 #${f.runId}`, exact: true})).toBeEnabled()
  expect(calls).toEqual(initialCalls)
  await privateContentAbsent(page)
  await page.getByRole('button', {name: `继续本次角色行动 #${f.runId}`, exact: true}).click()
  await expect(page.getByText(reply, {exact: true})).toBeVisible()
  await expect(page.getByTestId('chat-action-resume')).toHaveCount(0)
  expect(calls).toEqual(['choice', 'expression', 'review'])
  const after = await read(page, f.sessionId)
  expect(after.runs).toHaveLength(1)
  expect(after.runs[0].status).toBe('completed')
  expect(after.terminalReceipts).toHaveLength(1)
  expect(after.terminalReceipts[0]).toMatchObject({receiptHash: after.runs[0].terminalReceiptHash, verifierSetVersion: 'character-chat-action-terminal-v2'})
  expect(after.terminalReceipts[0].criteria.find((item: {id: string}) => item.id === 'runtime.action-output-budget-v1').evidenceRefs).toHaveLength(3)
  expect(after.state.interaction.messages).toHaveLength(1)
  expect(after.state.interaction.remainingDirectorBudget).toBe(0)
  expect(after.events.map((event: {payloadJson: string}) => JSON.parse(event.payloadJson)).filter((payload: {actionChoiceVersion?: number}) => payload.actionChoiceVersion === 1)).toHaveLength(1)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByText(reply, {exact: true})).toBeVisible()
  expect(calls).toEqual(['choice', 'expression', 'review'])
  expect((await read(page, f.sessionId)).state).toEqual(after.state)
  expect((await read(page, f.sessionId)).terminalReceipts).toEqual(after.terminalReceipts)
  await privateContentAbsent(page)
})

for (const phase of ['choice-unknown', 'expression-unknown'] as const) test(`unknown ${phase} offers cancellation and never automatic or explicit resend`, async ({page}) => {
  const calls = await provider(page), f = await seed(page, phase), before = await read(page, f.sessionId)
  const initialCalls = phase === 'choice-unknown' ? [] : ['choice']
  await expect(page.getByTestId('chat-action-resume')).toHaveCount(0)
  await expect(page.getByTestId('chat-turn-resume')).toContainText('结果未知')
  await expect(page.getByRole('button', {name: '补齐未完成本轮', exact: true})).toBeDisabled()
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByRole('button', {name: `取消未完成处理 #${f.runId}`, exact: true})).toBeEnabled()
  expect(calls).toEqual(initialCalls)
  await page.getByRole('button', {name: `取消未完成处理 #${f.runId}`, exact: true}).click()
  await expect.poll(async () => (await read(page, f.sessionId)).runs[0].status).toBe('cancelled')
  expect((await read(page, f.sessionId)).state).toEqual(before.state)
  expect(calls).toEqual(initialCalls)
  await privateContentAbsent(page)
})

test('cancelling a saved choice preserves the story without expression or review calls', async ({page}) => {
  const calls = await provider(page), f = await seed(page, 'choice-saved'), before = await read(page, f.sessionId)
  await page.getByRole('button', {name: `取消本次行动 #${f.runId}`, exact: true}).click()
  await expect(page.getByTestId('chat-action-resume')).toHaveCount(0)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(calls).toEqual(['choice'])
  expect((await read(page, f.sessionId)).state).toEqual(before.state)
  expect((await read(page, f.sessionId)).runs[0].status).toBe('cancelled')
  await privateContentAbsent(page)
})

for (const budget of [2, 3]) test(`fresh action respects the three-call allowance in the actual controls (${budget})`, async ({page}) => {
  if (budget === 3) registerBrowserFixtureAIConfigV1(page, { provider: 'agnes', baseUrl: 'https://chat-choice.invalid/v1', model: 'choice-fixture', maxTokens: 9000, apiKey: 'isolated-test-key' })
  const calls = await provider(page, false, budget === 3), f = await seed(page, 'fresh', budget), before = await read(page, f.sessionId)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  const start = page.getByRole('button', {name: '让角色开场', exact: true})
  if (budget === 2) {
    await expect(start).toBeDisabled()
    await expect(page.getByText('当前剩余 2 次场景调用额度，开始这一步至少需要 3 次。', {exact: true})).toBeVisible()
    await reloadWithBrowserFixtureAIConfigV1(page)
    await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
    expect(await read(page, f.sessionId)).toEqual(before)
    expect(calls).toHaveLength(0)
  } else {
    await start.click()
    await expect(page.getByText(reply, {exact: true})).toBeVisible()
    expect(calls).toEqual(['choice', 'expression', 'review'])
    expect((await read(page, f.sessionId)).state.interaction.remainingDirectorBudget).toBe(0)
    await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeDisabled()
  }
  await privateContentAbsent(page)
})

test('a malformed review after continuation never displays expression, choice or coordinator content', async ({page}) => {
  const calls = await provider(page, true), f = await seed(page, 'choice-saved'), before = await read(page, f.sessionId)
  await page.getByRole('button', {name: `继续本次角色行动 #${f.runId}`, exact: true}).click()
  await expect(page.getByText(/审查响应格式无效/)).toBeVisible()
  await expect(page.getByText(reply, {exact: true})).toHaveCount(0)
  expect(await page.locator('body').innerText()).not.toContain('铜印在柜台底下')
  expect((await read(page, f.sessionId)).state).toEqual(before.state)
  expect(calls).toEqual(['choice', 'expression', 'review'])
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(calls).toEqual(['choice', 'expression', 'review'])
  await expect(page.getByText(reply, {exact: true})).toHaveCount(0)
  await privateContentAbsent(page)
})

for (const failure of ['over-budget', 'missing-usage'] as const) test(`Codex transport ${failure} retains the response and stops without exposing or retrying the proposal`, async ({page}) => {
  const requests: string[] = [], jobs = new Map<string, unknown>()
  await page.route('**/storyforge/local-codex/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    let body: unknown
    if (path.endsWith('/status')) body = {state: 'ready', label: 'isolated fixture', plan: 'test'}
    else if (path.endsWith('/requests') && request.method() === 'POST') {
      const sent = request.postDataJSON()
      expect(sent.messages[0].content).toContain('这是尚未发生的角色行动选择草稿')
      expect(sent).not.toHaveProperty('maxTokens')
      expect(sent).not.toHaveProperty('max_output_tokens')
      requests.push(sent.id)
      jobs.set(sent.id, {id: sent.id, model: sent.model, status: 'completed', text: JSON.stringify(choice), dispatched: true,
        providerTurn: {threadId: 'fixture-thread', turnId: sent.id, status: 'completed'},
        ...(failure === 'over-budget' ? {usage: {inputTokens: 500, outputTokens: 2001, totalTokens: 2501}} : {})})
      body = {id: sent.id}
    } else {
      const id = path.split('/').slice(-1)[0]!
      if (!jobs.has(id) || request.method() !== 'GET') throw Error(`Unexpected fixture transport request: ${request.method()} ${path}`)
      body = jobs.get(id)
    }
    await route.fulfill({status: request.method() === 'POST' ? 202 : 200, contentType: 'application/json', body: JSON.stringify(body)})
  })
  const f = await seed(page, 'fresh')
  // This explicit provider replacement belongs to the test, not the default
  // if-absent registration. Preserve the old omitted-field defaults and keep
  // the local Codex bridge keyless rather than copying a cloud session key.
  unregisterBrowserFixtureAIConfigV1(page)
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as <T>(path: string) => Promise<T>
    const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'codex', model: 'choice-fixture', maxTokens: 9000,
      baseUrl: 'https://api.deepseek.com/v1', temperature: 0.7, apiKey: '' })
  })
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByText('用量说明', {exact: true})).toBeVisible()
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await expect(page.getByRole('button', {name: '让角色开场', exact: true})).toBeEnabled()
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByText(failure === 'over-budget' ? /本步骤输出用量 2001 tokens 超出 2000 预算/ : /Codex 未返回实际输出用量/)).toBeVisible()
  const after = await read(page, f.sessionId)
  expect(after.runs).toHaveLength(1)
  expect(after.runs[0].status).toBe('failed')
  expect(after.state.interaction.messages).toHaveLength(0)
  expect(after.state.interaction.remainingDirectorBudget).toBe(3)
  expect(requests).toHaveLength(1)
  const retained = await page.evaluate(async ({projectId, runId}) => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const events = await db.agentRunEvents.where('runId').equals(runId).toArray()
    const kinds = events.filter((e: {type: string}) => e.type === 'evidence.artifact.recorded').map((e: {payloadJson: string}) => JSON.parse(e.payloadJson))
    const raw = kinds.find((e: {artifactKind: string}) => e.artifactKind === 'raw-response')
    const artifacts = await db.agentRunArtifacts.where('projectId').equals(projectId).toArray()
    return {raw: artifacts.some((a: {contentHash: string}) => a.contentHash === raw?.contentHash),
      outputReceipt: artifacts.some((a: {artifactKind: string; content: string}) => a.artifactKind === 'tool-result' && a.content.includes('storyforge.chat-action-output-budget'))}
  }, {projectId: f.scope.projectId, runId: after.runs[0].id})
  expect(retained).toEqual({raw: true, outputReceipt: true})
  await privateContentAbsent(page)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(requests).toHaveLength(1)
  expect((await read(page, f.sessionId)).state).toEqual(after.state)
  await privateContentAbsent(page)
})
