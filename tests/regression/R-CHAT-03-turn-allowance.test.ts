import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import * as harness from '../../src/lib/character-interaction/harness'
import {advanceChatNarrativeTurnV1, createChatNarrativeSituationV1, readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import {chatNewTurnAllowanceV1, chatPreparedTurnAllowanceV1, chatSituationAndActionAllowanceV1} from '../../src/lib/character-interaction/narrative-budget'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1} from '../../src/lib/types/chat-narrative'
import type {ChatNarrativeActionV1, ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'
import {chatActionOutcomeFixture, chatActionChoiceFixture} from '../helpers/chat-action-outcome'
import {chatNextActionLimitV1} from '../../src/lib/character-interaction/narrative-pacing'
import {DEFAULT_CHAT_NARRATIVE_SETUP_V1} from '../../src/lib/character-interaction/narrative-setup'

const originalSkill = skills.getAgentSkillV1, generate = harness.generateInteractionRuntimeCandidateV1
const config = {provider: 'openai' as const, model: 'fixture', apiKey: 'fixture', temperature: .2, maxTokens: 4000}
const seed = '门外传来敲门声。不要预先决定来者身份。'
const choice = {directions: [{id: 'ask', action: '询问铜印的线索', evidenceFactKeys: ['lost'], evidenceMessageIds: [], changes: '澄清仍未知的线索，不预定回答',
  playerDependency: '玩家是否愿意回答', unconfirmedConditions: [], kind: 'question'}], selectedId: 'ask', decisionSummary: '先询问当前目标所缺的线索。'}
const action = (): ChatNarrativeActionV1 => ({kind: 'speak', text: '你愿意说说铜印最后出现的地方吗？', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player', 'artisan'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
const directionAction = (): ChatNarrativeActionV1 => ({...action(), waitingForPlayer: false, text: '我想先独自检查后门门闩。你可以留在这里休息。',
  situationRequest: {threadKey: 'investigate', direction: '检查后门门闩，补足可以自己查看的局部线索，不预设铜印已经找到。', evidenceFactKeys: ['lost'], evidenceExcerpt: '我想先独自检查后门门闩。'}})
const directionBackground = (): ChatSituationDraftV1 => ({kind: 'chat-situation', title: '后门的检查方向', location: '驿站', timeLabel: '傍晚',
  newFacts: [{factKey: 'latch', kind: 'object', text: '后门门闩有一处松动。', audienceKeys: ['guard', 'player', 'artisan'], evidenceFactKeys: ['lost'], seedExcerpt: '检查后门门闩'}],
  newGoals: [], newThreads: [], possibilities: [{actorKey: 'guard', text: '可以查看门闩，也可以先询问修理师。', evidenceFactKeys: ['latch']}]})
beforeEach(async () => {
  expect(originalSkill('character.chat-narrative-action').promptVersion).toBe('chat-narrative-action-v72')
  db.close(); await db.delete(); await db.open()
})
afterEach(() => {vi.restoreAllMocks(); db.close()})
type Fixture = Awaited<ReturnType<typeof seedChatNarrativeRuntimeFixture>>
const state = async (f: Fixture) => (await readProductRuntimeState(f.sessionId)).interaction!
async function advance(f: Fixture, kind: 'scene-start' | 'continue' = 'scene-start', extra: Partial<Parameters<typeof advanceChatNarrativeTurnV1>[0]> = {}) {
  return advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence,
    kind, participantKey: 'guard', aiConfig: config, actionLimit: 1, ...extra})
}
function mockModels(value: (prompt: string) => ChatNarrativeActionV1 = action, background?: () => ChatSituationDraftV1) {
  const calls: string[] = []
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: async messages => {
      if (input.skillId === 'character.chat-situation-construction') {
        calls.push('situation')
        return JSON.stringify(background?.() ?? {kind: 'chat-situation', title: '门外的声响', location: '驿站', timeLabel: '傍晚',
          newFacts: [{factKey: 'knocking', kind: 'observation', text: '门外传来敲门声。', audienceKeys: ['guard', 'player', 'artisan'], evidenceFactKeys: ['road'], seedExcerpt: '门外传来敲门声'}],
          newGoals: [], newThreads: [], possibilities: [{actorKey: 'guard', text: '可以隔门询问。', evidenceFactKeys: ['knocking']}]})
      }
      const selecting = messages[0].content.startsWith('这是尚未发生的角色行动选择草稿')
      calls.push(selecting ? 'choice' : 'expression')
      return JSON.stringify(selecting ? chatActionChoiceFixture(messages, choice) : chatActionOutcomeFixture(messages, value(messages.map(message => message.content).join('\n'))))
    },
    runReviewAI: async () => {
      calls.push('review')
      return JSON.stringify(input.skillId === 'character.chat-situation-construction'
        ? {checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具'}))} : chatActionReviewOutputFixture())
    },
  }))
  return {spy, calls}
}

