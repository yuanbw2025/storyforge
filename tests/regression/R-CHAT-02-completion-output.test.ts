import {afterEach, expect, it} from 'vitest'
import {createHash} from 'node:crypto'
import Ajv from 'ajv'
import real from '../fixtures/character-chat-completion-conflict-v315.json'
import legacy from '../fixtures/character-chat-completion-output-legacy.json'
import budgetCase from '../fixtures/character-chat-completion-budget-v317.json'
import {estimateChatRequestOptionsTokens} from '../../src/lib/ai/client'
import {trimMessagesToFit} from '../../src/lib/ai/context-budget'
import {chatActionRequestOptionsV1, chatActionOutputRulesV1} from '../../src/lib/character-interaction/action-output-contract'
import {chatActionPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {bindChatOwnEvidenceV1} from '../../src/lib/character-interaction/action-evidence-binding'
import {compileChatActionWireV1} from '../../src/lib/character-interaction/action-wire'
import {parseChatNarrativeActionV1, previewChatNarrativeActionV1} from '../../src/lib/character-interaction/narrative-actions'
import {chatActionChoiceVersionForContractV1} from '../../src/lib/character-interaction/action-choice-budget'
import {assertChatTurnCompletionBindingV1} from '../../src/lib/character-interaction/turn-completion'
import {db} from '../../src/lib/db/schema'
import {seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {readProductRuntimeState} from '../../src/lib/character-interaction/runtime-api'
import {interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import type {CharacterInteractionRuntimeState, ChatMessage} from '../../src/lib/types'

const producer = 'chat-narrative-action-v60'
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex')
const sample = (patch: Record<string, unknown> = {}) => ({...real.response, action: {...structuredClone(real.response.action), ...patch}})
const schema = () => chatActionRequestOptionsV1(producer, 'codex')!.jsonSchema!.schema
const local = () => sample({goalKey: 'existing-active-goal', goalStatus: null, threadFollowupGoal: null})
afterEach(() => db.close())

it.each(['codex', 'agnes'] as const)('excludes the exact V315 contradictory expression from %s output and keeps domain rejection', provider => {
  const old = new Ajv().compile(chatActionRequestOptionsV1('chat-narrative-action-v58', provider)!.jsonSchema!.schema)
  const current = new Ajv().compile(chatActionRequestOptionsV1(producer, provider)!.jsonSchema!.schema)
  expect(createHash('sha256').update(real.rawText).digest('hex')).toBe(real.rawSha256)
  expect(JSON.parse(real.rawText)).toEqual(real.response)
  const before = structuredClone(real)
  expect(old(real.response)).toBe(true)
  expect(current(real.response)).toBe(false)
  const state = real.state.interaction as unknown as CharacterInteractionRuntimeState
  const actorKey = state.profiles[0].participantKey
  const action = parseChatNarrativeActionV1(bindChatOwnEvidenceV1(compileChatActionWireV1(real.response.action, producer, [state.playerKey, actorKey]), producer))
  expect(() => previewChatNarrativeActionV1(state, {sequence: real.state.lastSequence + 1, triggerSequence: state.chatNarrative!.triggers.slice(-1)[0].requestedSequence,
    actorKey, messageId: 'retained-failed-report', action})).toThrow('本轮结束必须保留原有活跃目标')
  expect(real).toEqual(before)
  // A separately chosen ordinary goal-closing action is allowed. No runtime
  // response repair, adoption, review result or real-model success is implied.
  expect(current(sample({turnCompletion: null}))).toBe(true)
  const ordinary = parseChatNarrativeActionV1(bindChatOwnEvidenceV1(compileChatActionWireV1(sample({turnCompletion: null}).action, producer, [state.playerKey, actorKey]), producer))
  const preview = previewChatNarrativeActionV1(state, {sequence: real.state.lastSequence + 1, triggerSequence: state.chatNarrative!.triggers.slice(-1)[0].requestedSequence,
    actorKey, messageId: 'separately-chosen-ordinary-report', action: ordinary})
  expect(preview.chatNarrative!.situation.goals.find(goal => goal.goalKey === ordinary.goalKey)?.status).toBe('fulfilled')
  expect(state).toEqual(before.state.interaction)
  expect(current(local())).toBe(true)
})

it.each([
  {label: 'fulfilled original goal', patch: {goalStatus: 'fulfilled'}},
  {label: 'paused original goal', patch: {goalStatus: 'paused'}},
  {label: 'abandoned original goal', patch: {goalStatus: 'abandoned'}},
  {label: 'missing active goal', patch: {goalKey: null}},
  {label: 'other goal change', patch: {goalUpdates: [{goalKey: 'other', status: 'fulfilled', evidenceFactKeys: [], evidenceExcerpt: null}]}},
  {label: 'new thread followup goal', patch: {threadFollowupGoal: real.response.action.threadFollowupGoal}},
  {label: 'new player followup goal', patch: {followupGoal: {playerEventSequence: 1, playerExcerpt: '请查一下', evidenceExcerpt: null, goal: real.response.action.threadFollowupGoal.goal,
    thread: {threadKey: 'new', title: '另一件事', question: '发生了什么', evidenceFactKeys: [], closureSignals: []}}}},
  {label: 'paused goal', patch: {pauseGoal: {playerEventSequence: 1, playerExcerpt: '先停下', threadKey: 'thread-1', evidenceExcerpt: null}}},
  {label: 'resumed goal', patch: {resumeGoal: {playerEventSequence: 1, playerExcerpt: '继续'}}},
  {label: 'pending situation result', patch: {situationRequest: {threadKey: 'thread-1', direction: '核实检查结果', evidenceFactKeys: [], evidenceExcerpt: null}}},
  {label: 'scene transition', patch: {sceneTransition: {playerEventSequence: 1, playerExcerpt: '走吧', destinationFactKey: 'place', destinationExcerpt: '门外', arrivalFactKey: 'arrived', evidenceExcerpt: null}}},
  ...['speech-awaiting-player', 'player-dependent-attempt', 'self-action-awaiting-player', 'self-pause', 'self-pause-awaiting-player'].map(expressionMode => ({label: expressionMode, patch: {expressionMode}})),
])('forbids turn completion with $label while retaining that ordinary action shape', ({patch}) => {
  const validate = new Ajv().compile(schema()), value = local()
  expect(validate({...value, action: {...value.action, ...patch}})).toBe(false)
  expect(validate({...value, action: {...value.action, ...patch, turnCompletion: null}})).toBe(true)
})

it('does not unnecessarily remove promises, relationships, facts or thread closure from a local completion', () => {
  const validate = new Ajv().compile(schema()), value = local()
  const changes = {promiseRequest: {playerEventSequence: 1, playerExcerpt: '请记得'},
    relationshipUpdates: [{dimensionKey: 'trust', delta: 1, sourceEventSequence: 1, playerExcerpt: '谢谢', evidenceExcerpt: null}],
    commitmentEffects: [{kind: 'fulfill', commitmentKey: 'promise', evidenceExcerpt: null}],
    threadUpdates: [{threadKey: 'thread-1', status: 'resolved', evidenceExcerpt: null}]}
  expect(validate({...value, action: {...value.action, ...changes}})).toBe(true)
  expect(validate({...value, action: {...value.action, expressionMode: 'speech'}})).toBe(true)
  expect(validate({...value, action: {...value.action, forceCompletion: true}})).toBe(false)
})

it('uses supported strict object branches with resolvable shared definitions and bounded schema overhead', () => {
  const options = chatActionRequestOptionsV1(producer, 'codex')!, current = options.jsonSchema!.schema
  expect(options.jsonSchema!.name).toBe('chat_narrative_outcome_v3')
  expect(current.type).toBe('object'); expect(current.anyOf).toBeUndefined()
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {value.forEach(visit); return}
    const node = value as Record<string, unknown>
    for (const key of ['allOf', 'not', 'if', 'then', 'else', 'dependentRequired', 'dependentSchemas']) expect(node).not.toHaveProperty(key)
    if (node.type === 'object') {
      expect(node.additionalProperties).toBe(false)
      expect(node.required).toEqual(Object.keys(node.properties as object))
    }
    Object.values(node).forEach(visit)
  }
  visit(current)
  new Ajv().compile(current)
  const old = chatActionRequestOptionsV1('chat-narrative-action-v58', 'codex')!
  expect(JSON.stringify(options).length).toBeLessThan(JSON.stringify(old).length * 1.3)
  expect(chatActionRequestOptionsV1(producer, 'deepseek')).toBeUndefined()
  expect(chatActionOutputRulesV1(producer).join('\n')).toContain('本次完成、暂停、放弃或新建目标')
})

it('preserves every prior supported schema and output instruction byte, including the failed run version', async () => {
  for (const [version, expected] of Object.entries(legacy.contracts)) {
    expect({request: hash(chatActionRequestOptionsV1(version, 'codex')), rules: hash(chatActionOutputRulesV1(version))}, version).toEqual(expected)
  }
  db.close(); await db.delete(); await db.open()
  const f = await seedChatNarrativeRuntimeFixture({factDiscovery: true})
  const view = interactionVisibilityView((await readProductRuntimeState(f.sessionId)).interaction!, 'guard')
  expect(hash(chatActionPromptRulesV1(view, {producerVersion: 'chat-narrative-action-v59'}))).toBe(legacy.actionPrompt)
})

it('binds the new producer to the unchanged independent reviewer and original three-call budget', () => {
  const contract = {budget: {maxModelCalls: 3, maxAttemptsPerStep: 1}, executionBindings: [
    {stepId: 'interaction:action-choice', skillId: 'character.chat-narrative-action', promptVersion: producer},
    {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-narrative-action', promptVersion: producer},
    {stepId: 'interaction:action-review', skillId: 'character.chat-narrative-action-review', promptVersion: 'chat-narrative-action-review-v37'},
  ]}
  const action = parseChatNarrativeActionV1(bindChatOwnEvidenceV1(compileChatActionWireV1(local().action, producer, ['player', 'participant.001']), producer))
  expect(chatActionChoiceVersionForContractV1(contract)).toBe(1)
  expect(() => assertChatTurnCompletionBindingV1(action, contract)).not.toThrow()
  const wrong = structuredClone(contract); wrong.executionBindings[2].promptVersion = 'chat-narrative-action-review-v36'
  expect(() => chatActionChoiceVersionForContractV1(wrong)).toThrow('冻结预算合同不一致')
  expect(() => assertChatTurnCompletionBindingV1(action, wrong)).toThrow('版本不匹配')
})

it('admits the exact V317 expression request without trimming messages or enlarging the context or output budget', () => {
  const prior = chatActionRequestOptionsV1('chat-narrative-action-v59', 'codex')!
  expect(budgetCase.requestOptions).toEqual(prior)
  const messages = budgetCase.messages as ChatMessage[], current = chatActionRequestOptionsV1(producer, 'codex')!
  const check = (options: typeof prior) => trimMessagesToFit(messages, 'codex', 'gpt-6.1-sol', 4000, undefined, estimateChatRequestOptionsTokens(options))
  const old = check(prior), compact = check(current)
  expect(old.trimmed).toBe(true)
  expect(compact.trimmed).toBe(false)
  expect(compact.messages).toEqual(messages)
  expect(compact.protectedEnvelopePreserved).toBe(true)
  expect(compact.inputBudget).toBe(old.inputBudget)
  expect(estimateChatRequestOptionsTokens(current)).toBeLessThan(estimateChatRequestOptionsTokens(prior))
})

it('preserves the complete expanded V59 schema, including distinctions between own and player/source quotations', () => {
  const expand = (root: Record<string, unknown>, value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(child => expand(root, child))
    const node = value as Record<string, unknown>
    if (typeof node.$ref === 'string') {
      expect(node.$ref.startsWith('#/$defs/')).toBe(true)
      const definition = (root.$defs as Record<string, unknown>)[node.$ref.slice('#/$defs/'.length)]
      expect(definition).toBeDefined()
      return expand(root, definition)
    }
    return Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$defs').map(([key, child]) => [key, expand(root, child)]))
  }
  const old = chatActionRequestOptionsV1('chat-narrative-action-v59', 'codex')!.jsonSchema!.schema, current = schema()
  expect(expand(current, current)).toEqual(expand(old, old))
})
