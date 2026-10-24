import {expect, it} from 'vitest'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {buildInteractionContextWindow, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {applyReviewedChatControlHandoffV1, assertChatControlHandoffContextV1, CHAT_CONTROL_HANDOFF_REVIEW_CHECKS_V1,
  parseChatControlHandoffReviewV1, parseChatControlHandoffV1, previewChatControlHandoffV1, readChatControlHandoffBasisV1} from '../../src/lib/character-interaction/control-handoff-contract'
import {assertChatControlHandoffBindingsV1, chatNarrativeOutcomeSchemaV1, parseChatNarrativeOutcomeWireV1} from '../../src/lib/character-interaction/control-handoff-wire'
import {CHAT_TURN_END_CONTROL_CHECKS_V1} from '../../src/lib/character-interaction/turn-end-control'
import {validateImportedChatNarrativeEvidenceEventV1, validateImportedChatNarrativeEvidenceStateV1} from '../../src/lib/character-interaction/narrative-evidence-import'
import {chatTurnEndControlFixture} from '../helpers/chat-turn-end-control'

it('ends only the current turn without another bubble, action, goal pause or story consequence', () => {
  const {state, input} = chatTurnEndControlFixture(), before = structuredClone(state)
  assertChatControlHandoffContextV1(input.handoff, buildInteractionContextWindow(state, 'guard'))
  const result = applyReviewedChatControlHandoffV1(state, input)
  expect(result.chatNarrative!.triggers.slice(-1)[0]).toMatchObject({status: 'complete', actionSequences: [3], controlHandoff: {version: 2, sequence: 4, sourceSequence: 3}})
  expect(result.remainingDirectorBudget).toBe(before.remainingDirectorBudget - 3)
  const normalized = structuredClone(result)
  normalized.remainingDirectorBudget = before.remainingDirectorBudget
  normalized.chatNarrative!.revision = before.chatNarrative!.revision
  normalized.chatNarrative!.lastEventSequence = before.chatNarrative!.lastEventSequence
  normalized.chatNarrative!.triggers.slice(-1)[0]!.status = 'ready'; delete normalized.chatNarrative!.triggers.slice(-1)[0]!.controlHandoff
  expect(normalized).toEqual(before); expect(state).toEqual(before)
  expect(parseInteractionState(JSON.parse(JSON.stringify(result)))).toEqual(result)
  expect(() => applyReviewedChatControlHandoffV1(result, {...input, sequence: 5})).toThrow('可运行轮次')
})

it('preserves completed control through nested branches and refuses borrowing it for the next continue', () => {
  const {state, input} = chatTurnEndControlFixture(), accepted = applyReviewedChatControlHandoffV1(state, input)
  const branch = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(accepted, 4), 0)
  expect(branch.chatNarrative!.triggers.slice(-1)[0]!.controlHandoff).toMatchObject({version: 2, sequence: -2, sourceSequence: -3})
  expect(parseInteractionState(JSON.parse(JSON.stringify(branch)))).toEqual(branch)
  expect(() => validateImportedChatNarrativeEvidenceStateV1(JSON.stringify({interaction: branch}), 'character-interaction')).not.toThrow()
  expect(buildInteractionContextWindow(branch, 'guard').chatNarrative!.trigger).not.toHaveProperty('controlHandoff')
  const next = requestChatNarrativeTriggerV1(accepted, {sequence: 5, kind: 'continue', sourceEventSequence: 4, seed: null})
  expect(next.chatNarrative!.triggers.slice(-2)[0]!.status).toBe('complete')
  expect(next.chatNarrative!.situation.goals).toEqual(state.chatNarrative!.situation.goals)
  expect(() => previewChatControlHandoffV1(next, {...input, sequence: 6, triggerSequence: 5})).toThrow('当前场景和轮次')
})

it.each([
  ['no adopted action', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.chatNarrative!.triggers.slice(-1)[0]!.actionSequences = []}],
  ['latest action differs', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.chatNarrative!.triggers.slice(-1)[0]!.actionSequences = [2.5]}],
  ['waiting player', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.chatNarrative!.triggers.slice(-1)[0]!.status = 'waiting-player'}],
  ['pending situation', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.chatNarrative!.pendingSituation = {} as never}],
  ['pending edit', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.chatNarrative!.pendingEdit = {} as never}],
  ['ensemble', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.chatNarrative!.triggers.slice(-1)[0]!.direction!.scheduling = {} as never}],
  ['budget', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.remainingDirectorBudget = 2}],
  ['superseded', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.messages[0].supersededBySequence = 4}],
  ['excluded', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.chatNarrative!.excludedMessageIds = [s.messages[0].messageId]}],
  ['private source', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.messages[0].audienceKeys = ['guard']}],
  ['different speaker', (s: ReturnType<typeof chatTurnEndControlFixture>['state']) => {s.messages[0].speakerKey = 'artisan'}],
] as const)('rejects %s without changing state', (_name, mutate) => {
  const {state, input} = chatTurnEndControlFixture(); mutate(state); const before = structuredClone(state)
  expect(() => previewChatControlHandoffV1(state, input)).toThrow(); expect(state).toEqual(before)
})

