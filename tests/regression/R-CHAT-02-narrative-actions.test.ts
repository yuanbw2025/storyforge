import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createInitialInteractionState, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, interruptChatNarrativeTriggerV1, previewChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {branchProductRuntimeSession, commitChatNarrativeAction, commitInteractionCharacterReply, commitInteractionPlayerMessage, createProductRuntimeCheckpoint, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import {chatNarrativeFixture, seedChatNarrativeRuntimeFixture, chatActionReviewFixture} from '../helpers/chat-narrative-fixture'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {assertFrozenProductRuntimeStateV1} from '../../src/lib/product/runtime-product-adapters'

function opening() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(state, {sequence: 2, kind: 'scene-start', sourceEventSequence: 1, seed: null})
}
function inspection(): ChatNarrativeActionV1 {
  return {kind: 'complete', text: '叶岑检查了后门。后门闩完好，没有撬动痕迹。他把看到的情况告诉了两人。', goalKey: 'find-seal',
    evidenceFactKeys: ['lost'], audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: false,
    newFacts: [{factKey: 'door-checked', kind: 'observation', text: '后门闩完好，没有撬动痕迹。', evidenceFactKeys: ['lost'], evidenceExcerpt: '后门闩完好，没有撬动痕迹。'}],
    disclosures: [], threadUpdates: [], goalStatus: null}
}
function apply(action: ChatNarrativeActionV1, state = opening()) {
  return applyChatNarrativeActionV1(state, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'action:door', action})
}

it('advances from an actual scene start without a player message and records expression and consequence together', () => {
  const before = opening()
  const after = apply(inspection(), before)
  expect(before.messages).toEqual([])
  expect(before.chatNarrative!.situation.facts.some(f => f.factKey === 'door-checked')).toBe(false)
  expect(after.messages).toHaveLength(1)
  expect(after.messages[0]).toMatchObject({role: 'character', replyToSequence: null, eventSequence: 3})
  expect(after.chatNarrative!.situation.facts.at(-1)).toMatchObject({origin: 'runtime-consequence', sourceEventSequence: 3})
  expect(after.chatNarrative!.triggers[0]).toMatchObject({status: 'complete', actionSequences: [3]})
  expect(after.remainingDirectorBudget).toBe(99)
  expect(after.totalPlayerTurns).toBe(0)
  expect(parseInteractionState(after)).toEqual(after)
})

it.each([
  ['secret evidence', (a: ChatNarrativeActionV1) => {a.evidenceFactKeys = ['secret']}],
  ['unrecognized new field', a => {Object.assign(a, {playerEmotions: 'afraid'})}],
  ['overwrite truth', a => {a.newFacts[0].factKey = 'secret'}],
  ['disallowed invention', a => {a.newFacts[0].kind = 'temporary-character'}],
  ['extra facts', a => {a.newFacts.push({...a.newFacts[0], factKey: 'two', text: '二'}, {...a.newFacts[0], factKey: 'three', text: '三'})}],
  ['unsupported consequence', a => {a.newFacts[0].text = '玩家已经同意搜身。'}],
  ['intention treated as completion', a => {a.kind = 'attempt'; a.waitingForPlayer = true}],
  ['waiting for decision treated as completion', a => {a.waitingForPlayer = true}],
  ['speaking for another actor', a => {a.goalKey = 'fix-road'}],
  ['out of scene audience', a => {a.audienceKeys.push('outsider')}],
  ['secret disclosure', a => {a.disclosures = [{factKey: 'secret', toParticipantKeys: ['player'], evidenceExcerpt: a.text}]}],
  ['invisible thread update', a => {a.audienceKeys = ['guard', 'player']; a.threadUpdates = [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: a.text}]}],
] as const)('refuses %s with no partial mutation', (_label, change) => {
  const state = opening(), saved = structuredClone(state), action = inspection()
  change(action)
  expect(() => apply(action, state)).toThrow()
  expect(state).toEqual(saved)
})

