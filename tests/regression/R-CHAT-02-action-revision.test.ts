import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {CHAT_ACTION_REVISION_SKILL, readChatActionRevisionSourceV1} from '../../src/lib/character-interaction/action-revision'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, commitInteractionPlayerMessage} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const action: ChatNarrativeActionV1 = {kind: 'pause', text: '寻找铜印的事情先暂停，等通道恢复再继续。', goalKey: 'find-seal',
  evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'artisan', 'player'], waitingForPlayer: false,
  newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'paused'}
const revision: ChatNarrativeActionV1 = {...action, threadUpdates: [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: action.text}]}
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
async function rejected(mode: 'consequences' | 'visibility' | 'unknown' | 'malformed' = 'consequences') {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '停止整项查找，不替玩家行动', onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => {
      if (mode === 'unknown') throw new Error('unknown transport outcome')
      if (mode === 'malformed') return '幕后：柜台下。不是 JSON'
      const report = chatActionReviewOutputFixture(); report.checks.find(c => c.check === mode)!.passed = false
      report.checks.find(c => c.check === mode)!.reason = '工程否决夹具含幕后字样：柜台下；不可转交角色'
      return JSON.stringify(report)
    }})).rejects.toThrow()
  return {...f, triggerSequence: trigger.sequence, runId}
}
function input(f: Awaited<ReturnType<typeof rejected>>) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: CHAT_ACTION_REVISION_SKILL,
    narrativeTriggerSequence: f.triggerSequence, objective: '明确修订一次未通过回复的后果登记',
    runAI: async () => JSON.stringify(revision), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}
}

it('explicitly revises once through registered sources and full review, preserving the original failure and secret critic prose', async () => {
  const f = await rejected(), before = await readProductRuntimeStateVersion(f.sessionId)
  const original = await readInstanceAgentRunV1(f.scope, f.runId)
  const source = await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId})
  expect(source?.runId).toBe(f.runId)
  db.close(); await db.open()
  let calls = 0
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), runAI: async messages => {
    calls++; const text = JSON.stringify(messages)
    expect(text).toContain('明确请求修订的未生效行动'); expect(text).toContain(action.text)
    expect(text).not.toContain('柜台下'); expect(text).not.toContain('工程否决夹具')
    const output: Record<string, unknown> = {...revision, expressionMode: 'self-pause', audienceKeys: null, threadUpdates: revision.threadUpdates.map(t => ({...t, evidenceExcerpt: null}))}
    delete output.kind; delete output.waitingForPlayer
    return JSON.stringify(output)
  }, runReviewAI: async messages => {calls++; expect(JSON.stringify(messages)).toContain('柜台下'); return JSON.stringify(chatActionReviewOutputFixture())}})
  expect(calls).toBe(2)
  expect(generated.snapshot.contract.budget.maxModelCalls).toBe(2)
  expect(generated.snapshot.contract.executionBindings?.map(b => b.skillId)).toEqual([CHAT_ACTION_REVISION_SKILL, 'character.chat-narrative-action-review'])
  expect(generated.candidate).toMatchObject({revision: {sourceCandidateHash: source!.candidateHash, sourceReviewHash: source!.reviewHash}})
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
  expect(await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId})).toBeNull()
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages).toHaveLength(1); expect(state.messages[0].text).toBe(action.text)
  expect(state.chatNarrative!.situation.threads.find(t => t.threadKey === 'investigate')!.status).toBe('paused')
  expect(state.chatNarrative!.situation.goals.find(g => g.goalKey === 'find-seal')!.status).toBe('paused')
  expect(await readInstanceAgentRunV1(f.scope, f.runId)).toEqual(original)
  const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray())[0]
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(state)
})

it.each(['visibility', 'unknown', 'malformed'] as const)('does not make a new request for %s failures', async mode => {
  const f = await rejected(mode); let calls = 0
  expect(await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId})).toBeNull()
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: async () => {calls++; return '{}'}})).rejects.toThrow('没有可修订')
  expect(calls).toBe(0)
})

it.each(['text', 'kind', 'goalKey', 'audienceKeys', 'waitingForPlayer'] as const)('cannot change the original %s, and cannot revise a failed revision again', async key => {
  const f = await rejected(), before = await readProductRuntimeStateVersion(f.sessionId); let calls = 0
  const modified = {...revision, [key]: {text: '你已经同意帮忙。', kind: 'speak', goalKey: 'keep-secret', audienceKeys: ['guard', 'player'], waitingForPlayer: true}[key]}
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: async () => {calls++; return JSON.stringify(modified)}, runReviewAI: async () => {calls++; return '{}'}})).rejects.toThrow('修订不能改变')
  expect(calls).toBe(1)
  await expect(generateInteractionRuntimeCandidateV1(input(f))).rejects.toThrow('没有可修订')
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
})

it('refuses another actor and changed player state without a call', async () => {
  const f = await rejected(); let calls = 0
  expect(await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId, actorKey: 'artisan'})).toBeNull()
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'interrupt', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'interrupt', text: '先聊别的。'})
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: async () => {calls++; return '{}'}})).rejects.toThrow('没有可修订')
  expect(calls).toBe(0)
})

it('recovers a saved revised candidate with only the missing review and retains a second rejection', async () => {
  const f = await rejected(); let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onNarrativeActionSaved: id => {runId = id; throw new Error('host-crash')}})).rejects.toThrow('host-crash')
  db.close(); await db.open()
  let calls = 0
  const report = chatActionReviewOutputFixture(); report.checks.find(c => c.check === 'consequences')!.passed = false
  await expect(resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(report)}})).rejects.toThrow('行动语义审查未通过')
  expect(calls).toBe(1)
  expect(await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId})).toBeNull()
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toEqual([])
  expect((await readInstanceAgentRunV1(f.scope, f.runId)).projection.state).toBe('failed')
})

it('admits at most one concurrent explicit revision and rejects cross-work scope before requests', async () => {
  const f = await rejected()
  await expect(readChatActionRevisionSourceV1({scope: {...f.scope, workId: 999}, sessionId: f.sessionId})).rejects.toThrow()
  let unblock!: () => void, started!: () => void, calls = 0
  const signal = new Promise<void>(resolve => {started = resolve}), wait = new Promise<void>(resolve => {unblock = resolve})
  const first = generateInteractionRuntimeCandidateV1({...input(f), runAI: async () => {calls++; started(); await wait; return JSON.stringify(revision)}})
  await signal
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: async () => {calls++; return JSON.stringify(revision)}})).rejects.toThrow('仍在生成')
  unblock(); await first
  expect(calls).toBe(1)
})

it('rechecks a player interruption after the revised response and preserves both failed attempts', async () => {
  const f = await rejected()
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: async () => {
    const v = await readProductRuntimeStateVersion(f.sessionId)
    await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'late-interrupt', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'late-interrupt', text: '换个话题。'})
    return JSON.stringify(revision)
  }})).rejects.toThrow()
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages.map(m => m.role)).toEqual(['player'])
})

it('does not borrow an old failed candidate after importing into different local identities', async () => {
  const f = await rejected(), before = await readProductRuntimeStateVersion(f.sessionId)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
  const scope = {projectId, worldId: session.worldId, workId: session.workId}
  // Runtime candidates are explicitly non-portable. The event state travels;
  // the old local adoption/repair authority does not.
  const source = await readChatActionRevisionSourceV1({scope, sessionId: session.id!}).catch(() => null)
  expect(source).toBeNull()
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
})
