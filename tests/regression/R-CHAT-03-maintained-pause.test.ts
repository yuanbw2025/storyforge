import {expect, it} from 'vitest'
import Ajv from 'ajv'
import {chatActionRequestOptionsV1} from '../../src/lib/character-interaction/action-output-contract'
import {applyReviewedChatControlHandoffV1, assertChatControlHandoffContextV1, parseChatControlHandoffReviewV1, previewChatControlHandoffV1} from '../../src/lib/character-interaction/control-handoff-contract'
import {assertChatControlHandoffBindingsV1, chatNarrativeOutcomeSchemaV1, parseChatNarrativeOutcomeWireV1} from '../../src/lib/character-interaction/control-handoff-wire'
import {CHAT_MAINTAINED_PAUSE_CHECKS_V1, parseChatMaintainedPauseControlV1} from '../../src/lib/character-interaction/maintained-pause-control'
import {buildInteractionContextWindow, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {validateImportedChatNarrativeEvidenceEventV1, validateImportedChatNarrativeEvidenceStateV1} from '../../src/lib/character-interaction/narrative-evidence-import'
import {chatCoordinatorAudienceVersionV1} from '../../src/lib/character-interaction/coordinator-audience'
import {chatActionReviewFixture} from '../helpers/chat-narrative-fixture'
import {maintainedPauseFixture, maintainedPauseAction} from '../helpers/chat-maintained-pause'

it.each(['continue', 'return'] as const)('keeps an adopted pause on %s without dialogue, progress or story changes', kind => {
  const {state, input} = maintainedPauseFixture(kind), before = structuredClone(state)
  assertChatControlHandoffContextV1(input.handoff, buildInteractionContextWindow(state, 'guard'))
  const result = applyReviewedChatControlHandoffV1(state, input), trigger = result.chatNarrative!.triggers.at(-1)!
  expect(trigger).toMatchObject({status: 'complete', actionSequences: [], controlHandoff: {version: 3, sourceSequence: 4}})
  const normalized = structuredClone(result)
  normalized.remainingDirectorBudget = before.remainingDirectorBudget
  normalized.chatNarrative!.revision = before.chatNarrative!.revision
  normalized.chatNarrative!.lastEventSequence = before.chatNarrative!.lastEventSequence
  normalized.chatNarrative!.triggers.at(-1)!.status = 'ready'; delete normalized.chatNarrative!.triggers.at(-1)!.controlHandoff
  expect(normalized).toEqual(before); expect(state).toEqual(before)
  expect(result.remainingDirectorBudget).toBe(before.remainingDirectorBudget - 3)
  expect(parseInteractionState(JSON.parse(JSON.stringify(result)))).toEqual(result)
  const branch = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(result, 6), 0)
  expect(parseInteractionState(branch)).toEqual(branch)
  expect(() => validateImportedChatNarrativeEvidenceStateV1(JSON.stringify({interaction: branch}), 'character-interaction')).not.toThrow()
  expect(buildInteractionContextWindow(branch, 'guard').chatNarrative!.trigger).not.toHaveProperty('controlHandoff')
})

type State = ReturnType<typeof maintainedPauseFixture>['state']
it.each([
  ['active goal', (s: State) => {s.chatNarrative!.situation.goals[0].status = 'active'}],
  ['other active goal', (s: State) => {s.chatNarrative!.situation.goals.push({...s.chatNarrative!.situation.goals[0], goalKey: 'other', status: 'active'})}],
  ['player pause', (s: State) => {s.chatNarrative!.situation.goals[0].playerPause = {} as never}],
  ['draft not adopted', (s: State) => {s.chatNarrative!.situation.goals[0].updatedSequence = 0}],
  ['new player trigger', (s: State) => {s.chatNarrative!.triggers.at(-1)!.kind = 'player-response'}],
  ['already acted', (s: State) => {s.chatNarrative!.triggers.at(-1)!.actionSequences = [5]}],
  ['pending result', (s: State) => {s.chatNarrative!.pendingSituation = {} as never}],
  ['pending edit', (s: State) => {s.chatNarrative!.pendingEdit = {} as never}],
  ['ensemble', (s: State) => {s.chatNarrative!.triggers.at(-1)!.direction!.scheduling = {} as never}],
  ['excluded pause', (s: State) => {s.chatNarrative!.excludedMessageIds = ['pause-message']}],
  ['superseded pause', (s: State) => {s.messages.at(-1)!.supersededBySequence = 5}],
  ['private pause', (s: State) => {s.messages.at(-1)!.audienceKeys = ['guard']}],
  ['other speaker', (s: State) => {s.messages.at(-1)!.speakerKey = 'artisan'}],
  ['insufficient budget', (s: State) => {s.remainingDirectorBudget = 2}],
] as const)('rejects %s without rewriting a pause', (_name, mutate) => {
  const {state, input} = maintainedPauseFixture(); mutate(state); const before = structuredClone(state)
  expect(() => previewChatControlHandoffV1(state, input)).toThrow(); expect(state).toEqual(before)
})

it('cannot swallow an unhandled player reply or hide excluded later dialogue', () => {
  const {state, input} = maintainedPauseFixture(), source = state.messages.at(-1)!
  state.messages.push({...source, messageId: 'new-player', eventSequence: 5, speakerKey: 'player', role: 'player', text: '我改变主意了，先回答我的新问题。'})
  expect(() => previewChatControlHandoffV1(state, input)).toThrow('新的玩家消息')
  state.chatNarrative!.excludedMessageIds = ['new-player']
  expect(() => previewChatControlHandoffV1(state, input)).toThrow('对话已被排除')
})