it('rejects a two-unit new action before a trigger, run or model request is created', async () => {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 2}), before = await readProductRuntimeState(f.sessionId), models = mockModels()
  await expect(advance(f)).rejects.toThrow('预算不足')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(models.spy).not.toHaveBeenCalled()
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).count()).toBe(0)
})

it('uses the new default to observe, settle the result and respond to it in one bounded turn', async () => {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 8, actorSituationExpansion: true,
    maxActionsPerTrigger: DEFAULT_CHAT_NARRATIVE_SETUP_V1.permissions.maxActionsPerTrigger})
  const before = await state(f), observation = '我俯身查看了后门门闩的外侧，没有打开后门。'
  const result = '这次检查没有在门闩外侧看出明显松动，门外情况仍未知。'
  let actions = 0
  const models = mockModels(prompt => {
    if (++actions === 1) return {...action(), kind: 'complete', text: observation, waitingForPlayer: false,
      newFacts: [{factKey: 'inspected', kind: 'observation', text: observation, evidenceFactKeys: ['lost'], evidenceExcerpt: observation}],
      situationRequest: {purpose: 'observation-result', threadKey: 'investigate', direction: '确认这次外侧检查能否看出门闩有明显松动，不涉及门外情况。',
        evidenceFactKeys: ['lost', 'inspected'], evidenceExcerpt: observation}}
    expect(prompt).toContain(result)
    expect(prompt).not.toContain('掌柜把铜印留在柜台下的木箱里')
    return {...action(), kind: 'speak', waitingForPlayer: false, evidenceFactKeys: ['outside-checked'],
      text: `${result}我先排除明显松动，接着考虑屋内其他公共区域。`}
  }, () => ({kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚',
    newFacts: [{factKey: 'outside-checked', kind: 'observation', text: result, audienceKeys: ['guard', 'player'],
      evidenceFactKeys: ['inspected'], seedExcerpt: '这次外侧检查能否看出门闩有明显松动'}],
    newGoals: [], newThreads: [], possibilities: []}))
  await advance(f, 'scene-start', {actionLimit: chatNextActionLimitV1(before.chatNarrative!.permissions, before.chatNarrative!.triggers)})
  const after = await state(f)
  expect(models.calls).toEqual(['choice', 'expression', 'review', 'situation', 'review', 'choice', 'expression', 'review'])
  expect(after.messages).toHaveLength(2)
  expect(after.messages[1].text).toContain(result)
  expect(after.chatNarrative!.triggers).toHaveLength(1)
  expect(after.chatNarrative!.triggers[0]).toMatchObject({direction: {actionLimit: 2}, status: 'complete'})
  expect(after.chatNarrative!.pendingSituation).toBeUndefined()
  expect(after.chatNarrative!.situation.goals).toEqual(before.chatNarrative!.situation.goals)
  expect(after.remainingDirectorBudget).toBe(0)
  db.close(); await db.open()
  expect(await state(f)).toEqual(after)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, after)).toBeNull()
})

it('uses the next ready trigger when the previous action is waiting, without altering the old turn on refusal', async () => {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 5}), models = mockModels()
  await advance(f)
  const before = await readProductRuntimeState(f.sessionId), current = before.interaction!
  expect(current.chatNarrative!.triggers.at(-1)!.status).toBe('waiting-player')
  expect(current.remainingDirectorBudget).toBe(2)
  expect(chatNewTurnAllowanceV1(current, {sequence: before.lastSequence + 1, kind: 'continue', sourceEventSequence: before.lastSequence, seed: null}, 'guard')).toBe(3)
  await expect(advance(f, 'continue')).rejects.toThrow('预算不足')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(models.calls).toEqual(['choice', 'expression', 'review'])
})

it('checks each actually scheduled actor and stops before an unaffordable second action run', async () => {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 5, maxActionsPerTrigger: 3})
  const models = mockModels(() => ({...action(), waitingForPlayer: false}))
  await advance(f, 'scene-start', {actionLimit: 3, schedulingMode: 'round-robin'})
  const current = await state(f)
  expect(current.messages.map(message => message.speakerKey)).toEqual(['guard'])
  expect(current.remainingDirectorBudget).toBe(2)
  expect(models.calls).toEqual(['choice', 'expression', 'review'])
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).count()).toBe(1)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, current)).toMatchObject({actorKey: 'artisan', remainingActions: 2, blockedReason: expect.stringContaining('额度不足')})
})

it.each([4, 5])('reserves five units before a new background, then charges its actual action recipe (budget %s)', async budget => {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: budget}), before = await readProductRuntimeState(f.sessionId), models = mockModels()
  const request = {scope: f.scope, sessionId: f.sessionId, expectedSequence: before.lastSequence, seed, participantKey: 'guard', aiConfig: config}
  if (budget === 4) {
    await expect(createChatNarrativeSituationV1(request)).rejects.toThrow('预算不足')
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    expect(models.calls).toHaveLength(0)
  } else {
    await createChatNarrativeSituationV1(request)
    expect(models.calls).toEqual(['situation', 'review', 'choice', 'expression', 'review'])
    expect((await state(f)).remainingDirectorBudget).toBe(0)
    expect((await state(f)).messages).toHaveLength(1)
  }
})

