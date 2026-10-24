import {expect, test, type Page} from '@playwright/test'
import {chatActionResponseFixture} from './helpers/character-chat-choice'
import {openChatNarrativeTools} from './helpers/character-chat-ui'

const hold = {kind: 'pause', text: '我暂缓寻找铜印，先向你澄清我的判断。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'paused'}
const close = {kind: 'complete', text: '铜印还没找到。我先前只是猜测，没有依据指责任何人；寻找仍然暂缓。', goalKey: 'clarify', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'fulfilled'}

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://goal-continuation.invalid/v1', model: 'test', maxTokens: 8000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  const calls: string[] = []
  await page.route('https://goal-continuation.invalid/**', async route => {
    const messages = route.request().postDataJSON().messages, text = JSON.stringify(messages)
    const step = messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? 'choice'
      : text.includes('本次持久化行动候选') ? 'review' : 'expression'
    calls.push(step)
    if (step !== 'review') expect(text).not.toContain('掌柜把铜印留在柜台下')
    const output = step === 'choice' ? {directions: [], selectedId: null, decisionSummary: '工程夹具，不证明剧情质量'}
      : step === 'expression' ? close : {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction']
        .map(check => ({check, passed: true, reason: '工程夹具'}))}
    const content = chatActionResponseFixture(route, output)
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async action => {
    const load = new Function('p', 'return import(p)')
    const fixture = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const seeded = await fixture.seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 2, onlyGuard: true, additionalGuardGoal: true})
    const v = await api.readProductRuntimeStateVersion(seeded.sessionId)
    await api.requestChatNarrativeTrigger({sessionId: seeded.sessionId, commandId: 'initial-hold', baseSequence: v.sequence, baseStateHash: v.stateHash,
      kind: 'scene-start', sourceEventSequence: v.sequence, direction: {actorKey: 'guard', actionLimit: 2}})
    const saved = await harness.generateInteractionRuntimeCandidateV1({scope: seeded.scope, productRuntimeSessionId: seeded.sessionId, participantKey: 'guard',
      skillId: 'character.chat-narrative-action', objective: '工程夹具：保留已有暂停，另一个澄清目标保持活跃',
      runAI: fixture.withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(fixture.chatActionReviewOutputFixture())})
    await harness.adoptInteractionRuntimeCandidateV1({scope: seeded.scope, runId: saved.snapshot.run.id})
    return seeded
  }, hold)
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  await openChatNarrativeTools(page)
  const read = () => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {state: await api.readProductRuntimeState(id), runs: await db.agentRuns.where('productRuntimeSessionId').equals(id).toArray()}
  }, f.sessionId)
  return {calls, read}
}

for (const width of [390, 1440]) test(`closing the active goal leaves an old pause without another action at ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 900})
  const {calls, read} = await setup(page), before = await read()
  await expect(page.getByLabel('演绎节奏', {exact: true})).toHaveValue('2')
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByText(close.text, {exact: true})).toBeVisible()
  await expect.poll(async () => (await read()).runs.at(-1)?.status).toBe('completed')
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  await expect(page.getByTestId('chat-turn-resume')).toHaveCount(0)
  const after = await read(), story = after.state.interaction.chatNarrative
  expect(story.triggers.at(-1)).toMatchObject({kind: 'continue', direction: {actionLimit: 2}})
  expect(story.triggers.at(-1).actionSequences).toHaveLength(1)
  expect(story.situation.goals.find((g: {goalKey: string}) => g.goalKey === 'clarify').status).toBe('fulfilled')
  expect(story.situation.goals.find((g: {goalKey: string}) => g.goalKey === 'find-seal'))
    .toEqual(before.state.interaction.chatNarrative.situation.goals.find((g: {goalKey: string}) => g.goalKey === 'find-seal'))
  expect(story.situation.threads).toEqual(before.state.interaction.chatNarrative.situation.threads)
  expect(after.state.interaction.messages).toHaveLength(before.state.interaction.messages.length + 1)
  expect(after.runs).toHaveLength(before.runs.length + 1)
  expect(calls).toEqual(['choice', 'expression', 'review'])
  expect(after.state.interaction.remainingDirectorBudget).toBe(before.state.interaction.remainingDirectorBudget - 3)
  await page.reload()
  await expect(page.getByText(close.text, {exact: true})).toBeVisible()
  await expect(page.getByTestId('chat-turn-resume')).toHaveCount(0)
  await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled()
  expect((await read()).state).toEqual(after.state)
  expect(calls).toEqual(['choice', 'expression', 'review'])
})
