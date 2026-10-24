import {createHash} from 'node:crypto'
import {expect, it} from 'vitest'
import Ajv from 'ajv'
import {buildChatActionChoiceMessagesV1, chatActionChoiceRequestOptionsV1, parseChatActionChoiceV1} from '../../src/lib/character-interaction/action-choice-contract'
import {createInitialInteractionState, buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {estimateChatActionRequestInputV1} from '../../src/lib/character-interaction/action-choice-input-budget'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'
import type {ChatMessage} from '../../src/lib/types'

const messages: ChatMessage[] = [{role: 'system', content: '原表达合同'}, {role: 'user', content: '已交付角色可见资料'}]
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

const version = 'chat-narrative-action-v48'
const contradictory = {directions: [{id: 'd1', action: '说明下一步检查顺序', evidenceFactKeys: ['lost'],
  changes: '说明当前取舍', playerDependency: '后续拆卸仍需玩家同意', unconfirmedConditions: [] as string[], kind: 'own-action'}],
selectedId: 'd1', decisionSummary: '先回应玩家的询问'}
function context() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'scene-1', status: 'active', activeParticipantKeys: ['guard', 'artisan'],
    startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  const ready = requestChatNarrativeTriggerV1(state, {sequence: 2, kind: 'scene-start', sourceEventSequence: 1, seed: null})
  return buildInteractionContextWindow(ready, 'guard')
}

it.each([undefined, 'chat-narrative-action-v45', 'chat-narrative-action-v46', 'chat-narrative-action-v47'])('preserves original selector prompt and schema bytes for %s', producer => {
  expect(digest(buildChatActionChoiceMessagesV1(messages, producer))).toBe('fa12126f686f067b0a9e73496297a144ac4a1cd9ee9c8b16054f2db3325a6875')
  expect(digest(chatActionChoiceRequestOptionsV1('codex', producer)!.jsonSchema)).toBe('a939fb943722be4dd8c6ef1d98d3eb51e1a7b56d8be3baa40a1d69f201773e1d')
})

it.each(['codex', 'agnes'] as const)('prevents the observed contradictory choice in %s generation while retaining strict local rejection', provider => {
  const legacy = new Ajv().compile(chatActionChoiceRequestOptionsV1(provider)!.jsonSchema!.schema)
  const current = chatActionChoiceRequestOptionsV1(provider, version)!
  const validate = new Ajv().compile(current.jsonSchema!.schema)
  const before = structuredClone(contradictory)
  expect(current.jsonSchema!.name).toBe('chat_action_choice_v2')
  expect(legacy(contradictory)).toBe(true)
  expect(validate(contradictory)).toBe(false)
  expect(() => parseChatActionChoiceV1(contradictory, context())).toThrow('依赖玩家决定的行动不能标为自主行动')
  expect(contradictory).toEqual(before)

  const independent = {...contradictory, directions: [{...contradictory.directions[0],
    playerDependency: null, unconfirmedConditions: ['后续是否拆卸须另获玩家同意']}]}
  expect(validate(independent)).toBe(true)
  expect(parseChatActionChoiceV1(independent, context())).toEqual(independent)
  expect(estimateChatActionRequestInputV1(messages, current)).toBeGreaterThan(estimateChatActionRequestInputV1(messages))
})

it.each(['question', 'wait', 'pause', 'situation-request'])('keeps a genuinely dependent %s available without reclassifying it as independent', kind => {
  const value = {...contradictory, directions: [{...contradictory.directions[0], kind}]}
  const validate = new Ajv().compile(chatActionChoiceRequestOptionsV1('codex', version)!.jsonSchema!.schema)
  expect(validate(value)).toBe(true)
  expect(parseChatActionChoiceV1(value, context()).directions[0]).toMatchObject({kind, playerDependency: contradictory.directions[0].playerDependency})
})

it.each(['own-action', 'situation-request'])('requires an actual fact reference for %s without inventing one', kind => {
  const value = {...contradictory, directions: [{...contradictory.directions[0], kind, playerDependency: null, evidenceFactKeys: []}]}
  const validate = new Ajv().compile(chatActionChoiceRequestOptionsV1('codex', version)!.jsonSchema!.schema)
  expect(validate(value)).toBe(false)
  expect(() => parseChatActionChoiceV1(value, context())).toThrow('缺少事实依据')
})

it('allows no grounded direction and keeps role input unchanged without granting new permissions', () => {
  const validate = new Ajv().compile(chatActionChoiceRequestOptionsV1('codex', version)!.jsonSchema!.schema)
  const none = {directions: [], selectedId: null, decisionSummary: '没有有依据的新方向，不重复此前建议。'}
  expect(validate(none)).toBe(true)
  expect(parseChatActionChoiceV1(none, context())).toEqual(none)
  const current = buildChatActionChoiceMessagesV1(messages, version)
  expect(current[1]).toEqual(messages[1])
  expect(current[0].content).toContain('不能只把依赖字段清空来假装获得许可')
  expect(current[0].content).toContain('不能把后来可能做的其它步骤混入')
  expect(chatActionChoiceRequestOptionsV1('openai', version)).toBeUndefined()
})
