import {expect, it} from 'vitest'
import {getAgentSkillV1} from '../../src/lib/agent/skill-registry'
import {chatActionChoiceVersionForContractV1} from '../../src/lib/character-interaction/action-choice-budget'
import {buildChatActionChoiceMessagesV1, chatActionChoiceRequestOptionsV1, supportsChatActionChoiceV1} from '../../src/lib/character-interaction/action-choice-contract'
import {chatActionOutputRulesV1, chatActionRequestOptionsV1} from '../../src/lib/character-interaction/action-output-contract'
import {chatActionPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {chatActionContextVersionsV1, chatRetrievalVersionForReader, usesChatActionBoundContextV1} from '../../src/lib/character-interaction/context-selection'
import {assertChatControlHandoffBindingsV1, chatNarrativeOutcomeRulesV1, parseChatNarrativeOutcomeWireV1} from '../../src/lib/character-interaction/control-handoff-wire'
import {assertChatTurnCompletionBindingV1, supportsChatTurnCompletionV1} from '../../src/lib/character-interaction/turn-completion'
import {chatTurnEndReviewerForProducerV1} from '../../src/lib/character-interaction/turn-end-control'
import {interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {chatTurnEndActionFixture, chatTurnEndControlFixture} from '../helpers/chat-turn-end-control'
import type {ChatMessage} from '../../src/lib/types'

const versions = [
  {skill: 'character.chat-narrative-action', old: 'chat-narrative-action-v61', next: 'chat-narrative-action-v62'},
  {skill: 'character.chat-narrative-options', old: 'chat-narrative-options-v37', next: 'chat-narrative-options-v38'},
  {skill: 'character.chat-action-revision', old: 'chat-action-revision-v22', next: 'chat-action-revision-v23'},
] as const
const currentVersions = {'character.chat-narrative-action': 'chat-narrative-action-v72', 'character.chat-narrative-options': 'chat-narrative-options-v42', 'character.chat-action-revision': 'chat-action-revision-v25'} as const
const recipe = (producer: string, reviewer = 'chat-narrative-action-review-v38', choice = producer) => ({
  budget: {maxModelCalls: 3, maxAttemptsPerStep: 1}, executionBindings: [
    {stepId: 'interaction:action-choice', skillId: 'character.chat-narrative-action', promptVersion: choice},
    {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-narrative-action', promptVersion: producer},
    {stepId: 'interaction:action-review', skillId: 'character.chat-narrative-action-review', promptVersion: reviewer},
  ],
})
const completion = {...chatTurnEndActionFixture(), turnCompletion: {
  version: 1 as const, purpose: '整理现有线索', evidenceExcerpt: '将已经核实的线索按时间排好',
}}

it.each(versions)('retains $next reader18 and $old reader17 while explicitly binding the current default', ({skill, old, next}) => {
  expect(getAgentSkillV1(skill).promptVersion).toBe(currentVersions[skill])
  expect(chatActionContextVersionsV1(currentVersions[skill])).toEqual(chatActionContextVersionsV1(next))
  expect(chatActionContextVersionsV1(next)).toEqual({readerVersion: 'chat-narrative-runtime-view-v18', retrievalVersion: 'chat-relevance-v14'})
  expect(chatActionContextVersionsV1(old)).toEqual({readerVersion: 'chat-narrative-runtime-view-v17', retrievalVersion: 'chat-relevance-v13'})
  expect(usesChatActionBoundContextV1({skillId: skill, promptVersion: next})).toBe(true)
  expect(usesChatActionBoundContextV1({skillId: 'other-product', promptVersion: next})).toBe(false)
  for (const other of versions.filter(value => value.skill !== skill))
    expect(usesChatActionBoundContextV1({skillId: other.skill, promptVersion: next})).toBe(false)
})

it('keeps future reader and producer versions outside the released allowlist', () => {
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v18')).toBe('chat-relevance-v14')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v17')).toBe('chat-relevance-v13')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v19')).toBeNull()
  for (const [skillId, promptVersion] of [
    ['character.chat-narrative-action', 'chat-narrative-action-v73'],
    ['character.chat-narrative-options', 'chat-narrative-options-v43'],
    ['character.chat-action-revision', 'chat-action-revision-v26'],
  ]) expect(usesChatActionBoundContextV1({skillId, promptVersion})).toBe(false)
  expect(getAgentSkillV1('character.chat-narrative-action-review').promptVersion).toBe('chat-narrative-action-review-v42')
  expect(getAgentSkillV1('character.chat-narrative-options-review').promptVersion).toBe('chat-narrative-options-review-v30')
})

it.each(['chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63'])('keeps %s bound to review38 and the original three-call budget', producer => {
  const contract = recipe(producer), {handoff} = chatTurnEndControlFixture()
  expect(chatActionChoiceVersionForContractV1(contract)).toBe(1)
  expect(() => assertChatTurnCompletionBindingV1(completion, contract)).not.toThrow()
  expect(() => assertChatControlHandoffBindingsV1(contract, handoff)).not.toThrow()
  expect(chatTurnEndReviewerForProducerV1(producer)).toBe('chat-narrative-action-review-v38')
  const wrongReview = recipe(producer, 'chat-narrative-action-review-v37')
  expect(() => chatActionChoiceVersionForContractV1(wrongReview)).toThrow('冻结预算合同不一致')
  expect(() => assertChatTurnCompletionBindingV1(completion, wrongReview)).toThrow('版本不匹配')
  expect(() => assertChatControlHandoffBindingsV1(wrongReview, handoff)).toThrow()
  for (const budget of [{maxModelCalls: 2, maxAttemptsPerStep: 1}, {maxModelCalls: 3, maxAttemptsPerStep: 2}]) {
    expect(() => chatActionChoiceVersionForContractV1({...contract, budget})).toThrow('冻结预算合同不一致')
    expect(() => assertChatControlHandoffBindingsV1({...contract, budget}, handoff)).toThrow()
  }
})

it.each([
  ['chat-narrative-action-v62', 'chat-narrative-action-v61'],
  ['chat-narrative-action-v61', 'chat-narrative-action-v62'],
  ['chat-narrative-action-v62', 'chat-narrative-action-v63'],
  ['chat-narrative-action-v63', 'chat-narrative-action-v62'],
  ['chat-narrative-action-v64', 'chat-narrative-action-v64'],
])('rejects mixed or future expression %s / choice %s', (producer, choice) => {
  const contract = recipe(producer, 'chat-narrative-action-review-v38', choice)
  expect(() => chatActionChoiceVersionForContractV1(contract)).toThrow('冻结预算合同不一致')
  expect(() => assertChatControlHandoffBindingsV1(contract, chatTurnEndControlFixture().handoff)).toThrow()
  if (producer.endsWith('-v64')) expect(() => assertChatTurnCompletionBindingV1(completion, contract)).toThrow()
})

it('does not add choice or turn-end authority to new options or revision contracts', () => {
  const {handoff} = chatTurnEndControlFixture()
  for (const {skill, next} of versions.slice(1)) {
    expect(supportsChatActionChoiceV1(skill, next)).toBe(false)
    expect(supportsChatTurnCompletionV1(next)).toBe(false)
    expect(chatTurnEndReviewerForProducerV1(next)).toBeUndefined()
    expect(() => parseChatNarrativeOutcomeWireV1({outcome: 'handoff', action: null, handoff}, next)).toThrow()
  }
})

it.each(versions)('preserves all output schemas and prompt rules for $old → $next', ({skill, old, next}) => {
  const view = interactionVisibilityView(chatTurnEndControlFixture().state, 'guard')
  view.chatNarrative!.permissions.allowActorSituationExpansion = true
  // The same authorized view isolates the reader change from the producer's
  // existing semantics. Exercise both ordinary and preserve-expression rules.
  for (const preserveExpression of [false, true]) {
    const flags = {preserveExpression, playerPause: true, conversationEvidence: true, commitmentSemanticsV2: true,
      promiseRequest: true, existingGoalPause: true, sceneTransition: true, actionKind: true, replanning: true, playerDecision: true}
    expect(chatActionPromptRulesV1(view, {...flags, producerVersion: next})).toEqual(chatActionPromptRulesV1(view, {...flags, producerVersion: old}))
  }
  expect(chatActionOutputRulesV1(next, ['player', 'guard'])).toEqual(chatActionOutputRulesV1(old, ['player', 'guard']))
  expect(chatNarrativeOutcomeRulesV1(next)).toEqual(chatNarrativeOutcomeRulesV1(old))
  for (const provider of ['codex', 'agnes'] as const) {
    const historical = chatActionRequestOptionsV1(old, provider)
    expect(historical?.jsonSchema?.schema).toBeDefined()
    expect(chatActionRequestOptionsV1(next, provider)).toEqual(historical)
    if (skill === 'character.chat-narrative-action') {
      expect(chatActionChoiceRequestOptionsV1(provider, next))
        .toEqual(chatActionChoiceRequestOptionsV1(provider, old))
    }
  }
  if (skill === 'character.chat-narrative-action') {
    const messages: ChatMessage[] = [{role: 'system', content: '原角色规则'}, {role: 'user', content: '已交付角色视角'}]
    expect(buildChatActionChoiceMessagesV1(messages, next)).toEqual(buildChatActionChoiceMessagesV1(messages, old))
  }
})


it.each([
  ['chat-narrative-action-v62', 'chat-narrative-action-v63'],
  ['chat-narrative-options-v38', 'chat-narrative-options-v39'],
])('preserves output authority and schemas for ordinary-action clarification %s → %s', (old, current) => {
  expect(chatActionOutputRulesV1(current, ['player', 'guard'])).toEqual(chatActionOutputRulesV1(old, ['player', 'guard']))
  expect(chatNarrativeOutcomeRulesV1(current)).toEqual(chatNarrativeOutcomeRulesV1(old))
  for (const provider of ['codex', 'agnes'] as const) {
    expect(chatActionRequestOptionsV1(current, provider)).toEqual(chatActionRequestOptionsV1(old, provider))
    if (current === 'chat-narrative-action-v63') expect(chatActionChoiceRequestOptionsV1(provider, current)).toEqual(chatActionChoiceRequestOptionsV1(provider, old))
  }
})


it('binds the new unchanged producer to review39 without accepting mixed historical recipes', () => {
  const contract = recipe('chat-narrative-action-v64', 'chat-narrative-action-review-v39')
  const {handoff} = chatTurnEndControlFixture()
  expect(chatActionChoiceVersionForContractV1(contract)).toBe(1)
  expect(chatTurnEndReviewerForProducerV1('chat-narrative-action-v64')).toBe('chat-narrative-action-review-v39')
  expect(() => assertChatTurnCompletionBindingV1(completion, contract)).not.toThrow()
  expect(() => assertChatControlHandoffBindingsV1(contract, handoff)).not.toThrow()
  for (const wrong of [recipe('chat-narrative-action-v63', 'chat-narrative-action-review-v39'),
    recipe('chat-narrative-action-v64', 'chat-narrative-action-review-v38'),
    recipe('chat-narrative-action-v64', 'chat-narrative-action-review-v39', 'chat-narrative-action-v63'),
    recipe('chat-narrative-action-v65', 'chat-narrative-action-review-v39')]) {
    expect(() => chatActionChoiceVersionForContractV1(wrong)).toThrow()
    expect(() => assertChatControlHandoffBindingsV1(wrong, handoff)).toThrow()
  }
  for (const budget of [{maxModelCalls: 2, maxAttemptsPerStep: 1}, {maxModelCalls: 3, maxAttemptsPerStep: 2}])
    expect(() => chatActionChoiceVersionForContractV1({...contract, budget})).toThrow()
})

it.each([
  ['chat-narrative-action-v63', 'chat-narrative-action-v64'],
  ['chat-narrative-action-v64', 'chat-narrative-action-v65'],
  ['chat-narrative-options-v39', 'chat-narrative-options-v40'],
])('preserves generation, schemas and source versions when only the review changes: %s → %s', (old, current) => {
  const view = interactionVisibilityView(chatTurnEndControlFixture().state, 'guard')
  view.chatNarrative!.permissions.allowActorSituationExpansion = true
  for (const preserveExpression of [false, true]) {
    const flags = {preserveExpression, playerPause: true, conversationEvidence: true, commitmentSemanticsV2: true,
      promiseRequest: true, existingGoalPause: true, sceneTransition: true, actionKind: true, replanning: true, playerDecision: true}
    expect(chatActionPromptRulesV1(view, {...flags, producerVersion: current})).toEqual(chatActionPromptRulesV1(view, {...flags, producerVersion: old}))
  }
  expect(chatActionOutputRulesV1(current, ['player', 'guard'])).toEqual(chatActionOutputRulesV1(old, ['player', 'guard']))
  expect(chatNarrativeOutcomeRulesV1(current)).toEqual(chatNarrativeOutcomeRulesV1(old))
  expect(chatActionContextVersionsV1(current)).toEqual(chatActionContextVersionsV1(old))
  for (const provider of ['codex', 'agnes'] as const) {
    expect(chatActionRequestOptionsV1(current, provider)).toEqual(chatActionRequestOptionsV1(old, provider))
    if (current === 'chat-narrative-action-v64' || current === 'chat-narrative-action-v65') {
      expect(chatActionChoiceRequestOptionsV1(provider, current)).toEqual(chatActionChoiceRequestOptionsV1(provider, old))
      const messages: ChatMessage[] = [{role: 'system', content: '原角色规则'}, {role: 'user', content: '已有真实来源'}]
      expect(buildChatActionChoiceMessagesV1(messages, current)).toEqual(buildChatActionChoiceMessagesV1(messages, old))
    }
  }
})
