import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import * as manifests from '../../src/lib/agent/run/context-manifest'
import {CONTEXT_SOURCES} from '../../src/lib/registry/context-sources'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, correctChatMemory, deleteProductRuntimeSession, proposeInteractionMemory, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {pendingChatMemoryCorrectionsV1} from '../../src/lib/character-interaction/memory-reconciliation'
import {readChatActionRevisionSourceV1} from '../../src/lib/character-interaction/action-revision'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import {freezeLegacyChatActionContractFixture} from '../helpers/chat-historical-reader'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {vi.restoreAllMocks(); await db.delete()})
const command = async (sessionId: number) => {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
const action: ChatNarrativeActionV1 = {kind: 'speak', text: '你没有答应协助，我自己去看看门口。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'],
  waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}

async function prepared(oldPlan = false) {
  const f = await seedChatNarrativeRuntimeFixture()
  if (oldPlan) {
    await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
    const prior = {...action, text: '我等你一起寻找铜印。', waitingForPlayer: true,
      nextPossibilities: [{text: '等待玩家一起去寻找铜印。', evidenceFactKeys: ['lost']}]}
    // Inject a historically mistaken dependency; this is not a quality verdict.
    const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
      skillId: 'character.chat-narrative-action', objective: '准备待纠正的旧打算', runAI: withChatActionChoiceFixture(async () => JSON.stringify(prior)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  }
  const sent = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'correction-source', text: '我只是暂借地图，没有答应帮忙寻找铜印。'})
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'original', participantKey: 'guard', kind: 'key-memory', content: '旧的错误摘要', importance: 1,
    sourceEventSequences: [sent.sequence], evidenceExcerpt: '没有答应帮忙'})
  const correction = await correctChatMemory({...await command(f.sessionId), memoryId: 'original', replacementMemoryId: 'corrected', content: '玩家只是暂借地图，没有答应帮忙。',
    sourceEventSequences: [sent.sequence], evidenceExcerpt: '没有答应帮忙', reason: '依据原话修正'})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: sent.sequence})
  return {...f, correctionSequence: correction.sequence}
}
function output(f: Awaited<ReturnType<typeof prepared>>, passed = true) {
  return {...chatActionReviewOutputFixture(), memoryChecks: [{memoryId: 'corrected', sourceSequence: f.correctionSequence, passed, reason: '注入判定仅验证合同链路，不是真实模型审查。'}]}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '记忆核对合同工程检查',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(output(f))}
}
function useOldReviewFixture() {
  const original = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
    const skill = original(id)
    return id === 'character.chat-narrative-action-review' ? {...skill, promptVersion: 'chat-narrative-action-review-v19'} : id === 'character.chat-narrative-action' ? {...skill, promptVersion: 'chat-narrative-action-v45'} : skill
  })
}

it('stops an old frozen reviewer before a request when corrections require a new contract', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  useOldReviewFixture()
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => {calls++; return JSON.stringify(output(f))}})).rejects.toThrow('旧审查合同')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(calls).toBe(0)
})

it('recovers a saved candidate and records only an exact successful reviewed correction, then preserves it after nested branch deletion and import', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(action)}), onNarrativeActionSaved: id => {runId = id; throw new Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(output(f))}})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const result = await readProductRuntimeState(f.sessionId), receipt = result.interaction!.chatNarrative!.memoryReconciliations![0]
  expect(receipt).toMatchObject({memoryId: 'corrected', sourceSequence: f.correctionSequence, actorKey: 'guard', messageId: `message:harness:${runId}`})
  expect(pendingChatMemoryCorrectionsV1(result.interaction!, 'guard')).toEqual([])
  expect(result.interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
  expect(calls).toBe(2)
  const earlier = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: before.lastSequence, title: '核对之前'})
  expect(pendingChatMemoryCorrectionsV1((await readProductRuntimeState(earlier.id!)).interaction!, 'guard')).toHaveLength(1)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: result.lastSequence, title: '核对之后'})
  const nested = await branchProductRuntimeSession({parentSessionId: child.id!, throughSequence: (await readProductRuntimeStateVersion(child.id!)).sequence, title: '核对继承'})
  const nestedState = await readProductRuntimeState(nested.id!)
  await deleteProductRuntimeSession(child.id!); await deleteProductRuntimeSession(f.sessionId)
  expect(await readProductRuntimeState(nested.id!)).toEqual(nestedState)
  expect(nestedState.interaction!.chatNarrative!.memoryReconciliations![0].sourceSequence).toBeLessThan(0)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === '核对继承')!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(nestedState.interaction)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  await deleteProductRuntimeSession(imported.id!)
  expect(await db.productRuntimeEvents.where('sessionId').equals(imported.id!).count()).toBe(0)
})

