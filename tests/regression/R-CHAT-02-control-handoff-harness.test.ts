import {chatActionOutcomeFixture, chatActionChoiceFixture} from '../helpers/chat-action-outcome'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {adoptInteractionRuntimeCandidateV1, cancelInteractionRuntimeRunV1, generateInteractionRuntimeCandidateV1, readInteractionRuntimeCandidateV1, resumeChatNarrativeActionV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitChatControlHandoff, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {CHAT_CONTROL_HANDOFF_REVIEW_CHECKS_V1, type ChatControlHandoffV1} from '../../src/lib/character-interaction/control-handoff-contract'
import {parseChatNarrativeOutcomeWireV1} from '../../src/lib/character-interaction/control-handoff-wire'
import {readChatActionTerminalReceiptV1} from '../../src/lib/character-interaction/action-terminal-receipt'
import {readChatActionOutputBudgetV1} from '../../src/lib/character-interaction/action-choice-output-budget'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatMessage} from '../../src/lib/types'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'

const originalSkill = skills.getAgentSkillV1
const action = {kind: 'speak', text: '查看你的包裹需要你明确同意，暂时不用回答。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
const choice = {directions: [{id: 'wait', action: '等待是否允许查看包裹的决定', evidenceFactKeys: ['lost'], evidenceMessageIds: [], changes: '不将继续当作许可',
  playerDependency: '玩家是否同意', unconfirmedConditions: ['尚未答复'], kind: 'wait'}], selectedId: 'wait', decisionSummary: '保留玩家的许可决定，不制造新进展。'}
const reviewOutput = () => ({checks: CHAT_CONTROL_HANDOFF_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程语义夹具，不是质量验收'}))})
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function start() {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 40}), base = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'open', baseSequence: base.sequence, baseStateHash: base.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: 'character.chat-narrative-action', objective: '说明许可边界', runAI: async messages => JSON.stringify(messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? chatActionChoiceFixture(messages, {...choice, directions: [{...choice.directions[0], kind: 'question'}]}) : chatActionOutcomeFixture(messages, action)),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = await readProductRuntimeState(f.sessionId), source = state.interaction!.messages.slice(-1)[0]
  const before = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'continue', baseSequence: before.sequence, baseStateHash: before.stateHash,
    kind: 'continue', sourceEventSequence: before.sequence, direction: {actorKey: 'guard', actionLimit: 1}})
  const handoff: ChatControlHandoffV1 = {version: 1, kind: 'yield-to-player', reason: 'awaiting-player-decision', source: {messageId: source.messageId, sequence: source.eventSequence,
    excerpt: '查看你的包裹需要你明确同意'}, decision: '玩家是否允许查看包裹', dependentStep: '打开包裹查看'}
  return {...f, trigger, handoff}
}
function enable() {
  expect(originalSkill('character.chat-narrative-action').promptVersion).toBe('chat-narrative-action-v72')
  expect(originalSkill('character.chat-narrative-action-review').promptVersion).toBe('chat-narrative-action-review-v42')
}
function legacy() {
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => ({...originalSkill(id),
    ...(id === 'character.chat-narrative-action' ? {promptVersion: 'chat-narrative-action-v45'}
      : id === 'character.chat-narrative-action-review' ? {promptVersion: 'chat-narrative-action-review-v32'} : {})}))
}

function request(f: Awaited<ReturnType<typeof start>>) {
  const calls: ChatMessage[][] = [], reviews: ChatMessage[][] = []
  return {calls, reviews, input: {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const,
    objective: '承接局面；合理等待时交还控制，不重复台词', runAI: async (messages: ChatMessage[]) => {
      calls.push(messages)
      return JSON.stringify(messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? chatActionChoiceFixture(messages, choice) : {outcome: 'handoff', action: null, handoff: f.handoff})
    }, runReviewAI: async (messages: ChatMessage[]) => {reviews.push(messages); return JSON.stringify(reviewOutput())}}}
}

