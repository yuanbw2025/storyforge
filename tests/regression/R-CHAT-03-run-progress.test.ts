import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {readChatRunProgressV1} from '../../src/lib/character-interaction/run-progress'
import {adoptInteractionRuntimeCandidateV1, cancelInteractionRuntimeRunV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function start() {
  const f = await seedChatNarrativeRuntimeFixture()
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}
const action = {kind: 'speak', text: '我先查看门边。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
const input = (f: Awaited<ReturnType<typeof start>>) => ({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '工程进度检查', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})

it('projects actual request and review boundaries without exposing text or mutating story/evidence', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId)
  let runId = 0, calls = 0
  const read = () => readChatRunProgressV1(f.scope, f.sessionId, runId)
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: async id => {
    runId = id
    expect(await read()).toMatchObject({phase: 'preparing', label: '正在准备角色行动'})
  }, runAI: withChatActionChoiceFixture(async () => {
    calls++
    expect(await read()).toMatchObject({phase: 'generation', label: '等待角色行动'})
    return JSON.stringify(action)
  }), runReviewAI: async messages => {
    calls++
    expect(JSON.stringify(messages)).toContain('柜台下')
    const counts = [await db.agentRunEvents.count(), await db.productRuntimeEvents.count()]
    const progress = await read()
    expect(progress).toMatchObject({phase: 'review', label: '正在核对候选与故事后果'})
    for (const secret of ['柜台下', '无辜旅人', action.text]) expect(JSON.stringify(progress)).not.toContain(secret)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    expect([await db.agentRunEvents.count(), await db.productRuntimeEvents.count()]).toEqual(counts)
    return JSON.stringify(chatActionReviewOutputFixture())
  }})
  expect(await read()).toMatchObject({phase: 'ready'})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(await read()).toMatchObject({phase: 'completed'})
  expect(calls).toBe(2)
})

it.each(['generation', 'review'] as const)('retains a failed %s stage after reopening without inferring a provider success or a retry', async boundary => {
  const f = await start()
  let runId = 0, calls = 0
  const crash = async () => {calls++; throw new Error('raw provider error with private text')}
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id},
    ...(boundary === 'generation' ? {runAI: crash} : {runReviewAI: crash}),
  })).rejects.toThrow('raw provider error')
  const progress = await readChatRunProgressV1(f.scope, f.sessionId, runId)
  expect(progress.phase).toBe('failed')
  expect(JSON.stringify(progress)).not.toContain('private text')
  expect(progress.detail).toContain('不会自动重发')
  db.close(); await db.open()
  expect(await readChatRunProgressV1(f.scope, f.sessionId, runId)).toEqual(progress)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(0)
  expect(calls).toBe(1)
})

it('distinguishes cancellation and rejects another session or workspace, including branch histories', async () => {
  const f = await start(), generated = await generateInteractionRuntimeCandidateV1(input(f)), runId = generated.snapshot.run.id
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'progress child'})
  await expect(readChatRunProgressV1(f.scope, child.id!, runId)).rejects.toThrow('无法核对')
  const other = await seedChatNarrativeRuntimeFixture()
  await expect(readChatRunProgressV1(other.scope, f.sessionId, runId)).rejects.toThrow()
  await cancelInteractionRuntimeRunV1({scope: f.scope, runId})
  expect(await readChatRunProgressV1(f.scope, f.sessionId, runId)).toMatchObject({phase: 'cancelled'})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(0)
})

it('rejects corrupted durable evidence instead of manufacturing a stage', async () => {
  const f = await start(), result = await generateInteractionRuntimeCandidateV1(input(f))
  await db.agentRuns.update(result.snapshot.run.id, {projectionJson: '{}'})
  await expect(readChatRunProgressV1(f.scope, f.sessionId, result.snapshot.run.id)).rejects.toThrow()
})