it('resumes an already adopted background using only the three remaining action calls', async () => {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 5}), version = await readProductRuntimeStateVersion(f.sessionId), models = mockModels()
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: version.sequence, baseStateHash: version.stateHash,
    kind: 'player-seed', sourceEventSequence: version.sequence, seed, direction: {actorKey: 'guard', actionLimit: 1}})
  const background = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player',
    skillId: 'character.chat-situation-construction', objective: '构建后中断的工程夹具', aiConfig: config})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: background.snapshot.run.id})
  db.close(); await db.open()
  expect((await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, await state(f)))!.blockedReason).toBeNull()
  await resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, aiConfig: config})
  expect(models.calls).toEqual(['situation', 'review', 'choice', 'expression', 'review'])
  expect((await state(f)).remainingDirectorBudget).toBe(0)
})

it('retains old action and comparison allowances and an ordinary reply after goal closure', async () => {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 2}), initial = await state(f), v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = {sequence: v.sequence + 1, kind: 'scene-start' as const, sourceEventSequence: f.sceneSequence, seed: null}
  expect(chatNewTurnAllowanceV1(initial, trigger, 'guard', true)).toBe(2)
  expect(chatSituationAndActionAllowanceV1(true)).toBe(4)
  const closed = structuredClone(initial)
  closed.chatNarrative!.situation.goals.find(goal => goal.actorKey === 'guard')!.status = 'fulfilled'
  closed.chatNarrative!.triggers.push({kind: 'player-response', requestedSequence: 3, sourceEventSequence: 2, seed: null, status: 'ready', actionSequences: []})
  expect(chatPreparedTurnAllowanceV1(closed, 'guard')).toBe(2)
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action'
    ? {...originalSkill(id), promptVersion: 'chat-narrative-action-v44'} : originalSkill(id))
  expect(chatSituationAndActionAllowanceV1()).toBe(4)
  const models = mockModels()
  await advance(f)
  expect(models.calls).toEqual(['expression', 'review'])
  expect((await state(f)).remainingDirectorBudget).toBe(0)
})

it('checks the selected actor when resuming a legacy undirected turn, before creating any run', async () => {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 2}), version = await readProductRuntimeStateVersion(f.sessionId), models = mockModels()
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: version.sequence, baseStateHash: version.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const before = await readProductRuntimeState(f.sessionId)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, before.interaction!)).toMatchObject({actorKey: null, blockedReason: null})
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: before.lastSequence, participantKey: 'guard', aiConfig: config})).rejects.toThrow('额度不足')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(models.calls).toHaveLength(0)
})

it('resumes the final situation alone at exactly two units after a three-call action', async () => {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 5, actorSituationExpansion: true}), version = await readProductRuntimeStateVersion(f.sessionId)
  const models = mockModels(directionAction, directionBackground)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: version.sequence, baseStateHash: version.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 1, settleSituationVersion: 1}})
  const candidate = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: 'character.chat-narrative-action', narrativeTriggerSequence: trigger.sequence, objective: '工程中断检查点', aiConfig: config})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id})
  const before = await readProductRuntimeState(f.sessionId)
  expect(before.interaction!.remainingDirectorBudget).toBe(2)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, before.interaction!)).toMatchObject({pendingSituation: true, remainingActions: 0, blockedReason: null})
  await resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: before.lastSequence, aiConfig: config})
  expect(models.calls).toEqual(['choice', 'expression', 'review', 'situation', 'review'])
  expect((await state(f)).remainingDirectorBudget).toBe(0)
  expect((await state(f)).messages).toHaveLength(1)
  expect((await state(f)).chatNarrative!.pendingSituation).toBeUndefined()
})

it.each([7, 8])('reserves background plus action before continuing a saved direction (initial budget %s)', async budget => {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: budget, actorSituationExpansion: true})
  let first = true
  const models = mockModels(() => {if (first) {first = false; return directionAction()} return action()}, directionBackground)
  await advance(f)
  const before = await readProductRuntimeState(f.sessionId)
  expect(before.interaction!.remainingDirectorBudget).toBe(budget - 3)
  const trigger = {sequence: before.lastSequence + 1, kind: 'continue' as const, sourceEventSequence: before.lastSequence, seed: null}
  expect(chatNewTurnAllowanceV1(before.interaction!, trigger, 'guard')).toBe(5)
  expect(chatNewTurnAllowanceV1(before.interaction!, trigger, 'guard', true)).toBe(4)
  if (budget === 7) {
    await expect(advance(f, 'continue')).rejects.toThrow('预算不足')
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    expect(models.calls).toEqual(['choice', 'expression', 'review'])
  } else {
    await advance(f, 'continue')
    expect(models.calls).toEqual(['choice', 'expression', 'review', 'situation', 'review', 'choice', 'expression', 'review'])
    expect((await state(f)).remainingDirectorBudget).toBe(0)
    expect((await state(f)).messages).toHaveLength(2)
  }
})
