import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, parseChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {createInitialInteractionState, interactionVisibilityView, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {adoptInteractionRuntimeCandidateV1, cancelInteractionRuntimeRunV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewFixture, chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const newPlan = '独自核对已经掌握的线索；玩家愿意重新参与前不再邀其查后门。'
function response(): ChatNarrativeActionV1 {
  return {kind: 'pause', text: '你先休息，我不再邀请你查后门。我会先核对已有线索，也先不认定有人借走铜印。',
    goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['player', 'guard'], waitingForPlayer: false,
    newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    nextPossibilities: [{text: newPlan, evidenceFactKeys: ['lost']}],
    beliefUpdates: [{beliefKey: 'borrowed', text: null, evidenceFactKeys: ['lost']}]}
}
function stateBefore() {
  const fixture = chatNarrativeFixture()
  fixture.chatNarrative!.initialSituation.possibilities.push({actorKey: 'artisan', text: '等天亮再检查倒树。', evidenceFactKeys: ['road']})
  fixture.chatNarrative!.initialSituation.beliefs.push({beliefKey: 'road-risk', actorKey: 'artisan', text: '猜测夜间修路比较危险。', evidenceFactKeys: ['road'], updatedSequence: 0})
  const state = createInitialInteractionState(fixture)
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  state.remainingDirectorBudget = 100
  state.messages.push({messageId: 'player:2', eventSequence: 2, role: 'player', speakerKey: 'player', audienceKeys: ['guard'], text: '我不想查后门，先休息。', replyToSequence: null, supersededBySequence: null})
  return requestChatNarrativeTriggerV1(state, {sequence: 3, kind: 'player-response', sourceEventSequence: 2, seed: null})
}
function apply(action = response(), state = stateBefore()) {
  return applyReviewedChatNarrativeActionV1(state, {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'reply', action, review: chatActionReviewFixture(action)})
}
function closureResponse(): ChatNarrativeActionV1 {
  return {...response(), kind: 'complete', text: '铜印已经找到。寻找就此结束。我也已澄清此前只是猜测，现在撤回。',
    audienceKeys: ['player', 'guard', 'artisan'], goalKey: 'clarify', goalStatus: 'fulfilled', nextPossibilities: [],
    newFacts: [{factKey: 'found', kind: 'observation', text: '铜印已经找到。', evidenceFactKeys: ['lost'], evidenceExcerpt: '铜印已经找到。'}],
    goalUpdates: [{goalKey: 'find-seal', status: 'fulfilled', evidenceFactKeys: ['found'], evidenceExcerpt: '寻找就此结束。'}],
    beliefUpdates: [{beliefKey: 'borrowed', text: null, evidenceFactKeys: ['found']}],
    threadUpdates: [{threadKey: 'investigate', status: 'resolved', evidenceExcerpt: '寻找就此结束。'}]}
}
function beforeClosure() {
  const state = stateBefore()
  state.chatNarrative!.situation.goals.push({...state.chatNarrative!.situation.goals[0], goalKey: 'clarify', desire: '澄清寻找结果'})
  return state
}
it('closes related own goals with their evidence while preserving another role unfinished goal', () => {
  const before = beforeClosure(), action = closureResponse(), after = apply(action, before)
  expect(after.chatNarrative!.situation.goals.filter(g => g.actorKey === 'guard').map(g => [g.status, g.updatedSequence])).toEqual([['fulfilled', 4], ['fulfilled', 4]])
  expect(after.chatNarrative!.situation.goals[1]).toEqual(before.chatNarrative!.situation.goals[1])
  expect(after.chatNarrative!.situation.beliefs.map(b => b.actorKey)).toEqual(['artisan'])
  expect(after.chatNarrative!.situation.possibilities.map(p => p.actorKey)).toEqual(['artisan'])
  expect(after.chatNarrative!.situation.threads[0].status).toBe('resolved')
  expect(before.chatNarrative!.situation.goals.every(g => g.status === 'active')).toBe(true)
  expect(() => applyChatNarrativeActionV1(before, {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'old', action})).toThrow('旧行动事件')
})
it.each([
  ['other role', (a: ChatNarrativeActionV1) => {a.goalUpdates![0].goalKey = 'fix-road'}],
  ['missing goal', a => {a.goalUpdates![0].goalKey = 'missing'}],
  ['primary duplicated', a => {a.goalUpdates![0].goalKey = 'clarify'}],
  ['duplicate update', a => {a.goalUpdates!.push({...a.goalUpdates![0]})}],
  ['unchanged status', a => {a.goalUpdates![0].status = 'active'}],
  ['unknown evidence', a => {a.goalUpdates![0].evidenceFactKeys = ['secret']}],
  ['no evidence', a => {a.goalUpdates![0].evidenceFactKeys = []}],
  ['invented excerpt', a => {a.goalUpdates![0].evidenceExcerpt = '这是没有说过的话'}],
  ['waiting on player', a => {a.kind = 'attempt'; a.waitingForPlayer = true; a.goalStatus = null; a.newFacts = []; a.threadUpdates = []; a.goalUpdates![0].evidenceFactKeys = ['lost']}],
  ['too many goals', a => {a.goalUpdates = Array.from({length: 5}, () => ({...a.goalUpdates![0]}))}],
] as const)('rejects invalid goal closure: %s', (_name, change) => {
  const before = beforeClosure(), saved = structuredClone(before), action = closureResponse()
  change(action); expect(() => apply(action, before)).toThrow(); expect(before).toEqual(saved)
})
it('never reopens a completed attached goal or leaves old plans after all own goals close', () => {
  const before = beforeClosure(); before.chatNarrative!.situation.goals[0].status = 'fulfilled'
  expect(() => apply({...closureResponse(), goalUpdates: [{...closureResponse().goalUpdates![0], status: 'active'}]}, before)).toThrow('已经结束')
  expect(() => apply({...closureResponse(), nextPossibilities: null}, beforeClosure())).toThrow('清空旧打算')
  const omitted = closureResponse(); delete omitted.nextPossibilities; delete omitted.beliefUpdates
  expect(() => apply(omitted, beforeClosure())).toThrow('清空旧打算')
})
it('updates only the acting role plans and withdraws its unsupported hypothesis, without turning either into facts', () => {
  const before = stateBefore(), after = apply(response(), before)
  expect(after.chatNarrative!.situation.facts).toEqual(before.chatNarrative!.situation.facts)
  expect(after.chatNarrative!.situation.possibilities).toEqual([
    before.chatNarrative!.situation.possibilities[1], {actorKey: 'guard', text: newPlan, evidenceFactKeys: ['lost']},
  ])
  expect(after.chatNarrative!.situation.beliefs).toEqual([before.chatNarrative!.situation.beliefs[1]])
  expect(before.chatNarrative!.situation.beliefs).toHaveLength(2)
  expect(after.remainingDirectorBudget).toBe(98)
  expect(interactionVisibilityView(after, 'guard').chatNarrative!.possibilities[0].text).toBe(newPlan)
  expect(interactionVisibilityView(after, 'artisan').chatNarrative!.possibilities[0].text).toBe('等天亮再检查倒树。')
  expect(interactionVisibilityView(after, 'player').chatNarrative!.possibilities).toEqual([])
  expect(parseInteractionState(after)).toEqual(after)
})
it('preserves omitted/null plans, clears them explicitly, and keeps old canonical actions/events unchanged', () => {
  const old = response(); delete old.nextPossibilities; delete old.beliefUpdates
  const before = stateBefore()
  expect(canonicalStringify(parseChatNarrativeActionV1(old))).toBe(canonicalStringify(old))
  const envelope = {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'old', action: old}
  expect(applyChatNarrativeActionV1(before, envelope).chatNarrative!.situation.possibilities).toEqual(before.chatNarrative!.situation.possibilities)
  expect(apply({...old, nextPossibilities: null}).chatNarrative!.situation.possibilities).toEqual(before.chatNarrative!.situation.possibilities)
  expect(apply({...old, nextPossibilities: []}).chatNarrative!.situation.possibilities.map(p => p.actorKey)).toEqual(['artisan'])
  expect(() => applyChatNarrativeActionV1(before, {...envelope, action: response()})).toThrow('旧行动事件')
  expect(() => applyReviewedChatNarrativeActionV1(before, {...envelope, action: response(), review: chatActionReviewFixture(old)})).toThrow('另一份候选')
})
it('allows a revised or new tentative belief supported by a fact completed in the same action', () => {
  const action: ChatNarrativeActionV1 = {...response(), kind: 'complete', text: '叶岑看了后门。后门闩没有撬痕。',
    newFacts: [{factKey: 'door', kind: 'observation', text: '后门闩没有撬痕。', evidenceFactKeys: ['lost'], evidenceExcerpt: '后门闩没有撬痕。'}],
    nextPossibilities: [{text: '可以先核对室内线索。', evidenceFactKeys: ['door']}],
    beliefUpdates: [{beliefKey: 'borrowed', text: '暂不能判断铜印是借走还是放错。', evidenceFactKeys: ['door', 'lost']},
      {beliefKey: 'door-route', text: '猜测可能无需撬门也能进入，尚未核实。', evidenceFactKeys: ['door']}]}
  const after = apply(action)
  expect(after.chatNarrative!.situation.beliefs.filter(b => b.actorKey === 'guard')).toMatchObject([
    {beliefKey: 'borrowed', updatedSequence: 4}, {beliefKey: 'door-route', updatedSequence: 4},
  ])
  expect(after.chatNarrative!.situation.facts.some(f => f.text.includes('暂不能判断'))).toBe(false)
})
it.each([
  ['another role belief', (a: ChatNarrativeActionV1) => {a.beliefUpdates![0].beliefKey = 'road-risk'}],
  ['player plan owner', a => {Object.assign(a.nextPossibilities![0], {actorKey: 'player'})}],
  ['forged belief provenance', a => {Object.assign(a.beliefUpdates![0], {updatedSequence: 1})}],
  ['unknown plan evidence', a => {a.nextPossibilities![0].evidenceFactKeys = ['unknown']}],
  ['secret plan evidence', a => {a.nextPossibilities![0].evidenceFactKeys = ['secret']}],
  ['secret belief evidence', a => {a.beliefUpdates![0].evidenceFactKeys = ['secret']}],
  ['empty evidence', a => {a.beliefUpdates![0].evidenceFactKeys = []}],
  ['nonexistent withdrawal', a => {a.beliefUpdates![0].beliefKey = 'never-created'}],
  ['duplicate belief edit', a => {a.beliefUpdates!.push({...a.beliefUpdates![0]})}],
  ['duplicate plan', a => {a.nextPossibilities!.push({...a.nextPossibilities![0]})}],
  ['too many plans', a => {a.nextPossibilities = Array.from({length: 4}, (_, i) => ({text: `方向 ${i}`, evidenceFactKeys: ['lost']}))}],
  ['unchanged belief', a => {a.beliefUpdates![0].text = '猜测铜印可能被某人借用，还未求证。'}],
] as const)('rejects %s atomically', (_name, change) => {
  const state = stateBefore(), saved = structuredClone(state), action = response()
  change(action); expect(() => apply(action, state)).toThrow(); expect(state).toEqual(saved)
})
it('keeps the global hypothesis limit and closes old plans when all goals are concluded', () => {
  const state = stateBefore()
  state.chatNarrative!.situation.beliefs = Array.from({length: 64}, (_, i) => ({beliefKey: `belief:${i}`, actorKey: 'guard', text: `猜测 ${i}`, evidenceFactKeys: ['lost'], updatedSequence: 0}))
  expect(() => apply({...response(), beliefUpdates: [{beliefKey: 'one-too-many', text: '另一个猜测', evidenceFactKeys: ['lost']}]}, state)).toThrow('猜测')
  expect(() => apply({...response(), goalStatus: 'abandoned', nextPossibilities: null})).toThrow('清空旧打算')
  const closed = apply({...response(), goalStatus: 'abandoned', nextPossibilities: []})
  expect(closed.chatNarrative!.situation.goals[0].status).toBe('abandoned')
  expect(closed.chatNarrative!.situation.possibilities.every(p => p.actorKey !== 'guard')).toBe(true)
})

describe('durable role reflection', () => {
  beforeEach(async () => {db.close(); await db.delete(); await db.open()})
  afterEach(() => db.close())
  async function prepared(additionalGuardGoal = false, publicConversation = false) {
    const f = await seedChatNarrativeRuntimeFixture({additionalGuardGoal})
    const envelope = async (commandId: string) => {const v = await readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId, baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const player = await commitInteractionPlayerMessage({...await envelope('player'), messageId: 'player', text: '我不想查后门，先休息。', audienceKeys: publicConversation ? null : ['guard']})
    await requestChatNarrativeTrigger({...await envelope('trigger'), kind: 'player-response', sourceEventSequence: player.sequence})
    return {...f, envelope}
  }
  it('recovers and adopts the whole closure once, with goal provenance intact through branch/export/import', async () => {
    const f = await prepared(true, true), action = closureResponse(); let runId = 0
    await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '收束相关目标',
      runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), onNarrativeActionSaved: id => {runId = id; throw new Error('host-crash')}})).rejects.toThrow('host-crash')
    db.close(); await db.open()
    await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
    const adopted = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
    const saved = (await readProductRuntimeState(f.sessionId)).interaction!
    expect(saved.messages.filter(m => m.role === 'character')).toHaveLength(1)
    expect(saved.messages.find(m => m.role === 'player')).toMatchObject({playerConversation: 'present', audienceKeys: ['player', 'guard', 'artisan']})
    expect(saved.chatNarrative!.situation.goals.filter(g => g.actorKey === 'guard').every(g => g.status === 'fulfilled' && g.updatedSequence === adopted.event!.sequence)).toBe(true)
    const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: adopted.event!.sequence, title: '目标收束'})
    const expected = (await readProductRuntimeState(branch.id!)).interaction!.chatNarrative!
    expect(expected.situation.goals.filter(g => g.actorKey === 'guard').every(g => g.updatedSequence === -1)).toBe(true)
    const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(s => s.title === '目标收束')!
    expect((await readProductRuntimeState(restored.id!)).interaction!.chatNarrative).toEqual(expected)
  })
  it('recovers a saved reflection candidate, adopts once, and preserves private plans and belief provenance through nested branches/import', async () => {
    const f = await prepared(); let runId = 0, reviewCalls = 0
    const action = {...response(), beliefUpdates: [{beliefKey: 'borrowed', text: '目前只知失踪，不再先认定被借走。', evidenceFactKeys: ['lost']}]}
    await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '承接拒绝',
      runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), onNarrativeActionSaved: id => {runId = id; throw new Error('host-crash')}})).rejects.toThrow('host-crash')
    expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.possibilities[0].text).not.toBe(newPlan)
    db.close(); await db.open()
    await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
      reviewCalls++; expect(messages.map(m => m.content).join('\n')).toContain('"nextPossibilities"'); return JSON.stringify(chatActionReviewOutputFixture())
    }})
    const adopted = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
    expect(reviewCalls).toBe(1)
    const saved = (await readProductRuntimeState(f.sessionId)).interaction!
    expect(saved.messages.filter(m => m.role === 'character')).toHaveLength(1)
    expect(saved.chatNarrative!.situation.possibilities[0].text).toBe(newPlan)
    const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: adopted.event!.sequence, title: '更新打算'})
    const nested = await branchProductRuntimeSession({parentSessionId: branch.id!, throughSequence: 0, title: '再次分支'})
    const expected = (await readProductRuntimeState(nested.id!)).interaction!.chatNarrative!
    expect(expected.situation.beliefs[0].updatedSequence).toBe(-2)
    const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(s => s.title === '再次分支')!
    expect((await readProductRuntimeState(restored.id!)).interaction!.chatNarrative).toEqual(expected)
    const next = await f.envelope('continue'); await requestChatNarrativeTrigger({...next, kind: 'continue', sourceEventSequence: next.baseSequence})
    await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '承接已改变的打算',
      runAI: withChatActionChoiceFixture(async messages => {
        const prompt = messages.map(m => m.content).join('\n')
        expect(prompt).toContain(newPlan); expect(prompt).toContain('目前只知失踪，不再先认定被借走。')
        expect(prompt).not.toContain('可以建议查看后门，也可以先一起处理山路。'); expect(prompt).not.toContain('柜台下')
        return JSON.stringify({...response(), nextPossibilities: null, beliefUpdates: []})
      }), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  })
  it.each(['semantic-rejection', 'cancel', 'player-input'] as const)('does not change plans or hypotheses after %s', async mode => {
    const f = await prepared(), original = (await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation
    const review = chatActionReviewOutputFixture()
    if (mode === 'semantic-rejection') review.checks.find(c => c.check === 'continuity')!.passed = false
    let runId = 0
    await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '不采纳反例',
      onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => JSON.stringify(response())), runReviewAI: async () => {
        if (mode === 'cancel') await cancelInteractionRuntimeRunV1({scope: f.scope, runId})
        if (mode === 'player-input') await commitInteractionPlayerMessage({...await f.envelope('new-player'), messageId: 'new-player', text: '先停一下。'})
        return JSON.stringify(review)
      }})).rejects.toThrow()
    const after = (await readProductRuntimeState(f.sessionId)).interaction!
    expect(after.chatNarrative!.situation).toEqual(original)
    expect(after.messages.filter(m => m.role === 'character')).toEqual([])
  })
})
