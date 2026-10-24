import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import * as skills from '../../src/lib/agent/skill-registry'
import * as harness from '../../src/lib/character-interaction/harness'
import {advanceChatNarrativeTurnV1, readChatNarrativeTurnResumeV1} from '../../src/lib/character-interaction/narrative-turn'
import {branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {readChatActionRevisionSourceV1} from '../../src/lib/character-interaction/action-revision'
import {db} from '../../src/lib/db/schema'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {chatInquiryReviewFixture} from '../helpers/chat-inquiry-output'
import type {ChatNarrativeActionV1, ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const generate = harness.generateInteractionRuntimeCandidateV1
const getSkill = skills.getAgentSkillV1
const versions: Record<string, string> = {'character.chat-narrative-action': 'chat-narrative-action-v72', 'character.chat-narrative-action-review': 'chat-narrative-action-review-v42',
  'character.chat-narrative-options': 'chat-narrative-options-v42', 'character.chat-narrative-options-review': 'chat-narrative-options-review-v30',
  'character.chat-action-revision': 'chat-action-revision-v25', 'character.chat-situation-construction': 'chat-situation-construction-v21', 'character.chat-situation-review': 'chat-situation-review-v19'}
const config = {provider: 'openai' as const, model: 'isolated-fixture', apiKey: 'isolated-fixture', maxTokens: 4000, temperature: .2}
const respondent = {respondentFactKey: 'clerk-present', respondentExcerpt: '掌柜在柜台另一端，可以当面交谈。', respondentName: '掌柜'}
beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  for (const [id, promptVersion] of Object.entries(versions)) expect(getSkill(id).promptVersion).toBe(promptVersion)
})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function fixture(options: {rejectSecond?: boolean; interruptBeforeAnswer?: boolean} = {}) {
  const f = await seedChatNarrativeRuntimeFixture({inquiryResults: true, maxActionsPerTrigger: 2}), seen: string[] = []
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(async input => {
    const state = (await readProductRuntimeState(f.sessionId)).interaction!, story = state.chatNarrative!
    if (options.interruptBeforeAnswer && input.skillId === 'character.chat-situation-construction') throw new Error('fixture-interrupted-before-dispatch')
    let draft: ChatSituationDraftV1 | undefined
    return generate({...input, runAI: withChatActionChoiceFixture(async messages => {
      seen.push(input.skillId)
      if (input.skillId === 'character.chat-situation-construction') {
        expect(messages[0].content).toContain('只结算这一条已问出的问题')
        expect(messages[1].content).toContain('"version":5')
        expect(messages[1].content).toContain(respondent.respondentExcerpt)
        const pending = story.pendingSituation!, first = !story.inquiryHistory?.length
        draft = {kind: 'chat-situation', title: story.situation.title, location: story.situation.location, timeLabel: story.situation.timeLabel,
          newFacts: [], newGoals: [], newThreads: [], possibilities: [], inquiryResult: {actorKey: 'guard', questionSequence: pending.sourceEventSequence,
            questionExcerpt: pending.evidenceExcerpt, ...respondent, statementFactKey: first ? 'clerk-time' : 'clerk-visitor', answerKind: 'uncertain',
            answerText: first ? '我记得傍晚还看见过，具体时间没留意。' : '我没有留意谁靠近柜台，无法指认。', audienceKeys: ['guard', 'player'],
            evidenceFactKeys: [...pending.evidenceFactKeys], discoveries: []}}
        return JSON.stringify(draft)
      }
      expect(messages[0].content).toContain('同一行动登记 situationRequest')
      const first = !story.inquiryHistory?.length
      if (!first) expect(messages[1].content).toContain('具体时间没留意')
      const text = first ? '叶岑问掌柜：“你最后一次见到铜印是什么时候？”' : '叶岑接着问掌柜：“那之后你有没有留意谁靠近柜台？”'
      const evidenceFactKeys = ['lost', 'clerk-present', ...(!first ? ['clerk-time'] : [])]
      const action: ChatNarrativeActionV1 = {kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys, audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
        situationRequest: {purpose: 'inquiry-result', threadKey: 'investigate', direction: '只回应本次已经问出的具体问题，保留无法确认或拒答。', evidenceFactKeys, evidenceExcerpt: text, ...respondent}}
      return JSON.stringify(action)
    }), runReviewAI: async messages => {
      if (!draft) {expect(messages[0].content).toContain('独立核对正文已实际向同一在场'); return JSON.stringify(chatActionReviewOutputFixture())}
      expect(messages[0].content).toContain('只结算已提交问题')
      const review = chatInquiryReviewFixture(draft)
      if (options.rejectSecond && story.inquiryHistory?.length) review.inquiryReview.checks.find(c => c.check === 'meaningful-result')!.passed = false
      return JSON.stringify(review)
    }})
  })
  const start = () => advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: f.sceneSequence,
    kind: 'scene-start', participantKey: 'guard', actionLimit: 2, settleSituation: true, aiConfig: config})
  return {...f, start, seen, spy}
}

