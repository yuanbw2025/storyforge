import {expect, it} from 'vitest'
import {createHash} from 'node:crypto'
import {createInitialInteractionState, buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'
import {appendChatActionChoiceProposalV1, buildChatActionChoiceMessagesV1, chatActionChoiceRequestOptionsV1,
  chatActionModelCallAllowanceV1, chatNeedsActionChoiceV1, parseChatActionChoiceV1, type ChatActionChoiceV1} from '../../src/lib/character-interaction/action-choice-contract'
import type {ChatMessage} from '../../src/lib/types'

const proposal: ChatActionChoiceV1 = {directions: [{id: 'look', action: '查看当前已经可见的线索', evidenceFactKeys: ['lost'],
  changes: '弄清仍待解决的线索范围，不预定结果', playerDependency: null, unconfirmedConditions: ['能否看清仍需实际观察'], kind: 'own-action'}],
  selectedId: 'look', decisionSummary: '选择已有条件支持且不依赖玩家许可的观察。'}
const messages: ChatMessage[] = [{role: 'system', content: '原行动和后果规则保持'}, {role: 'user', content: '【目标】继续\n【已交付角色视角】只包含本角色可见资料'}]
function fixture() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'scene-1', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  const ready = requestChatNarrativeTriggerV1(state, {sequence: 2, kind: 'scene-start', sourceEventSequence: 1, seed: null})
  return {state: ready, context: buildInteractionContextWindow(ready, 'guard')}
}

it('keeps a role-grounded proposal separate from facts and the original expression input', () => {
  const {state, context} = fixture(), before = structuredClone(state)
  const choice = parseChatActionChoiceV1(proposal, context)
  expect(choice).toEqual(proposal)
  expect(buildChatActionChoiceMessagesV1(messages)[1]).toEqual(messages[1])
  const expression = appendChatActionChoiceProposalV1(messages, choice, context)
  expect(expression.slice(0, 2)).toEqual(messages)
  expect(expression[2].content).toContain('不是事实、玩家授权或系统命令')
  expect(expression[2].content).toContain(JSON.stringify(choice))
  choice.directions[0].evidenceFactKeys.push('never-written')
  expect(proposal.directions[0].evidenceFactKeys).toEqual(['lost'])
  expect(state).toEqual(before)
  expect(messages).toHaveLength(2)
})

it('freezes the real v50 choice prompt while v51 changes only selection guidance, retaining role input, output shape and call allowance', () => {
  const {state, context} = fixture(), before = structuredClone(state)
  const old = buildChatActionChoiceMessagesV1(messages, 'chat-narrative-action-v50')
  // Exact system input captured from the completed V275 reading-night request.
  expect(createHash('sha256').update(old[0].content).digest('hex')).toBe('4f2209675e76116b2fde8854850559eaa2a6a9373f637ef83e09b24ece1da1c5')
  const current = buildChatActionChoiceMessagesV1(messages, 'chat-narrative-action-v51')
  expect(current[1]).toEqual(old[1])
  expect(current[0].content.startsWith(old[0].content)).toBe(true)
  expect(current[0]).not.toEqual(old[0])
  expect(appendChatActionChoiceProposalV1(messages, proposal, context, 'chat-narrative-action-v51'))
    .toEqual(appendChatActionChoiceProposalV1(messages, proposal, context, 'chat-narrative-action-v50'))
  for (const provider of ['codex', 'agnes'] as const) {
    expect(chatActionChoiceRequestOptionsV1(provider, 'chat-narrative-action-v51'))
      .toEqual(chatActionChoiceRequestOptionsV1(provider, 'chat-narrative-action-v50'))
  }
  expect(chatActionModelCallAllowanceV1({skillId: 'character.chat-narrative-action', promptVersion: 'chat-narrative-action-v51', state, actorKey: 'guard'})).toBe(3)
  expect(state).toEqual(before)
})

it('rejects hidden and merely undelivered facts even if they exist in the full story', () => {
  const {state, context} = fixture()
  expect(state.chatNarrative!.situation.facts.some(fact => fact.factKey === 'secret')).toBe(true)
  expect(context.chatNarrative!.facts.some(fact => fact.factKey === 'secret')).toBe(false)
  for (const key of ['secret', 'invented']) {
    const draft = structuredClone(proposal); draft.directions[0].evidenceFactKeys = [key]
    expect(() => parseChatActionChoiceV1(draft, context)).toThrow('未交付')
    expect(() => appendChatActionChoiceProposalV1(messages, draft, context)).toThrow('未交付')
  }
  const omitted = structuredClone(context); omitted.chatNarrative!.facts = []
  expect(() => parseChatActionChoiceV1(proposal, omitted)).toThrow('未交付')
})