it('keeps the triggering player message in review and rejects a later unanswered or excluded player request', () => {
  const {state, input} = chatTurnEndControlFixture()
  state.chatNarrative!.triggers.slice(-1)[0]!.kind = 'player-response'
  const source = state.messages[0]
  state.messages.unshift({...source, role: 'player', speakerKey: 'player', messageId: 'request', eventSequence: 1, text: '请先把已知线索整理一下。'})
  expect(readChatControlHandoffBasisV1(state, 'guard', input.handoff).map(m => m.messageId)).toEqual(['request', source.messageId])
  expect(previewChatControlHandoffV1(state, input).chatNarrative!.triggers.slice(-1)[0]!.status).toBe('complete')
  state.chatNarrative!.excludedMessageIds = ['request']
  expect(() => previewChatControlHandoffV1(state, input)).toThrow('对话已被排除')
  state.chatNarrative!.excludedMessageIds = []
  state.messages.push({...state.messages[0], messageId: 'new-request', eventSequence: 4, text: '再解释一下第二条线索。'})
  expect(() => previewChatControlHandoffV1(state, {...input, sequence: 5})).toThrow('新的玩家消息')
})

it.each(CHAT_TURN_END_CONTROL_CHECKS_V1)('refuses a failed %s review and the older decision-only review', check => {
  const {state, input} = chatTurnEndControlFixture(), before = structuredClone(state)
  input.review.checks.find(c => c.check === check)!.passed = false
  expect(() => applyReviewedChatControlHandoffV1(state, input)).toThrow('审查未通过'); expect(state).toEqual(before)
  expect(() => parseChatControlHandoffReviewV1({...input.review, checks: CHAT_CONTROL_HANDOFF_REVIEW_CHECKS_V1.map(c => ({check: c, passed: true, reason: 'old'}))}, input.handoff)).toThrow()
})

it('rejects forged imported marker status, source and review while preserving legitimate v2 events', () => {
  const {state, input} = chatTurnEndControlFixture(), accepted = applyReviewedChatControlHandoffV1(state, input)
  for (const patch of [{status: 'waiting-player'}, {actionSequences: []}, {actionSequences: [2]}]) {
    const changed = structuredClone(accepted); Object.assign(changed.chatNarrative!.triggers.slice(-1)[0]!, patch)
    expect(() => parseInteractionState(changed)).toThrow()
  }
  const body = {actorKey: 'guard', baseSequence: 3, baseStateHash: 'a'.repeat(64), commandId: 'control', triggerSequence: 2, handoff: input.handoff, review: input.review}
  expect(() => validateImportedChatNarrativeEvidenceEventV1(JSON.stringify(body), 'character-interaction', 'interaction.narrative.control-handoff.committed')).not.toThrow()
  expect(() => validateImportedChatNarrativeEvidenceEventV1(JSON.stringify(body), 'ai-town', 'interaction.narrative.control-handoff.committed')).toThrow()
  body.review.checks[0].passed = false
  expect(() => validateImportedChatNarrativeEvidenceEventV1(JSON.stringify(body), 'character-interaction', 'interaction.narrative.control-handoff.committed')).toThrow()
})

it('requires the exact new producer/reviewer pair and rejects v2 under old wire contracts', () => {
  const {handoff} = chatTurnEndControlFixture(), wire = {outcome: 'handoff', action: null, handoff}
  expect(parseChatNarrativeOutcomeWireV1(wire, 'chat-narrative-action-v57')).toEqual({outcome: 'handoff', handoff})
  for (const version of [undefined, 'chat-narrative-action-v56', 'chat-narrative-options-v35'])
    expect(() => parseChatNarrativeOutcomeWireV1(wire, version)).toThrow('旧生成合同')
  const recipe = (producer: string, reviewer: string) => ({budget: {maxModelCalls: 3, maxAttemptsPerStep: 1}, executionBindings: [
    {stepId: 'interaction:action-choice', skillId: 'character.chat-narrative-action', promptVersion: producer},
    {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-narrative-action', promptVersion: producer},
    {stepId: 'interaction:action-review', skillId: 'character.chat-narrative-action-review', promptVersion: reviewer},
  ]})
  expect(() => assertChatControlHandoffBindingsV1(recipe('chat-narrative-action-v57', 'chat-narrative-action-review-v36'), handoff)).not.toThrow()
  for (const [p, r] of [['chat-narrative-action-v56', 'chat-narrative-action-review-v35'], ['chat-narrative-action-v57', 'chat-narrative-action-review-v35']])
    expect(() => assertChatControlHandoffBindingsV1(recipe(p, r), handoff)).toThrow()
  expect(JSON.stringify(chatNarrativeOutcomeSchemaV1({}, 'chat-narrative-action-v56'))).not.toContain('finish-current-turn')
  expect(JSON.stringify(chatNarrativeOutcomeSchemaV1({}, 'chat-narrative-action-v57'))).toContain('finish-current-turn')
  expect(canonicalStringify(parseChatControlHandoffV1(handoff))).toBe(canonicalStringify(handoff))
  for (const patch of [{purpose: ''}, {purpose: ' '}, {version: 3}, {goalStatus: 'paused'}])
    expect(() => parseChatControlHandoffV1({...handoff, ...patch})).toThrow()
})