it('records a proposal as waiting and leaves established facts unchanged until the player responds', () => {
  const action: ChatNarrativeActionV1 = {...inspection(), kind: 'attempt', text: '叶岑问：“可以一起看看后门吗？如果不愿意，我们也能先修路。”', waitingForPlayer: true, newFacts: []}
  const state = apply(action)
  expect(state.chatNarrative!.triggers.at(-1)!.status).toBe('waiting-player')
  expect(state.chatNarrative!.situation.facts).toHaveLength(4)
  expect(() => applyChatNarrativeActionV1(state, {sequence: 4, triggerSequence: 2, actorKey: 'guard', messageId: 'second', action: inspection()})).toThrow('等待玩家')
  interruptChatNarrativeTriggerV1(state, 4)
  expect(state.chatNarrative!.triggers.at(-1)!.status).toBe('cancelled')
})

it.each(['goal', 'thread'] as const)('requires complete for a final spoken decision that closes a %s, even without a new fact', target => {
  const before = opening(), saved = structuredClone(before)
  const decision: ChatNarrativeActionV1 = {...inspection(), text: '依据检查结果，这项检查到此为止。', newFacts: [],
    goalStatus: target === 'goal' ? 'fulfilled' : null,
    threadUpdates: target === 'thread' ? [{threadKey: 'investigate', status: 'resolved', evidenceExcerpt: '这项检查到此为止。'}] : [], nextPossibilities: []}
  const preview = (action: ChatNarrativeActionV1) => previewChatNarrativeActionV1(before, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'closure', action})
  expect(() => preview({...decision, kind: 'speak'})).toThrow('意图或等待选择不能写成已完成后果')
  expect(before).toEqual(saved)
  expect(preview(decision).messages.at(-1)?.text).toBe(decision.text)
})

it('allows a meaningful pause and explicit disclosure without inventing completed player actions', () => {
  const text = '叶岑曾误指控一位无辜旅人，始终后悔。他告诉两人：“我先不查了，我们等等。”'
  const state = apply({...inspection(), kind: 'pause', text, newFacts: [], disclosures: [{factKey: 'regret', toParticipantKeys: ['player', 'artisan'], evidenceExcerpt: text}],
    threadUpdates: [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: '我先不查了，我们等等。'}], goalStatus: 'paused'})
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'regret')!.audienceKeys).toEqual(['guard', 'player', 'artisan'])
  expect(state.chatNarrative!.situation.threads[0].status).toBe('paused')
  expect(state.chatNarrative!.situation.goals[0].status).toBe('paused')
})

it('can pause an individual goal in private without silently pausing a shared thread', () => {
  const action: ChatNarrativeActionV1 = {...inspection(), kind: 'pause', audienceKeys: ['guard', 'player'],
    text: '你先休息，我暂缓自己的寻找。', newFacts: [], goalStatus: 'paused'}
  const state = apply(action)
  expect(state.chatNarrative!.situation.goals[0].status).toBe('paused')
  expect(state.chatNarrative!.situation.threads[0].status).toBe('open')
  expect(() => apply({...action, threadUpdates: [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: action.text}]})).toThrow('知情范围')
})

it('enforces actual triggers, deduplication, budget and seed preparation', () => {
  const state = opening()
  expect(() => requestChatNarrativeTriggerV1(state, {sequence: 3, kind: 'scene-start', sourceEventSequence: 1, seed: null})).toThrow('已经触发')
  expect(() => requestChatNarrativeTriggerV1(state, {sequence: 3, kind: 'player-response', sourceEventSequence: 1, seed: null})).toThrow('玩家消息')
  expect(() => requestChatNarrativeTriggerV1(state, {sequence: 3, kind: 'continue', sourceEventSequence: 1, seed: null})).toThrow('当前事件头')
  const seed = requestChatNarrativeTriggerV1(state, {sequence: 3, kind: 'player-seed', sourceEventSequence: 2, seed: '院外有人请求借宿。'})
  expect(() => applyChatNarrativeActionV1(seed, {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'seed', action: inspection()})).toThrow('情境构建')
  state.remainingDirectorBudget = 0
  expect(() => apply(inspection(), state)).toThrow('预算')
})

