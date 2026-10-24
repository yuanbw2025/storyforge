import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {adoptInteractionRuntimeCandidateV1, cancelInteractionRuntimeRunV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeActionV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitChatControlHandoff, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {CHAT_TURN_END_CONTROL_CHECKS_V1} from '../../src/lib/character-interaction/turn-end-control'
import {readChatActionTerminalReceiptV1} from '../../src/lib/character-interaction/action-terminal-receipt'
import {readChatActionOutputBudgetV1} from '../../src/lib/character-interaction/action-choice-output-budget'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'
import {chatTurnEndReviewFixture} from '../helpers/chat-turn-end-control'
import {chatTurnEndRuntimeRequest, seedChatTurnEndRuntimeFixture} from '../helpers/chat-turn-end-runtime'

const originalSkill = skills.getAgentSkillV1
beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  expect(originalSkill('character.chat-narrative-action').promptVersion).toBe('chat-narrative-action-v72')
  expect(originalSkill('character.chat-narrative-action-review').promptVersion).toBe('chat-narrative-action-review-v42')
})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it('reviews current adopted progress, completes only this turn and permits a fresh next turn', async () => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), before = await readProductRuntimeState(f.sessionId)
  const generated = await generateInteractionRuntimeCandidateV1(run.input)
  expect(generated.candidate.kind).toBe('chat-control-handoff-candidate')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.reviews[0][0].content).toContain('current-turn-progress')
  expect(run.reviews[0][0].content).not.toContain('current-decision')
  expect(run.reviews[0][1].content).toContain('basisMessages')
  expect(run.reviews[0][1].content).toContain(before.interaction!.messages.slice(-1)[0].text)
  for (const messages of run.calls) {
    expect(messages[1].content).toContain(f.handoff.source.messageId)
    expect(messages[0].content).not.toContain('掌柜把铜印留在柜台下')
  }
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId)
  expect(done.event!.type).toBe('interaction.narrative.control-handoff.committed')
  expect(after.interaction!.messages).toEqual(before.interaction!.messages)
  expect(after.interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
  expect(after.interaction!.chatNarrative!.triggers.slice(-1)[0]).toMatchObject({status: 'complete', actionSequences: [f.handoff.source.sequence], controlHandoff: {version: 2}})
  expect(after.interaction!.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 3)
  expect((await readChatActionOutputBudgetV1(f.scope, done.snapshot))!.calls).toHaveLength(3)
  const receipt = await readChatActionTerminalReceiptV1(f.scope, done.snapshot)
  db.close(); await db.open()
  const repeated = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: done.snapshot.run.id})
  expect(await readChatActionTerminalReceiptV1(f.scope, repeated.snapshot)).toEqual(receipt)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
  await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().recoverableRunIds).not.toContain(done.snapshot.run.id)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
  const base = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'next-turn', baseSequence: base.sequence, baseStateHash: base.stateHash,
    kind: 'continue', sourceEventSequence: base.sequence, direction: {actorKey: 'guard', actionLimit: 2}})
  const next = (await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!
  expect(next.triggers.slice(-1)[0]).toMatchObject({status: 'ready', actionSequences: []})
  expect(next.triggers.slice(-2)[0].status).toBe('complete')
  expect(next.situation.goals).toEqual(before.interaction!.chatNarrative!.situation.goals)
})

it.each(CHAT_TURN_END_CONTROL_CHECKS_V1)('retains a rejected %s review without ending the turn or retrying', async check => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), before = await readProductRuntimeState(f.sessionId)
  const output = chatTurnEndReviewFixture(f.handoff); output.checks.find(item => item.check === check)!.passed = false
  const reviewer = vi.fn(async () => JSON.stringify({checks: output.checks}))
  await expect(generateInteractionRuntimeCandidateV1({...run.input, runReviewAI: reviewer})).rejects.toThrow('审查未通过')
  const row = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  expect(row!.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: row!.id!})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(2); expect(reviewer).toHaveBeenCalledTimes(1)
})

it('does not resend a review with an unknown result after refresh', async () => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), before = await readProductRuntimeState(f.sessionId)
  const reviewer = vi.fn(async () => {throw Error('network-result-unknown')})
  await expect(generateInteractionRuntimeCandidateV1({...run.input, runReviewAI: reviewer})).rejects.toThrow('network-result-unknown')
  const row = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  db.close(); await db.open()
  await expect(resumeChatNarrativeReviewV1({...run.input, runReviewAI: reviewer, runId: row!.id!})).rejects.toThrow()
  expect(reviewer).toHaveBeenCalledTimes(1); expect(run.calls).toHaveLength(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('does not accept turn-end output in a frozen v56 run or send it to an older reviewer', async () => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), before = await readProductRuntimeState(f.sessionId)
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => ({...originalSkill(id),
    ...(id === 'character.chat-narrative-action' ? {promptVersion: 'chat-narrative-action-v56'}
      : id === 'character.chat-narrative-action-review' ? {promptVersion: 'chat-narrative-action-review-v35'} : {})}))
  await expect(generateInteractionRuntimeCandidateV1(run.input)).rejects.toThrow('旧生成合同')
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(0)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls[1][0].content).not.toContain('finish-current-turn')
})