it('does not allow consequence-only revision to bypass a failed correction review', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  const rejected = output(f, false); rejected.checks.find(c => c.check === 'consequences')!.passed = false
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => JSON.stringify(rejected)})).rejects.toThrow('语义审查未通过')
  expect(await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId, actorKey: 'guard'})).toBeNull()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(pendingChatMemoryCorrectionsV1(before.interaction!, 'guard')).toHaveLength(1)
})

it('stales saved coverage when a newer correction replaces it and preserves both corrections', async () => {
  const f = await prepared()
  const generated = await generateInteractionRuntimeCandidateV1(input(f))
  const state = (await readProductRuntimeState(f.sessionId)).interaction!, corrected = state.memories.find(m => m.memoryId === 'corrected')!
  await correctChatMemory({...await command(f.sessionId), memoryId: 'corrected', replacementMemoryId: 'again', content: '没有承诺帮忙找铜印。',
    sourceEventSequences: corrected.sourceEventSequences, evidenceExcerpt: corrected.evidenceExcerpt, reason: '进一步核对原话'})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(after.chatNarrative).not.toHaveProperty('memoryReconciliations')
  expect(pendingChatMemoryCorrectionsV1(after, 'guard').map(m => m.memoryId)).toEqual(['again'])
  expect(after.memories.find(m => m.memoryId === 'corrected')?.supersededByMemoryId).toBe('again')
})