it('uses the actual choice/result/review chain and one governed event with no duplicate bubble', async () => {
  const f = await start(); enable()
  const before = await readProductRuntimeState(f.sessionId), run = request(f), generated = await generateInteractionRuntimeCandidateV1(run.input)
  for (const messages of run.calls) {
    expect(messages[1].content).toContain(`"messageId":${JSON.stringify(f.handoff.source.messageId)},"sequence":${f.handoff.source.sequence}`)
  }
  expect(run.calls[1][2].content).not.toContain('只输出原格式完整行动候选')
  expect(run.calls[1][2].content).toContain('outcome/action/handoff')
  expect(generated.candidate.kind).toBe('chat-control-handoff-candidate')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.reviews[0][1].content).toContain('basisMessages')
  expect(run.reviews[0][1].content).toContain(`"actionChoice":${canonicalStringify(chatActionChoiceFixture(run.calls[0], choice))}`)
  expect(run.reviews[0][1].content).toContain(action.text)
  expect(run.reviews[0][0].content).toContain('available-direction')
  await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().recoverableRunIds).toContain(generated.snapshot.run.id)
  expect(store.getState().pendingNarrativeActionRunIds).not.toContain(generated.snapshot.run.id)
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(done.event!.type).toBe('interaction.narrative.control-handoff.committed')
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.messages).toEqual(before.interaction!.messages)
  expect(after.interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
  expect(after.interaction!.chatNarrative!.triggers.slice(-1)[0]).toMatchObject({status: 'waiting-player', actionSequences: [], controlHandoff: {sourceMessageId: f.handoff.source.messageId}})
  expect(after.interaction!.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 3)
  expect((await readChatActionOutputBudgetV1(f.scope, done.snapshot))!.calls).toHaveLength(3)
  const receipt = (await readChatActionTerminalReceiptV1(f.scope, done.snapshot))!
  expect(receipt.receiptHash).toBe(done.receiptHash)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
  db.close(); await db.open()
  const repeated = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: done.snapshot.run.id})
  expect(repeated.receiptHash).toBe(done.receiptHash)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
  await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().recoverableRunIds).not.toContain(done.snapshot.run.id)
  expect(store.getState().pendingNarrativeActionRunIds).not.toContain(done.snapshot.run.id)
})

it.each(CHAT_CONTROL_HANDOFF_REVIEW_CHECKS_V1)('cannot adopt a failed %s review or silently retry it', async check => {
  const f = await start(); enable()
  const run = request(f), before = await readProductRuntimeState(f.sessionId)
  const output = reviewOutput(); output.checks.find(item => item.check === check)!.passed = false
  await expect(generateInteractionRuntimeCandidateV1({...run.input, runReviewAI: async () => JSON.stringify(output)})).rejects.toThrow('审查未通过')
  const row = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  expect(row!.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: row!.id!})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(2)
})

it('retains ordinary independent actions under the new producer', async () => {
  const f = await start(); enable()
  const independent = {...action, text: '叶岑走到门边，查看自己脚边能看清的地面。', kind: 'complete', waitingForPlayer: false}
  const run = request(f), input = {...run.input, runAI: async (messages: ChatMessage[]) => JSON.stringify(messages[0].content.startsWith('这是尚未发生的角色行动选择草稿')
    ? chatActionChoiceFixture(messages, {...choice, directions: [{...choice.directions[0], kind: 'own-action', playerDependency: null}]}) : {outcome: 'action', action: independent, handoff: null}), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}
  const generated = await generateInteractionRuntimeCandidateV1(input)
  expect(generated.candidate.kind).toBe('chat-narrative-action-candidate')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages.slice(-1)[0].text).toBe(independent.text)
})

