import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import Ajv from 'ajv'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {buildInteractionContextWindow, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeActionV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {parseChatActionChoiceV1} from '../../src/lib/character-interaction/action-choice-contract'
import {chatActionRequestOptionsV1} from '../../src/lib/character-interaction/action-output-contract'
import {assertChatControlHandoffContextV1, CHAT_PLAYER_ACKNOWLEDGEMENT_REVIEW_CHECKS_V1, parseChatControlHandoffReviewV1, previewChatControlHandoffV1} from '../../src/lib/character-interaction/control-handoff-contract'
import {parseChatNarrativeOutcomeWireV1} from '../../src/lib/character-interaction/control-handoff-wire'
import {CHAT_PLAYER_ACKNOWLEDGEMENT_PRODUCER_V1 as version, CHAT_PLAYER_ACKNOWLEDGEMENT_RULES_V1, type ChatPlayerAcknowledgementHandoffV1} from '../../src/lib/character-interaction/player-acknowledgement-control'
import {readChatActionTerminalReceiptV1} from '../../src/lib/character-interaction/action-terminal-receipt'
import {validateImportedChatNarrativeEvidenceStateV1} from '../../src/lib/character-interaction/narrative-evidence-import'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {chatActionChoiceFixture, chatActionOutcomeFixture} from '../helpers/chat-action-outcome'
import type {ChatMessage} from '../../src/lib/types'

const originalSkill = skills.getAgentSkillV1
const question = {kind: 'speak', text: '查看你的包裹需要你明确同意，暂时不用回答。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['player', 'guard'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
const choice = {directions: [{id: 'wait', kind: 'wait', action: '等待包裹许可', evidenceFactKeys: ['lost'], evidenceMessageIds: [],
  changes: '保留具体未决许可', playerDependency: '玩家是否允许查看包裹', unconfirmedConditions: ['尚未答复']}], selectedId: 'wait', decisionSummary: '不重复提出相同问题。'}
const isChoice = (messages: ChatMessage[]) => messages[0].content.startsWith('这是尚未发生的角色行动选择草稿')
// Semantic judgments below are injected boundary tests, not model acceptance.
const reviewOutput = () => ({checks: CHAT_PLAYER_ACKNOWLEDGEMENT_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具：仅验证合同与状态边界'}))})

beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => ({...originalSkill(id), ...(id === 'character.chat-narrative-action' ? {promptVersion: version} : {})}))
})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function playerMessage(sessionId: number, text: string, id: string) {
  const base = await readProductRuntimeStateVersion(sessionId)
  return commitInteractionPlayerMessage({sessionId, commandId: id, baseSequence: base.sequence, baseStateHash: base.stateHash, messageId: id, text})
}
async function start(text = '嗯，我在听。') {
  const f = await seedChatNarrativeRuntimeFixture({onlyGuard: true, directorBudget: 120}), base = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'open', baseSequence: base.sequence, baseStateHash: base.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const input = {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '承接当前许可边界'}
  const generated = await generateInteractionRuntimeCandidateV1({...input,
    runAI: async messages => JSON.stringify(isChoice(messages) ? chatActionChoiceFixture(messages, {...choice, directions: [{...choice.directions[0], kind: 'question'}]}) : chatActionOutcomeFixture(messages, question)),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const source = (await readProductRuntimeState(f.sessionId)).interaction!.messages.at(-1)!
  const message = await playerMessage(f.sessionId, text, 'player-ack')
  const next = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'ack-trigger', baseSequence: next.sequence, baseStateHash: next.stateHash,
    kind: 'player-response', sourceEventSequence: message.sequence, direction: {actorKey: 'guard', actionLimit: 1}})
  const handoff: ChatPlayerAcknowledgementHandoffV1 = {version: 4, kind: 'yield-to-player', reason: 'awaiting-player-decision',
    source: {messageId: source.messageId, sequence: source.eventSequence, excerpt: '查看你的包裹需要你明确同意'}, decision: '玩家是否允许查看包裹', dependentStep: '打开包裹查看'}
  const outcome = {outcome: 'handoff', action: null, handoff}, calls: ChatMessage[][] = [], reviews: ChatMessage[][] = []
  const request = {...input, runAI: vi.fn(async (messages: ChatMessage[]) => {
    calls.push(messages); return JSON.stringify(isChoice(messages) ? chatActionChoiceFixture(messages, choice) : outcome)
  }), runReviewAI: vi.fn(async (messages: ChatMessage[]) => {reviews.push(messages); return JSON.stringify(reviewOutput())})}
  return {...f, request, calls, reviews, handoff, outcome, message}
}

it('reviews the exact player response and full exchange before one silent governed event, with no invented progress', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId)
  const generated = await generateInteractionRuntimeCandidateV1(f.request)
  expect(generated.candidate.kind).toBe('chat-control-handoff-candidate')
  for (const rule of CHAT_PLAYER_ACKNOWLEDGEMENT_RULES_V1) expect(f.calls[1][0].content).toContain(rule)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(f.reviews[0][0].content).toContain('latest-player-response')
  expect(f.reviews[0][1].content).toContain('basisMessages')
  expect(f.reviews[0][1].content).toContain(question.text)
  expect(f.reviews[0][1].content).toContain('嗯，我在听。')
  expect(f.reviews[0][1].content).toContain(`"sourceEventSequence":${f.message.sequence}`)
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.messages).toEqual(before.interaction!.messages)
  expect(after.interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
  expect(after.interaction!.chatNarrative!.triggers.at(-1)).toMatchObject({kind: 'player-response', status: 'waiting-player', sourceEventSequence: f.message.sequence,
    actionSequences: [], controlHandoff: {version: 4, sourceMessageId: f.handoff.source.messageId}})
  expect(after.interaction!.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 3)
  expect(done.snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(3)
  expect((await readChatActionTerminalReceiptV1(f.scope, done.snapshot))!.receiptHash).toBe(done.receiptHash)
  db.close(); await db.open()
  expect((await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: done.snapshot.run.id})).receiptHash).toBe(done.receiptHash)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
  expect(f.request.runAI).toHaveBeenCalledTimes(2); expect(f.request.runReviewAI).toHaveBeenCalledTimes(1)
})

