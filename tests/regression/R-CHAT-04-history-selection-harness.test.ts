import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {db} from '../../src/lib/db/schema'
import * as api from '../../src/lib/character-interaction/runtime-api'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
it('uses selected history in actual producer/reviewer, then resumes and adopts without erasing omitted facts through parentless export', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), worlds = await db.worldReleases.toArray()
  const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
  let expressionAndReviewCalls = 0
  for (let i = 0; i < 26; i++) {
    await api.requestChatNarrativeTrigger({...await command(), kind: i === 0 ? 'scene-start' : 'continue', sourceEventSequence: i === 0 ? f.sceneSequence : (await api.readProductRuntimeStateVersion(f.sessionId)).sequence})
    const texts = [0, 1].map(j => i === 0 && j === 0 ? '铜印登记旁有靛蓝地图的杉木叶标记。' : `登记册第${i * 2 + j}页记录：` + '海岸旧家具的颜色当时被逐项记下，渔村风景保持安静。'.repeat(16))
    const action = {kind: 'complete', text: texts.join('\n'), goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
      newFacts: texts.map((text, j) => ({factKey: `history-${i * 2 + j}`, kind: 'observation', text, evidenceFactKeys: ['lost'], evidenceExcerpt: text})), disclosures: [], threadUpdates: [], goalStatus: null}
    // Each output fits its frozen cap; the accumulated history still exceeds
    // the old reader budget, asserted below without dropping any stored fact.
    expect(estimateTokens(JSON.stringify(action))).toBeLessThanOrEqual(4000)
    const run = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '有限历史读取工程负载，不是剧情质量样本',
      runAI: withChatActionChoiceFixture(async () => {expressionAndReviewCalls++; return JSON.stringify(action)}), runReviewAI: async () => {expressionAndReviewCalls++; return JSON.stringify(chatActionReviewOutputFixture())}})
    expect(run.snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(3)
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: run.snapshot.run.id})
  }
  const message = await api.commitInteractionPlayerMessage({...await command(), messageId: 'old-map', text: '先前靛蓝地图的杉木叶标记是什么？'})
  await api.requestChatNarrativeTrigger({...await command(), kind: 'player-response', sourceEventSequence: message.sequence})
  const before = await api.readProductRuntimeState(f.sessionId), facts = before.interaction!.chatNarrative!.situation.facts
  expect(facts).toHaveLength(56)
  expect(() => buildInteractionContextWindow(before.interaction!, 'guard', {retrievalVersion: 'chat-relevance-v7'})).toThrow('超过预算')
  const selected = buildInteractionContextWindow(before.interaction!, 'guard')
  expect(selected.historyContext!.omitted.facts).toBeGreaterThan(0)
  expect(selected.chatNarrative!.facts.some(f => f.factKey === 'history-0')).toBe(true)
  const reply = {kind: 'speak', text: '登记旁记过靛蓝地图的杉木叶标记，可以从这条线索继续核对。', goalKey: 'find-seal', evidenceFactKeys: ['history-0'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '召回旧线索',
    runAI: withChatActionChoiceFixture(async messages => {expressionAndReviewCalls++; expect(messages[1].content).toContain('杉木叶标记'); expect(messages[1].content).not.toContain('柜台下'); return JSON.stringify(reply)}),
    onNarrativeActionSaved: id => {runId = id; throw Error('before-review')}})).rejects.toThrow('before-review')
  db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    expressionAndReviewCalls++; for (const fact of selected.chatNarrative!.facts) expect(messages[1].content).toContain(fact.text)
    expect(messages[1].content).toContain('history-0'); return JSON.stringify(chatActionReviewOutputFixture())
  }})
  const inspected = await readChatContextInspectionV1(f.scope, f.sessionId, runId)
  expect(inspected.available && inspected.selection?.facts?.some(f => !f.included)).toBe(true)
  expect(JSON.stringify(inspected)).not.toContain('柜台下')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect((await api.readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.facts).toEqual(facts)
  let parent = f.sessionId
  for (const title of ['history-child', 'history-nested']) {
    const source = await api.readProductRuntimeState(parent), child = await api.branchProductRuntimeSession({parentSessionId: parent, throughSequence: source.lastSequence, title})
    await api.deleteProductRuntimeSession(parent); parent = child.id!
  }
  const expected = (await api.readProductRuntimeState(parent)).interaction!
  const expectedSelection = buildInteractionContextWindow(expected, 'guard').selection
  const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)); db.close(); await db.open()
  const session = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(s => s.title === 'history-nested')!
  const restored = (await api.readProductRuntimeState(session.id!)).interaction!
  expect(restored).toEqual(expected); expect(buildInteractionContextWindow(restored, 'guard').selection).toEqual(expectedSelection)
  expect(await db.productRuntimeEvents.where('sessionId').equals(parent).count()).toBe(0)
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(parent).count()).toBe(0)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  expect(expressionAndReviewCalls).toBe(54)
}, 90_000)
