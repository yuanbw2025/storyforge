import {describe, expect, it} from 'vitest'
import type {CharacterInteractionRuntimeState} from '../../src/lib/types'
import type {ChatCommitmentEffectV1, ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import {applyChatCommitmentEffectsV1, CHAT_GOAL_COMMITMENT_LIMIT_V1, chatVisibleCommitmentsV1, parseChatCommitmentEffectsV1} from '../../src/lib/character-interaction/narrative-commitments'
import {createInitialInteractionState, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'

// State-contract fixtures only. No model, formal action commit or UI is enabled.
const terms = '我答应今晚把寻找铜印的结果告诉你。'
function opening() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(state, {sequence: 2, kind: 'scene-start', sourceEventSequence: 1, seed: null})
}
function action(text = terms): ChatNarrativeActionV1 {
  return {kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
}
function input(state: CharacterInteractionRuntimeState, overrides: Partial<Parameters<typeof applyChatCommitmentEffectsV1>[1]> = {}) {
  const sequence = Math.max(state.chatNarrative!.lastEventSequence + 1, 1)
  return {actorKey: 'guard', sequence, messageId: `commitment-message:${sequence}`, action: action(), effects: [{kind: 'promise', terms, evidenceExcerpt: terms}], ...overrides}
}
/** Emulates the later committing action's source append, not a production API. */
function persistFixture(state: CharacterInteractionRuntimeState, value: ReturnType<typeof input>) {
  applyChatCommitmentEffectsV1(state, value)
  state.messages.push({messageId: value.messageId, eventSequence: value.sequence, role: 'character', speakerKey: value.actorKey,
    text: value.action.text, audienceKeys: [...value.action.audienceKeys], replyToSequence: null, supersededBySequence: null})
  state.chatNarrative!.lastEventSequence = value.sequence
  state.chatNarrative!.revision++
  return parseInteractionState(JSON.parse(JSON.stringify(state)))!
}
function promised() {const state = opening(); return persistFixture(state, input(state))}
function promise(state: CharacterInteractionRuntimeState) {return state.chatNarrative!.situation.goals[0].commitments![0]}
function resolution(state: CharacterInteractionRuntimeState, kind: 'fulfill' | 'withdraw' = 'fulfill') {
  const text = kind === 'fulfill' ? '我把沿途寻找的结果逐一告诉你：铜印还未找到，后门也没有线索。' : '我撤回今晚报告的承诺，眼下无法守约。'
  const target = state.chatNarrative!.situation.goals[0].commitments!.find(c => c.resolution === null) ?? promise(state)
  return input(state, {action: {...action(text), kind: kind === 'fulfill' ? 'complete' : 'speak'},
    effects: [{kind, commitmentKey: target.commitmentKey, evidenceExcerpt: text}]})
}

describe('goal-owned commitment foundation, not model acceptance', () => {
  it('preserves old bytes and rejects invented promises in frozen initial content', () => {
    const old = createInitialInteractionState(chatNarrativeFixture())
    expect(JSON.stringify(parseInteractionState(old))).toBe(JSON.stringify(old))
    expect(JSON.stringify(old)).not.toContain('commitments')
    const frozen = chatNarrativeFixture()
    frozen.chatNarrative!.initialSituation.goals[0].commitments = []
    expect(() => createInitialInteractionState(frozen)).toThrow('初始背景')
    frozen.chatNarrative!.initialSituation.goals[0].commitments = [promise(promised())]
    expect(() => createInitialInteractionState(frozen)).toThrow('初始背景')
  })

  it('binds the actual own expression without exposing private goals or assigning player consent', () => {
    const state = promised(), record = promise(state)
    expect(record).toMatchObject({commitmentKey: 'commitment-message:3:promise', terms, audienceKeys: ['guard', 'player'],
      declared: {messageId: 'commitment-message:3', sequence: 3, excerpt: terms}, resolution: null})
    const publicView = chatVisibleCommitmentsV1(state, 'player')
    expect(publicView).toEqual([{actorKey: 'guard', ...record}])
    expect(JSON.stringify(publicView)).not.toMatch(/goalKey|concern|boundary|担心再次错怪人|regret/)
    expect(chatVisibleCommitmentsV1(state, 'artisan')).toEqual([])
    publicView[0].terms = 'view mutation'
    expect(record.terms).toBe(terms)
    expect(state.chatNarrative!.persona).toEqual(opening().chatNarrative!.persona)
    expect(state.relationships).toEqual(opening().relationships)
    expect(state.chatNarrative!.situation.goals[1]).toEqual(opening().chatNarrative!.situation.goals[1])
  })

  it('cannot infer a declaration from a summary or write through the legacy unreviewed action', () => {
    const state = opening()
    state.memories.push({memoryId: 'summary', participantKey: 'guard', kind: 'commitment', summary: terms, importance: 100,
      sourceEventSequences: [], status: 'accepted', proposalSequence: 2, decisionSequence: 2})
    expect(chatVisibleCommitmentsV1(state, 'player')).toEqual([])
    expect(() => applyChatNarrativeActionV1(state, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'legacy',
      action: {...action(), commitmentEffects: input(state).effects}})).toThrow('旧行动事件不可采用')
    const reviewSpoof = {...input(state).effects[0], reviewed: true, commitmentKey: 'forged'}
    expect(() => parseChatCommitmentEffectsV1([reviewSpoof])).toThrow('字段')
  })

  it('fulfills an actual earlier promise without automatically completing its larger goal', () => {
    const state = promised(), before = structuredClone(state), value = resolution(state)
    const done = persistFixture(state, value)
    expect(promise(done).declared).toEqual(promise(before).declared)
    expect(promise(done).resolution).toEqual({kind: 'fulfilled', messageId: value.messageId, sequence: value.sequence, excerpt: value.action.text})
    expect(done.chatNarrative!.situation.goals[0].status).toBe('active')
    expect(done.relationships).toEqual(before.relationships)
    expect(done.chatNarrative!.situation.facts).toEqual(before.chatNarrative!.situation.facts)
    expect(() => applyChatCommitmentEffectsV1(done, resolution(done))).toThrow('已处理')
  })

  it.each(['fulfilled', 'abandoned'] as const)('requires explicit resolution before a goal becomes %s', status => {
    const state = promised()
    state.chatNarrative!.situation.goals[0].status = status
    const before = JSON.stringify(state)
    expect(() => applyChatCommitmentEffectsV1(state, input(state, {effects: []}))).toThrow('目标结束前')
    expect(() => parseInteractionState(state)).toThrow('目标结束前')
    expect(JSON.stringify(state)).toBe(before)
    const done = persistFixture(state, resolution(state, status === 'fulfilled' ? 'fulfill' : 'withdraw'))
    expect(done.chatNarrative!.situation.goals[0].status).toBe(status)
  })

  it('records a changed offer only after withdrawal and retains both exact versions', () => {
    const state = promised(), old = structuredClone(promise(state)), nextTerms = '我改为明晨在驿站门口报告结果，你不必答应等我。'
    const withdrawal = resolution(state, 'withdraw'), replacement = {kind: 'promise', terms: nextTerms, evidenceExcerpt: nextTerms}
    const value = {...withdrawal, action: action(`${withdrawal.action.text}${nextTerms}`), effects: [replacement, ...withdrawal.effects]}
    const done = persistFixture(state, value), history = done.chatNarrative!.situation.goals[0].commitments!
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({...old, resolution: {kind: 'withdrawn', sequence: 4}})
    expect(history[1]).toMatchObject({terms: nextTerms, declared: {sequence: 4}, resolution: null})
    expect(done.chatNarrative!.persona).toEqual(state.chatNarrative!.persona)
    expect(done.relationshipHistory).toEqual([])
  })

  it.each([
    ['waiting', (i: ReturnType<typeof input>) => {i.action.waitingForPlayer = true}],
    ['attempt', i => {i.action.kind = 'attempt'}],
    ['pause', i => {i.action.kind = 'pause'}],
    ['speech is not fulfillment', i => {i.action.kind = 'speak'}],
    ['other actor', i => {i.actorKey = 'artisan'; i.action.audienceKeys.push('artisan')}],
    ['outside audience', i => {i.action.audienceKeys.push('outside')}],
    ['no actual excerpt', i => {i.action.text = '只是随便聊聊'}],
    ['stale event', i => {i.sequence = 2}],
    ['negative new event', i => {i.sequence = -1}],
    ['reused message', i => {i.messageId = 'commitment-message:3'}],
    ['unrelated goal', i => {i.action.goalKey = 'fix-road'}],
  ] as const)('rejects %s atomically', (_name, mutate) => {
    const state = promised(), before = JSON.stringify(state), value = resolution(state)
    mutate(value)
    expect(() => applyChatCommitmentEffectsV1(state, value)).toThrow()
    expect(JSON.stringify(state)).toBe(before)
  })

  it('refuses audience loss and duplicate processing, and rolls back mixed valid/invalid effects', () => {
    const state = opening(), publicDeclaration = input(state)
    publicDeclaration.action.audienceKeys.push('artisan')
    const made = persistFixture(state, publicDeclaration), value = resolution(made)
    expect(() => applyChatCommitmentEffectsV1(made, value)).toThrow('原知情范围')
    value.action.audienceKeys.push('artisan')
    const before = JSON.stringify(made)
    value.effects.push({...value.effects[0]})
    expect(() => applyChatCommitmentEffectsV1(made, value)).toThrow('已处理或重复')
    expect(JSON.stringify(made)).toBe(before)
    value.effects[1] = {kind: 'withdraw', commitmentKey: 'missing', evidenceExcerpt: value.action.text}
    expect(() => applyChatCommitmentEffectsV1(made, value)).toThrow()
    expect(JSON.stringify(made)).toBe(before)
  })

  it('refuses silent replacement, terminal-goal promises and overflow without pruning history', () => {
    const state = promised()
    expect(() => applyChatCommitmentEffectsV1(state, input(state))).toThrow('原承诺未处理')
    let growing = persistFixture(state, resolution(state, 'withdraw'))
    for (let i = 1; i < 17; i++) {
      growing = persistFixture(growing, input(growing))
      growing = persistFixture(growing, resolution(growing, 'withdraw'))
    }
    expect(growing.chatNarrative!.situation.goals[0].commitments).toHaveLength(17)
    // The former 16-record ceiling is crossed through the actual effects.
    // Fill the remaining source-bound rows directly to test the hard bound
    // without quadratically replaying 2048 fixture-only parse operations.
    const goal = growing.chatNarrative!.situation.goals[0]
    while (goal.commitments!.length < CHAT_GOAL_COMMITMENT_LIMIT_V1) {
      const original = goal.commitments![0], sequence = growing.chatNarrative!.lastEventSequence + 1
      const declared = {messageId: `capacity-declared-${sequence}`, sequence, excerpt: original.declared.excerpt}
      const resolution = {...original.resolution!, messageId: `capacity-resolved-${sequence}`, sequence: sequence + 1}
      goal.commitments!.push({...original, commitmentKey: `${declared.messageId}:promise`, declared, resolution})
      for (const source of [declared, resolution]) growing.messages.push({messageId: source.messageId, eventSequence: source.sequence, role: 'character', speakerKey: 'guard', audienceKeys: ['guard', 'player'], text: source.excerpt, replyToSequence: null, supersededBySequence: null})
      goal.updatedSequence = resolution.sequence; growing.chatNarrative!.lastEventSequence = resolution.sequence
    }
    growing = parseInteractionState(growing)!
    const before = JSON.stringify(growing)
    expect(() => applyChatCommitmentEffectsV1(growing, input(growing))).toThrow('容量')
    expect(JSON.stringify(growing)).toBe(before)
    growing.chatNarrative!.situation.goals[0].status = 'abandoned'
    expect(() => applyChatCommitmentEffectsV1(growing, input(growing))).toThrow('未完成目标')
  })

  it.each([
    ['missing', (s: CharacterInteractionRuntimeState) => {s.messages = []}],
    ['different text', s => {s.messages[0].text = '我没有作出承诺。'}],
    ['other speaker', s => {s.messages[0].speakerKey = 'artisan'}],
    ['player declaration', s => {s.messages[0].role = 'player'}],
    ['replaced', s => {s.messages[0].supersededBySequence = 4}],
    ['narrowed declaration', s => {promise(s).audienceKeys.push('artisan')}],
    ['different sequence', s => {promise(s).declared.sequence = 2}],
    ['future event', s => {promise(s).declared.sequence = 4}],
    ['forged identity', s => {promise(s).commitmentKey = 'someone:promise'}],
    ['other terms', s => {promise(s).terms = '另一份约定'}],
  ] as const)('rejects %s provenance when loading', (_name, mutate) => {
    const state = promised(); mutate(state)
    expect(() => parseInteractionState(state)).toThrow()
  })

  it('carries exact source identities and rebases all evidence on nested branches', () => {
    const parent = promised(), original = JSON.stringify(parent), first = rebaseInteractionStateForBranch(parent, 3)
    expect(promise(first).declared.sequence).toBe(-1)
    expect(promise(first).declared.messageId).toBe(promise(parent).declared.messageId)
    const resolved = persistFixture(first, resolution(first)), second = rebaseInteractionStateForBranch(resolved, 1)
    expect(promise(second).declared.sequence).toBe(-3)
    expect(promise(second).resolution?.sequence).toBe(-1)
    expect(second.messages.map(m => m.eventSequence)).toEqual([-3, -1])
    expect(parseInteractionState(JSON.parse(JSON.stringify(second)))).toEqual(second)
    expect(chatVisibleCommitmentsV1(second, 'player')[0].resolution?.kind).toBe('fulfilled')
    expect(JSON.stringify(parent)).toBe(original)
    expect(() => rebaseInteractionStateForBranch(parent, 2)).toThrow('目标序号之后')
    second.messages[1].text = '没有交代结果'
    expect(() => parseInteractionState(second)).toThrow('消息依据')
  })

  it('rejects overlapping or reordered histories and source-free resolutions on restore', () => {
    let state = promised()
    state = persistFixture(state, resolution(state, 'withdraw'))
    state = persistFixture(state, input(state))
    const reversed = structuredClone(state)
    reversed.chatNarrative!.situation.goals[0].commitments!.reverse()
    expect(() => parseInteractionState(reversed)).toThrow('真实事件排列')
    const overlap = structuredClone(state)
    overlap.chatNarrative!.situation.goals[0].commitments![1].declared.sequence = 3
    expect(() => parseInteractionState(overlap)).toThrow('真实事件排列')
    const beforeDeclaration = structuredClone(state)
    promise(beforeDeclaration).resolution!.sequence = 3
    expect(() => parseInteractionState(beforeDeclaration)).toThrow('晚于原表达')
    state.messages.splice(1, 1)
    expect(() => parseInteractionState(state)).toThrow('消息依据')
  })

  it('rejects assigning one message promise to two goals and preserves history across scene boundaries', () => {
    const state = promised(), before = structuredClone(promise(state))
    state.sceneHistory.push({...state.activeScene!, status: 'ended', endedAtSequence: 4})
    state.activeScene = null
    expect(chatVisibleCommitmentsV1(parseInteractionState(state)!, 'player')[0].terms).toBe(terms)
    state.activeScene = {...opening().activeScene!, sceneId: 'inn.return', startedAtSequence: 5}
    expect(promise(parseInteractionState(state)!)).toEqual(before)
    const extra = structuredClone(state.chatNarrative!.situation.goals[0])
    extra.goalKey = 'another-goal'
    state.chatNarrative!.situation.goals.push(extra)
    expect(() => parseInteractionState(state)).toThrow('不能共用')
  })

  it('bounds effect shapes and rejects synthetic source fields', () => {
    const valid: ChatCommitmentEffectV1 = {kind: 'promise', terms, evidenceExcerpt: terms}
    expect(parseChatCommitmentEffectsV1([valid])).toEqual([valid])
    for (const effects of [[valid, valid], Array(5).fill(valid), [{...valid, sequence: 3}], [{...valid, terms: '并未说出口'}],
      [{kind: 'agree', commitmentKey: 'a', evidenceExcerpt: terms}], null]) {
      expect(() => parseChatCommitmentEffectsV1(effects)).toThrow()
    }
  })
})
