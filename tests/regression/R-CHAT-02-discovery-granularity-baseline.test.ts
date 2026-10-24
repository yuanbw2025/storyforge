import {expect, it} from 'vitest'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {createInitialInteractionState, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {parseChatFactDiscoveriesV1} from '../../src/lib/character-interaction/narrative-discovery'
import {applyChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {chatNarrativeFixture, enableChatFactDiscoveryFixture, chatActionReviewFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

// Contract diagnostics, not model acceptance. The atomic variant below is an
// explicitly different authored fixture, never a rewrite of the V97 material.
const compoundTruth = '铜印被掌柜拿去拓印破损的通行单，放在柜台下的木箱里；守卫和玩家起初都不知道。'
const locationTruth = '铜印在柜台下的木箱里。'
const inspected = '叶岑独自打开并查看获准检查的木箱内部。'
const asked = '叶岑向掌柜问：“您是否知道铜印放在哪里？”'
function beforeAction(atomic = false, unknownContainer = false) {
  const content = chatNarrativeFixture(); enableChatFactDiscoveryFixture(content)
  const fact = content.chatNarrative!.initialSituation.facts.find(f => f.factKey === 'secret')!
  fact.text = atomic ? locationTruth : compoundTruth
  if (!atomic) fact.discovery!.condition = '角色核对木箱内的铜印，并从掌柜明确说明中核实经手者及用途；只见到位置不足以得知整条事实。'
  else content.chatNarrative!.initialSituation.facts.push({factKey: 'history', text: '掌柜拿铜印拓印破损的通行单。', audienceKeys: [], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  if (unknownContainer) {
    const box = content.chatNarrative!.initialSituation.facts.find(f => f.factKey === 'box')!
    box.text = '柜台下有一只木箱。'; box.audienceKeys = []
    box.discovery = {sceneKey: 'inn', actorKeys: ['guard'], prerequisiteFactKeys: ['lost', 'counter'], condition: '实际查看柜台下方，确认木箱本身；不含箱内内容。'}
    fact.discovery!.prerequisiteFactKeys = ['lost', 'counter']
    content.chatNarrative!.initialSituation.facts.push({factKey: 'counter', text: '大厅有柜台，守卫可以查看其下方并检查普通储物箱。', audienceKeys: ['guard', 'player'],
      origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  }
  let state = createInitialInteractionState(content)
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  state = requestChatNarrativeTriggerV1(state, {sequence: 2, sourceEventSequence: 1, kind: 'scene-start', seed: null})
  return state
}
function prepared(input: {atomic?: boolean; inquiry?: boolean} = {}) {
  const state = beforeAction(input.atomic), text = input.inquiry ? asked : inspected
  const action: ChatNarrativeActionV1 = {kind: input.inquiry ? 'speak' : 'complete', text, goalKey: 'find-seal', evidenceFactKeys: ['lost', 'box'], audienceKeys: ['player', 'guard'], waitingForPlayer: false,
    newFacts: input.inquiry ? [] : [{factKey: 'inspected', kind: 'observation', text, evidenceFactKeys: ['box'], evidenceExcerpt: text}], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {threadKey: 'investigate', direction: input.inquiry ? '补足已提出问题的实际回应，不能预写答案。' : '确认已完成查看的有限结果。', evidenceFactKeys: input.inquiry ? ['lost', 'box'] : ['lost', 'box', 'inspected'], evidenceExcerpt: text}}
  const committed = applyReviewedChatNarrativeActionV1(state, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'actual-action', action, review: chatActionReviewFixture(action)})
  return requestChatNarrativeTriggerV1(committed, {sequence: 4, sourceEventSequence: 3, kind: 'continue', seed: null})
}
function candidate(inquiry = false): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newFacts: [], newGoals: [], newThreads: [], possibilities: [],
    discoveries: [{factKey: 'secret', actorKey: 'guard', actionSequence: 3, evidenceFactKeys: inquiry ? ['lost', 'box'] : ['lost', 'box', 'inspected'], evidenceExcerpt: inquiry ? asked : inspected, result: 'discovered', reason: '工程夹具；不声称整条条件已被模型证实。'}]}
}
function review(draft: ChatSituationDraftV1, allowed: boolean) {
  return {reviewedProposalJson: canonicalStringify(draft), checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: check === 'visibility' ? allowed : true, reason: '模拟语义结论，仅核查合同后果'}))}
}
function apply(state: ReturnType<typeof prepared>, draft: ChatSituationDraftV1, allowed = true) {
  return applyChatSituationV1(state, {sequence: 5, triggerSequence: 4, draft, review: review(draft, allowed)})
}

it('reveals the entire compound fact when a discovery is approved; it has no partial-knowledge state', () => {
  const before = prepared(), state = apply(before, candidate())
  // This intentionally supplied affirmative review is NOT evidence that a
  // location inspection satisfies the compound condition. It exposes granularity.
  expect(JSON.stringify(interactionVisibilityView(state, 'guard'))).toContain(compoundTruth)
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.text).toBe(compoundTruth)
  expect(JSON.stringify(interactionVisibilityView(state, 'player'))).not.toContain(compoundTruth)
  expect(before.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual([])
})

it.each(['partial-result', 'partial-text'])('rejects an undeclared partial-discovery representation: %s', kind => {
  const item = candidate().discoveries![0]
  expect(() => parseChatFactDiscoveriesV1([kind === 'partial-result' ? {...item, result: 'partially-discovered'} : {...item, learnedText: locationTruth}])).toThrow()
})

it('keeps the entire secret unknown when review rejects insufficient evidence for the compound statement', () => {
  const before = prepared(), saved = structuredClone(before)
  expect(() => apply(before, candidate(), false)).toThrow('语义审查未通过')
  expect(before).toEqual(saved)
  expect(JSON.stringify(interactionVisibilityView(before, 'guard'))).not.toContain(compoundTruth)
})

it('cannot bypass compound authority by citing the hidden source as a new public location fact', () => {
  const state = prepared(), draft = candidate(); delete draft.discoveries
  draft.newFacts = [{factKey: 'partial-location', kind: 'observation', text: locationTruth, audienceKeys: ['player', 'guard'], evidenceFactKeys: ['secret', 'inspected'], seedExcerpt: '确认已完成查看'}]
  const saved = structuredClone(state)
  expect(() => apply(state, draft)).toThrow('不能传播不可知的依据')
  expect(state).toEqual(saved)
})

it('an independently authored atomic fact can be discovered without revealing its separately authored history', () => {
  const state = apply(prepared({atomic: true}), candidate()), view = JSON.stringify(interactionVisibilityView(state, 'guard'))
  expect(view).toContain(locationTruth)
  expect(view).not.toContain('拓印')
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'history')!.audienceKeys).toEqual([])
})

