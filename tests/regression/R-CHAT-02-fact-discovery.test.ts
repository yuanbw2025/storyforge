import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {createInitialInteractionState, interactionVisibilityView, buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {parseChatNarrativeStateV1, parseFrozenChatNarrativeV1, rebaseChatNarrativeStateV1} from '../../src/lib/character-interaction/narrative-contract'
import {applyChatSituationV1, parseChatSituationDraftV1, chatSituationCoordinatorViewV1} from '../../src/lib/character-interaction/narrative-situations'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatSituationReviewV1} from '../../src/lib/character-interaction/harness'
import {requestChatNarrativeTrigger, readProductRuntimeState, readProductRuntimeStateVersion, branchProductRuntimeSession} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatNarrativeFixture, enableChatFactDiscoveryFixture, chatActionReviewFixture, chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const boundary = {participantKeys: ['guard', 'artisan'], characterKeys: ['character:guard', 'character:artisan'], sceneKeys: ['inn']}
const truth = '铜印在柜台下的木箱里。'
const investigated = '叶岑独自打开并查看获准检查的木箱内部。'
function inspection(): ChatNarrativeActionV1 {
  return {kind: 'complete', text: investigated, goalKey: 'find-seal', evidenceFactKeys: ['lost', 'box'], audienceKeys: ['player', 'guard'], waitingForPlayer: false,
    newFacts: [{factKey: 'inspected', kind: 'observation', text: investigated, evidenceFactKeys: ['box'], evidenceExcerpt: investigated}], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {threadKey: 'investigate', direction: '依据刚才实际检查木箱的结果确认是否有可观察的发现，不能预定找到铜印。', evidenceFactKeys: ['lost', 'box', 'inspected'], evidenceExcerpt: investigated}}
}
function prepared() {
  const content = chatNarrativeFixture(); enableChatFactDiscoveryFixture(content)
  let state = createInitialInteractionState(content)
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  state = requestChatNarrativeTriggerV1(state, {sequence: 2, sourceEventSequence: 1, kind: 'scene-start', seed: null})
  const action = inspection()
  state = applyReviewedChatNarrativeActionV1(state, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'inspect', action, review: chatActionReviewFixture(action)})
  return requestChatNarrativeTriggerV1(state, {sequence: 4, sourceEventSequence: 3, kind: 'continue', seed: null})
}
function draft(actionSequence = 3, result: 'discovered' | 'not-discovered' | 'inconclusive' = 'discovered'): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newFacts: [], newGoals: [], newThreads: [], possibilities: [],
    discoveries: [{factKey: 'secret', actorKey: 'guard', actionSequence, evidenceFactKeys: ['lost', 'box', 'inspected'], evidenceExcerpt: investigated, result, reason: '工程判定夹具；实际条件的语义核验另须真实模型与人工验收。'}]}
}
function review(value = draft()) {
  return {reviewedProposalJson: canonicalStringify(value), checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程审查夹具'}))}
}
function apply(state = prepared(), value = draft()) {return applyChatSituationV1(state, {sequence: 5, triggerSequence: 4, draft: value, review: review(value)})}

it('unlocks the same canonical fact for the investigator, then requires a separate real disclosure to inform the player', () => {
  const before = prepared(), state = apply(before), old = before.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!
  expect(state.chatNarrative!.situation.facts).toHaveLength(before.chatNarrative!.situation.facts.length)
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')).toEqual({...old, audienceKeys: ['guard']})
  expect(state.messages).toEqual(before.messages)
  const role = formatInteractionRuntimeContextV1(state.profiles[0], buildInteractionContextWindow(state, 'guard'))
  expect(role).toContain(truth); expect(role).not.toContain(old.discovery!.condition)
  expect(JSON.stringify(interactionVisibilityView(state, 'player'))).not.toContain(truth)
  expect(JSON.stringify(interactionVisibilityView(state, 'artisan'))).not.toContain(truth)
  expect(chatSituationCoordinatorViewV1(state).discoveryHistory).toEqual([{...draft().discoveries![0], discoverySequence: 5}])
  const action: ChatNarrativeActionV1 = {kind: 'complete', text: `叶岑说：“${truth}”`, goalKey: 'find-seal', evidenceFactKeys: ['secret'], audienceKeys: ['player', 'guard'], waitingForPlayer: false,
    newFacts: [], disclosures: [{factKey: 'secret', toParticipantKeys: ['player'], evidenceExcerpt: truth}], threadUpdates: [], goalStatus: 'fulfilled', nextPossibilities: []}
  const announced = applyReviewedChatNarrativeActionV1(state, {sequence: 6, triggerSequence: 4, actorKey: 'guard', messageId: 'announce', action, review: chatActionReviewFixture(action)})
  expect(JSON.stringify(interactionVisibilityView(announced, 'player'))).toContain(truth)
  expect(announced.chatNarrative!.situation.goals[0].status).toBe('fulfilled')
  expect(before.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual([])
})

it.each(['not-discovered', 'inconclusive'] as const)('retains %s without leaking fact identifiers, conditions or coordinator reasons', result => {
  const state = apply(prepared(), draft(3, result)), view = interactionVisibilityView(state, 'guard').chatNarrative!
  expect(view.investigations).toEqual([{actionSequence: 3, result, discoveredFactKeys: []}])
  const text = JSON.stringify(view)
  expect(text).not.toContain('secret'); expect(text).not.toContain(truth); expect(text).not.toContain('工程判定')
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual([])
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
})

it('commits a physical reveal and its knowledge consequence together, while a rejected missing disclosure changes neither', () => {
  const state = apply(), before = structuredClone(state)
  const moved = '叶岑从打开的木箱里取出铜印，放在柜台上。'
  const action: ChatNarrativeActionV1 = {kind: 'complete', text: `${truth}${moved}`, goalKey: 'find-seal', evidenceFactKeys: ['secret', 'inspected'], audienceKeys: ['player', 'guard'], waitingForPlayer: false,
    newFacts: [{factKey: 'seal-on-counter', kind: 'object', text: moved, evidenceFactKeys: ['secret', 'inspected'], evidenceExcerpt: moved}],
    disclosures: [{factKey: 'secret', toParticipantKeys: ['player'], evidenceExcerpt: truth}], threadUpdates: [], goalStatus: null}
  const omitted = {...action, disclosures: []}, denied = chatActionReviewFixture(omitted)
  for (const check of denied.checks) if (['visibility', 'consequences'].includes(check.check)) {check.passed = false; check.reason = '向玩家展示物品但遗漏知情变化'}
  expect(() => applyReviewedChatNarrativeActionV1(state, {sequence: 6, triggerSequence: 4, actorKey: 'guard', messageId: 'show-denied', action: omitted, review: denied})).toThrow('审查')
  expect(state).toEqual(before)
  const shown = applyReviewedChatNarrativeActionV1(state, {sequence: 6, triggerSequence: 4, actorKey: 'guard', messageId: 'show', action, review: chatActionReviewFixture(action)})
  expect(shown.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')).toEqual({...before.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!, audienceKeys: ['guard', 'player']})
  expect(shown.chatNarrative!.situation.facts.find(f => f.factKey === 'seal-on-counter')).toMatchObject({text: moved, sourceEventSequence: 6, audienceKeys: ['player', 'guard']})
  expect(JSON.stringify(interactionVisibilityView(shown, 'artisan'))).not.toContain(moved)
})

it.each(['wrong-actor', 'wrong-event', 'missing-prerequisite', 'hidden-evidence', 'false-excerpt', 'old-inspection', 'wrong-scene', 'no-permission', 'no-rule'] as const)('rejects %s atomically', kind => {
  const state = prepared(), value = draft()
  if (kind === 'wrong-actor') value.discoveries![0].actorKey = 'artisan'
  if (kind === 'wrong-event') value.discoveries![0].actionSequence = 2
  if (kind === 'missing-prerequisite') value.discoveries![0].evidenceFactKeys = ['inspected']
  if (kind === 'hidden-evidence') value.discoveries![0].evidenceFactKeys.push('secret')
  if (kind === 'false-excerpt') value.discoveries![0].evidenceExcerpt = '打算打开木箱'
  if (kind === 'old-inspection') state.chatNarrative!.situation.facts.find(f => f.factKey === 'inspected')!.sourceEventSequence = 1
  if (kind === 'wrong-scene') state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.discovery!.sceneKey = 'elsewhere'
  if (kind === 'no-permission') delete state.chatNarrative!.permissions.maxDiscoveriesPerSituation
  if (kind === 'no-rule') delete state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.discovery
  const unchanged = structuredClone(state)
  expect(() => apply(state, value)).toThrow(); expect(state).toEqual(unchanged)
})

it('does not unlock on a player seed, a rejected condition, a duplicate result or a changed review binding', () => {
  const before = prepared(), value = draft(), denied = review(value); denied.checks[1].passed = false
  expect(() => applyChatSituationV1(before, {sequence: 5, triggerSequence: 4, draft: value, review: denied})).toThrow('审查')
  const seed = requestChatNarrativeTriggerV1(before, {sequence: 5, sourceEventSequence: 4, kind: 'player-seed', seed: '让我知道箱子里的真相'})
  expect(() => applyChatSituationV1(seed, {sequence: 6, triggerSequence: 5, draft: value, review: review(value)})).toThrow('实际调查')
  expect(() => parseChatSituationDraftV1({...value, discoveries: [...value.discoveries!, ...value.discoveries!]})).toThrow('重复')
  expect(() => applyChatSituationV1(before, {sequence: 5, triggerSequence: 4, draft: value, review: review(draft(3, 'inconclusive'))})).toThrow('另一份')
  expect(() => applyChatSituationV1(apply(before), {sequence: 6, triggerSequence: 4, draft: value, review: review(value)})).toThrow('已经构建')
  expect(before.chatNarrative!.discoveryHistory).toBeUndefined()
})

it('requires explicit author permission and own visible prerequisites, preserving old contracts and rejecting source-authority escalation', () => {
  const old = chatNarrativeFixture()
  expect(parseFrozenChatNarrativeV1(old.chatNarrative, {...boundary, source: old.chatSource!})).toEqual(old.chatNarrative)
  const content = chatNarrativeFixture(); enableChatFactDiscoveryFixture(content)
  expect(parseFrozenChatNarrativeV1(content.chatNarrative, {...boundary, source: content.chatSource!})).toEqual(content.chatNarrative)
  for (const change of ['player', 'hidden', 'world', 'permission'] as const) {
    const value = structuredClone(content.chatNarrative!), fact = value.initialSituation.facts.find(f => f.factKey === 'secret')!
    if (change === 'player') fact.discovery!.actorKeys = ['player']
    if (change === 'hidden') fact.discovery!.prerequisiteFactKeys = ['secret']
    if (change === 'world') {fact.origin = 'reviewed-world'; fact.sourceKnowledgeKey = 'source.lost'}
    if (change === 'permission') delete value.permissions.maxDiscoveriesPerSituation
    expect(() => parseFrozenChatNarrativeV1(value, {...boundary, source: content.chatSource!})).toThrow()
  }
})

it('rebases discovery causality with branches and rejects forged or future history', () => {
  const story = apply().chatNarrative!
  rebaseChatNarrativeStateV1(story, sequence => sequence === 0 ? 0 : sequence - 100)
  expect(parseChatNarrativeStateV1(story, boundary)).toEqual(story)
  expect(story.discoveryHistory![0]).toMatchObject({actionSequence: -97, discoverySequence: -95})
  for (const patch of [{discoverySequence: 10}, {actionSequence: -99}, {evidenceFactKeys: ['lost']}, {actorKey: 'player'}]) {
    const bad = structuredClone(story); Object.assign(bad.discoveryHistory![0], patch)
    expect(() => parseChatNarrativeStateV1(bad, boundary)).toThrow()
  }
})

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
it('recovers a persisted discovery candidate, adopts once, and preserves causality through refresh, branches and export/import', async () => {
  const f = await seedChatNarrativeRuntimeFixture({factDiscovery: true})
  let v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'open', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const action = inspection()
  const inspected = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: 'character.chat-narrative-action', objective: '独立调查已获准的木箱，不提前知道结果', narrativeTriggerSequence: trigger.sequence,
    runAI: withChatActionChoiceFixture(async messages => {expect(JSON.stringify(messages)).not.toContain(truth); expect(JSON.stringify(messages)).toContain('所有披露统一进入逐事实独立等义审查'); return JSON.stringify(action)}),
    runReviewAI: async messages => {
      const request = JSON.stringify(messages)
      expect(request).toContain(truth); expect(request).toContain('物理观察发现分两阶段'); expect(request).toContain(investigated)
      expect(request).toContain('个人暂停不等于共同事项结束')
      return JSON.stringify(chatActionReviewOutputFixture())
    },
  })
  expect(inspected.snapshot.contract.executionBindings?.find(b => b.skillId === 'character.chat-narrative-action-review')?.promptVersion).toBe('chat-narrative-action-review-v42')
  expect(inspected.snapshot.contract.executionBindings?.find(b => b.stepId === 'interaction:runtime-candidate')?.promptVersion).toBe('chat-narrative-action-v72')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: inspected.snapshot.run.id})
  v = await readProductRuntimeStateVersion(f.sessionId)
  const value = draft(v.sequence)
  const afterInspection = (await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!
  expect(afterInspection.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual([])
  expect(afterInspection.situation.goals[0].status).toBe('active')
  expect(afterInspection.pendingSituation!.sourceEventSequence).toBe(v.sequence)
  const continued = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'continue', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'continue', sourceEventSequence: v.sequence})
  let runId = 0, generated = 0, reviewed = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId: 'character.chat-situation-construction',
    objective: '审查实际调查结果', narrativeTriggerSequence: continued.sequence,
    runAI: async messages => {generated++; expect(JSON.stringify(messages)).toContain(truth); return JSON.stringify(value)},
    onSituationDraftSaved: id => {runId = id; throw new Error('host-crash-before-review')},
  })).rejects.toThrow('host-crash-before-review')
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.discoveryHistory).toBeUndefined()
  db.close(); await db.open()
  await resumeChatSituationReviewV1({scope: f.scope, runId, runReviewAI: async messages => {reviewed++; expect(JSON.stringify(messages)).toContain('条件'); return JSON.stringify({checks: review(value).checks})}})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId, onDurableBoundary: type => {if (type === 'runtime.candidate.adopted') throw new Error('host-crash-after-commit')}})).rejects.toThrow('host-crash-after-commit')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const state = await readProductRuntimeState(f.sessionId)
  expect([generated, reviewed]).toEqual([1, 1]); expect(state.interaction!.chatNarrative!.discoveryHistory).toHaveLength(1)
  expect(state.interaction!.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual(['guard'])
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: state.lastSequence, title: '调查后分支'})
  expect((await readProductRuntimeState(branch.id!)).interaction!.chatNarrative!.discoveryHistory).toHaveLength(1)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.parentSessionId == null)!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(state.interaction)
})