it('settles two actual questions in one bounded turn and restores their exact history without another action', async () => {
  const f = await fixture(), before = await readProductRuntimeState(f.sessionId)
  await f.start()
  expect(f.seen).toEqual(['character.chat-narrative-action', 'character.chat-situation-construction', 'character.chat-narrative-action', 'character.chat-situation-construction'])
  const after = await readProductRuntimeState(f.sessionId), story = after.interaction!.chatNarrative!
  expect(after.interaction!.messages).toHaveLength(2)
  expect(story.inquiryHistory).toHaveLength(2)
  expect(story.triggers.at(-1)?.status).toBe('complete')
  expect(story.triggers.at(-1)?.actionSequences).toHaveLength(2)
  expect(story.pendingSituation).toBeUndefined()
  expect(after.interaction!.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 10)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, after.interaction!)).toBeNull()
  db.close(); await db.open(); expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: 'settled questions'})
  const branched = await readProductRuntimeState(branch.id!)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched.interaction)
  expect(f.seen).toHaveLength(4)
})

it('retains the exact final pending question on review rejection, without retry, extra action or answer write', async () => {
  const f = await fixture({rejectSecond: true})
  await expect(f.start()).rejects.toThrow('审查')
  const after = await readProductRuntimeState(f.sessionId)
  expect(f.seen).toHaveLength(4)
  expect(after.interaction!.messages).toHaveLength(2)
  expect(after.interaction!.chatNarrative!.inquiryHistory).toHaveLength(1)
  expect(after.interaction!.chatNarrative!.pendingSituation?.purpose).toBe('inquiry-result')
  expect(after.interaction!.chatNarrative!.situation.facts.some(f => f.factKey === 'clerk-visitor')).toBe(false)
  db.close(); await db.open(); expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
  expect(f.seen).toHaveLength(4)
})

it('keeps a pending question through branch/import and refresh without dispatching a reply', async () => {
  const f = await fixture({interruptBeforeAnswer: true})
  await expect(f.start()).rejects.toThrow('fixture-interrupted-before-dispatch')
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.chatNarrative!.pendingSituation?.purpose).toBe('inquiry-result')
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: 'pending exact question'})
  const expected = await readProductRuntimeState(branch.id!)
  expect(expected.interaction!.chatNarrative!.pendingSituation!.sourceEventSequence).toBeLessThan(0)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(expected.interaction)
  expect(f.seen).toEqual(['character.chat-narrative-action'])
})

