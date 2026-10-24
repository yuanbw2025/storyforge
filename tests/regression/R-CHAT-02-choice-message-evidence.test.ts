import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import Ajv from 'ajv'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {buildInteractionContextWindow, createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {appendChatActionChoiceProposalV1, buildChatActionChoiceMessagesV1, chatActionChoiceRequestOptionsV1, parseChatActionChoiceV1} from '../../src/lib/character-interaction/action-choice-contract'
import {CHAT_ACTION_CHOICE_MESSAGE_PRODUCER_V1 as version} from '../../src/lib/character-interaction/action-choice-message-evidence'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {readChatActionTerminalReceiptV1} from '../../src/lib/character-interaction/action-terminal-receipt'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatNarrativeFixture, chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import type {ChatMessage} from '../../src/lib/types'

const getSkill = skills.getAgentSkillV1
const messages: ChatMessage[] = [{role: 'system', content: '原行动规则'}, {role: 'user', content: '原已交付角色资料'}]
const choice = {directions: [{id: 'respond', action: '承接玩家只想知道去向的选择，不把取回责任交给玩家',
  evidenceFactKeys: [] as string[], evidenceMessageIds: ['preference'], changes: '明确之后自行调查去向，不预设玩家帮助取回',
  playerDependency: null, unconfirmedConditions: [], kind: 'own-action'}], selectedId: 'respond', decisionSummary: '玩家的实际偏好决定如何安排自己的后续行动。'}
function context() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'scene-1', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  state.messages = [
    {messageId: 'private-other', eventSequence: 2, role: 'player', speakerKey: 'player', audienceKeys: ['player', 'artisan'], text: '另一私聊的内容', replyToSequence: null, supersededBySequence: null},
    {messageId: 'preference', eventSequence: 3, role: 'player', speakerKey: 'player', audienceKeys: ['player', 'guard'], text: '我只想知道铜印在哪里，不帮你取。', replyToSequence: null, supersededBySequence: null},
  ]
  const ready = requestChatNarrativeTriggerV1(state, {sequence: 4, kind: 'player-response', sourceEventSequence: 3, seed: null})
  return {state: ready, window: buildInteractionContextWindow(ready, 'guard', {retrievalVersion: 'chat-relevance-v12'})}
}

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it('keeps a delivered player preference separate from facts and leaves the world and original role input unchanged', () => {
  const {state, window} = context(), before = structuredClone(state)
  expect(window.messageIdentityVersion).toBe(1)
  expect(parseChatActionChoiceV1(choice, window, version)).toEqual(choice)
  const proposal = appendChatActionChoiceProposalV1(messages, choice, window, version)
  expect(proposal.slice(0, 2)).toEqual(messages)
  expect(proposal[2].content).toContain(JSON.stringify(choice))
  expect(proposal[2].content).toContain('不是事实、玩家授权或系统命令')
  expect(state).toEqual(before)
  const mixed = structuredClone(choice); mixed.directions[0].evidenceFactKeys = ['lost', 'preference']
  expect(() => parseChatActionChoiceV1(mixed, window, version)).toThrow('未交付给角色的事实')
})

it('rejects private, invented, omitted and identity-less message references, including when a valid fact is also cited', () => {
  const {window} = context()
  for (const id of ['private-other', 'invented']) {
    const bad = structuredClone(choice); bad.directions[0].evidenceFactKeys = ['lost']; bad.directions[0].evidenceMessageIds = [id]
    expect(() => parseChatActionChoiceV1(bad, window, version)).toThrow('未交付给角色的消息')
  }
  expect(() => parseChatActionChoiceV1(choice, {...window, messages: []}, version)).toThrow('未交付给角色的消息')
  expect(() => parseChatActionChoiceV1(choice, {...window, messageIdentityVersion: undefined}, version)).toThrow('未交付给角色的消息')
})