it('allows a genuinely new action to resume the existing own goal after a silent pause', () => {
  const {state, input} = maintainedPauseFixture(), held = applyReviewedChatControlHandoffV1(state, input)
  const next = requestChatNarrativeTriggerV1(held, {sequence: 7, kind: 'continue', sourceEventSequence: 6, seed: null})
  const action = {...maintainedPauseAction(), kind: 'speak' as const, text: '铜印还没找回。我恢复寻找，先问清能从哪份现存记录核对。', goalStatus: 'active' as const}
  const resumed = applyReviewedChatNarrativeActionV1(next, {sequence: 8, triggerSequence: 7, actorKey: 'guard', messageId: 'resumed', action, review: chatActionReviewFixture(action)})
  expect(resumed.chatNarrative!.situation.goals[0].status).toBe('active')
  expect(resumed.messages).toHaveLength(held.messages.length + 1)
  expect(held.chatNarrative!.situation.goals[0].status).toBe('paused')
})

it.each(CHAT_MAINTAINED_PAUSE_CHECKS_V1)('preserves independent %s rejection and prohibits importing failed control', check => {
  const {state, input} = maintainedPauseFixture(), before = structuredClone(state)
  const body = {actorKey: input.actorKey, baseSequence: 5, baseStateHash: 'a'.repeat(64), commandId: 'hold', triggerSequence: 5, handoff: input.handoff, review: input.review}
  expect(() => validateImportedChatNarrativeEvidenceEventV1(JSON.stringify(body), 'character-interaction', 'interaction.narrative.control-handoff.committed')).not.toThrow()
  input.review.checks.find(c => c.check === check)!.passed = false
  expect(() => applyReviewedChatControlHandoffV1(state, input)).toThrow('审查未通过')
  expect(() => validateImportedChatNarrativeEvidenceEventV1(JSON.stringify(body), 'character-interaction', 'interaction.narrative.control-handoff.committed')).toThrow()
  expect(state).toEqual(before)
})

it('rejects forged marker history, extra writes, missing reviews and cross-version authority', () => {
  const {state, input, handoff} = maintainedPauseFixture(), held = applyReviewedChatControlHandoffV1(state, input)
  for (const patch of [{status: 'waiting-player'}, {kind: 'player-response'}, {actionSequences: [4]}]) {
    const changed = structuredClone(held); Object.assign(changed.chatNarrative!.triggers.at(-1)!, patch)
    expect(() => parseInteractionState(changed)).toThrow()
  }
  for (const patch of [{version: 4}, {goalKey: ''}, {goalStatus: 'paused'}, {rationale: ''}]) expect(() => parseChatMaintainedPauseControlV1({...handoff, ...patch})).toThrow()
  expect(() => parseChatControlHandoffReviewV1({...input.review, checks: input.review.checks.slice(1)}, handoff)).toThrow()
  const wire = {outcome: 'handoff', action: null, handoff}
  expect(parseChatNarrativeOutcomeWireV1(wire, 'chat-narrative-action-v66')).toMatchObject({handoff})
  const contract = (p: string, r: string) => ({budget: {maxModelCalls: 3, maxAttemptsPerStep: 1}, executionBindings: [
    {stepId: 'interaction:action-choice', skillId: 'character.chat-narrative-action', promptVersion: p},
    {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-narrative-action', promptVersion: p},
    {stepId: 'interaction:action-review', skillId: 'character.chat-narrative-action-review', promptVersion: r},
  ]})
  expect(() => assertChatControlHandoffBindingsV1(contract('chat-narrative-action-v66', 'chat-narrative-action-review-v41'), handoff)).not.toThrow()
  for (const [p, r] of [['chat-narrative-action-v65', 'chat-narrative-action-review-v40'], ['chat-narrative-action-v66', 'chat-narrative-action-review-v40'], ['chat-narrative-action-v70', 'chat-narrative-action-review-v41']])
    expect(() => assertChatControlHandoffBindingsV1(contract(p, r), handoff)).toThrow()
  for (const p of [undefined, 'chat-narrative-action-v65', 'chat-narrative-action-v73']) {
    expect(() => parseChatNarrativeOutcomeWireV1(wire, p)).toThrow()
    expect(JSON.stringify(chatNarrativeOutcomeSchemaV1({}, p))).not.toContain('maintain-existing-pause')
  }
  expect(JSON.stringify(chatNarrativeOutcomeSchemaV1({}, 'chat-narrative-action-v66'))).toContain('maintain-existing-pause')
  expect(chatCoordinatorAudienceVersionV1(contract('chat-narrative-action-v66', 'chat-narrative-action-review-v41'))).toBe(2)
})

it('keeps the Codex output schema versioned and rejects added control fields', () => {
  const {handoff} = maintainedPauseFixture(), wire = {outcome: 'handoff', action: null, handoff}
  const ajv = new Ajv({strict: false})
  for (const version of ['chat-narrative-action-v65', 'chat-narrative-action-v66']) {
    const validate = ajv.compile(chatActionRequestOptionsV1(version, 'codex')!.jsonSchema!.schema)
    expect(validate(wire)).toBe(version === 'chat-narrative-action-v66')
    expect(validate({...wire, handoff: {...handoff, goalStatus: 'paused'}})).toBe(false)
    expect(validate({...wire, action: {}})).toBe(false)
  }
})