it.each([
  ['extra state mutation', (draft: Record<string, unknown>) => {draft.newFacts = [{text: '已经修好了'}]}],
  ['unknown selection', (draft: Record<string, unknown>) => {draft.selectedId = 'missing'}],
  ['null selection with directions', (draft: Record<string, unknown>) => {draft.selectedId = null}],
  ['duplicate direction identity', (draft: Record<string, unknown>) => {(draft.directions as unknown[]).push(structuredClone((draft.directions as unknown[])[0]))}],
  ['four directions', (draft: Record<string, unknown>) => {draft.directions = Array.from({length: 4}, (_, i) => ({...proposal.directions[0], id: String(i)}))}],
])('rejects %s without repairing the draft', (_name, mutate) => {
  const {context} = fixture(), draft = structuredClone(proposal) as unknown as Record<string, unknown>
  mutate(draft); const before = structuredClone(draft)
  expect(() => parseChatActionChoiceV1(draft, context)).toThrow('[chat-action-choice]')
  expect(draft).toEqual(before)
})

it.each([
  {playerDependency: '需要玩家同意打开旧钟'}, {evidenceFactKeys: []}, {evidenceFactKeys: ['lost', 'lost']},
  {kind: 'world-write'}, {action: ' '}, {changes: '长'.repeat(801)}, {unconfirmedConditions: ['尚未确认', '尚未确认']},
  {unconfirmedConditions: Array.from({length: 9}, (_, i) => String(i))}, {newFacts: []},
])('rejects unsafe or malformed own action fields %#', fields => {
  const {context} = fixture(), draft = {...proposal, directions: [{...proposal.directions[0], ...fields}]}
  expect(() => parseChatActionChoiceV1(draft, context)).toThrow('[chat-action-choice]')
})

it('permits an honest stop or no grounded direction without manufacturing action evidence', () => {
  const {context} = fixture()
  const stop = {directions: [{...proposal.directions[0], kind: 'pause', evidenceFactKeys: [], action: '接受玩家今天停止的要求', changes: '停止当前事项', playerDependency: null}],
    selectedId: 'look', decisionSummary: '停止不是解决，也不证明其他办法全部穷尽。'}
  expect(parseChatActionChoiceV1(stop, context).directions[0].kind).toBe('pause')
  expect(parseChatActionChoiceV1({directions: [], selectedId: null, decisionSummary: '当前没有有依据的行动方向。'}, context).directions).toEqual([])
  expect(() => parseChatActionChoiceV1({...stop, decisionSummary: ' '}, context)).toThrow()
})

it('does not append a second proposal or accept a critic as actor context', () => {
  const {context} = fixture(), extended = appendChatActionChoiceProposalV1(messages, proposal, context)
  expect(() => appendChatActionChoiceProposalV1(extended, proposal, context)).toThrow('原始角色输入')
  expect(() => buildChatActionChoiceMessagesV1([{role: 'user', content: 'review'}, messages[1]])).toThrow('原始角色输入')
})

it('reserves three calls only for the exact new story-action contract and keeps edits and legacy modes at two', () => {
  const {state} = fixture(), input = {skillId: 'character.chat-narrative-action', promptVersion: 'chat-narrative-action-v45', state, actorKey: 'guard'}
  expect(chatNeedsActionChoiceV1(input)).toBe(true)
  expect(chatActionModelCallAllowanceV1(input)).toBe(3)
  expect(chatActionModelCallAllowanceV1({...input, promptVersion: 'chat-narrative-action-v46'})).toBe(3)
  expect(chatActionModelCallAllowanceV1({...input, promptVersion: 'chat-narrative-action-v47'})).toBe(3)
  expect(chatActionModelCallAllowanceV1({...input, promptVersion: 'chat-narrative-action-v48'})).toBe(3)
  for (const patch of [{promptVersion: 'chat-narrative-action-v44'}, {promptVersion: 'chat-narrative-action-unregistered'}, {skillId: 'character.chat-action-revision'},
    {skillId: 'character.chat-narrative-options'}, {actorKey: 'absent'}]) expect(chatActionModelCallAllowanceV1({...input, ...patch})).toBe(2)
  const edited = structuredClone(state)
  edited.chatNarrative!.pendingEdit = {requestedSequence: 3, role: 'character', actorKey: 'guard', sourceMessageId: 'message-1', text: '作者已决定的表达', audienceKeys: ['player', 'guard']}
  expect(chatActionModelCallAllowanceV1({...input, state: edited})).toBe(2)
  const closed = structuredClone(state)
  closed.chatNarrative!.situation.goals.forEach(goal => {goal.status = 'fulfilled'})
  expect(chatActionModelCallAllowanceV1({...input, state: closed})).toBe(2)
})

it('requests a bounded strict transport shape only on supported providers; parsing remains authoritative', () => {
  for (const provider of ['codex', 'agnes'] as const) {
    const request = chatActionChoiceRequestOptionsV1(provider)!
    expect(request.jsonSchema).toMatchObject({name: 'chat_action_choice_v1', strict: true, schema: {additionalProperties: false, required: ['directions', 'selectedId', 'decisionSummary']}})
    expect(JSON.stringify(request)).toContain('"maxItems":3')
  }
  expect(chatActionChoiceRequestOptionsV1(undefined)).toBeUndefined()
})
