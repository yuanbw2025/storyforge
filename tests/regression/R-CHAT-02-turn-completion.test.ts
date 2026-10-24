import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, parseChatNarrativeActionReviewV1} from '../../src/lib/character-interaction/narrative-actions'
import {advanceChatNarrativeTurnV1, readChatNarrativeTurnResumeV1} from '../../src/lib/character-interaction/narrative-turn'
import {assertChatTurnCompletionBindingV1, assertChatTurnCompletionReviewVersionV1, parseChatTurnCompletionV1} from '../../src/lib/character-interaction/turn-completion'
import {chatActionRequestOptionsV1} from '../../src/lib/character-interaction/action-output-contract'
import {compileChatActionWireV1} from '../../src/lib/character-interaction/action-wire'
import {chatActionReviewFixture, chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const realGenerate = harness.generateInteractionRuntimeCandidateV1
const action: ChatNarrativeActionV1 = {kind: 'complete', text: '叶岑把油灯移到门边。门边亮了起来。“入口先照亮了，我会自己继续找，不要求你帮忙。”',
  goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
  newFacts: [{factKey: 'lit-entry', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}],
  disclosures: [], threadUpdates: [], goalStatus: null,
  turnCompletion: {version: 1, purpose: '照亮入口并回应玩家拒绝帮忙', evidenceExcerpt: '门边亮了起来。“入口先照亮了，我会自己继续找，不要求你帮忙。”'}}
const check = {passed: true, reason: '工程注入：这一步照亮入口并回应拒绝；不代表真实模型质量通过'}
const reviewed = (value = action) => ({...chatActionReviewFixture(value), turnCompletionCheck: check})
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function playerInput() {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 2, onlyGuard: true})
  const base = await readProductRuntimeStateVersion(f.sessionId)
  const message = await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'refusal', baseSequence: base.sequence,
    baseStateHash: base.stateHash, messageId: 'refusal', text: '我不想帮忙，你自己安排吧。'})
  return {...f, message}
}
async function prepared() {
  const f = await playerInput(), base = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'respond', baseSequence: base.sequence,
    baseStateHash: base.stateHash, kind: 'player-response', sourceEventSequence: f.message.sequence, direction: {actorKey: 'guard', actionLimit: 2}})
  return {...f, trigger}
}
function request(f: Awaited<ReturnType<typeof prepared>>, value = action, passed = true) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const,
    objective: '回应拒绝，落实自己的局部行动后自然结束本轮', runAI: withChatActionChoiceFixture(async messages => {
      expect(messages[0].content).toContain('turnCompletion')
      expect(JSON.stringify(messages)).not.toContain('掌柜把铜印留在柜台下')
      return JSON.stringify(value)
    }), runReviewAI: async (messages: Array<{content: string}>) => {
      expect(messages[0].content).toContain('本轮结束专审')
      expect(messages[1].content).toContain('我不想帮忙，你自己安排吧。')
      return JSON.stringify({...chatActionReviewOutputFixture(), turnCompletionCheck: {...check, passed}})
    }}
}

it('adopts one meaningful response and ends only this turn, preserving goals and remaining allowance', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  const generated = await realGenerate(request(f))
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(generated.snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(3)
  const adopted = await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId), story = after.interaction!.chatNarrative!
  expect(story.triggers.at(-1)).toMatchObject({status: 'complete', actionSequences: [adopted.event!.sequence]})
  expect(story.situation.goals).toEqual(before.interaction!.chatNarrative!.situation.goals)
  expect(story.situation.threads).toEqual(before.interaction!.chatNarrative!.situation.threads)
  expect(after.interaction!.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 3)
  expect(after.interaction!.messages.map(message => message.role)).toEqual(['player', 'character'])
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, after.interaction!)).toBeNull()
  db.close(); await db.open()
  expect((await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).receiptHash).toBe(adopted.receiptHash)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: 'local-completion'})
  const childState = await readProductRuntimeState(child.id!)
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const copied = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(session => session.title === 'local-completion')!
  expect((await readProductRuntimeState(copied.id!)).interaction).toEqual(childState.interaction)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
})

it('stops the actual two-action loop after adoption and allows a fresh explicitly continued turn', async () => {
  const f = await playerInput()
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => realGenerate({...input,
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify({...chatActionReviewOutputFixture(), turnCompletionCheck: check})}))
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'player-response', replyToSequence: f.message.sequence,
    participantKey: 'guard', expectedSequence: f.message.sequence, actionLimit: 2, aiConfig: {} as never})
  expect(spy).toHaveBeenCalledTimes(1)
  const prior = await readProductRuntimeState(f.sessionId), base = await readProductRuntimeStateVersion(f.sessionId)
  const next = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'continue', baseSequence: base.sequence,
    baseStateHash: base.stateHash, kind: 'continue', sourceEventSequence: base.sequence, direction: {actorKey: 'guard', actionLimit: 2}})
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.chatNarrative!.triggers.at(-1)).toMatchObject({status: 'ready', requestedSequence: next.sequence})
  expect(after.interaction!.chatNarrative!.situation).toEqual(prior.interaction!.chatNarrative!.situation)
  expect(spy).toHaveBeenCalledTimes(1)
})

