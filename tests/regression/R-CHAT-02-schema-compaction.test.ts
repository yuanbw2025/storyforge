import {expect, it} from 'vitest'
import {createHash} from 'node:crypto'
import Ajv from 'ajv'
import retained from '../fixtures/character-chat-input-budget-v343.json'
import {chatActionRequestOptionsV1, chatActionOutputRulesV1} from '../../src/lib/character-interaction/action-output-contract'
import {estimateChatActionRequestInputV1} from '../../src/lib/character-interaction/action-choice-input-budget'
import {chatActionChoiceVersionForContractV1} from '../../src/lib/character-interaction/action-choice-budget'
import {chatActionContextVersionsV1} from '../../src/lib/character-interaction/context-selection'
import {chatActionPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {assertChatControlHandoffBindingsV1, chatNarrativeOutcomeRulesV1, parseChatNarrativeOutcomeWireV1} from '../../src/lib/character-interaction/control-handoff-wire'
import {interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {getAgentSkillV1} from '../../src/lib/agent/skill-registry'
import {maintainedPauseFixture} from '../helpers/chat-maintained-pause'
import type {ChatRequestOptions} from '../../src/lib/ai/client'
import type {ChatMessage} from '../../src/lib/types'

const old = 'chat-narrative-action-v66', current = 'chat-narrative-action-v67'
const options = (version: string) => chatActionRequestOptionsV1(version, 'codex')!
const schema = (version: string) => options(version).jsonSchema!.schema
function expand(root: Record<string, unknown>, value: unknown, seen: readonly string[] = []): unknown {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(child => expand(root, child, seen))
  const node = value as Record<string, unknown>
  if (typeof node.$ref === 'string') {
    expect(Object.keys(node)).toEqual(['$ref'])
    expect(node.$ref.startsWith('#/$defs/')).toBe(true)
    expect(seen).not.toContain(node.$ref)
    const definition = (root.$defs as Record<string, unknown>)[node.$ref.slice('#/$defs/'.length)]
    expect(definition).toBeDefined()
    return expand(root, definition, [...seen, node.$ref])
  }
  if (node.type === 'object') {
    expect(node.additionalProperties).toBe(false)
    expect(node.required).toEqual(Object.keys(node.properties as object))
  }
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$defs').map(([key, child]) => [key, expand(root, child, seen)]))
}

it('keeps the saved v66 transport bytes and every expanded validation and description', () => {
  expect(options(old)).toEqual(retained.requests['interaction:runtime-candidate'].request.requestOptions)
  expect(createHash('sha256').update(JSON.stringify(schema(old))).digest('hex')).toBe('04033529858c3aaa9f12e44123e70200588c25bd4133a3e2dbcb9280a398e8ac')
  expect(expand(schema(current), schema(current))).toEqual(expand(schema(old), schema(old)))
  expect(JSON.stringify(schema(current)).length).toBeLessThan(JSON.stringify(schema(old)).length - 1039)
  expect(options(current).jsonSchema!.name).toBe('chat_narrative_outcome_v4')
  expect(options(current).jsonSchema!.strict).toBe(true)
  expect(chatActionRequestOptionsV1(current, 'agnes')).toEqual(options(current))
  expect(chatActionRequestOptionsV1(current, 'deepseek')).toBeUndefined()
})

it('admits the retained complete three-step input without removing messages or increasing its budget', () => {
  const estimates = Object.entries(retained.requests).map(([stepId, {request}]) => {
    const envelope = request as unknown as ChatMessage[] | {messages: ChatMessage[]; requestOptions: ChatRequestOptions}
    const messages = Array.isArray(envelope) ? envelope : envelope.messages
    const requestOptions = Array.isArray(envelope) ? undefined : envelope.requestOptions
    const before = estimateChatActionRequestInputV1(messages, requestOptions)
    expect(before).toBe(retained.expectedOriginalEstimates[stepId as keyof typeof retained.expectedOriginalEstimates])
    const after = estimateChatActionRequestInputV1(messages, stepId === 'interaction:runtime-candidate' ? options(current) : requestOptions)
    return {before, after}
  })
  expect(estimates.reduce((n, row) => n + row.before, 0)).toBe(56159)
  expect(retained.inputBudget).toBe(56000)
  expect(estimates.reduce((n, row) => n + row.after, 0)).toBeLessThan(retained.inputBudget)
})

it('preserves all semantic prompt rules and the registered role reader', () => {
  const view = interactionVisibilityView(maintainedPauseFixture().state, 'guard')
  view.chatNarrative!.permissions.allowActorSituationExpansion = true
  for (const preserveExpression of [false, true]) {
    const flags = {preserveExpression, playerPause: true, conversationEvidence: true, commitmentSemanticsV2: true,
      promiseRequest: true, existingGoalPause: true, sceneTransition: true, actionKind: true, replanning: true, playerDecision: true}
    expect(chatActionPromptRulesV1(view, {...flags, producerVersion: current})).toEqual(chatActionPromptRulesV1(view, {...flags, producerVersion: old}))
  }
  expect(chatActionOutputRulesV1(current, ['player', 'guard'])).toEqual(chatActionOutputRulesV1(old, ['player', 'guard']))
  expect(chatNarrativeOutcomeRulesV1(current)).toEqual(chatNarrativeOutcomeRulesV1(old))
  expect(chatActionContextVersionsV1(current)).toEqual({readerVersion: 'chat-narrative-runtime-view-v18', retrievalVersion: 'chat-relevance-v14'})
  expect(getAgentSkillV1('character.chat-narrative-action').promptVersion).toBe('chat-narrative-action-v72')
  expect(getAgentSkillV1('character.chat-narrative-action-review').promptVersion).toBe('chat-narrative-action-review-v42')
})

it.each([old, current])('accepts retained action and each handoff shape for %s without weakening negative cases', version => {
  const validate = new Ajv().compile(schema(version)), original = structuredClone(retained.expression)
  expect(validate(original)).toBe(true)
  const source = {messageId: 'actual-message', sequence: 4, excerpt: '已经说过的原文'}
  for (const handoff of [
    {version: 1, kind: 'yield-to-player', reason: 'awaiting-player-decision', source, decision: '是否参与', dependentStep: '等待同意'},
    {version: 2, kind: 'finish-current-turn', reason: 'local-purpose-completed', source, purpose: '本轮安排已说明'},
    maintainedPauseFixture().input.handoff,
  ]) {
    const wire = {outcome: 'handoff', action: null, handoff}
    expect(validate(wire)).toBe(true)
    expect(validate({...wire, handoff: {...handoff, source: {...handoff.source, secret: true}}})).toBe(false)
    expect(validate({...wire, action: original.action})).toBe(true) // Structural envelope; domain parser enforces exclusivity.
    expect(() => parseChatNarrativeOutcomeWireV1({...wire, action: original.action}, version)).toThrow('互斥')
  }
  for (const invalid of [
    {...original, extra: true}, {...original, action: {...original.action, expressionMode: 'invented'}},
    {...original, action: {...original.action, goalKey: 3}},
    {...original, action: {...original.action, audienceKeys: []}},
    {...original, action: {...original.action, resumeGoal: {playerEventSequence: 1, playerExcerpt: '继续', permission: true}}},
    {...original, action: {...original.action, goalUpdates: [{goalKey: 'g', status: 'invented', evidenceFactKeys: [], evidenceExcerpt: null}]}},
    {...original, action: {...original.action, threadFollowupGoal: {threadKey: 't', evidenceExcerpt: null, goal: {goalKey: 'g', desire: 'd', concern: 'c', boundary: 'b', evidenceFactKeys: [3]}}}},
  ]) expect(validate(invalid)).toBe(false)
  expect(retained.expression).toEqual(original)
})

it('keeps saved and current three-step contracts explicit and rejects mixed and future bindings', () => {
  const contract = (producer: string, reviewer = 'chat-narrative-action-review-v41', choice = producer) => ({
    executionBindings: [
      {stepId: 'interaction:action-choice', skillId: 'character.chat-narrative-action', promptVersion: choice},
      {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-narrative-action', promptVersion: producer},
      {stepId: 'interaction:action-review', skillId: 'character.chat-narrative-action-review', promptVersion: reviewer},
    ], budget: {maxModelCalls: 3, maxAttemptsPerStep: 1},
  })
  const handoff = maintainedPauseFixture().input.handoff
  for (const producer of [old, current]) {
    expect(chatActionChoiceVersionForContractV1(contract(producer))).toBe(1)
    expect(() => assertChatControlHandoffBindingsV1(contract(producer), handoff)).not.toThrow()
  }
  for (const candidate of [contract(current, 'chat-narrative-action-review-v40'), contract(current, 'chat-narrative-action-review-v41', old), contract('chat-narrative-action-v73')]) {
    expect(() => chatActionChoiceVersionForContractV1(candidate)).toThrow()
    expect(() => assertChatControlHandoffBindingsV1(candidate, handoff)).toThrow()
  }
})
