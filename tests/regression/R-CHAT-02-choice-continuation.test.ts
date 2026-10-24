import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import Ajv from 'ajv'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {buildChatActionChoiceMessagesV1, chatActionChoiceRequestOptionsV1, parseChatActionChoiceV1} from '../../src/lib/character-interaction/action-choice-contract'
import {CHAT_CHOICE_CONTINUATION_PRODUCER_V1 as version, assertChatChoiceExpressionV1} from '../../src/lib/character-interaction/action-choice-continuation'
import {chatActionRequestOptionsV1} from '../../src/lib/character-interaction/action-output-contract'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatNarrativeActionV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {readChatActionTerminalReceiptV1} from '../../src/lib/character-interaction/action-terminal-receipt'
import {CHAT_CONTROL_HANDOFF_REVIEW_CHECKS_V1} from '../../src/lib/character-interaction/control-handoff-contract'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {chatActionOutcomeFixture} from '../helpers/chat-action-outcome'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatMessage} from '../../src/lib/types'

const originalSkill = skills.getAgentSkillV1
const action = {kind: 'speak', text: '查看你的包裹需要你明确同意，暂时不用回答。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['player', 'guard'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
const review = () => ({checks: CHAT_CONTROL_HANDOFF_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具，不是模型质量证明'}))})
function draft(count: number, kind = 'wait') {
  return {possibilityChecks: Array.from({length: count}, (_, index) => ({index, disposition: 'blocked', reason: '工程夹具：此方向本身需要包裹许可'})),
    directions: [{id: 'next', kind, action: kind === 'wait' ? '静默等待包裹许可' : '说明包裹许可边界', evidenceFactKeys: ['lost'], evidenceMessageIds: [],
      changes: '保留具体许可决定，不声称取得许可', playerDependency: '玩家是否允许查看包裹', unconfirmedConditions: []}], selectedId: 'next', decisionSummary: '依照本次已知许可边界选择。'}
}
function roleDraft(messages: ChatMessage[], kind: string) {
  const role = JSON.parse(messages[1].content.split('\n').find(line => line.startsWith('{"situationKey"'))!)
  return draft(role.possibilities.length, kind)
}
const isChoice = (messages: ChatMessage[]) => messages[0].content.startsWith('这是尚未发生的角色行动选择草稿')
beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => ({...originalSkill(id), ...(id === 'character.chat-narrative-action' ? {promptVersion: version} : {})}))
})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function start() {
  const f = await seedChatNarrativeRuntimeFixture({onlyGuard: true, directorBudget: 30}), base = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'open', baseSequence: base.sequence, baseStateHash: base.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const request = {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '处理当前许可边界'}
  const generated = await generateInteractionRuntimeCandidateV1({...request,
    runAI: async messages => JSON.stringify(isChoice(messages) ? roleDraft(messages, 'question') : chatActionOutcomeFixture(messages, action)),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const previous = await readProductRuntimeStateVersion(f.sessionId), source = (await readProductRuntimeState(f.sessionId)).interaction!.messages.at(-1)!
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'continue', baseSequence: previous.sequence, baseStateHash: previous.stateHash,
    kind: 'continue', sourceEventSequence: previous.sequence, direction: {actorKey: 'guard', actionLimit: 1}})
  const outcome = {outcome: 'handoff', action: null, handoff: {version: 1, kind: 'yield-to-player', reason: 'awaiting-player-decision',
    source: {messageId: source.messageId, sequence: source.eventSequence, excerpt: '查看你的包裹需要你明确同意'}, decision: '是否允许查看包裹', dependentStep: '打开包裹查看'}}
  const runAI = vi.fn(async (messages: ChatMessage[]) => JSON.stringify(isChoice(messages) ? roleDraft(messages, 'wait') : outcome))
  const runReviewAI = vi.fn(async () => JSON.stringify(review()))
  return {...f, request: {...request, runAI, runReviewAI}, outcome}
}

it('covers every delivered own direction and rejects omission, duplicates and a wait contradicting an available direction', async () => {
  const f = await start(), state = await readProductRuntimeState(f.sessionId)
  const context = buildInteractionContextWindow(state.interaction!, 'guard', {retrievalVersion: 'chat-relevance-v14'})
  // This second, independent direction is visible to the actor, unlike another actor's private plans.
  context.chatNarrative!.possibilities.push({actorKey: 'guard', text: '先讨论自己的巡查安排，不需要玩家打开包裹', evidenceFactKeys: ['lost']})
  const value = draft(context.chatNarrative!.possibilities.length)
  expect(parseChatActionChoiceV1(value, context, version).possibilityChecks).toHaveLength(value.possibilityChecks.length)
  expect(() => parseChatActionChoiceV1({...value, possibilityChecks: value.possibilityChecks.slice(1)}, context, version)).toThrow('逐项')
  const duplicate = structuredClone(value); duplicate.possibilityChecks.at(-1)!.index = 0
  expect(() => parseChatActionChoiceV1(duplicate, context, version)).toThrow('重复')
  const available = structuredClone(value); available.possibilityChecks.at(-1)!.disposition = 'available'
  expect(() => parseChatActionChoiceV1(available, context, version)).toThrow('仍有可推进方向')
  expect(() => parseChatActionChoiceV1({...available, directions: [], selectedId: null}, context, version)).toThrow('仍有可推进方向')
  const question = {...available, directions: [{...available.directions[0], kind: 'question'}]}
  expect(parseChatActionChoiceV1(question, context, version).directions[0].kind).toBe('question')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
})

