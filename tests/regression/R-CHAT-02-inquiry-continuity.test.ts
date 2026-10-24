import actualInquiry from '../fixtures/character-chat-inquiry-continuity-v309.json'
import type {CharacterInteractionRuntimeState} from '../../src/lib/types'
import {chatInquiryQuestionEvidenceContextV1} from '../../src/lib/character-interaction/inquiry-evidence'
import {createHash} from 'node:crypto'
import {chatInquiryGenerationRulesV1, chatInquiryReviewRulesV1} from '../../src/lib/character-interaction/inquiry-prompt'
import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {readProductRuntimeState, readProductRuntimeStateVersion, branchProductRuntimeSession} from '../../src/lib/character-interaction/runtime-api'
import {previewChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {chatInquiryContinuityContextV1} from '../../src/lib/character-interaction/inquiry-continuity'
import {buildChatHistoryCoordinatorProjectionV1} from '../../src/lib/character-interaction/history-coordinator-context'
import {generateInteractionRuntimeCandidateV1, resumeChatSituationReviewV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {prepareChatInquiryFixture, chatInquiryDraftFixture, chatInquiryInputFixture, chatInquiryReviewFixture, inquiryQuestion, inquiryReassurance} from '../helpers/chat-inquiry-result'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('keeps the unanswered question eligible after a player acknowledgment and actor reassurance', async () => {
  const f = await prepareChatInquiryFixture({playerInterjection: '嗯，我在听。'})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!, draft = await chatInquiryDraftFixture(f.sessionId)
  const input = {sequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence + 1,
    triggerSequence: state.chatNarrative!.triggers.at(-1)!.requestedSequence, draft, inquiryEvidenceVersion: 3}
  const question = draft.inquiryResult!.questionSequence, request = state.chatNarrative!.pendingSituation!.sourceEventSequence
  expect(question).toBeLessThan(request)
  expect(state.messages.some(m => m.role === 'player' && m.eventSequence > question && m.eventSequence < request)).toBe(true)
  const before = structuredClone(state)
  expect(previewChatSituationV1(state, input).chatNarrative!.inquiryHistory![0].questionSequence).toBe(question)
  expect(state).toEqual(before)
  for (const version of [undefined, 1, 2]) expect(() => previewChatSituationV1(state, {...input, inquiryEvidenceVersion: version})).toThrow('实际询问')
})

it('rejects broken continuity, changed knowledge and already answered questions without mutating state', async () => {
  const f = await prepareChatInquiryFixture({playerInterjection: '嗯，我在听。'})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!, draft = await chatInquiryDraftFixture(f.sessionId)
  const question = draft.inquiryResult!.questionSequence, request = state.chatNarrative!.pendingSituation!.sourceEventSequence
  const input = {sequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence + 1,
    triggerSequence: state.chatNarrative!.triggers.at(-1)!.requestedSequence, draft, inquiryEvidenceVersion: 3}
  const player = state.messages.find(m => m.messageId === 'inquiry.player')!
  const mutations: Array<[string, (s: typeof state) => void]> = [
    ['other questioner', s => {s.messages.find(m => m.eventSequence === question)!.speakerKey = 'artisan'}],
    ['later scene', s => {s.activeScene!.startedAtSequence = request}],
    ['excluded question', s => {s.chatNarrative!.excludedMessageIds = [s.messages.find(m => m.eventSequence === question)!.messageId]}],
    ['excluded player withdrawal', s => {s.messages.find(m => m.messageId === player.messageId)!.text = '别再问了。'; s.chatNarrative!.excludedMessageIds = [player.messageId]}],
    ['superseded intervening message', s => {s.messages.find(m => m.messageId === player.messageId)!.supersededBySequence = request}],
    ['other actor knowledge change', s => {s.messages.find(m => m.eventSequence === request)!.speakerKey = 'artisan'}],
    ['later action', s => {s.chatNarrative!.triggers.at(-1)!.actionSequences.push(request + 1)}],
    ['unregistered question', s => {for (const t of s.chatNarrative!.triggers) t.actionSequences = t.actionSequences.filter(at => at !== question)}],
    ['later discovery', s => {s.chatNarrative!.discoveryHistory = [{discoverySequence: request, factKey: 'secret', actorKey: 'guard', actionSequence: question, evidenceFactKeys: ['box'], evidenceExcerpt: inquiryQuestion, result: 'inconclusive', reason: 'changed knowledge boundary'}]}],
    ['already answered', s => {s.chatNarrative!.inquiryHistory = [{...draft.inquiryResult!, resultSequence: request, sceneKey: 'inn'}]}],
  ]
  for (const [label, mutate] of mutations) {
    const copy = structuredClone(state); mutate(copy)
    const before = structuredClone(copy)
    expect(chatInquiryContinuityContextV1(copy)?.questions.some(q => q.questionSequence === question) ?? false, label).toBe(false)
    expect(() => previewChatSituationV1(copy, input), label).toThrow()
    expect(copy).toEqual(before)
  }
  for (const key of ['lost', 'clerk-present']) {
    const copy = structuredClone(state)
    copy.chatNarrative!.situation.facts.find(f => f.factKey === key)!.sourceEventSequence = request
    expect(() => previewChatSituationV1(copy, input)).toThrow()
  }
})

it('requires the complete intervening span, including a low-relevance withdrawal, within the existing budget', async () => {
  const f = await prepareChatInquiryFixture({playerInterjection: '先别问他了。'})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  const span = chatInquiryContinuityContextV1(state)!.dialogueMessageIds
  const projection = buildChatHistoryCoordinatorProjectionV1(state, {text: '柜台木箱', retrievalVersion: 'chat-relevance-v9', inquiryEvidence: 3})
  const rendered = JSON.parse(projection.text.slice(projection.text.indexOf('{')))
  expect(rendered.messages.map((m: {messageId: string}) => m.messageId)).toEqual(expect.arrayContaining(span))
  for (const messageId of span) expect(projection.selection.history.find(r => r.kind === 'messages' && r.key === messageId)?.required).toContain('inquiry-dialogue-continuity')
  const later = structuredClone(state)
  later.messages.push({...later.messages.find(m => m.messageId === 'inquiry.player')!, messageId: 'later-withdrawal',
    eventSequence: later.chatNarrative!.pendingSituation!.sourceEventSequence + 1, text: '现在停止这个问题。'})
  expect(chatInquiryContinuityContextV1(later)!.dialogueMessageIds).toContain('later-withdrawal')
  later.chatNarrative!.excludedMessageIds = ['later-withdrawal']
  expect(chatInquiryContinuityContextV1(later)!.questions).toEqual([])
  const tooLarge = structuredClone(state)
  tooLarge.messages.find(m => m.text === inquiryReassurance)!.text += '完整对话不能静默裁掉。'.repeat(4000)
  expect(() => buildChatHistoryCoordinatorProjectionV1(tooLarge, {text: '', retrievalVersion: 'chat-relevance-v9', inquiryEvidence: 3})).toThrow()
})

it.each(['先别问他了。', '改问别的人。', '这个问题算了，我们聊点别的。'])('retains %s for independent review and cannot adopt the withdrawn answer', async playerInterjection => {
  const f = await prepareChatInquiryFixture({playerInterjection}), draft = await chatInquiryDraftFixture(f.sessionId)
  const before = await readProductRuntimeState(f.sessionId), report = chatInquiryReviewFixture(draft)
  report.inquiryReview.checks.find(c => c.check === 'actual-question')!.passed = false
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), onRunCreated: id => {runId = id},
    runAI: async messages => {calls++; expect(messages[1].content).toContain(playerInterjection); return JSON.stringify(draft)},
    runReviewAI: async messages => {
      calls++; expect(messages[0].content).toContain('实际撤回、改题、改对象或停止推进则拒绝过时答复')
      for (const text of [inquiryQuestion, playerInterjection, inquiryReassurance]) expect(messages[1].content).toContain(text)
      return JSON.stringify(report)
    }})).rejects.toThrow()
  expect(calls).toBe(2)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it.each([false, true])('settles a cross-turn answer exactly once through review, restore, branch and import (private=%s)', async privateAnswer => {
  const f = await prepareChatInquiryFixture({playerInterjection: '嗯，我在听。', questionEvidenceFactKeys: ['clerk-present', 'box']})
  const draft = await chatInquiryDraftFixture(f.sessionId, privateAnswer ? ['guard'] : ['guard', 'player'])
  const world = await db.worldReleases.toArray()
  let generated = 0, reviewed = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: async messages => {
    generated++
    expect(messages[0].content).toContain('跨玩家回合')
    for (const text of [inquiryQuestion, '嗯，我在听。', inquiryReassurance]) expect(messages[1].content).toContain(text)
    return JSON.stringify(draft)
  }, onSituationDraftSaved: id => {runId = id; throw new Error('host-before-review')}})).rejects.toThrow('host-before-review')
  db.close(); await db.open()
  const result = await resumeChatSituationReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    reviewed++; expect(messages[1].content).toContain('"version":5')
    return JSON.stringify(chatInquiryReviewFixture(draft))
  }})
  expect(result.snapshot.contract.executionBindings?.find(b => b.skillId === 'character.chat-situation-review')?.promptVersion).toBe('chat-situation-review-v19')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const saved = await readProductRuntimeState(f.sessionId), version = await readProductRuntimeStateVersion(f.sessionId)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(version)
  expect(saved.interaction!.chatNarrative!.inquiryHistory).toHaveLength(1)
  const facts = saved.interaction!.chatNarrative!.situation.facts
  expect(facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual(draft.inquiryResult!.audienceKeys)
  expect(facts.find(f => f.factKey === 'purpose')!.audienceKeys).toEqual([])
  const event = (await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).toArray()).find(e => e.type === 'interaction.narrative.situation.committed')!
  expect(JSON.parse(event.payloadJson).inquiryEvidenceVersion).toBe(5)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: version.sequence, title: '跨回合答复分支'})
  expect((await readProductRuntimeState(branch.id!)).interaction!.chatNarrative!.inquiryHistory![0].questionSequence).toBeLessThan(0)
  const importedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(importedProject).toArray()).find(s => s.parentSessionId == null)!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(saved.interaction)
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(saved.interaction)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(world)
  expect([generated, reviewed]).toEqual([1, 1])
})