it('still vetoes meaningless ordinary speech instead of reclassifying it as a handoff', async () => {
  const f = await start(); enable()
  const run = request(f), output = chatActionReviewOutputFixture(), before = await readProductRuntimeState(f.sessionId)
  output.checks.find(check => check.check === 'meaningful-direction')!.passed = false
  await expect(generateInteractionRuntimeCandidateV1({...run.input,
    runAI: async messages => JSON.stringify(messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? chatActionChoiceFixture(messages, {...choice, directions: [{...choice.directions[0], kind: 'question'}]}) : {outcome: 'action', action, handoff: null}),
    runReviewAI: async () => JSON.stringify(output)})).rejects.toThrow('审查未通过')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('does not resend an unknown review after refresh or a recovery request', async () => {
  const f = await start(); enable()
  const run = request(f), reviewer = vi.fn(async () => {throw new Error('network-result-unknown')})
  await expect(generateInteractionRuntimeCandidateV1({...run.input, runReviewAI: reviewer})).rejects.toThrow('network-result-unknown')
  const row = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last(), before = await readProductRuntimeState(f.sessionId)
  db.close(); await db.open()
  await expect(resumeChatNarrativeReviewV1({...run.input, runReviewAI: reviewer, runId: row!.id!})).rejects.toThrow()
  expect(reviewer).toHaveBeenCalledTimes(1)
  expect(run.calls).toHaveLength(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('refuses the new output under the legacy producer without changing its frozen contract', async () => {
  legacy()
  const f = await start(), run = request(f), before = await readProductRuntimeState(f.sessionId)
  await expect(generateInteractionRuntimeCandidateV1(run.input)).rejects.toThrow()
  expect(run.reviews).toHaveLength(0)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(skills.getAgentSkillV1('character.chat-narrative-action').promptVersion).toBe('chat-narrative-action-v45')
})

it('refuses a new producer paired with an old reviewer before sending a model request', async () => {
  const f = await start(), run = request(f)
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => ({...originalSkill(id),
    ...(id === 'character.chat-narrative-action-review' ? {promptVersion: 'chat-narrative-action-review-v32'} : {})}))
  await expect(generateInteractionRuntimeCandidateV1(run.input)).rejects.toThrow('冻结预算合同不一致')
  expect(run.calls).toHaveLength(0); expect(run.reviews).toHaveLength(0)
})

it('recovers the frozen v46 inputs under the new default without adding identities or changing its old suffix', async () => {
  const old = vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => ({...originalSkill(id),
    ...(id === 'character.chat-narrative-action' ? {promptVersion: 'chat-narrative-action-v46'}
      : id === 'character.chat-narrative-action-review' ? {promptVersion: 'chat-narrative-action-review-v33'} : {})}))
  const f = await start(), run = request(f)
  const generated = await generateInteractionRuntimeCandidateV1(run.input)
  expect(run.calls[1][1].content).toContain(`- #${f.handoff.source.sequence}｜guard｜${action.text}`)
  expect(run.calls[1][1].content).not.toContain(`"messageId":${JSON.stringify(f.handoff.source.messageId)}`)
  expect(run.calls[1][2].content).toContain('只输出原格式完整行动候选。\n')
  old.mockRestore(); db.close(); await db.open()
  enable()
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(done.snapshot.projection.state).toBe('completed')
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
})

it('recovers the retained expression after host interruption without regenerating choice or result', async () => {
  const f = await start(); enable()
  const run = request(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.input, onActionExpressionBoundary: name => {if (name === 'candidate.persisted') throw Error('host-interrupted')}})).rejects.toThrow('host-interrupted')
  const row = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  db.close(); await db.open()
  const recovered = await resumeChatNarrativeActionV1({...run.input, runId: row!.id!})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: recovered.snapshot.run.id})
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
})

it('recovers after adoption without another event, model request, or regenerated receipt body', async () => {
  const f = await start(); enable()
  const run = request(f), generated = await generateInteractionRuntimeCandidateV1(run.input)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id,
    onDurableBoundary: name => {if (name === 'terminal-receipt.recorded') throw Error('host-interrupted')}})).rejects.toThrow('host-interrupted')
  const saved = await readInstanceAgentRunV1(f.scope, generated.snapshot.run.id), body = await readChatActionTerminalReceiptV1(f.scope, saved)
  const before = await readProductRuntimeState(f.sessionId)
  const completed = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.run.id})
  expect(await readChatActionTerminalReceiptV1(f.scope, completed.snapshot)).toEqual(body)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
})