it('resumes and adopts a fact-free completed response once and preserves it in a portable branch', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  const text = '明白，你不想帮忙；这不是同意参加，也不代表让我放弃寻找。'
  const response: ChatNarrativeActionV1 = {...action, kind: 'speak', text, evidenceFactKeys: [], newFacts: [], nextPossibilities: null,
    turnCompletion: {version: 1, purpose: '确认玩家拒绝参与，保留自己原有目标', evidenceExcerpt: text}}
  let runId = 0
  await expect(realGenerate({...request(f, response), onNarrativeActionSaved: id => {runId = id; throw Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  let reviewCalls = 0
  await harness.resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {
    reviewCalls++; return JSON.stringify({...chatActionReviewOutputFixture(), turnCompletionCheck: check})
  }})
  const adopted = await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect((await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).receiptHash).toBe(adopted.receiptHash)
  expect(reviewCalls).toBe(1)
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
  expect(after.interaction!.chatNarrative!.triggers.at(-1)!.status).toBe('complete')
  expect(after.interaction!.messages.at(-1)!.text).toBe(text)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: 'message-completion'})
  const childState = await readProductRuntimeState(child.id!), imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const copied = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(session => session.title === 'message-completion')!
  expect((await readProductRuntimeState(copied.id!)).interaction).toEqual(childState.interaction)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
})

it('rejects failed or missing completion review without committing or silently retrying', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  await expect(realGenerate(request(f, action, false))).rejects.toThrow('行动语义审查未通过')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRuns.toArray()).filter(run => run.status === 'failed')).toHaveLength(1)
  expect(() => parseChatNarrativeActionReviewV1(chatActionReviewFixture(action), action)).toThrow('缺少独立审查')
  expect(() => parseChatNarrativeActionReviewV1({...reviewed(), turnCompletionCheck: null}, action)).toThrow()
})

it('cannot hide waiting, whole-goal changes, pending results, editing or ensemble behind turn completion', async () => {
  const f = await prepared(), original = (await readProductRuntimeState(f.sessionId)).interaction!
  const input = {sequence: f.trigger.sequence + 1, triggerSequence: f.trigger.sequence, actorKey: 'guard', messageId: 'response', action, review: reviewed()}
  for (const patch of [{waitingForPlayer: true}, {kind: 'pause'}, {goalStatus: 'paused'}, {goalStatus: 'fulfilled'},
    {turnCompletion: {...action.turnCompletion!, evidenceExcerpt: '上次已经完成了'}},
    {situationRequest: {threadKey: 'investigate', direction: '取得检查结果', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}}]) {
    const changed = {...action, ...patch} as ChatNarrativeActionV1
    expect(() => applyReviewedChatNarrativeActionV1(original, {...input, action: changed, review: reviewed(changed)})).toThrow('[chat-turn-completion]')
  }
  const pending = structuredClone(original); pending.chatNarrative!.pendingSituation = {actorKey: 'guard', purpose: 'observation-result'} as never
  expect(() => applyReviewedChatNarrativeActionV1(pending, input)).toThrow('不能跳过')
  const edited = structuredClone(original); edited.chatNarrative!.pendingEdit = {role: 'character'} as never
  expect(() => applyReviewedChatNarrativeActionV1(edited, input)).toThrow('不能跳过')
  const group = structuredClone(original); group.chatNarrative!.triggers.at(-1)!.direction!.scheduling = {mode: 'natural'} as never
  expect(() => applyReviewedChatNarrativeActionV1(group, input)).toThrow()
  expect(() => applyChatNarrativeActionV1(original, input)).toThrow('旧行动事件不可采用')
  expect(original).toEqual((await readProductRuntimeState(f.sessionId)).interaction)
})

it('binds the completion check to the exact action and cannot accept an old producer or reviewer', () => {
  expect(() => parseChatNarrativeActionReviewV1(reviewed(), {...action, text: action.text + '篡改'})).toThrow('另一份候选')
  expect(() => assertChatTurnCompletionReviewVersionV1([action], 'chat-narrative-action-review-v34')).toThrow('旧审查合同')
  expect(() => assertChatTurnCompletionBindingV1(action, {executionBindings: []})).toThrow('原生成合同')
  expect(() => compileChatActionWireV1(action, 'chat-narrative-action-v51')).toThrow('旧生成合同')
  expect(chatActionRequestOptionsV1('chat-narrative-action-v51', 'codex')!.jsonSchema!.schema).not.toHaveProperty('properties.action.anyOf.0.properties.turnCompletion')
  expect(chatActionRequestOptionsV1('chat-narrative-action-v52', 'codex')!.jsonSchema!.schema).toHaveProperty('properties.action.anyOf.0.properties.turnCompletion')
  for (const value of [null, {}, {...action.turnCompletion, version: 2}, {...action.turnCompletion, purpose: ''}, {...action.turnCompletion, force: true}]) {
    expect(() => parseChatTurnCompletionV1(value)).toThrow()
  }
})

it.each([66, 67, 68, 69, 70])('retains the exact completion review pairing for action v%s', version => {
  const bindings = (reviewVersion: number) => ({executionBindings: [
    {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-narrative-action', promptVersion: `chat-narrative-action-v${version}`},
    {stepId: 'interaction:action-review', skillId: 'character.chat-narrative-action-review', promptVersion: `chat-narrative-action-review-v${reviewVersion}`},
  ]})
  expect(() => assertChatTurnCompletionBindingV1(action, bindings(version === 70 ? 42 : 41))).not.toThrow()
  expect(() => assertChatTurnCompletionBindingV1(action, bindings(version === 70 ? 41 : 42))).toThrow('生成与审查版本不匹配')
})

it('retains a candidate after interruption but refuses adopting it over a new player message', async () => {
  const f = await prepared(), generated = await realGenerate(request(f)), base = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'new-request', baseSequence: base.sequence,
    baseStateHash: base.stateHash, messageId: 'new-request', text: '先停一下，我还有一个问题。'})
  const before = await readProductRuntimeState(f.sessionId)
  await expect(harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})