it('preserves frozen v2 prompt bytes while v3 describes complete cross-turn evidence', () => {
  const digest = (value: string[]) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  expect(digest(chatInquiryGenerationRulesV1('chat-situation-construction-v14'))).toBe('8f8f5c4a828cc9470e8f18916a02205893b352b2d21e4434aea12fdda26615a5')
  expect(digest(chatInquiryReviewRulesV1('chat-situation-review-v13'))).toBe('ed1f3bb9a65232bfb4e3ef5e465085e68633aac0a7c7389d8697090752df80cc')
})

it('repairs the exact retained V309 question reference without altering its story or permissions', () => {
  const state = actualInquiry.state as CharacterInteractionRuntimeState, before = structuredClone(state)
  expect(chatInquiryQuestionEvidenceContextV1(state)!.questions.map(q => q.questionSequence)).toEqual([10])
  const evidence = chatInquiryContinuityContextV1(state)!
  expect(evidence.questions.map(q => q.questionSequence)).toContain(7)
  const question = state.messages.find(m => m.eventSequence === 7)!, player = state.messages.find(m => m.eventSequence === 8)!
  expect(question.text).toContain('您最后一次见到铜印是什么时候')
  expect(player.text).toBe('嗯，我在听。')
  expect(evidence.dialogueMessageIds).toEqual(expect.arrayContaining([question.messageId, player.messageId]))
  const projected = buildChatHistoryCoordinatorProjectionV1(state, {text: '', retrievalVersion: 'chat-relevance-v9', inquiryEvidence: 3})
  expect(projected.text).toContain(question.text)
  expect(projected.text).toContain(player.text)
  expect(state).toEqual(before)
})