it.each(['player-response', 'scene-start', 'return'] as const)('does not swallow a %s trigger by silently waiting', async kind => {
  const f = await start(), state = await readProductRuntimeState(f.sessionId)
  const context = buildInteractionContextWindow(state.interaction!, 'guard', {retrievalVersion: 'chat-relevance-v14'})
  context.chatNarrative!.trigger!.kind = kind
  expect(() => parseChatActionChoiceV1(draft(context.chatNarrative!.possibilities.length), context, version)).toThrow('静默等待')
})

it.each(['codex', 'agnes'] as const)('uses a narrow %s wait schema without accepting an ordinary speech or another handoff kind', provider => {
  const schema = chatActionRequestOptionsV1(version, provider, true)!.jsonSchema!
  const validate = new Ajv().compile(schema.schema)
  const handoff = {version: 1, kind: 'yield-to-player', reason: 'awaiting-player-decision', source: {messageId: 'm1', sequence: 1, excerpt: '需要你同意'}, decision: '许可', dependentStep: '查看'}
  expect(validate({outcome: 'handoff', action: null, handoff})).toBe(true)
  expect(validate({outcome: 'action', action, handoff: null})).toBe(false)
  expect(validate({outcome: 'handoff', action: null, handoff: {...handoff, version: 2}})).toBe(false)
  const choose = new Ajv().compile(chatActionChoiceRequestOptionsV1(provider, version)!.jsonSchema!.schema)
  expect(choose(draft(2))).toBe(true)
  const {possibilityChecks: _checks, ...old} = draft(2)
  expect(choose(old)).toBe(false)
  expect(chatActionRequestOptionsV1('chat-narrative-action-v70', provider, true)).toEqual(chatActionRequestOptionsV1('chat-narrative-action-v70', provider))
  expect(new Ajv().compile(chatActionChoiceRequestOptionsV1(provider, 'chat-narrative-action-v70')!.jsonSchema!.schema)(old)).toBe(true)
})

it('keeps the reviewed wait silent through adoption, refresh and independent import with all three calls accounted for', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId)
  const generated = await generateInteractionRuntimeCandidateV1(f.request)
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = await readProductRuntimeState(f.sessionId)
  expect(state.interaction!.messages).toEqual(before.interaction!.messages)
  expect(state.interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
  expect(state.interaction!.chatNarrative!.triggers.at(-1)!.status).toBe('waiting-player')
  expect(done.snapshot.events.filter(e => e.type === 'model.requested')).toHaveLength(3)
  expect((await readChatActionTerminalReceiptV1(f.scope, done.snapshot))!.receiptHash).toBe(done.receiptHash)
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const copied = await db.productRuntimeSessions.where('projectId').equals(imported).first()
  db.close(); await db.open()
  expect((await readProductRuntimeState(copied!.id!)).interaction).toEqual(state.interaction)
  expect((await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: done.snapshot.run.id})).receiptHash).toBe(done.receiptHash)
  expect(f.request.runAI).toHaveBeenCalledTimes(2); expect(f.request.runReviewAI).toHaveBeenCalledTimes(1)
})

it('retains a redundant speech as a failed raw response and does not retry, review or adopt it after refresh', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId)
  const raw = JSON.stringify({outcome: 'action', action: {...action, text: '我先说到这里，等你决定。'}, handoff: null})
  const runAI = vi.fn(async (messages: ChatMessage[]) => isChoice(messages) ? JSON.stringify(roleDraft(messages, 'wait')) : raw)
  await expect(generateInteractionRuntimeCandidateV1({...f.request, runAI})).rejects.toThrow('静默等待必须交还控制')
  const run = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  const saved = await readInstanceAgentRunV1(f.scope, run!.id!)
  expect(saved.projection.state).toBe('failed')
  expect((await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()).some(row => row.artifactKind === 'raw-response' && row.content === raw)).toBe(true)
  db.close(); await db.open()
  await expect(resumeChatNarrativeActionV1({...f.request, runAI, runId: run!.id!})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(runAI).toHaveBeenCalledTimes(2); expect(f.request.runReviewAI).not.toHaveBeenCalled()
})

it('still rejects a semantically unsupported wait even if its coverage and expression shapes are valid', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), output = review()
  output.checks.find(c => c.check === 'available-direction')!.passed = false
  await expect(generateInteractionRuntimeCandidateV1({...f.request, runReviewAI: async () => JSON.stringify(output)})).rejects.toThrow('审查未通过')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('keeps historical choice fields and expression bytes valid without silently upgrading their contract', () => {
  const messages: ChatMessage[] = [{role: 'system', content: '原规则'}, {role: 'user', content: '原角色资料'}]
  expect(buildChatActionChoiceMessagesV1(messages, 'chat-narrative-action-v70')[0].content).not.toContain('possibilityChecks')
  expect(buildChatActionChoiceMessagesV1(messages, version)[1]).toEqual(messages[1])
  const choice = {...draft(0), directions: [{...draft(0).directions[0], kind: 'wait' as const}]}
  const output = JSON.stringify({outcome: 'action', action, handoff: null})
  expect(() => assertChatChoiceExpressionV1(output, choice, 'chat-narrative-action-v70')).not.toThrow()
  expect(() => assertChatChoiceExpressionV1(output, choice, version)).toThrow('静默等待必须交还控制')
})