it.each(['嗯，为什么要看包裹？', '不允许，请取消搜查。', '好，可以打开。', '先暂停搜查。', '我刚在门口看见铜印。', '你去看看后门。'])('cannot silently consume a failed latest-response review: %s', async text => {
  const f = await start(text), before = await readProductRuntimeState(f.sessionId), output = reviewOutput()
  output.checks.find(check => check.check === 'latest-player-response')!.passed = false
  const reviewer = vi.fn(async () => JSON.stringify(output))
  await expect(generateInteractionRuntimeCandidateV1({...f.request, runReviewAI: reviewer})).rejects.toThrow('审查未通过')
  const run = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  expect((await readInstanceAgentRunV1(f.scope, run!.id!)).projection.state).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: run!.id!})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(f.request.runAI).toHaveBeenCalledTimes(2); expect(reviewer).toHaveBeenCalledTimes(1)
})

it('does not accept five-check legacy reviews or output v4 under the previous producer', async () => {
  const f = await start(), old = reviewOutput()
  old.checks.pop()
  expect(() => parseChatControlHandoffReviewV1({reviewedHandoffJson: canonicalStringify(f.handoff), ...old}, f.handoff)).toThrow('必要项目')
  expect(() => parseChatNarrativeOutcomeWireV1(f.outcome, 'chat-narrative-action-v71')).toThrow('旧生成合同')
  for (const provider of ['codex', 'agnes'] as const) {
    expect(new Ajv().compile(chatActionRequestOptionsV1(version, provider, true)!.jsonSchema!.schema)(f.outcome)).toBe(true)
    expect(new Ajv().compile(chatActionRequestOptionsV1('chat-narrative-action-v71', provider, true)!.jsonSchema!.schema)(f.outcome)).toBe(false)
  }
  const state = (await readProductRuntimeState(f.sessionId)).interaction!, trigger = state.chatNarrative!.triggers.at(-1)!
  expect(() => previewChatControlHandoffV1(state, {sequence: trigger.requestedSequence + 1, triggerSequence: trigger.requestedSequence,
    actorKey: 'guard', handoff: {...f.handoff, version: 1}})).toThrow('明确继续')
})

it('rejects disconnected, invisible, replaced, stale and wrong-trigger player sources before review', async () => {
  const f = await start(), original = (await readProductRuntimeState(f.sessionId)).interaction!
  const cases = ['missing', 'wrong-role', 'private', 'excluded', 'superseded', 'newer', 'wrong-trigger', 'already-acted']
  for (const kind of cases) {
    const state = structuredClone(original), trigger = state.chatNarrative!.triggers.at(-1)!, message = state.messages.at(-1)!
    if (kind === 'missing') state.messages.pop()
    if (kind === 'wrong-role') message.role = 'character'
    if (kind === 'private') message.audienceKeys = ['player', 'artisan']
    if (kind === 'excluded') state.chatNarrative!.excludedMessageIds = [message.messageId]
    if (kind === 'superseded') message.supersededBySequence = trigger.requestedSequence
    if (kind === 'newer') state.messages.push({...message, messageId: 'later', eventSequence: trigger.requestedSequence + 1})
    if (kind === 'wrong-trigger') trigger.kind = 'continue'
    if (kind === 'already-acted') trigger.actionSequences = [trigger.requestedSequence + 1]
    expect(() => previewChatControlHandoffV1(state, {sequence: trigger.requestedSequence + 2, triggerSequence: trigger.requestedSequence,
      actorKey: 'guard', handoff: f.handoff}), kind).toThrow()
  }
  const context = buildInteractionContextWindow(original, 'guard', {retrievalVersion: 'chat-relevance-v14'})
  expect(() => assertChatControlHandoffContextV1(f.handoff, context)).not.toThrow()
  context.messages = context.messages.filter(message => message.role !== 'player')
  expect(() => assertChatControlHandoffContextV1(f.handoff, context)).toThrow('真实玩家回应')
})