async function preparedQuestion() {
  const f = await seedChatNarrativeRuntimeFixture({inquiryResults: true, maxActionsPerTrigger: 1})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'question-entry', baseSequence: v.sequence,
    baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 1, settleSituationVersion: 1}})
  return {...f, triggerSequence: trigger.sequence}
}
function questionAction(text: string, pending = true): ChatNarrativeActionV1 {
  return {kind: 'speak', text, goalKey: 'find-seal', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['lost', 'clerk-present'],
    waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    ...(pending ? {situationRequest: {purpose: 'inquiry-result', threadKey: 'investigate', direction: '回应掌柜刚听到的这个问题。',
      evidenceFactKeys: ['lost', 'clerk-present'], evidenceExcerpt: text, ...respondent}} : {})}
}
async function settleChosenQuestion(f: Awaited<ReturnType<typeof preparedQuestion>>) {
  const before = (await readProductRuntimeState(f.sessionId)).interaction!, story = before.chatNarrative!, pending = story.pendingSituation!
  const draft: ChatSituationDraftV1 = {kind: 'chat-situation', title: story.situation.title, location: story.situation.location, timeLabel: story.situation.timeLabel,
    newFacts: [], newGoals: [], newThreads: [], possibilities: [], inquiryResult: {actorKey: 'guard', questionSequence: pending.sourceEventSequence,
      questionExcerpt: pending.evidenceExcerpt, ...respondent, statementFactKey: 'selected-question-answer', answerKind: 'uncertain',
      answerText: '这件事我没有留意，不能确定。', audienceKeys: ['guard', 'player'], evidenceFactKeys: pending.evidenceFactKeys, discoveries: []}}
  const generated = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: before.playerKey, skillId: 'character.chat-situation-construction',
    narrativeTriggerSequence: f.triggerSequence, objective: '只结算已选择并提交的实际问题',
    runAI: async messages => {expect(messages[1].content).toContain('"version":5'); expect(messages[1].content).toContain(pending.evidenceExcerpt); return JSON.stringify(draft)},
    runReviewAI: async () => JSON.stringify(chatInquiryReviewFixture(draft))})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(after.messages).toEqual(before.messages)
  expect(after.chatNarrative!.inquiryHistory).toHaveLength(1)
  expect(after.chatNarrative!.inquiryHistory![0].questionExcerpt).toBe(pending.evidenceExcerpt)
  expect(after.chatNarrative!.pendingSituation).toBeUndefined()
  expect(after.chatNarrative!.triggers.at(-1)?.actionSequences).toHaveLength(1)
  db.close(); await db.open(); expect((await readProductRuntimeState(f.sessionId)).interaction).toEqual(after)
}

it.each(['option-1', 'option-2'])('settles only %s after explicit selection, without treating the other question as spoken', async optionKey => {
  const f = await preparedQuestion(), before = await readProductRuntimeState(f.sessionId)
  const actions = [questionAction('叶岑问掌柜：“你最后一次见到铜印是什么时候？”'), questionAction('叶岑问掌柜：“你还记得上次用印的人是谁吗？”')]
  const generated = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-options',
    narrativeTriggerSequence: f.triggerSequence, objective: '提供两条不同的问话，由玩家明确选择一次',
    runAI: withChatActionChoiceFixture(async messages => {expect(messages[0].content).toContain('同一行动登记 situationRequest'); return JSON.stringify({options: actions})}),
    runReviewAI: async messages => {expect(messages[0].content).toContain('独立核对正文已实际向同一在场');
      return JSON.stringify({options: actions.map((_, i) => ({optionKey: `option-${i + 1}`, ...chatActionReviewOutputFixture()}))})}})
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  await expect(harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow('请选择')
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, optionKey})
  const selected = actions[optionKey === 'option-1' ? 0 : 1], state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.map(m => m.text)).toEqual([selected.text])
  expect(state.chatNarrative!.pendingSituation?.evidenceExcerpt).toBe(selected.text)
  expect(state.chatNarrative!.inquiryHistory ?? []).toHaveLength(0)
  await settleChosenQuestion(f)
})

it('repairs the missing result request without changing the rejected question or its original failed run', async () => {
  const f = await preparedQuestion(), text = '叶岑问掌柜：“你最后一次见到铜印是什么时候？”'
  let originalId = 0
  await expect(generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    narrativeTriggerSequence: f.triggerSequence, objective: '向掌柜实际发问', onRunCreated: id => {originalId = id},
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(questionAction(text, false))), runReviewAI: async () => {
      const report = chatActionReviewOutputFixture(); report.checks.find(c => c.check === 'consequences')!.passed = false; return JSON.stringify(report)
    }})).rejects.toThrow('审查')
  const original = await readInstanceAgentRunV1(f.scope, originalId)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(0)
  expect(await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId})).not.toBeNull()
  const revision = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-action-revision',
    narrativeTriggerSequence: f.triggerSequence, objective: '明确修订原问话的结果请求，不改表达',
    runAI: async messages => {expect(messages[0].content).toContain('同一行动登记 situationRequest'); return JSON.stringify(questionAction(text))},
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: revision.snapshot.run.id})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages.map(m => m.text)).toEqual([text])
  await settleChosenQuestion(f)
  expect(await readInstanceAgentRunV1(f.scope, originalId)).toEqual(original)
})