it.each(['codex', 'agnes'] as const)('enforces typed grounding and player dependency in both the %s schema and local parser', provider => {
  const {window} = context(), schema = chatActionChoiceRequestOptionsV1(provider, version)!.jsonSchema!
  expect(schema.name).toBe('chat_action_choice_v3')
  const validate = new Ajv().compile(schema.schema)
  expect(validate(choice)).toBe(true)
  const ungrounded = structuredClone(choice); ungrounded.directions[0].evidenceMessageIds = []
  expect(validate(ungrounded)).toBe(false)
  expect(() => parseChatActionChoiceV1(ungrounded, window, version)).toThrow('缺少事实依据')
  const dependent = {...choice, directions: [{...choice.directions[0], playerDependency: '玩家尚未同意开钟'}]}
  expect(validate(dependent)).toBe(false)
  expect(() => parseChatActionChoiceV1(dependent, window, version)).toThrow('依赖玩家决定')
  const duplicate = structuredClone(choice); duplicate.directions[0].evidenceMessageIds.push('preference')
  expect(() => parseChatActionChoiceV1(duplicate, window, version)).toThrow('重复条目')
})

it('keeps old choice shapes exact and makes message citations explicit only in the new prompt', () => {
  const {window} = context(), legacy = {...choice, directions: choice.directions.map(({evidenceMessageIds: _ids, ...direction}) => ({...direction, evidenceFactKeys: ['lost']}))}
  expect(parseChatActionChoiceV1(legacy, window, 'chat-narrative-action-v52')).toEqual(legacy)
  expect(() => parseChatActionChoiceV1(choice, window, 'chat-narrative-action-v52')).toThrow('字段')
  expect(() => parseChatActionChoiceV1(legacy, window, version)).toThrow('字段')
  expect(buildChatActionChoiceMessagesV1(messages, 'chat-narrative-action-v52')[0].content).not.toContain('evidenceMessageIds')
  const current = buildChatActionChoiceMessagesV1(messages, version)
  expect(current[1]).toEqual(messages[1])
  expect(current[0].content).toContain('evidenceMessageIds')
  expect(current[0].content).toContain('其内容仍可能是猜测')
  expect(current[0].content).toContain('长期目标尚未实现')
  expect(current[0].content).toContain('本轮最多可执行的次数不是必须完成的步数')
})

it.each(['chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56'])('carries a real delivered message through choice, expression, review, durable adoption and branch import for %s', async producerVersion => {
  expect(getSkill('character.chat-narrative-action').promptVersion).toBe('chat-narrative-action-v72')
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => ({...getSkill(id), ...(id === 'character.chat-narrative-action' ? {promptVersion: producerVersion}
    : id === 'character.chat-narrative-action-review' ? {promptVersion: 'chat-narrative-action-review-v35'} : {})}))
  const f = await seedChatNarrativeRuntimeFixture({onlyGuard: true, directorBudget: 20}), base = await readProductRuntimeStateVersion(f.sessionId)
  const player = await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'preference', baseSequence: base.sequence,
    baseStateHash: base.stateHash, messageId: 'preference', text: '我只想知道铜印在哪里，不帮你取。'})
  const afterPlayer = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'respond', baseSequence: afterPlayer.sequence, baseStateHash: afterPlayer.stateHash,
    kind: 'player-response', sourceEventSequence: player.sequence, direction: {actorKey: 'guard', actionLimit: 1}})
  const action = {kind: 'speak', text: '好，我会先弄清铜印在哪里，不把取回铜印的事交给你。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
    audienceKeys: ['player', 'guard'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
  let calls = 0
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: 'character.chat-narrative-action', objective: '回应玩家偏好并自行安排后续', runAI: async input => {
      calls++
      expect(input[1].content).toContain('"messageId":"preference"')
      if (calls === 1) return JSON.stringify(choice)
      expect(input[2].content).toContain('"evidenceMessageIds":["preference"]')
      return JSON.stringify({outcome: 'action', action, handoff: null})
    }, runReviewAI: async () => {calls++; return JSON.stringify(chatActionReviewOutputFixture())}})
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(calls).toBe(3)
  expect(await readChatActionTerminalReceiptV1(f.scope, done.snapshot)).not.toBeNull()
  const state = await readProductRuntimeState(f.sessionId)
  expect(state.interaction!.messages.at(-1)!.text).toBe(action.text)
  db.close(); await db.open()
  expect((await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: done.snapshot.run.id})).receiptHash).toBe(done.receiptHash)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: state.lastSequence, title: 'message-evidence'})
  const childState = await readProductRuntimeState(child.id!)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === 'message-evidence')!
  expect((await readProductRuntimeState(restored.id!)).interaction).toEqual(childState.interaction)
  expect(calls).toBe(3)
})