it('rejects incorrect reconciliation coverage before persisting an approved candidate', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  const wrong = output(f); wrong.memoryChecks[0].sourceSequence--
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => JSON.stringify(wrong)})).rejects.toThrow('待处理记忆不一致')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it.each(['missing', 'empty'] as const)('rejects %s correction checks before approval without allowing consequence revision', async kind => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  const review = kind === 'missing' ? chatActionReviewOutputFixture() : {...chatActionReviewOutputFixture(), memoryChecks: []}
  review.checks.find(c => c.check === 'consequences')!.passed = false
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => JSON.stringify(review)})).rejects.toThrow('记忆')
  const saved = await readInstanceAgentRunV1(f.scope, runId)
  expect(saved.events.some(e => e.type === 'step.succeeded' && e.payload.stepId === 'interaction:action-review')).toBe(false)
  expect(await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId, actorKey: 'guard'})).toBeNull()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it.each([true, false])('requires reviewed consistency of retained plans, changed=%s, and keeps exact input history', async changed => {
  const f = await prepared(true), before = (await readProductRuntimeState(f.sessionId)).interaction!
  const candidate = {...action, nextPossibilities: changed ? [{text: '我自己查看门口的借用记录。', evidenceFactKeys: ['lost']}] : null}
  let calls = 0, runId = 0
  const generating = generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id},
    runAI: withChatActionChoiceFixture(async messages => {
      calls++; expect(messages[1].content).toContain('尚待本次行动核对的记忆修正')
      expect(messages[1].content).toContain('我只是暂借地图，没有答应帮忙寻找铜印。')
      expect(messages[1].content).not.toContain('旧的错误摘要')
      expect(messages[0].content).toContain('不在正文承认却保留相反方向')
      return JSON.stringify(candidate)
    }), runReviewAI: async messages => {
      calls++; expect(messages[0].content).toContain('memoryChecks'); expect(messages[0].content).toContain('commitmentChecks')
      expect(messages[0].content).toContain('口头改口却保留冲突打算')
      expect(messages[1].content).toContain('等待玩家一起去寻找铜印。')
      expect(messages[1].content).toContain(`"sourceSequence":${f.correctionSequence}`)
      return JSON.stringify(output(f, changed))
    }})
  if (!changed) {
    await expect(generating).rejects.toThrow('语义审查未通过')
    expect((await readProductRuntimeState(f.sessionId)).interaction).toEqual(before)
    expect(pendingChatMemoryCorrectionsV1(before, 'guard')).toHaveLength(1)
  } else {
    await generating
    const historical = await readChatContextInspectionV1(f.scope, f.sessionId, runId)
    expect(historical.available && historical.memoryCorrections[0]).toMatchObject({content: '玩家只是暂借地图，没有答应帮忙。', sources: [{text: '我只是暂借地图，没有答应帮忙寻找铜印。'}]})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
    const after = (await readProductRuntimeState(f.sessionId)).interaction!
    expect(after.chatNarrative!.situation.possibilities.filter(p => p.actorKey === 'guard').map(p => p.text)).toEqual(['我自己查看门口的借用记录。'])
    expect(after.chatNarrative!.situation.facts).toEqual(before.chatNarrative!.situation.facts)
    expect(after.chatNarrative!.situation.beliefs).toEqual(before.chatNarrative!.situation.beliefs)
    expect(after.relationships).toEqual(before.relationships)
    expect(pendingChatMemoryCorrectionsV1(after, 'guard')).toEqual([])
    db.close(); await db.open()
    expect(await readChatContextInspectionV1(f.scope, f.sessionId, runId)).toEqual(historical)
  }
  expect(calls).toBe(2)
})

it('checks both alternatives independently and only records the selected action once', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  const actions = [action, {...action, kind: 'pause', text: '我先自己核对登记，再决定去哪里找。'}]
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), skillId: 'character.chat-narrative-options',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify({options: actions})), runReviewAI: async messages => {
      expect(messages[0].content).toContain('两条互斥候选必须各自完整核对')
      return JSON.stringify({options: actions.map((_, i) => ({optionKey: `option-${i + 1}`, ...output(f)}))})
    }})
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow('请选择')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, optionKey: 'option-2'})
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(after.messages.at(-1)!.text).toBe(actions[1].text)
  expect(after.chatNarrative!.memoryReconciliations).toHaveLength(1)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect((await readProductRuntimeState(f.sessionId)).interaction).toEqual(after)
})

it('keeps a correction pending after an unknown review result and never retries it on resume', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  let runId = 0, reviews = 0
  const reviewer = async () => {reviews++; throw new Error('unknown-review-result')}
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: reviewer})).rejects.toThrow('unknown-review-result')
  db.close(); await db.open()
  await expect(resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: reviewer})).rejects.toThrow()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(reviews).toBe(1)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('does not replace an old producer input with new correction evidence during review', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  freezeLegacyChatActionContractFixture()
  vi.spyOn(CONTEXT_SOURCES.find(s => s.key === 'interactionRuntime')!, 'read').mockImplementation(async () => {
    const state = (await readProductRuntimeState(f.sessionId)).interaction!
    return formatInteractionRuntimeContextV1(state.profiles[0], buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'chat-relevance-v3'}))
  })
  const create = manifests.createContextManifestFromAssemblyV1
  vi.spyOn(manifests, 'createContextManifestFromAssemblyV1').mockImplementation(input => create({...input,
    readerVersion: input.readerVersion === 'chat-narrative-runtime-view-v14' ? 'chat-narrative-runtime-view-v7' : input.readerVersion}))
  let reviews = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runReviewAI: async () => {reviews++; return JSON.stringify(output(f))}})).rejects.toThrow('原行动没有读取完整记忆修正依据')
  expect(reviews).toBe(0)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})
