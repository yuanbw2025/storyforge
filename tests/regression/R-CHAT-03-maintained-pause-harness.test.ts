import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {adoptInteractionRuntimeCandidateV1, cancelInteractionRuntimeRunV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeActionV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion} from '../../src/lib/character-interaction/runtime-api'
import {CHAT_MAINTAINED_PAUSE_CHECKS_V1} from '../../src/lib/character-interaction/maintained-pause-control'
import {readChatActionTerminalReceiptV1} from '../../src/lib/character-interaction/action-terminal-receipt'
import {readChatActionOutputBudgetV1} from '../../src/lib/character-interaction/action-choice-output-budget'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'
import {maintainedPauseRuntimeRequest, maintainedPauseReview, seedChatMaintainedPauseRuntimeFixture} from '../helpers/chat-maintained-pause'

const originalSkill = skills.getAgentSkillV1
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it.each(['continue', 'return'] as const)('adopts and restores a reviewed %s pause without dialogue or story changes', async kind => {
  const f = await seedChatMaintainedPauseRuntimeFixture(kind), run = maintainedPauseRuntimeRequest(f), before = await readProductRuntimeState(f.sessionId)
  const made = await generateInteractionRuntimeCandidateV1(run.input)
  expect(made.candidate.kind).toBe('chat-control-handoff-candidate')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.reviews[0][0].content).toContain('pending-obligations')
  expect(run.reviews[0][1].content).toContain('basisMessages')
  expect(run.reviews[0][1].content).toContain(f.handoff.source.messageId)
  expect(run.calls[1][0].content).toContain('maintain-existing-pause')
  for (const messages of run.calls) expect(messages[1].content).not.toContain('掌柜把铜印留在柜台下')
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: made.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.messages).toEqual(before.interaction!.messages)
  expect(after.interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
  expect(after.interaction!.chatNarrative!.triggers.at(-1)).toMatchObject({status: 'complete', actionSequences: [], controlHandoff: {version: 3}})
  expect((await readChatActionOutputBudgetV1(f.scope, done.snapshot))!.calls).toHaveLength(3)
  const receipt = await readChatActionTerminalReceiptV1(f.scope, done.snapshot)
  db.close(); await db.open()
  const repeated = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: done.snapshot.run.id})
  expect(await readChatActionTerminalReceiptV1(f.scope, repeated.snapshot)).toEqual(receipt)
  await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().recoverableRunIds).not.toContain(done.snapshot.run.id)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '维持暂停分支'})
  const branched = await readProductRuntimeState(branch.id!)
  const worldHashes = (await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).map(w => w.contentHash)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched.interaction)
  expect((await db.worldReleases.where('projectId').equals(projectId).toArray()).map(w => w.contentHash)).toEqual(worldHashes)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
})

it.each(CHAT_MAINTAINED_PAUSE_CHECKS_V1)('keeps %s rejection terminal and unadopted with no retry', async check => {
  const f = await seedChatMaintainedPauseRuntimeFixture(), run = maintainedPauseRuntimeRequest(f), before = await readProductRuntimeState(f.sessionId)
  const review = maintainedPauseReview(f.handoff); review.checks.find(c => c.check === check)!.passed = false
  const reviewer = vi.fn(async () => JSON.stringify({checks: review.checks})); let id = 0
  await expect(generateInteractionRuntimeCandidateV1({...run.input, runReviewAI: reviewer, onRunCreated: runId => {id = runId}})).rejects.toThrow('审查未通过')
  expect((await db.agentRuns.get(id))!.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(2); expect(reviewer).toHaveBeenCalledTimes(1)
})

it('resumes only a missing review after an expression was durably saved', async () => {
  const f = await seedChatMaintainedPauseRuntimeFixture(), run = maintainedPauseRuntimeRequest(f); let id = 0
  await expect(generateInteractionRuntimeCandidateV1({...run.input, onRunCreated: runId => {id = runId},
    onActionExpressionBoundary: name => {if (name === 'candidate.persisted') throw Error('host-interrupted')}})).rejects.toThrow('host-interrupted')
  db.close(); await db.open()
  const restored = await resumeChatNarrativeActionV1({...run.input, runId: id})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: restored.snapshot.run.id})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.triggers.at(-1)!.controlHandoff!.version).toBe(3)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveLength(1)
})

it('keeps an unknown review stopped after refresh', async () => {
  const f = await seedChatMaintainedPauseRuntimeFixture(), run = maintainedPauseRuntimeRequest(f), before = await readProductRuntimeState(f.sessionId); let id = 0
  const reviewer = vi.fn(async () => {throw Error('network-result-unknown')})
  await expect(generateInteractionRuntimeCandidateV1({...run.input, onRunCreated: runId => {id = runId}, runReviewAI: reviewer})).rejects.toThrow('network-result-unknown')
  db.close(); await db.open()
  await expect(resumeChatNarrativeReviewV1({...run.input, runId: id, runReviewAI: reviewer})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(2); expect(reviewer).toHaveBeenCalledTimes(1)
})

it.each(['cancel', 'new-player-message'] as const)('prevents adoption after %s', async change => {
  const f = await seedChatMaintainedPauseRuntimeFixture(), run = maintainedPauseRuntimeRequest(f), made = await generateInteractionRuntimeCandidateV1(run.input)
  if (change === 'cancel') await cancelInteractionRuntimeRunV1({scope: f.scope, runId: made.snapshot.run.id})
  else {
    const base = await readProductRuntimeStateVersion(f.sessionId)
    await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'new-question', baseSequence: base.sequence, baseStateHash: base.stateHash,
      messageId: 'new-question-message', text: '先回答我一个新问题。', audienceKeys: ['guard', 'player']})
  }
  const before = await readProductRuntimeState(f.sessionId)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: made.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('does not grant the new result to a saved v65 contract', async () => {
  const f = await seedChatMaintainedPauseRuntimeFixture(), run = maintainedPauseRuntimeRequest(f)
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation((id, ...args) => ({...originalSkill(id, ...args),
    ...(id === 'character.chat-narrative-action' ? {promptVersion: 'chat-narrative-action-v65'} : id === 'character.chat-narrative-action-review' ? {promptVersion: 'chat-narrative-action-review-v40'} : {})}))
  await expect(generateInteractionRuntimeCandidateV1(run.input)).rejects.toThrow('旧生成合同')
  expect(run.calls[1][0].content).not.toContain('maintain-existing-pause')
  expect(run.reviews).toHaveLength(0)
})