it('preserves available independent actions instead of treating the acknowledgement as a stop instruction', async () => {
  const f = await start(), state = (await readProductRuntimeState(f.sessionId)).interaction!
  const context = buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'chat-relevance-v14'})
  const draft = {...choice, possibilityChecks: context.chatNarrative!.possibilities.map((_, index) => ({index, disposition: 'available', reason: '此方向不依赖许可'}))}
  expect(() => parseChatActionChoiceV1(draft, context, version)).toThrow('仍有可推进方向')
  const action = {...question, kind: 'complete', text: '叶岑走到门边，查看自己脚边能看清的地面。', waitingForPlayer: false}
  const generated = await generateInteractionRuntimeCandidateV1({...f.request,
    runAI: async messages => JSON.stringify(isChoice(messages) ? chatActionChoiceFixture(messages, {...draft,
      directions: [{...choice.directions[0], kind: 'own-action', playerDependency: null}]}) : chatActionOutcomeFixture(messages, action)),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages.at(-1)!.text).toBe(action.text)
})

it('rejects adoption after another real player message rather than silently rebinding the candidate', async () => {
  const f = await start(), generated = await generateInteractionRuntimeCandidateV1(f.request)
  await playerMessage(f.sessionId, '我不同意打开。', 'new-refusal')
  const before = await readProductRuntimeState(f.sessionId)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(f.request.runAI).toHaveBeenCalledTimes(2); expect(f.request.runReviewAI).toHaveBeenCalledTimes(1)
})

it('resumes retained expression bytes after closing the database without resending choice or expression', async () => {
  const f = await start()
  await expect(generateInteractionRuntimeCandidateV1({...f.request, onActionExpressionBoundary: name => {
    if (name === 'candidate.persisted') throw Error('host-interrupted')
  }})).rejects.toThrow('host-interrupted')
  const row = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  db.close(); await db.open()
  const recovered = await resumeChatNarrativeActionV1({...f.request, runId: row!.id!})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: recovered.snapshot.run.id})
  expect(f.request.runAI).toHaveBeenCalledTimes(2); expect(f.request.runReviewAI).toHaveBeenCalledTimes(1)
})

it('preserves v4 and exact signed player references through branching, import and a second export/import', async () => {
  const f = await start(), generated = await generateInteractionRuntimeCandidateV1(f.request)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const parent = await readProductRuntimeState(f.sessionId)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: parent.lastSequence, title: 'acknowledgement branch'})
  const branchState = await readProductRuntimeState(branch.id!)
  const trigger = branchState.interaction!.chatNarrative!.triggers.at(-1)!
  expect(trigger.controlHandoff!.version).toBe(4)
  expect(trigger.controlHandoff!.sourceSequence).toBeLessThan(trigger.sourceEventSequence)
  expect(trigger.sourceEventSequence).toBeLessThan(trigger.requestedSequence)
  expect(trigger.requestedSequence).toBeLessThan(0)
  expect(parseInteractionState(branchState.interaction)).toEqual(branchState.interaction)
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const importedAgain = await importProjectJSON(await exportProjectJSON(imported))
  db.close(); await db.open()
  for (const projectId of [imported, importedAgain]) {
    const sessions = await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()
    expect((await readProductRuntimeState(sessions.find(session => session.title === 'acknowledgement branch')!.id!)).interaction).toEqual(branchState.interaction)
  }
  const malformed = structuredClone(branchState.interaction!)
  malformed.chatNarrative!.triggers.at(-1)!.sourceEventSequence = trigger.controlHandoff!.sourceSequence
  expect(() => parseInteractionState(malformed)).toThrow()
  expect(() => validateImportedChatNarrativeEvidenceStateV1(JSON.stringify({interaction: branchState.interaction}), 'ai-town')).toThrow('其他产品')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(parent)
  expect(f.request.runAI).toHaveBeenCalledTimes(2); expect(f.request.runReviewAI).toHaveBeenCalledTimes(1)
})

it('responds normally to the next actual refusal and question after silent handoff', async () => {
  const f = await start(), generated = await generateInteractionRuntimeCandidateV1(f.request)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const message = await playerMessage(f.sessionId, '包裹先不看，你为什么怀疑它？', 'player-question')
  const base = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'question-trigger', baseSequence: base.sequence, baseStateHash: base.stateHash,
    kind: 'player-response', sourceEventSequence: message.sequence})
  const answer = {...question, text: '我没有证据怀疑你的包裹，刚才只是提出一种排查可能。', waitingForPlayer: false}
  const response = await generateInteractionRuntimeCandidateV1({...f.request,
    runAI: async messages => JSON.stringify(isChoice(messages) ? chatActionChoiceFixture(messages, {...choice,
      directions: [{...choice.directions[0], kind: 'own-action', playerDependency: null}]}) : chatActionOutcomeFixture(messages, answer)),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: response.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.at(-1)!.text).toBe(answer.text)
  expect(state.chatNarrative!.triggers.at(-2)!.controlHandoff!.version).toBe(4)
  expect(parseInteractionState(state)).toEqual(state)
})