it('rebases repeated branches without aliasing old triggers, actions or facts', () => {
  const first = rebaseInteractionStateForBranch(apply(inspection()), 3)
  const continued = requestChatNarrativeTriggerV1(first, {sequence: 1, kind: 'continue', sourceEventSequence: 0, seed: null})
  const action = {...inspection(), kind: 'pause' as const, newFacts: [], text: '叶岑先歇了一会儿。'}
  const acted = applyChatNarrativeActionV1(continued, {sequence: 2, triggerSequence: 1, actorKey: 'guard', messageId: 'pause', action})
  const second = rebaseInteractionStateForBranch(acted, 2)
  expect(second.chatNarrative!.triggers.map(t => t.requestedSequence)).toEqual([-5, -2])
  expect(second.messages.map(m => m.eventSequence)).toEqual([-4, -1])
  expect(second.chatNarrative!.situation.facts.at(-1)!.sourceEventSequence).toBe(-4)
  expect(parseInteractionState(second)).toEqual(second)
  const future = structuredClone(second)
  future.chatNarrative!.lastEventSequence = -3
  expect(() => parseInteractionState(future)).toThrow('尚未发生')
})

describe('formal narrative commands', () => {
  beforeEach(async () => {db.close(); await db.delete(); await db.open()})
  afterEach(() => db.close())
  it('atomically persists idempotent action, rejects stale commits and survives refresh, nested branches and export', async () => {
    const f = await seedChatNarrativeRuntimeFixture()
    const envelope = async (commandId: string) => {const v = await readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId, baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const request = await requestChatNarrativeTrigger({...await envelope('start'), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
    const input = {...await envelope('inspect'), actorKey: 'guard', triggerSequence: request.sequence, messageId: 'inspection', action: inspection(), review: chatActionReviewFixture(inspection())}
    const committed = await commitChatNarrativeAction(input)
    expect((await commitChatNarrativeAction(input)).id).toBe(committed.id)
    await expect(commitChatNarrativeAction({...input, commandId: 'stale'})).rejects.toThrow('状态已变化')
    await expect(commitInteractionCharacterReply({...await envelope('legacy'), speakerKey: 'guard', messageId: 'legacy', text: '跳过后果', replyToSequence: 1, budgetCost: 0})).rejects.toThrow('行动候选')
    db.close(); await db.open()
    const saved = await readProductRuntimeState(f.sessionId)
    expect(saved.interaction!.messages).toHaveLength(1)
    expect(saved.interaction!.chatNarrative!.situation.facts.at(-1)!.sourceEventSequence).toBe(committed.sequence)
    const checkpoint = await createProductRuntimeCheckpoint({sessionId: f.sessionId, name: '后门已查'})
    const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: checkpoint.throughSequence, title: '第一次分支'})
    const nested = await branchProductRuntimeSession({parentSessionId: branch.id!, throughSequence: 0, title: '第二次分支'})
    const expected = (await readProductRuntimeState(nested.id!)).interaction!.chatNarrative
    expect(expected!.situation.facts.at(-1)!.sourceEventSequence).toBe(-2)
    const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(s => s.title === '第二次分支')!
    expect((await readProductRuntimeState(restored.id!)).interaction!.chatNarrative).toEqual(expected)
    const session = await db.productRuntimeSessions.get(f.sessionId)
    const initial = JSON.parse(session!.initialStateJson)
    const pkg = {productType: 'character-interaction', interaction: chatNarrativeFixture(initial.interaction.chatNarrative.worldReleaseHash, initial.interaction.profiles.map((p: {characterKey: string}) => p.characterKey))}
    initial.interaction.chatNarrative.permissions.maxActionsPerTrigger = 3
    expect(() => assertFrozenProductRuntimeStateV1({initial, runtimePackage: pkg as never, runtimeSourceHash: '', origin: 'branch'})).toThrow('冻结互动内容')
  })
  it('a new player message cancels outstanding work while preserving the already committed facts', async () => {
    const f = await seedChatNarrativeRuntimeFixture()
    const v = await readProductRuntimeStateVersion(f.sessionId)
    const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
    const before = await readProductRuntimeStateVersion(f.sessionId)
    await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'refuse', baseSequence: before.sequence, baseStateHash: before.stateHash, messageId: 'refuse', text: '我不想搜查，先修路。', audienceKeys: ['guard', 'artisan']})
    const current = await readProductRuntimeStateVersion(f.sessionId)
    await expect(commitChatNarrativeAction({sessionId: f.sessionId, commandId: 'late', baseSequence: current.sequence, baseStateHash: current.stateHash, triggerSequence: trigger.sequence, actorKey: 'guard', messageId: 'late', action: inspection(), review: chatActionReviewFixture(inspection())})).rejects.toThrow('已取消')
    expect((await readProductRuntimeState(f.sessionId)).interaction!.messages.map(m => m.role)).toEqual(['player'])
  })
})