it.each(['cancel', 'new-player-message'] as const)('refuses adoption after %s', async change => {
  const f = await start(); enable()
  const run = request(f), generated = await generateInteractionRuntimeCandidateV1(run.input)
  if (change === 'cancel') await cancelInteractionRuntimeRunV1({scope: f.scope, runId: generated.snapshot.run.id})
  else {
    const base = await readProductRuntimeStateVersion(f.sessionId)
    await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'new-message', baseSequence: base.sequence, baseStateHash: base.stateHash,
      messageId: 'answer', text: '我已经决定不打开包裹。'})
  }
  const before = await readProductRuntimeState(f.sessionId)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('requires the retained reviewed candidate, not a caller-supplied positive review and run id', async () => {
  const f = await start(); enable()
  const run = request(f), generated = await generateInteractionRuntimeCandidateV1(run.input), base = await readProductRuntimeStateVersion(f.sessionId)
  const review = {...reviewOutput(), reviewedHandoffJson: canonicalStringify(f.handoff)}
  await expect(commitChatControlHandoff({sessionId: f.sessionId, commandId: 'forged-control', baseSequence: base.sequence, baseStateHash: base.stateHash,
    actorKey: 'guard', triggerSequence: f.trigger.sequence, handoff: f.handoff, review,
    harnessRun: {id: generated.snapshot.run.id, lastSequence: generated.snapshot.projection.lastSequence}})).rejects.toThrow('原已审查候选')
  expect((await readInteractionRuntimeCandidateV1(f.scope, generated.snapshot.run.id)).candidate.kind).toBe('chat-control-handoff-candidate')
})

it('branches twice and imports the adopted control state without a new model call', async () => {
  const f = await start(); enable()
  const run = request(f), generated = await generateInteractionRuntimeCandidateV1(run.input)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const parent = await readProductRuntimeState(f.sessionId)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: parent.lastSequence, title: 'control branch'})
  const childState = await readProductRuntimeState(child.id!)
  const nested = await branchProductRuntimeSession({parentSessionId: child.id!, throughSequence: childState.lastSequence, title: 'nested control branch'})
  const nestedState = await readProductRuntimeState(nested.id!)
  expect(nestedState.interaction!.chatNarrative!.triggers.slice(-1)[0].controlHandoff!.sequence).toBeLessThan(0)
  const backup = await exportProjectJSON(f.scope.projectId)
  const imported = await importProjectJSON(backup)
  const sessions = await db.productRuntimeSessions.where('projectId').equals(imported).toArray()
  const copied = sessions.find(session => session.title === 'nested control branch')!
  expect((await readProductRuntimeState(copied.id!)).interaction).toEqual(nestedState.interaction)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(parent)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
})

it('rejects mixed outputs and never interprets an ordinary action as a control result', () => {
  expect(() => parseChatNarrativeOutcomeWireV1({outcome: 'handoff', action, handoff: {}})).toThrow('互斥')
  expect(() => parseChatNarrativeOutcomeWireV1(action)).toThrow('字段')
})

it('retains a flat legacy expression as a failed raw response under the actual default without adapting or retrying it', async () => {
  const f = await start(); enable()
  const run = request(f), before = await readProductRuntimeState(f.sessionId), raw = JSON.stringify(action)
  let calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...run.input, runAI: async messages => {
    calls++
    return messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? JSON.stringify(chatActionChoiceFixture(messages, choice)) : raw
  }})).rejects.toThrow('静默等待必须交还控制')
  expect(calls).toBe(2); expect(run.reviews).toHaveLength(0)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const rows = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()
  expect(rows.some(row => row.artifactKind === 'raw-response' && row.content === raw)).toBe(true)
  expect((await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last())!.status).toBe('failed')
})