it('resumes a persisted turn-end expression without regenerating selection or expression', async () => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.input,
    onActionExpressionBoundary: name => {if (name === 'candidate.persisted') throw Error('host-interrupted')}})).rejects.toThrow('host-interrupted')
  const row = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  db.close(); await db.open()
  const recovered = await resumeChatNarrativeActionV1({...run.input, runId: row!.id!})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: recovered.snapshot.run.id})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.triggers.slice(-1)[0].status).toBe('complete')
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
})

it('reuses the durable receipt after interruption following adoption', async () => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), generated = await generateInteractionRuntimeCandidateV1(run.input)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id,
    onDurableBoundary: name => {if (name === 'terminal-receipt.recorded') throw Error('host-interrupted')}})).rejects.toThrow('host-interrupted')
  const saved = await readInstanceAgentRunV1(f.scope, generated.snapshot.run.id), receipt = await readChatActionTerminalReceiptV1(f.scope, saved)
  const before = await readProductRuntimeState(f.sessionId)
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.run.id})
  expect(await readChatActionTerminalReceiptV1(f.scope, done.snapshot)).toEqual(receipt)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
})

it.each(['cancel', 'new-player-message'] as const)('refuses adoption after %s', async change => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), generated = await generateInteractionRuntimeCandidateV1(run.input)
  if (change === 'cancel') await cancelInteractionRuntimeRunV1({scope: f.scope, runId: generated.snapshot.run.id})
  else {
    const base = await readProductRuntimeStateVersion(f.sessionId)
    await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'new-message', baseSequence: base.sequence, baseStateHash: base.stateHash,
      messageId: 'new-request', text: '等一下，请解释第二条线索。'})
  }
  const before = await readProductRuntimeState(f.sessionId)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('refuses a caller-supplied review without the retained candidate adoption command', async () => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), generated = await generateInteractionRuntimeCandidateV1(run.input)
  const base = await readProductRuntimeStateVersion(f.sessionId)
  await expect(commitChatControlHandoff({sessionId: f.sessionId, commandId: 'forged-control', baseSequence: base.sequence, baseStateHash: base.stateHash,
    actorKey: 'guard', triggerSequence: f.trigger.sequence, handoff: f.handoff, review: chatTurnEndReviewFixture(f.handoff),
    harnessRun: {id: generated.snapshot.run.id, lastSequence: generated.snapshot.projection.lastSequence}})).rejects.toThrow('原已审查候选')
})

it('rejects tampered raw expression evidence even after a passing review', async () => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), generated = await generateInteractionRuntimeCandidateV1(run.input)
  const before = await readProductRuntimeState(f.sessionId)
  const artifacts = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()
  const raw = artifacts.find(row => row.artifactKind === 'raw-response' && row.content === JSON.stringify({outcome: 'handoff', action: null, handoff: f.handoff}))!
  expect(raw).toBeTruthy()
  await db.agentRunArtifacts.update(raw.id!, {content: JSON.stringify({outcome: 'handoff', action: null, handoff: {...f.handoff, purpose: '篡改的目的'}})})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('preserves completed turns, signed references and original runs through nested branches and import', async () => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), generated = await generateInteractionRuntimeCandidateV1(run.input)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const parent = await readProductRuntimeState(f.sessionId)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: parent.lastSequence, title: 'turn-end branch'})
  const childState = await readProductRuntimeState(child.id!)
  const nested = await branchProductRuntimeSession({parentSessionId: child.id!, throughSequence: childState.lastSequence, title: 'nested turn-end branch'})
  const nestedState = await readProductRuntimeState(nested.id!)
  expect(nestedState.interaction!.chatNarrative!.triggers.slice(-1)[0]).toMatchObject({status: 'complete', controlHandoff: {version: 2}})
  expect(nestedState.interaction!.chatNarrative!.triggers.slice(-1)[0].controlHandoff!.sourceSequence).toBeLessThan(0)
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const sessions = await db.productRuntimeSessions.where('projectId').equals(imported).toArray()
  const copied = sessions.find(session => session.title === 'nested turn-end branch')!
  expect((await readProductRuntimeState(copied.id!)).interaction).toEqual(nestedState.interaction)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(parent)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
})