it('supports two actual investigations from an unknown container to its hidden content without exposing history or player knowledge', () => {
  // A new authored contract, NOT an upgrade of an old compound fact. The
  // affirmative reviews below test mechanics, not whether a model will do this.
  const before = beforeAction(true, true), saved = structuredClone(before)
  const text = '叶岑蹲下，实际查看了柜台下方。'
  const search: ChatNarrativeActionV1 = {kind: 'complete', text, goalKey: 'find-seal', evidenceFactKeys: ['lost', 'counter'],
    audienceKeys: ['guard', 'player'], waitingForPlayer: false, disclosures: [], threadUpdates: [], goalStatus: null,
    newFacts: [{factKey: 'looked-under', kind: 'observation', text, evidenceFactKeys: ['counter'], evidenceExcerpt: text}],
    situationRequest: {purpose: 'observation-result', threadKey: 'investigate', direction: '确认已完成查看的有限结果。',
      evidenceFactKeys: ['lost', 'counter', 'looked-under'], evidenceExcerpt: text}}
  const searched = applyReviewedChatNarrativeActionV1(before, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'under-counter', action: search, review: chatActionReviewFixture(search)})
  const pending = requestChatNarrativeTriggerV1(searched, {sequence: 4, sourceEventSequence: 3, kind: 'continue', seed: null})
  const boxResult = candidate()
  boxResult.discoveries = [{factKey: 'box', actorKey: 'guard', actionSequence: 3, evidenceFactKeys: ['lost', 'counter', 'looked-under'],
    evidenceExcerpt: text, result: 'discovered', reason: '工程夹具，仅确认容器本身。'}]
  const boxKnown = apply(pending, boxResult), actor = JSON.stringify(interactionVisibilityView(boxKnown, 'guard'))
  expect(actor).toContain('柜台下有一只木箱。'); expect(actor).not.toContain(locationTruth); expect(actor).not.toContain('拓印')
  expect(JSON.stringify(interactionVisibilityView(boxKnown, 'player'))).not.toContain('柜台下有一只木箱。')
  expect(before).toEqual(saved)
  const inspect: ChatNarrativeActionV1 = {...search, text: '柜台下有一只木箱。' + inspected, evidenceFactKeys: ['lost', 'counter', 'box'],
    disclosures: [{factKey: 'box', toParticipantKeys: ['player'], evidenceExcerpt: '柜台下有一只木箱。'}],
    newFacts: [{factKey: 'inspected', kind: 'observation', text: inspected, evidenceFactKeys: ['counter', 'box'], evidenceExcerpt: inspected}],
    situationRequest: {...search.situationRequest!, evidenceFactKeys: ['lost', 'counter', 'box', 'inspected'], evidenceExcerpt: inspected}}
  const opened = applyReviewedChatNarrativeActionV1(boxKnown, {sequence: 6, triggerSequence: 4, actorKey: 'guard', messageId: 'inside-box', action: inspect, review: chatActionReviewFixture(inspect)})
  const secondPending = requestChatNarrativeTriggerV1(opened, {sequence: 7, sourceEventSequence: 6, kind: 'continue', seed: null})
  const contentResult = candidate()
  contentResult.discoveries = [{factKey: 'secret', actorKey: 'guard', actionSequence: 6, evidenceFactKeys: ['lost', 'counter', 'box', 'inspected'],
    evidenceExcerpt: inspected, result: 'discovered', reason: '工程夹具，仅确认箱内位置。'}]
  const learned = applyChatSituationV1(secondPending, {sequence: 8, triggerSequence: 7, draft: contentResult, review: review(contentResult, true)})
  const visible = JSON.stringify(interactionVisibilityView(learned, 'guard'))
  expect(visible).toContain(locationTruth); expect(visible).not.toContain('拓印')
  expect(JSON.stringify(interactionVisibilityView(learned, 'player'))).not.toContain(locationTruth)
  expect(learned.chatNarrative!.discoveryHistory?.map(row => [row.factKey, row.actionSequence])).toEqual([['box', 3], ['secret', 6]])
  expect(learned.chatNarrative!.situation.goals.find(row => row.goalKey === 'find-seal')!.status).toBe('active')
})

it('retains the actual spoken inquiry but cannot use it as the required completed-investigation fact', () => {
  const state = prepared({inquiry: true}), saved = structuredClone(state)
  expect(state.messages.at(-1)?.text).toBe(asked)
  expect(state.chatNarrative!.pendingSituation!.sourceEventSequence).toBe(3)
  expect(state.chatNarrative!.situation.facts.some(f => f.origin === 'runtime-consequence' && f.sourceEventSequence === 3)).toBe(false)
  expect(() => apply(state, candidate(true))).toThrow('调查必须有本次实际完成行动的事实证据')
  expect(state).toEqual(saved)
})

it('does not let a pending question fabricate a completed answer through a speech action', () => {
  const state = beforeAction(), text = asked
  const action: ChatNarrativeActionV1 = {kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [{factKey: 'question-complete', kind: 'observation', text, evidenceFactKeys: ['lost'], evidenceExcerpt: text}], disclosures: [], threadUpdates: [], goalStatus: null}
  expect(() => applyReviewedChatNarrativeActionV1(state, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'forged-answer', action, review: chatActionReviewFixture(action)})).toThrow('意图或等待选择不能写成已完成后果')
})
